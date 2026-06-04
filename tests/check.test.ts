import { afterEach, describe, expect, it } from "vitest";
import {
  createEngine,
  hostnameMatchesDomain,
  normalizeDomain,
  runCheck,
  type CheckReport,
} from "../cli/check";
import {
  createOpenAIEngine,
  parseOpenAICitations,
} from "../cli/engines/openai";
import { createPerplexityEngine } from "../cli/engines/perplexity";
import type { CitedSource, Engine, EngineResponse } from "../cli/engines/types";
import { renderCheckHuman, renderCheckJson } from "../cli/render";
import { parseArgs, run } from "../cli/run";

/**
 * Test strategy: like the doctor suite, the network layer is fully
 * mocked. Engine adapters take an injectable `fetch` so we can drive
 * the HTTP shape from the test. The orchestrator is exercised against
 * a hand-built `Engine` impl that returns fixed citations — letting
 * us verify domain matching, ranking, JSON output, and exit codes
 * without hitting a real API.
 */

// ── Fixture helpers ────────────────────────────────────────────────

function makeEngine(
  responses: Record<string, EngineResponse>,
  opts: { name?: string; model?: string; throwFor?: string[] } = {}
): Engine {
  return {
    name: opts.name ?? "test-engine",
    model: opts.model ?? "test-model",
    async askWithCitations(query) {
      if (opts.throwFor?.includes(query)) {
        throw new Error(`forced failure for ${query}`);
      }
      const r = responses[query];
      if (!r) throw new Error(`no fixture response for query: ${query}`);
      return r;
    },
  };
}

function sources(...urls: string[]): CitedSource[] {
  return urls.map((url) => ({ url }));
}

// ── normalizeDomain ───────────────────────────────────────────────

describe("normalizeDomain", () => {
  it("returns a bare host unchanged (modulo case)", () => {
    expect(normalizeDomain("shadow.inc")).toBe("shadow.inc");
    expect(normalizeDomain("SHADOW.INC")).toBe("shadow.inc");
  });

  it("strips the protocol", () => {
    expect(normalizeDomain("https://shadow.inc")).toBe("shadow.inc");
    expect(normalizeDomain("http://shadow.inc")).toBe("shadow.inc");
  });

  it("strips the path", () => {
    expect(normalizeDomain("https://shadow.inc/resources/page")).toBe(
      "shadow.inc"
    );
  });

  it("strips a leading www.", () => {
    expect(normalizeDomain("www.shadow.inc")).toBe("shadow.inc");
    expect(normalizeDomain("https://www.shadow.inc")).toBe("shadow.inc");
  });

  it("throws on input that is clearly not a domain", () => {
    expect(() => normalizeDomain("")).toThrow();
    expect(() => normalizeDomain("not a domain")).toThrow();
    expect(() => normalizeDomain("localhost")).toThrow();
  });
});

// ── hostnameMatchesDomain ─────────────────────────────────────────

describe("hostnameMatchesDomain", () => {
  it("matches the exact host", () => {
    expect(hostnameMatchesDomain("https://shadow.inc/p", "shadow.inc")).toBe(
      true
    );
  });

  it("matches www. on the citation side", () => {
    expect(
      hostnameMatchesDomain("https://www.shadow.inc/p", "shadow.inc")
    ).toBe(true);
  });

  it("matches a subdomain via suffix", () => {
    expect(
      hostnameMatchesDomain("https://blog.shadow.inc/p", "shadow.inc")
    ).toBe(true);
    expect(
      hostnameMatchesDomain("https://docs.research.shadow.inc/p", "shadow.inc")
    ).toBe(true);
  });

  it("does NOT match a sneaky substring (notshadow.inc)", () => {
    expect(hostnameMatchesDomain("https://notshadow.inc/p", "shadow.inc")).toBe(
      false
    );
    expect(
      hostnameMatchesDomain("https://shadow.inc.evil.com/p", "shadow.inc")
    ).toBe(false);
  });

  it("returns false for unparseable URLs", () => {
    expect(hostnameMatchesDomain("not a url", "shadow.inc")).toBe(false);
  });

  it("matches case-insensitively", () => {
    expect(hostnameMatchesDomain("https://Shadow.Inc/p", "shadow.inc")).toBe(
      true
    );
  });
});

