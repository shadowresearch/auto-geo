import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addPrompts,
  checkReportFileName,
  diffCitedQueries,
  ensureWorkspace,
  findWorkspace,
  listCheckRuns,
  loadPrompts,
  parsePrompts,
  removePrompt,
  saveCheckReport,
  summarizeSavedRun,
  workspaceAt,
  PROMPTS_TEMPLATE,
  type CheckRunSummary,
  type SavedCheckEnvelope,
} from "../cli/workspace";
import type { CheckReport, MultiEngineCheckReport } from "../cli/check";

/**
 * Tests for the `.auto-geo/` workspace (v0.7.0) — discovery, tracked
 * prompts, and the saved check-run history that `auto-geo history`
 * trends. Every test gets its own tmpdir.
 */

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "auto-geo-ws-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

// ── Fixtures ──────────────────────────────────────────────────────

function makeSingleReport(overrides: Partial<CheckReport> = {}): CheckReport {
  const base: CheckReport = {
    domain: "shadow.inc",
    engine: "perplexity",
    model: "sonar",
    results: [
      {
        query: "what is GEO",
        cited: true,
        citations: [
          {
            url: "https://shadow.inc/resources/what-is-geo",
            rank: 1,
            totalCitationsForQuery: 3,
          },
        ],
        rawSources: [],
        answer: "GEO is …",
        fanOutQueries: [],
        usage: { estimatedCostUsd: 0.01 } as never,
      },
      {
        query: "best media monitoring tools",
        cited: false,
        citations: [],
        rawSources: [],
        answer: "…",
        fanOutQueries: [],
      },
    ],
    summary: {
      citedQueryCount: 1,
      totalQueries: 2,
      coveragePct: 50,
      totalCitations: 1,
      estimatedCostUsd: 0.01,
      errors: [],
    },
    generatedBy: "auto-geo check",
  };
  return { ...base, ...overrides };
}

function makeMultiReport(): MultiEngineCheckReport {
  const single = makeSingleReport();
  return {
    domain: "shadow.inc",
    engines: ["perplexity", "openai"],
    skippedEngines: [],
    perEngine: { perplexity: single, openai: { ...single, engine: "openai" } },
    acrossEngines: [
      {
        query: "what is GEO",
        citedByAny: true,
        citedByEngines: ["perplexity"],
        ranByEngines: ["perplexity", "openai"],
      },
      {
        query: "best media monitoring tools",
        citedByAny: false,
        citedByEngines: [],
        ranByEngines: ["perplexity", "openai"],
      },
    ],
    summary: {
      totalQueries: 2,
      citedByAnyCount: 1,
      unionCoveragePct: 50,
      meanCoveragePct: 50,
      estimatedCostUsd: 0.02,
    },
    generatedBy: "auto-geo check",
  };
}

// ── Discovery ─────────────────────────────────────────────────────

describe("findWorkspace / ensureWorkspace", () => {
  it("returns null when no .auto-geo exists anywhere up the tree", () => {
    expect(findWorkspace(root)).toBeNull();
  });

  it("finds the workspace from a nested subdirectory", async () => {
    await ensureWorkspace(root);
    const nested = join(root, "a", "b", "c");
    mkdirSync(nested, { recursive: true });
    const ws = findWorkspace(nested);
    expect(ws).not.toBeNull();
    expect(ws!.root).toBe(root);
    expect(ws!.dir).toBe(join(root, ".auto-geo"));
  });

  it("creates the full layout on first ensure", async () => {
    const { workspace, created } = await ensureWorkspace(root);
    expect(created).toBe(true);
    expect(existsSync(workspace.promptsPath)).toBe(true);
    expect(existsSync(workspace.checksDir)).toBe(true);
    expect(readFileSync(workspace.promptsPath, "utf8")).toBe(PROMPTS_TEMPLATE);
  });

  it("is idempotent — second ensure finds, never clobbers", async () => {
    const first = await ensureWorkspace(root);
    await addPrompts(first.workspace, ["keep me"]);
    const second = await ensureWorkspace(root);
    expect(second.created).toBe(false);
    expect(await loadPrompts(second.workspace)).toEqual(["keep me"]);
  });

  it("backfills checks/ and prompts.txt into a bare .auto-geo dir", async () => {
    mkdirSync(join(root, ".auto-geo"));
    const { workspace, created } = await ensureWorkspace(root);
    expect(created).toBe(false);
    expect(existsSync(workspace.checksDir)).toBe(true);
    expect(existsSync(workspace.promptsPath)).toBe(true);
  });
});

// ── Prompts ───────────────────────────────────────────────────────

describe("parsePrompts", () => {
  it("skips comments and blank lines, trims entries", () => {
    expect(parsePrompts("# c\n\n  a  \nb\n# d\n")).toEqual(["a", "b"]);
  });
});

