import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * Dotenv-style env-file auto-loader. Added in v0.6.3 to close the loop
 * on `auto-geo init`: that command scaffolds `.env.local`, but prior
 * to this loader the CLI read keys from `process.env` only — users
 * had to `set -a; source .env.local; set +a` themselves or invoke via
 * `dotenv-cli`. Now `auto-geo write` "just works" after `init` +
 * filling in the keys.
 *
 * Behavior:
 *
 * - Walks up from cwd looking for `.env.local` and `.env` (independent
 *   walks — each finds the first occurrence; `.env.local` takes
 *   precedence over `.env`).
 * - Parses a minimal but conventional dotenv format:
 *     - `KEY=value` and `KEY="value"` and `KEY='value'`
 *     - `export KEY=value` (the prefix is tolerated and stripped)
 *     - `# comment` lines and blank lines ignored
 *     - whitespace around `=` ignored
 *     - everything after the first `=` is the value (so values may
 *       contain `=`)
 * - **Never overwrites a key already present in `process.env`.** The
 *   precedence ladder is process env > .env.local > .env > nothing.
 *   This matches the rest of the CLI's CLI-flag > env > config > default
 *   pattern, and means CI / production env vars always win.
 * - No new dependency — the parser is ~30 lines. We deliberately don't
 *   pull in `dotenv` to keep the CLI binary small.
 */

export type LoadEnvResult = {
  /** Absolute paths to each env file that was successfully loaded, in load order. */
  loaded: string[];
  /** Total number of keys applied to process.env across all files. */
  applied: number;
};

const ENV_FILE_NAMES = [".env.local", ".env"] as const;

/**
 * Find, parse, and apply env files. Mutates `env` (defaults to
 * `process.env`). Returns metadata for renderers / debug output.
 *
 * Lookup is per-filename: each name's walk is independent so an
 * `.env.local` in a subdir and an `.env` at the repo root can both
 * apply. `.env.local` wins on key conflicts because it loads second
 * but never overwrites existing keys — wait, that's backwards. We
 * apply `.env.local` FIRST so that when `.env` tries to set the same
 * key, the "never overwrite" rule preserves the higher-priority value.
 */
export function loadEnvFiles(
  cwd: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env
): LoadEnvResult {
  const loaded: string[] = [];
  let applied = 0;
  for (const name of ENV_FILE_NAMES) {
    const found = findUp(cwd, name);
    if (!found) continue;
    const parsed = parseEnvFile(readFileSync(found, "utf8"));
    for (const [key, value] of Object.entries(parsed)) {
      if (env[key] !== undefined) continue; // never overwrite.
      env[key] = value;
      applied++;
    }
    loaded.push(found);
  }
  return { loaded, applied };
}

/**
 * Walk up from `start` looking for `filename`. Returns the absolute
 * path to the first match, or null if none found. Stops at filesystem
 * root. Same shape as `loadConfig`'s walk in `cli/config.ts`.
 */
function findUp(start: string, filename: string): string | null {
  let dir = resolve(start);
  while (true) {
    const candidate = join(dir, filename);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Parse a dotenv-style file body into a key/value record. Exported
 * for tests; not part of the public CLI surface.
 */
export function parseEnvFile(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    // Strip an optional `export ` prefix (bash-export-style env files).
    const withoutExport = line.startsWith("export ")
      ? line.slice("export ".length).trimStart()
      : line;
    // Split on the first `=` — values may legitimately contain `=`.
    const eq = withoutExport.indexOf("=");
    if (eq <= 0) continue; // no key, or no `=`.
    const key = withoutExport.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue; // skip non-env-ish keys.
    let value = withoutExport.slice(eq + 1).trim();
    // Strip a trailing inline comment that starts with ` #` (only on
    // unquoted values — quoted values may legitimately contain `#`).
    if (
      value.length > 0 &&
      value[0] !== '"' &&
      value[0] !== "'" &&
      value.includes(" #")
    ) {
      value = value.slice(0, value.indexOf(" #")).trimEnd();
    }
    // Unquote — accept matched single or double quotes.
    if (
      value.length >= 2 &&
      ((value[0] === '"' && value[value.length - 1] === '"') ||
        (value[0] === "'" && value[value.length - 1] === "'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}
