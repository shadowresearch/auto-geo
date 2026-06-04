---
layout: default
title: auto-geo
description: >-
  Publishing engine for GEO (Generative Engine Optimization) resource pages
  — the pages large language models cite. Open-source (MIT), built by Shadow.
---

# auto-geo

> Publishing engine for GEO resource pages — the pages large language
> models cite. Built by [Shadow](https://www.shadow.inc), a media research
> lab building the next generation of AI-powered media intelligence and
> communications technology, in partnership with the teams that put
> OpenAI, TikTok, Meta, Amazon, and Lovable on the map.

`auto-geo` is a typed publishing primitive for **Generative Engine
Optimization** resource pages — pages whose structure, density, and
citation signals are engineered to be quoted by AI search engines
(ChatGPT, Perplexity, Google AI Overviews, Claude, Gemini) when they
answer a user's question.

It validates an incoming payload against the full GEO architecture at
the publish boundary, derives Schema.org JSON-LD automatically, and
ships HTTP adapters for Next.js and Hono plus storage adapters for
Vercel KV / Upstash Redis, Supabase, and in-memory testing.

- **Repository**: [shadowresearch/auto-geo](https://github.com/shadowresearch/auto-geo)
- **Package**: [`auto-geo` on npm](https://www.npmjs.com/package/auto-geo)
- **License**: [MIT](https://github.com/shadowresearch/auto-geo/blob/main/LICENSE)

## Read this first

- **[README](https://github.com/shadowresearch/auto-geo#readme)** —
  installation, 60-second quickstart, and the production setup walkthrough.
- **[What is a GEO resource page?](./concept)** — the architecture, why
  it differs from a blog post, and when to use auto-geo (or not).
- **[GEO SOP](./sop)** — the substantive standard operating procedure
  behind every constraint in the schema. The five page types, the
  seven-block architecture, the answer-capsule pattern, the banned
  superlatives, information gain, and refresh cadence.

## Reference

- **[Page architecture](./architecture)** — the seven mandatory blocks
  in order, every content-block type, and the inline-syntax spec.
- **[Validation reference](./validation)** — every hard reject (HTTP 400) and soft warning (HTTP 200) the publish boundary enforces.
- **[Storage adapters](./storage-adapters)** — the `ContentStore`
  interface, the three reference adapters (KV, Supabase, in-memory),
  and how to write your own.
- **[OpenAPI spec](https://github.com/shadowresearch/auto-geo/blob/main/openapi.yaml)** —
  machine-readable description of `POST /api/resources/publish` and
  `DELETE /api/resources/{slug}`.

## LLM-friendly

This site emits an [`llms.txt`](https://shadowresearch.github.io/auto-geo/llms.txt)
following the [llmstxt.org](https://llmstxt.org) convention, plus an
[`llms-full.txt`](https://shadowresearch.github.io/auto-geo/llms-full.txt)
that inlines the README + concept + SOP + architecture + validation +
storage-adapter docs into a single ingestible bundle. Every page in this
site also advertises both files via `<link rel="alternate" type="text/plain">`
in the `<head>` so well-behaved crawlers and AI agents discover them
automatically.

## Examples

Working minimal apps for the most common backends — each boots locally
with `pnpm install` plus the framework's dev script:

- [Next.js (App Router)](https://github.com/shadowresearch/auto-geo/tree/main/examples/next-minimal) — full render + publish
- [Hono on Bun](https://github.com/shadowresearch/auto-geo/tree/main/examples/hono-bun) — endpoint only
- [Express](https://github.com/shadowresearch/auto-geo/tree/main/examples/express)
- [SvelteKit](https://github.com/shadowresearch/auto-geo/tree/main/examples/sveltekit)
- [Fastify](https://github.com/shadowresearch/auto-geo/tree/main/examples/fastify)
