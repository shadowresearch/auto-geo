import type {
  Engine,
  EngineFactoryOptions,
  EngineResponse,
  CitedSource,
} from "./types";

/**
 * Perplexity Sonar adapter — the primary engine for `auto-geo check`.
 *
 * Perplexity exposes grounded search via the OpenAI-compatible
 * Chat Completions endpoint at `https://api.perplexity.ai/chat/completions`.
 * Pass `model: "sonar"` (or `"sonar-pro"`) and the response includes a
 * top-level `citations: string[]` array of source URLs alongside the
 * assistant message — that's the field we score against.
 *
 * Docs: https://docs.perplexity.ai/api-reference/chat-completions
 *
 * The adapter is a thin wrapper around `fetch` — no SDK needed. Tests
 * mock by passing a fake `fetch` via `EngineFactoryOptions.fetch`.
 */

const PERPLEXITY_ENDPOINT = "https://api.perplexity.ai/chat/completions";
const DEFAULT_MODEL = "sonar";

/**
 * Published Perplexity pricing as of mid-2026. Used purely for the
 * cost-estimation surface in the human-readable report. These rates
 * are point-in-time; users should treat the spend number as
 * approximate, not authoritative. The actual Perplexity invoice is
 * the source of truth.
 *
 * Rates expressed per 1M tokens (USD). Per-request fee is layered on
 * top for grounded search.
 */
const PRICING: Record<
  string,
  { promptPer1M: number; completionPer1M: number; perRequest: number }
> = {
  sonar: { promptPer1M: 1, completionPer1M: 1, perRequest: 0.005 },
  "sonar-pro": { promptPer1M: 3, completionPer1M: 15, perRequest: 0.005 },
};

/**
 * Minimal shape of the response body we depend on. Perplexity returns
 * more fields than this — we intentionally narrow to the surface we
 * actually consume so a non-breaking API addition doesn't ripple
 * through the adapter.
 */
type PerplexityResponse = {
  choices?: Array<{
    message?: { role?: string; content?: string };
  }>;
  citations?: string[];
  /**
   * `search_results` is the richer form some Sonar tiers return — an
   * array of `{ title, url, date? }` objects. When present we prefer
   * it over the bare `citations` array because it gives us titles.
   */
  search_results?: Array<{ title?: string; url?: string; date?: string }>;
  /**
   * `search_queries` is exposed on some newer Sonar response shapes —
   * the literal queries Perplexity expanded the user prompt into during
   * its web search. Captured when present; never required.
   */
  search_queries?: string[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

export function createPerplexityEngine(
  opts: EngineFactoryOptions = {}
): Engine {
  const model = opts.model ?? DEFAULT_MODEL;
  const apiKey = opts.apiKey ?? process.env.PERPLEXITY_API_KEY;
  const fetchImpl = opts.fetch ?? globalThis.fetch;

  return {
    name: "perplexity",
    model,
    async askWithCitations(query: string): Promise<EngineResponse> {
      if (!apiKey) {
        throw new Error(
          "PERPLEXITY_API_KEY is not set. Export it (or pass --api-key) before running `auto-geo check --engine perplexity`."
        );
      }

      const body = {
        model,
        messages: [
          {
            role: "system",
            content:
              "You are a research assistant. Answer the user's question using web search and cite your sources.",
          },
          { role: "user", content: query },
        ],
      };

      const res = await fetchImpl(PERPLEXITY_ENDPOINT, {
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
          `Perplexity API ${res.status} ${res.statusText}${text ? ` — ${text}` : ""}`
        );
      }

      const data = (await res.json()) as PerplexityResponse;
      const answer = data.choices?.[0]?.message?.content ?? "";
      const citations = normalizeCitations(data);
      const fanOutQueries = parsePerplexityFanOutQueries(data);
      const usage = estimateUsage(model, data.usage);
      return { answer, citations, fanOutQueries, usage };
    },
  };
}

/**
 * Capture the literal sub-queries Sonar ran when present. Older Sonar
 * tiers don't surface them — return `[]` rather than throw so the
 * adapter remains forward-compatible.
 */
export function parsePerplexityFanOutQueries(
  data: PerplexityResponse
): string[] {
  if (!Array.isArray(data.search_queries)) return [];
  return data.search_queries.filter(
    (q): q is string => typeof q === "string" && q.length > 0
  );
}

/**
 * Pick the richest citation form available on the response and
 * normalize to `CitedSource[]`. Prefer `search_results` (carries
 * titles) over the bare `citations` URL array.
 */
function normalizeCitations(data: PerplexityResponse): CitedSource[] {
  if (Array.isArray(data.search_results) && data.search_results.length > 0) {
    const out: CitedSource[] = [];
    for (const r of data.search_results) {
      if (!r.url) continue;
      const entry: CitedSource = { url: r.url };
      if (r.title) entry.title = r.title;
      out.push(entry);
    }
    return out;
  }
  if (Array.isArray(data.citations)) {
    return data.citations
      .filter((u): u is string => typeof u === "string" && u.length > 0)
      .map((url) => ({ url }));
  }
  return [];
}

function estimateUsage(
  model: string,
  usage: PerplexityResponse["usage"]
): EngineResponse["usage"] {
  if (!usage) return undefined;
  const rate = PRICING[model] ?? PRICING[DEFAULT_MODEL]!;
  const prompt = usage.prompt_tokens ?? 0;
  const completion = usage.completion_tokens ?? 0;
  const cost =
    (prompt / 1_000_000) * rate.promptPer1M +
    (completion / 1_000_000) * rate.completionPer1M +
    rate.perRequest;
  return {
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
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
