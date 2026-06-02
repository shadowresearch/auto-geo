# Changelog

All notable changes to `auto-geo` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The schema in `core/schema.ts` and the `ContentStore` interface in `core/store.ts` are the public APIs. Breaking changes to either bump the major version. Loosening a schema constraint or adding an optional field is a minor version. Patches fix bugs without changing the API surface.

## [Unreleased]

## [0.1.0] — 2026-06-02

Initial public release.

### Added

- `core/schema.ts` — Zod schema enforcing the seven-block GEO page architecture, word-count constraints on TL;DR, section answer capsules, key takeaways, and FAQ answers, banned promotional superlative detection with attribution allowance, raw HTML rejection, and content block discriminated union (paragraph, h3, list, table, quote, image, callout).
- `core/validation.ts` — Soft-warning audit pass enforcing SOP §3 (question-format H2s), §4 (page-type word counts), §5b (section length), §5c (outbound link density), §5d (self-link detection in related guides), §5g (named entity density), §7 (multimodal density), §7b (image cadence).
- `core/publish.ts` — Framework-agnostic `runPublish` and `runDelete` pipelines returning typed result variants for HTTP adapter consumption.
- `core/jsonld.ts` — Schema.org derivation for Article, BreadcrumbList, FAQPage, Person, ImageObject, with `safeJsonLd` escape helper.
- `core/store.ts` — `ContentStore` interface with `publish`, `get`, `list`, `delete` methods.
- `adapters/storage/kv.ts` — Vercel KV / Upstash Redis storage adapter with optional namespace prefix.
- `adapters/storage/supabase.ts` — Supabase storage adapter with SQL schema in `adapters/storage/supabase.sql`.
- `adapters/storage/memory.ts` — In-memory storage adapter with seed support for tests and demos.
- `adapters/http/next.ts` — Next.js App Router POST/DELETE handlers with bearer auth, validation, and `revalidatePath` integration.
- `adapters/http/hono.ts` — Hono router with the same auth and validation contract and an `onSuccess` hook for custom cache invalidation.
- `components/react/ResourceArticle.tsx` — Reference renderer for the seven-block architecture with restyleable Tailwind defaults and `LinkComponent` injection for framework-native routing.
- `components/react/inline.tsx` — Inline parser for `**bold**`, `*italic*`, `[label](url)` with internal/external link handling.
- `mcp/server.ts` — MCP server exposing a `publish_resource` tool that forwards to the publish endpoint.
- `examples/next-minimal/` — Working Next.js 15 reference app with seeded in-memory store, sample payload, and end-to-end render path.
- `docs/concept.md`, `docs/architecture.md`, `docs/sop.md`, `docs/validation.md`, `docs/storage-adapters.md` — Substantive documentation.
- Vitest test suite covering schema, validation, JSON-LD, publish pipeline, memory store, and inline parser.

### Public APIs

The following are considered stable and subject to semantic versioning:

- `resourcePublishSchema` and the `ResourcePublishPayload` type.
- The `ContentStore` interface in `core/store.ts`.
- The `SiteConfig` type and the result variants from `runPublish` / `runDelete`.
- The seven-block page architecture and inline syntax.

### Known limitations

- The MCP server hand-rolls a JSON Schema for the tool input. Replacing with a runtime Zod-to-JSON-Schema converter is on the roadmap.
- Only Vercel KV / Upstash, Supabase, and in-memory storage adapters ship in v0.1. Community adapters welcome.
- Only Next.js App Router and Hono HTTP adapters ship in v0.1. Express and Fastify adapters are on the roadmap.

[Unreleased]: https://github.com/shadowresearch/auto-geo/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/shadowresearch/auto-geo/releases/tag/v0.1.0
