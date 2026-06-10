import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { CheckReport, MultiEngineCheckReport } from "./check";

/**
 * The `.auto-geo/` workspace — local, file-based state for the GEO
 * engine. Introduced in v0.7.0.
 *
 * Layout (all under the project root, next to `auto-geo.config.json`):
 *
 *   .auto-geo/
 *     prompts.txt    — tracked prompts (one per line, `#` comments OK).
 *                      `check` runs these when no --query/--queries-file
 *                      is passed; managed via `auto-geo prompts`.
 *     checks/        — every `check` run saved as one JSON file, so
 *                      coverage is trackable over time (`auto-geo history`).
 *
 * Design constraints:
 *   - Plain text + JSON only. The workspace is meant to be committed to
 *     git — diffs of prompts.txt and checks/*.json ARE the audit trail.
 *   - Discovery walks up from cwd (same contract as `loadConfig` /
 *     `loadEnvFiles`) so subdirectory invocations find the project
 *     workspace.
 *   - No secrets, ever. Keys stay in .env.local.
 */

// ── Names + types ──────────────────────────────────────────────────

export const WORKSPACE_DIR_NAME = ".auto-geo";
export const PROMPTS_FILE_NAME = "prompts.txt";
export const CHECKS_DIR_NAME = "checks";

export type Workspace = {
  /** Project root — the directory that contains `.auto-geo/`. */
  root: string;
  /** Absolute path to `.auto-geo/`. */
  dir: string;
  /** Absolute path to `.auto-geo/prompts.txt`. */
  promptsPath: string;
  /** Absolute path to `.auto-geo/checks/`. */
  checksDir: string;
};

/** Build the Workspace record for a given project root. */
export function workspaceAt(root: string): Workspace {
  const dir = join(resolve(root), WORKSPACE_DIR_NAME);
  return {
    root: resolve(root),
    dir,
    promptsPath: join(dir, PROMPTS_FILE_NAME),
    checksDir: join(dir, CHECKS_DIR_NAME),
  };
}

/**
 * Walk up from `cwd` looking for the first directory that contains
 * `.auto-geo/`. Returns null when none exists — callers decide whether
 * that's an error (`prompts list`) or a create-on-demand (`prompts add`).
 */
export function findWorkspace(cwd: string = process.cwd()): Workspace | null {
  let dir = resolve(cwd);
  while (true) {
    if (existsSync(join(dir, WORKSPACE_DIR_NAME))) return workspaceAt(dir);
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Find the nearest workspace, or create one at `cwd` if none exists
 * anywhere up the tree. Creation scaffolds the full layout: the
 * directory, a templated prompts.txt, and the checks/ dir.
 */
export async function ensureWorkspace(
  cwd: string = process.cwd()
): Promise<{ workspace: Workspace; created: boolean }> {
  const existing = findWorkspace(cwd);
  if (existing) {
    // Backfill pieces that may be missing (e.g. a hand-made .auto-geo
    // dir, or a pre-checks-era workspace).
    await mkdir(existing.checksDir, { recursive: true });
    if (!existsSync(existing.promptsPath)) {
      await writeFile(existing.promptsPath, PROMPTS_TEMPLATE, "utf8");
    }
    return { workspace: existing, created: false };
  }
  const workspace = workspaceAt(cwd);
  await mkdir(workspace.checksDir, { recursive: true });
  await writeFile(workspace.promptsPath, PROMPTS_TEMPLATE, "utf8");
  return { workspace, created: true };
}

// ── Tracked prompts ────────────────────────────────────────────────

export const PROMPTS_TEMPLATE = `# auto-geo tracked prompts
#
# One prompt per line — the questions you want AI engines to answer by
# citing YOUR domain. \`auto-geo check\` runs every prompt in this file
# when invoked without --query / --queries-file, and \`auto-geo history\`
# tracks how coverage changes over time.
#
# Manage from the CLI:
#   auto-geo prompts add "best media monitoring tools"
#   auto-geo prompts list
#   auto-geo prompts rm 2
#
# Lines starting with # are ignored.
`;

/**
 * Parse a prompts file body into the active prompt list. Blank lines
 * and `#` comments are skipped; surviving lines are trimmed.
 */
export function parsePrompts(body: string): string[] {
  const out: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) out.push(trimmed);
  }
  return out;
}

/**
 * Load tracked prompts. Returns [] when the file doesn't exist — a
 * missing prompts file is "no prompts", not an error.
 */
export async function loadPrompts(ws: Workspace): Promise<string[]> {
  if (!existsSync(ws.promptsPath)) return [];
  return parsePrompts(await readFile(ws.promptsPath, "utf8"));
}

