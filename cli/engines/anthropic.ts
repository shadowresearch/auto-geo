import type {
  Engine,
  EngineFactoryOptions,
  EngineResponse,
  CitedSource,
} from "./types";

/**
 * Anthropic Claude grounded-search adapter — `auto-geo check --engine
 * anthropic`.
 *
 * Uses the Messages API with the server-side `web_search` tool. Claude
 * decides when to invoke search; the response carries a `content[]`
 * array of mixed block types. Two relevant block kinds for us:
 *
 *   1. `{ type: "web_search_tool_result", content: [{ type:
 *      "web_search_result", url, title, encrypted_content }] }` — the
 *      raw search results pulled into context.
 *   2. `{ type: "text", text, citations: [{ type:
 *      "web_search_result_location", url, title, cited_text,
 *      encrypted_index }] }` — the synthesized answer text, with inline
 *      citations pointing at specific search results.
 *
 * We aggregate both sources into a single deduped `CitedSource[]` keyed
 * on URL. Inline-citation URLs are treated as first-class citations;
 * search-tool-result URLs that don't appear inline are still recorded
 * (they were retrieved in service of the answer even if not pinned
 * inline).
 *
 * Docs: https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool
 *
 * Tool type: `web_search_20250305` is the GA version supported across
 * Sonnet 4.x and Opus 4.x. A newer `web_search_20260209` exists with
 * dynamic-filtering support but is gated to Opus 4.6+. We default to
 * the older tool ID so `claude-sonnet-4-5` works out of the box;
 * override via `opts.toolType` for Opus runs. [needs-verification]
 * once the newer tool reaches Sonnet GA, flip the default.
 */

const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-sonnet-4-5";
const DEFAULT_TOOL_TYPE = "web_search_20250305";
const DEFAULT_MAX_TOKENS = 1024;

/**
 * Published Anthropic pricing — per 1M tokens. Web search is billed
 * separately at a flat per-search fee. Sources:
 * - https://www.anthropic.com/pricing
 * - Web search: $10 per 1,000 searches → $0.01 per search
 */
const PRICING: Record<
  string,
  { promptPer1M: number; completionPer1M: number; perSearch: number }
> = {
  "claude-sonnet-4-5": { promptPer1M: 3, completionPer1M: 15, perSearch: 0.01 },
  "claude-sonnet-4-6": { promptPer1M: 3, completionPer1M: 15, perSearch: 0.01 },
  "claude-opus-4-5": { promptPer1M: 15, completionPer1M: 75, perSearch: 0.01 },
  "claude-opus-4-6": { promptPer1M: 15, completionPer1M: 75, perSearch: 0.01 },
  "claude-3-5-sonnet": { promptPer1M: 3, completionPer1M: 15, perSearch: 0.01 },
  "claude-3-5-haiku": {
    promptPer1M: 0.8,
    completionPer1M: 4,
    perSearch: 0.01,
  },
};

const DEFAULT_RATE = { promptPer1M: 3, completionPer1M: 15, perSearch: 0.01 };

/**
 * Narrow shape of the Messages-API body we depend on.
 */
export type AnthropicMessageResponse = {
  content?: Array<{
    type?: string;
    text?: string;
    /** `server_tool_use` blocks carry the literal sub-query Claude ran. */
    name?: string;
    input?: { query?: string };
    citations?: Array<{
      type?: string; // "web_search_result_location"
      url?: string;
      title?: string;
      cited_text?: string;
      encrypted_index?: string;
    }>;
    // For `web_search_tool_result` blocks the nested content is the list
    // of raw search results. For error blocks it's a single object —
    // we narrow to the array shape and ignore the error variant.
    content?:
      | Array<{
          type?: string; // "web_search_result"
          url?: string;
          title?: string;
          encrypted_content?: string;
        }>
      | { type?: string; error_code?: string };
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
    server_tool_use?: {
      web_search_requests?: number;
    };
  };
};

export type AnthropicEngineOptions = EngineFactoryOptions & {
  /** Tool type identifier. Defaults to `web_search_20250305`. */
  toolType?: string;
  /** `max_tokens` for the Messages call. Defaults to 1024. */
  maxTokens?: number;
};

