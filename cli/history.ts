import { relative } from "node:path";
import {
  bold,
  cyan,
  dim,
  glyphs,
  green,
  header,
  indent,
  red,
  yellow,
  type UiOptions,
} from "./ui";
import {
  diffCitedQueries,
  findWorkspace,
  listCheckRuns,
  type CheckRunSummary,
} from "./workspace";

/**
 * `auto-geo history` — citation coverage over time. Introduced in
 * v0.7.0.
 *
 * Reads the saved runs in `.auto-geo/checks/` (written automatically by
 * `auto-geo check`) and renders:
 *   - a run-by-run table (date, engine, coverage, queries, cost), with
 *     a trend mark against the previous run of the SAME engine
 *     selector — comparing perplexity to gemini coverage tells you
 *     nothing, so trends are computed engine-like-for-like;
 *   - the citation delta for the latest run vs the previous same-engine
 *     run: which queries were newly cited, which were lost.
 *
 * Flags: --engine <name> filters to one engine selector, --limit N caps
 * the rows shown (default 15, newest kept), --json emits the rows +
 * delta machine-readably.
 */

// ── Parsed args ───────────────────────────────────────────────────

export type HistoryArgs = {
  command: "history";
  engine?: string;
  limit: number;
  json: boolean;
  color: boolean;
  narrow: boolean;
};

export const DEFAULT_HISTORY_LIMIT = 15;

export function parseHistoryArgs(argv: string[]): HistoryArgs {
  const args: HistoryArgs = {
    command: "history",
    limit: DEFAULT_HISTORY_LIMIT,
    json: false,
    color: true,
    narrow: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const requireValue = (flag: string): string => {
      const next = argv[++i];
      if (next === undefined) throw new Error(`${flag} requires a value`);
      return next;
    };
    if (a === "--json") args.json = true;
    else if (a === "--no-color") args.color = false;
    else if (a === "--narrow") args.narrow = true;
    else if (a === "--engine") args.engine = requireValue("--engine");
    else if (a === "--limit") {
      const n = Number(requireValue("--limit"));
      if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n))
        throw new Error("--limit requires a positive integer");
      args.limit = n;
    } else if (a.startsWith("--")) {
      throw new Error(`unknown flag: ${a}`);
    } else {
      throw new Error(`unexpected positional argument: ${a}`);
    }
  }
  return args;
}

// ── Runner ────────────────────────────────────────────────────────

export type HistoryRow = CheckRunSummary & {
  /**
   * Coverage delta in percentage points vs the previous run with the
   * same engine selector; undefined for the first run of an engine.
   */
  coverageDeltaPct?: number;
};

export type HistoryOutcome = {
  workspaceDir: string | null;
  /** All matching runs, oldest first, after --engine filter + --limit. */
  rows: HistoryRow[];
  /** Total matching runs before --limit was applied. */
  totalRuns: number;
  /**
   * Delta of the latest run vs the previous run of the same engine
   * selector. Null when there's nothing to compare.
   */
  delta: {
    engine: string;
    previousSavedAt: string;
    latestSavedAt: string;
    newlyCited: string[];
    lost: string[];
  } | null;
};

export async function runHistory(
  parsed: Pick<HistoryArgs, "engine" | "limit">,
  cwd: string = process.cwd()
): Promise<HistoryOutcome> {
  const workspace = findWorkspace(cwd);
  if (!workspace) {
    return { workspaceDir: null, rows: [], totalRuns: 0, delta: null };
  }

  let runs = await listCheckRuns(workspace);
  if (parsed.engine) {
    const wanted = parsed.engine.toLowerCase();
    runs = runs.filter((r) => r.engine.toLowerCase() === wanted);
  }

  // Per-engine trend: delta vs the previous run with the same selector.
  const lastByEngine = new Map<string, CheckRunSummary>();
  const rows: HistoryRow[] = runs.map((run) => {
    const prev = lastByEngine.get(run.engine);
    lastByEngine.set(run.engine, run);
    return prev
      ? { ...run, coverageDeltaPct: run.coveragePct - prev.coveragePct }
      : { ...run };
  });

  // Citation delta for the latest run vs its same-engine predecessor.
  let delta: HistoryOutcome["delta"] = null;
  const latest = runs[runs.length - 1];
  if (latest) {
    const predecessors = runs.filter(
      (r) => r.engine === latest.engine && r !== latest
    );
    const previous = predecessors[predecessors.length - 1];
    if (previous) {
      const { newlyCited, lost } = diffCitedQueries(previous, latest);
      delta = {
        engine: latest.engine,
        previousSavedAt: previous.savedAt,
        latestSavedAt: latest.savedAt,
        newlyCited,
        lost,
      };
    }
  }

  const totalRuns = rows.length;
  const limited = rows.slice(Math.max(0, rows.length - parsed.limit));
  return { workspaceDir: workspace.dir, rows: limited, totalRuns, delta };
}