/**
 * Append prompts to the tracked set. Duplicates (case-insensitive,
 * trimmed) are skipped — both against the existing file and within the
 * batch itself. Appending preserves the user's comments and ordering;
 * we never rewrite lines we didn't add.
 */
export async function addPrompts(
  ws: Workspace,
  toAdd: string[]
): Promise<{ added: string[]; skipped: string[] }> {
  await mkdir(ws.dir, { recursive: true });
  const body = existsSync(ws.promptsPath)
    ? await readFile(ws.promptsPath, "utf8")
    : PROMPTS_TEMPLATE;
  const seen = new Set(parsePrompts(body).map((p) => p.toLowerCase()));
  const added: string[] = [];
  const skipped: string[] = [];
  for (const raw of toAdd) {
    const prompt = raw.trim();
    if (!prompt) continue;
    const key = prompt.toLowerCase();
    if (seen.has(key)) {
      skipped.push(prompt);
      continue;
    }
    seen.add(key);
    added.push(prompt);
  }
  if (added.length > 0) {
    const sep = body.length === 0 || body.endsWith("\n") ? "" : "\n";
    await writeFile(
      ws.promptsPath,
      body + sep + added.join("\n") + "\n",
      "utf8"
    );
  }
  return { added, skipped };
}

/**
 * Remove one tracked prompt by 1-based index (as shown by `prompts
 * list`) or by exact text (case-insensitive, trimmed). Rewrites the
 * file dropping ONLY the matched line — comments, blank lines, and
 * every other prompt stay byte-identical.
 */
export async function removePrompt(
  ws: Workspace,
  selector: string
): Promise<{ removed: string } | { error: string }> {
  if (!existsSync(ws.promptsPath)) {
    return { error: "no tracked prompts — run `auto-geo prompts add` first" };
  }
  const body = await readFile(ws.promptsPath, "utf8");
  const lines = body.split(/\r?\n/);

  // Map active-prompt ordinals to raw line indices.
  const promptLineIndices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();
    if (trimmed && !trimmed.startsWith("#")) promptLineIndices.push(i);
  }
  if (promptLineIndices.length === 0) {
    return { error: "no tracked prompts to remove" };
  }

  let targetRawIndex: number | undefined;
  if (/^\d+$/.test(selector.trim())) {
    const ordinal = Number(selector.trim());
    if (ordinal < 1 || ordinal > promptLineIndices.length) {
      return {
        error: `index ${ordinal} is out of range (1-${promptLineIndices.length})`,
      };
    }
    targetRawIndex = promptLineIndices[ordinal - 1];
  } else {
    const needle = selector.trim().toLowerCase();
    targetRawIndex = promptLineIndices.find(
      (i) => lines[i]!.trim().toLowerCase() === needle
    );
    if (targetRawIndex === undefined) {
      return {
        error: `no tracked prompt matches ${JSON.stringify(selector)} — run \`auto-geo prompts list\` to see indices`,
      };
    }
  }

  const removed = lines[targetRawIndex!]!.trim();
  lines.splice(targetRawIndex!, 1);
  await writeFile(ws.promptsPath, lines.join("\n"), "utf8");
  return { removed };
}

// ── Check-run history ──────────────────────────────────────────────

/**
 * On-disk envelope for a saved check run. The raw report shape stays
 * exactly what `check --json` emits; the envelope adds the metadata
 * `history` needs without touching the report contract.
 */
export type SavedCheckEnvelope = {
  savedAt: string;
  kind: "single" | "multi";
  report: CheckReport | MultiEngineCheckReport;
};

/**
 * One row of `auto-geo history` — the per-run roll-up extracted from a
 * saved report, normalized across single- and multi-engine runs.
 */
export type CheckRunSummary = {
  /** Absolute path of the saved file. */
  path: string;
  /** File name (stable sort key — starts with the timestamp). */
  file: string;
  savedAt: string;
  domain: string;
  /** Engine id, or `"all"` for multi-engine runs. */
  engine: string;
  /** Engine ids that actually ran (multi-engine runs only). */
  engines?: string[];
  totalQueries: number;
  citedQueryCount: number;
  /** Single-engine coverage, or union coverage for multi runs. */
  coveragePct: number;
  estimatedCostUsd: number;
  /** Queries cited in this run — the delta input for `history`. */
  citedQueries: string[];
};

/**
 * Filesystem-safe timestamped file name for a saved run:
 *   `2026-06-10T13-22-05--perplexity.json`
 * Colons are not legal on every filesystem, so the time keeps dashes.
 * Lexicographic order == chronological order.
 */
export function checkReportFileName(savedAt: Date, engine: string): string {
  const ts = savedAt
    .toISOString()
    .replace(/\.\d{3}Z$/, "")
    .replace(/:/g, "-");
  const safeEngine = engine.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
  return `${ts}--${safeEngine}.json`;
}

