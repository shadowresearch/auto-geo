import { describe, expect, it, vi } from "vitest";
import {
  createOpenAIEngine,
  extractOpenAIAnswer,
  parseOpenAICitations,
} from "../../cli/engines/openai";
import { hostnameMatchesDomain } from "../../cli/check";
import { openaiSampleResponse } from "../fixtures/engines/openai-response";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("createOpenAIEngine", () => {
  it("posts to /v1/responses with web_search_preview enabled", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(openaiSampleResponse));
    const engine = createOpenAIEngine({
      apiKey: "sk-test",
      fetch: fetchMock as unknown as typeof globalThis.fetch,
    });

    await engine.askWithCitations("what is GEO");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer sk-test");

    const body = JSON.parse(init!.body as string);
    expect(body.model).toBe("gpt-4o-mini");
    expect(body.input).toBe("what is GEO");
    expect(body.tools).toEqual([{ type: "web_search_preview" }]);
  });

  it("parses url_citation annotations from the sample response and dedupes", async () => {
    const engine = createOpenAIEngine({
      apiKey: "sk-test",
      fetch: (async () =>
        jsonResponse(openaiSampleResponse)) as typeof globalThis.fetch,
    });
    const res = await engine.askWithCitations("what is GEO");

    // 2 unique URLs (3 annotations, 1 dup).
    expect(res.citations).toHaveLength(2);
    expect(res.citations.map((c) => c.url)).toEqual([
      "https://www.shadow.inc/resources/what-is-geo",
      "https://arxiv.org/abs/2311.09735",
    ]);
    // First-write-wins for the title (later dup is dropped, not merged).
    expect(res.citations[0]!.title).toBe("What is GEO? — Shadow");
  });

  it("works against the exported parser directly", () => {
    const out = parseOpenAICitations(openaiSampleResponse);
    expect(out).toHaveLength(2);
  });

  it("matches the normalized domain against the parsed citation URLs", () => {
    const citations = parseOpenAICitations(openaiSampleResponse);
    expect(
      citations.some((c) => hostnameMatchesDomain(c.url, "shadow.inc"))
    ).toBe(true);
  });

  it("concatenates output_text chunks for the answer", () => {
    const ans = extractOpenAIAnswer(openaiSampleResponse);
    expect(ans).toContain("generative engine optimization");
  });

  it("computes cost from input/output tokens + per-search fee", async () => {
    const engine = createOpenAIEngine({
      apiKey: "sk-test",
      fetch: (async () =>
        jsonResponse(openaiSampleResponse)) as typeof globalThis.fetch,
    });
    const res = await engine.askWithCitations("q");
    // 120 input @ $0.15/M + 240 output @ $0.60/M + $0.025 per search.
    expect(res.usage?.estimatedCostUsd).toBeCloseTo(
      (120 / 1_000_000) * 0.15 + (240 / 1_000_000) * 0.6 + 0.025,
      4
    );
    expect(res.usage?.totalTokens).toBe(360);
  });

  it("throws naming OPENAI_API_KEY when the key is missing", async () => {
    const engine = createOpenAIEngine({
      apiKey: "",
      fetch: (async () => new Response("")) as typeof globalThis.fetch,
    });
    await expect(engine.askWithCitations("q")).rejects.toThrow(
      /OPENAI_API_KEY/
    );
  });

  it("throws on non-OK HTTP with the status code surfaced", async () => {
    const engine = createOpenAIEngine({
      apiKey: "sk-test",
      fetch: (async () =>
        new Response("rate limited", {
          status: 429,
          statusText: "Too Many Requests",
        })) as typeof globalThis.fetch,
    });
    await expect(engine.askWithCitations("q")).rejects.toThrow(/429/);
  });
});
