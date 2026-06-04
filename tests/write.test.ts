import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  estimateCost,
  estimateCostPerPage,
  formatUsd,
  lookupRate,
  sumUsage,
} from "../cli/cost";
import { deriveUniqueSlugs, slugifyQuery } from "../cli/slug";
import {
  buildUserPrompt,
  formatIssues,
  SchemaValidationError,
  SYSTEM_PROMPT,
  type GenerateResourceOptions,
} from "../cli/llm";
import { parseArgs, parseWriteArgs, run } from "../cli/run";
import {
  DEFAULT_AUTHOR,
  renderWriteJson,
  renderWriteSummary,
  runWrite,
  type WriteSummary,
} from "../cli/write";
import type { ResourceAuthor, ResourcePublishPayload } from "../core/schema";
import { resourcePublishSchema } from "../core/schema";

// ── Mock the AI SDK ────────────────────────────────────────────────

// We mock the entire `ai` module so tests never reach a real LLM.
// Each test sets `mockGenerateObject` to the canned response it needs.
const mockGenerateObject = vi.fn();

vi.mock("ai", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    generateObject: (...args: unknown[]) => mockGenerateObject(...args),
  };
});

// ── Test fixtures ──────────────────────────────────────────────────

const AUTHOR: ResourceAuthor = {
  name: "Test Author",
  jobTitle: "Test Job Title",
  bio: "A test author bio that is at least 20 characters long for the schema.",
  linkedinUrl: "https://www.linkedin.com/in/test-author",
};

function makeValidPayload(
  overrides: Partial<ResourcePublishPayload> = {}
): ResourcePublishPayload {
  const w = (n: number) =>
    Array.from({ length: n }, (_, i) => `word${i + 1}`).join(" ");
  // 50-word strings sit inside the 40-60 window the schema demands.
  const fifty = w(50);
  const twentyFive = w(25); // intro paragraph

  const payload: ResourcePublishPayload = {
    slug: "what-is-geo",
    title: "What is generative engine optimization?",
    metaDescription:
      "A 50-character-plus meta description that satisfies the schema minimum and stays under the upper bound.",
    category: "Concepts",
    excerpt:
      "A 50-character-plus excerpt that satisfies the schema minimum and stays under the upper bound for a test fixture.",
    author: AUTHOR,
    publishedAt: "2026-06-02",
    geoMetadata: {
      targetQueries: ["what is GEO"],
      pageType: "resource",
      primaryFunction:
        "Define generative engine optimization for a reader new to the topic.",
      optimizationFramework: ["GEO"],
      targetPlatforms: ["chatgpt", "perplexity", "google_aio"],
      informationGainStatement:
        "First-party synthesis from a team running GEO programs in production, summarized for a test fixture.",
      refreshCadence: "quarterly",
    },
    tldr: { text: fifty },
    intro: {
      blocks: [{ type: "paragraph", text: twentyFive }],
    },
    sections: [
      {
        heading: "What is generative engine optimization?",
        answerCapsule: fifty,
        blocks: [],
      },
    ],
    relatedGuides: {
      items: [
        {
          title: "Princeton GEO paper",
          url: "https://arxiv.org/abs/2311.09735",
        },
        { title: "Schema.org Article", url: "https://schema.org/Article" },
        {
          title: "Google AI Overviews launch",
          url: "https://blog.google/products/search/generative-ai-google-search-may-2024/",
        },
        {
          title: "auto-geo on GitHub",
          url: "https://github.com/shadowresearch/auto-geo",
        },
      ],
    },
    keyTakeaways: {
      items: [
        "Generative engine optimization (GEO) makes pages quotable by AI engines like ChatGPT and Perplexity through enforced structure.",
        "Page architecture is the discipline that matters most for citation: TL;DR, question H2s, FAQ, related guides, key takeaways.",
        "Entity density is empirically linked to a roughly 4.8x lift in citation probability across the major AI search engines.",
        "Soft warnings via auto-geo audit are how teams iterate on quality after the page is structurally publishable through the boundary.",
      ],
    },
    faq: {
      items: [
        {
          question: "What is GEO?",
          answer: w(50),
        },
        {
          question: "How is GEO different from SEO?",
          answer: w(50),
        },
        {
          question: "Which AI engines does GEO target?",
          answer: w(50),
        },
      ],
    },
    disclosure: {
      text: "This is a test disclosure with at least twenty characters.",
    },
    ...overrides,
  };

  return payload;
}

beforeEach(() => {
  mockGenerateObject.mockReset();
});