function isMultiReport(
  report: CheckReport | MultiEngineCheckReport
): report is MultiEngineCheckReport {
  return "perEngine" in report;
}

/**
 * Persist a check run into `.auto-geo/checks/`. Returns the absolute
 * path written. `now` is injectable for tests.
 */
export async function saveCheckReport(
  ws: Workspace,
  report: CheckReport | MultiEngineCheckReport,
  opts: { now?: Date } = {}
): Promise<string> {
  await mkdir(ws.checksDir, { recursive: true });
  const savedAt = opts.now ?? new Date();
  const multi = isMultiReport(report);
  const engine = multi ? "all" : report.engine;
  const envelope: SavedCheckEnvelope = {
    savedAt: savedAt.toISOString(),
    kind: multi ? "multi" : "single",
    report,
  };
  const path = join(ws.checksDir, checkReportFileName(savedAt, engine));
  await writeFile(path, JSON.stringify(envelope, null, 2) + "\n", "utf8");
  return path;
}

/**
 * Extract the normalized roll-up from a saved envelope. Exported for
 * tests; `listCheckRuns` is the consumer.
 */
export function summarizeSavedRun(
  envelope: SavedCheckEnvelope,
  path: string,
  file: string
): CheckRunSummary {
  const { report } = envelope;
  if (isMultiReport(report)) {
    return {
      path,
      file,
      savedAt: envelope.savedAt,
      domain: report.domain,
      engine: "all",
      engines: report.engines,
      totalQueries: report.summary.totalQueries,
      citedQueryCount: report.summary.citedByAnyCount,
      coveragePct: report.summary.unionCoveragePct,
      estimatedCostUsd: report.summary.estimatedCostUsd,
      citedQueries: report.acrossEngines
        .filter((r) => r.citedByAny)
        .map((r) => r.query),
    };
  }
  return {
    path,
    file,
    savedAt: envelope.savedAt,
    domain: report.domain,
    engine: report.engine,
    totalQueries: report.summary.totalQueries,
    citedQueryCount: report.summary.citedQueryCount,
    coveragePct: report.summary.coveragePct,
    estimatedCostUsd: report.summary.estimatedCostUsd,
    citedQueries: report.results.filter((r) => r.cited).map((r) => r.query),
  };
}

/**
 * List every saved check run, oldest first. Files that fail to parse
 * (hand-edited, truncated, foreign) are skipped silently — history
 * should degrade, not crash. Also accepts bare reports (a `check
 * --out` artifact dropped into checks/ by hand); their `savedAt` falls
 * back to the file's mtime.
 */
export async function listCheckRuns(ws: Workspace): Promise<CheckRunSummary[]> {
  if (!existsSync(ws.checksDir)) return [];
  const files = (await readdir(ws.checksDir)).filter((f) =>
    f.endsWith(".json")
  );
  const out: CheckRunSummary[] = [];
  for (const file of files) {
    const path = join(ws.checksDir, file);
    try {
      const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
      if (!parsed || typeof parsed !== "object") continue;
      const obj = parsed as Record<string, unknown>;
      let envelope: SavedCheckEnvelope;
      if (typeof obj.savedAt === "string" && obj.report) {
        envelope = obj as unknown as SavedCheckEnvelope;
      } else if (obj.summary && (obj.results || obj.perEngine)) {
        // Bare report — wrap it on the fly.
        const mtime = (await stat(path)).mtime;
        envelope = {
          savedAt: mtime.toISOString(),
          kind: obj.perEngine ? "multi" : "single",
          report: obj as unknown as CheckReport | MultiEngineCheckReport,
        };
      } else {
        continue;
      }
      out.push(summarizeSavedRun(envelope, path, file));
    } catch {
      // Unreadable or malformed — skip.
    }
  }
  out.sort((a, b) =>
    a.savedAt === b.savedAt
      ? a.file.localeCompare(b.file)
      : a.savedAt.localeCompare(b.savedAt)
  );
  return out;
}

/**
 * Compare two runs' cited-query sets. `newlyCited` = cited now but not
 * before; `lost` = cited before but not now. Comparison is on exact
 * query text (case-insensitive) — engines are the caller's concern
 * (compare like with like).
 */
export function diffCitedQueries(
  previous: CheckRunSummary,
  latest: CheckRunSummary
): { newlyCited: string[]; lost: string[] } {
  const prev = new Set(previous.citedQueries.map((q) => q.toLowerCase()));
  const next = new Set(latest.citedQueries.map((q) => q.toLowerCase()));
  return {
    newlyCited: latest.citedQueries.filter((q) => !prev.has(q.toLowerCase())),
    lost: previous.citedQueries.filter((q) => !next.has(q.toLowerCase())),
  };
}
