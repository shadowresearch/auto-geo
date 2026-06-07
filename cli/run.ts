/* eslint-disable no-console */
import { readFile, writeFile } from "node:fs/promises";
import {
  ALL_ENGINE_NAMES,
  ENGINE_ENV_VARS,
  createEngine,
  engineHasCredentials,
  runCheck,
  runCheckMulti,
  type EngineName,
} from "./check";
import {
  renderReport,
  renderSitemapReport,
  runDoctor,
  runSitemapDoctor,
} from "./doctor";
import {
  DEFAULT_AUTHOR,
  renderWriteJson,
  renderWriteSummary,
  runWrite,
} from "./write";
import { renderFixHuman, renderFixJson, runFix, type FixCliFlags } from "./fix";
import {
  renderCheckHuman,
  renderCheckJson,
  renderMultiCheckHuman,
  renderMultiCheckJson,
} from "./render";
import {
  makeNdjsonGeoAuditLine,
  toGeoAuditOutput,
  toGeoAuditOutputMulti,
} from "./format-geo-audit";
import {
  type CommandName,
  getPackageVersion,
  renderCommandHelp,
  renderGlobalHelp,
  renderHelpPointer,
  renderVersion,
} from "./help";
import type { LlmProvider, ProviderId } from "./llm";
import type { ResourceAuthor } from "../core/schema";
import {
  CONFIG_FLAG_ALIASES,
  ConfigError,
  detectProviderFromEnv,
  loadConfig,
  resolveField,
  userPassedFlag,
  type AutoGeoConfig,
} from "./config";
import {
  parseInitArgs,
  renderInitJson,
  renderInitOutcome,
  runInit,
  type InitArgs,
} from "./init";

/**
 * Argument parser + top-level `run` for the `auto-geo` CLI. Lives in
 * its own module (not in `cli/bin.ts`) so it is freely importable
 * from tests without triggering `process.exit`. `bin.ts` is the
 * unconditional executable shim.
 *
 * Subcommand dispatch:
 *   - `auto-geo doctor <url>`   — audit a single URL or sitemap
 *   - `auto-geo fix <url>`      — LLM-driven GEO rewrite of an existing page
 *   - `auto-geo write --domain` — generate resource pages from queries
 *   - `auto-geo check --domain` — measure citation coverage in AI engines
 *   - bare `<url>` → doctor (back-compat with v0.1.3)
 *
 * Subcommands each parse their own flags in dedicated parsers
 * (`parseDoctorArgs`, `parseFixArgs`, `parseWriteArgs`, `parseCheckArgs`)
 * so a parallel agent adding a new subcommand can follow the same
 * pattern without touching shared scaffolding. See `parseArgs` for
 * the dispatcher.
 */

/**
 * Help rendering moved to `cli/help.ts` in v0.4.2 — the prior
 * monolithic USAGE constant blew up on narrow terminals (wrap mangled
 * `--domain <d>` into `--doin <d>`, etc). The renderers there emit
 * focused per-command help and a compact global help.
 *
 * `getHelpForError(command?)`: small one-shot helper for the
 * "missing required arg" path. Returns the short pointer line for the
 * given subcommand, or the bare reminder when called without a command.
 */
function getHelpForError(command?: CommandName): string {
  if (!command) return "Run 'auto-geo --help' to see available commands.";
  return renderHelpPointer(command);
}

// ── Parsed-args types ─────────────────────────────────────────────

export type DoctorArgs = {
  command: "doctor";
  url?: string;
  site?: string;
  json: boolean;
  color: boolean;
  narrow: boolean;
  maxPages?: number;
  concurrency?: number;
};

export type WriteArgs = {
  command: "write";
  domain?: string;
  queries: string[];
  queriesFile?: string;
  out: string;
  provider: ProviderId;
  model?: string;
  basePath: string;
  authorName?: string;
  authorJobTitle?: string;
  authorBio?: string;
  authorLinkedin?: string;
  maxRetries: number;
  concurrency: number;
  dryRun: boolean;
  json: boolean;
  color: boolean;
  narrow: boolean;
};

export type FixArgs = {
  command: "fix";
  url?: string;
  out: string;
  provider: LlmProvider;
  model: string;
  maxRetries: number;
  dryRun: boolean;
  json: boolean;
  color: boolean;
  narrow: boolean;
  basePath: string;
  authorName?: string;
  authorJobTitle?: string;
  authorBio?: string;
  authorLinkedin?: string;
};

export type CheckArgs = {
  command: "check";
  domain?: string;
  queries: string[];
  queriesFile?: string;
  engine: string;
  model?: string;
  out?: string;
  concurrency?: number;
  json: boolean;
  ndjson: boolean;
  /**
   * Render mode for the engine's natural-language answer under each
   * query in human output. Ignored under `--json` / `--ndjson`.
   *   - `"preview"` (default): ~3 sentences, ~400 chars, truncation marker
   *   - `"full"`: the entire response
   *   - `"none"`: suppress (matches v0.4.0 behavior)
   */
  answers: "none" | "preview" | "full";
  /**
   * Output shape for `--json` / `--ndjson`:
   *   - `"auto-geo"` (default): the stable `CheckReport` /
   *     `MultiEngineCheckReport` shape — byte-identical to v0.4.2.
   *   - `"geo-audit"`: per-query rows mapped to Shadow's in-product
   *     `geoAudit` tool's `LlmQueryResult` shape (see
   *     `cli/format-geo-audit.ts`). Human output is unchanged in either
   *     mode — this is purely a JSON-shape switch.
   */
  format: "auto-geo" | "geo-audit";
  timeoutPerQuerySec?: number;
  maxRuntimeSec?: number;
  color: boolean;
  narrow: boolean;
};

export type HelpArgs = {
  command: "help";
  /** Which subcommand's help to show, or `undefined` for global help. */
  topic?: CommandName;
  // Carry the json + color + narrow flags so the help path is
  // consistent with the rest of the parser; not used by callers.
  json: boolean;
  color: boolean;
  narrow: boolean;
};

