# AGENT.md — auto-geo setup spec

You are integrating `auto-geo` into the user's repository. Follow these steps in order. Do not skip ahead, do not improvise.

`auto-geo` is a publishing engine for GEO resource pages — public web pages structured for citation by AI search engines (ChatGPT, Perplexity, Google AI Overviews, Claude, Gemini). It exposes a single authenticated HTTP endpoint that validates a typed payload against a strict structural schema, persists it through a pluggable storage adapter, and renders it via React components that emit Schema.org JSON-LD.

This file is the canonical specification. Other files in this repo are reference implementations; this file says what to do with them.

---

## 1. Detect the host stack

Inspect the user's repository before copying any files. You must know which of the following the user has:

- **`next.config.{js,ts,mjs}` present and `next` ≥ 14 in `package.json`** → Next.js App Router. Use `adapters/http/next.ts`.
- **`hono` in `package.json`** → Hono. Use `adapters/http/hono.ts`.
- **Other Node.js framework (Express, Fastify, Elysia, etc.)** → Use `adapters/http/hono.ts` as a template; adapt the request/response handling to the user's framework. The `core/publish.ts` function is framework-agnostic.
- **No HTTP framework / no Node.js backend** → Scaffold a minimal Hono server in `app/server.ts` from `examples/hono-minimal/`. Ask the user before doing this.

If the user has both Next.js and a separate API service, ask which one should host the publish endpoint. Default: Next.js if it exists, since the `/resources/[slug]` rendering route lives there too.

---

## 2. Detect or choose storage

`auto-geo` requires a key-value or relational store. Ask the user which they have or want:

- **Vercel KV / Upstash Redis** → `adapters/storage/kv.ts`. Required env: `KV_REST_API_URL`, `KV_REST_API_TOKEN`. Best if the user is on Vercel or wants zero infrastructure.
- **Supabase** → `adapters/storage/supabase.ts`. Requires running `adapters/storage/supabase.sql` in the user's Supabase SQL editor to create the table. Env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. Best if the user wants a dashboard and SQL access.
- **In-memory** → `adapters/storage/memory.ts`. Process-local only. Use for tests or demo apps. Never use in production.

If the user is unsure, recommend KV — fewer moving parts.

---

## 3. Install dependencies

```bash
pnpm add zod
# Plus the storage adapter you chose:
pnpm add @vercel/kv          # if KV
pnpm add @supabase/supabase-js  # if Supabase
# Plus the HTTP adapter you chose:
pnpm add hono                # if Hono
# Next.js needs nothing extra.
# For the React renderer:
pnpm add react react-dom
```

Do NOT add `auto-geo` from npm. This repo is intended to be copied into the user's source tree, not installed as a dependency. The agent (you) is responsible for the integration; npm versioning would couple it.

---

## 4. Copy the core

Copy the entire `core/` directory into the user's source tree at a stable location, conventionally `src/lib/auto-geo/`:

```
src/lib/auto-geo/
├── schema.ts        ← from core/schema.ts
├── store.ts         ← from core/store.ts
├── publish.ts       ← from core/publish.ts
├── validation.ts    ← from core/validation.ts
├── jsonld.ts        ← from core/jsonld.ts
└── index.ts         ← from core/index.ts
```

Do not modify field names, length constraints, or word-count rules in `schema.ts`. These are the SOP-aligned contract that AI agents will be writing against. If the user objects to a specific constraint, surface the trade-off (e.g., "TL;DR is 40–60 words because that's the length range that empirically maximizes citation extraction; loosening it weakens the GEO signal") rather than silently bending the schema.

---

## 5. Wire the publish endpoint

Copy the HTTP adapter you chose in step 1. For Next.js App Router:

```
src/app/api/resources/publish/route.ts  ← from adapters/http/next.ts
```

The endpoint must:

1. Authenticate the request with `Bearer ${process.env.GEO_PUBLISH_TOKEN}`.
2. Parse the JSON body and validate it against `resourcePublishSchema` from `core/schema.ts`.
3. Audit the payload with `auditResource` from `core/validation.ts` (soft warnings).
4. Persist via the storage adapter's `publish(payload)` method.
5. Revalidate the index path and the slug path (Next.js: `revalidatePath('/resources')` and `revalidatePath(\`/resources/\${slug}\`)`).
6. Return `{ success: true, slug, url, warnings }` on 200.

