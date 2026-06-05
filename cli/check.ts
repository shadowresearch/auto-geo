import { createAnthropicEngine } from "./engines/anthropic";
import { createGeminiEngine } from "./engines/gemini";
import { createOpenAIEngine } from "./engines/openai";
import { createPerplexityEngine } from "./engines/perplexity";
import { createXAIEngine } from "./engines/xai";
import type {
  CitedSource,
  Engine,
  EngineFactoryOptions,
  EngineResponse,
} from "./engines/types";

/**
 * Orchestrator for `auto-geo check` — given a domain and a set of
 * queries, hit a grounded AI-search engine for each query and report
 * which queries actually cite the domain.
 *
 * Doctor measures "is this page shaped for citation?". Check measures
 * "is this page actually being cited?" — the same loop, downstream.
 *
 * Pure functions over the engine adapters so tests can pass a mock
 * `Engine` and exercise the full reporting / scoring path with zero
 * network. The CLI surface (in `cli/run.ts`) is a thin wrapper.
 */

// ── Public types ──────────────────────────────────────────────────

/**
 * A single citation from a single query, enriched with its position
 * in the source list (1-based "rank") and the total source count
 * for that query (the denominator). Useful for the human renderer
 * (`rank 2 of 6`) and for downstream dashboards measuring not just
 * whether a domain is cited but where it appears in the list.
 */
export type DomainCitation = {
  url: string;
  title?: string;
  /** 1-based position in the engine's citation list. */
  rank: number;
  /** Total citations the engine returned for this query. */
  totalCitationsForQuery: number;
};

export type CheckQueryResult = {
  query: string;
  cited: boolean;
  /** Citations whose hostname matched the target domain. */
  citations: DomainCitation[];
  /** Every source the engine returned, normalized. */
  rawSources: CitedSource[];
  /** Engine's natural-language synthesis. Kept for `--json` introspection. */
  answer: string;
  /**
   * Literal sub-queries the engine ran to ground its answer. Populated
   * when the engine exposes them (Gemini, Anthropic, OpenAI Responses,
   * newer Perplexity tiers); empty when it doesn't (xAI Live Search).
   * Always an array — never undefined — so consumers can iterate freely.
   */
  fanOutQueries: string[];
  /** Per-query usage (tokens, est. cost). */
  usage?: EngineResponse["usage"];
  /** Populated if this specific query failed; the rest of the run continues. */
  error?: string;
};

export type CheckReport = {
  domain: string;
  engine: string;
  model: string;
  results: CheckQueryResult[];
  summary: {
    /** Number of queries where the domain was cited at least once. */
    citedQueryCount: number;
    /** Total queries attempted. */
    totalQueries: number;
    /** Percentage 0-100, rounded. */
    coveragePct: number;
    /** Total page citations across all queries (sum of citations.length). */
    totalCitations: number;
    /** Estimated USD spend across all engine calls. */
    estimatedCostUsd: number;
    /** Per-query failures, by query string. */
    errors: Array<{ query: string; error: string }>;
  };
  generatedBy: string;
};

export type RunCheckOptions = {
  domain: string;
  queries: string[];
  engine: Engine;
  /**
   * Per-query parallelism. Defaults to {@link DEFAULT_CONCURRENCY} — a
   * throughput-vs-rate-limit balance that's safe at every engine's
   * documented default-tier ceilings. Set lower for restrictive
   * accounts, higher for high-tier API plans.
   */
  concurrency?: number;
  /**
   * Per-query outer timeout in seconds. If a single query exceeds it,
   * that query is aborted and recorded as `error: "timed out after Ns"`
   * — the rest of the run continues. This sits *above* any HTTP-level
   * timeout in the adapter so slow LLM grounding doesn't lock the run.
   * Defaults to {@link DEFAULT_TIMEOUT_PER_QUERY_SEC}.
   */
  timeoutPerQuerySec?: number;
  /**
   * Number of automatic retries on transient failures (429 / 5xx /
   * network). Defaults to {@link DEFAULT_MAX_RETRIES}. Backoff is
   * exponential — 1s then 4s. 4xx responses are NEVER retried (they're
   * configuration errors that won't fix themselves).
   */
  maxRetries?: number;
  /**
   * Whole-run timeout in seconds. When exceeded, the orchestrator
   * stops scheduling new queries, marks any still-pending queries as
   * `error: "skipped — max runtime exceeded"`, and returns the
   * partial report. Default `undefined` (no cap).
   */
  maxRuntimeSec?: number;
  /**
   * Callback fired exactly once per query as it resolves (in
   * completion order, not request order). Used by the CLI to stream
   * NDJSON output and print live progress to stderr. The orchestrator
   * never throws from here — a thrown callback is swallowed so a
   * presentation-layer bug can't poison the run.
   */
  onResult?: (
    result: CheckQueryResult,
    completed: number,
    total: number
  ) => void;
};

