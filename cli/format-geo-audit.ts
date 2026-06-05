import type {
  CheckQueryResult,
  CheckReport,
  MultiEngineCheckReport,
} from "./check";

/**
 * `--format geo-audit` output mapper.
 *
 * Shadow's internal `geoAudit` agent tool emits a `LlmQueryResult` row
 * per (prompt × provider × model). We expose `--format geo-audit` on
 * `auto-geo check` so the CLI output is byte-shape-identical to that
 * downstream contract — making `auto-geo check` interchangeable with
 * the in-product tool for any consumer expecting the geoAudit shape.
 *
 * This module is the single source of truth for the mapping:
 *   - `CheckQueryResult` → `GeoAuditRow` (per-query)
 *   - `CheckReport` / `MultiEngineCheckReport` → `GeoAuditSummary`
 *
 * The default `auto-geo` format remains the stable `CheckReport` /
 * `MultiEngineCheckReport` shape — `--format geo-audit` is purely
 * additive opt-in. Nothing in the default path runs through here.
 */

// ── Public types ──────────────────────────────────────────────────

/**
 * One row of geo-audit output. Field names + types mirror
 * `LlmQueryResult` in
 * `packages/core/src/lib/tools/geoAudit.tool.ts` exactly — adding,
 * removing, or renaming a field here is a breaking contract change.
 */
export type GeoAuditRow = {
  prompt: string;
  provider: string;
  model: string;
  responseText: string;
  citations: { url: string; title: string }[];
  fanOutQueries: string[];
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  moneySpent: number | null;
  webSearchEnabled: boolean;
  datetime: string | null;
  error: string | null;
};

/**
 * Mirror of `GeoAuditOutput` from the in-product tool, minus the
 * sandbox-specific fields (`sandboxPath`, `columns`) that don't apply
 * to a CLI run that writes nothing to a sandbox.
 */
export type GeoAuditSummary = {
  promptCount: number;
  providerCount: number;
  totalQueries: number;
  successCount: number;
  errorCount: number;
  totalCitations: number;
  totalMoneySpent: number;
  providers: string[];
  errors: { prompt: string; provider: string; error: string }[];
};

export type GeoAuditOutput = {
  rows: GeoAuditRow[];
  summary: GeoAuditSummary;
};

// ── Provider name mapping ─────────────────────────────────────────

/**
 * Map auto-geo's engine names to the geoAudit tool's provider names.
 *
 * The product's `geoAudit` tool uses `chatgpt` as the public-facing
 * label for OpenAI (matching the DataForSEO-side naming). Every other
 * engine name happens to be byte-identical between the two systems —
 * we still route through this map so the contract is explicit and
 * future renames have one place to land.
 */
const PROVIDER_NAME_MAP: Record<string, string> = {
  openai: "chatgpt",
  perplexity: "perplexity",
  anthropic: "anthropic",
  gemini: "gemini",
  xai: "xai",
};

/** Public mapper for engine id → geoAudit provider id. */
export function toGeoAuditProvider(engineName: string): string {
  return PROVIDER_NAME_MAP[engineName] ?? engineName;
}

// ── Per-query mapping ─────────────────────────────────────────────

/**
 * Map one `CheckQueryResult` to a `GeoAuditRow`.
 *
 * Shape notes:
 *   - `prompt`            ← `query` (geoAudit calls user input "prompt")
 *   - `responseText`      ← `answer`
 *   - `citations[i].title` falls back to the URL's hostname when the
 *                          engine didn't surface a title, so every row
 *                          has a non-empty title string (the geoAudit
 *                          tool guarantees this for downstream renderers
 *                          that don't tolerate an empty label).
 *   - `inputTokens`       ← `usage.promptTokens` (rename only)
 *   - `outputTokens`      ← `usage.completionTokens`
 *   - `reasoningTokens`   ← always `null` from auto-geo today; the
 *                          underlying engines don't surface a separate
 *                          reasoning-token count on the response shape
 *                          we consume.
 *   - `moneySpent`        ← `usage.estimatedCostUsd` (rename only)
 *   - `webSearchEnabled`  ← `true` always: every engine `auto-geo
 *                          check` supports is a grounded-search engine.
 *   - `datetime`          ← ISO `now()` — we don't capture the
 *                          per-response timestamp from the providers,
 *                          but every row reflects an actual run.
 *   - `error`             ← passthrough (already a string-or-undefined).
 */
