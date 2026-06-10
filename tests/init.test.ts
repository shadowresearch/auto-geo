import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildEnvTemplate,
  parseInitArgs,
  renderInitOutcome,
  runInit,
} from "../cli/init";
import { autoGeoConfigSchema, CONFIG_FILE_NAME } from "../cli/config";

/**
 * Tests for `auto-geo init` (v0.6.0).
 *
 * `runInit` is parameterized so each test gets its own tmpdir and a
 * stub prompt — no real stdin/stdout, no test pollution of the
 * project root.
 */

describe("parseInitArgs", () => {
  it("defaults to interactive, non-force, colored", () => {
    expect(parseInitArgs([])).toEqual({
      command: "init",
      yes: false,
      force: false,
      json: false,
      color: true,
      narrow: false,
    });
  });

  it("accepts --yes / -y / --force / --json / --no-color / --narrow", () => {
    expect(parseInitArgs(["--yes"]).yes).toBe(true);
    expect(parseInitArgs(["-y"]).yes).toBe(true);
    expect(parseInitArgs(["--force"]).force).toBe(true);
    expect(parseInitArgs(["--json"]).json).toBe(true);
    expect(parseInitArgs(["--no-color"]).color).toBe(false);
    expect(parseInitArgs(["--narrow"]).narrow).toBe(true);
  });

  it("rejects unknown flags and positionals", () => {
    expect(() => parseInitArgs(["--nope"])).toThrow(/unknown flag/);
    expect(() => parseInitArgs(["positional"])).toThrow(
      /unexpected positional/
    );
  });
});

describe("runInit", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "auto-geo-init-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("--yes writes a valid template config + .env.local stub", async () => {
    const outcome = await runInit({ cwd: root, yes: true });
    expect(outcome.refusedExisting).toBe(false);
    expect(outcome.configWritten).toBe(true);
    expect(outcome.envWritten).toBe(true);

    const cfgRaw = readFileSync(outcome.configPath, "utf8");
    const cfg = JSON.parse(cfgRaw);
    // Must round-trip through the schema.
    expect(autoGeoConfigSchema.safeParse(cfg).success).toBe(true);
    // Template should include the high-value keys.
    expect(cfg.domain).toBeDefined();
    expect(cfg.provider).toBe("openai");
    expect(cfg.author?.name).toBeDefined();

    const envRaw = readFileSync(outcome.envPath, "utf8");
    expect(envRaw).toContain("OPENAI_API_KEY=");
    expect(envRaw).toContain("ANTHROPIC_API_KEY=");
    expect(envRaw).toContain("PERPLEXITY_API_KEY=");
    expect(envRaw).toContain("GEMINI_API_KEY=");
    expect(envRaw).toContain("XAI_API_KEY=");
  });

  it("refuses to overwrite an existing config without --force", async () => {
    writeFileSync(join(root, CONFIG_FILE_NAME), '{"domain":"https://x.com"}');
    const outcome = await runInit({ cwd: root, yes: true });
    expect(outcome.refusedExisting).toBe(true);
    expect(outcome.configWritten).toBe(false);
    // Existing config untouched.
    expect(readFileSync(join(root, CONFIG_FILE_NAME), "utf8")).toContain(
      "x.com"
    );
  });

  it("--force overwrites an existing config", async () => {
    writeFileSync(join(root, CONFIG_FILE_NAME), '{"domain":"https://old.com"}');
    const outcome = await runInit({ cwd: root, yes: true, force: true });
    expect(outcome.refusedExisting).toBe(false);
    expect(outcome.configWritten).toBe(true);
    const cfg = JSON.parse(readFileSync(join(root, CONFIG_FILE_NAME), "utf8"));
    expect(cfg.domain).not.toBe("https://old.com");
  });

  it("never overwrites an existing .env.local", async () => {
    const envPath = join(root, ".env.local");
    const original = "OPENAI_API_KEY=sk-mine\n";
    writeFileSync(envPath, original);

    const outcome = await runInit({ cwd: root, yes: true });
    expect(outcome.envWritten).toBe(false);
    // Original content is preserved exactly.
    expect(readFileSync(envPath, "utf8")).toBe(original);
  });

  it("interactive path uses the injected prompt and assembles a valid config", async () => {
    // Scripted answers for each question, in order.
    const answers = [
      "https://www.example.com",
      "/guides",
      "anthropic",
      "Jane Doe",
      "Editor",
      "A short bio that is at least twenty characters long.",
      "https://www.linkedin.com/in/jane-doe",
    ];
    let i = 0;
    const prompt = async () => answers[i++] ?? "";

    const outcome = await runInit({ cwd: root, prompt });
    expect(outcome.configWritten).toBe(true);
    expect(outcome.config.domain).toBe("https://www.example.com");
    expect(outcome.config.basePath).toBe("/guides");
    expect(outcome.config.provider).toBe("anthropic");
    expect(outcome.config.author?.name).toBe("Jane Doe");
    expect(outcome.config.author?.jobTitle).toBe("Editor");
    expect(outcome.config.author?.bio?.length).toBeGreaterThanOrEqual(20);
    expect(outcome.config.author?.linkedinUrl).toBe(
      "https://www.linkedin.com/in/jane-doe"
    );
    // What hits disk also round-trips through the schema.
    const cfg = JSON.parse(readFileSync(outcome.configPath, "utf8"));
    expect(autoGeoConfigSchema.safeParse(cfg).success).toBe(true);
  });

  it("--yes scaffolds the .auto-geo workspace (prompts.txt + checks/)", async () => {
    const outcome = await runInit({ cwd: root, yes: true });
    expect(outcome.workspaceCreated).toBe(true);
    expect(outcome.workspaceDir).toBe(join(root, ".auto-geo"));
    expect(existsSync(join(root, ".auto-geo", "prompts.txt"))).toBe(true);
    expect(existsSync(join(root, ".auto-geo", "checks"))).toBe(true);
    expect(outcome.promptsSeeded).toEqual([]);
  });

  it("interactive — seeds tracked prompts from the comma-separated answer", async () => {
    const answers = [
      "https://www.example.com",
      "", // basePath default
      "", // provider default
      "Jane Doe",
      "Editor",
      "A short bio that is at least twenty characters long.",
      "", // linkedin skipped
      "best media monitoring tools, what is GEO, ", // tracked prompts
    ];
    let i = 0;
    const outcome = await runInit({
      cwd: root,
      prompt: async () => answers[i++] ?? "",
    });
    expect(outcome.promptsSeeded).toEqual([
      "best media monitoring tools",
      "what is GEO",
    ]);
    const body = readFileSync(join(root, ".auto-geo", "prompts.txt"), "utf8");
    expect(body).toContain("best media monitoring tools");
    expect(body).toContain("what is GEO");
  });

  it("interactive — empty author bio is skipped (preserves schema validity)", async () => {
    const answers = [
      "https://x.com",
      "",
      "",
      "Jane",
      "Editor",
      "short", // too-short bio — discarded
      "",
    ];
    let i = 0;
    const outcome = await runInit({
      cwd: root,
      prompt: async () => answers[i++] ?? "",
    });
    expect(outcome.config.author?.bio).toBeUndefined();
    expect(autoGeoConfigSchema.safeParse(outcome.config).success).toBe(true);
  });

  it("interactive — empty domain skipped (no field written, schema still valid)", async () => {
    const answers = ["", "", "", "", "", "", ""];
    let i = 0;
    const outcome = await runInit({
      cwd: root,
      prompt: async () => answers[i++] ?? "",
    });
    expect(outcome.config.domain).toBeUndefined();
    expect(outcome.config.basePath).toBe("/resources");
    expect(autoGeoConfigSchema.safeParse(outcome.config).success).toBe(true);
  });

  it("scaffolds .env.local even when config write is the only thing happening", async () => {
    const outcome = await runInit({ cwd: root, yes: true });
    expect(existsSync(outcome.envPath)).toBe(true);
  });
});

