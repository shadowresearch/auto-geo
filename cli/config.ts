import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import type { ProviderId } from "./llm";

/**
 * Config-file support for the `auto-geo` CLI. Introduced in v0.6.0.
 *
 * Pain we're solving:
 *   `auto-geo write --domain https://www.example.com --provider openai \
 *      --author-name "Jane Doe" --author-jobtitle "..." \
 *      --author-bio "..." --author-linkedin "https://linkedin.com/in/..." \
 *      --basepath /resources --query "best foo tools"`
 * — every invocation re-passes 5+ flags that never change for a given
 * site. Config file lets the user set those once.
 *
 * Design:
 *
 * - Lookup walks up from cwd looking for the first `auto-geo.config.json`.
 *   Monorepo subdirs inherit the workspace config; per-package configs
 *   are picked up first if present.
 * - Schema is the single source of truth (Zod). Unknown keys are
 *   `.passthrough()`'d so a future version of the CLI can ship new keys
 *   without breaking older versions reading the same file.
 * - **API keys are NEVER read from this file.** Keys stay in env so the
 *   config file is safe to commit. `init` scaffolds a separate
 *   `.env.local` for the keys.
 * - Precedence (highest to lowest):
 *     1. CLI flag (explicitly passed in argv)
 *     2. Environment variable (e.g. AUTO_GEO_PROVIDER)
 *     3. Config file
 *     4. Built-in command default
 *   `userPassedFlag(argv, '--flag')` is how runners detect (1) so
 *   parser defaults stay in place and types don't need to ripple.
 */

// ── Schema ─────────────────────────────────────────────────────────

const providerSchema = z.enum(["openai", "anthropic"]);

const authorConfigSchema = z
  .object({
    name: z.string().min(1).optional(),
    jobTitle: z.string().min(1).optional(),
    bio: z.string().min(20).max(600).optional(),
    linkedinUrl: z.string().url().optional(),
  })
  .strict();

/**
 * `auto-geo.config.json` shape. Every field is optional — the file is
 * additive on top of CLI flags + env + built-in defaults. Keep fields
 * here in sync with `CONFIG_RELEVANT_FLAGS` below so help/docs stay
 * accurate.
 */
export const autoGeoConfigSchema = z
  .object({
    /** Publisher domain — passed to `write` / `check` as `--domain`. */
    domain: z.string().url().optional(),
    /** Path under the domain where resources are published. */
    basePath: z.string().startsWith("/").optional(),
    /** Default LLM provider for `write` / `fix`. */
    provider: providerSchema.optional(),
    /** Default model name. Provider-specific. */
    model: z.string().min(1).optional(),
    /** Default engine selector for `check` (`perplexity` | `openai` | … | `all`). */
    engine: z.string().min(1).optional(),
    /** Default concurrency across commands that fan out work. */
    concurrency: z.number().int().positive().optional(),
    /** Default author block — applied to every generated payload. */
    author: authorConfigSchema.optional(),
  })
  .strict();

export type AutoGeoConfig = z.infer<typeof autoGeoConfigSchema>;

/**
 * Config-relevant flag names per command. Used by `userPassedFlag` to
 * decide whether the runner should merge in a config value. Keep this
 * in sync with the parser flag set in `run.ts`.
 */
export const CONFIG_FLAG_ALIASES = {
  domain: ["--domain"],
  basePath: ["--basepath", "--base-path"],
  provider: ["--provider"],
  model: ["--model"],
  engine: ["--engine"],
  concurrency: ["--concurrency"],
  authorName: ["--author-name"],
  authorJobTitle: ["--author-jobtitle", "--author-job-title"],
  authorBio: ["--author-bio"],
  authorLinkedin: ["--author-linkedin"],
} as const;

export type ConfigFlagKey = keyof typeof CONFIG_FLAG_ALIASES;

// ── Loader ─────────────────────────────────────────────────────────

export const CONFIG_FILE_NAME = "auto-geo.config.json";

export type LoadedConfig = {
  config: AutoGeoConfig;
  /** Absolute path to the file that was loaded. */
  path: string;
};

/**
 * Walk up from `cwd` (default `process.cwd()`) looking for the first
 * `auto-geo.config.json`. Returns null if none found. Stops at the
 * filesystem root.
 */
export async function loadConfig(
  cwd: string = process.cwd()
): Promise<LoadedConfig | null> {
  const startDir = resolve(cwd);
  let dir = startDir;
  while (true) {
    const candidate = join(dir, CONFIG_FILE_NAME);
    if (existsSync(candidate)) {
      const raw = await readFile(candidate, "utf8");
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        throw new ConfigError(
          `${candidate}: invalid JSON — ${err instanceof Error ? err.message : String(err)}`
        );
      }
      const result = autoGeoConfigSchema.safeParse(parsed);
      if (!result.success) {
        const issues = result.error.issues
          .map((i) => `  • ${i.path.join(".") || "<root>"}: ${i.message}`)
          .join("\n");
        throw new ConfigError(`${candidate}: invalid config\n${issues}`);
      }
      return { config: result.data, path: candidate };
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

// ── Helpers (runner-facing) ────────────────────────────────────────

/**
 * Whether the user explicitly passed any of `flags` in `argv`. Used to
 * gate config-merge: if the user passed `--provider openai`, the config
 * file's `provider` is ignored (CLI wins). If they didn't, we fall
 * through to env > config > parser default.
 */
export function userPassedFlag(argv: string[], ...flags: string[]): boolean {
  for (const a of argv) {
    if (flags.includes(a)) return true;
  }
  return false;
}

/**
 * Provider auto-detect from env. Returns the first provider whose API
 * key is set, or undefined if none are. Used as the env-tier fallback
 * for `--provider` resolution.
 *
 * If both keys are set, prefers `openai` because gpt-4o-mini is cheaper
 * and faster than claude-sonnet-4-6 for the `write` / `fix` workloads
 * this matters for. Users with a strong preference should set
 * `provider` in their config file.
 */
export function detectProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env
): ProviderId | undefined {
  if (env.OPENAI_API_KEY) return "openai";
  if (env.ANTHROPIC_API_KEY) return "anthropic";
  return undefined;
}

/**
 * Resolve a single string-valued field with the standard precedence:
 *   CLI flag > env var > config > parser default.
 *
 * `cliPassed` is whether the user explicitly passed the flag in argv
 * (NOT whether the parsed value differs from the default — we can't
 * tell). `parserDefault` is whatever the parser produced when the
 * user didn't pass the flag.
 */
export function resolveField<T>(opts: {
  cliPassed: boolean;
  parserValue: T;
  envValue?: T;
  configValue?: T;
}): T {
  if (opts.cliPassed) return opts.parserValue;
  if (opts.envValue !== undefined) return opts.envValue;
  if (opts.configValue !== undefined) return opts.configValue;
  return opts.parserValue;
}