// ── Renderers ─────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  // `2026-06-10T13:22:05.000Z` → `2026-06-10 13:22`
  const m = iso.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
  return m ? `${m[1]} ${m[2]}:${m[3]}` : iso;
}

function trendMark(deltaPct: number | undefined, colors: boolean): string {
  if (deltaPct === undefined) return dim("·", colors);
  if (deltaPct > 0) return green(`↑${deltaPct}`, colors);
  if (deltaPct < 0) return red(`↓${Math.abs(deltaPct)}`, colors);
  return dim("→0", colors);
}

export function renderHistoryHuman(
  outcome: HistoryOutcome,
  opts: { colors: boolean; narrow?: boolean; cwd?: string }
): string {
  const ui: UiOptions = { colors: opts.colors, narrow: opts.narrow };
  const cwd = opts.cwd ?? process.cwd();
  const g = glyphs(ui.colors);
  const id = indent(ui);
  const lines: string[] = [];

  lines.push(header("auto-geo history", "citation coverage over time", ui));
  lines.push("");

  if (!outcome.workspaceDir) {
    lines.push(`${id}${dim("No .auto-geo workspace found.", ui.colors)}`);
    lines.push("");
    lines.push(
      `${id}Get started:  ${cyan("auto-geo init", ui.colors)} ${dim("then", ui.colors)} ${cyan("auto-geo check", ui.colors)}`
    );
    return lines.join("\n");
  }
  if (outcome.rows.length === 0) {
    lines.push(`${id}${dim("No saved check runs yet.", ui.colors)}`);
    lines.push("");
    lines.push(
      `${id}Run ${cyan("auto-geo check", ui.colors)} — every run is saved to .auto-geo/checks/ automatically.`
    );
    return lines.join("\n");
  }

  // Run table. Columns: date · engine · coverage (trend) · cited/total · cost
  const engineWidth = outcome.rows.reduce(
    (m, r) => Math.max(m, r.engine.length),
    6
  );
  for (const row of outcome.rows) {
    const date = dim(fmtDate(row.savedAt), ui.colors);
    const engine = cyan(row.engine.padEnd(engineWidth), ui.colors);
    const coverage = `${String(row.coveragePct).padStart(3)}%`;
    const coverageColored =
      row.coveragePct >= 50
        ? green(coverage, ui.colors)
        : row.coveragePct > 0
          ? yellow(coverage, ui.colors)
          : red(coverage, ui.colors);
    const trend = trendMark(row.coverageDeltaPct, ui.colors);
    const cited = dim(
      `${row.citedQueryCount}/${row.totalQueries} cited`,
      ui.colors
    );
    const cost = dim(`$${row.estimatedCostUsd.toFixed(2)}`, ui.colors);
    lines.push(
      `${id}${date}  ${engine}  ${coverageColored} ${trend}  ${cited}  ${cost}`
    );
  }

  if (outcome.totalRuns > outcome.rows.length) {
    lines.push(
      `${id}${dim(
        `… ${outcome.totalRuns - outcome.rows.length} older run${outcome.totalRuns - outcome.rows.length === 1 ? "" : "s"} not shown (raise --limit)`,
        ui.colors
      )}`
    );
  }

  // Latest-vs-previous citation delta.
  if (outcome.delta) {
    const d = outcome.delta;
    lines.push("");
    lines.push(
      `${id}${bold("Since last run", ui.colors)} ${dim(
        `(${d.engine} ${g.bullet} ${fmtDate(d.previousSavedAt)} ${g.arrow} ${fmtDate(d.latestSavedAt)})`,
        ui.colors
      )}`
    );
    if (d.newlyCited.length === 0 && d.lost.length === 0) {
      lines.push(`${id}  ${dim("No citation changes.", ui.colors)}`);
    }
    for (const q of d.newlyCited) {
      lines.push(`${id}  ${green(g.ok, ui.colors)} newly cited  ${q}`);
    }
    for (const q of d.lost) {
      lines.push(`${id}  ${red(g.fail, ui.colors)} lost         ${q}`);
    }
  }

  lines.push("");
  lines.push(
    `${id}${dim(
      `${outcome.totalRuns} run${outcome.totalRuns === 1 ? "" : "s"} ${g.bullet} ${relPathSafe(outcome.workspaceDir, cwd)}/checks`,
      ui.colors
    )}`
  );
  return lines.join("\n");
}

function relPathSafe(p: string, cwd: string): string {
  const rel = relative(cwd, p);
  return rel.startsWith("..") || rel === "" ? p : rel;
}

export function renderHistoryJson(outcome: HistoryOutcome): string {
  return JSON.stringify(outcome, null, 2);
}
