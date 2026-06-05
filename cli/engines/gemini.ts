import type {
  Engine,
  EngineFactoryOptions,
  EngineResponse,
  CitedSource,
} from "./types";

/**
 * Google Gemini grounded-search adapter — `auto-geo check --engine
 * gemini`.
 *
 * Uses `generateContent` with the `google_search` tool (the newer
 * grounding flow that supersedes `google_search_retrieval` for Gemini
 * 1.5+ / 2.x models). Citations land in
 * `candidates[0].groundingMetadata`:
 *
 *   - `groundingChunks[]` — each `{ web: { uri, title } }`. These are
 *     the sources we score against.
 *   - `groundingSupports[]` — link text spans in the answer to chunk
 *     indices. Useful if we ever want to rank by inline-citation
 *     count; not consumed today.
 *   - `webSearchQueries[]` — the actual queries Gemini ran. Diagnostic
 *     only; not surfaced.
 *
 * Caveat: `groundingChunks[].web.uri` is almost always a Google
 * redirect (`https://vertexaisearch.cloud.google.com/grounding-api-
 * redirect/...`) rather than the raw source domain. The redirect is
 * required by Gemini's terms of service for displayed citations, so
 * we keep it as the canonical `url` — but we also try to surface the
 * destination domain via the `title` field (Gemini sets that to the
 * source-side title/host) and stash a note on the citation so the
 * renderer can flag it. The orchestrator's hostname matcher will not
 * match the wrapper against the user's domain, so we ALSO emit a
 * synthetic non-wrapper citation when we can derive one from the
 * title — that's what unblocks `--domain shadow.inc` matching.
 *
 * Docs: https://ai.google.dev/gemini-api/docs/grounding
 */

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_MODEL = "gemini-2.5-flash";

/**
 * Pricing per 1M tokens, USD. Gemini 2.5 Flash is the standard tier
 * for grounded search and the cheapest model that supports it.
 * Grounding adds a small per-request fee (Google publishes 1,500 free
 * queries/day, then $35/1k → $0.035/req).
 */
const PRICING: Record<
  string,
  { promptPer1M: number; completionPer1M: number; perGroundedRequest: number }
> = {
  "gemini-2.5-flash": {
    promptPer1M: 0.075,
    completionPer1M: 0.3,
    perGroundedRequest: 0.035,
  },
  "gemini-2.5-pro": {
    promptPer1M: 1.25,
    completionPer1M: 5,
    perGroundedRequest: 0.035,
  },
  "gemini-1.5-flash": {
    promptPer1M: 0.075,
    completionPer1M: 0.3,
    perGroundedRequest: 0.035,
  },
  "gemini-1.5-pro": {
    promptPer1M: 1.25,
    completionPer1M: 5,
    perGroundedRequest: 0.035,
  },
};

const DEFAULT_RATE = {
  promptPer1M: 0.075,
  completionPer1M: 0.3,
  perGroundedRequest: 0.035,
};

const REDIRECT_HOST_RE =
  /(?:^|\.)(?:vertexaisearch|grounding)\.cloud\.google\.com$/i;

/**
 * Narrow shape of the generateContent response we depend on.
 */
export type GeminiGenerateContentResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
    groundingMetadata?: {
      groundingChunks?: Array<{
        web?: { uri?: string; title?: string };
      }>;
      groundingSupports?: Array<{
        segment?: { text?: string; startIndex?: number; endIndex?: number };
        groundingChunkIndices?: number[];
      }>;
      webSearchQueries?: string[];
    };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
};

