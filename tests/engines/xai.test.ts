import { describe, expect, it, vi } from "vitest";
import { createXAIEngine, parseXAICitations } from "../../cli/engines/xai";
import { hostnameMatchesDomain } from "../../cli/check";
import { xaiSampleResponse } from "../fixtures/engines/xai-response";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("createXAIEngine", () => {
  it("posts to api.x.ai chat/completions with Bearer auth and search_parameters", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(xaiSampleResponse));
    const engine = createXAIEngine({
      apiKey: "xai-test",
      fetch: fetchMock as unknown as typeof globalThis.fetch,
    });

    await engine.askWithCitations("what is GEO");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.x.ai/v1/chat/completions");
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer xai-test");

    const body = JSON.parse(init!.body as string);
    expect(body.model).toBe("grok-2-latest");
    expect(body.messages).toEqual([{ role: "user", content: "what is GEO" }]);
    expect(body.search_parameters).toEqual({
      mode: "on",
      return_citations: true,
    });
  });

  it("dedupes citations and derives titles from hostnames", async () => {
    const engine = createXAIEngine({
      apiKey: "xai-test",
      fetch: (async () =>
        jsonResponse(xaiSampleResponse)) as typeof globalThis.fetch,
    });
    const res = await engine.askWithCitations("q");

    // 4 raw citations with one duplicate → 3 unique.
    expect(res.citations).toHaveLength(3);
    const shadow = res.citations.find((c) => c.url.includes("shadow.inc"))!;
    expect(shadow.title).toBe("shadow.inc");
    const gh = res.citations.find((c) => c.url.includes("github.com"))!;
    expect(gh.title).toBe("github.com");
  });

  it("falls back to a top-level citations array when message-level is absent", () => {
    const out = parseXAICitations({
      choices: [{ message: { role: "assistant", content: "x" } }],
      citations: ["https://www.shadow.inc/p", "https://other.com/x"],
    });
    expect(out).toHaveLength(2);
    expect(out[0]!.url).toBe("https://www.shadow.inc/p");
  });

  it("matches the normalized domain against parsed citations", async () => {
    const engine = createXAIEngine({
      apiKey: "xai-test",
      fetch: (async () =>
        jsonResponse(xaiSampleResponse)) as typeof globalThis.fetch,
    });
    const res = await engine.askWithCitations("q");
    expect(
      res.citations.some((c) => hostnameMatchesDomain(c.url, "shadow.inc"))
    ).toBe(true);
  });

  it("computes cost from token usage + num_sources_used", async () => {
    const engine = createXAIEngine({
      apiKey: "xai-test",
      fetch: (async () =>
        jsonResponse(xaiSampleResponse)) as typeof globalThis.fetch,
    });
    const res = await engine.askWithCitations("q");
    // 80 prompt @ $2/M + 150 completion @ $10/M + 3 sources @ $0.025.
    expect(res.usage?.estimatedCostUsd).toBeCloseTo(
      (80 / 1_000_000) * 2 + (150 / 1_000_000) * 10 + 3 * 0.025,
      4
    );
    expect(res.usage?.totalTokens).toBe(230);
  });

  it("throws with the env-var name when no API key is configured", async () => {
    const engine = createXAIEngine({
      apiKey: "",
      fetch: (async () => new Response("")) as typeof globalThis.fetch,
    });
    await expect(engine.askWithCitations("q")).rejects.toThrow(/XAI_API_KEY/);
  });

  it("throws on non-OK HTTP with the status code in the message", async () => {
    const engine = createXAIEngine({
      apiKey: "xai-test",
      fetch: (async () =>
        new Response("server error", {
          status: 500,
          statusText: "Internal Server Error",
        })) as typeof globalThis.fetch,
    });
    await expect(engine.askWithCitations("q")).rejects.toThrow(/500/);
  });

  it("surfaces network failures as adapter errors", async () => {
    const engine = createXAIEngine({
      apiKey: "xai-test",
      fetch: (async () => {
        throw new Error("ENOTFOUND");
      }) as typeof globalThis.fetch,
    });
    await expect(engine.askWithCitations("q")).rejects.toThrow(/ENOTFOUND/);
  });
});