export function toGeoAuditRow(
  result: CheckQueryResult,
  opts: { provider: string; model: string }
): GeoAuditRow {
  const provider = toGeoAuditProvider(opts.provider);
  return {
    prompt: result.query,
    provider,
    model: opts.model,
    responseText: result.answer ?? "",
    citations: result.rawSources.map((c) => ({
      url: c.url,
      title: c.title && c.title.length > 0 ? c.title : safeHostname(c.url),
    })),
    fanOutQueries: result.fanOutQueries ?? [],
    inputTokens: result.usage?.promptTokens ?? null,
    outputTokens: result.usage?.completionTokens ?? null,
    reasoningTokens: null,
    moneySpent: result.usage?.estimatedCostUsd ?? null,
    webSearchEnabled: true,
    datetime: new Date().toISOString(),
    error: result.error ?? null,
  };
}

// ── Report-level mapping ──────────────────────────────────────────

/**
 * Map a single-engine `CheckReport` to a geoAudit output object.
 * The summary's `providers` is a one-element list (the engine that ran).
 */
export function toGeoAuditOutput(report: CheckReport): GeoAuditOutput {
  const provider = toGeoAuditProvider(report.engine);
  const rows = report.results.map((r) =>
    toGeoAuditRow(r, { provider: report.engine, model: report.model })
  );
  const summary: GeoAuditSummary = {
    promptCount: report.summary.totalQueries,
    providerCount: 1,
    totalQueries: report.summary.totalQueries,
    successCount: report.results.filter((r) => !r.error).length,
    errorCount: report.summary.errors.length,
    totalCitations: report.results.reduce(
      (acc, r) => acc + r.rawSources.length,
      0
    ),
    totalMoneySpent: report.summary.estimatedCostUsd,
    providers: [provider],
    errors: report.summary.errors.map((e) => ({
      prompt: e.query,
      provider,
      error: e.error,
    })),
  };
  return { rows, summary };
}

/**
 * Map a `MultiEngineCheckReport` (`--engine all`) to a single
 * geoAudit output object. Rows are emitted in (engine × query) order
 * to match the input file's natural ordering — engines in the order
 * the multi-runner ran them, queries in input order within each engine.
 */
export function toGeoAuditOutputMulti(
  report: MultiEngineCheckReport
): GeoAuditOutput {
  const rows: GeoAuditRow[] = [];
  let totalCitations = 0;
  let totalMoneySpent = 0;
  let successCount = 0;
  let errorCount = 0;
  const errors: GeoAuditSummary["errors"] = [];

  for (const engineId of report.engines) {
    const sub = report.perEngine[engineId];
    if (!sub) continue;
    const provider = toGeoAuditProvider(engineId);
    for (const r of sub.results) {
      rows.push(toGeoAuditRow(r, { provider: engineId, model: sub.model }));
      totalCitations += r.rawSources.length;
      if (r.error) {
        errorCount += 1;
        errors.push({ prompt: r.query, provider, error: r.error });
      } else {
        successCount += 1;
      }
    }
    totalMoneySpent += sub.summary.estimatedCostUsd;
  }

  const summary: GeoAuditSummary = {
    promptCount: report.summary.totalQueries,
    providerCount: report.engines.length,
    totalQueries: rows.length,
    successCount,
    errorCount,
    totalCitations,
    totalMoneySpent: Number(totalMoneySpent.toFixed(6)),
    providers: report.engines.map(toGeoAuditProvider),
    errors,
  };
  return { rows, summary };
}

// ── ndjson line shape ─────────────────────────────────────────────

/**
 * `--ndjson --format geo-audit` per-line shape. The runtime emits one
 * of these per query as it resolves, then a final summary line that
 * carries the geoAudit summary fields PLUS the auto-geo summary shape
 * for back-compat (consumers that key on `_summary: true` already know
 * how to read it).
 */
export function makeNdjsonGeoAuditLine(
  result: CheckQueryResult,
  opts: { provider: string; model: string }
): GeoAuditRow {
  return toGeoAuditRow(result, opts);
}

// ── helpers ───────────────────────────────────────────────────────

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
