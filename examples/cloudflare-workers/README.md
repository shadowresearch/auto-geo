# cloudflare-workers — auto-geo on Cloudflare Workers

Endpoint-only example. Mounts the official `auto-geo/cloudflare` adapter
on a Cloudflare Worker, backed by the in-memory store seeded with one
valid payload.

> This example does NOT render HTML. For the full React render path see
> [`examples/next-minimal/`](../next-minimal). These endpoint-only
> examples exist to prove the publish contract on each backend.

## Install & run

```bash
# Install Wrangler if you don't have it: https://developers.cloudflare.com/workers/wrangler/install-and-update/
cd examples/cloudflare-workers
pnpm install

# Local secret for `wrangler dev`. Wrangler reads .dev.vars at startup.
echo "GEO_PUBLISH_TOKEN=$(openssl rand -hex 32)" > .dev.vars

pnpm dev
# → http://localhost:8787
```

## Endpoints

| Method | Path                              | Notes                          |
| ------ | --------------------------------- | ------------------------------ |
| POST   | `/api/resources/publish`          | Auth: Bearer GEO_PUBLISH_TOKEN |
| DELETE | `/api/resources/publish?slug=...` | Auth: Bearer GEO_PUBLISH_TOKEN |
| GET    | `/api/resources`                  | List seeded + published        |
| GET    | `/api/resources/:slug`            | Fetch full JSON payload        |

## Verify the seed

```bash
curl http://localhost:8787/api/resources
curl http://localhost:8787/api/resources/hello-auto-geo
```

## Publish a payload

The payload below satisfies every hard schema constraint and is the
canonical smoke test used across all `auto-geo` example servers. The
response will be HTTP 200 with several soft warnings in the `warnings`
array — that's expected, the payload is deliberately short.

```bash
# Use whatever you put in .dev.vars
export GEO_PUBLISH_TOKEN="$(grep GEO_PUBLISH_TOKEN .dev.vars | cut -d= -f2)"

curl -X POST http://localhost:8787/api/resources/publish \
  -H "Authorization: Bearer $GEO_PUBLISH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "publish-test",
    "title": "Verifying the auto-geo publish flow from curl",
    "metaDescription": "A short payload posted to an auto-geo example server to confirm the publish endpoint is wired correctly and the configured store accepts the write end to end.",
    "category": "Examples",
    "excerpt": "A minimal payload used to confirm the auto-geo publish endpoint works end to end on a freshly cloned example, against the in-memory storage adapter.",
    "author": {
      "name": "Test User",
      "jobTitle": "Engineer",
      "bio": "A short biography string that meets the minimum length constraint imposed by the auto-geo author schema for the publish endpoint, included here for the smoke test."
    },
    "publishedAt": "2026-06-02",
    "keywords": ["auto-geo", "example", "smoke-test"],
    "geoMetadata": {
      "targetQueries": ["auto-geo publish smoke test", "verify auto-geo endpoint with curl", "auto-geo example payload"],
      "pageType": "resource",
      "primaryFunction": "Confirm the auto-geo publish endpoint is reachable, authorized, and persisting payloads end to end against the configured storage adapter in a freshly cloned example.",
      "optimizationFramework": ["GEO"],
      "targetPlatforms": ["chatgpt"],
      "informationGainStatement": "First-party smoke-test payload for the auto-geo example servers used to verify the publish contract before swapping in real content.",
      "refreshCadence": "quarterly"
    },
    "tldr": { "text": "Auto-geo is a publishing engine for GEO resource pages. It exposes a POST endpoint that accepts a JSON payload describing a structured page, validates it against a strict Zod schema, stores it via a pluggable adapter, and renders it with a built-in React component for AI engine citation." },
    "intro": { "blocks": [{ "type": "paragraph", "text": "A small payload used to verify the publish endpoint contract on an auto-geo example server. Replace it with real content once the wiring and auth are confirmed end to end against your storage adapter." }] },
    "sections": [{
      "heading": "Did the publish endpoint accept this payload?",
      "answerCapsule": "If the response is HTTP 200 with success true plus a slug and url, then yes: the schema passed, the in-memory store accepted the write, and the resource is now retrievable via the listing endpoint or the by-slug endpoint until the worker isolate restarts and clears the store.",
      "blocks": [{ "type": "paragraph", "text": "Inspect the warnings array on the response to see any soft quality heuristics that fired. They are non-blocking and surface issues like heading format, paragraph length, or entity density." }]
    }],
    "relatedGuides": { "items": [
      { "title": "auto-geo on GitHub", "url": "https://github.com/shadowresearch/auto-geo" },
      { "title": "The GEO SOP", "url": "https://github.com/shadowresearch/auto-geo/blob/main/docs/sop.md" },
      { "title": "Storage adapter guide", "url": "https://github.com/shadowresearch/auto-geo/blob/main/docs/storage-adapters.md" },
      { "title": "Validation reference", "url": "https://github.com/shadowresearch/auto-geo/blob/main/docs/validation.md" }
    ]},
    "keyTakeaways": { "items": [
      "The publish endpoint returns HTTP 200 with success, slug, url, and a warnings array on success.",
      "Hard validation errors come back as HTTP 400 with an issues array pointing at the failing field path.",
      "Soft warnings are non-blocking quality heuristics surfaced on the success response after the schema passes.",
      "The in-memory storage adapter persists only for the lifetime of the worker isolate and is wiped on cold start."
    ]},
    "faq": { "items": [
      { "question": "What does a successful response look like?", "answer": "It returns HTTP 200 with a JSON body of the shape success, slug, url, and a warnings array. The warnings array contains any soft quality heuristics that fired during validation. Address them by re-posting an updated payload to the same slug, since the publish endpoint is idempotent." },
      { "question": "What are soft warnings?", "answer": "Soft warnings are non-blocking quality heuristics surfaced on a successful 200 response after the strict schema passes. They include things like heading format, paragraph length, and entity density. They are advisory and do not block publishing, unlike the hard schema constraints." },
      { "question": "Is the publish endpoint idempotent on slug?", "answer": "The publish endpoint is idempotent on the slug field, so re-posting a payload with the same slug overwrites the prior entry in the configured storage adapter. This pattern fits an iteration loop where you publish, inspect warnings, refine the payload, and republish." }
    ]},
    "disclosure": { "text": "Smoke-test payload included in the auto-geo example READMEs. It satisfies the hard schema constraints but is deliberately short for demonstration purposes." }
  }'
```