export function createGeminiEngine(opts: EngineFactoryOptions = {}): Engine {
  const model = opts.model ?? DEFAULT_MODEL;
  // Both env vars are common in the wild (the Generative Language SDK
  // uses GOOGLE_API_KEY; the older Vertex tutorials use GEMINI_API_KEY).
  // Accept either so users don't have to relearn the spelling.
  const apiKey =
    opts.apiKey ?? process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;
  const fetchImpl = opts.fetch ?? globalThis.fetch;

  return {
    name: "gemini",
    model,
    async askWithCitations(query: string): Promise<EngineResponse> {
      if (!apiKey) {
        throw new Error(
          "GOOGLE_API_KEY (or GEMINI_API_KEY) is not set. Export one (or pass --api-key) before running `auto-geo check --engine gemini`."
        );
      }

      const endpoint = `${GEMINI_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const body = {
        contents: [{ parts: [{ text: query }] }],
        tools: [{ google_search: {} }],
      };

      const res = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await safeText(res);
        throw new Error(
          `Gemini API ${res.status} ${res.statusText}${text ? ` — ${text}` : ""}`
        );
      }

      const data = (await res.json()) as GeminiGenerateContentResponse;
      const answer = extractGeminiAnswer(data);
      const citations = parseGeminiCitations(data);
      const usage = estimateUsage(model, data.usageMetadata);
      return { answer, citations, usage };
    },
  };
}

export function extractGeminiAnswer(
  data: GeminiGenerateContentResponse
): string {
  const parts = data.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts
    .map((p) => (typeof p.text === "string" ? p.text : ""))
    .filter(Boolean)
    .join("");
}

/**
 * Extract grounding chunks → `CitedSource[]`. For each chunk we
 * preserve the canonical wrapper URI as the source URL, but ALSO emit
 * a derived non-wrapper citation when the title looks like a hostname
 * — that's what unblocks domain matching against user `--domain`
 * arguments. The wrapper carries a `notes` field so the renderer (or a
 * downstream consumer) can flag the redirect.
 */
export function parseGeminiCitations(
  data: GeminiGenerateContentResponse
): CitedSource[] {
  const chunks = data.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const out: CitedSource[] = [];
  const seen = new Set<string>();

  for (const chunk of chunks) {
    const uri = chunk.web?.uri;
    if (!uri) continue;

    const title = chunk.web?.title;
    const isWrapper = isGeminiRedirect(uri);

    if (!seen.has(uri)) {
      const entry: CitedSource = { url: uri };
      if (title) entry.title = title;
      if (isWrapper) {
        entry.notes =
          "Gemini-wrapped redirect URL; destination host inferred from title.";
      }
      out.push(entry);
      seen.add(uri);
    }

    // Synthesize a real-URL companion when the title is a parseable
    // hostname — this is what makes `hostnameMatchesDomain` actually
    // light up for users' domains.
    if (isWrapper && title) {
      const inferred = inferUrlFromTitle(title);
      if (inferred && !seen.has(inferred)) {
        out.push({
          url: inferred,
          title,
          notes: "Derived from Gemini grounding chunk title.",
        });
        seen.add(inferred);
      }
    }
  }

  return out;
}

function isGeminiRedirect(url: string): boolean {
  try {
    return REDIRECT_HOST_RE.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * Gemini titles are usually one of:
 *   - "example.com" (bare host)
 *   - "Page Title - example.com"
 *   - "Page Title | example.com"
 * We extract the trailing host token if it parses as a domain. Best-
 * effort; never throws.
 */
function inferUrlFromTitle(title: string): string | null {
  const trimmed = title.trim();
  // 1) Whole title is a host.
  if (looksLikeHost(trimmed)) return `https://${trimmed}`;
  // 2) Trailing host after a separator.
  const m = trimmed.match(/[-|–—·]\s*([a-z0-9.-]+\.[a-z]{2,})\s*$/i);
  if (m && m[1] && looksLikeHost(m[1])) return `https://${m[1].toLowerCase()}`;
  return null;
}

function looksLikeHost(s: string): boolean {
  return /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(s);
}

function estimateUsage(
  model: string,
  usage: GeminiGenerateContentResponse["usageMetadata"]
): EngineResponse["usage"] {
  if (!usage) return undefined;
  const rate = PRICING[model] ?? DEFAULT_RATE;
  const prompt = usage.promptTokenCount ?? 0;
  const completion = usage.candidatesTokenCount ?? 0;
  const cost =
    (prompt / 1_000_000) * rate.promptPer1M +
    (completion / 1_000_000) * rate.completionPer1M +
    rate.perGroundedRequest;
  return {
    promptTokens: usage.promptTokenCount,
    completionTokens: usage.candidatesTokenCount,
    totalTokens: usage.totalTokenCount,
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