// ── runCheck orchestrator ─────────────────────────────────────────

describe("runCheck", () => {
  it("scores a single cited query with the right rank", async () => {
    const engine = makeEngine({
      "what is GEO": {
        answer: "GEO is …",
        citations: sources(
          "https://arxiv.org/abs/2311.09735",
          "https://www.shadow.inc/resources/what-is-geo",
          "https://searchengineland.com/geo"
        ),
      },
    });
    const report = await runCheck({
      domain: "shadow.inc",
      queries: ["what is GEO"],
      engine,
    });
    expect(report.summary.coveragePct).toBe(100);
    expect(report.summary.citedQueryCount).toBe(1);
    expect(report.results[0]!.cited).toBe(true);
    expect(report.results[0]!.citations).toEqual([
      {
        url: "https://www.shadow.inc/resources/what-is-geo",
        title: undefined,
        rank: 2,
        totalCitationsForQuery: 3,
      },
    ]);
  });

  it("reports 0% coverage when no citation matches the domain", async () => {
    const engine = makeEngine({
      q1: { answer: "x", citations: sources("https://arxiv.org/a") },
    });
    const report = await runCheck({
      domain: "shadow.inc",
      queries: ["q1"],
      engine,
    });
    expect(report.summary.coveragePct).toBe(0);
    expect(report.results[0]!.cited).toBe(false);
  });

  it("preserves input order across queries even with concurrency > 1", async () => {
    const engine = makeEngine({
      a: { answer: "", citations: sources("https://shadow.inc/a") },
      b: { answer: "", citations: sources("https://other.com/b") },
      c: { answer: "", citations: sources("https://shadow.inc/c") },
    });
    const report = await runCheck({
      domain: "shadow.inc",
      queries: ["a", "b", "c"],
      engine,
      concurrency: 3,
    });
    expect(report.results.map((r) => r.query)).toEqual(["a", "b", "c"]);
    expect(report.results.map((r) => r.cited)).toEqual([true, false, true]);
  });

  it("records errors per-query without halting the run", async () => {
    const engine = makeEngine(
      {
        ok: { answer: "", citations: sources("https://shadow.inc/p") },
        bad: { answer: "", citations: [] },
      },
      { throwFor: ["bad"] }
    );
    const report = await runCheck({
      domain: "shadow.inc",
      queries: ["ok", "bad"],
      engine,
    });
    expect(report.results[0]!.cited).toBe(true);
    expect(report.results[1]!.error).toContain("forced failure");
    expect(report.summary.errors).toEqual([
      { query: "bad", error: expect.stringContaining("forced failure") },
    ]);
    // Coverage uses successful queries; one out of two still cited.
    expect(report.summary.coveragePct).toBe(50);
  });

  it("aggregates estimated cost across queries", async () => {
    const engine = makeEngine({
      a: {
        answer: "",
        citations: [],
        usage: { estimatedCostUsd: 0.004 },
      },
      b: {
        answer: "",
        citations: [],
        usage: { estimatedCostUsd: 0.006 },
      },
    });
    const report = await runCheck({
      domain: "shadow.inc",
      queries: ["a", "b"],
      engine,
    });
    expect(report.summary.estimatedCostUsd).toBeCloseTo(0.01, 6);
  });

  it("counts multiple domain citations within one query", async () => {
    const engine = makeEngine({
      q: {
        answer: "",
        citations: sources(
          "https://www.shadow.inc/a",
          "https://other.com/b",
          "https://blog.shadow.inc/c"
        ),
      },
    });
    const report = await runCheck({
      domain: "shadow.inc",
      queries: ["q"],
      engine,
    });
    expect(report.results[0]!.citations).toHaveLength(2);
    expect(report.summary.totalCitations).toBe(2);
  });
});

