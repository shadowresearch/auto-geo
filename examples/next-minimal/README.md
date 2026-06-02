# next-minimal — auto-geo reference Next.js app

A working Next.js 15 App Router app that:

- Hosts the `/api/resources/publish` endpoint.
- Renders published resources at `/resources/[slug]`.
- Renders an index at `/resources`.
- Uses the in-memory store seeded with one sample payload (so the index is non-empty on first run).

Use this as the integration template when wiring `auto-geo` into your own app.

## Run

```bash
pnpm install
cp .env.example .env.local
# Edit .env.local and set GEO_PUBLISH_TOKEN to any value
pnpm dev
```

Open `http://localhost:3000/resources` — you should see the seeded sample.

## Publish via curl

```bash
curl -X POST http://localhost:3000/api/resources/publish \
  -H "Authorization: Bearer <your-GEO_PUBLISH_TOKEN>" \
  -H "Content-Type: application/json" \
  -d @sample-payload.json
```

Then visit `http://localhost:3000/resources/<slug>`.

## Wiring summary

| File | What it does |
|---|---|
| `app/api/resources/publish/route.ts` | Wires `createNextHandlers` from `auto-geo/next`. |
| `app/resources/[slug]/page.tsx` | Reads from the store, renders `ResourceArticle`, emits JSON-LD. |
| `app/resources/page.tsx` | Index listing all published resources by category. |
| `lib/auto-geo.ts` | Shared store + site config — instantiated once and imported wherever needed. |

## Swapping the store

The example uses `createMemoryStore` for zero-setup. To switch to KV:

```ts
// lib/auto-geo.ts
import { createKvStore } from "auto-geo/storage/kv";
export const store = createKvStore();
```

Add `KV_REST_API_URL` and `KV_REST_API_TOKEN` to `.env.local`. Nothing else changes — the publish endpoint, render route, and index all read from `store` through the `ContentStore` interface.