/**
 * Default per-query parallelism for `runCheck`. Bumped 6 → 12 in v0.5.0
 * after Perplexity Sonar Pro accounts proved they comfortably handle
 * sustained 12-wide parallelism; the existing exponential-backoff retry
 * on 429 catches anyone hitting a per-account cap. Lower for
 * restrictive plans, raise for high-tier API keys. Recommended cap is
 * ~20 per engine; bigger batch jobs against a single fast engine can
 * push `--concurrency 50` safely.
 *
 * Under `runCheckMulti` (`--engine all`) each engine gets its OWN pool
 * of this size — so 5 engines × concurrency 12 == up to 60 in-flight
 * requests, each respecting its own engine's rate limit.
 */
export const DEFAULT_CONCURRENCY = 12;

/** Default per-query outer timeout. See {@link RunCheckOptions.timeoutPerQuerySec}. */
export const DEFAULT_TIMEOUT_PER_QUERY_SEC = 60;

/** Default transient-failure retry budget. See {@link RunCheckOptions.maxRetries}. */
export const DEFAULT_MAX_RETRIES = 2;

// ── Engine selection ──────────────────────────────────────────────

/**
 * Canonical engine identifiers. `grok` is accepted as a public alias
 * for `xai` at the CLI parser layer but is normalized to `xai` before
 * `createEngine` is called.
 */
export type EngineName =
  | "perplexity"
  | "openai"
  | "anthropic"
  | "gemini"
  | "xai";

/** Every engine in the registry — used by `--engine all`. */
export const ALL_ENGINE_NAMES: readonly EngineName[] = [
  "perplexity",
  "openai",
  "anthropic",
  "gemini",
  "xai",
] as const;

/**
 * Map from engine id to the env var that must be set for it to run.
 * Drives both the CLI's --help text and `--engine all`'s availability
 * check (engines whose key is unset are skipped, not failed).
 *
 * Gemini accepts either GOOGLE_API_KEY or GEMINI_API_KEY — we list the
 * primary here and the adapter falls back to the second.
 */
export const ENGINE_ENV_VARS: Record<EngineName, string> = {
  perplexity: "PERPLEXITY_API_KEY",
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  gemini: "GOOGLE_API_KEY",
  xai: "XAI_API_KEY",
};

/** True if the engine's primary env var is present in the environment. */
export function engineHasCredentials(name: EngineName): boolean {
  if (process.env[ENGINE_ENV_VARS[name]]) return true;
  // Gemini fallback alias.
  if (name === "gemini" && process.env.GEMINI_API_KEY) return true;
  return false;
}

/**
 * Build an engine adapter by name. The CLI is the only caller — tests
 * construct adapters directly via the per-engine factories so they
 * can inject a fake `fetch`. Kept in this module so all engine names
 * are discoverable from one place.
 */
export function createEngine(
  name: EngineName,
  opts: EngineFactoryOptions = {}
): Engine {
  switch (name) {
    case "perplexity":
      return createPerplexityEngine(opts);
    case "openai":
      return createOpenAIEngine(opts);
    case "anthropic":
      return createAnthropicEngine(opts);
    case "gemini":
      return createGeminiEngine(opts);
    case "xai":
      return createXAIEngine(opts);
    default: {
      // Exhaustive — TS will flag if a new EngineName is added without
      // wiring it in. The runtime branch is a safety net.
      const _exhaustive: never = name;
      throw new Error(`unknown engine: ${String(_exhaustive)}`);
    }
  }
}

