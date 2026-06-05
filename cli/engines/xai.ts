import type {
  Engine,
  EngineFactoryOptions,
  EngineResponse,
  CitedSource,
} from "./types";

/**
 * xAI Grok grounded-search adapter — `auto-geo check --engine xai`
 * (alias: `grok`).
 *
 * Uses xAI's OpenAI-compatible chat completions endpoint with the
 * `search_parameters` extension that enables Live Search. The response
 * is a standard chat-completions body with an additional `citations`
 * field on `choices[0].message` (and, on older deployments, at the
 * top level alongside `choices`) holding a flat `string[]` of source
 * URLs — no titles, no snippets. We derive a display title from the
 * URL's hostname for the renderer.
 *
 * Docs: https://docs.x.ai/docs/guides/live-search
 *
 * [needs-verification] The xAI docs in mid-2026 have largely migrated
 * the public examples to the newer `/v1/responses` endpoint with the
 * `web_search` tool. The chat-completions endpoint with
 * `search_parameters` remains operational against the v1 API and is
 * what most existing customers integrate with, so that's what this
 * adapter targets. If xAI hard-deprecates the chat path, swap to
 * `/v1/responses` with the same `search_parameters` payload shape.
 */

const XAI_ENDPOINT = "https://api.x.ai/v1/chat/completions";
const DEFAULT_MODEL = "grok-2-latest";

/**
 * Pricing per 1M tokens, USD. xAI's Live Search adds a per-source fee
 * ($0.025/source per xAI pricing, as of mid-2026). We estimate from
 * `num_sources_used` when surfaced, else fall back to citation count.
 */
const PRICING: Record<
  string,
  { promptPer1M: number; completionPer1M: number; perSource: number }
> = {
  "grok-2-latest": {
    promptPer1M: 2,
    completionPer1M: 10,
    perSource: 0.025,
  },
  "grok-2": { promptPer1M: 2, completionPer1M: 10, perSource: 0.025 },
  "grok-3": { promptPer1M: 3, completionPer1M: 15, perSource: 0.025 },
  "grok-4-latest": { promptPer1M: 5, completionPer1M: 20, perSource: 0.025 },
  "grok-4": { promptPer1M: 5, completionPer1M: 20, perSource: 0.025 },
};

const DEFAULT_RATE = {
  promptPer1M: 2,
  completionPer1M: 10,
  perSource: 0.025,
};

/**
 * Narrow shape of the chat-completions body we depend on.
 */
export type XAIChatResponse = {
  choices?: Array<{
    message?: {
      role?: string;
      content?: string;
      /** xAI keeps citations as a flat URL list on the message. */
      citations?: string[];
    };
  }>;
  /** Some older xAI deployments hoist `citations` to the top level. */
  citations?: string[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    /** xAI surfaces this when Live Search is enabled. */
    num_sources_used?: number;
  };
};

export function createXAIEngine(opts: EngineFactoryOptions = {}): Engine {
  const model = opts.model ?? DEFAULT_MODEL;
  const apiKey = opts.apiKey ?? process.env.XAI_API_KEY;
  const fetchImpl = opts.fetch ?? globalThis.fetch;

  return {
    name: "xai",
    model,
    async askWithCitations(query: string): Promise<EngineResponse> {
      if (!apiKey) {
        throw new Error(
          "XAI_API_KEY is not set. Export it (or pass --api-key) before running `auto-geo check --engine xai`."
        );
      }

      const body = {
        model,
        messages: [{ role: "user", content: query }],
        search_parameters: {
          mode: "on",
          return_citations: true,
        },
      };

      const res = await fetchImpl(XAI_ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await safeText(res);
        throw new Error(
          `xAI API ${res.status} ${res.statusText}${text ? ` — ${text}` : ""}`
        );
      }

      const data = (await res.json()) as XAIChatResponse;
      const answer = data.choices?.[0]?.message?.content ?? "";
      const citations = parseXAICitations(data);
      const usage = estimateUsage(model, data.usage, citations.length);
      return { answer, citations, usage };
    },
  };
}

/**
 * Extract the flat citation URL list and synthesize display titles
 * from hostnames. Prefer the message-level `citations` field; fall
 * back to the top-level field for older deployments.
 */
export function parseXAICitations(data: XAIChatResponse): CitedSource[] {
  const raw =
    data.choices?.[0]?.message?.citations ??
    (Array.isArray(data.citations) ? data.citations : []) ??
    [];

  const seen = new Set<string>();
  const out: CitedSource[] = [];
  for (const url of raw) {
    if (typeof url !== "string" || !url) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    const entry: CitedSource = { url };
    const host = safeHostname(url);
    if (host) entry.title = host;
    out.push(entry);
  }
  return out;
}

function estimateUsage(
  model: string,
  usage: XAIChatResponse["usage"],
  citationCount: number
): EngineResponse["usage"] {
  if (!usage) return undefined;
  const rate = PRICING[model] ?? DEFAULT_RATE;
  const prompt = usage.prompt_tokens ?? 0;
  const completion = usage.completion_tokens ?? 0;
  // Prefer the server-reported source count; fall back to citation
  // count, which approximates it well for most queries.
  const sources = usage.num_sources_used ?? citationCount;
  const cost =
    (prompt / 1_000_000) * rate.promptPer1M +
    (completion / 1_000_000) * rate.completionPer1M +
    sources * rate.perSource;
  return {
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
    estimatedCostUsd: Number(cost.toFixed(6)),
  };
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    const t = await res.text();
    return t.slice(0, 200);
  } catch {
    return "";
  }
}
