import { describe, it, expect, vi } from "vitest";
import {
  createCloudflareHandlers,
  createCloudflareFetch,
} from "../adapters/http/cloudflare";
import { createMemoryStore } from "../adapters/storage/memory";
import type { SiteConfig } from "../core/publish";
import type { ContentStore } from "../core/store";
import { VALID_PAYLOAD } from "./fixtures/payload";

const SITE: SiteConfig = {
  origin: "https://example.com",
  basePath: "/resources",
  publisher: {
    name: "Shadow",
    url: "https://www.shadow.inc",
    logo: "https://www.shadow.inc/logo.svg",
  },
};

const TOKEN = "test-token-abc123";
const ENV = { GEO_PUBLISH_TOKEN: TOKEN };

function makePublishRequest(body: unknown, init: RequestInit = {}): Request {
  return new Request("https://worker.example.com/api/resources/publish", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${TOKEN}`,
      ...(init.headers ?? {}),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...init,
  });
}

function makeDeleteRequest(
  slug: string | null,
  init: RequestInit = {}
): Request {
  const url = new URL("https://worker.example.com/api/resources/publish");
  if (slug !== null) url.searchParams.set("slug", slug);
  return new Request(url.toString(), {
    method: "DELETE",
    headers: {
      authorization: `Bearer ${TOKEN}`,
      ...(init.headers ?? {}),
    },
    ...init,
  });
}

describe("createCloudflareHandlers — publish", () => {
  it("returns 200 with slug, url, and warnings on success", async () => {
    const store = createMemoryStore();
    const handlers = createCloudflareHandlers({ store, site: SITE });

    const res = await handlers.publish(makePublishRequest(VALID_PAYLOAD), ENV);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      slug: string;
      url: string;
      warnings: unknown[];
    };
    expect(body.success).toBe(true);
    expect(body.slug).toBe(VALID_PAYLOAD.slug);
    expect(body.url).toBe(
      `https://example.com/resources/${VALID_PAYLOAD.slug}`
    );
    expect(Array.isArray(body.warnings)).toBe(true);
  });

  it("returns 401 when authorization header is missing or wrong", async () => {
    const store = createMemoryStore();
    const handlers = createCloudflareHandlers({ store, site: SITE });

    const missing = await handlers.publish(
      makePublishRequest(VALID_PAYLOAD, { headers: { authorization: "" } }),
      ENV
    );
    expect(missing.status).toBe(401);

    const wrong = await handlers.publish(
      makePublishRequest(VALID_PAYLOAD, {
        headers: { authorization: "Bearer wrong-token" },
      }),
      ENV
    );
    expect(wrong.status).toBe(401);
  });

  it("returns 500 when the token env var is not configured", async () => {
    const store = createMemoryStore();
    const handlers = createCloudflareHandlers({ store, site: SITE });
    const res = await handlers.publish(makePublishRequest(VALID_PAYLOAD), {});
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/configuration/i);
  });

  it("respects a custom tokenEnv", async () => {
    const store = createMemoryStore();
    const handlers = createCloudflareHandlers({
      store,
      site: SITE,
      tokenEnv: "AUTO_GEO_SECRET",
    });
    const res = await handlers.publish(makePublishRequest(VALID_PAYLOAD), {
      AUTO_GEO_SECRET: TOKEN,
    });
    expect(res.status).toBe(200);
  });

  it("returns 400 on invalid JSON body", async () => {
    const store = createMemoryStore();
    const handlers = createCloudflareHandlers({ store, site: SITE });
    const res = await handlers.publish(makePublishRequest("not-json"), ENV);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/json/i);
  });

  it("returns 400 with issues on validation failure", async () => {
    const store = createMemoryStore();
    const handlers = createCloudflareHandlers({ store, site: SITE });
    const res = await handlers.publish(makePublishRequest({ slug: "x" }), ENV);
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: string;
      issues: { path: string; message: string }[];
    };
    expect(body.error).toMatch(/validation/i);
    expect(body.issues.length).toBeGreaterThan(0);
    expect(body.issues[0]).toHaveProperty("path");
    expect(body.issues[0]).toHaveProperty("message");
  });

  it("returns 409 with slug on reserved-slug collision", async () => {
    const store = createMemoryStore();
    const handlers = createCloudflareHandlers({
      store,
      site: SITE,
      reservedSlugs: [VALID_PAYLOAD.slug],
    });
    const res = await handlers.publish(makePublishRequest(VALID_PAYLOAD), ENV);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; slug: string };
    expect(body.slug).toBe(VALID_PAYLOAD.slug);
    expect(body.error).toMatch(/reserved/i);
  });

  it("returns 502 when the store throws", async () => {
    const throwingStore: ContentStore = {
      publish: vi.fn().mockRejectedValue(new Error("kv boom")),
      get: vi.fn(),
      list: vi.fn(),
      delete: vi.fn(),
    };
    const handlers = createCloudflareHandlers({
      store: throwingStore,
      site: SITE,
    });
    const res = await handlers.publish(makePublishRequest(VALID_PAYLOAD), ENV);
    expect(res.status).toBe(502);
  });

  it("invokes onSuccess on a successful publish", async () => {
    const store = createMemoryStore();
    const onSuccess = vi.fn();
    const handlers = createCloudflareHandlers({ store, site: SITE, onSuccess });
    const res = await handlers.publish(makePublishRequest(VALID_PAYLOAD), ENV);
    expect(res.status).toBe(200);
    expect(onSuccess).toHaveBeenCalledWith({
      kind: "publish",
      slug: VALID_PAYLOAD.slug,
    });
  });

  it("swallows errors thrown by onSuccess", async () => {
    const store = createMemoryStore();
    const onSuccess = vi.fn().mockRejectedValue(new Error("hook boom"));
    const handlers = createCloudflareHandlers({ store, site: SITE, onSuccess });
    const res = await handlers.publish(makePublishRequest(VALID_PAYLOAD), ENV);
    expect(res.status).toBe(200);
    expect(onSuccess).toHaveBeenCalled();
  });

  it("returns JSON content-type on every response", async () => {
    const store = createMemoryStore();
    const handlers = createCloudflareHandlers({ store, site: SITE });
    const ok = await handlers.publish(makePublishRequest(VALID_PAYLOAD), ENV);
    expect(ok.headers.get("content-type")).toMatch(/application\/json/);
    const bad = await handlers.publish(makePublishRequest({ slug: "x" }), ENV);
    expect(bad.headers.get("content-type")).toMatch(/application\/json/);
  });
});

