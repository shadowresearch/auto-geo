import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  bold,
  detectNarrow,
  dim,
  glyphs,
  indent,
  stripAnsi,
  type UiOptions,
} from "./ui";

/**
 * Centralized help rendering for the `auto-geo` CLI.
 *
 * The v0.4.1 and earlier CLI dumped a single ~120-line USAGE string for
 * every error and `--help` invocation. On narrow terminals the wrap
 * mangled flag tokens (`--doin <d>` for `--domain`, `--author-nametext>`
 * for `--author-name <text>`) because ANSI / glyph characters leaked
 * into the wrapped strings and lines were never re-indented.
 *
 * This module replaces that with:
 *   - A focused, per-command help renderer that emits only that
 *     command's flags / examples / env vars.
 *   - A compact global help (`auto-geo` alone or `auto-geo --help`) with
 *     one-line summaries per subcommand.
 *   - A width-resilient layout: every long description wraps at terminal
 *     width with a hanging indent so the flag column stays aligned.
 *   - Plain-text measurement: all wrapping is performed on the ANSI-free
 *     string, then colors are applied AFTER, so escape codes can't break
 *     the width math.
 *
 * Help content is defined as data (`COMMAND_HELP`), not as pre-formatted
 * strings. The renderer walks the structure — easy to maintain, easy to
 * test (assert against the data, not byte-exact output).
 */

// ── Constants ──────────────────────────────────────────────────────

export const REPO_URL = "https://github.com/shadowresearch/auto-geo";
export const NPM_URL = "https://www.npmjs.com/package/auto-geo";
export const SHADOW_URL = "https://www.shadow.inc";
export const GLOBAL_TAGLINE = "publishing engine for GEO resource pages";

export type CommandName = "init" | "doctor" | "fix" | "write" | "check";

// Ordering matters — renderGlobalHelp iterates this object's keys to
// render the "Commands:" block, and we want users to read it in
// workflow order: set up once with `init`, then audit (`doctor`),
// generate (`write`), improve (`fix`), and measure (`check`).
const COMMAND_SUMMARIES: Record<CommandName, string> = {
  init: "Scaffold auto-geo.config.json + .env.local for first-run setup",
  doctor: "Audit a page for citation readiness",
  write: "Generate publish-ready resource pages from target queries",
  fix: "Rewrite a page so it passes the doctor checks",
  check:
    "Measure if AI engines (Perplexity / OpenAI / Claude / Gemini / Grok) cite your domain",
};

// ── Data model ─────────────────────────────────────────────────────

export type FlagItem = {
  /** e.g. `--domain <d>` */
  flag: string;
  description: string;
};

export type HelpSection = {
  heading: string;
  items: FlagItem[];
};

export type EnvVarEntry = {
  /** Left side (e.g. `perplexity`). */
  label: string;
  /** Right side (e.g. `PERPLEXITY_API_KEY`). */
  envVar: string;
};

export type ExampleBlock = {
  /** Optional `# comment` above the command. */
  comment?: string;
  /** Command line, may contain `\` continuations as separate array entries. */
  lines: string[];
};

export type CommandHelp = {
  command: CommandName;
  tagline: string;
  /** Usage synopses — first is the primary signature. */
  usage: string[];
  sections: HelpSection[];
  envVars?: EnvVarEntry[];
  examples?: ExampleBlock[];
  /** Plain-text "Exit code: …" line, rendered dim under examples. */
  exitCode?: string;
  /** Trailing note rendered above the docs link (e.g. multi-engine note). */
  note?: string;
  docsUrl: string;
};

// ── Help content (the single source of truth for every renderer) ───

