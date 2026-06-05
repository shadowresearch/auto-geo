import { describe, expect, it } from "vitest";
import {
  makeNdjsonGeoAuditLine,
  toGeoAuditOutput,
  toGeoAuditOutputMulti,
  toGeoAuditProvider,
  toGeoAuditRow,
  type GeoAuditRow,
} from "../cli/format-geo-audit";
import type {
  CheckQueryResult,
  CheckReport,
  MultiEngineCheckReport,
} from "../cli/check";

/**
 * Unit tests for the `--format geo-audit` mapper. The shape must match
 * the in-product `LlmQueryResult` interface in
 * `packages/core/src/lib/tools/geoAudit.tool.ts` byte-for-byte; these
 * tests pin each field's contract so a future re-shape can't drift
 * silently from the consumer.
 */

// ── Fixture helpers ───────────────────────────────────────────────

function makeResult(over: Partial<CheckQueryResult> = {}): CheckQueryResult {
  return {
    query: "what is GEO",
    cited: true,
    citations: [
      {
        url: "https://www.shadow.inc/resources/what-is-geo",
        title: "What is GEO?",
        rank: 1,
        totalCitationsForQuery: 5,
      },
    ],
    rawSources: [
      {
        url: "https://www.shadow.inc/resources/what-is-geo",
        title: "What is GEO?",
      },
      { url: "https://arxiv.org/abs/2311.09735" }, // no title — falls back to host
    ],
    answer: "GEO stands for Generative Engine Optimization.",
    fanOutQueries: ["what is GEO", "generative engine optimization"],
    usage: {
      promptTokens: 120,
      completionTokens: 240,
      totalTokens: 360,
      estimatedCostUsd: 0.012345,
    },
    ...over,
  };
}

function makeReport(over: Partial<CheckReport> = {}): CheckReport {
  const results = [makeResult()];
  return {
    domain: "shadow.inc",
    engine: "perplexity",
    model: "sonar",
    results,
    summary: {
      citedQueryCount: 1,
      totalQueries: 1,
      coveragePct: 100,
      totalCitations: 1,
      estimatedCostUsd: 0.012345,
      errors: [],
    },
    generatedBy: "auto-geo check",
    ...over,
  };
}

// ── toGeoAuditProvider ────────────────────────────────────────────

describe("toGeoAuditProvider", () => {
  it("maps openai -> chatgpt (matches geoAudit tool's provider naming)", () => {
    expect(toGeoAuditProvider("openai")).toBe("chatgpt");
  });

  it("passes perplexity / anthropic / gemini / xai through unchanged", () => {
    expect(toGeoAuditProvider("perplexity")).toBe("perplexity");
    expect(toGeoAuditProvider("anthropic")).toBe("anthropic");
    expect(toGeoAuditProvider("gemini")).toBe("gemini");
    expect(toGeoAuditProvider("xai")).toBe("xai");
  });

  it("falls back to the input for unknown engine ids", () => {
    expect(toGeoAuditProvider("mystery-engine")).toBe("mystery-engine");
  });
});

// ── toGeoAuditRow — per-field mapping ─────────────────────────────

describe("toGeoAuditRow", () => {
  it("maps every CheckQueryResult field to the LlmQueryResult shape", () => {
    const row = toGeoAuditRow(makeResult(), {
      provider: "perplexity",
      model: "sonar-pro",
    });
    expect(row.prompt).toBe("what is GEO"); // query -> prompt
    expect(row.provider).toBe("perplexity"); // mapped via provider table
    expect(row.model).toBe("sonar-pro");
    expect(row.responseText).toBe(
      "GEO stands for Generative Engine Optimization."
    ); // answer -> responseText
    expect(row.fanOutQueries).toEqual([
      "what is GEO",
      "generative engine optimization",
    ]);
    expect(row.inputTokens).toBe(120); // promptTokens -> inputTokens
    expect(row.outputTokens).toBe(240); // completionTokens -> outputTokens
    expect(row.reasoningTokens).toBeNull(); // not surfaced by check today
    expect(row.moneySpent).toBe(0.012345); // estimatedCostUsd -> moneySpent
    expect(row.webSearchEnabled).toBe(true); // every supported engine grounds
    expect(typeof row.datetime).toBe("string"); // ISO timestamp
    expect(row.datetime).not.toBeNull();
    expect(row.error).toBeNull(); // success → error is null, never undefined
  });

  it("maps openai → chatgpt at the row level (provider name mapping)", () => {
    const row = toGeoAuditRow(makeResult(), {
      provider: "openai",
      model: "gpt-4o-mini",
    });
    expect(row.provider).toBe("chatgpt");
  });

  it("backfills missing citation titles with the URL's hostname (sans www.)", () => {
    const row = toGeoAuditRow(makeResult(), {
      provider: "perplexity",
      model: "sonar",
    });
    expect(row.citations).toEqual([
      {
        url: "https://www.shadow.inc/resources/what-is-geo",
        title: "What is GEO?",
      },
      { url: "https://arxiv.org/abs/2311.09735", title: "arxiv.org" }, // backfilled
    ]);
  });

  it("emits an empty citations array when the result has no rawSources", () => {
    const row = toGeoAuditRow(makeResult({ rawSources: [], citations: [] }), {
      provider: "perplexity",
      model: "sonar",
    });
    expect(row.citations).toEqual([]);
  });

  it("treats every missing usage / answer / fan-out field as null or []", () => {
    const row = toGeoAuditRow(
      {
        query: "q",
        cited: false,
        citations: [],
        rawSources: [],
        answer: "",
        fanOutQueries: [],
        // no usage at all
      },
      { provider: "openai", model: "gpt-4o-mini" }
    );
    expect(row.responseText).toBe("");
    expect(row.fanOutQueries).toEqual([]);
    expect(row.inputTokens).toBeNull();
    expect(row.outputTokens).toBeNull();
    expect(row.reasoningTokens).toBeNull();
    expect(row.moneySpent).toBeNull();
    expect(row.error).toBeNull();
  });

  it("propagates errors as a string and clears tokens / cost (null)", () => {
    const row = toGeoAuditRow(
      {
        query: "q",
        cited: false,
        citations: [],
        rawSources: [],
        answer: "",
        fanOutQueries: [],
        error: "timed out after 60s",
      },
      { provider: "perplexity", model: "sonar" }
    );
    expect(row.error).toBe("timed out after 60s");
    expect(row.moneySpent).toBeNull();
  });

  it("passes fanOutQueries through verbatim, preserving order", () => {
    const row = toGeoAuditRow(
      makeResult({ fanOutQueries: ["one", "two", "three"] }),
      { provider: "perplexity", model: "sonar" }
    );
    expect(row.fanOutQueries).toEqual(["one", "two", "three"]);
  });
});

