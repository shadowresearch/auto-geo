/**
 * Shared types for `auto-geo check` engine adapters.
 *
 * Each AI-search engine (Perplexity, OpenAI, future Gemini, Claude, etc.)
 * exposes citations differently in its API response. The adapter layer
 * normalizes those engine-specific shapes down to a small, common
 * `CitedSource[]` so the orchestrator in `cli/check.ts` can score
 * coverage without caring which engine produced the answer.
 *
 * Adding a new engine = one file under `cli/engines/`, exporting a
 * factory that returns an `Engine`. Nothing else in the CLI changes.
 */

/**
 * One citation returned by an AI engine in response to a query.
 *
 * Engines vary in what they return — Perplexity gives a flat list of
 * URLs as `citations`, OpenAI's `web_search_preview` tool returns URL
 * citation annotations on message content. We normalize to the
 * intersection: URL is always present, title/snippet are best-effort.
 */
export type CitedSource = {
  /** Absolute URL of the cited page. Always present. */
  url: string;
  /** Page title if the engine surfaced one. */
  title?: string;
  /** Short snippet / excerpt the engine extracted, if any. */
  snippet?: string;
};

/**
 * Usage / cost metadata. Optional because not every engine returns it
 * in the same shape and not every engine charges per-token (some are
 * flat per-request). Surfaced in the final report's `summary` for
 * spend transparency.
 */
export type EngineUsage = {
  /** Tokens consumed by the prompt portion of the request. */
  promptTokens?: number;
  /** Tokens consumed by the completion portion of the request. */
  completionTokens?: number;
  /** Total tokens (some engines report only this). */
  totalTokens?: number;
  /**
   * Estimated USD cost for this single request. Engines that publish
   * stable per-1k-token rates can compute this from token counts; for
   * engines with flat pricing we record the per-request charge.
   */
  estimatedCostUsd?: number;
};

/**
 * Normalized response from a single engine call.
 *
 * `answer` is the engine's natural-language synthesis. We don't use it
 * for scoring (we only score on citations) but we surface it in `--json`
 * output so consumers can inspect what the engine actually said.
 */
export type EngineResponse = {
  answer: string;
  citations: CitedSource[];
  usage?: EngineUsage;
};

/**
 * Engine adapter contract. Every engine under `cli/engines/` implements
 * this — and the orchestrator dispatches purely against the interface.
 */
export type Engine = {
  /** Stable lowercase id, e.g. "perplexity", "openai". Used in CLI flags. */
  readonly name: string;
  /** Human-friendly model label, e.g. "sonar" — shown in the header. */
  readonly model: string;
  /**
   * Run a single grounded-search query. Adapters MUST normalize their
   * native citation shape into `CitedSource[]` before returning.
   *
   * Throws on transport failure, auth failure, rate limit, or schema
   * mismatch. The orchestrator catches per-query and records an error
   * — one bad query never halts a multi-query run.
   */
  askWithCitations(query: string): Promise<EngineResponse>;
};

/**
 * Common options every engine factory accepts. Each engine may extend
 * this with its own knobs (e.g. Perplexity's `search_recency_filter`),
 * but the orchestrator only knows about these.
 */
export type EngineFactoryOptions = {
  /** Override the model id. Each engine has a sensible default. */
  model?: string;
  /** Override the API key. Falls back to the engine-specific env var. */
  apiKey?: string;
  /**
   * Injectable fetch — used by tests to mock the HTTP layer without
   * monkey-patching `globalThis.fetch`. Defaults to global `fetch`.
   */
  fetch?: typeof globalThis.fetch;
};
