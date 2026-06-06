# Changelog

All notable changes to `auto-geo` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The schema in `core/schema.ts` and the `ContentStore` interface in `core/store.ts` are the public APIs. Breaking changes to either bump the major version. Loosening a schema constraint or adding an optional field is a minor version. Patches fix bugs without changing the API surface.

## [Unreleased]

## [0.5.1] — 2026-06-05

### Fixed

- **`auto-geo write` / `fix` no longer crash against OpenAI.** The Vercel AI SDK converts our Zod schema to JSON Schema (via `zod-to-json-schema`), which emits `format: "uri"` for every `z.string().url()` field. OpenAI's Responses API + structured output (`response_format: { type: "json_schema", strict: true }`) only accepts a narrow allowlist of format hints and rejects `"uri"` — so every `write` and `fix` call against `--provider openai` failed at schema-validation time with `Invalid schema for response_format 'response': … 'uri' is not a valid format` before any LLM invocation. The schema is now sanitized before being passed to `generateObject`: deep-walk the generated JSON Schema, strip every `format` not on OpenAI's allowlist (`date-time`, `time`, `date`, `duration`, `email`, `hostname`, `ipv4`, `ipv6`, `uuid`). URL validity is still enforced — we re-validate the model's output against the strict original `resourcePublishSchema` (which keeps `.url()`), and the existing self-correction loop re-prompts on schema-parse failure. Applied for every provider, not just OpenAI, since the sanitized schema is smaller and more portable across SDKs.

### Test coverage

- 476 → 488 tests (+12): every URL field's `format` stripped, allowlisted formats preserved, original Zod schema unmutated.

### Notes

- `zod-to-json-schema` is now an explicit `dependencies` pin (was transitive via the AI SDK). CLI binary delta < 1 KB.

## [0.5.0] — 2026-06-05

### Added

- **`auto-geo check --format <auto-geo|geo-audit>`** — output-shape flag. Default `auto-geo` keeps the v0.4.x shape byte-stable. `geo-audit` maps each per-query result to the `LlmQueryResult` shape from Shadow's internal `geoAudit` agent tool (fields: `prompt`, `provider`, `model`, `responseText`, `citations`, `fanOutQueries`, `inputTokens`, `outputTokens`, `reasoningTokens`, `moneySpent`, `webSearchEnabled`, `datetime`, `error`). Provider name maps `openai → chatgpt` to match. Under `--json --format geo-audit` the output is an object `{ rows, summary }`; under `--ndjson --format geo-audit` each line is one `GeoAuditRow` and the final `_summary` line carries both summaries. Makes `auto-geo check` a drop-in for any downstream consumer expecting that shape.
- **Fan-out query capture** — each per-query result now carries `fanOutQueries: string[]` — the search queries the LLM internally expanded the user prompt into. Captured from every engine that exposes them:
  - Perplexity (`response.search_queries[]` on newer Sonar variants)
  - OpenAI (`web_search_call.action.query` from Responses API output items)
  - Anthropic (`server_tool_use.input.query` blocks named `web_search`)
  - Gemini (`groundingMetadata.webSearchQueries[]`)
  - xAI: not exposed by their public response shape; field is `[]` with an in-code comment.
- 450 → 476 tests (+26).

### Changed

