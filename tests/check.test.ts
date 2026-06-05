import { afterEach, describe, expect, it } from "vitest";
import {
  ALL_ENGINE_NAMES,
  createEngine,
  engineHasCredentials,
  hostnameMatchesDomain,
  normalizeDomain,
  runCheck,
  runCheckMulti,
  type CheckReport,
} from "../cli/check";
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

  it("returns engines for the four new ids (anthropic / gemini / xai)", () => {
    expect(createEngine("anthropic", { apiKey: "x" }).name).toBe("anthropic");
    expect(createEngine("gemini", { apiKey: "x" }).name).toBe("gemini");
    expect(createEngine("xai", { apiKey: "x" }).name).toBe("xai");
  });

  it("exposes the full engine registry as ALL_ENGINE_NAMES", () => {
    expect(ALL_ENGINE_NAMES).toEqual([
      "perplexity",
      "openai",
      "anthropic",
      "gemini",
      "xai",
    ]);
  });

  it("engineHasCredentials checks the canonical env var per engine", () => {
    const originals = {
      PERPLEXITY_API_KEY: process.env.PERPLEXITY_API_KEY,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
      GEMINI_API_KEY: process.env.GEMINI_API_KEY,
      XAI_API_KEY: process.env.XAI_API_KEY,
    };
    try {
      for (const k of Object.keys(originals)) delete process.env[k];
      expect(engineHasCredentials("perplexity")).toBe(false);
      process.env.PERPLEXITY_API_KEY = "x";
      expect(engineHasCredentials("perplexity")).toBe(true);
      // Gemini fallback alias.
      expect(engineHasCredentials("gemini")).toBe(false);
      process.env.GEMINI_API_KEY = "y";
      expect(engineHasCredentials("gemini")).toBe(true);
    } finally {
      for (const [k, v] of Object.entries(originals)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});

// ── runCheckMulti aggregator ──────────────────────────────────────

describe("runCheckMulti", () => {
  it("aggregates per-engine reports and computes a union roll-up", async () => {
    const e1 = makeEngine(
      {
        a: { answer: "", citations: sources("https://shadow.inc/a") },
        b: { answer: "", citations: sources("https://other.com/x") },
      },
      { name: "alpha", model: "m1" }
    );
    const e2 = makeEngine(
      {
        a: { answer: "", citations: sources("https://other.com/y") },
        b: { answer: "", citations: sources("https://shadow.inc/b") },
      },
      { name: "beta", model: "m2" }
    );
    const e3 = makeEngine(
      {
        a: { answer: "", citations: sources("https://other.com/z") },
        b: { answer: "", citations: sources("https://other.com/w") },
      },
      { name: "gamma", model: "m3" }
    );

    const report = await runCheckMulti({
      domain: "shadow.inc",
      queries: ["a", "b"],
      engines: [e1, e2, e3],
    });

    expect(report.engines).toEqual(["alpha", "beta", "gamma"]);

    // Per-engine breakdown.
    expect(report.perEngine.alpha!.summary.coveragePct).toBe(50);
    expect(report.perEngine.beta!.summary.coveragePct).toBe(50);
    expect(report.perEngine.gamma!.summary.coveragePct).toBe(0);

    // Across-engines roll-up.
    expect(report.acrossEngines).toEqual([
      {
        query: "a",
        citedByAny: true,
        citedByEngines: ["alpha"],
        ranByEngines: ["alpha", "beta", "gamma"],
      },
      {
        query: "b",
        citedByAny: true,
        citedByEngines: ["beta"],
        ranByEngines: ["alpha", "beta", "gamma"],
      },
    ]);

    // Union = 2/2 (both queries cited by ≥1 engine), mean = (50+50+0)/3 = 33.
    expect(report.summary.unionCoveragePct).toBe(100);
    expect(report.summary.meanCoveragePct).toBe(33);
  });

  it("reports 0% union coverage when no engine cites the domain", async () => {
    const e1 = makeEngine({
      q: { answer: "", citations: sources("https://x.com") },
    });
    const report = await runCheckMulti({
      domain: "shadow.inc",
      queries: ["q"],
      engines: [e1],
    });
    expect(report.summary.unionCoveragePct).toBe(0);
    expect(report.acrossEngines[0]!.citedByAny).toBe(false);
  });

  it("isolates per-engine failures from the across-engines union", async () => {
    const ok = makeEngine({
      q: { answer: "", citations: sources("https://shadow.inc/a") },
    });
    const bad = makeEngine(
      { q: { answer: "", citations: [] } },
      {
        name: "broken",
        throwFor: ["q"],
      }
    );
    const report = await runCheckMulti({
      domain: "shadow.inc",
      queries: ["q"],
      engines: [ok, bad],
    });
    // Broken engine has one errored query — coverage 0%.
    expect(report.perEngine.broken!.summary.coveragePct).toBe(0);
    expect(report.perEngine.broken!.summary.errors).toHaveLength(1);
    // The healthy engine still cited, so the union counts the query.
    expect(report.summary.unionCoveragePct).toBe(100);
  });

  it("throws if called with zero engines", async () => {
    await expect(
      runCheckMulti({ domain: "shadow.inc", queries: ["q"], engines: [] })
    ).rejects.toThrow(/at least one engine/);
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

  it("returns 2 for an unknown --engine value", async () => {
    const { err } = captureConsole();
    const code = await run([
      "check",
      "--domain",
      "shadow.inc",
      "--query",
      "x",
      "--engine",
      "bogus",
    ]);
    expect(code).toBe(2);
    const out = err.join("\n");
    expect(out).toContain("unknown --engine bogus");
    expect(out).toContain(
      "perplexity, openai, anthropic, gemini, xai (grok), all"
    );
  });

  it("fails fast when --engine xai is missing its API key", async () => {
    const original = process.env.XAI_API_KEY;
    delete process.env.XAI_API_KEY;
    try {
      const { err } = captureConsole();
      const code = await run([
        "check",
        "--domain",
        "shadow.inc",
        "--query",
        "x",
        "--engine",
        "xai",
      ]);
      expect(code).toBe(2);
      expect(err.join("\n")).toContain("XAI_API_KEY");
    } finally {
      if (original === undefined) delete process.env.XAI_API_KEY;
      else process.env.XAI_API_KEY = original;
    }
  });

  it("accepts --engine grok as an alias for xai", async () => {
    const originals = {
      XAI_API_KEY: process.env.XAI_API_KEY,
      PERPLEXITY_API_KEY: process.env.PERPLEXITY_API_KEY,
    };
    process.env.XAI_API_KEY = "test";
    try {
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        expect(url).toContain("api.x.ai");
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: "assistant",
                  content: "x",
                  citations: ["https://www.shadow.inc/p"],
                },
              },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
          { status: 200 }
        );
      }) as typeof globalThis.fetch;
      captureConsole();
      const code = await run([
        "check",
        "--domain",
        "shadow.inc",
        "--query",
        "x",
        "--engine",
        "grok",
      ]);
      expect(code).toBe(0);
    } finally {
      if (originals.XAI_API_KEY === undefined) delete process.env.XAI_API_KEY;
      else process.env.XAI_API_KEY = originals.XAI_API_KEY;
    }
  });

  it("--engine all returns 2 with a helpful error when no API keys are set", async () => {
    const originals = {
      PERPLEXITY_API_KEY: process.env.PERPLEXITY_API_KEY,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
      GEMINI_API_KEY: process.env.GEMINI_API_KEY,
      XAI_API_KEY: process.env.XAI_API_KEY,
    };
    for (const k of Object.keys(originals)) delete process.env[k];
    try {
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
      expect(err.join("\n")).toContain("at least one API key");
    } finally {
      for (const [k, v] of Object.entries(originals)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  it("--engine all aggregates the engines whose keys are present", async () => {
    const originals = {
      PERPLEXITY_API_KEY: process.env.PERPLEXITY_API_KEY,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
      GEMINI_API_KEY: process.env.GEMINI_API_KEY,
      XAI_API_KEY: process.env.XAI_API_KEY,
    };
    for (const k of Object.keys(originals)) delete process.env[k];
    // Two engines enabled, three skipped.
    process.env.PERPLEXITY_API_KEY = "test";
    process.env.OPENAI_API_KEY = "test";

    try {
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("perplexity.ai")) {
          return new Response(
            JSON.stringify({
              choices: [{ message: { content: "x" } }],
              citations: ["https://www.shadow.inc/p"],
              usage: {
                prompt_tokens: 1,
                completion_tokens: 1,
                total_tokens: 2,
              },
            }),
            { status: 200 }
          );
        }
        if (url.includes("api.openai.com")) {
          return new Response(
            JSON.stringify({
              output: [
                {
                  type: "message",
                  content: [
                    {
                      type: "output_text",
                      text: "x",
                      annotations: [
                        {
                          type: "url_citation",
                          url: "https://elsewhere.example/x",
                        },
                      ],
                    },
                  ],
                },
              ],
              usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
            }),
            { status: 200 }
          );
        }
        throw new Error(`unexpected fetch ${url}`);
      }) as typeof globalThis.fetch;

      const { out } = captureConsole();
      const code = await run([
        "check",
        "--domain",
        "shadow.inc",
        "--query",
        "what is GEO",
        "--engine",
        "all",
      ]);
      // Perplexity cited, OpenAI did not — union > 0 → exit 0.
      expect(code).toBe(0);
      const text = out.join("\n");
      expect(text).toContain("Per-engine breakdown:");
      expect(text).toMatch(/perplexity/);
      expect(text).toMatch(/openai/);
      expect(text).toMatch(/Union coverage/);
    } finally {
      for (const [k, v] of Object.entries(originals)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  it("--engine all --json emits the multi-engine report shape", async () => {
    const originals = {
      PERPLEXITY_API_KEY: process.env.PERPLEXITY_API_KEY,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
      GEMINI_API_KEY: process.env.GEMINI_API_KEY,
      XAI_API_KEY: process.env.XAI_API_KEY,
    };
    for (const k of Object.keys(originals)) delete process.env[k];
    process.env.PERPLEXITY_API_KEY = "test";

    try {
      globalThis.fetch = (async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "x" } }],
            citations: ["https://www.shadow.inc/p"],
          }),
          { status: 200 }
        )) as typeof globalThis.fetch;
      const { out } = captureConsole();
      await run([
        "check",
        "--domain",
        "shadow.inc",
        "--query",
        "q",
        "--engine",
        "all",
        "--json",
      ]);
      const parsed = JSON.parse(out.join("\n"));
      expect(parsed.engines).toEqual(["perplexity"]);
      expect(parsed.acrossEngines).toHaveLength(1);
      expect(parsed.acrossEngines[0].citedByAny).toBe(true);
      expect(parsed.summary.unionCoveragePct).toBe(100);
      expect(parsed.skippedEngines.length).toBeGreaterThan(0);
    } finally {
      for (const [k, v] of Object.entries(originals)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
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
