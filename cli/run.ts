/* eslint-disable no-console */
import {
  renderReport,
  renderSitemapReport,
  runDoctor,
  runSitemapDoctor,
} from "./doctor";

/**
 * Argument parser + top-level `run` for the `auto-geo` CLI. Lives in
 * its own module (not in `cli/bin.ts`) so it is freely importable
 * from tests without triggering `process.exit`. `bin.ts` is the
 * unconditional executable shim.
 */

const USAGE = `auto-geo doctor — GEO citation readiness audit

Usage:
  auto-geo doctor <url>                Audit a single page
  auto-geo doctor --site <sitemap>     Audit every URL in an XML sitemap
  auto-geo doctor <url> --json         Emit JSON (for CI / dashboards)
  auto-geo doctor --help               Show this message

Flags:
  --json           Emit machine-readable JSON instead of a human report
  --no-color       Disable ANSI colors even on a TTY
  --max-pages N    Cap pages audited from --site mode (default 100)
  --concurrency N  Concurrent fetches in --site mode (default 5)

Exit code: 0 if score ≥ 75%, 1 otherwise (CI-friendly).

Docs: https://github.com/shadowresearch/auto-geo/blob/main/docs/doctor.md
`;

export type ParsedArgs = {
  command: "doctor" | "help";
  url?: string;
  site?: string;
  json: boolean;
  color: boolean;
  maxPages?: number;
  concurrency?: number;
};

export function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    command: "doctor",
    json: false,
    color: true,
  };

  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--help" || a === "-h") return { ...args, command: "help" };
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

  // Allow both `doctor <url>` (documented) and bare `<url>` (friendly
  // one-shot form). The former scales when more subcommands ship.
  if (positionals[0] === "doctor") positionals.shift();
  if (positionals.length > 1) {
    throw new Error(
      `unexpected positional arguments: ${positionals.slice(1).join(" ")}`
    );
  }
  args.url = positionals[0];

  return args;
}

export function getUsage(): string {
  return USAGE;
}

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

  if (parsed.site) {
    return runSiteMode(parsed);
  }
  if (parsed.url) {
    return runSingleMode(parsed);
  }

  console.error("auto-geo: missing URL argument\n");
  console.error(USAGE);
  return 2;
}

async function runSingleMode(parsed: ParsedArgs): Promise<number> {
  const colors = shouldUseColor(parsed);
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

async function runSiteMode(parsed: ParsedArgs): Promise<number> {
  const colors = shouldUseColor(parsed);
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

function shouldUseColor(parsed: ParsedArgs): boolean {
  if (!parsed.color) return false;
  if (parsed.json) return false;
  if (process.env.NO_COLOR) return false;
  return Boolean(process.stdout?.isTTY);
}