export type VersionArgs = {
  command: "version";
};

export type ParsedArgs =
  | DoctorArgs
  | FixArgs
  | WriteArgs
  | CheckArgs
  | InitArgs
  | HelpArgs
  | VersionArgs;

// ── Dispatcher ────────────────────────────────────────────────────

const SUBCOMMANDS = new Set<CommandName>([
  "doctor",
  "fix",
  "write",
  "check",
  "init",
]);

function isSubcommand(s: string | undefined): s is CommandName {
  return !!s && SUBCOMMANDS.has(s as CommandName);
}

export function parseArgs(argv: string[]): ParsedArgs {
  // Bare invocation → global help (was: doctor with missing URL).
  if (argv.length === 0) {
    return { command: "help", json: false, color: true, narrow: false };
  }

  // Version flags — must beat --help so `--version --help` is a no-op
  // and `auto-geo -v` is fast.
  if (argv[0] === "--version" || argv[0] === "-v") {
    return { command: "version" };
  }

  const first = argv[0];

  // `auto-geo help [<cmd>]` — common convention.
  if (first === "help") {
    const topic = argv[1];
    if (isSubcommand(topic)) {
      return {
        command: "help",
        topic,
        json: false,
        color: true,
        narrow: false,
      };
    }
    return { command: "help", json: false, color: true, narrow: false };
  }

  // Global `--help` / `-h` (no subcommand) → global help.
  if (first === "--help" || first === "-h") {
    return { command: "help", json: false, color: true, narrow: false };
  }

  // `<cmd> --help` / `<cmd> -h` → focused per-command help. Catch it
  // here rather than letting each subcommand parser handle a flag —
  // keeps the per-command parsers focused on their flag set.
  if (isSubcommand(first) && (argv[1] === "--help" || argv[1] === "-h")) {
    return {
      command: "help",
      topic: first,
      json: false,
      color: true,
      narrow: false,
    };
  }

  if (first === "write") return parseWriteArgs(argv.slice(1));
  if (first === "fix") return parseFixArgs(argv.slice(1));
  if (first === "check") return parseCheckArgs(argv.slice(1));
  if (first === "doctor") return parseDoctorArgs(argv.slice(1));
  if (first === "init") return parseInitArgs(argv.slice(1));
  // Bare `<url>` dispatches to doctor for v0.1.3 back-compat.
  return parseDoctorArgs(argv);
}

// ── doctor subcommand ─────────────────────────────────────────────

export function parseDoctorArgs(argv: string[]): DoctorArgs {
  const args: DoctorArgs = {
    command: "doctor",
    json: false,
    color: true,
    narrow: false,
  };

  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--json") args.json = true;
    else if (a === "--no-color") args.color = false;
    else if (a === "--narrow") args.narrow = true;
    else if (a === "--site") {
      const next = argv[++i];
      if (!next) throw new Error("--site requires a URL argument");
      args.site = next;
    } else if (a === "--max-pages") {
      const next = argv[++i];
      const n = Number(next);
      if (!Number.isFinite(n) || n <= 0)
        throw new Error("--max-pages requires a positive number");
      args.maxPages = n;
    } else if (a === "--concurrency") {
      const next = argv[++i];
      const n = Number(next);
      if (!Number.isFinite(n) || n <= 0)
        throw new Error("--concurrency requires a positive number");
      args.concurrency = n;
    } else if (a.startsWith("--")) {
      throw new Error(`unknown flag: ${a}`);
    } else {
      positionals.push(a);
    }
  }

  if (positionals.length > 1) {
    throw new Error(
      `unexpected positional arguments: ${positionals.slice(1).join(" ")}`
    );
  }
  args.url = positionals[0];

  return args;
}

// ── fix subcommand ────────────────────────────────────────────────

export function parseFixArgs(argv: string[]): FixArgs {
  const args: FixArgs = {
    command: "fix",
    out: "./fixed.json",
    provider: "openai",
    // v0.6.1: bumped from "gpt-4o-mini" to "gpt-4o". Mini cannot hold
    // the soft-content windows in `resourcePublishSchema` (40-60 word
    // TL;DR / capsules / FAQ answers, 10-35 word takeaways, 4-8
    // related guides, 3-10 FAQ items) — it systematically under-writes
    // and the self-correction loop can't recover. gpt-4o follows the
    // windows reliably. Cost goes ~10x per page (still <$0.10) but
    // correctness goes from ~0% to ~100% on default invocations.
    model: "gpt-4o",
    // v0.6.1: bumped from 2 → 3. Cheap insurance combined with the
    // new actionable retry coaching (formatIssues below).
    maxRetries: 3,
    dryRun: false,
    json: false,
    color: true,
    narrow: false,
    basePath: "/resources",
  };

  const positionals: string[] = [];
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
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--out") args.out = requireValue("--out");
    else if (a === "--provider") {
      const v = requireValue("--provider");
      if (v !== "openai" && v !== "anthropic")
        throw new Error(`--provider must be openai or anthropic; got "${v}"`);
      args.provider = v;
    } else if (a === "--model") args.model = requireValue("--model");
    else if (a === "--basepath") args.basePath = requireValue("--basepath");
    else if (a === "--author-name")
      args.authorName = requireValue("--author-name");
    else if (a === "--author-jobtitle")
      args.authorJobTitle = requireValue("--author-jobtitle");
    else if (a === "--author-bio")
      args.authorBio = requireValue("--author-bio");
    else if (a === "--author-linkedin")
      args.authorLinkedin = requireValue("--author-linkedin");
    else if (a === "--max-retries") {
      const n = Number(requireValue("--max-retries"));
      if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n))
        throw new Error("--max-retries requires a non-negative integer");
      args.maxRetries = n;
    } else if (a.startsWith("--")) {
      throw new Error(`unknown flag: ${a}`);
    } else {
      positionals.push(a);
    }
  }

  if (positionals.length > 1) {
    throw new Error(
      `unexpected positional arguments: ${positionals.slice(1).join(" ")}`
    );
  }
  args.url = positionals[0];

  return args;
}