// ── slugifyQuery ───────────────────────────────────────────────────

describe("slugifyQuery", () => {
  it("strips question words and lowercases", () => {
    expect(slugifyQuery("What is GEO")).toBe("geo");
    expect(slugifyQuery("How does GEO work?")).toBe("geo-work");
  });

  it("preserves topical multiword phrases", () => {
    expect(slugifyQuery("GEO vs SEO")).toBe("geo-vs-seo");
    expect(slugifyQuery("how to get cited by ChatGPT")).toBe(
      "get-cited-chatgpt"
    );
  });

  it("matches the schema regex", () => {
    const slugs = [
      slugifyQuery("What is GEO?"),
      slugifyQuery("How do I rank in AI Overviews?"),
      slugifyQuery("Why does it matter for B2B SaaS?"),
    ];
    for (const s of slugs) {
      expect(s).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it("falls back gracefully on all-stopword input", () => {
    expect(slugifyQuery("the a an")).toBe("the-a-an");
  });

  it("returns 'page' for empty input", () => {
    expect(slugifyQuery("")).toBe("page");
  });
});

// ── deriveUniqueSlugs ──────────────────────────────────────────────

describe("deriveUniqueSlugs", () => {
  it("appends -2/-3 discriminators on collision", () => {
    const slugs = deriveUniqueSlugs([
      "What is GEO?",
      "What is GEO?",
      "What is GEO!",
    ]);
    expect(slugs).toEqual(["geo", "geo-2", "geo-3"]);
  });

  it("does not discriminate when slugs are distinct", () => {
    expect(deriveUniqueSlugs(["What is GEO?", "GEO vs SEO"])).toEqual([
      "geo",
      "geo-vs-seo",
    ]);
  });
});

// ── cost ────────────────────────────────────────────────────────────

describe("cost lookup + estimation", () => {
  it("matches the longest-prefix model row", () => {
    expect(lookupRate("openai", "gpt-4o-2024-08-06").input).toBe(2.5);
    expect(lookupRate("openai", "gpt-4o-mini-foo").input).toBe(0.15);
    expect(lookupRate("anthropic", "claude-sonnet-4-6").input).toBe(3);
  });

  it("falls back to provider default for unknown models", () => {
    const r = lookupRate("openai", "gpt-99-unknown");
    expect(r.input).toBeGreaterThan(0);
  });

  it("estimateCost is the linear combination of rates", () => {
    const cost = estimateCost("openai", "gpt-4o-mini", {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      totalTokens: 2_000_000,
    });
    expect(cost).toBeCloseTo(0.15 + 0.6, 4);
  });

  it("sumUsage aggregates token counts", () => {
    const u = sumUsage([
      { inputTokens: 100, outputTokens: 200, totalTokens: 300 },
      { inputTokens: 50, outputTokens: 75, totalTokens: 125 },
    ]);
    expect(u).toEqual({
      inputTokens: 150,
      outputTokens: 275,
      totalTokens: 425,
    });
  });

  it("formatUsd handles the small-amount edge case", () => {
    expect(formatUsd(0.0001)).toBe("<$0.01");
    expect(formatUsd(0.05)).toBe("$0.05");
    expect(formatUsd(1.234)).toBe("$1.23");
  });

  it("estimateCostPerPage returns a small positive number", () => {
    const c = estimateCostPerPage("openai", "gpt-4o-mini");
    expect(c).toBeGreaterThan(0);
    expect(c).toBeLessThan(0.1);
  });
});

// ── SYSTEM_PROMPT + buildUserPrompt ────────────────────────────────

describe("LLM prompts", () => {
  it("SYSTEM_PROMPT covers the hard schema rules", () => {
    expect(SYSTEM_PROMPT).toMatch(/40-60 words/);
    expect(SYSTEM_PROMPT).toMatch(/banned/i);
    expect(SYSTEM_PROMPT).toMatch(/slug regex/i);
  });

  it("buildUserPrompt embeds the query, slug, and internal link template", () => {
    const prompt = buildUserPrompt({
      domain: "https://www.shadow.inc",
      basePath: "/resources",
      query: "what is GEO",
      slug: "geo",
      author: AUTHOR,
      publishedAt: "2026-06-02",
    });
    expect(prompt).toContain("https://www.shadow.inc");
    expect(prompt).toContain("/resources/<related-slug>");
    expect(prompt).toContain("what is GEO");
    expect(prompt).toContain("2026-06-02");
  });

  it("formatIssues renders Zod issues into a numbered list", () => {
    const out = formatIssues([
      { code: "custom", path: ["tldr", "text"], message: "too short" } as never,
      { code: "custom", path: [], message: "root issue" } as never,
    ]);
    expect(out).toContain("1. [tldr.text] too short");
    expect(out).toContain("2. [<root>] root issue");
  });
});

// ── parseWriteArgs ─────────────────────────────────────────────────

describe("parseWriteArgs", () => {
  it("requires --domain and --query at the parser level (defaults populate the rest)", () => {
    const args = parseWriteArgs([
      "--domain",
      "https://example.com",
      "--query",
      "what is X",
    ]);
    expect(args.command).toBe("write");
    expect(args.domain).toBe("https://example.com");
    expect(args.queries).toEqual(["what is X"]);
    expect(args.out).toBe("./out");
    expect(args.provider).toBe("openai");
    expect(args.basePath).toBe("/resources");
    expect(args.maxRetries).toBe(2);
  });

  it("accepts multiple --query values", () => {
    const args = parseWriteArgs([
      "--domain",
      "https://example.com",
      "--query",
      "a",
      "--query",
      "b",
      "--query",
      "c",
    ]);
    expect(args.queries).toEqual(["a", "b", "c"]);
  });

  it("rejects an unknown provider", () => {
    expect(() =>
      parseWriteArgs(["--domain", "https://x", "--provider", "cohere"])
    ).toThrow(/--provider must be/);
  });

  it("rejects non-integer --max-retries", () => {
    expect(() =>
      parseWriteArgs(["--domain", "https://x", "--max-retries", "1.5"])
    ).toThrow(/non-negative integer/);
  });

  it("captures --dry-run as a boolean", () => {
    const args = parseWriteArgs([
      "--domain",
      "https://x",
      "--query",
      "x",
      "--dry-run",
    ]);
    expect(args.dryRun).toBe(true);
  });

  it("dispatches via parseArgs(write)", () => {
    const parsed = parseArgs([
      "write",
      "--domain",
      "https://x",
      "--query",
      "x",
    ]);
    expect(parsed.command).toBe("write");
  });
});

// ── runWrite — dry-run path ────────────────────────────────────────

describe("runWrite — dry-run", () => {
  it("writes nothing, estimates cost per query", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "auto-geo-write-dry-"));
    const summary = await runWrite({
      domain: "https://example.com",
      queries: ["what is GEO", "GEO vs SEO"],
      outDir: dir,
      provider: "openai",
      modelName: "gpt-4o-mini",
      basePath: "/resources",
      author: AUTHOR,
      publishedAt: "2026-06-02",
      maxRetries: 2,
      dryRun: true,
    });
    expect(summary.dryRun).toBe(true);
    expect(summary.outcomes).toHaveLength(2);
    expect(summary.outcomes.every((o) => o.kind === "dry-run")).toBe(true);
    expect(summary.totalCost).toBeGreaterThan(0);
    // No files written.
    expect(existsSync(path.join(dir, "geo.json"))).toBe(false);
  });

  it("throws if model is missing and not in dry-run mode", async () => {
    await expect(
      runWrite({
        domain: "https://example.com",
        queries: ["x"],
        outDir: tmpdir(),
        provider: "openai",
        modelName: "gpt-4o-mini",
        basePath: "/resources",
        author: AUTHOR,
        publishedAt: "2026-06-02",
        maxRetries: 2,
        dryRun: false,
      })
    ).rejects.toThrow(/model.*required/);
  });
});