describe("addPrompts / loadPrompts / removePrompt", () => {
  it("appends prompts and dedupes case-insensitively", async () => {
    const { workspace } = await ensureWorkspace(root);
    const r1 = await addPrompts(workspace, ["What is GEO", "what is geo", "b"]);
    expect(r1.added).toEqual(["What is GEO", "b"]);
    expect(r1.skipped).toEqual(["what is geo"]);
    const r2 = await addPrompts(workspace, ["WHAT IS GEO"]);
    expect(r2.added).toEqual([]);
    expect(r2.skipped).toEqual(["WHAT IS GEO"]);
    expect(await loadPrompts(workspace)).toEqual(["What is GEO", "b"]);
  });

  it("creates the file (with template header) when adding to a fresh dir", async () => {
    const workspace = workspaceAt(root);
    mkdirSync(workspace.dir, { recursive: true });
    await addPrompts(workspace, ["first"]);
    const body = readFileSync(workspace.promptsPath, "utf8");
    expect(body).toContain("# auto-geo tracked prompts");
    expect(body).toContain("first");
  });

  it("loadPrompts returns [] when the file is missing", async () => {
    const workspace = workspaceAt(root);
    expect(await loadPrompts(workspace)).toEqual([]);
  });

  it("removes by 1-based index, preserving comments", async () => {
    const { workspace } = await ensureWorkspace(root);
    await addPrompts(workspace, ["a", "b", "c"]);
    const result = await removePrompt(workspace, "2");
    expect(result).toEqual({ removed: "b" });
    expect(await loadPrompts(workspace)).toEqual(["a", "c"]);
    expect(readFileSync(workspace.promptsPath, "utf8")).toContain(
      "# auto-geo tracked prompts"
    );
  });

  it("removes by exact text, case-insensitively", async () => {
    const { workspace } = await ensureWorkspace(root);
    await addPrompts(workspace, ["What is GEO", "b"]);
    const result = await removePrompt(workspace, "what is geo");
    expect(result).toEqual({ removed: "What is GEO" });
    expect(await loadPrompts(workspace)).toEqual(["b"]);
  });

  it("errors on out-of-range index and unknown text", async () => {
    const { workspace } = await ensureWorkspace(root);
    await addPrompts(workspace, ["a"]);
    expect(await removePrompt(workspace, "5")).toMatchObject({
      error: expect.stringContaining("out of range"),
    });
    expect(await removePrompt(workspace, "nope")).toMatchObject({
      error: expect.stringContaining("no tracked prompt matches"),
    });
  });

  it("errors when there is no prompts file at all", async () => {
    const workspace = workspaceAt(root);
    expect(await removePrompt(workspace, "1")).toMatchObject({
      error: expect.stringContaining("no tracked prompts"),
    });
  });
});

// ── Check history ─────────────────────────────────────────────────

describe("checkReportFileName", () => {
  it("is filesystem-safe and sorts chronologically", () => {
    const a = checkReportFileName(
      new Date("2026-06-10T13:22:05.123Z"),
      "perplexity"
    );
    expect(a).toBe("2026-06-10T13-22-05--perplexity.json");
    const b = checkReportFileName(new Date("2026-06-11T01:00:00Z"), "all");
    expect(b > a).toBe(true);
  });

  it("sanitizes engine names", () => {
    expect(
      checkReportFileName(new Date("2026-01-01T00:00:00Z"), "We?ird")
    ).toBe("2026-01-01T00-00-00--we-ird.json");
  });
});

describe("saveCheckReport / listCheckRuns", () => {
  it("round-trips a single-engine run", async () => {
    const { workspace } = await ensureWorkspace(root);
    const path = await saveCheckReport(workspace, makeSingleReport(), {
      now: new Date("2026-06-10T13:22:05Z"),
    });
    expect(path).toContain("2026-06-10T13-22-05--perplexity.json");
    const runs = await listCheckRuns(workspace);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      engine: "perplexity",
      domain: "shadow.inc",
      totalQueries: 2,
      citedQueryCount: 1,
      coveragePct: 50,
      citedQueries: ["what is GEO"],
    });
  });

  it("round-trips a multi-engine run as engine 'all'", async () => {
    const { workspace } = await ensureWorkspace(root);
    await saveCheckReport(workspace, makeMultiReport(), {
      now: new Date("2026-06-10T14:00:00Z"),
    });
    const runs = await listCheckRuns(workspace);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      engine: "all",
      engines: ["perplexity", "openai"],
      coveragePct: 50,
      citedQueries: ["what is GEO"],
    });
  });

  it("sorts runs oldest-first and skips malformed files", async () => {
    const { workspace } = await ensureWorkspace(root);
    await saveCheckReport(workspace, makeSingleReport(), {
      now: new Date("2026-06-11T00:00:00Z"),
    });
    await saveCheckReport(workspace, makeSingleReport(), {
      now: new Date("2026-06-10T00:00:00Z"),
    });
    writeFileSync(join(workspace.checksDir, "garbage.json"), "{not json");
    writeFileSync(join(workspace.checksDir, "readme.txt"), "ignored");
    const runs = await listCheckRuns(workspace);
    expect(runs).toHaveLength(2);
    expect(runs[0]!.savedAt < runs[1]!.savedAt).toBe(true);
  });

  it("accepts a bare report dropped into checks/ by hand", async () => {
    const { workspace } = await ensureWorkspace(root);
    writeFileSync(
      join(workspace.checksDir, "manual.json"),
      JSON.stringify(makeSingleReport())
    );
    const runs = await listCheckRuns(workspace);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.engine).toBe("perplexity");
  });

  it("returns [] when checks/ does not exist", async () => {
    const workspace = workspaceAt(root);
    expect(await listCheckRuns(workspace)).toEqual([]);
  });
});

describe("summarizeSavedRun / diffCitedQueries", () => {
  function summaryWith(cited: string[]): CheckRunSummary {
    const envelope: SavedCheckEnvelope = {
      savedAt: "2026-06-10T00:00:00Z",
      kind: "single",
      report: makeSingleReport({
        results: cited.map((q) => ({
          query: q,
          cited: true,
          citations: [],
          rawSources: [],
          answer: "",
          fanOutQueries: [],
        })),
      }),
    };
    return summarizeSavedRun(envelope, "/x/a.json", "a.json");
  }

  it("computes newly-cited and lost queries case-insensitively", () => {
    const prev = summaryWith(["What is GEO", "old win"]);
    const next = summaryWith(["what is geo", "new win"]);
    const { newlyCited, lost } = diffCitedQueries(prev, next);
    expect(newlyCited).toEqual(["new win"]);
    expect(lost).toEqual(["old win"]);
  });
});