export const COMMAND_HELP: Record<CommandName, CommandHelp> = {
  init: {
    command: "init",
    tagline: "scaffold auto-geo.config.json + .env.local for first-run setup",
    usage: ["auto-geo init [options]"],
    sections: [
      {
        heading: "Options",
        items: [
          {
            flag: "-y, --yes",
            description:
              "Non-interactive — write a template config without prompting",
          },
          {
            flag: "--force",
            description: "Overwrite an existing auto-geo.config.json",
          },
          {
            flag: "--json",
            description: "Emit a machine-readable outcome",
          },
          {
            flag: "--no-color",
            description: "Disable ANSI colors",
          },
        ],
      },
    ],
    examples: [
      {
        comment: "Interactive setup — answer a handful of questions",
        lines: ["auto-geo init"],
      },
      {
        comment: "Non-interactive — drop a template file you'll edit by hand",
        lines: ["auto-geo init --yes"],
      },
    ],
    note: "Never overwrites an existing .env.local. API keys NEVER live in the config file — they stay in .env.local (gitignored).",
    exitCode:
      "Exit code: 0 on success, 1 if the config already exists (use --force).",
    docsUrl:
      "https://github.com/shadowresearch/auto-geo/blob/main/docs/init.md",
  },
  doctor: {
    command: "doctor",
    tagline: "audit a page for citation readiness",
    usage: ["auto-geo doctor <url>", "auto-geo doctor --site <sitemap-url>"],
    sections: [
      {
        heading: "Required",
        items: [
          {
            flag: "<url>",
            description: "Page URL to audit. Mutually exclusive with --site.",
          },
          {
            flag: "--site <url>",
            description: "XML sitemap URL — audits every page it lists.",
          },
        ],
      },
      {
        heading: "Sitemap mode",
        items: [
          {
            flag: "--max-pages N",
            description: "Cap pages audited from --site mode (default 100)",
          },
          {
            flag: "--concurrency N",
            description: "Concurrent fetches in --site mode (default 5)",
          },
        ],
      },
      {
        heading: "Output",
        items: [
          {
            flag: "--json",
            description: "Emit a machine-readable JSON report",
          },
          {
            flag: "--no-color",
            description: "Disable ANSI colors and box-drawing glyphs",
          },
          {
            flag: "--narrow",
            description:
              "Tighten layout for narrow terminals (auto-detected under 80 cols)",
          },
        ],
      },
    ],
    examples: [
      {
        comment: "Audit a single page",
        lines: ["auto-geo doctor https://example.com/resources/what-is-geo"],
      },
      {
        comment: "Audit every URL in a sitemap, cap at 50 pages",
        lines: [
          "auto-geo doctor --site https://example.com/sitemap.xml --max-pages 50",
        ],
      },
    ],
    exitCode: "Exit code: 0 if score >= 75%, 1 otherwise.",
    docsUrl:
      "https://github.com/shadowresearch/auto-geo/blob/main/docs/doctor.md",
  },
  fix: {
    command: "fix",
    tagline: "LLM-driven GEO rewrite of an existing page",
    usage: ["auto-geo fix <url> [options]"],
    sections: [
      {
        heading: "Required",
        items: [
          {
            flag: "<url>",
            description: "Page URL to fetch, audit, and rewrite.",
          },
        ],
      },
      {
        heading: "LLM",
        items: [
          {
            flag: "--provider <id>",
            description: "openai (default) or anthropic",
          },
          {
            flag: "--model <name>",
            description:
              "Model name (default gpt-5.4 for openai, claude-sonnet-4-6 for anthropic)",
          },
          {
            flag: "--max-retries N",
            description:
              "Self-correction retries on schema validation failure (default 2)",
          },
          {
            flag: "--dry-run",
            description: "Fetch + audit + estimate cost; skip the LLM call",
          },
        ],
      },
      {
        heading: "Author",
        items: [
          {
            flag: "--author-name <text>",
            description: "Author name (propagated into payload)",
          },
          { flag: "--author-jobtitle <text>", description: "Author job title" },
          {
            flag: "--author-bio <text>",
            description: "Author bio (>=20 chars; required by the schema)",
          },
          {
            flag: "--author-linkedin <url>",
            description: "Author LinkedIn URL (optional)",
          },
        ],
      },
      {
        heading: "Output",
        items: [
          {
            flag: "--out <path>",
            description: "Output file path (default ./fixed.json)",
          },
          {
            flag: "--basepath <path>",
            description:
              "Publish base path for URL preview (default /resources)",
          },
          { flag: "--json", description: "Emit machine-readable JSON" },
          {
            flag: "--no-color",
            description: "Disable ANSI colors and box-drawing glyphs",
          },
          {
            flag: "--narrow",
            description: "Tighten layout for narrow terminals",
          },
        ],
      },
    ],
    envVars: [
      { label: "openai", envVar: "OPENAI_API_KEY" },
      { label: "anthropic", envVar: "ANTHROPIC_API_KEY" },
    ],
    examples: [
      {
        comment: "Default openai fix; writes ./fixed.json",
        lines: ["auto-geo fix https://example.com/blog/what-is-geo"],
      },
      {
        comment: "Anthropic provider, dry-run to estimate cost",
        lines: [
          "auto-geo fix https://example.com/blog/what-is-geo \\",
          "  --provider anthropic --dry-run",
        ],
      },
    ],
    exitCode: "Exit code: 0 on success, 1 on failure.",
    docsUrl: "https://github.com/shadowresearch/auto-geo/blob/main/docs/fix.md",
  },
  write: {
    command: "write",
    tagline: "generate publish-ready resource pages from target queries",
    usage: [
      "auto-geo write --domain <url> --query <q> [--query <q> ...]",
      "auto-geo write --domain <url> --queries-file <path>",
    ],
    sections: [
      {
        heading: "Required",
        items: [
          {
            flag: "--domain <url>",
            description:
              "Publisher domain (full URL — must start with http(s)://)",
          },
        ],
      },
      {
        heading: "Queries",
        items: [
          { flag: "--query <text>", description: "Target query (repeatable)" },
          {
            flag: "--queries-file <path>",
            description: "Newline-separated file of queries (# lines ignored)",
          },
        ],
      },
      {
        heading: "LLM",
        items: [
          {
            flag: "--provider <id>",
            description: "openai (default) or anthropic",
          },
          {
            flag: "--model <name>",
            description:
              "Model (default gpt-5.4 for openai, claude-sonnet-4-6 for anthropic)",
          },
          {
            flag: "--max-retries N",
            description: "Schema-validation retries (default 3)",
          },
          {
            flag: "--concurrency N",
            description: "Parallel LLM calls (default 2)",
          },
          {
            flag: "--dry-run",
            description: "Show plan + cost estimate; no LLM calls",
          },
        ],
      },
      {
        heading: "Author",
        items: [
          {
            flag: "--author-name <text>",
            description: "Author name (default Shadow Research)",
          },
          { flag: "--author-jobtitle <text>", description: "Author job title" },
          {
            flag: "--author-bio <text>",
            description: "Author bio (text or @path-to-bio.txt)",
          },
          {
            flag: "--author-linkedin <url>",
            description: "Author LinkedIn URL",
          },
        ],
      },
      {
        heading: "Output",
        items: [
          {
            flag: "--out <dir>",
            description: "Output directory (default ./out)",
          },
          {
            flag: "--basepath <path>",
            description: "Resource URL path (default /resources)",
          },
          { flag: "--json", description: "Machine-readable summary" },
          {
            flag: "--no-color",
            description: "Disable ANSI colors and box-drawing glyphs",
          },
          {
            flag: "--narrow",
            description: "Tighten layout for narrow terminals",
          },
        ],
      },
    ],
    envVars: [
      { label: "openai", envVar: "OPENAI_API_KEY" },
      { label: "anthropic", envVar: "ANTHROPIC_API_KEY" },
    ],
    examples: [
      {
        comment: "Generate one page",
        lines: [
          'auto-geo write --domain https://shadow.inc --query "what is GEO"',
        ],
      },
      {
        comment: "Batch generate from a query file (anthropic, concurrent)",
        lines: [
          "auto-geo write --domain https://shadow.inc \\",
          "  --queries-file queries.txt \\",
          "  --provider anthropic --concurrency 4",
        ],
      },
    ],
    docsUrl:
      "https://github.com/shadowresearch/auto-geo/blob/main/docs/write.md",
  },
  check: {
    command: "check",
    tagline: "measure citation coverage in AI search engines",
    usage: [
      "auto-geo check --domain <d> --query <q> [--query <q> ...]",
      "auto-geo check --domain <d> --queries-file <path>",
    ],
    sections: [
      {
        heading: "Required",
        items: [
          {
            flag: "--domain <d>",
            description: "Bare host (shadow.inc) or full origin",
          },
        ],
      },
      {
        heading: "Queries",
        items: [
          { flag: "--query <text>", description: "Target query (repeatable)" },
          {
            flag: "--queries-file <path>",
            description: "Newline-separated file of queries",
          },
        ],
      },
      {
        heading: "Engines",
        items: [
          {
            flag: "--engine <name>",
            description:
              "perplexity (default), openai, anthropic, gemini, xai (alias: grok), all",
          },
          {
            flag: "--model <name>",
            description:
              "Engine-specific model override (default sonar for perplexity)",
          },
        ],
      },
      {
        heading: "Performance",
        items: [
          {
            flag: "--concurrency N",
            description:
              "Parallel queries per engine (default 12; recommended cap ~20)",
          },
          {
            flag: "--timeout-per-query N",
            description: "Per-query outer timeout in seconds (default 60)",
          },
          {
            flag: "--max-runtime N",
            description: "Whole-run cap in seconds (no default)",
          },
        ],
      },
      {
        heading: "Output",
        items: [
          {
            flag: "--json",
            description: "Single-object machine-readable report",
          },
          {
            flag: "--ndjson",
            description:
              "Per-line streaming (one JSON per query + a _summary line)",
          },
          {
            flag: "--format <id>",
            description:
              "auto-geo (default) | geo-audit (LlmQueryResult shape for parity with Shadow's in-product geoAudit tool)",
          },
          {
            flag: "--answers <mode>",
            description: "none | preview (default) | full",
          },
          {
            flag: "--out <path>",
            description: "Also write the full JSON report to this path",
          },
          {
            flag: "--no-color",
            description: "Disable ANSI colors and box-drawing glyphs",
          },
          {
            flag: "--narrow",
            description: "Tighten layout for narrow terminals",
          },
        ],
      },
    ],
    envVars: [
      { label: "perplexity", envVar: "PERPLEXITY_API_KEY" },
      { label: "openai", envVar: "OPENAI_API_KEY" },
      { label: "anthropic", envVar: "ANTHROPIC_API_KEY" },
      {
        label: "gemini",
        envVar: "GOOGLE_API_KEY (fallback GEMINI_API_KEY)",
      },
      { label: "xai/grok", envVar: "XAI_API_KEY" },
    ],
    examples: [
      {
        comment: "Single query against the default engine (Perplexity)",
        lines: ['auto-geo check --domain shadow.inc --query "what is GEO"'],
      },
      {
        comment: "50 queries from a file, streaming output, max throughput",
        lines: [
          "auto-geo check --domain shadow.inc --queries-file queries.txt \\",
          "  --engine perplexity --ndjson --concurrency 10",
        ],
      },
      {
        comment: "Run every engine whose API key is in env, get union coverage",
        lines: [
          'auto-geo check --domain shadow.inc --query "what is GEO" --engine all',
        ],
      },
    ],
    note: "--engine all runs every engine whose API key is present in env, and reports per-engine coverage plus a union roll-up.",
    exitCode:
      "Exit code: 0 if coverage > 0%, 1 if 0%, 2 if --max-runtime tripped.",
    docsUrl:
      "https://github.com/shadowresearch/auto-geo/blob/main/docs/check.md",
  },
};

