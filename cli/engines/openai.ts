import type {
  Engine,
  EngineFactoryOptions,
  EngineResponse,
  CitedSource,
} from "./types";

/**
 * OpenAI grounded-search adapter — `auto-geo check --engine openai`.
 *
 * Uses the Responses API with the `web_search_preview` tool. The model
 * decides when to invoke search; on completion the response carries a
 * top-level `output[]` array. Two relevant item kinds:
 *
 *   1. `{ type: "web_search_call", ... }` — the search invocation.
 *      Discarded; we don't surface the raw query.
 *   2. `{ type: "message", role: "assistant", content: [...] }` — the
 *      synthesized answer. Each `output_text` content item may carry
 *      `annotations: [{ type: "url_citation", url, title, start_index,
 *      end_index }]`. Those annotations are the citation list we score.
 *
 * The annotation parser (`parseOpenAICitations`) is exported for direct
 * unit testing — the HTTP wrapper here just feeds it the parsed body.
 *
 * Docs: https://developers.openai.com/api/docs/guides/tools-web-search
 *
 * Note: the docs flag `web_search_preview` as legacy in favour of a
 * newer `web_search` tool. We stick with the preview tool because it's
 * the broadest-compatibility option across `gpt-4o-mini` and the 4.1
 * family — switching to `web_search` is a one-line change once the
 * newer tool reaches GA across all the models we want to support.
 */

const OPENAI_ENDPOINT = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-4o-mini";

/**
 * Published OpenAI pricing — used purely for the cost-estimation
 * surface in the human-readable report. Mirrors the table in
 * `cli/cost.ts` but with the keys this adapter actually queries.
 * Rates expressed per 1M tokens (USD). The web_search_preview tool
 * also charges a per-call fee ($0.025/call on `gpt-4o-mini` as of
 * mid-2026 per the docs) — we layer that on top.
 */
const PRICING: Record<
  string,
  { promptPer1M: number; completionPer1M: number; perSearch: number }
> = {
  "gpt-4o-mini": { promptPer1M: 0.15, completionPer1M: 0.6, perSearch: 0.025 },
  "gpt-4o": { promptPer1M: 2.5, completionPer1M: 10, perSearch: 0.025 },
  "gpt-4.1-mini": { promptPer1M: 0.4, completionPer1M: 1.6, perSearch: 0.025 },
  "gpt-4.1": { promptPer1M: 2, completionPer1M: 8, perSearch: 0.025 },
};

/**
 * Narrow shape of the Responses-API body we depend on. We intentionally
 * narrow to the surface we actually consume so a non-breaking API
 * addition doesn't ripple through the adapter.
 */
export type OpenAIResponsesOutput = {
  output?: Array<{
    type?: string;
    role?: string;
    content?: Array<{
      type?: string;
      text?: string;
      annotations?: Array<{
        type?: string; // "url_citation"
        url?: string;
        title?: string;
        start_index?: number;
        end_index?: number;
      }>;
    }>;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
};

export function createOpenAIEngine(opts: EngineFactoryOptions = {}): Engine {
  const model = opts.model ?? DEFAULT_MODEL;
  const apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY;
  const fetchImpl = opts.fetch ?? globalThis.fetch;

  return {
    name: "openai",
    model,
    async askWithCitations(query: string): Promise<EngineResponse> {
      if (!apiKey) {
        throw new Error(
          "OPENAI_API_KEY is not set. Export it (or pass --api-key) before running `auto-geo check --engine openai`."
        );
      }

      const body = {
        model,
        input: query,
        tools: [{ type: "web_search_preview" }],
      };

      const res = await fetchImpl(OPENAI_ENDPOINT, {
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
          `OpenAI API ${res.status} ${res.statusText}${text ? ` — ${text}` : ""}`
        );
      }

      const data = (await res.json()) as OpenAIResponsesOutput;
      const answer = extractOpenAIAnswer(data);
      const citations = parseOpenAICitations(data);
      const usage = estimateUsage(model, data.usage);
      return { answer, citations, usage };
    },
  };
}

/**
 * Concatenate every `output_text` chunk on the assistant message. The
 * Responses API can return multiple content items per message (e.g.
 * one per cited segment); we join them rather than picking the first.
 */
export function extractOpenAIAnswer(data: OpenAIResponsesOutput): string {
  const parts: string[] = [];
  for (const item of data.output ?? []) {
    if (item.type !== "message") continue;
    for (const c of item.content ?? []) {
      if (c.type === "output_text" && typeof c.text === "string") {
        parts.push(c.text);
      }
    }
  }
  return parts.join("");
}

/**
 * Walk the Responses-API output tree and extract `url_citation`
 * annotations into a deduped `CitedSource[]`. Exported for direct unit
 * testing — the HTTP wrapper just feeds it `await res.json()`.
 */
export function parseOpenAICitations(
  data: OpenAIResponsesOutput
): CitedSource[] {
  const out: CitedSource[] = [];
  for (const item of data.output ?? []) {
    for (const c of item.content ?? []) {
      for (const a of c.annotations ?? []) {
        if (a.type === "url_citation" && a.url) {
          const entry: CitedSource = { url: a.url };
          if (a.title) entry.title = a.title;
          out.push(entry);
        }
      }
    }
  }
  return dedupeByUrl(out);
}

function estimateUsage(
  model: string,
  usage: OpenAIResponsesOutput["usage"]
): EngineResponse["usage"] {
  if (!usage) return undefined;
  const rate = PRICING[model] ?? PRICING[DEFAULT_MODEL]!;
  const prompt = usage.input_tokens ?? 0;
  const completion = usage.output_tokens ?? 0;
  // One Responses call with the web_search tool = one billable search,
  // even if the model invokes search multiple times under the hood —
  // OpenAI's public pricing is per-call, not per-search-invocation.
  const cost =
    (prompt / 1_000_000) * rate.promptPer1M +
    (completion / 1_000_000) * rate.completionPer1M +
    rate.perSearch;
  return {
    promptTokens: usage.input_tokens,
    completionTokens: usage.output_tokens,
    totalTokens: usage.total_tokens,
    estimatedCostUsd: Number(cost.toFixed(6)),
  };
}

function dedupeByUrl(citations: CitedSource[]): CitedSource[] {
  const seen = new Set<string>();
  const out: CitedSource[] = [];
  for (const c of citations) {
    if (seen.has(c.url)) continue;
    seen.add(c.url);
    out.push(c);
  }
  return out;
}

async function safeText(res: Response): Promise<string> {
  try {
    const t = await res.text();
    return t.slice(0, 200);
  } catch {
    return "";
  }
}