// ── Renderers ──────────────────────────────────────────────────────

describe("renderCheckHuman", () => {
  const sampleReport: CheckReport = {
    domain: "shadow.inc",
    engine: "perplexity",
    model: "sonar",
    results: [
      {
        query: "what is GEO",
        cited: false,
        citations: [],
        rawSources: sources(
          "https://arxiv.org/x",
          "https://searchengineland.com/y"
        ),
        answer: "",
      },
      {
        query: "open source GEO tools",
        cited: true,
        citations: [
          {
            url: "https://github.com/shadowresearch/auto-geo",
            rank: 2,
            totalCitationsForQuery: 4,
          },
        ],
        rawSources: sources(
          "https://other.com/a",
          "https://github.com/shadowresearch/auto-geo",
          "https://x.com/b",
          "https://y.com/c"
        ),
        answer: "",
      },
    ],
    summary: {
      citedQueryCount: 1,
      totalQueries: 2,
      coveragePct: 50,
      totalCitations: 1,
      estimatedCostUsd: 0.012,
      errors: [],
    },
    generatedBy: "auto-geo check",
  };

  it("renders a header, per-query lines, and coverage footer", () => {
    const out = renderCheckHuman(sampleReport);
    expect(out).toContain("auto-geo check");
    expect(out).toContain("domain:    shadow.inc");
    expect(out).toContain('"what is GEO"');
    expect(out).toContain("shadow.inc NOT cited");
    expect(out).toContain("shadow.inc cited — 1 page");
    expect(out).toContain("rank 2 of 4");
    expect(out).toContain("Coverage: 1/2 queries (50%)");
    expect(out).toContain("~$0.012 spent");
  });

  it("emits ANSI codes when colors: true and none when colors: false", () => {
    expect(renderCheckHuman(sampleReport, { colors: true })).toContain("\x1b[");
    expect(renderCheckHuman(sampleReport, { colors: false })).not.toContain(
      "\x1b["
    );
  });

  it("renders the branded header and a coverage callout with arrow glyph in rich mode", () => {
    const rich = renderCheckHuman(sampleReport, { colors: true });
    expect(rich).toContain("auto-geo check");
    expect(rich).toContain("\u25c6"); // diamond
    expect(rich).toContain("\u25b8"); // arrow on Coverage line
  });

  it("falls back to ASCII glyphs and no box-drawing in plain mode", () => {
    const plain = renderCheckHuman(sampleReport, { colors: false });
    expect(plain).not.toContain("\u25c6");
    expect(plain).not.toContain("\u25b8");
    expect(plain).not.toContain("\u2500");
    // Plain mode uses [OK]/[FAIL] for the nested per-query status row.
    expect(plain).toMatch(/\[(OK|FAIL)\]/);
  });
});

describe("renderCheckJson", () => {
  it("round-trips through JSON.parse to the original shape", () => {
    const r: CheckReport = {
      domain: "shadow.inc",
      engine: "perplexity",
      model: "sonar",
      results: [],
      summary: {
        citedQueryCount: 0,
        totalQueries: 0,
        coveragePct: 0,
        totalCitations: 0,
        estimatedCostUsd: 0,
        errors: [],
      },
      generatedBy: "auto-geo check",
    };
    const parsed = JSON.parse(renderCheckJson(r));
    expect(parsed.domain).toBe("shadow.inc");
    expect(parsed.generatedBy).toBe("auto-geo check");
  });
});

// ── Perplexity engine (mocked fetch) ──────────────────────────────