// ── Version ───────────────────────────────────────────────────────

/**
 * Cached package version read from package.json. Resolved lazily so a
 * test or library import doesn't pay for the file-read.
 */
let cachedVersion: string | undefined;

/**
 * Resolve the package version from disk at runtime. The CLI ships its
 * own `package.json` next to `dist/cli/bin.js` (npm packs the file),
 * so walking up from the source/built file lands on it whether the
 * caller invoked the TS source (tests / `tsx`) or the built bin.
 */
export async function getPackageVersion(): Promise<string> {
  if (cachedVersion) return cachedVersion;
  // Walk up from this file looking for the nearest package.json with
  // `"name": "auto-geo"`. This file lives at `cli/help.ts` in source
  // and `dist/cli/help.js` in the built package, so we may need to
  // walk up 2–3 levels.
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "..", "package.json"),
    join(here, "..", "..", "package.json"),
    join(here, "..", "..", "..", "package.json"),
  ];
  for (const candidate of candidates) {
    try {
      const raw = await readFile(candidate, "utf8");
      const parsed = JSON.parse(raw) as { name?: string; version?: string };
      if (parsed.name === "auto-geo" && typeof parsed.version === "string") {
        cachedVersion = parsed.version;
        return cachedVersion;
      }
    } catch {
      // Try the next candidate.
    }
  }
  // Last-resort fallback so the CLI never crashes for a missing
  // package.json (e.g. an unusual install layout). Keeps `--version`
  // working even if the lookup fails.
  cachedVersion = "0.0.0";
  return cachedVersion;
}

