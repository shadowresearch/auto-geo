# Storage adapters

`auto-geo` storage is pluggable behind the `ContentStore` interface in `core/store.ts`:

```ts
interface ContentStore {
  publish(payload: ResourcePublishPayload): Promise<void>;
  get(slug: string): Promise<StoredResource | null>;
  list(opts?: ListOptions): Promise<StoredResource[]>;
  delete(slug: string): Promise<void>;
}
```

Three reference adapters ship in `adapters/storage/`. All three implement the same interface; the publish endpoint and render path are adapter-agnostic.

## KV (Vercel KV / Upstash Redis)

```ts
import { createKvStore } from "auto-geo/storage/kv";
const store = createKvStore({ namespace: "myapp" }); // namespace optional
```

**Required env**:

```
KV_REST_API_URL=...
KV_REST_API_TOKEN=...
```

**Schema**: two keys per resource.

- `[namespace:]resource:post:{slug}` — JSON of `StoredResource`.
- `[namespace:]resource:slugs` — sorted set scored by `publishedAt` epoch ms, for chronological listing.

**When to use**: Vercel deployments, zero-infrastructure preference, sub-millisecond reads. The `@vercel/kv` SDK works with both Vercel KV and Upstash Redis.

**Trade-offs**: no SQL, no dashboard. Backups via Upstash UI or `redis-cli BGSAVE`.

## Supabase

```ts
import { createSupabaseStore } from "auto-geo/storage/supabase";
const store = createSupabaseStore(); // reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
```

**Required env**:

```
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...   # service-role key only — never expose this client-side
```

**Schema**: one table. Run `adapters/storage/supabase.sql` in the Supabase SQL editor before first use:

```sql
create table auto_geo_resources (
  slug          text primary key,
  payload       jsonb not null,
  published_at  timestamptz not null,
  stored_at     timestamptz not null default now()
);
create index on auto_geo_resources (published_at desc);
```

**When to use**: you want a dashboard, SQL access for ad-hoc queries, or RLS policies layered on top.

**Trade-offs**: slightly higher read latency than KV. Service-role key must be kept server-side.

## In-memory

```ts
import { createMemoryStore } from "auto-geo/storage/memory";
const store = createMemoryStore({
  seed: [
    /* optional initial payloads */
  ],
});
```

Process-local. Loses everything on restart. Use only for tests, demos, and local development. The adapter accepts a `seed` array of `ResourcePublishPayload` so example apps can render a populated `/resources` index on first run.

## Writing your own adapter

Implement the `ContentStore` interface. Three contracts to honor:

1. **`publish` must be idempotent on slug.** Re-publishing the same slug overwrites — no insert-fails, no version branching.
2. **`publish` and `delete` should throw on backend errors.** The publish endpoint surfaces backend failures as HTTP 502; silent no-ops here look like ghost successes.
3. **`get` and `list` should degrade gracefully.** Return `null` / `[]` on transient errors, log server-side. The render path is read-heavy; throwing here would crash unrelated pages.

A `ContentStore` that wraps a third store (e.g., a cache layer over Supabase) is fine — just keep the interface contracts.

## Migrating between adapters

There is no built-in migration. Use the storage layer's native export/import (Supabase: `pg_dump`; KV: `SCAN` + a script) and adapt the shape if you change adapter. The stored shape is `ResourcePublishPayload + { storedAt }` — `payload`-shaped for Supabase, JSON-stringified for KV — so most migrations are a one-pass transform.
