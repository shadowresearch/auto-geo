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
import type { LlmProvider, ProviderId } from "./llm";
import type { ResourceAuthor } from "../core/schema";

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

const USAGE = `auto-geo — GEO publishing engine CLI

Usage:
  auto-geo doctor <url>                Audit a page for citation readiness
  auto-geo doctor --site <sitemap>     Audit every URL in an XML sitemap
  auto-geo fix <url>                   LLM-driven GEO rewrite of an existing page
  auto-geo write --domain <url> --query <q> [...]
                                       Generate resource pages from queries
  auto-geo check --domain <d> --query <q> [...]
                                       Measure if AI engines cite your domain
  auto-geo --help                      Show this message

doctor flags:
  --json           Emit machine-readable JSON
  --no-color       Disable ANSI colors and box-drawing glyphs
  --narrow         Tighten layout for <80 col terminals (auto-detected)
  --max-pages N    Cap pages audited from --site mode (default 100)
  --concurrency N  Concurrent fetches in --site mode (default 5)

  Exit code: 0 if score ≥ 75%, 1 otherwise.

fix flags:
  --out <path>            Output file (default ./fixed.json)
  --provider openai|anthropic    LLM provider (default openai)
  --model <name>          Model (default gpt-4o-mini)
  --max-retries N         Self-correction retries on schema fail (default 2)
  --dry-run               Fetch + audit + estimate cost, skip LLM call
  --json                  Emit machine-readable JSON
  --basepath <path>       Publish base path for URL preview (default /resources)
  --author-name <text>    Author name (propagated into payload)
  --author-jobtitle <t>   Author job title
  --author-bio <text>     Author bio (≥20 chars; required by the schema)
  --author-linkedin <url> Author LinkedIn URL (optional)

  Env: OPENAI_API_KEY (openai), ANTHROPIC_API_KEY (anthropic)
  Exit code: 0 on success, 1 on failure.

write flags:
  --domain <url>          Publisher domain (required)
  --query <text>          Target query (required, repeatable)
  --queries-file <path>   Newline-separated file of queries
  --out <dir>             Output directory (default ./out)
  --provider openai|anthropic    LLM provider (default openai)
  --model <name>          Model (default gpt-4o-mini / claude-sonnet-4-6)
  --basepath <path>       Resource URL path (default /resources)
  --author-name <text>    Author name (default Shadow Research)
  --author-jobtitle <t>   Author job title
  --author-bio <text>     Author bio (text or @path-to-bio.txt)
  --author-linkedin <url> Author LinkedIn URL
  --max-retries N         Schema-validation retries (default 2)
  --concurrency N         Parallel LLM calls (default 2)
  --dry-run               Show plan + cost estimate, no LLM calls
  --json                  Machine-readable summary

  Env: OPENAI_API_KEY (openai), ANTHROPIC_API_KEY (anthropic)

check flags:
  --domain <d>            Bare host (shadow.inc) or full origin. Required.
  --query <text>          Target query (repeatable)
  --queries-file <path>   Newline-separated file of queries
  --engine <name>         perplexity (default), openai, anthropic, gemini,
                          xai (alias: grok), all
  --model <name>          Engine-specific model (default sonar for perplexity)
  --concurrency N         Parallel queries (default 6)
  --answers <mode>        Render the engine's answer under each query in
                          human output: none, preview (default, ~3 sentences),
                          or full. Ignored under --json / --ndjson.
  --json                  One single JSON object on stdout when the run completes
  --ndjson                Stream one JSON object per line to stdout AS each
                          query resolves; final line is the summary tagged
                          {"_summary":true,…}. Mutually exclusive with --json.
                          Use this for piping into agents / dashboards on big
                          runs (50+ queries).
  --timeout-per-query N   Per-query outer timeout in seconds (default 60).
                          A query that exceeds this is marked errored; the
                          rest of the run continues.
  --max-runtime N         Whole-run timeout in seconds (default: no cap).
                          When exceeded, remaining queries are marked
                          skipped, partial results are still emitted, and
                          the process exits with code 2.
  --out <path>            Also write full report to this path

  Engine env vars:
    perplexity → PERPLEXITY_API_KEY
    openai     → OPENAI_API_KEY
    anthropic  → ANTHROPIC_API_KEY
    gemini     → GOOGLE_API_KEY (or GEMINI_API_KEY)
    xai/grok   → XAI_API_KEY

  --engine all runs every engine whose API key is present in env, and
  reports per-engine coverage plus a union roll-up.

  Exit code: 0 if coverage > 0%, 1 if 0%, 2 if --max-runtime tripped.

Docs: https://github.com/shadowresearch/auto-geo
`;

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
  timeoutPerQuerySec?: number;
  maxRuntimeSec?: number;
  color: boolean;
  narrow: boolean;
};