/** Reset the cached version. Test-only helper. */
export function _resetVersionCacheForTests(): void {
  cachedVersion = undefined;
}

export async function renderVersion(): Promise<string> {
  const v = await getPackageVersion();
  return `auto-geo v${v}`;
}

// ── Wrapping (the core of the width-resilience fix) ────────────────

/**
 * Word-wrap a plain (un-colored) string to a max width. Returns one
 * line per output row. Empty input → `[""]` so callers always have
 * something to emit. Words longer than `width` are emitted on their
 * own line rather than truncated — better to overflow once than to
 * mangle the token.
 */
export function wrap(text: string, width: number): string[] {
  if (width <= 0) return [text];
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const out: string[] = [];
  let line = "";
  for (const w of words) {
    if (!line.length) {
      line = w;
      continue;
    }
    if (line.length + 1 + w.length <= width) {
      line += " " + w;
    } else {
      out.push(line);
      line = w;
    }
  }
  if (line.length) out.push(line);
  return out;
}

/**
 * Two-column layout: a left "label" column (flag) and a right
 * "description" column that wraps with a hanging indent. The
 * description is wrapped on the PLAIN text and colors are applied
 * afterwards, so embedded ANSI cannot break the wrap math.
 *
 * Layout shape:
 *   `  --domain <d>            Bare host (shadow.inc) or full origin`
 *   `  --engine <name>         perplexity (default), openai, anthropic,`
 *   `                          gemini, xai (alias: grok), all`
 *
 * - `labelCol`: visual width of the label column (label + trailing
 *   spaces). Wrapped description lines align here.
 * - `width`: total terminal width.
 * - `indentStr`: body indent (already includes leading spaces).
 */