// ── write subcommand ──────────────────────────────────────────────

// v0.6.1: openai default model bumped from "gpt-4o-mini" to "gpt-4o".
// Mini cannot hold the soft-content windows in `resourcePublishSchema`
// (40-60 word TL;DR / capsules / FAQ answers, 10-35 word takeaways)
// and the self-correction loop can't recover from systematic
// under-writing. gpt-4o is the smallest model that reliably passes.
const DEFAULT_MODEL_BY_PROVIDER: Record<ProviderId, string> = {
  openai: "gpt-4o",
  anthropic: "claude-sonnet-4-6",
};

export function parseWriteArgs(argv: string[]): WriteArgs {
  const args: WriteArgs = {
    command: "write",
    queries: [],
    out: "./out",
    provider: "openai",
    basePath: "/resources",
    // v0.6.1: bumped from 2 → 3. Cheap insurance — paired with the
    // actionable retry coaching in formatIssues (see cli/llm.ts).
    maxRetries: 3,
    concurrency: 2,
    dryRun: false,
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
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--domain") args.domain = requireValue("--domain");
    else if (a === "--query") args.queries.push(requireValue("--query"));
    else if (a === "--queries-file")
      args.queriesFile = requireValue("--queries-file");
    else if (a === "--out") args.out = requireValue("--out");
    else if (a === "--provider") {
      const v = requireValue("--provider");
      if (v !== "openai" && v !== "anthropic")
        throw new Error(
          `--provider must be 'openai' or 'anthropic', got '${v}'`
        );
      args.provider = v;
    } else if (a === "--model") args.model = requireValue("--model");
    else if (a === "--basepath") args.basePath = requireValue("--basepath");
    else if (a === "--author-name")
      args.authorName = requireValue("--author-name");
    else if (a === "--author-jobtitle")
      args.authorJobTitle = requireValue("--author-jobtitle");
    else if (a === "--author-bio")
      args.authorBio = requireValue("--author-bio");
    else if (a === "--author-linkedin")
      args.authorLinkedin = requireValue("--author-linkedin");
    else if (a === "--max-retries") {
      const n = Number(requireValue("--max-retries"));
      if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n))
        throw new Error("--max-retries requires a non-negative integer");
      args.maxRetries = n;
    } else if (a === "--concurrency") {
      const n = Number(requireValue("--concurrency"));
      if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n))
        throw new Error("--concurrency requires a positive integer");
      args.concurrency = n;
    } else if (a.startsWith("--")) {
      throw new Error(`unknown flag: ${a}`);
    } else {
      throw new Error(`unexpected positional argument: ${a}`);
    }
  }

  return args;
}

// ── check subcommand ──────────────────────────────────────────────

export function parseCheckArgs(argv: string[]): CheckArgs {
  const args: CheckArgs = {
    command: "check",
    queries: [],
    engine: "perplexity",
    json: false,
    ndjson: false,
    answers: "preview",
    format: "auto-geo",
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
    else if (a === "--ndjson") args.ndjson = true;
    else if (a === "--no-color") args.color = false;
    else if (a === "--narrow") args.narrow = true;
    else if (a === "--domain") args.domain = requireValue("--domain");
    else if (a === "--query") args.queries.push(requireValue("--query"));
    else if (a === "--queries-file")
      args.queriesFile = requireValue("--queries-file");
    else if (a === "--engine") args.engine = requireValue("--engine");
    else if (a === "--model") args.model = requireValue("--model");
    else if (a === "--out") args.out = requireValue("--out");
    else if (a === "--answers") {
      const v = requireValue("--answers");
      if (v !== "none" && v !== "preview" && v !== "full") {
        throw new Error(
          `--answers must be 'none', 'preview', or 'full'; got '${v}'`
        );
      }
      args.answers = v;
    } else if (a === "--format") {
      const v = requireValue("--format");
      if (v !== "auto-geo" && v !== "geo-audit") {
        throw new Error(
          `--format must be 'auto-geo' or 'geo-audit'; got '${v}'`
        );
      }
      args.format = v;
    } else if (a === "--concurrency") {
      const n = Number(requireValue("--concurrency"));
      if (!Number.isFinite(n) || n <= 0)
        throw new Error("--concurrency requires a positive number");
      args.concurrency = n;
    } else if (a === "--timeout-per-query") {
      const n = Number(requireValue("--timeout-per-query"));
      if (!Number.isFinite(n) || n <= 0)
        throw new Error("--timeout-per-query requires a positive number");
      args.timeoutPerQuerySec = n;
    } else if (a === "--max-runtime") {
      const n = Number(requireValue("--max-runtime"));
      if (!Number.isFinite(n) || n <= 0)
        throw new Error("--max-runtime requires a positive number");
      args.maxRuntimeSec = n;
    } else if (a.startsWith("--")) {
      throw new Error(`unknown flag: ${a}`);
    } else {
      throw new Error(
        `unexpected positional argument: ${a} (check uses --domain / --query)`
      );
    }
  }

  if (args.json && args.ndjson) {
    throw new Error(
      "--json and --ndjson are mutually exclusive (one is a single object, the other is a per-line stream)"
    );
  }

  return args;
}

/**
 * @deprecated The monolithic USAGE constant was removed in v0.4.2 in
 * favor of focused per-command help. Kept as a thin shim that returns
 * the global help string so any external integration still gets a
 * sensible value, and so a 0.4.1-era consumer doesn't crash.
 */
export function getUsage(): string {
  return renderGlobalHelp({ colors: false });
}

// ── Entry ─────────────────────────────────────────────────────────

