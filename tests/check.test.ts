import { afterEach, describe, expect, it } from "vitest";
import {
  ALL_ENGINE_NAMES,
  DEFAULT_CONCURRENCY,
  DEFAULT_MAX_RETRIES,
  DEFAULT_TIMEOUT_PER_QUERY_SEC,
  createEngine,
  engineHasCredentials,
  hostnameMatchesDomain,
  normalizeDomain,
  runCheck,
  runCheckMulti,
  type CheckReport,
  type CheckQueryResult,
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

describe("renderCheckHuman — --answers modes", () => {
  function reportWithAnswer(answer: string): CheckReport {
    return {
      domain: "shadow.inc",
      engine: "perplexity",
      model: "sonar",
      results: [
        {
          query: "what is GEO",
          cited: true,
          citations: [
            {
              url: "https://www.shadow.inc/resources/what-is-geo",
              rank: 1,
              totalCitationsForQuery: 3,
            },
          ],
          rawSources: sources("https://www.shadow.inc/resources/what-is-geo"),
          answer,
        },
      ],
      summary: {
        citedQueryCount: 1,
        totalQueries: 1,
        coveragePct: 100,
        totalCitations: 1,
        estimatedCostUsd: 0,
        errors: [],
      },
      generatedBy: "auto-geo check",
    };
  }

  const SHORT_ANSWER =
    "GEO stands for Generative Engine Optimization. It's the practice of structuring content so AI search engines cite you.";

  const LONG_ANSWER = Array.from(
    { length: 12 },
    (_, i) => `Sentence ${i + 1} explains something concrete about GEO.`
  ).join(" ");

  it("renders the answer as a dimmed blockquote by default (preview)", () => {
    const out = renderCheckHuman(reportWithAnswer(SHORT_ANSWER));
    expect(out).toContain("\u2502"); // │ blockquote prefix
    expect(out).toContain("GEO stands for Generative Engine Optimization");
  });

  it("omits the answer block under --answers none", () => {
    const out = renderCheckHuman(reportWithAnswer(SHORT_ANSWER), {
      colors: false,
      answer: "none",
    });
    expect(out).not.toContain("\u2502");
    expect(out).not.toContain("GEO stands for Generative");
  });

  it("renders the full answer under --answers full", () => {
    const out = renderCheckHuman(reportWithAnswer(LONG_ANSWER), {
      colors: false,
      answer: "full",
    });
    expect(out).toContain("Sentence 1");
    expect(out).toContain("Sentence 12");
  });

  it("truncates with an ellipsis + footer note under preview when long", () => {
    const out = renderCheckHuman(reportWithAnswer(LONG_ANSWER), {
      colors: false,
      answer: "preview",
    });
    expect(out).toContain("\u2026"); // ellipsis
    expect(out).toContain("preview");
    expect(out).toContain("--answers full");
    // Must NOT include the late sentences.
    expect(out).not.toContain("Sentence 12");
  });

  it("emits nothing when answer is empty even in preview mode", () => {
    const out = renderCheckHuman(reportWithAnswer(""), {
      colors: false,
      answer: "preview",
    });
    expect(out).not.toContain("\u2502");
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

  it("captures search_queries as fanOutQueries when present (newer Sonar shapes)", async () => {
    const fakeFetch: typeof globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "ans" } }],
          citations: ["https://www.shadow.inc/p"],
          search_queries: ["what is GEO", "generative engine optimization"],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200 }
      );
    const engine = createPerplexityEngine({ apiKey: "test", fetch: fakeFetch });
    const res = await engine.askWithCitations("q");
    expect(res.fanOutQueries).toEqual([
      "what is GEO",
      "generative engine optimization",
    ]);
  });

  it("defaults fanOutQueries to [] when search_queries is absent (older Sonar)", async () => {
    const fakeFetch: typeof globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "ans" } }],
          citations: ["https://www.shadow.inc/p"],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200 }
      );
    const engine = createPerplexityEngine({ apiKey: "test", fetch: fakeFetch });
    const res = await engine.askWithCitations("q");
    expect(res.fanOutQueries).toEqual([]);
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

// ── runCheck — perf knobs (v0.4.1) ─────────────────────────────────

