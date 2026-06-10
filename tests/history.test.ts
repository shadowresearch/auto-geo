import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  parseHistoryArgs,
  renderHistoryHuman,
  renderHistoryJson,
  runHistory,
  DEFAULT_HISTORY_LIMIT,
} from "../cli/history";
import { ensureWorkspace, saveCheckReport } from "../cli/workspace";
import type { CheckReport } from "../cli/check";

/**
 * Tests for `auto-geo history` (v0.7.0). Saved runs are produced via
 * the real `saveCheckReport` so the round-trip mirrors production.
 */

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "auto-geo-history-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function makeReport(opts: {
  engine?: string;
  cited: string[];
  notCited?: string[];
  costUsd?: number;
}): CheckReport {
  const cited = opts.cited.map((query) => ({
    query,
    cited: true,
    citations: [
      {
        url: "https://shadow.inc/x",
        rank: 1,
        totalCitationsForQuery: 1,
      },
    ],
    rawSources: [],
    answer: "",
    fanOutQueries: [],
  }));
  const notCited = (opts.notCited ?? []).map((query) => ({
    query,
    cited: false,
    citations: [],
    rawSources: [],
    answer: "",
    fanOutQueries: [],
  }));
  const results = [...cited, ...notCited];
  const coveragePct =
    results.length === 0
      ? 0
      : Math.round((cited.length / results.length) * 100);
  return {
    domain: "shadow.inc",
    engine: opts.engine ?? "perplexity",
    model: "sonar",
    results,
    summary: {
      citedQueryCount: cited.length,
      totalQueries: results.length,
      coveragePct,
      totalCitations: cited.length,
      estimatedCostUsd: opts.costUsd ?? 0.05,
      errors: [],
    },
    generatedBy: "auto-geo check",
  };
}

// ── Parser ────────────────────────────────────────────────────────

describe("parseHistoryArgs", () => {
  it("defaults", () => {
    expect(parseHistoryArgs([])).toEqual({
      command: "history",
      limit: DEFAULT_HISTORY_LIMIT,
      json: false,
      color: true,
      narrow: false,
    });
  });

  it("parses --engine / --limit / output flags", () => {
    const args = parseHistoryArgs([
      "--engine",
      "all",
      "--limit",
      "3",
      "--json",
      "--no-color",
      "--narrow",
    ]);
    expect(args.engine).toBe("all");
    expect(args.limit).toBe(3);
    expect(args.json).toBe(true);
    expect(args.color).toBe(false);
    expect(args.narrow).toBe(true);
  });

  it("rejects bad input", () => {
    expect(() => parseHistoryArgs(["--limit", "0"])).toThrow(
      /positive integer/
    );
    expect(() => parseHistoryArgs(["--limit"])).toThrow(/requires a value/);
    expect(() => parseHistoryArgs(["--nope"])).toThrow(/unknown flag/);
    expect(() => parseHistoryArgs(["positional"])).toThrow(
      /unexpected positional/
    );
  });
});

// ── Runner ────────────────────────────────────────────────────────

