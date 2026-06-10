import { relative } from "node:path";
import {
  bold,
  cyan,
  dim,
  glyphs,
  green,
  header,
  indent,
  type UiOptions,
} from "./ui";
import {
  addPrompts,
  ensureWorkspace,
  findWorkspace,
  loadPrompts,
  removePrompt,
} from "./workspace";

/**
 * `auto-geo prompts` — manage the tracked prompt set in
 * `.auto-geo/prompts.txt`. Introduced in v0.7.0.
 *
 * Actions:
 *   - `list` (default) — numbered list of tracked prompts
 *   - `add <text> [...]` — append prompts (dedupes, creates the
 *     workspace on first use)
 *   - `rm <index|text>` — remove one prompt by 1-based index or exact text
 *
 * The tracked set is what `auto-geo check` runs when invoked without
 * --query / --queries-file, and what `auto-geo history` trends over time.
 */

// ── Parsed args ───────────────────────────────────────────────────

export type PromptsAction = "list" | "add" | "rm" | "discover";

export type PromptsArgs = {
  command: "prompts";
  action: PromptsAction;
  /** Prompt texts for `add`; the single selector for `rm`. */
  values: string[];
  // discover-only options (parser defaults elsewhere).
  count?: number;
  domain?: string;
  provider?: "openai" | "anthropic";
  model?: string;
  dryRun: boolean;
  json: boolean;
  color: boolean;
  narrow: boolean;
};

const DISCOVER_ONLY_FLAGS = new Set([
  "--count",
  "--domain",
  "--provider",
  "--model",
  "--dry-run",
]);

export function parsePromptsArgs(argv: string[]): PromptsArgs {
  const args: PromptsArgs = {
    command: "prompts",
    action: "list",
    values: [],
    dryRun: false,
    json: false,
    color: true,
    narrow: false,
  };

  const positionals: string[] = [];
  const discoverFlagsSeen: string[] = [];
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
    else if (a === "--dry-run") {
      args.dryRun = true;
      discoverFlagsSeen.push(a);
    } else if (a === "--count") {
      const n = Number(requireValue("--count"));
      if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n))
        throw new Error("--count requires a positive integer");
      args.count = n;
      discoverFlagsSeen.push(a);
    } else if (a === "--domain") {
      args.domain = requireValue("--domain");
      discoverFlagsSeen.push(a);
    } else if (a === "--provider") {
      const v = requireValue("--provider");
      if (v !== "openai" && v !== "anthropic")
        throw new Error(`--provider must be openai or anthropic; got "${v}"`);
      args.provider = v;
      discoverFlagsSeen.push(a);
    } else if (a === "--model") {
      args.model = requireValue("--model");
      discoverFlagsSeen.push(a);
    } else if (a.startsWith("--")) throw new Error(`unknown flag: ${a}`);
    else positionals.push(a);
  }

  const action = positionals[0];
  const rejectDiscoverFlags = (forAction: string): void => {
    const bad = discoverFlagsSeen.filter((f) => DISCOVER_ONLY_FLAGS.has(f));
    if (bad.length > 0) {
      throw new Error(
        `${bad[0]} is only valid with 'prompts discover' (got 'prompts ${forAction}')`
      );
    }
  };

  if (action === undefined || action === "list") {
    if (positionals.length > 1) {
      throw new Error(
        `unexpected arguments after 'list': ${positionals.slice(1).join(" ")}`
      );
    }
    rejectDiscoverFlags("list");
    args.action = "list";
    return args;
  }
  if (action === "add") {
    if (positionals.length < 2) {
      throw new Error(
        'prompts add requires at least one prompt, e.g. auto-geo prompts add "best media monitoring tools"'
      );
    }
    rejectDiscoverFlags("add");
    args.action = "add";
    args.values = positionals.slice(1);
    return args;
  }
  if (action === "rm" || action === "remove") {
    if (positionals.length !== 2) {
      throw new Error(
        "prompts rm requires exactly one selector — a 1-based index or the exact prompt text"
      );
    }
    rejectDiscoverFlags("rm");
    args.action = "rm";
    args.values = positionals.slice(1);
    return args;
  }
  if (action === "discover") {
    if (positionals.length > 1) {
      throw new Error(
        `unexpected arguments after 'discover': ${positionals.slice(1).join(" ")} (use --count / --domain)`
      );
    }
    args.action = "discover";
    return args;
  }
  throw new Error(
    `unknown prompts action: ${JSON.stringify(action)} (expected list, add, rm, or discover)`
  );
}

// ── Runner ────────────────────────────────────────────────────────

export type PromptsOutcome =
  | {
      action: "list";
      workspaceDir: string | null;
      promptsPath: string | null;
      prompts: string[];
    }
  | {
      action: "add";
      workspaceDir: string;
      promptsPath: string;
      added: string[];
      skipped: string[];
      prompts: string[];
    }
  | {
      action: "rm";
      workspaceDir: string;
      promptsPath: string;
      removed: string;
      prompts: string[];
    };