// ── Orchestration ─────────────────────────────────────────────────

const GENERATED_BY = "auto-geo check";

export async function runCheck(opts: RunCheckOptions): Promise<CheckReport> {
  const concurrency = Math.max(1, opts.concurrency ?? DEFAULT_CONCURRENCY);
  const timeoutMs =
    Math.max(1, opts.timeoutPerQuerySec ?? DEFAULT_TIMEOUT_PER_QUERY_SEC) *
    1000;
  const maxRetries = Math.max(0, opts.maxRetries ?? DEFAULT_MAX_RETRIES);
  const maxRuntimeMs =
    opts.maxRuntimeSec && opts.maxRuntimeSec > 0
      ? opts.maxRuntimeSec * 1000
      : undefined;
  const normalizedDomain = normalizeDomain(opts.domain);

  const total = opts.queries.length;
  const results: CheckQueryResult[] = new Array(total);
  let completed = 0;

  const emit = (result: CheckQueryResult, i: number): void => {
    results[i] = result;
    completed += 1;
    if (opts.onResult) {
      try {
        opts.onResult(result, completed, total);
      } catch {
        // Swallow — a presentation-layer error must never poison the run.
      }
    }
  };

  // Whole-run deadline (optional). When the deadline trips, workers
  // observe `runtimeExceeded` and exit; the main pass below marks any
  // still-missing slots as `skipped — max runtime exceeded`.
  const startedAt = Date.now();
  let runtimeExceeded = false;
  let runtimeTimer: ReturnType<typeof setTimeout> | undefined;
  if (maxRuntimeMs !== undefined) {
    runtimeTimer = setTimeout(() => {
      runtimeExceeded = true;
    }, maxRuntimeMs);
    // Don't keep the event loop alive purely for this timer.
    if (typeof runtimeTimer.unref === "function") runtimeTimer.unref();
  }

  // Bounded promise-pool — same shape as the sitemap doctor's worker
  // loop. Each worker pulls the next index and writes its result into
  // the pre-sized array, preserving input order in the final report.
  let cursor = 0;
  async function worker(): Promise<void> {
    while (true) {
      if (runtimeExceeded) return;
      const i = cursor++;
      if (i >= total) return;
      const query = opts.queries[i]!;
      const result = await runOneQuery(opts.engine, query, normalizedDomain, {
        timeoutMs,
        maxRetries,
        isRuntimeExceeded: () => runtimeExceeded,
        runtimeDeadlineMs:
          maxRuntimeMs === undefined ? undefined : startedAt + maxRuntimeMs,
      });
      emit(result, i);
    }
  }

  try {
    await Promise.all(
      Array.from({ length: Math.min(concurrency, total) }, worker)
    );
  } finally {
    if (runtimeTimer) clearTimeout(runtimeTimer);
  }

  // Fill any holes — queries that were never started because the
  // runtime deadline tripped first.
  for (let i = 0; i < total; i++) {
    if (!results[i]) {
      const skipped: CheckQueryResult = {
        query: opts.queries[i]!,
        cited: false,
        citations: [],
        rawSources: [],
        answer: "",
        fanOutQueries: [],
        error: "skipped — max runtime exceeded",
      };
      emit(skipped, i);
    }
  }

  return summarize(opts.domain, opts.engine, results);
}

/**
 * Per-attempt wrapper around `engine.askWithCitations`. Handles:
 *   - outer timeout via `AbortController` + `setTimeout`,
 *   - exponential-backoff retry on transient failures (429 / 5xx /
 *     network), bounded by `maxRetries`,
 *   - normalization of any unrecoverable error into a `CheckQueryResult`
 *     with an `error` string (so the caller's result-array stays
 *     well-formed).
 *
 * 4xx responses (other than 429) are NEVER retried — those are
 * configuration errors (bad key, bad model) and retrying just burns
 * time and quota.
 */
