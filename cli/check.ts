import { createOpenAIEngine } from "./engines/openai";
import { createPerplexityEngine } from "./engines/perplexity";
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

export type EngineName = "perplexity" | "openai";

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