export function renderFlagRow(
  label: string,
  description: string,
  opts: {
    indentStr: string;
    labelCol: number;
    width: number;
    colors: boolean;
  }
): string[] {
  const { indentStr, labelCol, width, colors } = opts;
  const labelVisualWidth = stripAnsi(label).length;

  // Wrap budget for the description column.
  const descBudget = Math.max(20, width - indentStr.length - labelCol);
  const wrapped = wrap(description, descBudget);

  const lines: string[] = [];
  // First line: indent + label (colored) + padding + description (dim).
  // If label overflowed labelCol, emit it alone, then start the
  // description on the next line at the labelCol gutter. Color is
  // applied AFTER measuring (visual width) so ANSI bytes can't break
  // the column alignment.
  const coloredLabel = colors
    ? // Cyan to match the existing brand color usage; bold so it pops.
      `\x1b[36m${label}\x1b[0m`
    : label;
  const coloredLabelPadded =
    labelVisualWidth >= labelCol
      ? coloredLabel
      : coloredLabel + " ".repeat(labelCol - labelVisualWidth);

  if (labelVisualWidth >= labelCol) {
    lines.push(`${indentStr}${coloredLabel}`);
    const gutter = " ".repeat(labelCol);
    for (const ln of wrapped) {
      lines.push(`${indentStr}${gutter}${dim(ln, colors)}`);
    }
  } else {
    const first = wrapped[0] ?? "";
    lines.push(`${indentStr}${coloredLabelPadded}${dim(first, colors)}`);
    const gutter = " ".repeat(labelCol);
    for (const ln of wrapped.slice(1)) {
      lines.push(`${indentStr}${gutter}${dim(ln, colors)}`);
    }
  }
  return lines;
}

// ── UI helpers (thin wrappers around ./ui) ─────────────────────────

function makeUi(opts: HelpRenderOptions): UiOptions {
  const cols = opts.columns ?? process.stdout?.columns;
  return {
    colors: opts.colors,
    narrow: detectNarrow(cols, opts.narrow),
    width: cols,
  };
}

/**
 * Effective render width. Bounded between 40 (so wrap doesn't degenerate
 * into one-word-per-line for very narrow shells) and 100 (so help
 * doesn't sprawl across an ultra-wide terminal).
 */