async function runOneQuery(
  engine: Engine,
  query: string,
  normalizedDomain: string,
  opts: {
    timeoutMs: number;
    maxRetries: number;
    isRuntimeExceeded?: () => boolean;
    runtimeDeadlineMs?: number;
  }
): Promise<CheckQueryResult> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    // If the whole run is past its deadline, stop retrying.
    if (opts.isRuntimeExceeded?.()) break;
    // Effective per-attempt timeout: the smaller of the per-query
    // budget and the time remaining until the whole-run deadline.
    let effectiveTimeout = opts.timeoutMs;
    if (opts.runtimeDeadlineMs !== undefined) {
      const remaining = opts.runtimeDeadlineMs - Date.now();
      if (remaining <= 0) break;
      effectiveTimeout = Math.min(effectiveTimeout, remaining);
    }

    try {
      const response = await withTimeout(
        engine.askWithCitations(query),
        effectiveTimeout
      );
      const sources = response.citations;
      const citations: DomainCitation[] = [];
      sources.forEach((source, idx) => {
        if (hostnameMatchesDomain(source.url, normalizedDomain)) {
          citations.push({
            url: source.url,
            title: source.title,
            rank: idx + 1,
            totalCitationsForQuery: sources.length,
          });
        }
      });
      return {
        query,
        cited: citations.length > 0,
        citations,
        rawSources: sources,
        answer: response.answer,
        fanOutQueries: response.fanOutQueries ?? [],
        usage: response.usage,
      };
    } catch (err) {
      lastError = err;
      // Decide retryability.
      if (attempt >= opts.maxRetries) break;
      if (!isRetryable(err)) break;
      // Exponential backoff: 1s, 4s. Bounded by remaining runtime.
      const waitMs = attempt === 0 ? 1000 : 4000;
      const cappedWait =
        opts.runtimeDeadlineMs === undefined
          ? waitMs
          : Math.min(waitMs, Math.max(0, opts.runtimeDeadlineMs - Date.now()));
      if (cappedWait <= 0) break;
      await sleep(cappedWait);
    }
  }
  return {
    query,
    cited: false,
    citations: [],
    rawSources: [],
    answer: "",
    fanOutQueries: [],
    error: lastError instanceof Error ? lastError.message : String(lastError),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    if (typeof t.unref === "function") t.unref();
  });
}

/**
 * Wrap a promise with an outer timeout. If the timeout fires first,
 * rejects with `Error("timed out after Ns")`. The wrapped promise
 * keeps running (we can't cancel an opaque adapter call), but its
 * eventual result is discarded — keeps the worker pool from getting
 * stuck on a slow query.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      reject(new Error(`timed out after ${Math.round(ms / 1000)}s`));
    }, ms);
    if (typeof t.unref === "function") t.unref();
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (err) => {
        clearTimeout(t);
        reject(err);
      }
    );
  });
}

/**
 * Classify an error from `engine.askWithCitations` as transient
 * (retryable) or terminal. Engine adapters throw `Error` with the
 * HTTP status embedded in the message; we sniff for 429 and 5xx.
 * Network-shaped errors (TypeError thrown by undici on connection
 * failure, AbortError, our own timeout) are also retryable.
 */
function isRetryable(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message;
    if (/\b429\b/.test(msg)) return true;
    if (/\b5\d{2}\b/.test(msg)) return true;
    if (/timed out after/i.test(msg)) return true;
    if (/network|ECONN|ETIMEDOUT|EAI_AGAIN|fetch failed/i.test(msg))
      return true;
  }
  // Undici tends to throw plain TypeError on connection failure.
  if (err instanceof TypeError) return true;
  return false;
}

