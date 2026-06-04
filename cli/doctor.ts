import { runAllChecks } from "./checks";
import { fetchPage, parsePage } from "./fetch";
import { fetchSitemap } from "./sitemap";
import {
  renderHumanReport,
  renderJsonReport,
  renderSitemapHuman,
  renderSitemapJson,
} from "./render";
import type {
  CheckId,
  CheckResult,
  DoctorReport,
  ParsedPage,
  SitemapReport,
} from "./types";

/**
 * High-level orchestrators for `auto-geo doctor`.
 *
 * `runDoctor(url, opts)` → fetch one URL, run checks, return a report.
 * `runSitemapDoctor(sitemapUrl, opts)` → fetch sitemap, audit each URL,
 *     return an aggregate report with the most-common failing checks
 *     and the lowest-scoring pages.
 * `auditParsedPage(page)` → pure-function variant, useful for tests +
 *     for callers who already have HTML (no network).
 *
 * Exit-code semantics are surfaced via `report.scorePct` (≥75 = pass);
 * the CLI binary (`cli/bin.ts`) does the actual `process.exit` mapping
 * so this module stays import-safe.
 */

const GENERATED_BY = "auto-geo doctor";

export type RunDoctorOptions = {
  fetch?: typeof globalThis.fetch;
  userAgent?: string;
  timeoutMs?: number;
};

export type RunSitemapOptions = RunDoctorOptions & {
  /** Cap on pages audited. Default 100 (sitemaps can be huge). */
  maxPages?: number;
  /**
   * Optional per-page concurrency. Default 5 — keeps memory bounded and
   * is polite to the origin host. Set higher with caution.
   */
  concurrency?: number;
};

export type RenderOptions = {
  json?: boolean;
  colors?: boolean;
};

// ── Single page ────────────────────────────────────────────────────

export async function runDoctor(
  url: string,
  opts: RunDoctorOptions = {}
): Promise<DoctorReport> {
  const page = await fetchPage(url, opts);
  return auditParsedPage(page);
}

export function auditParsedPage(page: ParsedPage): DoctorReport {
  const checks = runAllChecks(page);
  return summarize(page.url, page.wordCount, checks);
}

/**
 * Run the doctor against an already-fetched HTML string. Convenience
 * wrapper for tests and for callers who have HTML in hand.
 */
export function auditHtml(url: string, html: string): DoctorReport {
  const page = parsePage(url, html);
  return auditParsedPage(page);
}

// ── Sitemap ────────────────────────────────────────────────────────

export async function runSitemapDoctor(
  sitemapUrl: string,
  opts: RunSitemapOptions = {}
): Promise<SitemapReport> {
  const maxPages = opts.maxPages ?? 100;
  const concurrency = Math.max(1, opts.concurrency ?? 5);

  const allUrls = await fetchSitemap(sitemapUrl, {
    fetch: opts.fetch,
    maxUrls: maxPages,
  });

  const pages: DoctorReport[] = [];
  const errors: SitemapReport["errors"] = [];

  // Simple promise-pool: walk a shared index. Bounded concurrency with
  // no extra dep. Each worker pulls the next URL until exhausted.
  let cursor = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = cursor++;
      if (i >= allUrls.length) return;
      const url = allUrls[i]!;
      try {
        const report = await runDoctor(url, opts);
        pages.push(report);
      } catch (err) {
        errors.push({
          url,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, allUrls.length) }, () =>
      worker()
    )
  );

  // Aggregate failing checks across all successful pages.
  const failingMap = new Map<CheckId, { name: string; count: number }>();
  for (const p of pages) {
    for (const c of p.checks) {
      if (c.pass) continue;
      const cur = failingMap.get(c.id) ?? { name: c.name, count: 0 };
      cur.count++;
      failingMap.set(c.id, cur);
    }
  }
  const failingChecks = Array.from(failingMap.entries())
    .map(([id, v]) => ({ id, name: v.name, failureCount: v.count }))
    .sort((a, b) => b.failureCount - a.failureCount);

  const meanScorePct =
    pages.length > 0
      ? Math.round(pages.reduce((acc, p) => acc + p.scorePct, 0) / pages.length)
      : 0;

  return {
    sitemap: sitemapUrl,
    total: allUrls.length,
    pages,
    meanScorePct,
    failingChecks,
    errors,
  };
}

// ── Rendering glue ─────────────────────────────────────────────────

export function renderReport(
  report: DoctorReport,
  opts: RenderOptions = {}
): string {
  return opts.json
    ? renderJsonReport(report)
    : renderHumanReport(report, { colors: !!opts.colors });
}

export function renderSitemapReport(
  report: SitemapReport,
  opts: RenderOptions = {}
): string {
  return opts.json
    ? renderSitemapJson(report)
    : renderSitemapHuman(report, { colors: !!opts.colors });
}

// ── Internals ──────────────────────────────────────────────────────

function summarize(
  url: string,
  wordCount: number,
  checks: CheckResult[]
): DoctorReport {
  const score = checks.filter((c) => c.pass).length;
  const total = checks.length;
  const scorePct = total === 0 ? 0 : Math.round((score / total) * 100);
  const topFixes = checks
    .filter((c) => !c.pass)
    .sort((a, b) => a.citationImpactRank - b.citationImpactRank)
    .slice(0, 3);
  return {
    url,
    wordCount,
    score,
    total,
    scorePct,
    checks,
    topFixes,
    generatedBy: GENERATED_BY,
  };
}