export class PromptsError extends Error {}

export async function runPrompts(
  parsed: PromptsArgs,
  cwd: string = process.cwd()
): Promise<PromptsOutcome> {
  if (parsed.action === "discover") {
    // `discover` needs config + LLM model resolution — it's dispatched
    // separately in run.ts (runDiscoverCommand) and never lands here.
    throw new PromptsError(
      "internal: discover is dispatched via runDiscoverCommand"
    );
  }
  if (parsed.action === "add") {
    // First `add` bootstraps the workspace — no init required.
    const { workspace } = await ensureWorkspace(cwd);
    const { added, skipped } = await addPrompts(workspace, parsed.values);
    return {
      action: "add",
      workspaceDir: workspace.dir,
      promptsPath: workspace.promptsPath,
      added,
      skipped,
      prompts: await loadPrompts(workspace),
    };
  }

  const workspace = findWorkspace(cwd);
  if (parsed.action === "list") {
    if (!workspace) {
      return {
        action: "list",
        workspaceDir: null,
        promptsPath: null,
        prompts: [],
      };
    }
    return {
      action: "list",
      workspaceDir: workspace.dir,
      promptsPath: workspace.promptsPath,
      prompts: await loadPrompts(workspace),
    };
  }

  // rm
  if (!workspace) {
    throw new PromptsError(
      "no .auto-geo workspace found — run `auto-geo init` or `auto-geo prompts add` first"
    );
  }
  const result = await removePrompt(workspace, parsed.values[0]!);
  if ("error" in result) throw new PromptsError(result.error);
  return {
    action: "rm",
    workspaceDir: workspace.dir,
    promptsPath: workspace.promptsPath,
    removed: result.removed,
    prompts: await loadPrompts(workspace),
  };
}

// ── Renderers ─────────────────────────────────────────────────────

function relPath(p: string, cwd: string): string {
  const rel = relative(cwd, p);
  return rel.startsWith("..") ? p : rel;
}

export function renderPromptsOutcome(
  outcome: PromptsOutcome,
  opts: { colors: boolean; narrow?: boolean; cwd?: string }
): string {
  const ui: UiOptions = { colors: opts.colors, narrow: opts.narrow };
  const cwd = opts.cwd ?? process.cwd();
  const g = glyphs(ui.colors);
  const id = indent(ui);
  const lines: string[] = [];

  if (outcome.action === "list") {
    if (!outcome.workspaceDir || outcome.prompts.length === 0) {
      lines.push(
        header("auto-geo prompts", "tracked prompts for this project", ui)
      );
      lines.push("");
      lines.push(`${id}${dim("No tracked prompts yet.", ui.colors)}`);
      lines.push("");
      lines.push(
        `${id}Add one:  ${cyan('auto-geo prompts add "best media monitoring tools"', ui.colors)}`
      );
      return lines.join("\n");
    }
    lines.push(
      header("auto-geo prompts", "tracked prompts for this project", ui)
    );
    lines.push("");
    const width = String(outcome.prompts.length).length;
    outcome.prompts.forEach((p, i) => {
      lines.push(`${id}${dim(String(i + 1).padStart(width), ui.colors)}. ${p}`);
    });
    lines.push("");
    lines.push(
      `${id}${dim(
        `${outcome.prompts.length} prompt${outcome.prompts.length === 1 ? "" : "s"} ${g.bullet} ${relPath(outcome.promptsPath!, cwd)}`,
        ui.colors
      )}`
    );
    return lines.join("\n");
  }

  if (outcome.action === "add") {
    for (const p of outcome.added) {
      lines.push(green(`${g.ok} added ${JSON.stringify(p)}`, ui.colors));
    }
    for (const p of outcome.skipped) {
      lines.push(
        dim(`  skipped ${JSON.stringify(p)} (already tracked)`, ui.colors)
      );
    }
    lines.push(
      dim(
        `  ${outcome.prompts.length} tracked ${g.bullet} ${relPath(outcome.promptsPath, cwd)}`,
        ui.colors
      )
    );
    lines.push("");
    lines.push(
      `${bold("Next:", ui.colors)} run ${cyan("auto-geo check", ui.colors)} to measure citation coverage for the tracked set.`
    );
    return lines.join("\n");
  }

  // rm — a successful removal is a success, so it gets the ok mark.
  lines.push(
    green(`${g.ok} removed ${JSON.stringify(outcome.removed)}`, ui.colors)
  );
  lines.push(
    dim(
      `  ${outcome.prompts.length} tracked ${g.bullet} ${relPath(outcome.promptsPath, cwd)}`,
      ui.colors
    )
  );
  return lines.join("\n");
}

export function renderPromptsJson(outcome: PromptsOutcome): string {
  return JSON.stringify(outcome, null, 2);
}
