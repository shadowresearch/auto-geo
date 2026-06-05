import { describe, expect, it, vi } from "vitest";
import {
  createAnthropicEngine,
  extractAnthropicAnswer,
  parseAnthropicCitations,
} from "../../cli/engines/anthropic";
import { hostnameMatchesDomain } from "../../cli/check";
import { anthropicSampleResponse } from "../fixtures/engines/anthropic-response";

/**
 * Adapter contract: shape the request correctly, decode the response,
 * normalize citations, deduplicate, and surface errors with useful
 * messages. Network is fully mocked via the injectable `fetch`.
 */

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("createAnthropicEngine", () => {
  it("posts to the messages endpoint with x-api-key and the web_search tool", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(anthropicSampleResponse));
    const engine = createAnthropicEngine({
      apiKey: "sk-test",
      fetch: fetchMock as unknown as typeof globalThis.fetch,
    });

    await engine.askWithCitations("what is GEO");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-test");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(headers["content-type"]).toBe("application/json");

    const body = JSON.parse(init!.body as string);
    expect(body.model).toBe("claude-sonnet-4-5");
    expect(body.max_tokens).toBe(1024);
    expect(body.messages).toEqual([{ role: "user", content: "what is GEO" }]);
    expect(body.tools).toEqual([
      { type: "web_search_20250305", name: "web_search" },
    ]);
  });

  it("parses citations from the sample fixture and dedupes by URL", async () => {
    const engine = createAnthropicEngine({
      apiKey: "sk-test",
      fetch: (async () =>
        jsonResponse(anthropicSampleResponse)) as typeof globalThis.fetch,
    });
    const res = await engine.askWithCitations("what is GEO");

    // Two unique source URLs across both the tool_result block and the
    // inline citation block (the inline duplicate of shadow.inc is
    // merged with the tool_result entry, with the inline title winning).
    expect(res.citations).toHaveLength(2);
    const urls = res.citations.map((c) => c.url);
    expect(urls).toContain("https://www.shadow.inc/resources/what-is-geo");
    expect(urls).toContain("https://searchengineland.com/geo-explained");

    const shadow = res.citations.find((c) => c.url.includes("shadow.inc"))!;
    expect(shadow.title).toBe("What is GEO? — Shadow (inline)");
    expect(shadow.snippet).toMatch(/Generative engine optimization/);
  });

  it("matches the normalized domain against the parsed citation URL", () => {
    const citations = parseAnthropicCitations(anthropicSampleResponse);
    expect(
      citations.some((c) => hostnameMatchesDomain(c.url, "shadow.inc"))
    ).toBe(true);
  });

  it("extracts the synthesized answer text by concatenating text blocks", () => {
    const out = extractAnthropicAnswer(anthropicSampleResponse);
    expect(out).toContain("Generative engine optimization");
    expect(out).toContain("I'll search for"); // first text block preserved
  });

  it("computes cost from per-token rates + per-search fee", async () => {
    const engine = createAnthropicEngine({
      apiKey: "sk-test",
      fetch: (async () =>
        jsonResponse(anthropicSampleResponse)) as typeof globalThis.fetch,
    });
    const res = await engine.askWithCitations("q");
    expect(res.usage?.estimatedCostUsd).toBeGreaterThan(0);
    // 6039 prompt @ $3/M + 931 completion @ $15/M + 1 search @ $0.01.
    expect(res.usage?.estimatedCostUsd).toBeCloseTo(
      (6039 / 1_000_000) * 3 + (931 / 1_000_000) * 15 + 0.01,
      4
    );
    expect(res.usage?.promptTokens).toBe(6039);
    expect(res.usage?.completionTokens).toBe(931);
  });

  it("throws with the env-var name when no API key is configured", async () => {
    const engine = createAnthropicEngine({
      apiKey: "",
      fetch: (async () => new Response("")) as typeof globalThis.fetch,
    });
    await expect(engine.askWithCitations("q")).rejects.toThrow(
      /ANTHROPIC_API_KEY/
    );
  });

  it("throws on non-OK HTTP with the status code in the message", async () => {
    const engine = createAnthropicEngine({
      apiKey: "sk-test",
      fetch: (async () =>
        new Response("rate limited", {
          status: 429,
          statusText: "Too Many Requests",
        })) as typeof globalThis.fetch,
    });
    await expect(engine.askWithCitations("q")).rejects.toThrow(/429/);
  });

  it("surfaces network failures (rejected fetch) as adapter errors", async () => {
    const engine = createAnthropicEngine({
      apiKey: "sk-test",
      fetch: (async () => {
        throw new Error("ECONNRESET");
      }) as typeof globalThis.fetch,
    });
    await expect(engine.askWithCitations("q")).rejects.toThrow(/ECONNRESET/);
  });
});