export function createAnthropicEngine(
  opts: AnthropicEngineOptions = {}
): Engine {
  const model = opts.model ?? DEFAULT_MODEL;
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const toolType = opts.toolType ?? DEFAULT_TOOL_TYPE;
  const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;

  return {
    name: "anthropic",
    model,
    async askWithCitations(query: string): Promise<EngineResponse> {
      if (!apiKey) {
        throw new Error(
          "ANTHROPIC_API_KEY is not set. Export it (or pass --api-key) before running `auto-geo check --engine anthropic`."
        );
      }

      const body = {
        model,
        max_tokens: maxTokens,
        messages: [{ role: "user", content: query }],
        tools: [{ type: toolType, name: "web_search" }],
      };

      const res = await fetchImpl(ANTHROPIC_ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await safeText(res);
        throw new Error(
          `Anthropic API ${res.status} ${res.statusText}${text ? ` — ${text}` : ""}`
        );
      }

      const data = (await res.json()) as AnthropicMessageResponse;
      const answer = extractAnthropicAnswer(data);
      const citations = parseAnthropicCitations(data);
      const fanOutQueries = parseAnthropicFanOutQueries(data);
      const usage = estimateUsage(model, data.usage);
      return { answer, citations, fanOutQueries, usage };
    },
  };
}

/**
 * Walk `content[]` for `server_tool_use` blocks whose `name` is
 * `"web_search"`, collecting each call's `input.query`. Claude can
 * invoke the search tool more than once per message; we preserve order
 * (matches the order the model issued them) and dedupe.
 */
export function parseAnthropicFanOutQueries(
  data: AnthropicMessageResponse
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const block of data.content ?? []) {
    if (block.type !== "server_tool_use") continue;
    if (block.name !== "web_search") continue;
    const q = block.input?.query;
    if (typeof q !== "string" || !q) continue;
    if (seen.has(q)) continue;
    seen.add(q);
    out.push(q);
  }
  return out;
}

/**
 * Concatenate every text block on the assistant message. Search-tool
 * blocks contribute no user-visible text — Claude weaves their content
 * into subsequent text blocks via citations.
 */
export function extractAnthropicAnswer(data: AnthropicMessageResponse): string {
  const parts: string[] = [];
  for (const block of data.content ?? []) {
    if (block.type === "text" && typeof block.text === "string") {
      parts.push(block.text);
    }
  }
  return parts.join("");
}

/**
 * Walk Claude's mixed content blocks. Aggregate URLs from both
 * `web_search_tool_result` (raw search results) and the inline
 * `web_search_result_location` citations on text blocks, then dedupe.
 *
 * Inline-cited URLs win for title attribution when both forms surface
 * the same URL — the inline title is what Claude actually attributed
 * the claim to, even if the raw result carried a different page title.
 */
export function parseAnthropicCitations(
  data: AnthropicMessageResponse
): CitedSource[] {
  const out = new Map<string, CitedSource>();

  for (const block of data.content ?? []) {
    // 1) Raw search results.
    if (
      block.type === "web_search_tool_result" &&
      Array.isArray(block.content)
    ) {
      for (const r of block.content) {
        if (r.type !== "web_search_result" || !r.url) continue;
        if (out.has(r.url)) continue;
        const entry: CitedSource = { url: r.url };
        if (r.title) entry.title = r.title;
        out.set(r.url, entry);
      }
    }

    // 2) Inline citations on text blocks — take precedence for title.
    if (block.type === "text" && Array.isArray(block.citations)) {
      for (const c of block.citations) {
        if (c.type !== "web_search_result_location" || !c.url) continue;
        const entry: CitedSource = { url: c.url };
        if (c.title) entry.title = c.title;
        if (c.cited_text) entry.snippet = c.cited_text;
        out.set(c.url, entry); // overwrite — inline wins.
      }
    }
  }

  return [...out.values()];
}

function estimateUsage(
  model: string,
  usage: AnthropicMessageResponse["usage"]
): EngineResponse["usage"] {
  if (!usage) return undefined;
  const rate = PRICING[model] ?? DEFAULT_RATE;
  const prompt = usage.input_tokens ?? 0;
  const completion = usage.output_tokens ?? 0;
  const searches = usage.server_tool_use?.web_search_requests ?? 0;
  const cost =
    (prompt / 1_000_000) * rate.promptPer1M +
    (completion / 1_000_000) * rate.completionPer1M +
    searches * rate.perSearch;
  const totalTokens = prompt + completion;
  return {
    promptTokens: usage.input_tokens,
    completionTokens: usage.output_tokens,
    totalTokens: totalTokens > 0 ? totalTokens : undefined,
    estimatedCostUsd: Number(cost.toFixed(6)),
  };
}

async function safeText(res: Response): Promise<string> {
  try {
    const t = await res.text();
    return t.slice(0, 200);
  } catch {
    return "";
  }
}
