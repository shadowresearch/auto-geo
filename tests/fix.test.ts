import { describe, expect, it, vi } from "vitest";
import { resourcePublishSchema } from "../cli/schema";
import type { ResourcePublishPayload } from "../cli/schema";
import {
  deriveSlugHint,
  projectChecksAgainstPayload,
  renderDoctorDigestForLlm,
  renderFixHuman,
  renderFixJson,
  runFix,
  type FixCliFlags,
} from "../cli/fix";
import { auditParsedPage } from "../cli/doctor";
import { estimateGenerationCostUsd } from "../cli/llm";
import { parseArgs, run } from "../cli/run";
import type { ParsedPage } from "../cli/types";
import { VALID_PAYLOAD } from "./fixtures/payload";

/**
 * Test strategy: `runFix` accepts injectable network + LLM + filesystem,
 * so every test drives the orchestrator through stubbed dependencies.
 * No real HTTP, no real LLM, no real disk.
 *
 * The most important assertion is that `runFix` calls `generate`,
 * validates the result with `resourcePublishSchema`, projects the
 * doctor checks against the generated payload, and writes the payload
 * to disk via the injected writer.
 */

// ── Helpers ────────────────────────────────────────────────────────

function makePage(overrides: Partial<ParsedPage> = {}): ParsedPage {
  return {
    url: "https://example.com/blog-post",
    text: "",
    wordCount: 0,
    leadText: "",
    firstParagraph: "",
    headings: [],
    jsonLd: [],
    images: [],
    links: [],
    ...overrides,
  };
}

function makeFlags(overrides: Partial<FixCliFlags> = {}): FixCliFlags {
  return {
    url: "https://example.com/blog-post",
    out: "./fixed.json",
    provider: "openai",
    model: "gpt-5.4-mini",
    maxRetries: 2,
    dryRun: false,
    json: false,
    basePath: "/resources",
    authorName: "Jane Doe",
    authorJobTitle: "Head of Content",
    authorBio:
      "Jane writes about generative engine optimization and the architecture of pages AI engines cite.",
    ...overrides,
  };
}

// ── deriveSlugHint ─────────────────────────────────────────────────

describe("deriveSlugHint", () => {
  it("extracts the slug from the URL pathname", () => {
    const page = makePage();
    expect(
      deriveSlugHint("https://example.com/blog/how-does-rag-work", page)
    ).toBe("how-does-rag-work");
  });

  it("strips file extensions", () => {
    const page = makePage();
    expect(deriveSlugHint("https://example.com/post.html", page)).toBe("post");
  });

  it("falls back to the H1 title when the path is empty", () => {
    const page = makePage({
      headings: [{ level: 1, text: "What is GEO? A Primer" }],
    });
    expect(deriveSlugHint("https://example.com/", page)).toBe(
      "what-is-geo-a-primer"
    );
  });

  it("returns 'resource' when nothing usable is found", () => {
    expect(deriveSlugHint("https://example.com/", makePage())).toBe("resource");
  });
});

// ── renderDoctorDigestForLlm ───────────────────────────────────────

describe("renderDoctorDigestForLlm", () => {
  it("includes pass/fail for each check and the fix suggestion when failing", () => {
    const page = makePage({
      wordCount: 100,
      headings: [
        { level: 2, text: "A statement heading" },
        { level: 2, text: "Another statement" },
      ],
    });
    const report = auditParsedPage(page);
    const digest = renderDoctorDigestForLlm(report);
    expect(digest).toContain("FAIL");
    expect(digest).toContain("Question-format H2 headings");
    expect(digest).toContain("Fix:");
  });
});

// ── projectChecksAgainstPayload ────────────────────────────────────