describe("runHistory", () => {
  it("reports no workspace when none exists", async () => {
    const outcome = await runHistory({ limit: 10 }, root);
    expect(outcome).toMatchObject({
      workspaceDir: null,
      rows: [],
      totalRuns: 0,
      delta: null,
    });
  });

  it("rolls up runs with per-engine coverage trends", async () => {
    const { workspace } = await ensureWorkspace(root);
    await saveCheckReport(
      workspace,
      makeReport({ cited: ["a"], notCited: ["b"] }),
      {
        now: new Date("2026-06-01T00:00:00Z"),
      }
    );
    await saveCheckReport(workspace, makeReport({ cited: ["a", "b"] }), {
      now: new Date("2026-06-02T00:00:00Z"),
    });
    // A different engine in between must not pollute the perplexity trend.
    await saveCheckReport(
      workspace,
      makeReport({ engine: "gemini", cited: [], notCited: ["a", "b"] }),
      { now: new Date("2026-06-01T12:00:00Z") }
    );

    const outcome = await runHistory({ limit: 10 }, root);
    expect(outcome.totalRuns).toBe(3);
    const [first, geminiRun, second] = outcome.rows;
    expect(first!.coverageDeltaPct).toBeUndefined();
    expect(geminiRun!.engine).toBe("gemini");
    expect(geminiRun!.coverageDeltaPct).toBeUndefined();
    expect(second!.coveragePct).toBe(100);
    expect(second!.coverageDeltaPct).toBe(50);
  });

  it("computes the latest delta against the same-engine predecessor", async () => {
    const { workspace } = await ensureWorkspace(root);
    await saveCheckReport(
      workspace,
      makeReport({ cited: ["old win", "kept"], notCited: ["miss"] }),
      { now: new Date("2026-06-01T00:00:00Z") }
    );
    await saveCheckReport(
      workspace,
      makeReport({ cited: ["kept", "new win"], notCited: ["old win"] }),
      { now: new Date("2026-06-02T00:00:00Z") }
    );
    const outcome = await runHistory({ limit: 10 }, root);
    expect(outcome.delta).toMatchObject({
      engine: "perplexity",
      newlyCited: ["new win"],
      lost: ["old win"],
    });
  });

  it("filters by --engine and applies --limit keeping the newest", async () => {
    const { workspace } = await ensureWorkspace(root);
    for (let day = 1; day <= 4; day++) {
      await saveCheckReport(workspace, makeReport({ cited: ["a"] }), {
        now: new Date(`2026-06-0${day}T00:00:00Z`),
      });
    }
    await saveCheckReport(
      workspace,
      makeReport({ engine: "gemini", cited: ["a"] }),
      { now: new Date("2026-06-05T00:00:00Z") }
    );

    const filtered = await runHistory({ engine: "perplexity", limit: 2 }, root);
    expect(filtered.totalRuns).toBe(4);
    expect(filtered.rows).toHaveLength(2);
    expect(filtered.rows.every((r) => r.engine === "perplexity")).toBe(true);
    expect(filtered.rows[1]!.savedAt > filtered.rows[0]!.savedAt).toBe(true);
    expect(filtered.rows[1]!.savedAt).toContain("2026-06-04");
  });
});

// ── Renderers ─────────────────────────────────────────────────────

describe("renderHistoryHuman", () => {
  it("nudges toward init/check when there is no workspace", async () => {
    const outcome = await runHistory({ limit: 10 }, root);
    const out = renderHistoryHuman(outcome, { colors: false, cwd: root });
    expect(out).toContain("No .auto-geo workspace found");
    expect(out).toContain("auto-geo init");
  });

  it("nudges toward check when the workspace has no runs", async () => {
    await ensureWorkspace(root);
    const outcome = await runHistory({ limit: 10 }, root);
    const out = renderHistoryHuman(outcome, { colors: false, cwd: root });
    expect(out).toContain("No saved check runs yet");
    expect(out).toContain("auto-geo check");
  });

  it("renders the run table with trends and the citation delta", async () => {
    const { workspace } = await ensureWorkspace(root);
    await saveCheckReport(
      workspace,
      makeReport({ cited: ["old win"], notCited: ["new win"] }),
      { now: new Date("2026-06-01T08:30:00Z") }
    );
    await saveCheckReport(
      workspace,
      makeReport({ cited: ["new win"], notCited: ["old win"] }),
      { now: new Date("2026-06-02T09:15:00Z") }
    );
    const outcome = await runHistory({ limit: 10 }, root);
    const out = renderHistoryHuman(outcome, { colors: false, cwd: root });
    expect(out).toContain("2026-06-01 08:30");
    expect(out).toContain("2026-06-02 09:15");
    expect(out).toContain("perplexity");
    expect(out).toContain("50%");
    expect(out).toContain("1/2 cited");
    expect(out).toContain("Since last run");
    expect(out).toContain("newly cited  new win");
    expect(out).toContain("lost         old win");
    expect(out).toContain("2 runs");
  });

  it("notes hidden older runs when --limit truncates", async () => {
    const { workspace } = await ensureWorkspace(root);
    for (let day = 1; day <= 3; day++) {
      await saveCheckReport(workspace, makeReport({ cited: ["a"] }), {
        now: new Date(`2026-06-0${day}T00:00:00Z`),
      });
    }
    const outcome = await runHistory({ limit: 2 }, root);
    const out = renderHistoryHuman(outcome, { colors: false, cwd: root });
    expect(out).toContain("1 older run not shown");
  });

  it("renderHistoryJson round-trips rows and delta", async () => {
    const { workspace } = await ensureWorkspace(root);
    await saveCheckReport(workspace, makeReport({ cited: ["a"] }), {
      now: new Date("2026-06-01T00:00:00Z"),
    });
    const outcome = await runHistory({ limit: 10 }, root);
    const parsed = JSON.parse(renderHistoryJson(outcome));
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].engine).toBe("perplexity");
    expect(parsed.delta).toBeNull();
  });
});