Then verify:

```bash
curl http://localhost:8787/api/resources
curl http://localhost:8787/api/resources/publish-test
```

## Deploy

```bash
# One-time: set the real publish token in Cloudflare's secret store
wrangler secret put GEO_PUBLISH_TOKEN

# Deploy to *.workers.dev (or your custom domain after configuring it)
pnpm deploy
```

See [Cloudflare's Workers deployment docs](https://developers.cloudflare.com/workers/get-started/guide/#5-deploy-your-project)
for custom domains, routes, and environments.

## Two integration styles

The example uses the **compose** style — `createCloudflareHandlers`
returns `publish` and `delete` functions you call from your own `fetch`,
so you can add other routes (like the GET endpoints in `src/index.ts`).

If auto-geo is the entire worker, you can collapse to a one-liner:

```ts
import { createCloudflareFetch } from "auto-geo/cloudflare";
import { createMemoryStore } from "auto-geo/storage/memory";

export default {
  fetch: createCloudflareFetch({
    store: createMemoryStore(),
    site: { origin: "https://example.workers.dev", publisher: { ... } },
    // basePath defaults to "/api/resources/publish"
  }),
};
```

## Files

| File            | What it does                                                                               |
| --------------- | ------------------------------------------------------------------------------------------ |
| `src/index.ts`  | Worker entry. Mounts `createCloudflareHandlers` for publish, adds GET endpoints for reads. |
| `src/seed.ts`   | Inline valid seed payload so the store is non-empty on first run                           |
| `wrangler.toml` | Cloudflare config: name, entry, compatibility date, KV binding skeleton                    |
| `tsconfig.json` | TypeScript config with `@cloudflare/workers-types`                                         |

## Notes

- The `auto-geo/cloudflare` adapter uses only the Fetch API (`Request`,
  `Response`, `URL`). No Node-specific imports anywhere. It also runs on
  Deno Deploy, Bun, and any other Fetch-compatible runtime.
- Memory storage is per-isolate and resets on cold start — fine for
  demos, not durable. For production, bind a KV namespace in
  `wrangler.toml`, uncomment the `GEO_KV` line in the `Env` interface,
  and write a small `ContentStore` against `env.GEO_KV`.