// ── runWrite — happy path (mocked LLM) ─────────────────────────────

describe("runWrite — generates and writes files", () => {
  it("calls generateObject for each query and writes valid JSON to disk", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "auto-geo-write-ok-"));
    mockGenerateObject.mockImplementation(async () => ({
      object: makeValidPayload(),
      usage: { inputTokens: 1000, outputTokens: 3000, totalTokens: 4000 },
    }));

    const summary = await runWrite({
      domain: "https://example.com",
      queries: ["what is GEO", "GEO vs SEO"],
      outDir: dir,
      provider: "openai",
      modelName: "gpt-4o-mini",
      model: {} as never, // mocked SDK ignores the model
      basePath: "/resources",
      author: AUTHOR,
      publishedAt: "2026-06-02",
      maxRetries: 2,
      concurrency: 2,
    });

    expect(mockGenerateObject).toHaveBeenCalledTimes(2);
    expect(summary.outcomes.every((o) => o.kind === "ok")).toBe(true);
    // Files exist on disk.
    expect(existsSync(path.join(dir, "geo.json"))).toBe(true);
    expect(existsSync(path.join(dir, "geo-vs-seo.json"))).toBe(true);
    // The written payload validates against the canonical schema.
    const written = JSON.parse(
      readFileSync(path.join(dir, "geo.json"), "utf8")
    );
    const parsed = resourcePublishSchema.safeParse(written);
    expect(parsed.success).toBe(true);
    // The slug is overridden by the deterministic caller-derived slug,
    // regardless of what the LLM picked.
    expect(written.slug).toBe("geo");
  });

  it("retries when the first draft fails schema validation", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "auto-geo-write-retry-"));
    const bad = makeValidPayload({ tldr: { text: "too short" } });
    const good = makeValidPayload();
    mockGenerateObject
      .mockResolvedValueOnce({
        object: bad,
        usage: { inputTokens: 1000, outputTokens: 3000, totalTokens: 4000 },
      })
      .mockResolvedValueOnce({
        object: good,
        usage: { inputTokens: 500, outputTokens: 2500, totalTokens: 3000 },
      });

    const summary = await runWrite({
      domain: "https://example.com",
      queries: ["what is GEO"],
      outDir: dir,
      provider: "openai",
      modelName: "gpt-4o-mini",
      model: {} as never,
      basePath: "/resources",
      author: AUTHOR,
      publishedAt: "2026-06-02",
      maxRetries: 2,
    });

    expect(mockGenerateObject).toHaveBeenCalledTimes(2);
    expect(summary.outcomes[0]?.kind).toBe("ok");
    if (summary.outcomes[0]?.kind === "ok") {
      expect(summary.outcomes[0].retries).toBe(1);
    }
  });

  it("returns a failed outcome after exhausting retries", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "auto-geo-write-fail-"));
    mockGenerateObject.mockResolvedValue({
      object: makeValidPayload({ tldr: { text: "way too short" } }),
      usage: { inputTokens: 1000, outputTokens: 1000, totalTokens: 2000 },
    });

    const summary = await runWrite({
      domain: "https://example.com",
      queries: ["bad query"],
      outDir: dir,
      provider: "openai",
      modelName: "gpt-4o-mini",
      model: {} as never,
      basePath: "/resources",
      author: AUTHOR,
      publishedAt: "2026-06-02",
      maxRetries: 1, // 1 retry → 2 attempts total
    });

    expect(mockGenerateObject).toHaveBeenCalledTimes(2);
    expect(summary.outcomes[0]?.kind).toBe("failed");
    if (summary.outcomes[0]?.kind === "failed") {
      expect(summary.outcomes[0].issues?.length).toBeGreaterThan(0);
      // No file written for failed outcomes.
      expect(existsSync(summary.outcomes[0].filePath)).toBe(false);
    }
  });
});

