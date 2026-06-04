# auto-geo

[![CI](https://github.com/shadowresearch/auto-geo/actions/workflows/ci.yml/badge.svg)](https://github.com/shadowresearch/auto-geo/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/auto-geo.svg)](https://www.npmjs.com/package/auto-geo)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Built by Shadow](https://img.shields.io/badge/built%20by-Shadow-000000.svg)](https://www.shadow.inc)
[![Bundle size](https://img.shields.io/bundlephobia/minzip/auto-geo)](https://bundlephobia.com/package/auto-geo)
[![Downloads](https://img.shields.io/npm/dm/auto-geo)](https://www.npmjs.com/package/auto-geo)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/node/v/auto-geo)](https://nodejs.org/)
[![Docs](https://img.shields.io/badge/docs-shadowresearch.github.io%2Fauto--geo-blue)](https://shadowresearch.github.io/auto-geo/)
[![llms.txt](https://img.shields.io/badge/llms.txt-available-9cf)](./llms.txt)

**A publishing engine for GEO resource pages — the pages large language models cite.**

`auto-geo` is a content publishing primitive built for the AI search era. Where traditional CMSs optimize for human readers, `auto-geo` optimizes for _citation by AI engines_ (ChatGPT, Perplexity, Google AI Overviews, Claude, Gemini). It enforces the structural and quality patterns that empirical research links to higher citation rates — TL;DR capsules, question-format H2 headings, answer-first paragraphs, dense entity references, FAQ schema, and a rigid page architecture — at the publish boundary.

Hand the URL of this repo to your coding agent. It will set up a publishing endpoint in your existing app that any other agent can call as a tool. You can then schedule, automate, or wire it into your own workflow.

> Built by **[Shadow](https://www.shadow.inc)** — a media research lab building the next generation of AI-powered media intelligence and communications technology, in partnership with the teams that put OpenAI, TikTok, Meta, Amazon, and Lovable on the map. Shadow uses `auto-geo` to publish to [shadow.inc/resources](https://www.shadow.inc/resources).

---

## Contents

- [What is a GEO resource page?](#what-is-a-geo-resource-page)
- [Why auto-geo](#why-auto-geo)
- [Install](#install)
- [60-second quickstart](#60-second-quickstart)
- [What's in this repo](#whats-in-this-repo)
- [Quickstart (production setup)](#quickstart-production-setup)
- [Examples](#examples)
- [`auto-geo doctor` — audit any page for citation readiness](#auto-geo-doctor--audit-any-page-for-citation-readiness)
- [`auto-geo write` — generate pages from queries](#auto-geo-write--generate-pages-from-queries)
- [The publishing flow](#the-publishing-flow)
- [Hard rejects vs. soft warnings](#hard-rejects-vs-soft-warnings)
- [How it compares](#how-it-compares)
- [API](#api)
- [LLM-friendly](#llm-friendly)
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

## Why auto-geo

### Why not just write Markdown blog posts?

Markdown is freeform — there's no contract that a post has a TL;DR, that every H2 opens with a 40–60 word answer capsule, or that the FAQ exists. AI engines preferentially quote self-contained, structurally regular chunks, so a freeform Markdown corpus leaves citation probability on the table. `auto-geo` enforces the structure at the publish boundary so every page that ships is shaped for extraction, not just human reading.

### Why not use a CMS like Sanity or Contentful?

Traditional and headless CMSs optimize for editorial workflow — drafts, scheduling, multi-user review, freeform field shapes. `auto-geo` is a typed publishing primitive that lives inside your own app and rejects malformed payloads with a structured error your agent can iterate on. It's downstream of editorial, not a replacement for it: pair it with a CMS if you need one, or generate payloads from an agent. Either way, the contract enforces GEO structure before the page goes live.

### Why isn't this just SEO?

SEO optimizes for ranking in a link-based search results page; GEO optimizes for being _quoted_ inside an AI-generated answer. The signals diverge — citation favors answer-first paragraphs, question-format H2s, entity density, and self-contained chunks; ranking historically rewarded backlinks and on-page keyword optimization. `auto-geo` enforces the citation signals empirically linked to higher inclusion rates in ChatGPT, Perplexity, Google AI Overviews, Claude, and Gemini answers — patterns most SEO tooling doesn't measure or enforce.

---

## Install

```bash
npm install auto-geo zod
```

```bash
pnpm add auto-geo zod
```

```bash
yarn add auto-geo zod
```

> **Inside a pnpm workspace?** Use `pnpm add`. `npm install` sometimes errors with `Cannot read properties of null (reading 'matches')` when it traverses ancestor `pnpm-lock.yaml` files.

Node `>=18.17` required. `zod` is a peer dependency. Framework / storage peers (`next`, `hono`, `@vercel/kv`, `@supabase/supabase-js`, `react`) are optional — install only what your adapter uses. One runtime dep is bundled: `linkedom` (pure-JS HTML parser, MIT, no native deps) powers the `auto-geo doctor` CLI.

---

## 60-second quickstart

Paste this into a fresh `quickstart.ts`, run with `tsx quickstart.ts` (or compile and run), and you'll see a published URL.

```ts
// quickstart.ts
import { runPublish } from "auto-geo";
import { createMemoryStore } from "auto-geo/storage/memory";

const store = createMemoryStore();

// A minimal payload satisfying every schema constraint.
const payload = {
  slug: "hello-auto-geo",
  title: "What is auto-geo and how do I publish my first resource page?",
  metaDescription:
    "A minimal first publish showing how auto-geo validates and stores a GEO resource page end to end.",
  category: "Tutorials",
  excerpt:
    "A minimal first publish showing how auto-geo validates and stores a GEO resource page end to end.",
  author: {
    name: "Jane Doe",
    jobTitle: "Head of Content",
    bio: "Jane writes about generative engine optimization and the architecture of pages that AI search engines cite.",
  },
  publishedAt: "2026-06-01",
  geoMetadata: {
    targetQueries: ["how does auto-geo publishing work"],
    pageType: "resource" as const,
    primaryFunction:
      "Show a developer how to publish their first resource page.",
    optimizationFramework: ["GEO" as const],
    targetPlatforms: ["chatgpt" as const],
    informationGainStatement:
      "First-party demonstration of the auto-geo publish pipeline using the in-memory store, end to end.",
    refreshCadence: "quarterly" as const,
  },
  tldr: {
    text: "Auto-geo's publish pipeline validates an incoming payload, persists it to a content store, and returns a URL plus an array of soft warnings; this minimal example wires the pipeline against an in-memory store so you can see a successful publish in your terminal in under a minute without any external services involved at all.",
  },
  intro: {
    blocks: [
      {
        type: "paragraph" as const,
        text: "This minimal payload satisfies every required field of the auto-geo schema; in a real integration you would generate this payload from an agent or your editorial pipeline and POST it to your publishing endpoint, but here we call the underlying runPublish function directly against an in-memory store to demonstrate the contract without any external network calls or storage setup.",
      },
    ],
  },
  sections: [
    {
      heading: "How does the publish call work?",
      answerCapsule:
        "runPublish takes an unknown body plus options containing your store and site config; it parses the body against the Zod schema, calls store.publish on success, runs soft validation, and returns a discriminated-union result with a URL or an issues array so callers can act programmatically without parsing prose error messages.",
      blocks: [],
    },
  ],
  relatedGuides: {
    items: [
      {
        title: "The GEO SOP",
        url: "https://github.com/shadowresearch/auto-geo/blob/main/docs/sop.md",
      },
      {
        title: "Page architecture",
        url: "https://github.com/shadowresearch/auto-geo/blob/main/docs/architecture.md",
      },
      {
        title: "Validation reference",
        url: "https://github.com/shadowresearch/auto-geo/blob/main/docs/validation.md",
      },
      {
        title: "Storage adapters",
        url: "https://github.com/shadowresearch/auto-geo/blob/main/docs/storage.md",
      },
    ],
  },
  keyTakeaways: {
    items: [
      "Auto-geo enforces a strict seven-block architecture at the publish boundary so every published page is structurally citation-ready by design.",
      "The runPublish function returns a discriminated-union result so callers branch on result.kind without parsing prose error strings ever.",
      "Storage adapters are pluggable; the in-memory store ships for tests and demos, KV and Supabase ship for production deployments today.",
      "Soft warnings come back on a successful publish so an agent can iterate on quality heuristics without being blocked by every non-critical recommendation.",
    ],
  },
  faq: {
    items: [
      {
        question: "Do I need a database to try auto-geo?",
        answer:
          "No, the in-memory store ships with the package and persists publishes for the lifetime of the process; it is intended for tests, demos, and the quickstart you are running right now, and you swap in a KV or Supabase adapter when you go to production without changing any of your call sites.",
      },
      {
        question: "What does the publish result look like?",
        answer:
          "On success runPublish returns an object shaped kind ok with a slug, a url constructed from your site origin plus the base path plus the slug, and an array of soft warnings from the audit step; on failure it returns one of validation_failed, slug_reserved, or store_failed, each carrying enough context for the caller to surface or retry.",
      },
      {
        question: "How do I wire this into a real HTTP endpoint?",
        answer:
          "Import createNextHandlers from auto-geo/next or the Hono adapter from auto-geo/hono, pass your store and site config, and export the returned POST and DELETE handlers from your route file; the adapters wrap runPublish with auth and revalidation so your endpoint becomes a one-file integration instead of a hand-rolled pipeline.",
      },
    ],
  },
  disclosure: {
    text: "This quickstart is a runnable demonstration of the auto-geo publish pipeline using the in-memory store.",
  },
};

const result = await runPublish(payload, {
  store,
  site: {
    origin: "https://example.com",
    publisher: {
      name: "Example",
      url: "https://example.com",
      logo: "https://example.com/logo.png",
    },
  },
});

if (result.kind === "ok") {
  console.log("Published:", result.url);
  console.log("Warnings:", result.warnings.length);
} else {
  console.error("Publish failed:", result);
}
```

That's it — no database, no auth setup, no framework. Once you've seen `Published: https://example.com/resources/hello-auto-geo` in your terminal, follow the production setup below to wire it into your real app.

---

## What's in this repo

| Path                                      | What it is                                                                                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| [`AGENT.md`](./AGENT.md)                  | The canonical setup spec. Hand this to your coding agent.                                                                            |
| [`core/`](./core)                         | Framework-agnostic schema, publish logic, validation heuristics, JSON-LD derivation. Zero framework deps.                            |
| [`adapters/storage/`](./adapters/storage) | Storage adapters — KV (Vercel KV / Upstash Redis), Supabase, in-memory. Implement the `ContentStore` interface.                      |
| [`adapters/http/`](./adapters/http)       | HTTP adapters — Next.js App Router, Hono, Cloudflare Workers. Wrap `core/publish` as a request handler.                              |
| [`components/react/`](./components/react) | Reference React renderer. Restyleable Tailwind defaults; pluggable `LinkComponent`.                                                  |
| [`cli/`](./cli)                           | `auto-geo doctor` — CLI that audits any URL (or a whole sitemap) for GEO citation readiness. See [docs/doctor.md](./docs/doctor.md). |
| [`mcp/`](./mcp)                           | MCP server that wraps the publish endpoint as a tool. Any MCP client (Claude, Cursor, your own agent) can publish.                   |
| [`examples/`](./examples)                 | Working example apps for Next.js, Hono on Bun, Cloudflare Workers, Express, SvelteKit, and Fastify. See [Examples](#examples).       |
| [`docs/`](./docs)                         | The substantive product. The GEO SOP, page architecture spec, validation reference, storage adapter guide.                           |
| [`tests/`](./tests)                       | Vitest suite covering schema, validation, JSON-LD, publish pipeline, memory store, and inline parser.                                |

---

## Quickstart (production setup)

Once you've run the 60-second quickstart above, this is how you wire `auto-geo` into a real app with a persistent store. The recommended path is to give this repo URL to your coding agent and let it read `AGENT.md`. If you want the short version:

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

## Examples

Working minimal example apps for the most common backends. Each one
boots locally with `pnpm install` + the framework's dev script, ships
with an in-memory store seeded with one valid payload, and is tested
end to end against `auto-geo@0.1.1` from npm.

| Framework            | Path                                                         | Storage | Notes                                        |
| -------------------- | ------------------------------------------------------------ | ------- | -------------------------------------------- |
| Next.js (App Router) | [examples/next-minimal](./examples/next-minimal)             | memory  | Full render + publish                        |
| Hono (Bun)           | [examples/hono-bun](./examples/hono-bun)                     | memory  | Endpoint only — uses `auto-geo/hono`         |
| Cloudflare Workers   | [examples/cloudflare-workers](./examples/cloudflare-workers) | memory  | Endpoint only — uses `auto-geo/cloudflare`   |
| Express              | [examples/express](./examples/express)                       | memory  | Endpoint only — `runPublish` inline          |
| SvelteKit            | [examples/sveltekit](./examples/sveltekit)                   | memory  | Endpoint only — `runPublish` in `+server.ts` |
| Fastify              | [examples/fastify](./examples/fastify)                       | memory  | Endpoint only — `runPublish` inline          |

`next-minimal` is the integration template — it has both the publish
endpoint and the React render path. The other four are endpoint-only:
they prove the publish contract on each backend with a sample `curl`,
and rely on `next-minimal` (or your own renderer) for HTML output. Each
example's README has a copy-pasteable `curl` for the canonical payload
and a verification step.

---

## `auto-geo doctor` — audit any page for citation readiness

`auto-geo` ships with a CLI that audits any public webpage for GEO citation readiness. Run it on any URL — yours, a competitor's, every page in your sitemap — and get a structured report on the citation signals AI engines look for.

```bash
npx auto-geo@latest doctor https://example.com/some-page
```

```text
auto-geo doctor — GEO citation readiness audit
fetched https://example.com/some-page (1,247 words)

✓ TL;DR present (52 words, in range)
✗ Question-format H2 headings (2 of 6 are question-format; SOP §3 targets all)
✓ Article JSON-LD present (Schema.org/Article JSON-LD found)
✗ FAQPage JSON-LD present (No FAQPage JSON-LD block detected)
✓ Entity density (12.3/1k words (49 entities in 1247 words))
✗ Image cadence (0 images for 1247 words (target ~2, 1 per 500 words))
✓ Answer-first first paragraph (96-word lede, leads with a declarative answer)
✓ No self-link in related guides (No self-links detected in related section)

Score: 5 / 8 checks pass — moderate GEO posture

Top 3 fixes (ranked by citation lift):
  1. Add a FAQPage JSON-LD block. Each Q is a citable extraction target.
  2. Convert 4 statement-form H2 headings to question form (the questions a user would ask an AI engine).
  3. Add 2 images with descriptive alt text (entity + context).

Generated by auto-geo doctor (https://github.com/shadowresearch/auto-geo)
Run on your other pages: npx auto-geo doctor <url>
Learn more about GEO: https://www.shadow.inc/resources/what-is-geo
```

Three modes:

```bash
# Single page
npx auto-geo doctor https://example.com/page

# Whole sitemap — mean score, lowest-scoring pages, most common failures
npx auto-geo doctor --site https://example.com/sitemap.xml

# JSON for CI / dashboards (schema in cli/types.ts)
npx auto-geo doctor https://example.com/page --json
```

Exit code: `0` if score ≥ 75%, `1` otherwise. Drop it into CI:

```bash
npx auto-geo doctor https://example.com/page && deploy
```

Use cases:

- **Audit your own page before deploy** — gate publishes on a CI run that fails on regressions in citation signals.
- **Audit a competitor's page** — see the exact citation gaps in a competitor's resource library.
- **Whole-site sweep** — point `--site` at your sitemap and surface the lowest-scoring pages first.
- **Dashboard integration** — `--json` returns a stable schema you can wire into Datadog, your internal admin, or your weekly GEO scorecard.

See [`docs/doctor.md`](./docs/doctor.md) for the full check reference, JSON schema, and programmatic API (`runDoctor`, `runSitemapDoctor`, `auditHtml`).

---

## `auto-geo write` — generate pages from queries

`auto-geo doctor` tells you whether a page is citation-ready. `auto-geo write` produces a page that already passes the audit. Give it your domain and the queries you want to be cited for; get back validated, publish-ready JSON files.

```bash
export OPENAI_API_KEY=sk-…   # or ANTHROPIC_API_KEY=… with --provider anthropic

npx auto-geo@latest write \
  --domain https://www.shadow.inc \
  --query "what is GEO" \
  --query "GEO vs SEO" \
  --query "how to get cited by ChatGPT" \
  --out ./resources
```

```text
auto-geo write — generate publish-ready resource pages from target queries
domain:   https://www.shadow.inc
queries:  3
provider: openai (gpt-4o-mini)

✓ "what is GEO"
  → ./resources/geo.json (validated, ~$0.06)
✓ "GEO vs SEO"
  → ./resources/geo-vs-seo.json (validated, ~$0.06)
✓ "how to get cited by ChatGPT"
  → ./resources/get-cited-chatgpt.json (validated, ~$0.06)

Total: 3 pages · 3 ok · ~$0.18 spent · 47s elapsed
```

Each JSON file is validated against the canonical [`resourcePublishSchema`](./core/schema.ts) — the same schema your publish endpoint enforces — so a successful write is guaranteed-publishable. POST them to your endpoint or commit them to your content store.

The system prompt encodes the [GEO SOP](./docs/sop.md) (TL;DR length, answer-capsule windows, banned superlatives, FAQ structure, related-guides count, …) and the soft heuristics from `auto-geo doctor` (question-format H2s, entity density ≥ 8/1k words, image cadence). The Vercel AI SDK's `generateObject` constrains output to the Zod schema; we re-validate with the canonical schema defense-in-depth and feed the issues back to the LLM as a bounded self-correction loop on failure.

```bash
# Try it before paying — shows the plan + cost estimate, no LLM calls
npx auto-geo write --domain https://example.com --query "what is X" --dry-run

# Multiple providers
npx auto-geo write --domain … --query … --provider anthropic --model claude-sonnet-4-6

# A whole batch from a file
echo "what is GEO\nGEO vs SEO\nhow do I rank in AI Overviews" > queries.txt
npx auto-geo write --domain https://example.com --queries-file queries.txt
```

See [`docs/write.md`](./docs/write.md) for the full flag reference, the system prompt, cost-model details, and the programmatic API (`runWrite`).

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

## API

The publish endpoint contract is described as an OpenAPI 3.1 document at [`openapi.yaml`](./openapi.yaml). It covers the two operations the reference adapters expose:

- `POST /api/resources/publish` — validate, persist, and revalidate a `ResourcePublishPayload`.
- `DELETE /api/resources/publish?slug={slug}` — remove a previously published resource.

The point isn't a hosted endpoint — there isn't one. The point is to give any HTTP client (Postman, Insomnia, ChatGPT Custom GPT Action, Claude with HTTP tools, your own typed client generator) a machine-readable description of the contract you're mounting in your own app via [`createNextHandlers`](./adapters/http/next.ts) or [`createHonoRouter`](./adapters/http/hono.ts). See [`docs/architecture.md`](./docs/architecture.md) for the architectural spec the schema enforces and [`docs/validation.md`](./docs/validation.md) for the hard-reject / soft-warning split.

---

## LLM-friendly

`auto-geo` is, in essence, a tool whose output is content meant to be cited by LLMs. So this repo eats its own dogfood — it's discoverable by AI agents and crawlers in the same ways it teaches you to make your own pages discoverable.

- [`llms.txt`](./llms.txt) — a curated index of the most important content in the repo, following the [llmstxt.org](https://llmstxt.org) convention. Hand the URL to any LLM and it gets a fast, structured map of the project.
- [`llms-full.txt`](./llms-full.txt) — the expanded variant. Inlines the README plus every substantive doc (concept, SOP, architecture, validation, storage adapters) into a single file so an LLM can ingest the whole project in one fetch.
- [`openapi.yaml`](./openapi.yaml) — machine-readable contract for the publish endpoint, usable by any HTTP-tool-aware AI client.
- **GitHub Pages site** at [shadowresearch.github.io/auto-geo](https://shadowresearch.github.io/auto-geo/) — every page advertises `llms.txt`, `llms-full.txt`, and `openapi.yaml` via `<link rel="alternate" type="text/plain">` tags in the `<head>`, emits JSON-LD `Article` markup, and carries a "Built with auto-geo" footer.

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
