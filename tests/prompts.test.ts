import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  parsePromptsArgs,
  renderPromptsJson,
  renderPromptsOutcome,
  runPrompts,
  PromptsError,
} from "../cli/prompts";

/**
 * Tests for `auto-geo prompts` (v0.7.0) — parser, runner, renderers.
 * Each test gets its own tmpdir as cwd; no process.cwd() dependence.
 */

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "auto-geo-prompts-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

// ── Parser ────────────────────────────────────────────────────────

describe("parsePromptsArgs", () => {
  it("defaults to list", () => {
    expect(parsePromptsArgs([])).toMatchObject({ action: "list", values: [] });
    expect(parsePromptsArgs(["list"])).toMatchObject({ action: "list" });
  });

  it("parses add with multiple prompts", () => {
    expect(parsePromptsArgs(["add", "a", "b"])).toMatchObject({
      action: "add",
      values: ["a", "b"],
    });
  });

  it("parses rm (and the remove alias) with one selector", () => {
    expect(parsePromptsArgs(["rm", "2"])).toMatchObject({
      action: "rm",
      values: ["2"],
    });
    expect(parsePromptsArgs(["remove", "a"])).toMatchObject({
      action: "rm",
      values: ["a"],
    });
  });

  it("parses output flags", () => {
    const args = parsePromptsArgs(["list", "--json", "--no-color", "--narrow"]);
    expect(args.json).toBe(true);
    expect(args.color).toBe(false);
    expect(args.narrow).toBe(true);
  });

  it("rejects bad shapes", () => {
    expect(() => parsePromptsArgs(["add"])).toThrow(/at least one prompt/);
    expect(() => parsePromptsArgs(["rm"])).toThrow(/exactly one selector/);
    expect(() => parsePromptsArgs(["rm", "1", "2"])).toThrow(
      /exactly one selector/
    );
    expect(() => parsePromptsArgs(["frobnicate"])).toThrow(
      /unknown prompts action/
    );
    expect(() => parsePromptsArgs(["list", "--nope"])).toThrow(/unknown flag/);
    expect(() => parsePromptsArgs(["list", "extra"])).toThrow(
      /unexpected arguments/
    );
  });
});

// ── Runner ────────────────────────────────────────────────────────

describe("runPrompts", () => {
  it("add bootstraps the workspace without init", async () => {
    const outcome = await runPrompts(parsePromptsArgs(["add", "a", "b"]), root);
    expect(outcome).toMatchObject({
      action: "add",
      added: ["a", "b"],
      skipped: [],
      prompts: ["a", "b"],
    });
  });

  it("list without a workspace reports an empty tracked set", async () => {
    const outcome = await runPrompts(parsePromptsArgs([]), root);
    expect(outcome).toMatchObject({
      action: "list",
      workspaceDir: null,
      prompts: [],
    });
  });

  it("list returns prompts in file order", async () => {
    await runPrompts(parsePromptsArgs(["add", "b", "a"]), root);
    const outcome = await runPrompts(parsePromptsArgs(["list"]), root);
    expect(outcome.prompts).toEqual(["b", "a"]);
  });

  it("rm by index and by text", async () => {
    await runPrompts(parsePromptsArgs(["add", "a", "b", "c"]), root);
    const byIndex = await runPrompts(parsePromptsArgs(["rm", "2"]), root);
    expect(byIndex).toMatchObject({ action: "rm", removed: "b" });
    const byText = await runPrompts(parsePromptsArgs(["rm", "c"]), root);
    expect(byText).toMatchObject({ removed: "c", prompts: ["a"] });
  });

  it("rm without a workspace throws a PromptsError", async () => {
    await expect(
      runPrompts(parsePromptsArgs(["rm", "1"]), root)
    ).rejects.toThrow(PromptsError);
  });

  it("rm with a bad selector throws a PromptsError", async () => {
    await runPrompts(parsePromptsArgs(["add", "a"]), root);
    await expect(
      runPrompts(parsePromptsArgs(["rm", "9"]), root)
    ).rejects.toThrow(/out of range/);
  });
});

// ── Renderers ─────────────────────────────────────────────────────

describe("renderPromptsOutcome", () => {
  it("renders an empty list with a getting-started pointer", async () => {
    const outcome = await runPrompts(parsePromptsArgs([]), root);
    const out = renderPromptsOutcome(outcome, { colors: false, cwd: root });
    expect(out).toContain("No tracked prompts yet");
    expect(out).toContain("auto-geo prompts add");
  });

  it("renders a numbered list with count + path", async () => {
    await runPrompts(parsePromptsArgs(["add", "a", "b"]), root);
    const outcome = await runPrompts(parsePromptsArgs([]), root);
    const out = renderPromptsOutcome(outcome, { colors: false, cwd: root });
    expect(out).toContain("1. a");
    expect(out).toContain("2. b");
    expect(out).toContain("2 prompts");
    expect(out).toContain("prompts.txt");
  });

  it("renders add with added + skipped + next step", async () => {
    await runPrompts(parsePromptsArgs(["add", "a"]), root);
    const outcome = await runPrompts(parsePromptsArgs(["add", "a", "b"]), root);
    const out = renderPromptsOutcome(outcome, { colors: false, cwd: root });
    expect(out).toContain('added "b"');
    expect(out).toContain('skipped "a" (already tracked)');
    expect(out).toContain("auto-geo check");
  });

  it("renders rm with the removed prompt", async () => {
    await runPrompts(parsePromptsArgs(["add", "a"]), root);
    const outcome = await runPrompts(parsePromptsArgs(["rm", "1"]), root);
    const out = renderPromptsOutcome(outcome, { colors: false, cwd: root });
    expect(out).toContain('removed "a"');
    expect(out).toContain("0 tracked");
  });

  it("renderPromptsJson round-trips", async () => {
    const outcome = await runPrompts(parsePromptsArgs(["add", "a"]), root);
    const parsed = JSON.parse(renderPromptsJson(outcome));
    expect(parsed.action).toBe("add");
    expect(parsed.added).toEqual(["a"]);
  });
});
