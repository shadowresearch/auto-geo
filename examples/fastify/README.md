# fastify — auto-geo on Fastify

Endpoint-only example. There is no official Fastify adapter for
`auto-geo` today, so this example calls `runPublish` and `runDelete`
from the package directly inside Fastify route handlers.

> This example does NOT render HTML. For the full React render path see
> [`examples/next-minimal/`](../next-minimal). These endpoint-only
> examples exist to prove the publish contract on each backend.

## Install & run

```bash
cd examples/fastify
pnpm install
export GEO_PUBLISH_TOKEN="$(openssl rand -hex 32)"
pnpm dev
# → http://localhost:3004
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
curl http://localhost:3004/api/resources
curl http://localhost:3004/api/resources/hello-auto-geo
```

## Publish a payload

The payload below satisfies every hard schema constraint and is the
canonical smoke test used across all `auto-geo` example servers. The
response will be HTTP 200 with several soft warnings in the `warnings`
array — that's expected, the payload is deliberately short.

```bash
curl -X POST http://localhost:3004/api/resources/publish \
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
      "answerCapsule": "If the response is HTTP 200 with success true plus a slug and url, then yes: the schema passed, the in-memory store accepted the write, and the resource is now retrievable via the listing endpoint or the by-slug endpoint until the example server restarts and clears the store.",
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
      "The in-memory storage adapter persists only for the lifetime of the running process and is wiped on restart."
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
curl http://localhost:3004/api/resources
curl http://localhost:3004/api/resources/publish-test
```

## Files

| File        | What it does                                                                             |
| ----------- | ---------------------------------------------------------------------------------------- |
| `server.ts` | Fastify app: calls `runPublish` / `runDelete` directly, adds GET endpoints for verifying |
| `seed.ts`   | Inline valid seed payload so the store is non-empty on first run                         |

## Notes

- Uses Fastify 5; the same pattern works on Fastify 4 with no changes
  beyond the version pin in `package.json`.
- To swap storage, replace `createMemoryStore` with `createKvStore`
  (`auto-geo/storage/kv`) or `createSupabaseStore`
  (`auto-geo/storage/supabase`). The rest of the file is unchanged.