describe("createPerplexityEngine", () => {
  it("normalizes citations from a sonar response", async () => {
    const fakeFetch: typeof globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                role: "assistant",
                content: "GEO stands for…",
              },
            },
          ],
          citations: ["https://arxiv.org/abs/x", "https://www.shadow.inc/p"],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 200,
            total_tokens: 300,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    const engine = createPerplexityEngine({
      apiKey: "test",
      fetch: fakeFetch,
    });
    const res = await engine.askWithCitations("what is GEO");
    expect(res.answer).toBe("GEO stands for…");
    expect(res.citations).toHaveLength(2);
    expect(res.citations[0]!.url).toBe("https://arxiv.org/abs/x");
    expect(res.usage?.totalTokens).toBe(300);
    expect(res.usage?.estimatedCostUsd).toBeGreaterThan(0);
  });

  it("prefers search_results (titles) over the bare citations array", async () => {
    const fakeFetch: typeof globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "x" } }],
          citations: ["https://x.com/a"],
          search_results: [
            {
              title: "Auto-geo README",
              url: "https://github.com/shadowresearch/auto-geo",
            },
          ],
        }),
        { status: 200 }
      );
    const engine = createPerplexityEngine({
      apiKey: "test",
      fetch: fakeFetch,
    });
    const res = await engine.askWithCitations("q");
    expect(res.citations).toEqual([
      {
        url: "https://github.com/shadowresearch/auto-geo",
        title: "Auto-geo README",
      },
    ]);
  });

  it("throws a useful error when the API key is missing", async () => {
    const engine = createPerplexityEngine({
      apiKey: "",
      fetch: (async () => new Response("")) as typeof globalThis.fetch,
    });
    await expect(engine.askWithCitations("q")).rejects.toThrow(
      /PERPLEXITY_API_KEY/
    );
  });

  it("throws on non-OK HTTP response", async () => {
    const fakeFetch: typeof globalThis.fetch = async () =>
      new Response("rate limited", { status: 429, statusText: "Too Many" });
    const engine = createPerplexityEngine({
      apiKey: "test",
      fetch: fakeFetch,
    });
    await expect(engine.askWithCitations("q")).rejects.toThrow(/429/);
  });
});

// ── OpenAI engine (stub) ──────────────────────────────────────────

describe("createOpenAIEngine", () => {
  it("returns an engine whose askWithCitations throws the not-implemented error", async () => {
    const engine = createOpenAIEngine({ apiKey: "test" });
    expect(engine.name).toBe("openai");
    await expect(engine.askWithCitations("q")).rejects.toThrow(
      /not yet implemented/
    );
  });

  it("parses url_citation annotations from a Responses-API shape", () => {
    const out = parseOpenAICitations({
      output: [
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: "GEO is a thing.",
              annotations: [
                {
                  type: "url_citation",
                  url: "https://www.shadow.inc/p",
                  title: "Shadow on GEO",
                },
                {
                  type: "url_citation",
                  url: "https://www.shadow.inc/p", // duplicate dropped
                },
              ],
            },
          ],
        },
      ],
    });
    expect(out).toEqual([
      { url: "https://www.shadow.inc/p", title: "Shadow on GEO" },
    ]);
  });
});

// ── createEngine dispatcher ───────────────────────────────────────

describe("createEngine", () => {
  it("returns a perplexity engine for 'perplexity'", () => {
    const e = createEngine("perplexity", { apiKey: "x" });
    expect(e.name).toBe("perplexity");
  });

  it("returns an openai engine for 'openai'", () => {
    const e = createEngine("openai", { apiKey: "x" });
    expect(e.name).toBe("openai");
  });
});

// ── CLI parser ────────────────────────────────────────────────────

