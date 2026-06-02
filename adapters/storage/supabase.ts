import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  ContentStore,
  StoredResource,
  ListOptions,
} from "../../core/store";
import type { ResourcePublishPayload } from "../../core/schema";

/**
 * Supabase-backed `ContentStore` implementation.
 *
 * Single table: `auto_geo_resources`. Schema lives in `supabase.sql`
 * (sibling file). Run it once in the Supabase SQL editor before using
 * this adapter.
 *
 *   create table auto_geo_resources (
 *     slug          text primary key,
 *     payload       jsonb not null,
 *     published_at  timestamptz not null,
 *     stored_at     timestamptz not null default now()
 *   );
 *   create index on auto_geo_resources (published_at desc);
 *
 * Required env:
 *   - SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY  (server-side only — never expose this)
 *
 * Use the service-role key, not the anon key. Row-level security can
 * still gate read access if you want public reads to go through the
 * anon key + a SELECT policy; this writer needs full privileges.
 */

export type SupabaseStoreOptions = {
  /**
   * Override the table name if `auto_geo_resources` conflicts with
   * existing schema. The table shape must match — see `supabase.sql`.
   */
  table?: string;
  /**
   * Provide a pre-built Supabase client. Mainly for tests; in normal
   * use, the adapter constructs its own client from env.
   */
  client?: SupabaseClient;
};

const DEFAULT_TABLE = "auto_geo_resources";

function getClient(opts: SupabaseStoreOptions): SupabaseClient {
  if (opts.client) return opts.client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "auto-geo[supabase]: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set."
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

export function createSupabaseStore(
  opts: SupabaseStoreOptions = {}
): ContentStore {
  const table = opts.table ?? DEFAULT_TABLE;

  return {
    async publish(payload: ResourcePublishPayload): Promise<void> {
      const client = getClient(opts);
      const { error } = await client.from(table).upsert(
        {
          slug: payload.slug,
          payload,
          published_at: payload.publishedAt,
          stored_at: new Date().toISOString(),
        },
        { onConflict: "slug" }
      );
      if (error) {
        throw new Error(`auto-geo[supabase]: publish failed: ${error.message}`);
      }
    },

    async get(slug: string): Promise<StoredResource | null> {
      try {
        const client = getClient(opts);
        const { data, error } = await client
          .from(table)
          .select("payload, stored_at")
          .eq("slug", slug)
          .maybeSingle();
        if (error) {
          console.error(`auto-geo[supabase]: get(${slug}) failed:`, error);
          return null;
        }
        if (!data) return null;
        return {
          ...(data.payload as ResourcePublishPayload),
          storedAt: data.stored_at as string,
        };
      } catch (error) {
        console.error(`auto-geo[supabase]: get(${slug}) threw:`, error);
        return null;
      }
    },

    async list(opts2: ListOptions = {}): Promise<StoredResource[]> {
      try {
        const client = getClient(opts);
        let query = client
          .from(table)
          .select("payload, stored_at")
          .order("published_at", { ascending: false });
        if (opts2.limit) {
          const offset = opts2.offset ?? 0;
          query = query.range(offset, offset + opts2.limit - 1);
        }
        const { data, error } = await query;
        if (error) {
          console.error("auto-geo[supabase]: list failed:", error);
          return [];
        }
        return (data ?? []).map((row) => ({
          ...(row.payload as ResourcePublishPayload),
          storedAt: row.stored_at as string,
        }));
      } catch (error) {
        console.error("auto-geo[supabase]: list threw:", error);
        return [];
      }
    },

    async delete(slug: string): Promise<void> {
      const client = getClient(opts);
      const { error } = await client.from(table).delete().eq("slug", slug);
      if (error) {
        throw new Error(
          `auto-geo[supabase]: delete(${slug}) failed: ${error.message}`
        );
      }
    },
  };
}