export type HelpArgs = {
  command: "help";
  // Carry the json + color + narrow flags so the help path is
  // consistent with the rest of the parser; not used by callers.
  json: boolean;
  color: boolean;
  narrow: boolean;
};

export type ParsedArgs =
  | DoctorArgs
  | FixArgs
  | WriteArgs
  | CheckArgs
  | HelpArgs;

// ── Dispatcher ────────────────────────────────────────────────────

export function parseArgs(argv: string[]): ParsedArgs {
  // Surface --help fast — works at any position, before subcommand.
  if (argv.includes("--help") || argv.includes("-h")) {
    return { command: "help", json: false, color: true, narrow: false };
  }

  const first = argv[0];
  if (first === "write") return parseWriteArgs(argv.slice(1));
  if (first === "fix") return parseFixArgs(argv.slice(1));
  if (first === "check") return parseCheckArgs(argv.slice(1));
  if (first === "doctor") return parseDoctorArgs(argv.slice(1));
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
    model: "gpt-4o-mini",
    maxRetries: 2,
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

const DEFAULT_MODEL_BY_PROVIDER: Record<ProviderId, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-sonnet-4-6",
};

export function parseWriteArgs(argv: string[]): WriteArgs {
  const args: WriteArgs = {
    command: "write",
    queries: [],
    out: "./out",
    provider: "openai",
    basePath: "/resources",
    maxRetries: 2,
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

export function getUsage(): string {
  return USAGE;
}

// ── Entry ─────────────────────────────────────────────────────────

export async function run(argv: string[]): Promise<number> {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(argv);
  } catch (err) {
    console.error(
      `auto-geo: ${err instanceof Error ? err.message : String(err)}`
    );
    console.error("");
    console.error(USAGE);
    return 2;
  }

  if (parsed.command === "help") {
    console.log(USAGE);
    return 0;
  }
  if (parsed.command === "doctor") return runDoctorCommand(parsed);
  if (parsed.command === "fix") return runFixCommand(parsed);
  if (parsed.command === "write") return runWriteCommand(parsed);
  if (parsed.command === "check") return runCheckCommand(parsed);

  // Exhaustive check.
  console.error(USAGE);
  return 2;
}

// ── doctor runner ─────────────────────────────────────────────────

async function runDoctorCommand(parsed: DoctorArgs): Promise<number> {
  if (parsed.site) return runSiteMode(parsed);
  if (parsed.url) return runSingleMode(parsed);
  console.error("auto-geo: missing URL argument\n");
  console.error(USAGE);
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
    console.error("auto-geo fix: missing URL argument\n");
    console.error(USAGE);
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
    console.error("auto-geo write: --domain is required\n");
    console.error(USAGE);
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
      "auto-geo write: at least one --query (or --queries-file) is required\n"
    );
    console.error(USAGE);
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
    console.error("auto-geo check: --domain is required\n");
    console.error(USAGE);
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
      "auto-geo check: at least one --query or --queries-file is required\n"
    );
    console.error(USAGE);
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
  // single object, nothing else".
  const onResult = makeOnResultHandler(parsed);

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
      } else {
        const out = parsed.json
          ? renderMultiCheckJson(report)
          : renderMultiCheckHuman(report, {
              colors,
              narrow: parsed.narrow,
            });
        console.log(out);
      }

      if (parsed.out) {
        try {
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
      process.stdout.write(
        JSON.stringify({
          _summary: true,
          domain: report.domain,
          engine: report.engine,
          model: report.model,
          ...report.summary,
        }) + "\n"
      );
    } else {
      const out = parsed.json
        ? renderCheckJson(report)
        : renderCheckHuman(report, {
            colors,
            narrow: parsed.narrow,
            answer: parsed.answers,
          });
      console.log(out);
    }

    if (parsed.out) {
      try {
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
 */
function makeOnResultHandler(parsed: CheckArgs) {
  return function onResult(
    result: import("./check").CheckQueryResult,
    completed: number,
    total: number
  ): void {
    if (parsed.ndjson) {
      // Stream the result to stdout.
      process.stdout.write(
        JSON.stringify(formatNdjsonResultLine(result)) + "\n"
      );
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