describe("projectChecksAgainstPayload", () => {
  it("marks Article + FAQPage JSON-LD as auto-emitted (pass) on a valid payload", () => {
    const projected = projectChecksAgainstPayload(VALID_PAYLOAD);
    const article = projected.checks.find((c) => c.id === "article-jsonld");
    const faq = projected.checks.find((c) => c.id === "faqpage-jsonld");
    expect(article?.pass).toBe(true);
    expect(article?.payloadOnly).toBe(true);
    expect(article?.detail).toMatch(/auto-emitted/);
    expect(faq?.pass).toBe(true);
    expect(faq?.payloadOnly).toBe(true);
  });

  it("marks image cadence as n/a (pass) on a payload without image blocks", () => {
    const projected = projectChecksAgainstPayload(VALID_PAYLOAD);
    const img = projected.checks.find((c) => c.id === "image-cadence");
    expect(img?.pass).toBe(true);
    expect(img?.payloadOnly).toBe(true);
    expect(img?.detail).toMatch(/payload doesn't include images/);
  });

  it("marks no-self-link as pass-by-construction (schema enforces absolute URLs)", () => {
    const projected = projectChecksAgainstPayload(VALID_PAYLOAD);
    const selfLink = projected.checks.find((c) => c.id === "no-self-link");
    expect(selfLink?.pass).toBe(true);
    expect(selfLink?.payloadOnly).toBe(true);
  });

  it("passes the TL;DR check when the payload's TL;DR is in word range", () => {
    const projected = projectChecksAgainstPayload(VALID_PAYLOAD);
    const tldr = projected.checks.find((c) => c.id === "tldr-present");
    expect(tldr?.pass).toBe(true);
  });

  it("passes question-H2 because every section heading in the fixture is a question", () => {
    const projected = projectChecksAgainstPayload(VALID_PAYLOAD);
    const q = projected.checks.find((c) => c.id === "question-h2");
    expect(q?.pass).toBe(true);
  });

  it("scores the valid fixture at 8/8 after projection", () => {
    const projected = projectChecksAgainstPayload(VALID_PAYLOAD);
    expect(projected.score).toBe(projected.total);
    expect(projected.scorePct).toBe(100);
  });
});

// ── runFix orchestration ───────────────────────────────────────────

describe("runFix — orchestration", () => {
  it("fetches the page, audits, generates, validates, and writes the payload", async () => {
    const page = makePage({
      wordCount: 800,
      text: "Some prose with limited entities and a hedge phrase.",
      leadText: "Some short lead.",
      firstParagraph: "In this article we will explain things.",
      headings: [
        { level: 1, text: "Some Topic" },
        { level: 2, text: "A statement heading" },
      ],
    });

    const generate = vi.fn().mockResolvedValue({
      payload: VALID_PAYLOAD,
      attempts: 1,
      elapsedMs: 1234,
    });
    const writeFile = vi.fn().mockResolvedValue(undefined);

    const outcome = await runFix(makeFlags({ out: "./out.json" }), {
      parsedPage: page,
      generate,
      writeFile,
      resolveApiKey: () => "sk-test",
    });

    expect(generate).toHaveBeenCalledTimes(1);
    const call = generate.mock.calls[0]![0] as Parameters<typeof generate>[0];
    expect(call.provider).toBe("openai");
    expect(call.model).toBe("gpt-5.4-mini");
    expect(call.apiKey).toBe("sk-test");
    expect(call.sourceUrl).toBe("https://example.com/blog-post");
    expect(call.doctorReport).toContain("FAIL");
    expect(call.maxRetries).toBe(2);

    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(writeFile.mock.calls[0]![0]).toMatch(/out\.json$/);
    expect(writeFile.mock.calls[0]![1]).toMatch(/"slug": "sample-resource"/);

    expect(outcome.dryRun).toBe(false);
    expect(outcome.attempts).toBe(1);
    expect(outcome.before.scorePct).toBeLessThan(100);
    expect(outcome.after.scorePct).toBe(100);
    expect(outcome.payload.slug).toBe("sample-resource");
    expect(outcome.publishUrlPreview).toBe(
      "https://example.com/resources/sample-resource"
    );
  });

  it("throws when the LLM returns a payload that fails schema validation", async () => {
    const invalid = {
      ...VALID_PAYLOAD,
      // Slug regex requires lowercase-hyphen-only; uppercase fails.
      slug: "Invalid Slug With Spaces",
    } as unknown as ResourcePublishPayload;

    const generate = vi.fn().mockResolvedValue({
      payload: invalid,
      attempts: 1,
      elapsedMs: 10,
    });
    const writeFile = vi.fn();

    await expect(
      runFix(makeFlags(), {
        parsedPage: makePage(),
        generate,
        writeFile,
        resolveApiKey: () => "sk-test",
      })
    ).rejects.toThrow(/failed final schema validation/);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("errors loudly when the API key is missing", async () => {
    await expect(
      runFix(makeFlags(), {
        parsedPage: makePage(),
        generate: vi.fn(),
        writeFile: vi.fn(),
        resolveApiKey: () => undefined,
      })
    ).rejects.toThrow(/OPENAI_API_KEY is not set/);
  });

  it("uses ANTHROPIC_API_KEY when provider is anthropic", async () => {
    await expect(
      runFix(makeFlags({ provider: "anthropic" }), {
        parsedPage: makePage(),
        generate: vi.fn(),
        writeFile: vi.fn(),
        resolveApiKey: () => undefined,
      })
    ).rejects.toThrow(/ANTHROPIC_API_KEY is not set/);
  });

  it("dry-run skips the LLM call and the file write", async () => {
    const generate = vi.fn();
    const writeFile = vi.fn();
    const outcome = await runFix(makeFlags({ dryRun: true }), {
      parsedPage: makePage({ wordCount: 100, text: "x x x" }),
      generate,
      writeFile,
      resolveApiKey: () => undefined,
    });
    expect(generate).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
    expect(outcome.dryRun).toBe(true);
    expect(outcome.estimatedCostUsd).toBeGreaterThan(0);
  });

  it("self-correction: passes maxRetries through to the generate function", async () => {
    const generate = vi.fn().mockResolvedValue({
      payload: VALID_PAYLOAD,
      attempts: 3,
      elapsedMs: 4500,
    });
    const outcome = await runFix(makeFlags({ maxRetries: 5 }), {
      parsedPage: makePage(),
      generate,
      writeFile: vi.fn(),
      resolveApiKey: () => "sk-test",
    });
    expect(generate.mock.calls[0]![0].maxRetries).toBe(5);
    expect(outcome.attempts).toBe(3);
  });

  it("propagates the basepath into the publish URL preview", async () => {
    const outcome = await runFix(makeFlags({ basePath: "/learn" }), {
      parsedPage: makePage({ wordCount: 100 }),
      generate: vi.fn().mockResolvedValue({
        payload: VALID_PAYLOAD,
        attempts: 1,
        elapsedMs: 1,
      }),
      writeFile: vi.fn(),
      resolveApiKey: () => "sk-test",
    });
    expect(outcome.publishUrlPreview).toBe(
      "https://example.com/learn/sample-resource"
    );
  });
});

// ── Renderers ──────────────────────────────────────────────────────

describe("renderFixHuman / renderFixJson", () => {
  it("human renderer mentions the before/after scores and the next-steps block", async () => {
    const outcome = await runFix(makeFlags(), {
      parsedPage: makePage({ wordCount: 100 }),
      generate: vi.fn().mockResolvedValue({
        payload: VALID_PAYLOAD,
        attempts: 1,
        elapsedMs: 1,
      }),
      writeFile: vi.fn(),
      resolveApiKey: () => "sk-test",
    });
    const out = renderFixHuman(outcome);
    expect(out).toContain("Audit (before)");
    expect(out).toContain("Audit (projected for rewrite)");
    expect(out).toContain("Next steps:");
    expect(out).toContain("Re-audit: npx auto-geo doctor");
  });

  it("human renderer surfaces dry-run mode", async () => {
    const outcome = await runFix(makeFlags({ dryRun: true }), {
      parsedPage: makePage({ wordCount: 100 }),
      generate: vi.fn(),
      writeFile: vi.fn(),
      resolveApiKey: () => undefined,
    });
    const out = renderFixHuman(outcome);
    expect(out).toContain("Dry-run");
    expect(out).toContain("Estimated cost if run");
  });

  it("human renderer uses the shared visual language (branded header, arrow score, ASCII fallback)", async () => {
    const outcome = await runFix(makeFlags(), {
      parsedPage: makePage({ wordCount: 100 }),
      generate: vi.fn().mockResolvedValue({
        payload: VALID_PAYLOAD,
        attempts: 1,
        elapsedMs: 1,
      }),
      writeFile: vi.fn(),
      resolveApiKey: () => "sk-test",
    });
    const rich = renderFixHuman(outcome, { colors: true });
    const plain = renderFixHuman(outcome, { colors: false });
    expect(rich).toContain("auto-geo fix");
    expect(rich).toContain("\u25c6"); // diamond
    expect(rich).toContain("\u25b8"); // arrow on Score lines
    expect(plain).toContain("auto-geo fix");
    expect(plain).toContain("[OK]"); // ASCII status mark
    expect(plain).not.toContain("\u25c6");
    expect(plain).not.toContain("\x1b[");
  });

  it("JSON renderer emits a stable object containing before, after, and payload", async () => {
    const outcome = await runFix(makeFlags(), {
      parsedPage: makePage({ wordCount: 100 }),
      generate: vi.fn().mockResolvedValue({
        payload: VALID_PAYLOAD,
        attempts: 1,
        elapsedMs: 1,
      }),
      writeFile: vi.fn(),
      resolveApiKey: () => "sk-test",
    });
    const json = JSON.parse(renderFixJson(outcome));
    expect(json.generatedBy).toBe("auto-geo fix");
    expect(json.before.score).toBeDefined();
    expect(json.after.score).toBeDefined();
    expect(json.payload.slug).toBe("sample-resource");
  });
});

// ── estimateGenerationCostUsd ──────────────────────────────────────

describe("estimateGenerationCostUsd", () => {
  it("returns a positive estimate for known models", () => {
    expect(
      estimateGenerationCostUsd({ model: "gpt-5.4-mini", inputChars: 8_000 })
    ).toBeGreaterThan(0);
  });

  it("falls back to a default cost for unknown models", () => {
    const cost = estimateGenerationCostUsd({
      model: "future-model-7",
      inputChars: 10_000,
    });
    expect(cost).toBeGreaterThan(0);
  });
});

// ── parseArgs (fix subcommand) ─────────────────────────────────────

describe("parseArgs — fix subcommand", () => {
  it("recognizes 'fix <url>' as the fix command", () => {
    const parsed = parseArgs(["fix", "https://example.com/page"]);
    expect(parsed.command).toBe("fix");
    expect(parsed.url).toBe("https://example.com/page");
  });

  it("parses every fix flag", () => {
    const parsed = parseArgs([
      "fix",
      "https://example.com/page",
      "--out",
      "/tmp/x.json",
      "--provider",
      "anthropic",
      "--model",
      "claude-sonnet-4-6",
      "--max-retries",
      "3",
      "--dry-run",
      "--json",
      "--basepath",
      "/learn",
      "--author-name",
      "Jane",
      "--author-jobtitle",
      "Editor",
      "--author-bio",
      "a 20+ char bio for testing input parsing here",
      "--author-linkedin",
      "https://linkedin.com/in/jane",
    ]);
    expect(parsed.command).toBe("fix");
    expect(parsed.out).toBe("/tmp/x.json");
    expect(parsed.provider).toBe("anthropic");
    expect(parsed.model).toBe("claude-sonnet-4-6");
    expect(parsed.maxRetries).toBe(3);
    expect(parsed.dryRun).toBe(true);
    expect(parsed.json).toBe(true);
    expect(parsed.basePath).toBe("/learn");
    expect(parsed.authorName).toBe("Jane");
    expect(parsed.authorJobTitle).toBe("Editor");
    expect(parsed.authorBio).toBe(
      "a 20+ char bio for testing input parsing here"
    );
    expect(parsed.authorLinkedin).toBe("https://linkedin.com/in/jane");
  });

  it("rejects an unknown provider value", () => {
    expect(() =>
      parseArgs(["fix", "https://x", "--provider", "gemini"])
    ).toThrow(/--provider must be openai or anthropic/);
  });

  it("rejects a negative --max-retries", () => {
    expect(() =>
      parseArgs(["fix", "https://x", "--max-retries", "-1"])
    ).toThrow(/--max-retries/);
  });

  it("still treats a bare URL as the doctor command (back-compat)", () => {
    const parsed = parseArgs(["https://example.com/page"]);
    expect(parsed.command).toBe("doctor");
    expect(parsed.url).toBe("https://example.com/page");
  });
});

// ── run (fix path through the top-level entry) ─────────────────────

describe("run — fix entrypoint", () => {
  it("returns exit code 2 when 'fix' is invoked without a URL", async () => {
    const errors: string[] = [];
    const origErr = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args.join(" "));
    };
    try {
      const code = await run(["fix"]);
      expect(code).toBe(2);
      expect(errors.join("\n")).toContain("missing URL argument");
    } finally {
      console.error = origErr;
    }
  });
});

// ── Sanity: the VALID_PAYLOAD fixture itself is schema-valid ──────

describe("VALID_PAYLOAD fixture", () => {
  it("passes resourcePublishSchema (used as the LLM output stub)", () => {
    expect(resourcePublishSchema.safeParse(VALID_PAYLOAD).success).toBe(true);
  });
});