describe("parseArgs — check subcommand", () => {
  it("collects multiple --query flags", () => {
    const a = parseArgs([
      "check",
      "--domain",
      "shadow.inc",
      "--query",
      "what is GEO",
      "--query",
      "open source GEO",
    ]);
    expect(a.command).toBe("check");
    expect(a.domain).toBe("shadow.inc");
    expect(a.queries).toEqual(["what is GEO", "open source GEO"]);
  });

  it("parses --engine, --model, --json, --concurrency", () => {
    const a = parseArgs([
      "check",
      "--domain",
      "shadow.inc",
      "--query",
      "x",
      "--engine",
      "perplexity",
      "--model",
      "sonar-pro",
      "--json",
      "--concurrency",
      "4",
    ]);
    expect(a.engine).toBe("perplexity");
    expect(a.model).toBe("sonar-pro");
    expect(a.json).toBe(true);
    expect(a.concurrency).toBe(4);
  });

  it("throws when --domain is missing a value", () => {
    expect(() => parseArgs(["check", "--domain"])).toThrow(/--domain requires/);
  });

  it("throws on a positional inside `check`", () => {
    expect(() =>
      parseArgs(["check", "--domain", "shadow.inc", "extra"])
    ).toThrow(/unexpected positional/);
  });

  it("does not interfere with the doctor subcommand", () => {
    const a = parseArgs(["doctor", "https://example.com/p"]);
    expect(a.command).toBe("doctor");
    expect(a.url).toBe("https://example.com/p");
  });
});

// ── CLI run() integration ─────────────────────────────────────────

describe("run() — check subcommand", () => {
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const originalError = console.error;
  const originalEnv = process.env.PERPLEXITY_API_KEY;

  function captureConsole() {
    const out: string[] = [];
    const err: string[] = [];
    console.log = (...args: unknown[]) => {
      out.push(args.join(" "));
    };
    console.error = (...args: unknown[]) => {
      err.push(args.join(" "));
    };
    return { out, err };
  }

  function restoreConsole() {
    console.log = originalLog;
    console.error = originalError;
  }

  afterEach(() => {
    globalThis.fetch = originalFetch;
    restoreConsole();
    if (originalEnv === undefined) delete process.env.PERPLEXITY_API_KEY;
    else process.env.PERPLEXITY_API_KEY = originalEnv;
  });

  it("returns 2 when --domain is omitted", async () => {
    const { err } = captureConsole();
    const code = await run(["check", "--query", "x"]);
    expect(code).toBe(2);
    expect(err.join("\n")).toContain("--domain is required");
  });

  it("returns 2 when no queries are supplied", async () => {
    const { err } = captureConsole();
    const code = await run(["check", "--domain", "shadow.inc"]);
    expect(code).toBe(2);
    expect(err.join("\n")).toContain("at least one --query");
  });

  it("returns 2 for --engine all (reserved for future)", async () => {
    const { err } = captureConsole();
    const code = await run([
      "check",
      "--domain",
      "shadow.inc",
      "--query",
      "x",
      "--engine",
      "all",
    ]);
    expect(code).toBe(2);
    expect(err.join("\n")).toContain("--engine all");
  });

  it("returns 1 when coverage is 0% (CI failure mode)", async () => {
    process.env.PERPLEXITY_API_KEY = "test";
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "x" } }],
          citations: ["https://other.com/a"],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200 }
      )) as typeof globalThis.fetch;
    const { out } = captureConsole();
    const code = await run([
      "check",
      "--domain",
      "shadow.inc",
      "--query",
      "q1",
    ]);
    expect(code).toBe(1);
    expect(out.join("\n")).toContain("Coverage: 0/1");
  });

  it("returns 0 when coverage > 0%", async () => {
    process.env.PERPLEXITY_API_KEY = "test";
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "x" } }],
          citations: ["https://www.shadow.inc/p"],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200 }
      )) as typeof globalThis.fetch;
    captureConsole();
    const code = await run([
      "check",
      "--domain",
      "shadow.inc",
      "--query",
      "q1",
    ]);
    expect(code).toBe(0);
  });

  it("emits valid JSON with --json", async () => {
    process.env.PERPLEXITY_API_KEY = "test";
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "x" } }],
          citations: ["https://www.shadow.inc/p"],
        }),
        { status: 200 }
      )) as typeof globalThis.fetch;
    const { out } = captureConsole();
    await run(["check", "--domain", "shadow.inc", "--query", "q1", "--json"]);
    const parsed = JSON.parse(out.join("\n"));
    expect(parsed.domain).toBe("shadow.inc");
    expect(parsed.summary.coveragePct).toBe(100);
  });
});