function helpWidth(opts: HelpRenderOptions): number {
  const cols = opts.columns ?? process.stdout?.columns ?? 80;
  return Math.max(40, Math.min(100, cols));
}

// ── Header for help screens ────────────────────────────────────────

/**
 * Header for help output. Same shape as `ui.header` but parameterized
 * so global help can include the version trailer:
 *   `  ◆ auto-geo  ╶╴  publishing engine for GEO resource pages  ╶╴  v0.4.1`
 */
function renderHelpHeader(
  name: string,
  tagline: string,
  trailer: string | undefined,
  ui: UiOptions
): string {
  const g = glyphs(ui.colors);
  const id = indent(ui);
  if (ui.colors) {
    const left = `${id}${g.diamond} ${bold(name, true)}`;
    const sep = dim("\u2576\u2574", true); // ╶╴
    const middle = `${left}  ${sep}  ${dim(tagline, true)}`;
    if (!trailer) return middle;
    return `${middle}  ${sep}  ${dim(trailer, true)}`;
  }
  const tail = trailer ? `  --  ${trailer}` : "";
  return `${id}${name} -- ${tagline}${tail}`;
}

// ── Renderer options ───────────────────────────────────────────────

export type HelpRenderOptions = {
  colors: boolean;
  narrow?: boolean;
  /** Explicit column override (tests + width-resilience cases). */
  columns?: number;
  /** Override the version string (tests). */
  version?: string;
};

// ── Global help ────────────────────────────────────────────────────

/**
 * `auto-geo` with no args / `--help` / `help` produces this. The shape:
 *
 *   ◆ auto-geo  ╶╴  publishing engine for GEO resource pages  ╶╴  v0.4.1
 *
 *   Usage:  auto-geo <command> [options]
 *
 *   Commands:
 *     doctor    Audit a page for citation readiness
 *     fix       Rewrite a page so it passes the doctor checks
 *     write     Generate publish-ready resource pages from target queries
 *     check     Measure if AI engines cite your domain
 *
 *   Run a command with --help to see its flags:
 *     auto-geo doctor --help
 *     auto-geo check --help
 *
 *   Docs:    https://github.com/shadowresearch/auto-geo
 *   npm:     https://www.npmjs.com/package/auto-geo
 *   By:      Shadow (https://www.shadow.inc)
 */
export function renderGlobalHelp(opts: HelpRenderOptions): string {
  const ui = makeUi(opts);
  const width = helpWidth(opts);
  const id = indent(ui);
  const version = opts.version ?? cachedVersion ?? "";
  const trailer = version ? `v${version}` : undefined;

  const lines: string[] = [];
  lines.push(renderHelpHeader("auto-geo", GLOBAL_TAGLINE, trailer, ui));
  lines.push("");
  lines.push(`${id}${bold("Usage:", ui.colors)}  auto-geo <command> [options]`);
  lines.push("");
  lines.push(`${id}${bold("Commands:", ui.colors)}`);
  const commandNames = Object.keys(COMMAND_SUMMARIES) as CommandName[];
  const maxCmd = commandNames.reduce((m, c) => Math.max(m, c.length), 0) + 4;
  for (const name of commandNames) {
    const summary = COMMAND_SUMMARIES[name];
    const rendered = renderFlagRow(name, summary, {
      indentStr: `${id}  `,
      labelCol: maxCmd,
      width,
      colors: ui.colors,
    });
    for (const ln of rendered) lines.push(ln);
  }
  lines.push("");
  // Four-pillar workflow hint — the CLI as the foundational pillar of
  // GEO infra. `init` is the on-ramp; the four pillars are run in
  // order. New in v0.6.0.
  lines.push(
    `${id}${bold("First run?", ui.colors)}  auto-geo init  ${dim(
      "(then doctor \u2192 write \u2192 fix \u2192 check)",
      ui.colors
    )}`
  );
  lines.push("");
  lines.push(
    `${id}${dim("Run a command with --help to see its flags:", ui.colors)}`
  );
  lines.push(`${id}  auto-geo init --help`);
  lines.push(`${id}  auto-geo doctor --help`);
  lines.push("");
  // Trailer links — kv-style, aligned by colon. `Library` points users
  // who want the programmatic API (adapters, schema, store) at the
  // deeper-integration section of the README; the CLI is the primary
  // surface, the library is a deeper-cut second.
  const links: Array<[string, string]> = [
    ["Library", `${REPO_URL}#library-usage`],
    ["Docs", REPO_URL],
    ["npm", NPM_URL],
    ["By", `Shadow (${SHADOW_URL})`],
  ];
  const maxLink = links.reduce((m, [k]) => Math.max(m, k.length), 0) + 2;
  for (const [k, v] of links) {
    const label = `${k}:`.padEnd(maxLink, " ");
    lines.push(`${id}${dim(label, ui.colors)} ${v}`);
  }
  return lines.join("\n");
}

