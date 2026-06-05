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
   * Per-query parallelism. Defaults to 2 — low enough to be polite to
   * the engine API and to dodge most rate-limit ceilings. Set higher
   * with caution; sonar-pro will 429 you fast.
   */
  concurrency?: number;
};

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
  const concurrency = Math.max(1, opts.concurrency ?? 2);
  const normalizedDomain = normalizeDomain(opts.domain);

  const results: CheckQueryResult[] = new Array(opts.queries.length);

  // Bounded promise-pool — same shape as the sitemap doctor's worker
  // loop. Each worker pulls the next index and writes its result into
  // the pre-sized array, preserving input order in the final report.
  let cursor = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = cursor++;
      if (i >= opts.queries.length) return;
      const query = opts.queries[i]!;
      results[i] = await runOneQuery(opts.engine, query, normalizedDomain);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, opts.queries.length) }, worker)
  );

  return summarize(opts.domain, opts.engine, results);
}

async function runOneQuery(
  engine: Engine,
  query: string,
  normalizedDomain: string
): Promise<CheckQueryResult> {
  try {
    const response = await engine.askWithCitations(query);
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
      usage: response.usage,
    };
  } catch (err) {
    return {
      query,
      cited: false,
      citations: [],
      rawSources: [],
      answer: "",
      error: err instanceof Error ? err.message : String(err),
    };
  }
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
 */
export async function runCheckMulti(
  opts: RunCheckMultiOptions
): Promise<MultiEngineCheckReport> {
  if (opts.engines.length === 0) {
    throw new Error("runCheckMulti requires at least one engine");
  }
  const perEngineReports = await Promise.all(
    opts.engines.map((engine) =>
      runCheck({
        domain: opts.domain,
        queries: opts.queries,
        engine,
        concurrency: opts.concurrency,
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