/**
 * Infer which subcommand the user was trying to invoke from the raw
 * argv, even when parsing threw before producing a typed result. Used
 * to scope the "Run 'auto-geo <cmd> --help' to see available flags."
 * pointer printed after an arg-parse error.
 */
function inferCommandFromArgv(argv: string[]): CommandName | undefined {
  const first = argv[0];
  if (isSubcommand(first)) return first;
  return undefined;
}

export async function run(argv: string[]): Promise<number> {
  // Pre-resolve the package version so renderers can include it
  // synchronously (they're called from many sites). Cheap — one read,
  // cached for the lifetime of the process.
  await getPackageVersion();

  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(argv);
  } catch (err) {
    const cmd = inferCommandFromArgv(argv);
    console.error(
      `auto-geo: ${err instanceof Error ? err.message : String(err)}`
    );
    console.error(getHelpForError(cmd));
    return 2;
  }

  if (parsed.command === "help") {
    // Respect NO_COLOR + non-TTY pipes for help output, same gate as
    // every other human renderer in the CLI.
    const colors = shouldUseColor(true, false);
    if (parsed.topic) {
      console.log(renderCommandHelp(parsed.topic, { colors }));
    } else {
      console.log(renderGlobalHelp({ colors }));
    }
    return 0;
  }
  if (parsed.command === "version") {
    console.log(await renderVersion());
    return 0;
  }

  // `init` runs BEFORE config loading — it creates the file that
  // loadConfig would read, so loading first would be circular and
  // would surface schema errors from a half-written config.
  if (parsed.command === "init") return runInitCommand(parsed);

  // Load config once for the lifetime of this invocation. Errors
  // (malformed JSON, schema violation) surface as exit 2 — config
  // problems should be loud, not silently dropped.
  let config: AutoGeoConfig | null = null;
  try {
    const loaded = await loadConfig();
    if (loaded) config = loaded.config;
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`auto-geo: ${err.message}`);
      return 2;
    }
    throw err;
  }

  if (parsed.command === "doctor") {
    mergeConfigIntoDoctorArgs(parsed, argv, config);
    return runDoctorCommand(parsed);
  }
  if (parsed.command === "fix") {
    mergeConfigIntoFixArgs(parsed, argv, config);
    return runFixCommand(parsed);
  }
  if (parsed.command === "write") {
    mergeConfigIntoWriteArgs(parsed, argv, config);
    return runWriteCommand(parsed);
  }
  if (parsed.command === "check") {
    mergeConfigIntoCheckArgs(parsed, argv, config);
    return runCheckCommand(parsed);
  }

  // Exhaustive check.
  console.error(renderGlobalHelp({ colors: false }));
  return 2;
}

// ── Config merge (CLI > env > config > parser default) ────────────

/**
 * Merge config-file values into parsed args for fields the user did
 * NOT pass on the CLI. Mutates the input in place — the parser already
 * filled in its built-in defaults; this layer overrides those defaults
 * when (a) the user didn't pass the flag AND (b) config has a value.
 *
 * Per-command — separate functions because the field sets differ.
 */
function mergeConfigIntoDoctorArgs(
  args: DoctorArgs,
  argv: string[],
  config: AutoGeoConfig | null
): void {
  if (config?.concurrency !== undefined && args.concurrency === undefined) {
    if (!userPassedFlag(argv, ...CONFIG_FLAG_ALIASES.concurrency)) {
      args.concurrency = config.concurrency;
    }
  }
}

function mergeConfigIntoFixArgs(
  args: FixArgs,
  argv: string[],
  config: AutoGeoConfig | null
): void {
  args.provider = resolveField({
    cliPassed: userPassedFlag(argv, ...CONFIG_FLAG_ALIASES.provider),
    parserValue: args.provider,
    envValue: detectProviderFromEnv(),
    configValue: config?.provider,
  });
  if (!userPassedFlag(argv, ...CONFIG_FLAG_ALIASES.model) && config?.model) {
    args.model = config.model;
  }
  if (
    !userPassedFlag(argv, ...CONFIG_FLAG_ALIASES.basePath) &&
    config?.basePath
  ) {
    args.basePath = config.basePath;
  }
  // Author fields — CLI > config. The author resolver in the write
  // runner (resolveAuthor) handles env-less defaults from DEFAULT_AUTHOR.
  if (
    args.authorName === undefined &&
    !userPassedFlag(argv, ...CONFIG_FLAG_ALIASES.authorName) &&
    config?.author?.name
  ) {
    args.authorName = config.author.name;
  }
  if (
    args.authorJobTitle === undefined &&
    !userPassedFlag(argv, ...CONFIG_FLAG_ALIASES.authorJobTitle) &&
    config?.author?.jobTitle
  ) {
    args.authorJobTitle = config.author.jobTitle;
  }
  if (
    args.authorBio === undefined &&
    !userPassedFlag(argv, ...CONFIG_FLAG_ALIASES.authorBio) &&
    config?.author?.bio
  ) {
    args.authorBio = config.author.bio;
  }
  if (
    args.authorLinkedin === undefined &&
    !userPassedFlag(argv, ...CONFIG_FLAG_ALIASES.authorLinkedin) &&
    config?.author?.linkedinUrl
  ) {
    args.authorLinkedin = config.author.linkedinUrl;
  }
}

