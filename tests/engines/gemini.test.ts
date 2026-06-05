import { describe, expect, it, vi } from "vitest";
import {
  createGeminiEngine,
  extractGeminiAnswer,
  parseGeminiCitations,
  parseGeminiFanOutQueries,
} from "../../cli/engines/gemini";
import { hostnameMatchesDomain } from "../../cli/check";
import { geminiSampleResponse } from "../fixtures/engines/gemini-response";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("createGeminiEngine", () => {
  it("posts to generateContent with google_search tool and key in query string", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(geminiSampleResponse));
    const engine = createGeminiEngine({
      apiKey: "AIza-test",
      fetch: fetchMock as unknown as typeof globalThis.fetch,
    });

    await engine.askWithCitations("what is GEO");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
    );
    expect(url).toContain("key=AIza-test");
    expect(init?.method).toBe("POST");

    const body = JSON.parse(init!.body as string);
    expect(body.contents).toEqual([{ parts: [{ text: "what is GEO" }] }]);
    expect(body.tools).toEqual([{ google_search: {} }]);
  });

  it("preserves redirect-wrapped chunk URIs AND emits derived host citations", async () => {
    const out = parseGeminiCitations(geminiSampleResponse);
    // 2 wrapper URIs + 2 inferred-from-title host URLs = 4 entries.
    expect(out).toHaveLength(4);

    // Wrappers retained.
    expect(
      out.filter((c) => c.url.includes("vertexaisearch.cloud.google.com"))
    ).toHaveLength(2);

    // Derived shadow.inc citation (bare-host title).
    const derived = out.find((c) => c.url === "https://shadow.inc");
    expect(derived).toBeDefined();
    expect(derived?.title).toBe("shadow.inc");

    // Derived searchengineland.com (title with trailing host).
    const sel = out.find((c) => c.url === "https://searchengineland.com");
    expect(sel).toBeDefined();
  });

  it("derived citations let domain matching succeed against the user's --domain", () => {
    const out = parseGeminiCitations(geminiSampleResponse);
    expect(out.some((c) => hostnameMatchesDomain(c.url, "shadow.inc"))).toBe(
      true
    );
  });

  it("flags wrapper URIs with a notes field", () => {
    const out = parseGeminiCitations(geminiSampleResponse);
    const wrapper = out.find((c) =>
      c.url.includes("vertexaisearch.cloud.google.com")
    );
    expect(wrapper?.notes).toMatch(/redirect/i);
  });

  it("extracts the synthesized answer from candidates[0].content.parts", () => {
    const ans = extractGeminiAnswer(geminiSampleResponse);
    expect(ans).toContain("Generative engine optimization");
  });

  it("extracts fan-out queries from groundingMetadata.webSearchQueries", async () => {
    expect(parseGeminiFanOutQueries(geminiSampleResponse)).toEqual([
      "what is GEO",
      "generative engine optimization",
    ]);
    const engine = createGeminiEngine({
      apiKey: "AIza-test",
      fetch: (async () =>
        new Response(JSON.stringify(geminiSampleResponse), {
          status: 200,
          headers: { "content-type": "application/json" },
        })) as typeof globalThis.fetch,
    });
    const res = await engine.askWithCitations("q");
    expect(res.fanOutQueries).toEqual([
      "what is GEO",
      "generative engine optimization",
    ]);
  });

  it("computes cost from usageMetadata + per-grounded-request fee", async () => {
    const engine = createGeminiEngine({
      apiKey: "AIza-test",
      fetch: (async () =>
        jsonResponse(geminiSampleResponse)) as typeof globalThis.fetch,
    });
    const res = await engine.askWithCitations("q");
    // 50 prompt @ $0.075/M + 120 completion @ $0.30/M + $0.035 grounding.
    expect(res.usage?.estimatedCostUsd).toBeCloseTo(
      (50 / 1_000_000) * 0.075 + (120 / 1_000_000) * 0.3 + 0.035,
      4
    );
    expect(res.usage?.totalTokens).toBe(170);
  });

  it("falls back to GEMINI_API_KEY when GOOGLE_API_KEY is unset", async () => {
    const originalGoogle = process.env.GOOGLE_API_KEY;
    const originalGemini = process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    process.env.GEMINI_API_KEY = "AIza-fallback";
    try {
      const fetchMock = vi.fn(async () => jsonResponse(geminiSampleResponse));
      const engine = createGeminiEngine({
        fetch: fetchMock as unknown as typeof globalThis.fetch,
      });
      await engine.askWithCitations("q");
      const url = fetchMock.mock.calls[0]![0] as string;
      expect(url).toContain("key=AIza-fallback");
    } finally {
      if (originalGoogle === undefined) delete process.env.GOOGLE_API_KEY;
      else process.env.GOOGLE_API_KEY = originalGoogle;
      if (originalGemini === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = originalGemini;
    }
  });

  it("throws naming both env vars when neither is set", async () => {
    const engine = createGeminiEngine({
      apiKey: "",
      fetch: (async () => new Response("")) as typeof globalThis.fetch,
    });
    await expect(engine.askWithCitations("q")).rejects.toThrow(
      /GOOGLE_API_KEY/
    );
    await expect(engine.askWithCitations("q")).rejects.toThrow(
      /GEMINI_API_KEY/
    );
  });

  it("throws on non-OK HTTP with the status code in the message", async () => {
    const engine = createGeminiEngine({
      apiKey: "AIza-test",
      fetch: (async () =>
        new Response("quota exceeded", {
          status: 403,
          statusText: "Forbidden",
        })) as typeof globalThis.fetch,
    });
    await expect(engine.askWithCitations("q")).rejects.toThrow(/403/);
  });

  it("surfaces network failures as adapter errors", async () => {
    const engine = createGeminiEngine({
      apiKey: "AIza-test",
      fetch: (async () => {
        throw new Error("ETIMEDOUT");
      }) as typeof globalThis.fetch,
    });
    await expect(engine.askWithCitations("q")).rejects.toThrow(/ETIMEDOUT/);
  });
});