describe("createCloudflareHandlers — delete", () => {
  it("returns 200 when the slug exists", async () => {
    const store = createMemoryStore({ seed: [VALID_PAYLOAD] });
    const handlers = createCloudflareHandlers({ store, site: SITE });
    const res = await handlers.delete(
      makeDeleteRequest(VALID_PAYLOAD.slug),
      ENV
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; slug: string };
    expect(body.success).toBe(true);
    expect(body.slug).toBe(VALID_PAYLOAD.slug);
    expect(await store.get(VALID_PAYLOAD.slug)).toBeNull();
  });

  it("returns 400 when slug query param is missing", async () => {
    const store = createMemoryStore();
    const handlers = createCloudflareHandlers({ store, site: SITE });
    const res = await handlers.delete(makeDeleteRequest(null), ENV);
    expect(res.status).toBe(400);
  });

  it("returns 401 on bad auth", async () => {
    const store = createMemoryStore({ seed: [VALID_PAYLOAD] });
    const handlers = createCloudflareHandlers({ store, site: SITE });
    const res = await handlers.delete(
      makeDeleteRequest(VALID_PAYLOAD.slug, {
        headers: { authorization: "Bearer nope" },
      }),
      ENV
    );
    expect(res.status).toBe(401);
  });

  it("returns 404 when the slug does not exist", async () => {
    const store = createMemoryStore();
    const handlers = createCloudflareHandlers({ store, site: SITE });
    const res = await handlers.delete(
      makeDeleteRequest("never-published"),
      ENV
    );
    expect(res.status).toBe(404);
  });

  it("returns 409 on reserved-slug delete", async () => {
    const store = createMemoryStore({ seed: [VALID_PAYLOAD] });
    const handlers = createCloudflareHandlers({
      store,
      site: SITE,
      reservedSlugs: [VALID_PAYLOAD.slug],
    });
    const res = await handlers.delete(
      makeDeleteRequest(VALID_PAYLOAD.slug),
      ENV
    );
    expect(res.status).toBe(409);
  });

  it("returns 502 when the store throws on delete", async () => {
    const throwingStore: ContentStore = {
      publish: vi.fn(),
      get: vi.fn().mockResolvedValue({ ...VALID_PAYLOAD, storedAt: "now" }),
      list: vi.fn(),
      delete: vi.fn().mockRejectedValue(new Error("kv delete boom")),
    };
    const handlers = createCloudflareHandlers({
      store: throwingStore,
      site: SITE,
    });
    const res = await handlers.delete(
      makeDeleteRequest(VALID_PAYLOAD.slug),
      ENV
    );
    expect(res.status).toBe(502);
  });

  it("invokes onSuccess on a successful delete", async () => {
    const store = createMemoryStore({ seed: [VALID_PAYLOAD] });
    const onSuccess = vi.fn();
    const handlers = createCloudflareHandlers({ store, site: SITE, onSuccess });
    const res = await handlers.delete(
      makeDeleteRequest(VALID_PAYLOAD.slug),
      ENV
    );
    expect(res.status).toBe(200);
    expect(onSuccess).toHaveBeenCalledWith({
      kind: "delete",
      slug: VALID_PAYLOAD.slug,
    });
  });
});

describe("createCloudflareFetch", () => {
  it("routes POST to publish and DELETE to delete on basePath", async () => {
    const store = createMemoryStore();
    const fetchHandler = createCloudflareFetch({ store, site: SITE });

    const pub = await fetchHandler(makePublishRequest(VALID_PAYLOAD), ENV);
    expect(pub.status).toBe(200);

    const del = await fetchHandler(makeDeleteRequest(VALID_PAYLOAD.slug), ENV);
    expect(del.status).toBe(200);
  });

  it("returns 405 on unsupported method against basePath", async () => {
    const store = createMemoryStore();
    const fetchHandler = createCloudflareFetch({ store, site: SITE });
    const req = new Request(
      "https://worker.example.com/api/resources/publish",
      {
        method: "GET",
      }
    );
    const res = await fetchHandler(req, ENV);
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST, DELETE");
  });

  it("returns 404 for paths outside basePath", async () => {
    const store = createMemoryStore();
    const fetchHandler = createCloudflareFetch({ store, site: SITE });
    const req = new Request("https://worker.example.com/some/other/path");
    const res = await fetchHandler(req, ENV);
    expect(res.status).toBe(404);
  });

  it("honors a custom basePath", async () => {
    const store = createMemoryStore();
    const fetchHandler = createCloudflareFetch({
      store,
      site: SITE,
      basePath: "/custom/publish",
    });
    const req = new Request("https://worker.example.com/custom/publish", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify(VALID_PAYLOAD),
    });
    const res = await fetchHandler(req, ENV);
    expect(res.status).toBe(200);

    const miss = new Request(
      "https://worker.example.com/api/resources/publish",
      {
        method: "POST",
      }
    );
    const missRes = await fetchHandler(miss, ENV);
    expect(missRes.status).toBe(404);
  });
});
