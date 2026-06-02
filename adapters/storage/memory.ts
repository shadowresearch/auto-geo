import type { ContentStore, StoredResource, ListOptions } from "../../core/store";
import type { ResourcePublishPayload } from "../../core/schema";

/**
 * In-memory `ContentStore` for tests, demos, and local development.
 *
 * Process-local: every server restart loses content. Every process
 * instance has its own copy. Do not use in production.
 *
 * The store can be pre-seeded with resources via `createMemoryStore({ seed })`,
 * useful for example apps that want a working `/resources` listing on
 * first run.
 */

export type MemoryStoreOptions = {
  seed?: ResourcePublishPayload[];
};

export function createMemoryStore(opts: MemoryStoreOptions = {}): ContentStore {
  const map = new Map<string, StoredResource>();

  for (const payload of opts.seed ?? []) {
    map.set(payload.slug, {
      ...payload,
      storedAt: new Date().toISOString(),
    });
  }

  return {
    async publish(payload: ResourcePublishPayload): Promise<void> {
      map.set(payload.slug, {
        ...payload,
        storedAt: new Date().toISOString(),
      });
    },

    async get(slug: string): Promise<StoredResource | null> {
      return map.get(slug) ?? null;
    },

    async list(opts2: ListOptions = {}): Promise<StoredResource[]> {
      const all = Array.from(map.values()).sort((a, b) =>
        b.publishedAt.localeCompare(a.publishedAt)
      );
      const start = opts2.offset ?? 0;
      const end = opts2.limit ? start + opts2.limit : undefined;
      return all.slice(start, end);
    },

    async delete(slug: string): Promise<void> {
      map.delete(slug);
    },
  };
}
