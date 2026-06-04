/* eslint-disable no-console */
import { readFile, writeFile } from "node:fs/promises";
import { createEngine, runCheck, type EngineName } from "./check";
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
import { renderCheckHuman, renderCheckJson } from "./render";
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
  --no-color       Disable ANSI colors
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
  --engine <name>         perplexity (default), openai (stub)
  --model <name>          Engine-specific model (default sonar for perplexity)
  --concurrency N         Parallel queries (default 2)
  --json                  Machine-readable output
  --out <path>            Also write full report to this path

  Env: PERPLEXITY_API_KEY (perplexity), OPENAI_API_KEY (openai)
  Exit code: 0 if coverage > 0%, 1 if 0%.

Docs: https://github.com/shadowresearch/auto-geo
`;

// ── Parsed-args types ─────────────────────────────────────────────

export type DoctorArgs = {
  command: "doctor";
  url?: string;
  site?: string;
  json: boolean;
  color: boolean;
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
  color: boolean;
};

export type HelpArgs = {
  command: "help";
  // Carry the json + color flags so the help path is consistent with
  // the rest of the parser; not used by callers.
  json: boolean;
  color: boolean;
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
    return { command: "help", json: false, color: true };
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
  };

  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--json") args.json = true;
    else if (a === "--no-color") args.color = false;
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
    color: true,
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
    else if (a === "--domain") args.domain = requireValue("--domain");
    else if (a === "--query") args.queries.push(requireValue("--query"));
    else if (a === "--queries-file")
      args.queriesFile = requireValue("--queries-file");
    else if (a === "--engine") args.engine = requireValue("--engine");
    else if (a === "--model") args.model = requireValue("--model");
    else if (a === "--out") args.out = requireValue("--out");
    else if (a === "--concurrency") {
      const n = Number(requireValue("--concurrency"));
      if (!Number.isFinite(n) || n <= 0)
        throw new Error("--concurrency requires a positive number");
      args.concurrency = n;
    } else if (a.startsWith("--")) {
      throw new Error(`unknown flag: ${a}`);
    } else {
      throw new Error(
        `unexpected positional argument: ${a} (check uses --domain / --query)`
      );
    }
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
    const out = renderReport(report, { json: parsed.json, colors });
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
    const out = renderSitemapReport(report, { json: parsed.json, colors });
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
      : renderFixHuman(outcome, { colors });
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
      console.log(renderWriteSummary(summary, { colors }));
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
  const colors = shouldUseColor(parsed.color, parsed.json);

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

  const engineName = parsed.engine;
  if (engineName === "all") {
    // TODO: enable when openai engine is fully implemented
    console.error(
      "auto-geo check: --engine all is reserved for a future release once the OpenAI adapter ships. Use --engine perplexity for now."
    );
    return 2;
  }
  if (engineName !== "perplexity" && engineName !== "openai") {
    console.error(
      `auto-geo check: unknown --engine ${engineName}. Supported: perplexity, openai (stub).`
    );
    return 2;
  }

  try {
    const engine = createEngine(engineName as EngineName, {
      model: parsed.model,
    });
    const report = await runCheck({
      domain: parsed.domain,
      queries,
      engine,
      concurrency: parsed.concurrency,
    });

    const out = parsed.json
      ? renderCheckJson(report)
      : renderCheckHuman(report, { colors });
    console.log(out);

    if (parsed.out) {
      try {
        await writeFile(parsed.out, renderCheckJson(report), "utf8");
      } catch (err) {
        console.error(
          `auto-geo check: warning — could not write --out ${parsed.out}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

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
    } else {
      console.error(
        `auto-geo check: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    return 1;
  }
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