describe("runCheck — defaults", () => {
  it("exposes a default concurrency of 12 (bumped from 6 in v0.5.0)", () => {
    expect(DEFAULT_CONCURRENCY).toBe(12);
  });

  it("exposes a default per-query timeout of 60s", () => {
    expect(DEFAULT_TIMEOUT_PER_QUERY_SEC).toBe(60);
  });

  it("exposes a default of 2 retries", () => {
    expect(DEFAULT_MAX_RETRIES).toBe(2);
  });
});

describe("runCheck — onResult callback", () => {
  it("fires once per query in completion order with monotonic counts", async () => {
    // Make `b` finish before `a` by stalling `a` longer.
    const ordering: Array<{ q: string; completed: number; total: number }> = [];
    const engine = {
      name: "stagger",
      model: "x",
      async askWithCitations(q: string) {
        const delay = q === "a" ? 30 : 1;
        await new Promise((r) => setTimeout(r, delay));
        return { answer: "", citations: [] };
      },
    };
    await runCheck({
      domain: "shadow.inc",
      queries: ["a", "b"],
      engine,
      concurrency: 2,
      onResult: (result, completed, total) =>
        ordering.push({ q: result.query, completed, total }),
    });
    expect(ordering.map((o) => o.q)).toEqual(["b", "a"]);
    expect(ordering.map((o) => o.completed)).toEqual([1, 2]);
    expect(ordering.every((o) => o.total === 2)).toBe(true);
  });

  it("swallows callback errors so the run still completes", async () => {
    const engine = makeEngine({
      q: { answer: "", citations: sources("https://shadow.inc/p") },
    });
    const report = await runCheck({
      domain: "shadow.inc",
      queries: ["q"],
      engine,
      onResult: () => {
        throw new Error("boom");
      },
    });
    expect(report.summary.coveragePct).toBe(100);
  });
});

describe("runCheck — per-query timeout", () => {
  it("marks a stuck query as 'timed out after Ns' and keeps the rest going", async () => {
    const engine = {
      name: "slow",
      model: "x",
      async askWithCitations(q: string) {
        if (q === "stuck") {
          // Never resolves within the test window.
          await new Promise(() => {});
          return { answer: "", citations: [] };
        }
        return { answer: "", citations: sources("https://shadow.inc/p") };
      },
    };
    const report = await runCheck({
      domain: "shadow.inc",
      queries: ["stuck", "ok"],
      engine,
      concurrency: 2,
      timeoutPerQuerySec: 1, // 1s timeout
      maxRetries: 0,
    });
    expect(report.results[0]!.error).toMatch(/timed out after 1s/);
    expect(report.results[1]!.cited).toBe(true);
  });
});

describe("runCheck — retry on transient failures", () => {
  it("retries 429 responses and recovers on the next attempt", async () => {
    let attempts = 0;
    const engine = {
      name: "flaky",
      model: "x",
      async askWithCitations() {
        attempts += 1;
        if (attempts === 1) throw new Error("Engine API 429 Too Many Requests");
        return { answer: "", citations: sources("https://shadow.inc/p") };
      },
    };
    const report = await runCheck({
      domain: "shadow.inc",
      queries: ["q"],
      engine,
      maxRetries: 2,
    });
    expect(attempts).toBe(2);
    expect(report.results[0]!.cited).toBe(true);
  });

  it("retries 5xx responses", async () => {
    let attempts = 0;
    const engine = {
      name: "flaky",
      model: "x",
      async askWithCitations() {
        attempts += 1;
        if (attempts < 2) throw new Error("Engine API 503 Service Unavailable");
        return { answer: "", citations: [] };
      },
    };
    const report = await runCheck({
      domain: "shadow.inc",
      queries: ["q"],
      engine,
      maxRetries: 2,
    });
    expect(attempts).toBe(2);
    expect(report.results[0]!.error).toBeUndefined();
  });

  it("does NOT retry plain 4xx — those are configuration errors", async () => {
    let attempts = 0;
    const engine = {
      name: "broken",
      model: "x",
      async askWithCitations() {
        attempts += 1;
        throw new Error("Engine API 401 Unauthorized");
      },
    };
    const report = await runCheck({
      domain: "shadow.inc",
      queries: ["q"],
      engine,
      maxRetries: 3,
    });
    expect(attempts).toBe(1);
    expect(report.results[0]!.error).toMatch(/401/);
  });

  it("gives up after maxRetries and records the last error", async () => {
    let attempts = 0;
    const engine = {
      name: "always-flaky",
      model: "x",
      async askWithCitations() {
        attempts += 1;
        throw new Error("Engine API 502 Bad Gateway");
      },
    };
    const report = await runCheck({
      domain: "shadow.inc",
      queries: ["q"],
      engine,
      maxRetries: 1,
    });
    expect(attempts).toBe(2); // 1 try + 1 retry
    expect(report.results[0]!.error).toMatch(/502/);
  });
});