// ── makeNdjsonGeoAuditLine ────────────────────────────────────────

describe("makeNdjsonGeoAuditLine", () => {
  it("returns the same shape as toGeoAuditRow (thin alias)", () => {
    const meta = { provider: "openai", model: "gpt-4o-mini" };
    const a = toGeoAuditRow(makeResult(), meta);
    const b = makeNdjsonGeoAuditLine(makeResult(), meta);
    // Ignore datetime — independent now() calls.
    const stripDt = (x: GeoAuditRow) => ({ ...x, datetime: "" });
    expect(stripDt(b)).toEqual(stripDt(a));
  });
});

// ── toGeoAuditOutput (single-engine summary) ──────────────────────

describe("toGeoAuditOutput", () => {
  it("emits rows + summary in the geoAudit shape from a CheckReport", () => {
    const report = makeReport({
      results: [
        makeResult(),
        makeResult({
          query: "q2",
          cited: false,
          citations: [],
          rawSources: [],
          error: "boom",
        }),
      ],
      summary: {
        citedQueryCount: 1,
        totalQueries: 2,
        coveragePct: 50,
        totalCitations: 1,
        estimatedCostUsd: 0.012345,
        errors: [{ query: "q2", error: "boom" }],
      },
    });

    const out = toGeoAuditOutput(report);
    expect(out.rows).toHaveLength(2);
    expect(out.rows[0]!.prompt).toBe("what is GEO");
    expect(out.rows[1]!.error).toBe("boom");

    expect(out.summary).toMatchObject({
      promptCount: 2,
      providerCount: 1,
      totalQueries: 2,
      successCount: 1,
      errorCount: 1,
      totalCitations: 2, // 2 rawSources on the first row
      totalMoneySpent: 0.012345,
      providers: ["perplexity"],
      errors: [{ prompt: "q2", provider: "perplexity", error: "boom" }],
    });
  });

  it("renames the engine via the provider mapping in the summary", () => {
    const report = makeReport({ engine: "openai" });
    const out = toGeoAuditOutput(report);
    expect(out.summary.providers).toEqual(["chatgpt"]);
    expect(out.rows[0]!.provider).toBe("chatgpt");
  });
});

// ── toGeoAuditOutputMulti (--engine all) ──────────────────────────

describe("toGeoAuditOutputMulti", () => {
  it("flattens per-engine reports into rows + a multi-engine summary", () => {
    const perplexityReport = makeReport({
      engine: "perplexity",
      results: [makeResult({ query: "q1" })],
      summary: {
        citedQueryCount: 1,
        totalQueries: 1,
        coveragePct: 100,
        totalCitations: 1,
        estimatedCostUsd: 0.01,
        errors: [],
      },
    });
    const openaiReport = makeReport({
      engine: "openai",
      model: "gpt-4o-mini",
      results: [
        makeResult({ query: "q1", error: "rate limited", cited: false }),
      ],
      summary: {
        citedQueryCount: 0,
        totalQueries: 1,
        coveragePct: 0,
        totalCitations: 0,
        estimatedCostUsd: 0,
        errors: [{ query: "q1", error: "rate limited" }],
      },
    });

    const multi: MultiEngineCheckReport = {
      domain: "shadow.inc",
      engines: ["perplexity", "openai"],
      skippedEngines: [],
      perEngine: {
        perplexity: perplexityReport,
        openai: openaiReport,
      },
      acrossEngines: [
        {
          query: "q1",
          citedByAny: true,
          citedByEngines: ["perplexity"],
          ranByEngines: ["perplexity", "openai"],
        },
      ],
      summary: {
        totalQueries: 1,
        citedByAnyCount: 1,
        unionCoveragePct: 100,
        meanCoveragePct: 50,
        estimatedCostUsd: 0.01,
      },
      generatedBy: "auto-geo check",
    };

    const out = toGeoAuditOutputMulti(multi);
    expect(out.rows).toHaveLength(2);
    // Row order: engines in report.engines order × queries.
    expect(out.rows[0]!.provider).toBe("perplexity");
    expect(out.rows[1]!.provider).toBe("chatgpt"); // openai → chatgpt
    expect(out.rows[1]!.error).toBe("rate limited");

    expect(out.summary).toMatchObject({
      promptCount: 1,
      providerCount: 2,
      totalQueries: 2, // 1 prompt × 2 engines
      successCount: 1,
      errorCount: 1,
      providers: ["perplexity", "chatgpt"],
      errors: [{ prompt: "q1", provider: "chatgpt", error: "rate limited" }],
    });
  });
});