// ── Per-command help ───────────────────────────────────────────────

export function renderCommandHelp(
  command: CommandName,
  opts: HelpRenderOptions
): string {
  const help = COMMAND_HELP[command];
  const ui = makeUi(opts);
  const width = helpWidth(opts);
  const id = indent(ui);

  const lines: string[] = [];
  lines.push(
    renderHelpHeader(`auto-geo ${help.command}`, help.tagline, undefined, ui)
  );
  lines.push("");

  // Usage block.
  lines.push(`${id}${bold("Usage:", ui.colors)}`);
  for (const u of help.usage) {
    lines.push(`${id}  ${u}`);
  }

  // Compute a shared label column for ALL flag rows in this command,
  // so columns align across sections — vitest / biome style.
  const allFlags = help.sections.flatMap((s) => s.items.map((i) => i.flag));
  const longestFlag = allFlags.reduce(
    (m, f) => Math.max(m, stripAnsi(f).length),
    0
  );
  // Padding the label column: longest flag + 4 spaces, capped so a
  // single long flag (e.g. `--author-linkedin <url>`) doesn't push the
  // description column off the right edge.
  const labelCol = Math.min(longestFlag + 4, Math.floor(width * 0.4));

  for (const section of help.sections) {
    lines.push("");
    lines.push(`${id}${bold(`${section.heading}:`, ui.colors)}`);
    for (const item of section.items) {
      const rendered = renderFlagRow(item.flag, item.description, {
        indentStr: `${id}  `,
        labelCol,
        width,
        colors: ui.colors,
      });
      for (const ln of rendered) lines.push(ln);
    }
  }

  // Env vars block.
  if (help.envVars && help.envVars.length > 0) {
    lines.push("");
    lines.push(`${id}${bold("Env vars:", ui.colors)}`);
    // Align the arrow column. Color the label, then pad to the
    // shared column on the OUTSIDE of the ANSI sequence so column
    // alignment stays correct regardless of color mode.
    const envLabelMax = help.envVars.reduce(
      (m, e) => Math.max(m, e.label.length),
      0
    );
    for (const e of help.envVars) {
      const label = ui.colors ? `\x1b[36m${e.label}\x1b[0m` : e.label;
      const pad = " ".repeat(envLabelMax - e.label.length);
      lines.push(`${id}  ${label}${pad}  ${dim(`-> ${e.envVar}`, ui.colors)}`);
    }
  }

  // Examples.
  if (help.examples && help.examples.length > 0) {
    lines.push("");
    lines.push(`${id}${bold("Examples:", ui.colors)}`);
    help.examples.forEach((ex, i) => {
      if (i > 0) lines.push("");
      if (ex.comment) {
        lines.push(`${id}  ${dim(`# ${ex.comment}`, ui.colors)}`);
      }
      for (const ln of ex.lines) {
        lines.push(`${id}  ${ln}`);
      }
    });
  }

  if (help.note) {
    lines.push("");
    for (const ln of wrap(help.note, width - id.length)) {
      lines.push(`${id}${dim(ln, ui.colors)}`);
    }
  }

  if (help.exitCode) {
    lines.push("");
    lines.push(`${id}${dim(help.exitCode, ui.colors)}`);
  }

  lines.push("");
  lines.push(`${id}${dim(`Docs: ${help.docsUrl}`, ui.colors)}`);

  return lines.join("\n");
}

// ── Short pointer (for "missing required args" cases) ──────────────

/**
 * Short one-liner steering the user to focused help instead of dumping
 * the whole USAGE blob. Caller prints the error message itself; this
 * returns only the pointer line.
 */
export function renderHelpPointer(command: CommandName): string {
  return `Run 'auto-geo ${command} --help' to see available flags.`;
}
