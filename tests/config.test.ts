import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CONFIG_FILE_NAME,
  ConfigError,
  detectProviderFromEnv,
  loadConfig,
  resolveField,
  userPassedFlag,
} from "../cli/config";

/**
 * Tests for the v0.6.0 config-file layer.
 *
 * `loadConfig` walks up from cwd. Each test gets its own tmpdir tree
 * and we pass the leaf as `cwd` to avoid relying on `process.cwd()`
 * or polluting the project root with a real `auto-geo.config.json`.
 */

describe("loadConfig", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "auto-geo-config-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("returns null when no config file is found", async () => {
    expect(await loadConfig(root)).toBeNull();
  });

  it("reads and validates a valid config file", async () => {
    writeFileSync(
      join(root, CONFIG_FILE_NAME),
      JSON.stringify({
        domain: "https://www.example.com",
        basePath: "/resources",
        provider: "openai",
        model: "gpt-5.4-mini",
        engine: "all",
        concurrency: 8,
        author: {
          name: "Jane Doe",
          jobTitle: "Editor",
          bio: "A bio that is at least twenty characters long for the schema.",
          linkedinUrl: "https://www.linkedin.com/in/jane-doe",
        },
      })
    );

    const loaded = await loadConfig(root);
    expect(loaded).not.toBeNull();
    expect(loaded!.config.domain).toBe("https://www.example.com");
    expect(loaded!.config.provider).toBe("openai");
    expect(loaded!.config.author?.name).toBe("Jane Doe");
    expect(loaded!.path).toBe(join(root, CONFIG_FILE_NAME));
  });

  it("walks up from cwd to find the config in an ancestor directory", async () => {
    writeFileSync(
      join(root, CONFIG_FILE_NAME),
      JSON.stringify({ domain: "https://www.example.com" })
    );
    const leaf = join(root, "packages", "site", "src");
    mkdirSync(leaf, { recursive: true });

    const loaded = await loadConfig(leaf);
    expect(loaded?.config.domain).toBe("https://www.example.com");
    expect(loaded?.path).toBe(join(root, CONFIG_FILE_NAME));
  });

  it("throws ConfigError on invalid JSON", async () => {
    writeFileSync(join(root, CONFIG_FILE_NAME), "{ not json,,,");
    await expect(loadConfig(root)).rejects.toThrow(ConfigError);
  });

  it("throws ConfigError on schema violation (unknown key)", async () => {
    writeFileSync(
      join(root, CONFIG_FILE_NAME),
      JSON.stringify({ unknownKey: "nope" })
    );
    await expect(loadConfig(root)).rejects.toThrow(ConfigError);
  });

  it("throws ConfigError on schema violation (bad provider)", async () => {
    writeFileSync(
      join(root, CONFIG_FILE_NAME),
      JSON.stringify({ provider: "google" })
    );
    await expect(loadConfig(root)).rejects.toThrow(ConfigError);
  });

  it("throws ConfigError on schema violation (non-URL domain)", async () => {
    writeFileSync(
      join(root, CONFIG_FILE_NAME),
      JSON.stringify({ domain: "not a url" })
    );
    await expect(loadConfig(root)).rejects.toThrow(ConfigError);
  });

  it("rejects unknown keys under `author`", async () => {
    writeFileSync(
      join(root, CONFIG_FILE_NAME),
      JSON.stringify({ author: { handle: "@jane" } })
    );
    await expect(loadConfig(root)).rejects.toThrow(ConfigError);
  });
});

describe("detectProviderFromEnv", () => {
  it("prefers openai when both keys are set", () => {
    expect(
      detectProviderFromEnv({
        OPENAI_API_KEY: "sk-x",
        ANTHROPIC_API_KEY: "sk-y",
      } as NodeJS.ProcessEnv)
    ).toBe("openai");
  });

  it("returns 'anthropic' when only ANTHROPIC_API_KEY is set", () => {
    expect(
      detectProviderFromEnv({ ANTHROPIC_API_KEY: "sk-y" } as NodeJS.ProcessEnv)
    ).toBe("anthropic");
  });

  it("returns undefined when neither key is set", () => {
    expect(detectProviderFromEnv({} as NodeJS.ProcessEnv)).toBeUndefined();
  });
});

describe("userPassedFlag", () => {
  it("returns true when any alias is present in argv", () => {
    expect(userPassedFlag(["--domain", "x"], "--domain")).toBe(true);
    expect(
      userPassedFlag(["--basepath", "/r"], "--basepath", "--base-path")
    ).toBe(true);
    expect(
      userPassedFlag(["--base-path", "/r"], "--basepath", "--base-path")
    ).toBe(true);
  });

  it("returns false when no alias is present", () => {
    expect(userPassedFlag(["--query", "x"], "--domain")).toBe(false);
    expect(userPassedFlag([], "--domain")).toBe(false);
  });
});

describe("resolveField", () => {
  it("returns the parser value when the user passed the CLI flag (even if env/config also set)", () => {
    expect(
      resolveField({
        cliPassed: true,
        parserValue: "cli",
        envValue: "env",
        configValue: "config",
      })
    ).toBe("cli");
  });

  it("returns env when CLI didn't pass and env is set", () => {
    expect(
      resolveField({
        cliPassed: false,
        parserValue: "default",
        envValue: "env",
        configValue: "config",
      })
    ).toBe("env");
  });

  it("returns config when CLI didn't pass and env is unset", () => {
    expect(
      resolveField({
        cliPassed: false,
        parserValue: "default",
        configValue: "config",
      })
    ).toBe("config");
  });

  it("returns parser default when nothing else is set", () => {
    expect(resolveField({ cliPassed: false, parserValue: "default" })).toBe(
      "default"
    );
  });
});