`adapters/http/next.ts` does all six. Do not modify the validation order. Do not skip soft warnings — they are the agent feedback loop.

---

## 6. Wire the render path

Copy the React renderer:

```
src/components/auto-geo/  ← from components/react/
```

Create the slug-dynamic route:

```
src/app/resources/[slug]/page.tsx  ← from examples/next-minimal/app/resources/[slug]/page.tsx
```

The route must:

1. Resolve the slug via the storage adapter's `get(slug)` method.
2. 404 if not found.
3. Generate `metadata` (title, description, canonical, OpenGraph, Twitter) from the stored payload.
4. Render `<ResourceArticle payload={...} />` from `components/auto-geo`.
5. Emit JSON-LD via `deriveAllJsonLd(payload, siteConfig)` from `core/jsonld.ts`, serialized with `safeJsonLd`.

The `siteConfig` argument tells `auto-geo` the user's origin and publisher identity. Pass `{ origin: 'https://example.com', publisher: { name: 'Acme', url: 'https://example.com', logo: 'https://example.com/logo.png' } }`. Default `basePath` is `/resources`; override if the user wants pages under a different prefix.

---

## 7. Wire the index

```
src/app/resources/page.tsx  ← from examples/next-minimal/app/resources/page.tsx
```

The index calls `store.list()` and renders one card per published resource. Group by `category` if the user has more than ~10 resources.

---

## 8. Set environment variables

Add to `.env.local`:

```
GEO_PUBLISH_TOKEN=<generate a long random string>
# Storage:
KV_REST_API_URL=...
KV_REST_API_TOKEN=...
# OR
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
```

Generate the publish token with `openssl rand -hex 32`. It will be required on every publish request as `Authorization: Bearer <token>`.

---

## 9. (Optional) Set up the MCP server

If the user wants to publish via an MCP-aware AI client (Claude Desktop, Claude Code, Cursor, etc.):

```bash
# Copy mcp/ into the repo (or run it via npx in dev)
pnpm add @modelcontextprotocol/sdk
```

Configure the MCP client to register the `auto-geo` server with two environment variables:

- `AUTO_GEO_PUBLISH_URL` — e.g. `http://localhost:3000/api/resources/publish` in dev, or the deployed URL in prod.
- `AUTO_GEO_PUBLISH_TOKEN` — the same token from step 8.

The MCP server exposes one tool: `publish_resource`, with a Zod-typed input matching the resource publish schema. See `mcp/README.md` for the client configuration snippets (Claude Desktop config, Cursor mcp.json, etc.).

---

## 10. Verify

Smoke-test before declaring done:

1. Start the user's dev server.
2. Send a curl POST to `/api/resources/publish` with the payload from `examples/next-minimal/sample-payload.json` and a `Bearer <token>` header.
3. Confirm the response is `{ success: true, slug, url, warnings }`.
4. Navigate to `/resources/<slug>` in the browser. Confirm the page renders with the TL;DR, intro, sections, related guides, key takeaways, FAQ, about the author, and disclosure.
5. View source on the rendered page. Confirm `<script type="application/ld+json">` tags are present for `@type: Article`, `@type: BreadcrumbList`, and `@type: FAQPage`.

If any step fails, stop and report the failure to the user. Do not paper over the issue.

---

## 11. What NOT to do

- Do not change the seven-block page architecture. The order (TL;DR → intro → sections → related guides → key takeaways → FAQ → about the author → disclosure) is load-bearing for AI citation extraction.
- Do not loosen the word-count constraints. They are calibrated to the SOP.
- Do not add a markdown parser. Inline syntax is `**bold**`, `*italic*`, `[label](url)` only. Anything else is by design rejected at the schema boundary.
- Do not store the publish token in source. `.env.local` only; deployment provider's secret manager in production.
- Do not silently fall back to in-memory storage in production. If the configured store is unreachable, fail loudly.
- Do not skip the `auditResource` soft-warning pass. Even if you ignore the warnings, the response shape includes them — the calling agent needs them for the iteration loop.

---

## 12. Substantive references

If the user asks _why_ the architecture is what it is, point them at `docs/sop.md`. That document is the standard operating procedure for GEO resource pages — the empirical and theoretical basis for every constraint in `schema.ts` and every heuristic in `validation.ts`. Read it before deviating from any rule.