function summarize(
  domain: string,
  engine: Engine,
  results: CheckQueryResult[]
): CheckReport {
  const citedQueryCount = results.filter((r) => r.cited).length;
  const totalQueries = results.length;
  const coveragePct =
    totalQueries === 0 ? 0 : Math.round((citedQueryCount / totalQueries) * 100);
  const totalCitations = results.reduce(
    (acc, r) => acc + r.citations.length,
    0
  );
  const estimatedCostUsd = Number(
    results
      .reduce((acc, r) => acc + (r.usage?.estimatedCostUsd ?? 0), 0)
      .toFixed(6)
  );
  const errors = results
    .filter((r) => r.error)
    .map((r) => ({ query: r.query, error: r.error! }));

  return {
    domain,
    engine: engine.name,
    model: engine.model,
    results,
    summary: {
      citedQueryCount,
      totalQueries,
      coveragePct,
      totalCitations,
      estimatedCostUsd,
      errors,
    },
    generatedBy: GENERATED_BY,
  };
}

// ── Multi-engine aggregation ──────────────────────────────────────

export type RunCheckMultiOptions = {
  domain: string;
  queries: string[];
  engines: Engine[];
  concurrency?: number;
  timeoutPerQuerySec?: number;
  maxRetries?: number;
  maxRuntimeSec?: number;
};

/**
 * A query's roll-up across every engine that ran. `citedByAny` is the
 * union signal: did ANY engine cite the domain for this query? The
 * `perEngine` map preserves engine-by-engine attribution so the
 * renderer can show "perplexity ✓, openai ✗, gemini ✓".
 */
export type AcrossEngineQueryRow = {
  query: string;
  citedByAny: boolean;
  /** Engine ids that cited the domain for this query. */
  citedByEngines: string[];
  /** Engine ids that ran (regardless of cited result). */
  ranByEngines: string[];
};

export type MultiEngineCheckReport = {
  domain: string;
  /** Engine ids actually executed (those with credentials present). */
  engines: string[];
  /**
   * Skipped engines + the reason — surfaced so the user knows why a
   * given engine didn't run under `--engine all`.
   */
  skippedEngines: Array<{ engine: string; reason: string }>;
  /** Per-engine reports keyed by engine id. */
  perEngine: Record<string, CheckReport>;
  /** The across-engines roll-up — one row per input query. */
  acrossEngines: AcrossEngineQueryRow[];
  summary: {
    totalQueries: number;
    /**
     * Number of queries cited by at least one engine. Numerator of the
     * union-coverage metric.
     */
    citedByAnyCount: number;
    /** Union coverage as a percentage 0-100. */
    unionCoveragePct: number;
    /**
     * Mean of each engine's individual coverage. Different framing
     * from union coverage — answers "what's the average engine
     * doing?" vs "are you cited anywhere?".
     */
    meanCoveragePct: number;
    /** Sum of estimated cost across every per-engine report. */
    estimatedCostUsd: number;
  };
  generatedBy: string;
};

/**
 * Run the same query set against every engine in parallel and produce
 * both the per-engine reports and a union roll-up. Each engine's run is
 * independent — a failure in one engine never short-circuits the
 * others (its summary just carries the per-query errors as usual).
 *
 * **Per-engine concurrency pools.** Each engine gets its OWN worker
 * pool of size `concurrency` (default `DEFAULT_CONCURRENCY = 12`).
 * Pools execute fully in parallel across engines via `Promise.all`,
 * which means at full saturation the in-flight request count is
 * `engines.length × concurrency` — but each engine's per-account rate
 * limit is enforced INDEPENDENTLY by its own pool. With the v0.5.0
 * default that's up to 5 engines × 12 = 60 concurrent requests for a
 * fully-credentialed `--engine all` run.
 */