describe("buildEnvTemplate", () => {
  it("includes every supported provider/engine key, all empty", () => {
    const t = buildEnvTemplate();
    for (const key of [
      "OPENAI_API_KEY",
      "ANTHROPIC_API_KEY",
      "PERPLEXITY_API_KEY",
      "GEMINI_API_KEY",
      "XAI_API_KEY",
    ]) {
      // each key appears as "KEY=" (no value).
      expect(t).toMatch(new RegExp(`^${key}=\\s*$`, "m"));
    }
  });

  it("warns that the file should be gitignored", () => {
    expect(buildEnvTemplate()).toMatch(/gitignore/i);
  });
});

describe("renderInitOutcome", () => {
  it("shows a refusal message when an existing config blocked the write", () => {
    const out = renderInitOutcome(
      {
        configPath: "/x/auto-geo.config.json",
        configWritten: false,
        envPath: "/x/.env.local",
        envWritten: false,
        refusedExisting: true,
        config: {},
      },
      { colors: false }
    );
    expect(out).toMatch(/already exists/);
    expect(out).toMatch(/--force/);
  });

  it("shows next-step pointers on success", () => {
    const out = renderInitOutcome(
      {
        configPath: "/x/auto-geo.config.json",
        configWritten: true,
        envPath: "/x/.env.local",
        envWritten: true,
        workspaceDir: "/x/.auto-geo",
        workspaceCreated: true,
        promptsSeeded: [],
        refusedExisting: false,
        config: {},
      },
      { colors: false }
    );
    expect(out).toMatch(/wrote auto-geo\.config\.json/);
    expect(out).toMatch(/scaffolded \.env\.local/);
    expect(out).toMatch(/created \.auto-geo\/ workspace/);
    expect(out).toMatch(/auto-geo doctor/);
    expect(out).toMatch(/auto-geo prompts add/);
  });

  it("points at check (not prompts add) when prompts were seeded", () => {
    const out = renderInitOutcome(
      {
        configPath: "/x/auto-geo.config.json",
        configWritten: true,
        envPath: "/x/.env.local",
        envWritten: true,
        workspaceDir: "/x/.auto-geo",
        workspaceCreated: true,
        promptsSeeded: ["best media monitoring tools", "what is GEO"],
        refusedExisting: false,
        config: {},
      },
      { colors: false }
    );
    expect(out).toMatch(/tracking 2 prompts/);
    expect(out).toMatch(/auto-geo check/);
  });
});
