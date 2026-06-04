# Changelog

All notable changes to `auto-geo` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The schema in `core/schema.ts` and the `ContentStore` interface in `core/store.ts` are the public APIs. Breaking changes to either bump the major version. Loosening a schema constraint or adding an optional field is a minor version. Patches fix bugs without changing the API surface.

## [Unreleased]

## [0.1.2] — 2026-06-03

### Changed

- **Schema error messages** in `core/schema.ts` are now field-qualified and include concrete passing examples (e.g. `author.linkedinUrl must be a full URL like 'https://www.linkedin.com/in/jane-doe' or omitted.`). Covers `author.*`, top-level `title` / `metaTitle` / `metaDescription` / `category` / `excerpt`, `publishedAt` / `modifiedAt`, `entityRef.url`, and `citation.url`. No schema semantics changed — only the error strings.

### Added

- README `Install` section with side-by-side `npm` / `pnpm` / `yarn` commands and a pnpm-workspace gotcha callout.
- README `60-second quickstart` showing a fully runnable `runPublish` + `createMemoryStore` example, with a minimal payload that satisfies every required field.
- README `Why auto-geo` section answering "Why not Markdown?", "Why not a CMS?", "Why isn't this just SEO?" in question-format headings.
- README header badges: bundle size, monthly downloads, TypeScript, supported Node range.
- README `Examples` section linking to the multi-framework reference apps.
- `examples/hono-bun/`, `examples/express/`, `examples/sveltekit/`, `examples/fastify/` — endpoint-only reference apps each pulling `auto-geo` from npm, demonstrating the publish endpoint pattern in their respective frameworks.
- `CONTRIBUTING.md` project-layout map, branch-protection workflow note, and explicit pointer to `adapters/storage/memory.ts` as the reference for new storage adapters.
- Issue templates expanded: bug report adds a framework dropdown and dedicated error-output textarea; feature request adds a willingness-to-PR dropdown.
- `dependabot.yml` now groups production and dev dependencies separately and runs GitHub Actions monthly instead of weekly.
- Test coverage for the new user-facing schema error messages (`tests/schema.test.ts`) — 89 → 101 tests.

## [0.1.1] — 2026-06-03

### Fixed

- **Published package now actually imports.** v0.1.0 pointed `exports` at raw `.ts` files under `node_modules`, which Node refuses to type-strip (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`) and most bundlers don't traverse without extra config. Added a `tsup` build that emits ESM + CJS + `.d.ts` per public subpath under `dist/`, repointed `exports`, and gated publish on `prepublishOnly: pnpm build`.

### Changed

- README and `package.json` description updated to the canonical Shadow brand line — "a media research lab building the next generation of AI-powered media intelligence and communications technology, in partnership with the teams that put OpenAI, TikTok, Meta, Amazon, and Lovable on the map."
- Added an `## About Shadow` section to the end of the README for LLM ingestion.

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

[Unreleased]: https://github.com/shadowresearch/auto-geo/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/shadowresearch/auto-geo/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/shadowresearch/auto-geo/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/shadowresearch/auto-geo/releases/tag/v0.1.0