- **Default `--concurrency` bumped from 6 to 12** for `check`. Perplexity Sonar Pro accounts handle this comfortably; existing exponential-backoff retry on 429 catches anyone hitting per-account caps. Users on restrictive accounts can lower; users on high-tier accounts can raise.
- **Per-engine concurrency pools under `--engine all`** — each engine now gets its own concurrency-N worker pool executing in parallel across engines (5 engines × 12 = up to 60 in-flight requests, each respecting its own engine's rate limit). A 50-query × 5-engine run drops from ~3.5 min (v0.4.2) to ~40s (v0.5.0) of API time.

### Notes

- Native APIs only — no DataForSEO. Each engine adapter speaks directly to its provider's HTTP API.
- Default output shape (no `--format` flag) is byte-stable apart from the new `fanOutQueries: string[]` field on each result. Additive, doesn't break existing JSON consumers.

## [0.4.2] — 2026-06-05

### Added

- **`auto-geo --version` / `-v`** — prints `auto-geo v0.4.2` and exits. Avoids the npx-cache mystery where users see stale behavior and don't know which version they're actually running.
- **`auto-geo help <command>`** — alias for `auto-geo <command> --help` (common convention; matches `git help <cmd>`, `npm help <cmd>`).

### Changed

- **Help redesign.** The old 120-line `USAGE` blob is gone. Now:
  - **`auto-geo`** (no args) → clean global help: branded header with version, one-line description per command, and pointers to per-command help.
  - **`auto-geo <cmd> --help`** → focused per-command help. Required / queries / engines / performance / output / env vars / examples / exit code — sectioned, only that command's flags.
  - **`auto-geo <cmd>`** without required args → short error + `Run 'auto-geo <cmd> --help' to see available flags.` (exit 2). No more whole-blob dump.
  - **Width-resilient rendering** — flag descriptions wrap with hanging indent that stays aligned with the description column even on narrow terminals. ANSI escapes applied AFTER wrapping so escape sequences never break the wrap math. Fixes the prior glitches where help text showed `--doin <d>` (wrapped "domain") and `--author-nametext>` (wrapped "name <text>").
- **New `cli/help.ts`** — content-as-data model (each command's help is structured data; the renderer walks it). Easier to maintain, easier to test.

### Test coverage

- 411 → 450 tests (+39): help rendering, width handling at 60 columns (regression for the wrap glitches), ANSI-absence in plain mode, version format, all routing paths (`--help`, `-h`, `help`, `help <cmd>`, `<cmd> --help`, `<cmd> -h`, `--version`, `-v`, bare).

## [0.4.1] — 2026-06-04

### Added

- **`auto-geo check` shows the LLM's answer alongside citations.** New `--answers <none|preview|full>` flag (default `preview` — first ~3 sentences, ~400 chars, word-wrapped under each query with a `│ ` blockquote prefix). `full` renders the entire response, `none` matches v0.4.0 behavior. The answer was always captured in JSON output; it's now visible in human mode too — the most interesting signal alongside the citation list because it shows HOW each engine represents the domain.
- **`--ndjson` streaming output for check.** Emits one JSON line per query as it completes (in completion order, not request order), plus a final `_summary` line. Designed for agents driving long runs: pipe to `jq` for live progress, `tail -n 1 | jq` for the rollup. Mutually exclusive with `--json` (one is per-line stream, one is single object). Per-line shape: `{ query, cited, citations, rawSources, answer, usage, timestamp, error? }`.
- **`--timeout-per-query <seconds>` flag** (default 60s). Outer timeout per query; sits above adapter HTTP timeouts; aborted queries become `error: "timed out after Ns"` and the rest of the run continues.
- **`--max-runtime <seconds>` flag** (optional). Whole-run timeout. When tripped, remaining queries are marked `error: "skipped — max runtime exceeded"` and process exits 2. CI-friendly cap.
- **Exponential-backoff retry on 429/5xx/network/timeout** — 2 attempts max, 1s then 4s. 4xx errors never retried (those are config bugs that won't fix themselves).
- **Live progress to stderr in human mode** — `[12/50] ✓ "what is GEO" — cited (3 sources)` per query as they complete. Stderr keeps stdout pipe-clean for piping the report.
- 389 → 411 tests (+22).

### Changed

- **Default `--concurrency` for check bumped from 2 to 6.** Safe for every engine's documented rate limit at default models. The flag stays — lower for restrictive accounts, raise for high-tier API plans.
- Help text in `--help` USAGE block now documents every check flag including the new ones.

### Why

A peer agent driving auto-geo for a 50-prompt sweep timed out repeatedly even when splitting to 25, 10, and 5 batches. Root causes: low default concurrency (2), no streaming output (silent during the long run), no per-query timeout, and no progress signal. With concurrency 6 + NDJSON + per-query timeout, a 50-query run on Perplexity now completes in roughly `(50 × ~8s) / 6 = ~67s` instead of timing out.

## [0.4.0] — 2026-06-04

### Added — four new `auto-geo check` engines + `--engine all` rollup

The citation-coverage CLI now spans every major AI search surface. Pick an engine by env var; one query against five engines for a complete picture of who's citing your domain across the AI landscape.

- **OpenAI** — `--engine openai`. OpenAI Responses API with the `web_search_preview` tool. Default model `gpt-4o-mini`. Reads `OPENAI_API_KEY`.
- **Anthropic** — `--engine anthropic`. Claude Messages API with the `web_search_20250305` tool (override via `--tool-type` for Opus 4.6+ dynamic filtering). Default model `claude-sonnet-4-5`. Reads `ANTHROPIC_API_KEY`.
- **Gemini** — `--engine gemini`. Google Gemini API with the `google_search` grounding tool. Default model `gemini-2.5-flash`. Reads `GOOGLE_API_KEY` (fallback `GEMINI_API_KEY`). Wrapper redirect URIs from grounding metadata are retained as the canonical citation alongside a derived destination URL so `--domain` matching actually fires.
- **xAI (Grok)** — `--engine xai` (alias `--engine grok`). xAI chat completions API with `search_parameters: { mode: "on", return_citations: true }`. Default model `grok-2-latest`. Reads `XAI_API_KEY`.
- **`--engine all`** — fans out across every engine whose env var is set; skips others with a labelled reason. Two roll-up metrics: **union coverage** (fraction of queries cited by ≥1 engine) and **mean coverage** (average solo coverage). Per-query matrix in human output, full `MultiEngineCheckReport` in `--json`.
- 345 → 389 tests (+44): 8 per new engine adapter + 12 for the multi-engine rollup, per-engine failure isolation, and dispatcher dispatch paths.

### Notes

- Zero new runtime dependencies — all engines are plain `fetch()`.
- Per-engine cost tracking: token charges from each provider's `usage` field plus per-search flat fees (OpenAI $0.025, Anthropic $0.01, Gemini $0.035, xAI $0.025 — verify against each provider's current pricing).
- One smoke test against `shadow.inc` for 5 queries across all 5 engines = ~$0.10–0.20 total.

## [0.3.0] — 2026-06-04

### Changed

- **CLI output redesigned across `doctor`, `fix`, `write`, `check`.** Branded `◆ auto-geo <cmd>  ╶╴  <tagline>` header. Two-space body indent. Aligned status-mark / name / detail columns (max name width computed once and padded). `▸ Score` / `▸ Coverage` arrow callouts for headline numbers with posture label in muted gray. Dim footer block with divider, `auto-geo <cmd> · github.com/shadowresearch/auto-geo`, and re-run hint. Color only on status marks: green `✓`, red `✗`, yellow `!`. ASCII fallback (`[OK]`, `[FAIL]`, `[WARN]`, `>`, `-`) when stdout isn't a TTY or `--no-color` is passed — keeps CI logs and piped output clean. `--narrow` flag (auto-detected under 80 columns) for tighter rendering. JSON output unchanged.
- New shared `cli/ui.ts` module with `paint`, `glyphs`, `header`, `divider`, `rows`, `bulletList`, `footer` building blocks so future commands inherit the visual language.
- 306 → 345 tests (+39): 30 ui.ts + 9 structural assertions across the existing renderer tests.

### Notes

- Zero new runtime dependencies (no chalk / picocolors / yoctocolors / boxen — the hand-rolled `paint` helper covers the surface).
- JSON output byte-for-byte unchanged; downstream dashboards aren't affected.

## [0.2.3] — 2026-06-04

### Fixed

- **`auto-geo doctor` TL;DR meta-mention false anchor** — when a page's metaDescription or H1 enumerates the architecture and includes the string `"TL;DR, intro, …"` mid-list, the previous regex anchored on that meta reference instead of the real TL;DR block. Tightened to `TL;?DR[:\s]*(?=[A-Z])` so the match requires the next character to be a capital letter — comma/period meta references fail the lookahead and the regex skips to the next occurrence (the actual TL;DR). Falls back to the lenient pattern if no strict match exists. Observed in production on `shadow.inc/resources/structuring-pages-for-ai-citation`, which was reporting 72 words on a 55-word TL;DR.

## [0.2.2] — 2026-06-04

### Fixed

- **`auto-geo doctor` TL;DR label matcher** — when a renderer emits `<p>TL;DR</p>` immediately followed by the TL;DR body in a sibling `<p>` (the common HTML pattern), linkedom's `textContent` joins the two with NO whitespace: `"TL;DRGenerative…"`. The previous regex required `[:\s]+` after the label, missed the real TL;DR, and instead anchored on a later mid-prose mention of "TL;DR" — capturing unrelated content and reporting 80 words on a 50-word TL;DR. Switched the separator to `[:\s]*` so the first occurrence anchors correctly regardless of inter-element whitespace. Doctor now scores correctly-architected pages 7/8 instead of 5/8.

## [0.2.1] — 2026-06-04

### Fixed

- **`auto-geo doctor` TL;DR check** — multi-sentence labelled TL;DRs were over-counted when adjacent `<p>` elements concatenated without whitespace (`linkedom`'s `textContent` doesn't insert spaces at element boundaries, so `"…end of TL;DR.Next paragraph…"` defeated the `[.!?]\s+` sentence split). The split now also terminates on a period followed by an uppercase letter, recovering the real sentence boundary. Also collects the first three sentence chunks rather than just the first, so canonical 40–60 word multi-sentence TL;DRs report correctly instead of under-counting.
- **`auto-geo doctor` question-format H2 check** — the page-architecture H2s the renderer emits (`Related Guides`, `Key Takeaways`, `Frequently Asked Questions`, `About the Author`, `Disclosure`, `References`, `Citations`, `Table of Contents`) are now excluded from the ratio. They're page furniture, not extractable content questions; counting them against the score penalized correctly-architected pages with 6 of 9 instead of 6 of 6.
- Spotted by running doctor against fresh `auto-geo write`-generated pages on shadow.inc/resources, which scored a misleading 5/8 due to these two false positives.

### Test coverage

- +4 tests pinning the multi-sentence-TL;DR fix, the cross-paragraph sentence-boundary fix, the structural-H2 exclusion, and case-insensitive structural matching. 300 → 304.

## [0.2.0] — 2026-06-04

### Added — three new CLI commands forming a closed loop with `doctor`

- **`auto-geo write` CLI** — `npx auto-geo write --domain <url> --query <q> [--query <q>...] --out <dir>` generates one publish-ready `ResourcePublishPayload` JSON per target query. Each file is validated against `resourcePublishSchema` before write; on schema failure the LLM is re-prompted with Zod issues as feedback (default 2 retries). Supports `--provider openai|anthropic`, `--model`, `--queries-file`, `--basepath`, `--author-*`, `--concurrency`, `--dry-run`, and `--json`. Cost estimation per provider/model from the SDK's `usage` field. Reads `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` from env. See [docs/write.md](./docs/write.md).
- **`auto-geo fix` CLI** — `npx auto-geo fix <url>` generates a GEO-optimized rewrite of any public webpage. Orchestrates fetch → doctor audit → LLM generation → Zod validation → disk write. The doctor report + source page text are passed in as LLM context so the rewrite specifically targets the failing checks. Same flags + env vars as `write`, plus a projected "after" doctor score. Article + FAQPage JSON-LD pass by construction once the payload is published — the renderer auto-emits them. See [docs/fix.md](./docs/fix.md).
- **`auto-geo check` CLI** — `npx auto-geo check --domain <domain> --query <q>` measures whether AI search engines actually cite your domain for given queries. Calls a real grounded-search API per (query, engine) pair, normalizes citations across engines, and reports coverage (`N/M queries cited`), per-page rank, and estimated cost. Exits `0` if coverage > 0%, `1` if 0% — CI-friendly. Perplexity Sonar adapter ships full end-to-end (`PERPLEXITY_API_KEY`); OpenAI adapter is scaffolded as a stub with the `url_citation` parser in place; `--engine all` reserved. Domain matching is case-insensitive, strips `www.`, matches subdomains via suffix. See [docs/check.md](./docs/check.md).
- **`cli/llm.ts`** — shared Vercel AI SDK helper exporting `generateResourcePayload`, `getLanguageModel`, `GEO_SYSTEM_PROMPT`, `estimateGenerationCostUsd`. Used by both `write` and `fix`. Provider-agnostic — currently `openai` and `anthropic`. New runtime deps: `ai`, `@ai-sdk/openai`, `@ai-sdk/anthropic`.

### Changed

- **`auto-geo doctor` network errors** are now agent-readable and actionable. Raw HTTP status strings replaced with one-line cause hypotheses: 401/403 → bot detection / WAF / auth wall (+ sandbox-egress hint), 404 → page doesn't exist, 429 → rate-limited, 5xx → server error, `AbortError` → timeout, `ENOTFOUND` → DNS, `ECONNREFUSED` → connection refused, generic `fetch failed` → sandbox egress hypothesis. Reported by a peer Claude instance running doctor against shadow.inc from an egress-restricted sandbox.

### Test coverage

- 190 → 300 tests (+110): 37 write, 30 fix, 39 check, 4 doctor error-message specs.

## [0.1.3] — 2026-06-03

### Added

- **`auto-geo doctor` CLI** — new `npx auto-geo doctor <url>` command audits any public page for GEO citation readiness across 8 heuristics (TL;DR, question-format H2s, Article + FAQPage JSON-LD, entity density, answer-first lede, image cadence, self-link detection). Supports `--site <sitemap-url>` for whole-site audits and `--json` for CI integration. Exits 0 if score ≥ 75%. Ships as the `auto-geo` bin; `linkedom` is bundled into the binary so the CLI works standalone via `npx auto-geo@latest doctor`.
- **Cloudflare Workers HTTP adapter** — new `auto-geo/cloudflare` subpath exporting `createCloudflareHandlers` (compose with your own `fetch`) and `createCloudflareFetch` (one-line default export). Uses only the Fetch API — no Node imports, no Cloudflare SDK dependency. Reads the bearer token from the Workers `env` argument at request time and maps publish/delete results to the same HTTP status contract as the Next.js and Hono adapters. Optional `onSuccess` hook for cache invalidation.
- `examples/cloudflare-workers/` — minimal Worker app with `wrangler.toml`, both integration styles, in-memory store seeded with one valid payload, and a sample `curl` for the canonical smoke-test payload.
- **Discoverability infrastructure**: `/llms.txt` + `/llms-full.txt` at the repo root following the [llmstxt.org](https://llmstxt.org) convention (regenerable via `pnpm discovery:build`); `/openapi.yaml` OpenAPI 3.1 spec for the publish + delete endpoints mirroring the Next.js adapter; GitHub Pages docs site under `docs/` (Jekyll, Cayman theme) — every page emits `<link rel="alternate" type="text/plain" href="…llms.txt">`, Article JSON-LD, and a "Built with auto-geo by Shadow" footer.
- README header badges for the docs site URL and `llms.txt` availability.
- README `API` and `LLM-friendly` sections.
- 89 new tests across CLI heuristics, Cloudflare adapter, and discoverability infra. 101 → 190 total.

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

[Unreleased]: https://github.com/shadowresearch/auto-geo/compare/v0.5.1...HEAD
[0.5.1]: https://github.com/shadowresearch/auto-geo/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/shadowresearch/auto-geo/compare/v0.4.2...v0.5.0
[0.4.2]: https://github.com/shadowresearch/auto-geo/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/shadowresearch/auto-geo/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/shadowresearch/auto-geo/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/shadowresearch/auto-geo/compare/v0.2.3...v0.3.0
[0.2.3]: https://github.com/shadowresearch/auto-geo/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/shadowresearch/auto-geo/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/shadowresearch/auto-geo/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/shadowresearch/auto-geo/compare/v0.1.3...v0.2.0
[0.1.3]: https://github.com/shadowresearch/auto-geo/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/shadowresearch/auto-geo/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/shadowresearch/auto-geo/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/shadowresearch/auto-geo/releases/tag/v0.1.0
