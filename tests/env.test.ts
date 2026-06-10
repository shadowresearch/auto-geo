import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadEnvFiles, parseEnvFile } from "../cli/env";

/**
 * Tests for the v0.6.3 dotenv auto-loader.
 *
 * `loadEnvFiles` is parameterized on `cwd` and `env` so each test
 * gets its own tmpdir and an isolated env object — no
 * `process.cwd()` / `process.env` pollution.
 */

describe("parseEnvFile", () => {
  it("parses plain KEY=value lines", () => {
    expect(
      parseEnvFile("OPENAI_API_KEY=sk-abc\nANTHROPIC_API_KEY=sk-xyz")
    ).toEqual({
      OPENAI_API_KEY: "sk-abc",
      ANTHROPIC_API_KEY: "sk-xyz",
    });
  });

  it("strips matched double quotes", () => {
    expect(parseEnvFile('A="hello world"\nB="quoted"')).toEqual({
      A: "hello world",
      B: "quoted",
    });
  });

  it("strips matched single quotes", () => {
    expect(parseEnvFile("A='hello world'")).toEqual({ A: "hello world" });
  });

  it("preserves values containing '='", () => {
    expect(parseEnvFile("AUTH=Bearer foo=bar=baz")).toEqual({
      AUTH: "Bearer foo=bar=baz",
    });
  });

  it("tolerates an `export ` prefix", () => {
    expect(parseEnvFile("export OPENAI_API_KEY=sk-abc")).toEqual({
      OPENAI_API_KEY: "sk-abc",
    });
  });

  it("ignores comment lines and blank lines", () => {
    const body = `
# header comment
OPENAI_API_KEY=sk-abc

# inline section
ANTHROPIC_API_KEY=sk-xyz
`;
    expect(parseEnvFile(body)).toEqual({
      OPENAI_API_KEY: "sk-abc",
      ANTHROPIC_API_KEY: "sk-xyz",
    });
  });

  it("strips trailing ` # comment` on unquoted values", () => {
    expect(parseEnvFile("A=val # this is a comment")).toEqual({ A: "val" });
  });

  it("preserves '#' inside quoted values (no inline-comment stripping)", () => {
    expect(parseEnvFile('A="val # not a comment"')).toEqual({
      A: "val # not a comment",
    });
  });

  it("skips lines with non-env-shaped keys", () => {
    // No `=`, key starts with digit, etc.
    expect(parseEnvFile("NOEQ\n9STARTS=bad\n=novalue\nGOOD=ok")).toEqual({
      GOOD: "ok",
    });
  });

  it("tolerates whitespace around =", () => {
    expect(parseEnvFile("A = value\nB=  spaced")).toEqual({
      A: "value",
      B: "spaced",
    });
  });

  it("handles an empty file", () => {
    expect(parseEnvFile("")).toEqual({});
  });
});

describe("loadEnvFiles", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "auto-geo-env-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("returns no loaded files when neither exists", () => {
    const env: NodeJS.ProcessEnv = {};
    const result = loadEnvFiles(root, env);
    expect(result.loaded).toEqual([]);
    expect(result.applied).toBe(0);
    expect(env).toEqual({});
  });

  it("loads .env.local and applies its keys", () => {
    writeFileSync(join(root, ".env.local"), "OPENAI_API_KEY=sk-from-local\n");
    const env: NodeJS.ProcessEnv = {};
    const result = loadEnvFiles(root, env);
    expect(result.loaded).toEqual([join(root, ".env.local")]);
    expect(result.applied).toBe(1);
    expect(env.OPENAI_API_KEY).toBe("sk-from-local");
  });

  it("loads both .env.local and .env (each via its own walk)", () => {
    writeFileSync(join(root, ".env.local"), "OPENAI_API_KEY=sk-local\n");
    writeFileSync(
      join(root, ".env"),
      "ANTHROPIC_API_KEY=sk-anthropic\nPERPLEXITY_API_KEY=pplx-x\n"
    );
    const env: NodeJS.ProcessEnv = {};
    const result = loadEnvFiles(root, env);
    expect(result.loaded).toEqual([
      join(root, ".env.local"),
      join(root, ".env"),
    ]);
    expect(result.applied).toBe(3);
    expect(env.OPENAI_API_KEY).toBe("sk-local");
    expect(env.ANTHROPIC_API_KEY).toBe("sk-anthropic");
    expect(env.PERPLEXITY_API_KEY).toBe("pplx-x");
  });

  it(".env.local wins over .env on key conflict (load-order, never-overwrite)", () => {
    writeFileSync(join(root, ".env.local"), "OPENAI_API_KEY=sk-from-local\n");
    writeFileSync(join(root, ".env"), "OPENAI_API_KEY=sk-from-env\n");
    const env: NodeJS.ProcessEnv = {};
    loadEnvFiles(root, env);
    expect(env.OPENAI_API_KEY).toBe("sk-from-local");
  });

  it("process env wins over both files (never overwrites)", () => {
    writeFileSync(join(root, ".env.local"), "OPENAI_API_KEY=sk-from-local\n");
    writeFileSync(join(root, ".env"), "ANTHROPIC_API_KEY=sk-from-env\n");
    const env: NodeJS.ProcessEnv = {
      OPENAI_API_KEY: "sk-from-process",
      ANTHROPIC_API_KEY: "sk-from-process-too",
    };
    const result = loadEnvFiles(root, env);
    expect(env.OPENAI_API_KEY).toBe("sk-from-process");
    expect(env.ANTHROPIC_API_KEY).toBe("sk-from-process-too");
    // applied count reflects nothing was added.
    expect(result.applied).toBe(0);
  });

  it("walks up from cwd to find env files in an ancestor directory", () => {
    writeFileSync(join(root, ".env.local"), "OPENAI_API_KEY=sk-from-root\n");
    const leaf = join(root, "packages", "site", "src");
    mkdirSync(leaf, { recursive: true });

    const env: NodeJS.ProcessEnv = {};
    const result = loadEnvFiles(leaf, env);
    expect(result.loaded).toEqual([join(root, ".env.local")]);
    expect(env.OPENAI_API_KEY).toBe("sk-from-root");
  });

  it("loads quoted, exported, commented files end-to-end", () => {
    writeFileSync(
      join(root, ".env.local"),
      `
# auto-geo keys
export OPENAI_API_KEY="sk-quoted"
ANTHROPIC_API_KEY='sk-single'
PERPLEXITY_API_KEY=pplx-bare # trailing comment
`
    );
    const env: NodeJS.ProcessEnv = {};
    loadEnvFiles(root, env);
    expect(env.OPENAI_API_KEY).toBe("sk-quoted");
    expect(env.ANTHROPIC_API_KEY).toBe("sk-single");
    expect(env.PERPLEXITY_API_KEY).toBe("pplx-bare");
  });
});