// ── Rendering ──────────────────────────────────────────────────────

describe("renderWriteSummary + renderWriteJson", () => {
  function fakeSummary(overrides: Partial<WriteSummary> = {}): WriteSummary {
    return {
      domain: "https://example.com",
      provider: "openai",
      modelName: "gpt-4o-mini",
      outDir: "/tmp/out",
      dryRun: false,
      outcomes: [],
      totalUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      totalCost: 0,
      elapsedMs: 0,
      ...overrides,
    };
  }

  it("human renderer includes domain, query count, provider", () => {
    const s = fakeSummary({
      outcomes: [
        {
          kind: "ok",
          query: "what is GEO",
          slug: "geo",
          filePath: "/tmp/out/geo.json",
          payload: makeValidPayload(),
          usage: { inputTokens: 1000, outputTokens: 3000, totalTokens: 4000 },
          retries: 0,
          cost: 0.018,
        },
      ],
      totalCost: 0.018,
      elapsedMs: 12000,
    });
    const out = renderWriteSummary(s);
    expect(out).toContain("https://example.com");
    expect(out).toContain("openai (gpt-4o-mini)");
    expect(out).toContain('"what is GEO"');
    expect(out).toContain("12.0s elapsed");
  });

  it("human renderer surfaces failure issues", () => {
    const s = fakeSummary({
      outcomes: [
        {
          kind: "failed",
          query: "bad",
          slug: "bad",
          filePath: "/tmp/out/bad.json",
          error: "validation exhausted",
          issues: [{ path: "tldr.text", message: "too short" }],
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        },
      ],
    });
    const out = renderWriteSummary(s);
    expect(out).toContain("validation exhausted");
    expect(out).toContain("[tldr.text]");
    expect(out).toContain("too short");
  });

  it("renderWriteJson round-trips through JSON.parse", () => {
    const s = fakeSummary();
    const obj = JSON.parse(renderWriteJson(s));
    expect(obj.generatedBy).toBe("auto-geo write");
    expect(obj.domain).toBe(s.domain);
  });

  it("human renderer includes the branded header and uses the shared visual language", () => {
    const s = fakeSummary({
      outcomes: [
        {
          kind: "ok",
          query: "what is GEO",
          slug: "geo",
          filePath: "/tmp/out/geo.json",
          payload: makeValidPayload(),
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          retries: 0,
          cost: 0.018,
        },
      ],
    });
    const rich = renderWriteSummary(s, { colors: true });
    const plain = renderWriteSummary(s, { colors: false });
    expect(rich).toContain("auto-geo write");
    expect(rich).toContain("\u25c6"); // diamond
    expect(rich).toContain("\u25b8"); // arrow on Total line
    expect(plain).toContain("auto-geo write");
    expect(plain).toContain("[OK]"); // ASCII status mark
    expect(plain).not.toContain("\u25c6");
    expect(plain).not.toContain("\x1b[");
  });

  it("human renderer emits no ANSI when colors disabled", () => {
    const s = fakeSummary();
    expect(renderWriteSummary(s, { colors: false })).not.toContain("\x1b[");
  });
});

