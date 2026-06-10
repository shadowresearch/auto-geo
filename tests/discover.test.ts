import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildDiscoverSystemPrompt,
  buildDiscoverUserPrompt,
  renderDiscoverJson,
  renderDiscoverOutcome,
  runDiscover,
  DEFAULT_DISCOVER_COUNT,
  type DiscoverGenerate,
} from "../cli/discover";
import { parsePromptsArgs } from "../cli/prompts";
import { ensureWorkspace, addPrompts, loadPrompts } from "../cli/workspace";

/**
 * Tests for `auto-geo prompts discover` (v0.8.0). The LLM is injected
 * via `DiscoverGenerate` and the homepage fetch via `fetchOptions.fetch`
 * — zero network, zero spend.
 */

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "auto-geo-discover-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const HOMEPAGE_HTML = `<!doctype html><html><head><title>Shadow</title></head>
<body><h1>Shadow — AI media intelligence</h1>
<p>Shadow builds AI infrastructure for PR agencies: media monitoring, research, and communications automation.</p>
</body></html>`;

function okFetch(): typeof globalThis.fetch {
  return vi.fn(async () => new Response(HOMEPAGE_HTML, { status: 200 }));
}

function failFetch(): typeof globalThis.fetch {
  return vi.fn(async () => {
    throw new TypeError("fetch failed");
  });
}

function stubGenerate(prompts: string[]): DiscoverGenerate {
  return async () => ({
    prompts,
    usage: { inputTokens: 1000, outputTokens: 200, totalTokens: 1200 },
  });
}

// ── Parser (discover action) ──────────────────────────────────────

describe("parsePromptsArgs — discover", () => {
  it("parses discover with defaults", () => {
    const args = parsePromptsArgs(["discover"]);
    expect(args.action).toBe("discover");
    expect(args.count).toBeUndefined();
    expect(args.dryRun).toBe(false);
  });

  it("parses discover flags", () => {
    const args = parsePromptsArgs([
      "discover",
      "--count",
      "15",
      "--domain",
      "https://shadow.inc",
      "--provider",
      "anthropic",
      "--model",
      "claude-sonnet-4-6",
      "--dry-run",
      "--json",
    ]);
    expect(args).toMatchObject({
      action: "discover",
      count: 15,
      domain: "https://shadow.inc",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      dryRun: true,
      json: true,
    });
  });

  it("rejects bad discover input", () => {
    expect(() => parsePromptsArgs(["discover", "--count", "0"])).toThrow(
      /positive integer/
    );
    expect(() =>
      parsePromptsArgs(["discover", "--provider", "gemini"])
    ).toThrow(/openai or anthropic/);
    expect(() => parsePromptsArgs(["discover", "extra"])).toThrow(
      /unexpected arguments after 'discover'/
    );
  });

  it("rejects discover-only flags on other actions", () => {
    expect(() => parsePromptsArgs(["list", "--count", "5"])).toThrow(
      /only valid with 'prompts discover'/
    );
    expect(() => parsePromptsArgs(["add", "x", "--dry-run"])).toThrow(
      /only valid with 'prompts discover'/
    );
  });
});

// ── Prompt builders ───────────────────────────────────────────────

describe("prompt builders", () => {
  it("system prompt encodes the dedupe + intent rules", () => {
    const sys = buildDiscoverSystemPrompt();
    expect(sys).toContain("NEVER repeat");
    expect(sys).toContain("Generative Engine Optimization");
  });

  it("user prompt carries domain, page context, existing prompts, count", () => {
    const p = buildDiscoverUserPrompt({
      domain: "https://shadow.inc",
      count: 7,
      existingPrompts: ["what is shadow inc"],
      pageTitle: "Shadow — AI media intelligence",
      pageText: "Shadow builds AI infrastructure for PR agencies.",
    });
    expect(p).toContain("https://shadow.inc");
    expect(p).toContain("Shadow — AI media intelligence");
    expect(p).toContain("- what is shadow inc");
    expect(p).toContain("exactly 7 new prompts");
  });

  it("user prompt handles the empty tracked set", () => {
    const p = buildDiscoverUserPrompt({
      domain: "shadow.inc",
      count: 10,
      existingPrompts: [],
    });
    expect(p).toContain("No prompts are tracked yet");
  });
});

// ── Runner ────────────────────────────────────────────────────────

describe("runDiscover", () => {
  it("appends generated prompts without touching existing ones", async () => {
    const { workspace } = await ensureWorkspace(root);
    await addPrompts(workspace, ["keep me"]);

    const outcome = await runDiscover({
      domain: "https://shadow.inc",
      cwd: root,
      generate: stubGenerate(["best media monitoring tools", "what is GEO"]),
      fetchOptions: { fetch: okFetch() },
    });

    expect(outcome.added).toEqual([
      "best media monitoring tools",
      "what is GEO",
    ]);
    expect(outcome.prompts).toEqual([
      "keep me",
      "best media monitoring tools",
      "what is GEO",
    ]);
    // Existing content (template header + prompt) untouched.
    const body = readFileSync(workspace.promptsPath, "utf8");
    expect(body).toContain("# auto-geo tracked prompts");
    expect(body).toContain("keep me");
  });

  it("dedupes against the tracked set and within the batch", async () => {
    const { workspace } = await ensureWorkspace(root);
    await addPrompts(workspace, ["What is GEO"]);

    const outcome = await runDiscover({
      domain: "shadow.inc",
      cwd: root,
      generate: stubGenerate(["what is geo", "new one", "NEW ONE"]),
      fetchOptions: { fetch: okFetch() },
    });

    expect(outcome.added).toEqual(["new one"]);
    expect(outcome.skipped).toEqual(["what is geo", "NEW ONE"]);
    expect(await loadPrompts(workspace)).toEqual(["What is GEO", "new one"]);
  });

  it("bootstraps the workspace when none exists", async () => {
    const outcome = await runDiscover({
      domain: "shadow.inc",
      cwd: root,
      generate: stubGenerate(["a"]),
      fetchOptions: { fetch: okFetch() },
    });
    expect(outcome.added).toEqual(["a"]);
    expect(
      readFileSync(join(root, ".auto-geo", "prompts.txt"), "utf8")
    ).toContain("a");
  });

  it("--dry-run computes added/skipped without writing", async () => {
    const { workspace } = await ensureWorkspace(root);
    await addPrompts(workspace, ["existing"]);

    const outcome = await runDiscover({
      domain: "shadow.inc",
      cwd: root,
      dryRun: true,
      generate: stubGenerate(["existing", "fresh"]),
      fetchOptions: { fetch: okFetch() },
    });

    expect(outcome.dryRun).toBe(true);
    expect(outcome.added).toEqual(["fresh"]);
    expect(outcome.skipped).toEqual(["existing"]);
    expect(await loadPrompts(workspace)).toEqual(["existing"]);
  });

  it("feeds homepage context to the generator", async () => {
    const seen: string[] = [];
    const generate: DiscoverGenerate = async ({ prompt }) => {
      seen.push(prompt);
      return { prompts: ["a"] };
    };
    await runDiscover({
      domain: "https://shadow.inc",
      cwd: root,
      generate,
      fetchOptions: { fetch: okFetch() },
    });
    expect(seen[0]).toContain("AI infrastructure for PR agencies");
    expect(seen[0]).toContain("Shadow — AI media intelligence");
  });

  it("survives a failed homepage fetch (domain-only context)", async () => {
    const outcome = await runDiscover({
      domain: "shadow.inc",
      cwd: root,
      generate: stubGenerate(["a"]),
      fetchOptions: { fetch: failFetch() },
    });
    expect(outcome.pageFetchFailed).toBe(true);
    expect(outcome.added).toEqual(["a"]);
  });

  it("normalizes list markers / quotes and caps at --count", async () => {
    const outcome = await runDiscover({
      domain: "shadow.inc",
      cwd: root,
      count: 2,
      generate: stubGenerate(['1. "first prompt"', "- second prompt", "third"]),
      fetchOptions: { fetch: okFetch() },
    });
    expect(outcome.added).toEqual(["first prompt", "second prompt"]);
  });

  it("attributes cost when provider + model are known", async () => {
    const outcome = await runDiscover({
      domain: "shadow.inc",
      cwd: root,
      generate: stubGenerate(["a"]),
      provider: "openai",
      modelName: "gpt-5.4",
      fetchOptions: { fetch: okFetch() },
    });
    expect(outcome.estimatedCostUsd).toBeGreaterThan(0);
  });

  it("defaults to DEFAULT_DISCOVER_COUNT", () => {
    expect(DEFAULT_DISCOVER_COUNT).toBe(10);
  });
});

// ── Renderers ─────────────────────────────────────────────────────

describe("renderDiscoverOutcome", () => {
  it("renders added + skipped + next step", async () => {
    const { workspace } = await ensureWorkspace(root);
    await addPrompts(workspace, ["existing"]);
    const outcome = await runDiscover({
      domain: "shadow.inc",
      cwd: root,
      generate: stubGenerate(["existing", "fresh"]),
      fetchOptions: { fetch: okFetch() },
    });
    const out = renderDiscoverOutcome(outcome, { colors: false });
    expect(out).toContain("added  fresh");
    expect(out).toContain("skipped  existing (already tracked)");
    expect(out).toContain("auto-geo check");
    expect(out).toContain("2 tracked");
  });

  it("renders dry-run with 'would add' and no-write note", async () => {
    const outcome = await runDiscover({
      domain: "shadow.inc",
      cwd: root,
      dryRun: true,
      generate: stubGenerate(["fresh"]),
      fetchOptions: { fetch: okFetch() },
    });
    const out = renderDiscoverOutcome(outcome, { colors: false });
    expect(out).toContain("would add  fresh");
    expect(out).toContain("dry-run — nothing written");
    expect(out).toContain("--dry-run");
  });

  it("notes a failed homepage fetch", async () => {
    const outcome = await runDiscover({
      domain: "shadow.inc",
      cwd: root,
      generate: stubGenerate(["a"]),
      fetchOptions: { fetch: failFetch() },
    });
    const out = renderDiscoverOutcome(outcome, { colors: false });
    expect(out).toContain("homepage fetch failed");
  });

  it("renderDiscoverJson round-trips", async () => {
    const outcome = await runDiscover({
      domain: "shadow.inc",
      cwd: root,
      generate: stubGenerate(["a"]),
      fetchOptions: { fetch: okFetch() },
    });
    const parsed = JSON.parse(renderDiscoverJson(outcome));
    expect(parsed.added).toEqual(["a"]);
    expect(parsed.domain).toBe("shadow.inc");
  });
});
