import { describe, it, expect, vi } from "vitest";
import { runPublish, runDelete } from "../core/publish";
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

describe("runPublish", () => {
  it("returns ok with the canonical URL on success", async () => {
    const store = createMemoryStore();
    const result = await runPublish(VALID_PAYLOAD, { store, site: SITE });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.slug).toBe(VALID_PAYLOAD.slug);
      expect(result.url).toBe(
        `https://example.com/resources/${VALID_PAYLOAD.slug}`
      );
      expect(Array.isArray(result.warnings)).toBe(true);
    }
  });

  it("persists the payload to the store", async () => {
    const store = createMemoryStore();
    await runPublish(VALID_PAYLOAD, { store, site: SITE });
    const stored = await store.get(VALID_PAYLOAD.slug);
    expect(stored).not.toBeNull();
    expect(stored!.slug).toBe(VALID_PAYLOAD.slug);
    expect(stored!.storedAt).toBeDefined();
  });

  it("returns validation_failed on malformed body", async () => {
    const store = createMemoryStore();
    const result = await runPublish(
      { slug: "x" }, // missing nearly every required field
      { store, site: SITE }
    );
    expect(result.kind).toBe("validation_failed");
    if (result.kind === "validation_failed") {
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.issues[0]).toHaveProperty("path");
      expect(result.issues[0]).toHaveProperty("message");
    }
  });

  it("returns slug_reserved when slug is in the reserved list", async () => {
    const store = createMemoryStore();
    const result = await runPublish(VALID_PAYLOAD, {
      store,
      site: SITE,
      reservedSlugs: [VALID_PAYLOAD.slug],
    });
    expect(result.kind).toBe("slug_reserved");
  });

  it("returns store_failed when the store throws", async () => {
    const throwingStore: ContentStore = {
      publish: vi.fn().mockRejectedValue(new Error("boom")),
      get: vi.fn(),
      list: vi.fn(),
      delete: vi.fn(),
    };
    const result = await runPublish(VALID_PAYLOAD, {
      store: throwingStore,
      site: SITE,
    });
    expect(result.kind).toBe("store_failed");
    if (result.kind === "store_failed") {
      expect(result.error.message).toBe("boom");
    }
  });

  it("uses default basePath '/resources' when omitted", async () => {
    const store = createMemoryStore();
    const result = await runPublish(VALID_PAYLOAD, {
      store,
      site: { ...SITE, basePath: undefined },
    });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.url).toContain("/resources/");
    }
  });

  it("respects a custom basePath", async () => {
    const store = createMemoryStore();
    const result = await runPublish(VALID_PAYLOAD, {
      store,
      site: { ...SITE, basePath: "/guides" },
    });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.url).toBe(
        `https://example.com/guides/${VALID_PAYLOAD.slug}`
      );
    }
  });

  it("is idempotent on slug (overwrite)", async () => {
    const store = createMemoryStore();
    await runPublish(VALID_PAYLOAD, { store, site: SITE });
    const updated = { ...VALID_PAYLOAD, title: "Updated title" };
    const result = await runPublish(updated, { store, site: SITE });
    expect(result.kind).toBe("ok");
    const stored = await store.get(VALID_PAYLOAD.slug);
    expect(stored!.title).toBe("Updated title");
  });
});

describe("runDelete", () => {
  it("returns ok when the slug exists", async () => {
    const store = createMemoryStore({ seed: [VALID_PAYLOAD] });
    const result = await runDelete(VALID_PAYLOAD.slug, { store, site: SITE });
    expect(result.kind).toBe("ok");
    const after = await store.get(VALID_PAYLOAD.slug);
    expect(after).toBeNull();
  });

  it("returns not_found when the slug does not exist", async () => {
    const store = createMemoryStore();
    const result = await runDelete("never-published", { store, site: SITE });
    expect(result.kind).toBe("not_found");
  });

  it("returns slug_reserved without touching the store", async () => {
    const store = createMemoryStore({ seed: [VALID_PAYLOAD] });
    const result = await runDelete(VALID_PAYLOAD.slug, {
      store,
      site: SITE,
      reservedSlugs: [VALID_PAYLOAD.slug],
    });
    expect(result.kind).toBe("slug_reserved");
    const stored = await store.get(VALID_PAYLOAD.slug);
    expect(stored).not.toBeNull();
  });

  it("returns store_failed when the store throws", async () => {
    const throwingStore: ContentStore = {
      publish: vi.fn(),
      get: vi.fn().mockResolvedValue({ ...VALID_PAYLOAD, storedAt: "now" }),
      list: vi.fn(),
      delete: vi.fn().mockRejectedValue(new Error("delete boom")),
    };
    const result = await runDelete(VALID_PAYLOAD.slug, {
      store: throwingStore,
      site: SITE,
    });
    expect(result.kind).toBe("store_failed");
  });
});