// ── run() integration via CLI parser ───────────────────────────────

describe("run() — write subcommand", () => {
  const originalEnv = { ...process.env };
  let logs: string[];
  let errs: string[];
  const origLog = console.log;
  const origErr = console.error;

  beforeEach(() => {
    logs = [];
    errs = [];
    console.log = (...a: unknown[]) => {
      logs.push(a.join(" "));
    };
    console.error = (...a: unknown[]) => {
      errs.push(a.join(" "));
    };
  });

  afterEach(() => {
    console.log = origLog;
    console.error = origErr;
    process.env = { ...originalEnv };
  });

  it("returns exit code 2 when --domain is missing", async () => {
    const code = await run(["write", "--query", "what is GEO"]);
    expect(code).toBe(2);
    expect(errs.join("\n")).toContain("--domain");
  });

  it("returns exit code 2 when --domain is not a URL", async () => {
    const code = await run(["write", "--domain", "shadow.inc", "--query", "x"]);
    expect(code).toBe(2);
    expect(errs.join("\n")).toContain("full URL");
  });

  it("returns exit code 2 with no queries provided", async () => {
    const code = await run(["write", "--domain", "https://shadow.inc"]);
    expect(code).toBe(2);
    expect(errs.join("\n")).toContain("--query");
  });

  it("returns exit code 0 in --dry-run without an API key", async () => {
    delete process.env.OPENAI_API_KEY;
    const dir = mkdtempSync(path.join(tmpdir(), "auto-geo-write-cli-"));
    const code = await run([
      "write",
      "--domain",
      "https://shadow.inc",
      "--query",
      "what is GEO",
      "--out",
      dir,
      "--dry-run",
      "--no-color",
    ]);
    expect(code).toBe(0);
    expect(logs.join("\n")).toContain("dry-run");
  });
});

// ── DEFAULT_AUTHOR sanity ─────────────────────────────────────────

describe("DEFAULT_AUTHOR", () => {
  it("validates against the schema's author block", () => {
    // Author schema is enforced as part of resourcePublishSchema, so we
    // assert via constructing a payload around it.
    const payload = makeValidPayload({ author: DEFAULT_AUTHOR });
    const parsed = resourcePublishSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
  });
});

// ── Type-only — confirm GenerateResourceOptions is exposed ─────────

describe("GenerateResourceOptions shape", () => {
  it("compiles with the expected required fields", () => {
    const opts: Omit<GenerateResourceOptions, "model"> = {
      provider: "openai",
      modelName: "gpt-4o-mini",
      domain: "https://example.com",
      basePath: "/resources",
      query: "what is GEO",
      slug: "geo",
      author: AUTHOR,
      publishedAt: "2026-06-02",
    };
    expect(opts.provider).toBe("openai");
  });
});

// ── SchemaValidationError attached to module exports ──────────────

describe("SchemaValidationError", () => {
  it("preserves the issues array", () => {
    const err = new SchemaValidationError("bad", [
      { code: "custom", path: ["x"], message: "y" } as never,
    ]);
    expect(err.name).toBe("SchemaValidationError");
    expect(err.issues).toHaveLength(1);
  });
});
