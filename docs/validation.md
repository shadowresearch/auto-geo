# Validation reference

`auto-geo` enforces two layers of validation: **hard rejects** at the schema boundary (HTTP 400) and **soft warnings** in the success response (HTTP 200 with `warnings[]`).

The split is deliberate: structure is a contract; quality is a continuum.

## Hard rejects (HTTP 400)

Hard rejects come from `core/schema.ts` (Zod). Every constraint listed below returns 400 with a `{ error, issues: [{ path, message }] }` body.

### Identity

| Field | Constraint |
|---|---|
| `slug` | Lowercase letters, numbers, single hyphens. 1-80 chars. |
| `title` | 1-160 chars. |
| `metaTitle` | Optional. 1-160 chars. |
| `metaDescription` | 50-180 chars. |
| `category` | 1-80 chars. |
| `excerpt` | 50-400 chars. |

### Authoring

| Field | Constraint |
|---|---|
| `author.name` | 1-120 chars. |
| `author.jobTitle` | 1-120 chars. |
| `author.bio` | 20-600 chars. |
| `author.linkedinUrl` | Valid URL (optional). |
| `publishedAt` | ISO `yyyy-mm-dd`. |
| `modifiedAt` | ISO `yyyy-mm-dd` (optional). Must be ≥ `publishedAt`. |

### Body architecture

| Field | Constraint |
|---|---|
| `tldr.text` | 40-60 words. No banned superlatives. |
| `intro.blocks` | 1-10 content blocks. |
| `sections` | 1-40 sections. |
| `sections[].heading` | 1-200 chars. No raw HTML. No banned superlatives. |
| `sections[].answerCapsule` | 40-60 words. No banned superlatives. |
| `sections[].blocks` | 0-40 content blocks. |
| `relatedGuides.items` | 4-8 entries. Each `{ title, url }`. URL must be absolute. |
| `keyTakeaways.items` | 4-6 bullets. Each 10-35 words. No banned superlatives. |
| `faq.items` | 3-10 items. |
| `faq.items[].question` | 5-300 chars. |
| `faq.items[].answer` | 40-60 words. No banned superlatives. |
| `disclosure.text` | 20-1000 chars. No raw HTML. No banned superlatives. |

### Content blocks

| Block type | Constraints |
|---|---|
| `paragraph` | `text` 1-2000 chars. Inline syntax only. |
| `h3` | `text` 1-200 chars. |
| `list` | `style` ∈ `{bullet, number}`. 2-30 items. Each item 1-1000 chars. |
| `table` | 2-10 columns. 1-50 rows. Every row has exactly one cell per header. |
| `quote` | `text` 1-1000 chars. `attribution` 1-200 chars. |
| `image` | `src` valid URL. `alt` 20-300 chars. `caption` ≤300 chars (optional). |
| `callout` | `variant` ∈ `{info, stat}`. `text` 1-600 chars. |

### GEO metadata (SOP §14)

| Field | Constraint |
|---|---|
| `geoMetadata.targetQueries` | 1-20 strings, each 3-200 chars. |
| `geoMetadata.pageType` | `definitive` ∣ `resource` ∣ `comparison` ∣ `category` ∣ `listicle`. |
| `geoMetadata.primaryFunction` | 5-300 chars. |
| `geoMetadata.optimizationFramework` | Non-empty subset of `{AEO, GEO, LLMO}`. |
| `geoMetadata.targetPlatforms` | Non-empty subset of `{chatgpt, perplexity, google_aio, google_ai_mode, claude, gemini, copilot}`. |
| `geoMetadata.informationGainStatement` | 20-600 chars. |
| `geoMetadata.proprietaryAssetOpportunity` | ≤600 chars (optional). |
| `geoMetadata.refreshCadence` | `monthly` ∣ `quarterly`. |

### Cross-field

- If `pageType === "comparison"`, `title` should match `/\bvs\.?\b|\balternatives?\b|\bcomparison\b/i`. Rejected if it doesn't.
- `modifiedAt` must be ≥ `publishedAt`.

### Banned promotional superlatives

The following phrases are rejected when they appear *outside* a quoted passage AND *without* an attribution marker (`per`, `by`, `according to`, `source:`, or a `[Named Source]` / `(Named Source)` within ~80 chars):

`industry-leading`, `industry leading`, `best-in-class`, `best in class`, `revolutionary`, `game-changing`, `game changing`, `cutting-edge`, `cutting edge`, `world-class`, `world class`, `world's leading`, `worlds leading`, `the leading`, `the premier`, `next-generation`, `next generation`, `first-of-its-kind`, `one of a kind`.

See SOP §5h for the rationale (measured citation penalty).

### Reserved slugs (HTTP 409)

Slugs in `reservedSlugs` (configured per deployment) collide with statically routed pages in the host app. Publishing them returns 409.

## Soft warnings (HTTP 200, `warnings[]`)

Soft warnings come from `core/validation.ts` (`auditResource`). They surface SOP heuristics that are too noisy to enforce as hard errors but worth flagging for an iterating agent.

### Per-section

| Path | Trigger | SOP |
|---|---|---|
| `sections[N].totalWords` | Section (heading + capsule + blocks) outside 134-167 words | §5b |
| `sections[N].heading` | Heading outside 4-12 words | §3 |
| `sections[N].heading` | Heading does not contain `?` | §3 |
| `sections[N].blocks[M]` | Paragraph or callout outside 40-120 words | §5b |
| `sections[N].outboundLinks` | Zero outbound external links | §5c |
| `sections[N].outboundLinks` | More than 4 outbound external links | §5c |

### Page-level

| Path | Trigger | SOP |
|---|---|---|
| `totalWords` | Page below `pageType.minWords` | §4 |
| `totalWords` | Page above `pageType.maxWords` | §4 |
| `statisticsDensity` | Statistics density below page-type threshold | §7 |
| `entityDensity` | Fewer than 15 named entities | §5g |
| `listCount` | Fewer list blocks than page-type minimum | §7 |
| `tableCount` | Fewer tables than page-type minimum | §7 |
| `imageCadence` | Images below `floor(total / 500)` | §7b |
| `relatedGuides.items[N]` | Self-link in Related Guides | §5d |

### Acting on warnings

The publish endpoint always returns 200 with warnings — they never block publication. The calling agent can:

1. **Ship as-is.** Surface warnings to the user; treat the page as published. Appropriate when warnings are low-severity or the agent has reason to override (e.g., a short listicle that legitimately has fewer lists than the threshold).
2. **Iterate.** Modify the payload to address the warnings and re-POST. The publish endpoint is idempotent on slug — republishing overwrites.

The MCP server forwards the full warnings array back to the calling AI client, which can drive the iteration loop autonomously.