describe("runCheck — maxRuntimeSec", () => {
  it("marks pending queries as skipped when the deadline trips", async () => {
    // Generous timing margins so the test stays stable on slow CI
    // runners: q1 is a fast 10ms; q2 is a long 2s; deadline at 300ms.
    // q1 always completes well within the deadline; q2 always blows
    // through it; q3 is never started.
    let n = 0;
    const engine = {
      name: "slow",
      model: "x",
      async askWithCitations() {
        n += 1;
        const delay = n === 1 ? 10 : 2000;
        await new Promise((r) => setTimeout(r, delay));
        return {
          answer: "",
          citations: sources("https://shadow.inc/p"),
          fanOutQueries: [],
        };
      },
    };
    const seen: CheckQueryResult[] = [];
    const report = await runCheck({
      domain: "shadow.inc",
      queries: ["a", "b", "c"],
      engine,
      concurrency: 1, // serialize so we hit the deadline mid-run
      timeoutPerQuerySec: 60,
      maxRetries: 0,
      maxRuntimeSec: 0.3, // 300ms — plenty of margin for q1 + deadline tick
      onResult: (r) => seen.push(r),
    });
    // a completes; b times out via the runtime-deadline cap on its
    // per-attempt timeout; c is never started.
    expect(report.results[0]!.cited).toBe(true);
    expect(
      report.results.some((r) => r.error === "skipped — max runtime exceeded")
    ).toBe(true);
    expect(seen).toHaveLength(3);
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

  it("defaults --answers to 'preview' and parses 'none'/'full'", () => {
    const def = parseArgs(["check", "--domain", "shadow.inc", "--query", "q"]);
    if (def.command !== "check") throw new Error("expected check");
    expect(def.answers).toBe("preview");

    const none = parseArgs([
      "check",
      "--domain",
      "shadow.inc",
      "--query",
      "q",
      "--answers",
      "none",
    ]);
    if (none.command !== "check") throw new Error("expected check");
    expect(none.answers).toBe("none");

    const full = parseArgs([
      "check",
      "--domain",
      "shadow.inc",
      "--query",
      "q",
      "--answers",
      "full",
    ]);
    if (full.command !== "check") throw new Error("expected check");
    expect(full.answers).toBe("full");
  });

  it("rejects an unknown --answers value", () => {
    expect(() =>
      parseArgs([
        "check",
        "--domain",
        "shadow.inc",
        "--query",
        "q",
        "--answers",
        "verbose",
      ])
    ).toThrow(/--answers must be/);
  });

  it("parses --ndjson, --timeout-per-query, --max-runtime", () => {
    const a = parseArgs([
      "check",
      "--domain",
      "shadow.inc",
      "--query",
      "q",
      "--ndjson",
      "--timeout-per-query",
      "30",
      "--max-runtime",
      "120",
    ]);
    if (a.command !== "check") throw new Error("expected check");
    expect(a.ndjson).toBe(true);
    expect(a.timeoutPerQuerySec).toBe(30);
    expect(a.maxRuntimeSec).toBe(120);
  });

  it("errors when --json and --ndjson are both passed", () => {
    expect(() =>
      parseArgs([
        "check",
        "--domain",
        "shadow.inc",
        "--query",
        "q",
        "--json",
        "--ndjson",
      ])
    ).toThrow(/mutually exclusive/);
  });

  it("defaults --format to 'auto-geo' and parses 'geo-audit'", () => {
    const def = parseArgs(["check", "--domain", "shadow.inc", "--query", "q"]);
    if (def.command !== "check") throw new Error("expected check");
    expect(def.format).toBe("auto-geo");

    const ga = parseArgs([
      "check",
      "--domain",
      "shadow.inc",
      "--query",
      "q",
      "--format",
      "geo-audit",
    ]);
    if (ga.command !== "check") throw new Error("expected check");
    expect(ga.format).toBe("geo-audit");
  });

  it("rejects an unknown --format value", () => {
    expect(() =>
      parseArgs([
        "check",
        "--domain",
        "shadow.inc",
        "--query",
        "q",
        "--format",
        "csv",
      ])
    ).toThrow(/--format must be/);
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

  it("--ndjson streams one JSON object per line + a _summary line", async () => {
    process.env.PERPLEXITY_API_KEY = "test";
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "answer text" } }],
          citations: ["https://www.shadow.inc/p"],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200 }
      )) as typeof globalThis.fetch;

    // Capture process.stdout.write — that's what --ndjson uses.
    const chunks: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((c: unknown) => {
      chunks.push(typeof c === "string" ? c : String(c));
      return true;
    }) as typeof process.stdout.write;
    captureConsole();

    try {
      const code = await run([
        "check",
        "--domain",
        "shadow.inc",
        "--query",
        "q1",
        "--query",
        "q2",
        "--ndjson",
      ]);
      expect(code).toBe(0);
    } finally {
      process.stdout.write = origWrite;
    }

    const lines = chunks
      .join("")
      .split("\n")
      .filter((l) => l.length > 0);
    expect(lines).toHaveLength(3); // 2 results + 1 summary
    const r1 = JSON.parse(lines[0]!);
    expect(r1.query).toMatch(/^q[12]$/);
    expect(r1.cited).toBe(true);
    expect(typeof r1.timestamp).toBe("string");
    expect(Array.isArray(r1.citations)).toBe(true);
    const summary = JSON.parse(lines[2]!);
    expect(summary._summary).toBe(true);
    expect(summary.totalQueries).toBe(2);
    expect(summary.coveragePct).toBe(100);
    expect(summary.domain).toBe("shadow.inc");
    expect(summary.engine).toBe("perplexity");
  });

  it("--ndjson + --json errors before any run starts", async () => {
    const { err } = captureConsole();
    const code = await run([
      "check",
      "--domain",
      "shadow.inc",
      "--query",
      "q",
      "--ndjson",
      "--json",
    ]);
    expect(code).toBe(2);
    expect(err.join("\n")).toContain("mutually exclusive");
  });

  // ── --format geo-audit ─────────────────────────────────────────

  it("--format geo-audit + --json emits the rows + summary object shape", async () => {
    process.env.PERPLEXITY_API_KEY = "test";
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "GEO is …" } }],
          citations: ["https://www.shadow.inc/p"],
          search_queries: ["fanout query 1"],
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        }),
        { status: 200 }
      )) as typeof globalThis.fetch;

    const { out } = captureConsole();
    const code = await run([
      "check",
      "--domain",
      "shadow.inc",
      "--query",
      "what is GEO",
      "--json",
      "--format",
      "geo-audit",
    ]);
    expect(code).toBe(0);
    const parsed = JSON.parse(out.join("\n"));
    // Object with rows + summary — NOT the CheckReport shape.
    expect(Array.isArray(parsed.rows)).toBe(true);
    expect(parsed.rows).toHaveLength(1);
    const row = parsed.rows[0];
    expect(row.prompt).toBe("what is GEO");
    expect(row.provider).toBe("perplexity");
    expect(row.responseText).toBe("GEO is …");
    expect(row.fanOutQueries).toEqual(["fanout query 1"]);
    expect(row.inputTokens).toBe(10);
    expect(row.outputTokens).toBe(20);
    expect(row.webSearchEnabled).toBe(true);
    expect(row.error).toBeNull();
    expect(parsed.summary).toMatchObject({
      promptCount: 1,
      providerCount: 1,
      totalQueries: 1,
      successCount: 1,
      errorCount: 0,
      providers: ["perplexity"],
    });
  });

  it("--format geo-audit + --ndjson streams GeoAuditRow lines + a fused summary", async () => {
    process.env.PERPLEXITY_API_KEY = "test";
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "ans" } }],
          citations: ["https://www.shadow.inc/p"],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200 }
      )) as typeof globalThis.fetch;

    const chunks: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((c: unknown) => {
      chunks.push(typeof c === "string" ? c : String(c));
      return true;
    }) as typeof process.stdout.write;
    captureConsole();

    try {
      const code = await run([
        "check",
        "--domain",
        "shadow.inc",
        "--query",
        "q1",
        "--query",
        "q2",
        "--ndjson",
        "--format",
        "geo-audit",
      ]);
      expect(code).toBe(0);
    } finally {
      process.stdout.write = origWrite;
    }

    const lines = chunks
      .join("")
      .split("\n")
      .filter((l) => l.length > 0);
    expect(lines).toHaveLength(3); // 2 rows + 1 summary
    const r1 = JSON.parse(lines[0]!);
    // GeoAuditRow shape — not the default ndjson shape.
    expect(r1.prompt).toMatch(/^q[12]$/);
    expect(r1.provider).toBe("perplexity");
    expect(r1.responseText).toBe("ans");
    expect(r1.fanOutQueries).toEqual([]);
    // Summary line: carries BOTH the default summary AND the geoAudit
    // summary fields (additive — both consumers happy).
    const summary = JSON.parse(lines[2]!);
    expect(summary._summary).toBe(true);
    expect(summary.totalQueries).toBe(2);
    expect(summary.coveragePct).toBe(100); // default summary survives
    expect(summary.promptCount).toBe(2); // geoAudit summary layered on top
    expect(summary.providerCount).toBe(1);
    expect(summary.providers).toEqual(["perplexity"]);
  });

  it("--format geo-audit maps openai to provider=chatgpt", async () => {
    process.env.OPENAI_API_KEY = "test";
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          output: [
            {
              type: "web_search_call",
              action: { type: "search", query: "what is GEO" },
            },
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: "GEO answer",
                  annotations: [
                    {
                      type: "url_citation",
                      url: "https://www.shadow.inc/p",
                    },
                  ],
                },
              ],
            },
          ],
          usage: { input_tokens: 5, output_tokens: 10, total_tokens: 15 },
        }),
        { status: 200 }
      )) as typeof globalThis.fetch;
    const { out } = captureConsole();
    const code = await run([
      "check",
      "--domain",
      "shadow.inc",
      "--query",
      "what is GEO",
      "--engine",
      "openai",
      "--json",
      "--format",
      "geo-audit",
    ]);
    expect(code).toBe(0);
    const parsed = JSON.parse(out.join("\n"));
    expect(parsed.rows[0].provider).toBe("chatgpt");
    expect(parsed.rows[0].fanOutQueries).toEqual(["what is GEO"]);
    expect(parsed.summary.providers).toEqual(["chatgpt"]);
    delete process.env.OPENAI_API_KEY;
  });

  // ── per-engine concurrency pools ───────────────────────────────

  it("--engine all gives each engine its own concurrency pool (parallel runs)", async () => {
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
    process.env.OPENAI_API_KEY = "test";

    // Track max-in-flight per engine — if pools are truly parallel
    // across engines, both engines should see in-flight >= 2 even
    // though `--concurrency 2` only allows 2 in-flight per pool.
    const perEngineInFlight: Record<string, number> = {
      perplexity: 0,
      openai: 0,
    };
    const perEngineMax: Record<string, number> = {
      perplexity: 0,
      openai: 0,
    };
    let crossEngineConcurrent = 0;
    let crossEngineMax = 0;

    try {
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        const engine = url.includes("perplexity.ai")
          ? "perplexity"
          : url.includes("api.openai.com")
            ? "openai"
            : null;
        if (!engine) throw new Error(`unexpected fetch ${url}`);

        perEngineInFlight[engine] = (perEngineInFlight[engine] ?? 0) + 1;
        perEngineMax[engine] = Math.max(
          perEngineMax[engine] ?? 0,
          perEngineInFlight[engine] ?? 0
        );
        crossEngineConcurrent += 1;
        crossEngineMax = Math.max(crossEngineMax, crossEngineConcurrent);

        // Tiny delay so concurrent requests actually overlap.
        await new Promise((r) => setTimeout(r, 10));

        perEngineInFlight[engine] -= 1;
        crossEngineConcurrent -= 1;

        if (engine === "perplexity") {
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
                      { type: "url_citation", url: "https://elsewhere/x" },
                    ],
                  },
                ],
              },
            ],
            usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
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
        "q1",
        "--query",
        "q2",
        "--query",
        "q3",
        "--query",
        "q4",
        "--engine",
        "all",
        "--concurrency",
        "2",
      ]);
      expect(code).toBe(0);
      // Per-engine pool of 2 → both engines saturate independently
      // at 2 in-flight each, and ACROSS engines we see > 2 in flight
      // simultaneously (the proof the engine pools run in parallel).
      expect(perEngineMax.perplexity).toBeGreaterThanOrEqual(2);
      expect(perEngineMax.openai).toBeGreaterThanOrEqual(2);
      expect(crossEngineMax).toBeGreaterThan(2);
    } finally {
      for (const [k, v] of Object.entries(originals)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});
