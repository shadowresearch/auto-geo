import { writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { bold, cyan, dim, glyphs, green, red } from "./ui";
import { CONFIG_FILE_NAME, type AutoGeoConfig } from "./config";
import type { ProviderId } from "./llm";
import { addPrompts, ensureWorkspace } from "./workspace";

/**
 * `auto-geo init` — first-run scaffolding. Sets up the FULL system in
 * one shot (v0.7.0):
 *
 *   - `auto-geo.config.json` (committable; no secrets)
 *   - `.env.local`           (gitignored by convention; empty key slots)
 *   - `.auto-geo/`           (workspace: tracked prompts + check history)
 *
 * Modes:
 *   - Interactive (default): a tiny prompt sequence over readline.
 *     Cancelable with Ctrl-C. Each prompt has a sensible default in [].
 *     Ends by optionally seeding the tracked-prompt set.
 *   - `--yes` / `-y`        : non-interactive. Writes a template config
 *     with all keys commented out + a `.env.local` stub. Good for CI /
 *     scripted onboarding.
 *
 * Flags:
 *   - `--force` : overwrite an existing `auto-geo.config.json`. Without
 *                 this, `init` refuses and prints the existing path.
 *
 * Never overwrites an existing `.env.local` — keys are precious. The
 * workspace scaffold is additive: an existing `.auto-geo/` is backfilled,
 * never clobbered.
 */

// ── Parsed args ───────────────────────────────────────────────────

export type InitArgs = {
  command: "init";
  yes: boolean;
  force: boolean;
  json: boolean;
  color: boolean;
  narrow: boolean;
};

export function parseInitArgs(argv: string[]): InitArgs {
  const args: InitArgs = {
    command: "init",
    yes: false,
    force: false,
    json: false,
    color: true,
    narrow: false,
  };
  for (const a of argv) {
    if (a === "--yes" || a === "-y") args.yes = true;
    else if (a === "--force") args.force = true;
    else if (a === "--json") args.json = true;
    else if (a === "--no-color") args.color = false;
    else if (a === "--narrow") args.narrow = true;
    else if (a.startsWith("--") || a.startsWith("-")) {
      throw new Error(`unknown flag: ${a}`);
    } else {
      throw new Error(`unexpected positional argument: ${a}`);
    }
  }
  return args;
}

// ── Runner ────────────────────────────────────────────────────────

export type InitPrompt = (question: string) => Promise<string>;

export type InitOptions = {
  cwd?: string;
  yes?: boolean;
  force?: boolean;
  prompt?: InitPrompt;
};

export type InitOutcome = {
  configPath: string;
  configWritten: boolean;
  envPath: string;
  envWritten: boolean;
  /** Absolute path to the `.auto-geo/` workspace. Empty if init refused. */
  workspaceDir: string;
  /** True if init created the workspace (vs found an existing one). */
  workspaceCreated: boolean;
  /** Tracked prompts seeded during this init run. */
  promptsSeeded: string[];
  /** True if `auto-geo.config.json` already existed and `--force` was not set. */
  refusedExisting: boolean;
  /** The config values we ended up writing (or would write). */
  config: AutoGeoConfig;
};

const DEFAULT_BASE_PATH = "/resources";
const DEFAULT_PROVIDER: ProviderId = "openai";

/**
 * Wire `init`'s interactive prompts to Node's built-in readline. Kept
 * separate from `runInit` so tests can inject a stub prompt without
 * spinning up real stdin/stdout.
 */
function makeReadlinePrompt(): { prompt: InitPrompt; close: () => void } {
  const rl = createInterface({ input: stdin, output: stdout });
  return {
    prompt: (question: string) => rl.question(question),
    close: () => rl.close(),
  };
}

export async function runInit(opts: InitOptions = {}): Promise<InitOutcome> {
  const cwd = resolve(opts.cwd ?? process.cwd());
  const configPath = join(cwd, CONFIG_FILE_NAME);
  const envPath = join(cwd, ".env.local");

  // Refuse to overwrite an existing config unless --force.
  if (existsSync(configPath) && !opts.force) {
    return {
      configPath,
      configWritten: false,
      envPath,
      envWritten: false,
      workspaceDir: "",
      workspaceCreated: false,
      promptsSeeded: [],
      refusedExisting: true,
      config: {},
    };
  }

  let config: AutoGeoConfig;
  let seedPrompts: string[] = [];
  if (opts.yes) {
    config = buildTemplateConfig();
  } else {
    const promptHelpers = opts.prompt
      ? { prompt: opts.prompt, close: () => {} }
      : makeReadlinePrompt();
    try {
      const answers = await runInteractivePrompts(promptHelpers.prompt);
      config = answers.config;
      seedPrompts = answers.seedPrompts;
    } finally {
      promptHelpers.close();
    }
  }

  // Write config (always — we either populated it or we're in --yes).
  await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
  const configWritten = true;

  // Scaffold .env.local — but never overwrite an existing one.
  let envWritten = false;
  if (!existsSync(envPath)) {
    await writeFile(envPath, buildEnvTemplate(), "utf8");
    envWritten = true;
  }

  // Scaffold the `.auto-geo/` workspace (tracked prompts + check
  // history). Additive — an existing workspace is backfilled, never
  // clobbered.
  const { workspace, created: workspaceCreated } = await ensureWorkspace(cwd);
  let promptsSeeded: string[] = [];
  if (seedPrompts.length > 0) {
    const { added } = await addPrompts(workspace, seedPrompts);
    promptsSeeded = added;
  }

  return {
    configPath,
    configWritten,
    envPath,
    envWritten,
    workspaceDir: workspace.dir,
    workspaceCreated,
    promptsSeeded,
    refusedExisting: false,
    config,
  };
}

// ── Interactive prompt sequence ───────────────────────────────────

async function runInteractivePrompts(
  prompt: InitPrompt
): Promise<{ config: AutoGeoConfig; seedPrompts: string[] }> {
  const config: AutoGeoConfig = {};

  const domain = (
    await prompt("Publisher domain (e.g. https://www.example.com): ")
  ).trim();
  if (domain) config.domain = domain;

  const basePath =
    (await prompt(`Base path for resources [${DEFAULT_BASE_PATH}]: `)).trim() ||
    DEFAULT_BASE_PATH;
  config.basePath = basePath;

  const provider =
    (
      await prompt(
        `Default LLM provider (openai | anthropic) [${DEFAULT_PROVIDER}]: `
      )
    ).trim() || DEFAULT_PROVIDER;
  if (provider === "openai" || provider === "anthropic") {
    config.provider = provider;
  }

  const authorName = (await prompt("Default author — name: ")).trim();
  const authorJobTitle = (await prompt("Default author — job title: ")).trim();
  const authorBio = (
    await prompt("Default author — bio (≥20 characters): ")
  ).trim();
  const authorLinkedin = (
    await prompt(
      "Default author — LinkedIn URL (optional, press Enter to skip): "
    )
  ).trim();

  const author: NonNullable<AutoGeoConfig["author"]> = {};
  if (authorName) author.name = authorName;
  if (authorJobTitle) author.jobTitle = authorJobTitle;
  if (authorBio.length >= 20) author.bio = authorBio;
  if (authorLinkedin) author.linkedinUrl = authorLinkedin;
  if (Object.keys(author).length > 0) config.author = author;

  // Seed the tracked-prompt set — the questions `check` measures and
  // `history` trends. Comma-separated so one answer can carry several.
  const promptsRaw = (
    await prompt(
      "Prompts to track — the queries you want AI engines to cite you for\n(comma-separated, press Enter to skip): "
    )
  ).trim();
  const seedPrompts = promptsRaw
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  return { config, seedPrompts };
}

// ── Template builders (used by --yes and as fallbacks) ────────────

function buildTemplateConfig(): AutoGeoConfig {
  return {
    domain: "https://www.example.com",
    basePath: DEFAULT_BASE_PATH,
    provider: DEFAULT_PROVIDER,
    author: {
      name: "Editorial Team",
      jobTitle: "Editor",
      bio: "Briefly describe the author or editorial team (≥20 characters).",
    },
  };
}

export function buildEnvTemplate(): string {
  return `# auto-geo API keys
# Set the keys for whichever providers/engines you intend to use.
# This file should be gitignored.

# ── Generation + citation checking (write, fix, check) ─────────────
OPENAI_API_KEY=
ANTHROPIC_API_KEY=

# ── Citation checking only (check) ─────────────────────────────────
PERPLEXITY_API_KEY=
GEMINI_API_KEY=
XAI_API_KEY=
`;
}

// ── Renderer ──────────────────────────────────────────────────────

export function renderInitOutcome(
  outcome: InitOutcome,
  opts: { colors: boolean } = { colors: true }
): string {
  const colors = opts.colors;
  const g = glyphs(colors);
  const lines: string[] = [];

  if (outcome.refusedExisting) {
    lines.push(
      red(
        `${g.fail} ${CONFIG_FILE_NAME} already exists at ${outcome.configPath}`,
        colors
      )
    );
    lines.push(dim("   Re-run with --force to overwrite.", colors));
    return lines.join("\n");
  }

  lines.push(
    green(`${g.ok} wrote ${CONFIG_FILE_NAME} (${outcome.configPath})`, colors)
  );
  if (outcome.envWritten) {
    lines.push(
      green(
        `${g.ok} scaffolded .env.local — fill in your API keys (${outcome.envPath})`,
        colors
      )
    );
  } else {
    lines.push(
      dim(
        `   .env.local already exists — leaving it alone (${outcome.envPath})`,
        colors
      )
    );
  }
  if (outcome.workspaceCreated) {
    lines.push(
      green(
        `${g.ok} created .auto-geo/ workspace — tracked prompts + check history (${outcome.workspaceDir})`,
        colors
      )
    );
  } else if (outcome.workspaceDir) {
    lines.push(
      dim(
        `   .auto-geo/ workspace already exists — leaving it alone (${outcome.workspaceDir})`,
        colors
      )
    );
  }
  if (outcome.promptsSeeded.length > 0) {
    lines.push(
      green(
        `${g.ok} tracking ${outcome.promptsSeeded.length} prompt${outcome.promptsSeeded.length === 1 ? "" : "s"} (.auto-geo/prompts.txt)`,
        colors
      )
    );
  }
  lines.push("");
  lines.push(bold("Next:", colors));
  lines.push(
    `  1. Edit ${cyan(".env.local", colors)} and add at least one API key (auto-loaded by every command)`
  );
  lines.push(
    `  2. Add ${cyan(".env.local", colors)} to .gitignore if not already`
  );
  lines.push(
    `  3. Run ${cyan("auto-geo doctor <url>", colors)} to audit a page`
  );
  if (outcome.promptsSeeded.length > 0) {
    lines.push(
      `  4. Run ${cyan("auto-geo check", colors)} to measure citations for your tracked prompts`
    );
  } else {
    lines.push(
      `  4. Run ${cyan('auto-geo prompts add "best foo tools"', colors)} then ${cyan("auto-geo check", colors)}`
    );
  }
  return lines.join("\n");
}

export function renderInitJson(outcome: InitOutcome): string {
  return JSON.stringify(outcome, null, 2);
}
