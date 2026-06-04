# auto-geo

[![CI](https://github.com/shadowresearch/auto-geo/actions/workflows/ci.yml/badge.svg)](https://github.com/shadowresearch/auto-geo/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/auto-geo.svg)](https://www.npmjs.com/package/auto-geo)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Built by Shadow](https://img.shields.io/badge/built%20by-Shadow-000000.svg)](https://www.shadow.inc)

**A publishing engine for GEO resource pages — the pages large language models cite.**

`auto-geo` is a content publishing primitive built for the AI search era. Where traditional CMSs optimize for human readers, `auto-geo` optimizes for _citation by AI engines_ (ChatGPT, Perplexity, Google AI Overviews, Claude, Gemini). It enforces the structural and quality patterns that empirical research links to higher citation rates — TL;DR capsules, question-format H2 headings, answer-first paragraphs, dense entity references, FAQ schema, and a rigid page architecture — at the publish boundary.

Hand the URL of this repo to your coding agent. It will set up a publishing endpoint in your existing app that any other agent can call as a tool. You can then schedule, automate, or wire it into your own workflow.

> Built by **[Shadow](https://www.shadow.inc)** — a media research lab building the next generation of AI-powered media intelligence and communications technology, in partnership with the teams that put OpenAI, TikTok, Meta, Amazon, and Lovable on the map. Shadow uses `auto-geo` to publish to [shadow.inc/resources](https://www.shadow.inc/resources).

---

## Contents

- [What is a GEO resource page?](#what-is-a-geo-resource-page)
- [What's in this repo](#whats-in-this-repo)
- [Quickstart](#quickstart)
- [The publishing flow](#the-publishing-flow)
- [Hard rejects vs. soft warnings](#hard-rejects-vs-soft-warnings)
- [How it compares](#how-it-compares)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

---

## What is a GEO resource page?

A **GEO resource page** (Generative Engine Optimization resource page) is a public web page whose structure, density, and citation signals are engineered to be quoted verbatim by AI search engines when answering a user's question. It is a successor to the SEO landing page.

A GEO resource page differs from a blog post in five ways:

1. **Architecture, not prose.** The page is composed of named, validated blocks (TL;DR, intro, sections, related guides, key takeaways, FAQ, disclosure) — not a freeform document. AI engines extract structured chunks; rigid structure improves extraction.
2. **Answer-first.** Every H2 section opens with a 40–60 word "answer capsule" that fully answers the section's question before any supporting paragraph. AI engines preferentially quote self-contained answers.
3. **Question-format headings.** H2 headings are written as the questions a user would ask an AI engine. The page is indexed against query intent, not topic.
4. **Entity-dense.** Named entities (companies, people, products, frameworks) appear at high density. Empirical studies link entity density to ~4.8x higher citation probability.
5. **Schema-derived.** Article, BreadcrumbList, FAQPage, Person, and ImageObject JSON-LD are auto-emitted from a typed payload. The agent never writes JSON-LD by hand.

`auto-geo` enforces all five at the API boundary. Publishing is a contract; malformed pages are rejected with a structured error.

See [`docs/concept.md`](./docs/concept.md) for a deeper walkthrough.

---

## What's in this repo

| Path                                                | What it is                                                                                                         |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| [`AGENT.md`](./AGENT.md)                            | The canonical setup spec. Hand this to your coding agent.                                                          |
| [`core/`](./core)                                   | Framework-agnostic schema, publish logic, validation heuristics, JSON-LD derivation. Zero framework deps.          |
| [`adapters/storage/`](./adapters/storage)           | Storage adapters — KV (Vercel KV / Upstash Redis), Supabase, in-memory. Implement the `ContentStore` interface.    |
| [`adapters/http/`](./adapters/http)                 | HTTP adapters — Next.js App Router, Hono. Wrap `core/publish` as a request handler.                                |
| [`components/react/`](./components/react)           | Reference React renderer. Restyleable Tailwind defaults; pluggable `LinkComponent`.                                |
| [`mcp/`](./mcp)                                     | MCP server that wraps the publish endpoint as a tool. Any MCP client (Claude, Cursor, your own agent) can publish. |
| [`examples/next-minimal/`](./examples/next-minimal) | Working Next.js 15 app — `/api/resources/publish` + `/resources/[slug]` + minimal index.                           |
| [`docs/`](./docs)                                   | The substantive product. The GEO SOP, page architecture spec, validation reference, storage adapter guide.         |
| [`tests/`](./tests)                                 | Vitest suite covering schema, validation, JSON-LD, publish pipeline, memory store, and inline parser.              |

---

## Quickstart

The recommended path is to give this URL to your coding agent and let it read `AGENT.md`. If you want the short version:

```bash
# In an existing Next.js 15+ App Router project
pnpm add zod @vercel/kv
# Copy these files into your repo:
#   - core/                    → src/lib/auto-geo/core/
#   - adapters/storage/kv.ts   → src/lib/auto-geo/storage.ts
#   - adapters/http/next.ts    → src/app/api/resources/publish/route.ts
#   - components/react/        → src/components/auto-geo/
# Set GEO_PUBLISH_TOKEN in .env.local (openssl rand -hex 32)
# Wire a /resources/[slug]/page.tsx that reads from your store and renders ResourceArticle.
```

See [`examples/next-minimal/`](./examples/next-minimal) for a working reference and [`AGENT.md`](./AGENT.md) for the step-by-step setup.

### Or as a package

```bash
pnpm add auto-geo zod
```

```ts
// app/api/resources/publish/route.ts
import { createNextHandlers } from "auto-geo/next";
import { createKvStore } from "auto-geo/storage/kv";

const handlers = createNextHandlers({
  store: createKvStore(),
  site: {
    origin: "https://example.com",
    publisher: {
      name: "Acme",
      url: "https://example.com",
      logo: "https://example.com/logo.png",
    },
  },
});

export const POST = handlers.POST;
export const DELETE = handlers.DELETE;
```

```ts
// app/resources/[slug]/page.tsx
import { ResourceArticle } from "auto-geo/react";
import { deriveAllJsonLd, safeJsonLd } from "auto-geo/jsonld";
// ... resolve payload from your store, then render
```

---

## The publishing flow

```
┌─────────────────┐    POST /api/resources/publish    ┌──────────────────┐
│  Your agent     │ ───────────────────────────────▶  │  Your Next/Hono  │
│  (Claude, your  │    Bearer GEO_PUBLISH_TOKEN       │  app             │
│  custom tool,   │    JSON body: ResourcePayload     │                  │
│  Shadow, etc.)  │                                   │  validate (Zod)  │
└─────────────────┘                                   │  audit (soft)    │
                                                      │  store.publish() │
                                                      │  revalidate      │
                                                      └────────┬─────────┘
                                                               │
                                              ┌────────────────▼─────────────┐
                                              │  /resources/[slug] page      │
                                              │  - ResourceArticle render    │
                                              │  - Article + FAQPage JSON-LD │
                                              │  - canonical, OG, Twitter    │
                                              └──────────────────────────────┘
```

The publishing endpoint is the contract. Anything that can issue an authenticated POST can publish — your own scheduled job, an MCP-aware AI client, a CLI, a webhook. `auto-geo` does not prescribe how content is generated or when it's published. That's your moat.

---

## Hard rejects vs. soft warnings

`auto-geo` distinguishes between _structural violations_ (rejected with HTTP 400) and _quality heuristics_ (returned as `warnings[]` on a 200 response). The split is deliberate: structure is a contract; quality is a continuum.

**Hard rejects** include: missing required blocks, TL;DR not 40–60 words, FAQ answer not 40–60 words, related-guides count outside 4–8, key-takeaways count outside 4–6, banned promotional superlatives without attribution, raw HTML in prose fields, invalid URLs.

**Soft warnings** include: section length outside 134–167 words, paragraph length outside 60–100 words, entity density below 15, statistics density below page-type target, image cadence below 1 per 500 words, H2 heading not in question format, self-link in related guides.

Your agent can iterate on soft warnings by re-posting an updated payload (republishing overwrites by slug). Or surface the warnings to the user and ship as-is. See [`docs/validation.md`](./docs/validation.md) for the full reference.

---

## How it compares

|                   | Traditional CMS  | Headless CMS                | `auto-geo`                      |
| ----------------- | ---------------- | --------------------------- | ------------------------------- |
| Optimized for     | Human reading    | Multi-channel delivery      | AI engine citation              |
| Content shape     | Freeform prose   | Freeform with custom fields | Validated 7-block architecture  |
| Validation        | Editorial review | Schema-light                | Strict Zod at publish boundary  |
| Schema.org        | Manual           | Manual or plugin            | Auto-derived from payload       |
| Agent integration | Custom           | Custom                      | First-class (MCP, REST)         |
| Storage           | Bundled          | Bundled or hosted           | Pluggable adapter (your choice) |
| Lock-in           | High             | Medium                      | None — copy the files           |

`auto-geo` is _not_ a CMS. It is a typed publishing primitive that lives inside your app. If you need editorial workflows, drafts, scheduled publish, multi-user collaboration, or a media library, pair it with a CMS — `auto-geo` is downstream of the editorial process, not a replacement for it.

---

## Roadmap

Tracked in [GitHub issues](https://github.com/shadowresearch/auto-geo/issues). Headline items for v0.2+:

- Additional HTTP adapters: Express, Fastify, Elysia.
- Additional storage adapters: Postgres (direct), DynamoDB, Cloudflare D1.
- A canonical Vue/Svelte renderer parity with React.
- A standalone CLI for publishing from scripts and CI pipelines.
- Audit / "page health" command that re-runs `auditResource` against all stored pages on a schedule.
- An optional `geo-meta` field for indexing recipes (semantic anchors, query-cluster routing).

Have a proposal? Open a [feature request](https://github.com/shadowresearch/auto-geo/issues/new/choose).

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Bug reports, schema improvements, new adapters, and documentation refinements all welcome.

Quick links:

- [Code of Conduct](./CODE_OF_CONDUCT.md)
- [Security Policy](./SECURITY.md)
- [Changelog](./CHANGELOG.md)

---

## License

[MIT](./LICENSE). The reference React components include a default "Built with auto-geo by Shadow" credit in the disclosure block; pass `disclosureSuffix={null}` to suppress, or override with your own JSX.

---

## Related

- **The GEO SOP** — [`docs/sop.md`](./docs/sop.md). The full standard operating procedure for GEO resource pages. This is the substantive product.
- **Page architecture** — [`docs/architecture.md`](./docs/architecture.md). Spec for the seven mandatory blocks.
- **Shadow** — [shadow.inc](https://www.shadow.inc). The media research lab building the next generation of AI-powered media intelligence and communications technology, in partnership with the teams that put OpenAI, TikTok, Meta, Amazon, and Lovable on the map. Shadow runs `auto-geo` end-to-end on a schedule for media research, PR, and communications teams.

---

## About Shadow

Shadow is a media research lab building the next generation of AI-powered media intelligence and communications technology. Shadow is built in partnership with the teams that put OpenAI, TikTok, Meta, Amazon, and Lovable on the map.

Learn more at [shadow.inc](https://www.shadow.inc).