function mergeConfigIntoWriteArgs(
  args: WriteArgs,
  argv: string[],
  config: AutoGeoConfig | null
): void {
  if (args.domain === undefined && config?.domain) {
    args.domain = config.domain;
  }
  args.provider = resolveField({
    cliPassed: userPassedFlag(argv, ...CONFIG_FLAG_ALIASES.provider),
    parserValue: args.provider,
    envValue: detectProviderFromEnv(),
    configValue: config?.provider,
  });
  if (
    args.model === undefined &&
    !userPassedFlag(argv, ...CONFIG_FLAG_ALIASES.model) &&
    config?.model
  ) {
    args.model = config.model;
  }
  if (
    !userPassedFlag(argv, ...CONFIG_FLAG_ALIASES.basePath) &&
    config?.basePath
  ) {
    args.basePath = config.basePath;
  }
  if (
    !userPassedFlag(argv, ...CONFIG_FLAG_ALIASES.concurrency) &&
    config?.concurrency !== undefined
  ) {
    args.concurrency = config.concurrency;
  }
  if (
    args.authorName === undefined &&
    !userPassedFlag(argv, ...CONFIG_FLAG_ALIASES.authorName) &&
    config?.author?.name
  ) {
    args.authorName = config.author.name;
  }
  if (
    args.authorJobTitle === undefined &&
    !userPassedFlag(argv, ...CONFIG_FLAG_ALIASES.authorJobTitle) &&
    config?.author?.jobTitle
  ) {
    args.authorJobTitle = config.author.jobTitle;
  }
  if (
    args.authorBio === undefined &&
    !userPassedFlag(argv, ...CONFIG_FLAG_ALIASES.authorBio) &&
    config?.author?.bio
  ) {
    args.authorBio = config.author.bio;
  }
  if (
    args.authorLinkedin === undefined &&
    !userPassedFlag(argv, ...CONFIG_FLAG_ALIASES.authorLinkedin) &&
    config?.author?.linkedinUrl
  ) {
    args.authorLinkedin = config.author.linkedinUrl;
  }
}

function mergeConfigIntoCheckArgs(
  args: CheckArgs,
  argv: string[],
  config: AutoGeoConfig | null
): void {
  if (args.domain === undefined && config?.domain) {
    args.domain = config.domain;
  }
  if (!userPassedFlag(argv, ...CONFIG_FLAG_ALIASES.engine) && config?.engine) {
    args.engine = config.engine;
  }
  if (
    args.model === undefined &&
    !userPassedFlag(argv, ...CONFIG_FLAG_ALIASES.model) &&
    config?.model
  ) {
    args.model = config.model;
  }
  if (
    args.concurrency === undefined &&
    !userPassedFlag(argv, ...CONFIG_FLAG_ALIASES.concurrency) &&
    config?.concurrency !== undefined
  ) {
    args.concurrency = config.concurrency;
  }
}

// ── doctor runner ─────────────────────────────────────────────────

async function runDoctorCommand(parsed: DoctorArgs): Promise<number> {
  if (parsed.site) return runSiteMode(parsed);
  if (parsed.url) return runSingleMode(parsed);
  console.error("auto-geo: missing URL argument");
  console.error(getHelpForError("doctor"));
  return 2;
}

