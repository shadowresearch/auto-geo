import { describe, it, expect, beforeEach } from "vitest";
import { createMemoryStore } from "../adapters/storage/memory";
import { VALID_PAYLOAD } from "./fixtures/payload";
import type { ContentStore } from "../core/store";

describe("createMemoryStore (ContentStore interface)", () => {
  let store: ContentStore;

  beforeEach(() => {
    store = createMemoryStore();
  });

  it("returns null for a slug that was never published", async () => {
    expect(await store.get("nothing")).toBeNull();
  });

  it("publishes and retrieves a payload", async () => {
    await store.publish(VALID_PAYLOAD);
    const stored = await store.get(VALID_PAYLOAD.slug);
    expect(stored).not.toBeNull();
    expect(stored!.slug).toBe(VALID_PAYLOAD.slug);
    expect(stored!.title).toBe(VALID_PAYLOAD.title);
    expect(stored!.storedAt).toBeDefined();
  });

  it("overwrites on re-publish of the same slug", async () => {
    await store.publish(VALID_PAYLOAD);
    await store.publish({ ...VALID_PAYLOAD, title: "Updated" });
    const stored = await store.get(VALID_PAYLOAD.slug);
    expect(stored!.title).toBe("Updated");
  });

  it("lists empty when nothing has been published", async () => {
    expect(await store.list()).toEqual([]);
  });

  it("lists in descending publishedAt order", async () => {
    await store.publish({
      ...VALID_PAYLOAD,
      slug: "old",
      publishedAt: "2025-01-01",
    });
    await store.publish({
      ...VALID_PAYLOAD,
      slug: "new",
      publishedAt: "2026-12-31",
    });
    await store.publish({
      ...VALID_PAYLOAD,
      slug: "mid",
      publishedAt: "2026-06-01",
    });
    const list = await store.list();
    expect(list.map((r) => r.slug)).toEqual(["new", "mid", "old"]);
  });

  it("respects limit and offset", async () => {
    for (const i of [0, 1, 2, 3, 4]) {
      await store.publish({
        ...VALID_PAYLOAD,
        slug: `r${i}`,
        publishedAt: `2026-01-0${i + 1}`,
      });
    }
    const page1 = await store.list({ limit: 2, offset: 0 });
    expect(page1.map((r) => r.slug)).toEqual(["r4", "r3"]);
    const page2 = await store.list({ limit: 2, offset: 2 });
    expect(page2.map((r) => r.slug)).toEqual(["r2", "r1"]);
  });

  it("deletes a published slug", async () => {
    await store.publish(VALID_PAYLOAD);
    await store.delete(VALID_PAYLOAD.slug);
    expect(await store.get(VALID_PAYLOAD.slug)).toBeNull();
  });

  it("delete is idempotent on missing slug", async () => {
    await expect(store.delete("never-existed")).resolves.toBeUndefined();
  });

  it("accepts seed payloads at construction", async () => {
    const seeded = createMemoryStore({ seed: [VALID_PAYLOAD] });
    const stored = await seeded.get(VALID_PAYLOAD.slug);
    expect(stored).not.toBeNull();
  });
});
