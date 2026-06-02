import { kv } from "@vercel/kv";
import type {
  ContentStore,
  StoredResource,
  ListOptions,
} from "../../core/store";
import type { ResourcePublishPayload } from "../../core/schema";

/**
 * KV-backed `ContentStore` implementation.
 *
 * Works with any Redis-compatible KV that exposes the `@vercel/kv` API
 * surface — Vercel KV, Upstash Redis. Two keys per resource:
 *
 *   - `resource:post:{slug}` → JSON of the published resource (payload + storedAt).
 *   - `resource:slugs`       → sorted set scored by publishedAt timestamp for
 *                              cheap chronological listing (ZRANGE … REV).
 *
 * Read paths gracefully return null/empty when KV isn't configured
 * locally so render still succeeds during dev without env wiring. Write
 * paths throw so the publish endpoint can return 502 on backend errors.
 *
 * Required env:
 *   - KV_REST_API_URL
 *   - KV_REST_API_TOKEN
 *
 * Optional namespace prefix:
 *   - Pass `{ namespace }` to `createKvStore` to scope keys
 *     (e.g. `myapp:resource:post:slug` instead of `resource:post:slug`).
 *     Useful when one KV instance backs multiple sites.
 */

function isKvConfigured(): boolean {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

export type KvStoreOptions = {
  /** Optional key prefix. Useful when one KV instance backs multiple apps. */
  namespace?: string;
};

export function createKvStore(opts: KvStoreOptions = {}): ContentStore {
  const prefix = opts.namespace ? `${opts.namespace}:` : "";
  const POST_KEY = (slug: string) => `${prefix}resource:post:${slug}`;
  const INDEX_KEY = `${prefix}resource:slugs`;

  return {
    async publish(payload: ResourcePublishPayload): Promise<void> {
      const stored: StoredResource = {
        ...payload,
        storedAt: new Date().toISOString(),
      };
      const score = new Date(payload.publishedAt).getTime();
      if (Number.isNaN(score)) {
        throw new Error(`Invalid publishedAt date: ${payload.publishedAt}`);
      }
      await Promise.all([
        kv.set(POST_KEY(payload.slug), stored),
        kv.zadd(INDEX_KEY, { score, member: payload.slug }),
      ]);
    },

    async get(slug: string): Promise<StoredResource | null> {
      if (!isKvConfigured()) return null;
      try {
        const post = await kv.get<StoredResource>(POST_KEY(slug));
        return post ?? null;
      } catch (error) {
        console.error(`auto-geo[kv]: failed to read ${slug}:`, error);
        return null;
      }
    },

    async list(opts: ListOptions = {}): Promise<StoredResource[]> {
      if (!isKvConfigured()) return [];
      try {
        const start = opts.offset ?? 0;
        const stop = opts.limit ? start + opts.limit - 1 : -1;
        const slugs = await kv.zrange<string[]>(INDEX_KEY, start, stop, {
          rev: true,
        });
        if (!slugs || slugs.length === 0) return [];
        const posts = await Promise.all(
          slugs.map((slug) => kv.get<StoredResource>(POST_KEY(slug)))
        );
        return posts.filter((p): p is StoredResource => p !== null);
      } catch (error) {
        console.error("auto-geo[kv]: failed to list:", error);
        return [];
      }
    },

    async delete(slug: string): Promise<void> {
      await Promise.all([kv.del(POST_KEY(slug)), kv.zrem(INDEX_KEY, slug)]);
    },
  };
}