async function runSingleMode(parsed: DoctorArgs): Promise<number> {
  const colors = shouldUseColor(parsed.color, parsed.json);
  try {
    const report = await runDoctor(parsed.url!);
    const out = renderReport(report, {
      json: parsed.json,
      colors,
      narrow: parsed.narrow,
    });
    console.log(out);
    return report.scorePct >= 75 ? 0 : 1;
  } catch (err) {
    if (parsed.json) {
      console.log(
        JSON.stringify(
          {
            url: parsed.url,
            error: err instanceof Error ? err.message : String(err),
          },
          null,
          2
        )
      );
    } else {
      console.error(
        `auto-geo: failed to audit ${parsed.url} — ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
    return 1;
  }
}

async function runSiteMode(parsed: DoctorArgs): Promise<number> {
  const colors = shouldUseColor(parsed.color, parsed.json);
  try {
    const report = await runSitemapDoctor(parsed.site!, {
      maxPages: parsed.maxPages,
      concurrency: parsed.concurrency,
    });
    const out = renderSitemapReport(report, {
      json: parsed.json,
      colors,
      narrow: parsed.narrow,
    });
    console.log(out);
    return report.meanScorePct >= 75 ? 0 : 1;
  } catch (err) {
    if (parsed.json) {
      console.log(
        JSON.stringify(
          {
            sitemap: parsed.site,
            error: err instanceof Error ? err.message : String(err),
          },
          null,
          2
        )
      );
    } else {
      console.error(
        `auto-geo: failed to audit sitemap ${parsed.site} — ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
    return 1;
  }
}

// ── fix runner ────────────────────────────────────────────────────

async function runFixCommand(parsed: FixArgs): Promise<number> {
  const colors = shouldUseColor(parsed.color, parsed.json);

  if (!parsed.url) {
    console.error("auto-geo fix: missing URL argument");
    console.error(getHelpForError("fix"));
    return 2;
  }

  const flags: FixCliFlags = {
    url: parsed.url,
    out: parsed.out,
    provider: parsed.provider,
    model: parsed.model,
    maxRetries: parsed.maxRetries,
    dryRun: parsed.dryRun,
    json: parsed.json,
    basePath: parsed.basePath,
    authorName: parsed.authorName,
    authorJobTitle: parsed.authorJobTitle,
    authorBio: parsed.authorBio,
    authorLinkedin: parsed.authorLinkedin,
  };

  try {
    const outcome = await runFix(flags);
    const out = parsed.json
      ? renderFixJson(outcome)
      : renderFixHuman(outcome, { colors, narrow: parsed.narrow });
    console.log(out);
    return 0;
  } catch (err) {
    if (parsed.json) {
      console.log(
        JSON.stringify(
          {
            url: parsed.url,
            error: err instanceof Error ? err.message : String(err),
          },
          null,
          2
        )
      );
    } else {
      console.error(
        `auto-geo fix: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    return 1;
  }
}

// ── write runner ──────────────────────────────────────────────────

async function runWriteCommand(parsed: WriteArgs): Promise<number> {
  const colors = shouldUseColor(parsed.color, parsed.json);

  // Resolve domain + queries.
  if (!parsed.domain) {
    console.error("auto-geo write: --domain is required");
    console.error(getHelpForError("write"));
    return 2;
  }
  if (!/^https?:\/\//.test(parsed.domain)) {
    console.error(
      `auto-geo write: --domain must be a full URL (got ${JSON.stringify(parsed.domain)})`
    );
    return 2;
  }

  const queries = [...parsed.queries];
  if (parsed.queriesFile) {
    try {
      const file = await readFile(parsed.queriesFile, "utf8");
      for (const line of file.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("#")) queries.push(trimmed);
      }
    } catch (err) {
      console.error(
        `auto-geo write: failed to read --queries-file ${parsed.queriesFile}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
      return 2;
    }
  }
  if (queries.length === 0) {
    console.error(
      "auto-geo write: at least one --query (or --queries-file) is required"
    );
    console.error(getHelpForError("write"));
    return 2;
  }

  const modelName = parsed.model ?? DEFAULT_MODEL_BY_PROVIDER[parsed.provider];

  // Resolve author (bio supports `@path` shorthand for reading from a file).
  const author = await resolveAuthor(parsed);

  // Resolve the model unless dry-run.
  let model;
  if (!parsed.dryRun) {
    try {
      model = await resolveModel(parsed.provider, modelName);
    } catch (err) {
      console.error(
        `auto-geo write: ${err instanceof Error ? err.message : String(err)}`
      );
      return 2;
    }
  }

  try {
    const summary = await runWrite({
      domain: parsed.domain,
      queries,
      outDir: parsed.out,
      provider: parsed.provider,
      modelName,
      model,
      basePath: parsed.basePath,
      author,
      publishedAt: formatYmd(new Date()),
      maxRetries: parsed.maxRetries,
      concurrency: parsed.concurrency,
      dryRun: parsed.dryRun,
    });

    if (parsed.json) {
      console.log(renderWriteJson(summary));
    } else {
      console.log(
        renderWriteSummary(summary, { colors, narrow: parsed.narrow })
      );
    }

    const failed = summary.outcomes.some((o) => o.kind === "failed");
    return failed ? 1 : 0;
  } catch (err) {
    if (parsed.json) {
      console.log(
        JSON.stringify(
          {
            error: err instanceof Error ? err.message : String(err),
          },
          null,
          2
        )
      );
    } else {
      console.error(
        `auto-geo write: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    return 1;
  }
}

// ── check runner ──────────────────────────────────────────────────

async function runCheckCommand(parsed: CheckArgs): Promise<number> {
  // Color shut-off mirrors --json under --ndjson too — the stdout
  // stream is machine-readable, so any color leakage to stderr-bound
  // progress lines is the only place colors could apply. We pass
  // through and shouldUseColor still respects TTY/NO_COLOR.
  const colors = shouldUseColor(parsed.color, parsed.json || parsed.ndjson);

  if (!parsed.domain) {
    console.error("auto-geo check: --domain is required");
    console.error(getHelpForError("check"));
    return 2;
  }

  // Merge --query (repeatable) and --queries-file. File entries are
  // appended after CLI entries so an explicit CLI query is the first
  // one in the report — that's the more common interactive ordering.
  const queries = [...parsed.queries];
  if (parsed.queriesFile) {
    try {
      const raw = await readFile(parsed.queriesFile, "utf8");
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("#")) queries.push(trimmed);
      }
    } catch (err) {
      console.error(
        `auto-geo check: failed to read --queries-file ${parsed.queriesFile} — ${err instanceof Error ? err.message : String(err)}`
      );
      return 2;
    }
  }

  if (queries.length === 0) {
    console.error(
      "auto-geo check: at least one --query or --queries-file is required"
    );
    console.error(getHelpForError("check"));
    return 2;
  }

  // Normalize the engine selector: accept aliases and `all`.
  const rawEngine = parsed.engine.toLowerCase();
  const engineName = rawEngine === "grok" ? "xai" : rawEngine;
  const validSingles = new Set<string>(ALL_ENGINE_NAMES);

  if (engineName !== "all" && !validSingles.has(engineName)) {
    console.error(
      `auto-geo check: unknown --engine ${parsed.engine}. Valid: perplexity, openai, anthropic, gemini, xai (grok), all`
    );
    return 2;
  }

  // Build the per-query result hook. In `--ndjson` mode each result
  // streams to stdout as one JSON line, plus a `_summary` line at the
  // end. In human mode we print a `[i/N] ✓/✗ "query" — …` status to
  // stderr so it doesn't pollute stdout (the final report still goes
  // to stdout). Under `--json` we stay silent — that mode is "one
  // single object, nothing else". Multi-engine ("--engine all") does
  // its own per-row emission, so we don't pass engineMeta here.
  //
  // For single-engine mode the engineMeta is constructed once we've
  // created the engine adapter below — see the single-engine branch.

  try {
    if (engineName === "all") {
      // Collect every engine whose primary env var is set. Skip the
      // rest with a reason so the user sees why an engine was excluded.
      const enabled: EngineName[] = [];
      const skipped: Array<{ engine: string; reason: string }> = [];
      for (const e of ALL_ENGINE_NAMES) {
        if (engineHasCredentials(e)) enabled.push(e);
        else
          skipped.push({
            engine: e,
            reason: `${ENGINE_ENV_VARS[e]} not set`,
          });
      }
      if (enabled.length === 0) {
        console.error(
          `auto-geo check: --engine all needs at least one API key set. Looked for: ${ALL_ENGINE_NAMES.map(
            (e) => ENGINE_ENV_VARS[e]
          ).join(", ")}.`
        );
        return 2;
      }

      const engines = enabled.map((name) =>
        createEngine(name, { model: parsed.model })
      );
      const report = await runCheckMulti({
        domain: parsed.domain,
        queries,
        engines,
        concurrency: parsed.concurrency,
        timeoutPerQuerySec: parsed.timeoutPerQuerySec,
        maxRuntimeSec: parsed.maxRuntimeSec,
      });
      report.skippedEngines = skipped;

      // --ndjson streams per-engine per-query results plus a summary.
      if (parsed.ndjson) {
        if (parsed.format === "geo-audit") {
          // geo-audit mode: emit one GeoAuditRow per query (engine ×
          // query), then a summary line that carries BOTH the
          // multi-engine summary (back-compat) AND the geoAudit summary
          // fields layered on top.
          for (const engineId of report.engines) {
            const r = report.perEngine[engineId];
            if (!r) continue;
            for (const result of r.results) {
              process.stdout.write(
                JSON.stringify(
                  makeNdjsonGeoAuditLine(result, {
                    provider: engineId,
                    model: r.model,
                  })
                ) + "\n"
              );
            }
          }
          const ga = toGeoAuditOutputMulti(report);
          process.stdout.write(
            JSON.stringify({
              _summary: true,
              domain: report.domain,
              engines: report.engines,
              skippedEngines: report.skippedEngines,
              ...report.summary,
              acrossEngines: report.acrossEngines,
              // GeoAudit summary fields layered on top.
              ...ga.summary,
            }) + "\n"
          );
        } else {
          for (const engineId of report.engines) {
            const r = report.perEngine[engineId];
            if (!r) continue;
            for (const result of r.results) {
              process.stdout.write(
                JSON.stringify(formatNdjsonResultLine(result, engineId)) + "\n"
              );
            }
          }
          process.stdout.write(
            JSON.stringify({
              _summary: true,
              domain: report.domain,
              engines: report.engines,
              skippedEngines: report.skippedEngines,
              ...report.summary,
              acrossEngines: report.acrossEngines,
            }) + "\n"
          );
        }
      } else if (parsed.json) {
        // --json branches on format.
        if (parsed.format === "geo-audit") {
          console.log(JSON.stringify(toGeoAuditOutputMulti(report), null, 2));
        } else {
          console.log(renderMultiCheckJson(report));
        }
      } else {
        console.log(
          renderMultiCheckHuman(report, {
            colors,
            narrow: parsed.narrow,
          })
        );
      }

      if (parsed.out) {
        try {
          // --out always writes the stable multi-engine report shape,
          // regardless of --format. The on-disk artifact is meant to
          // round-trip with downstream JSON consumers expecting the
          // canonical shape.
          await writeFile(parsed.out, renderMultiCheckJson(report), "utf8");
        } catch (err) {
          console.error(
            `auto-geo check: warning — could not write --out ${parsed.out}: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }

      // If max-runtime tripped, signal that via exit code 2 even if
      // some coverage was achieved before the deadline — surfaces the
      // truncated run to CI.
      const skippedByDeadline = Object.values(report.perEngine).some((r) =>
        r.results.some((q) => q.error === "skipped — max runtime exceeded")
      );
      if (skippedByDeadline) return 2;
      return report.summary.unionCoveragePct > 0 ? 0 : 1;
    }

    // Single-engine path. Fail fast if the user explicitly named an
    // engine whose key isn't set — better than letting the adapter
    // throw an opaque error mid-run.
    if (!engineHasCredentials(engineName as EngineName)) {
      const envVar = ENGINE_ENV_VARS[engineName as EngineName];
      console.error(
        `auto-geo check: --engine ${engineName} requires ${envVar} to be set in the environment.`
      );
      return 2;
    }

    const engine = createEngine(engineName as EngineName, {
      model: parsed.model,
    });
    // Now that the engine is built we can wire engineMeta into the
    // per-row hook — needed by `--format geo-audit --ndjson` so each
    // streamed row carries the provider + model labels.
    const onResult = makeOnResultHandler(parsed, {
      engine: engine.name,
      model: engine.model,
    });
    const report = await runCheck({
      domain: parsed.domain,
      queries,
      engine,
      concurrency: parsed.concurrency,
      timeoutPerQuerySec: parsed.timeoutPerQuerySec,
      maxRuntimeSec: parsed.maxRuntimeSec,
      onResult,
    });

    if (parsed.ndjson) {
      // Streamed already via onResult — only emit the summary line.
      if (parsed.format === "geo-audit") {
        const ga = toGeoAuditOutput(report);
        process.stdout.write(
          JSON.stringify({
            _summary: true,
            domain: report.domain,
            engine: report.engine,
            model: report.model,
            ...report.summary,
            ...ga.summary,
          }) + "\n"
        );
      } else {
        process.stdout.write(
          JSON.stringify({
            _summary: true,
            domain: report.domain,
            engine: report.engine,
            model: report.model,
            ...report.summary,
          }) + "\n"
        );
      }
    } else if (parsed.json) {
      if (parsed.format === "geo-audit") {
        console.log(JSON.stringify(toGeoAuditOutput(report), null, 2));
      } else {
        console.log(renderCheckJson(report));
      }
    } else {
      console.log(
        renderCheckHuman(report, {
          colors,
          narrow: parsed.narrow,
          answer: parsed.answers,
        })
      );
    }

    if (parsed.out) {
      try {
        // --out always writes the stable CheckReport shape; --format is
        // a stdout-only switch.
        await writeFile(parsed.out, renderCheckJson(report), "utf8");
      } catch (err) {
        console.error(
          `auto-geo check: warning — could not write --out ${parsed.out}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    // --max-runtime tripped → exit 2 even if coverage > 0 in the
    // partial run; surfaces the truncated result to CI.
    const skippedByDeadline = report.results.some(
      (r) => r.error === "skipped — max runtime exceeded"
    );
    if (skippedByDeadline) return 2;
    return report.summary.coveragePct > 0 ? 0 : 1;
  } catch (err) {
    if (parsed.json) {
      console.log(
        JSON.stringify(
          {
            domain: parsed.domain,
            error: err instanceof Error ? err.message : String(err),
          },
          null,
          2
        )
      );
    } else if (parsed.ndjson) {
      // Emit an error-tagged line so consumers tailing the stream see
      // SOMETHING rather than an EOF mid-stream.
      process.stdout.write(
        JSON.stringify({
          _error: true,
          domain: parsed.domain,
          error: err instanceof Error ? err.message : String(err),
        }) + "\n"
      );
    } else {
      console.error(
        `auto-geo check: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    return 1;
  }
}

/**
 * Build the per-result hook passed to `runCheck`. The hook drives the
 * two agent-facing affordances:
 *   1. `--ndjson` — one JSON object per line to stdout AS each query
 *      resolves (no per-engine attribution in single-engine mode).
 *   2. Live progress in human / `--json`-quiet mode — a one-line
 *      `[i/N] ✓/✗ "query" — …` status to stderr so 50-query runs
 *      don't go silent and force a downstream agent to give up. Under
 *      `--json` we stay silent (that mode is "one single object").
 *
 * `engineMeta` is required for `--format geo-audit --ndjson`, because
 * each row needs the provider and model labels baked in. Optional in
 * the default-format path (the default line carries them implicitly).
 */
function makeOnResultHandler(
  parsed: CheckArgs,
  engineMeta?: { engine: string; model: string }
) {
  return function onResult(
    result: import("./check").CheckQueryResult,
    completed: number,
    total: number
  ): void {
    if (parsed.ndjson) {
      // Stream the result to stdout — branch on --format.
      if (parsed.format === "geo-audit") {
        if (engineMeta) {
          process.stdout.write(
            JSON.stringify(
              makeNdjsonGeoAuditLine(result, {
                provider: engineMeta.engine,
                model: engineMeta.model,
              })
            ) + "\n"
          );
        }
        // No engineMeta means the caller (multi-engine path) is
        // handling per-row emission itself with engine attribution.
      } else {
        process.stdout.write(
          JSON.stringify(formatNdjsonResultLine(result)) + "\n"
        );
      }
      return;
    }
    if (parsed.json) return; // pure JSON mode is silent until the final object
    // Human / progress mode → stderr.
    const mark = result.error ? "!" : result.cited ? "\u2713" : "\u2717";
    const queryLabel = JSON.stringify(result.query);
    const sourceCount = result.rawSources.length;
    let detail: string;
    if (result.error) {
      detail = `error: ${result.error}`;
    } else if (result.cited) {
      detail = `cited (${result.citations.length} source${
        result.citations.length === 1 ? "" : "s"
      })`;
    } else {
      detail = `not cited (${sourceCount} source${
        sourceCount === 1 ? "" : "s"
      })`;
    }
    process.stderr.write(
      `  [${completed}/${total}] ${mark} ${queryLabel} \u2014 ${detail}\n`
    );
  };
}

/**
 * Per-query line shape for `--ndjson`. Stable for downstream
 * consumers — fields are additive only.
 */
function formatNdjsonResultLine(
  result: import("./check").CheckQueryResult,
  engine?: string
) {
  const line: Record<string, unknown> = {
    query: result.query,
    cited: result.cited,
    citations: result.citations,
    rawSources: result.rawSources,
    answer: result.answer,
    timestamp: new Date().toISOString(),
  };
  if (engine) line.engine = engine;
  if (result.usage) line.usage = result.usage;
  if (result.error) line.error = result.error;
  return line;
}

async function resolveAuthor(parsed: WriteArgs): Promise<ResourceAuthor> {
  const out: ResourceAuthor = { ...DEFAULT_AUTHOR };
  if (parsed.authorName) out.name = parsed.authorName;
  if (parsed.authorJobTitle) out.jobTitle = parsed.authorJobTitle;
  if (parsed.authorLinkedin) out.linkedinUrl = parsed.authorLinkedin;
  if (parsed.authorBio) {
    if (parsed.authorBio.startsWith("@")) {
      const filePath = parsed.authorBio.slice(1);
      out.bio = (await readFile(filePath, "utf8")).trim();
    } else {
      out.bio = parsed.authorBio;
    }
  }
  return out;
}

/**
 * Resolve a `LanguageModel` from the requested provider + model name.
 * Dynamic-import so the AI SDK packages aren't loaded unless the user
 * actually invokes the write command (keeps `doctor` startup fast and
 * keeps the lib build free of these deps).
 *
 * The provider packages are bundled into `dist/cli/bin.js` at build
 * time so npx-installed users don't need to install them separately;
 * the dynamic import is a code-path gate, not a load-time gate.
 */
async function resolveModel(provider: ProviderId, modelName: string) {
  if (provider === "openai") {
    const key = process.env.OPENAI_API_KEY;
    if (!key) {
      throw new Error(
        "OPENAI_API_KEY is not set. Export it or pass --provider anthropic with ANTHROPIC_API_KEY set."
      );
    }
    const { createOpenAI } = await import("@ai-sdk/openai");
    return createOpenAI({ apiKey: key })(modelName);
  }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Export it or pass --provider openai with OPENAI_API_KEY set."
    );
  }
  const { createAnthropic } = await import("@ai-sdk/anthropic");
  return createAnthropic({ apiKey: key })(modelName);
}

// ── helpers ───────────────────────────────────────────────────────

function shouldUseColor(color: boolean, json: boolean): boolean {
  if (!color) return false;
  if (json) return false;
  if (process.env.NO_COLOR) return false;
  return Boolean(process.stdout?.isTTY);
}

function formatYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ── init runner ───────────────────────────────────────────────────

async function runInitCommand(parsed: InitArgs): Promise<number> {
  const colors = shouldUseColor(parsed.color, parsed.json);
  try {
    const outcome = await runInit({ yes: parsed.yes, force: parsed.force });
    if (parsed.json) {
      console.log(renderInitJson(outcome));
    } else {
      console.log(renderInitOutcome(outcome, { colors }));
    }
    return outcome.refusedExisting ? 1 : 0;
  } catch (err) {
    if (parsed.json) {
      console.log(
        JSON.stringify(
          { error: err instanceof Error ? err.message : String(err) },
          null,
          2
        )
      );
    } else {
      console.error(
        `auto-geo init: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    return 1;
  }
}