export async function runCheckMulti(
  opts: RunCheckMultiOptions
): Promise<MultiEngineCheckReport> {
  if (opts.engines.length === 0) {
    throw new Error("runCheckMulti requires at least one engine");
  }
  // One `runCheck` invocation per engine — each carries its own
  // bounded worker pool. `Promise.all` lets the engine pools tick
  // concurrently, so a slow engine never blocks a fast one and a
  // single engine's rate-limit retry never delays the others.
  const perEngineReports = await Promise.all(
    opts.engines.map((engine) =>
      runCheck({
        domain: opts.domain,
        queries: opts.queries,
        engine,
        concurrency: opts.concurrency,
        timeoutPerQuerySec: opts.timeoutPerQuerySec,
        maxRetries: opts.maxRetries,
        maxRuntimeSec: opts.maxRuntimeSec,
      })
    )
  );

  const perEngine: Record<string, CheckReport> = {};
  for (const r of perEngineReports) perEngine[r.engine] = r;

  // Build the per-query union roll-up — input order preserved.
  const acrossEngines: AcrossEngineQueryRow[] = opts.queries.map((query) => {
    const citedByEngines: string[] = [];
    const ranByEngines: string[] = [];
    for (const r of perEngineReports) {
      ranByEngines.push(r.engine);
      const row = r.results.find((res) => res.query === query);
      if (row && row.cited) citedByEngines.push(r.engine);
    }
    return {
      query,
      citedByAny: citedByEngines.length > 0,
      citedByEngines,
      ranByEngines,
    };
  });

  const totalQueries = opts.queries.length;
  const citedByAnyCount = acrossEngines.filter((r) => r.citedByAny).length;
  const unionCoveragePct =
    totalQueries === 0 ? 0 : Math.round((citedByAnyCount / totalQueries) * 100);
  const meanCoveragePct =
    perEngineReports.length === 0
      ? 0
      : Math.round(
          perEngineReports.reduce((acc, r) => acc + r.summary.coveragePct, 0) /
            perEngineReports.length
        );
  const estimatedCostUsd = Number(
    perEngineReports
      .reduce((acc, r) => acc + r.summary.estimatedCostUsd, 0)
      .toFixed(6)
  );

  return {
    domain: opts.domain,
    engines: perEngineReports.map((r) => r.engine),
    skippedEngines: [],
    perEngine,
    acrossEngines,
    summary: {
      totalQueries,
      citedByAnyCount,
      unionCoveragePct,
      meanCoveragePct,
      estimatedCostUsd,
    },
    generatedBy: GENERATED_BY,
  };
}

// ── Domain matching ───────────────────────────────────────────────

/**
 * Reduce a `--domain` argument to a bare lowercase host.
 *
 * Accepts:
 *   - bare domain: `shadow.inc`
 *   - origin: `https://shadow.inc`
 *   - origin with path: `https://shadow.inc/resources`
 *   - leading `www.`: `www.shadow.inc`
 *
 * Normalizes all of the above to `shadow.inc`. Throws on input that
 * doesn't look like a domain at all — better to surface that early
 * than to silently match nothing.
 */
export function normalizeDomain(input: string): string {
  if (!input || typeof input !== "string") {
    throw new Error("--domain requires a non-empty string");
  }
  let host = input.trim().toLowerCase();
  // Strip protocol if present
  host = host.replace(/^https?:\/\//, "");
  // Strip anything after the first path/query/hash separator
  host = host.split(/[/?#]/)[0]!;
  // Strip a leading www. so it matches the suffix rule symmetrically
  host = host.replace(/^www\./, "");
  if (!host || !/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(host)) {
    throw new Error(
      `--domain "${input}" doesn't look like a domain. Use a bare host like "shadow.inc" or a full origin like "https://shadow.inc".`
    );
  }
  return host;
}

/**
 * Returns true if the citation URL's hostname matches the target
 * domain. Matching is case-insensitive, strips `www.`, and is a
 * suffix match — so `shadow.inc` matches `shadow.inc`,
 * `www.shadow.inc`, and `blog.shadow.inc`, but NOT `notshadow.inc`
 * (which would be a substring match). The leading-dot check is what
 * prevents that false positive.
 *
 * Exported for tests and for any downstream consumer that wants to
 * reuse the same matching contract.
 */
export function hostnameMatchesDomain(
  url: string,
  normalizedDomain: string
): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  host = host.replace(/^www\./, "");
  if (host === normalizedDomain) return true;
  return host.endsWith(`.${normalizedDomain}`);
}
