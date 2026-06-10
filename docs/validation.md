# Validation reference

`auto-geo` enforces two layers of validation: **hard rejects** at the schema boundary and **soft quality heuristics** audited by `auto-geo doctor`.

The split is deliberate: structure is a contract; quality is a continuum.

## Hard rejects

Hard rejects come from the resource schema (`cli/schema.ts`, Zod). When `auto-geo write` or `auto-geo fix` generates a payload that violates a constraint below, the payload is rejected with a `{ path, message }` issue list and regenerated via the bounded self-correction retry loop (`--max-retries`, default 3).

### Identity

| Field             | Constraint                                              |
| ----------------- | ------------------------------------------------------- |
| `slug`            | Lowercase letters, numbers, single hyphens. 1-80 chars. |
| `title`           | 1-160 chars.                                            |
| `metaTitle`       | Optional. 1-160 chars.                                  |
| `metaDescription` | 50-180 chars.                                           |
| `category`        | 1-80 chars.                                             |
| `excerpt`         | 50-400 chars.                                           |

### Authoring

| Field                | Constraint                                            |
| -------------------- | ----------------------------------------------------- |
| `author.name`        | 1-120 chars.                                          |
| `author.jobTitle`    | 1-120 chars.                                          |
| `author.bio`         | 20-600 chars.                                         |
| `author.linkedinUrl` | Valid URL (optional).                                 |
| `publishedAt`        | ISO `yyyy-mm-dd`.                                     |
| `modifiedAt`         | ISO `yyyy-mm-dd` (optional). Must be ≥ `publishedAt`. |

### Body architecture

| Field                      | Constraint                                                |
| -------------------------- | --------------------------------------------------------- |
| `tldr.text`                | 40-60 words. No banned superlatives.                      |
| `intro.blocks`             | 1-10 content blocks.                                      |
| `sections`                 | 1-40 sections.                                            |
| `sections[].heading`       | 1-200 chars. No raw HTML. No banned superlatives.         |
| `sections[].answerCapsule` | 40-60 words. No banned superlatives.                      |
| `sections[].blocks`        | 0-40 content blocks.                                      |
| `relatedGuides.items`      | 4-8 entries. Each `{ title, url }`. URL must be absolute. |
| `keyTakeaways.items`       | 4-6 bullets. Each 10-35 words. No banned superlatives.    |
| `faq.items`                | 3-10 items.                                               |
| `faq.items[].question`     | 5-300 chars.                                              |
| `faq.items[].answer`       | 40-60 words. No banned superlatives.                      |
| `disclosure.text`          | 20-1000 chars. No raw HTML. No banned superlatives.       |

### Content blocks

| Block type  | Constraints                                                           |
| ----------- | --------------------------------------------------------------------- |
| `paragraph` | `text` 1-2000 chars. Inline syntax only.                              |
| `h3`        | `text` 1-200 chars.                                                   |
| `list`      | `style` ∈ `{bullet, number}`. 2-30 items. Each item 1-1000 chars.     |
| `table`     | 2-10 columns. 1-50 rows. Every row has exactly one cell per header.   |
| `quote`     | `text` 1-1000 chars. `attribution` 1-200 chars.                       |
| `image`     | `src` valid URL. `alt` 20-300 chars. `caption` ≤300 chars (optional). |
| `callout`   | `variant` ∈ `{info, stat}`. `text` 1-600 chars.                       |

### GEO metadata (SOP §14)

| Field                                     | Constraint                                                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `geoMetadata.targetQueries`               | 1-20 strings, each 3-200 chars.                                                                   |
| `geoMetadata.pageType`                    | `definitive` ∣ `resource` ∣ `comparison` ∣ `category` ∣ `listicle`.                               |
| `geoMetadata.primaryFunction`             | 5-300 chars.                                                                                      |
| `geoMetadata.optimizationFramework`       | Non-empty subset of `{AEO, GEO, LLMO}`.                                                           |
| `geoMetadata.targetPlatforms`             | Non-empty subset of `{chatgpt, perplexity, google_aio, google_ai_mode, claude, gemini, copilot}`. |
| `geoMetadata.informationGainStatement`    | 20-600 chars.                                                                                     |
| `geoMetadata.proprietaryAssetOpportunity` | ≤600 chars (optional).                                                                            |
| `geoMetadata.refreshCadence`              | `monthly` ∣ `quarterly`.                                                                          |

### Cross-field

- If `pageType === "comparison"`, `title` should match `/\bvs\.?\b|\balternatives?\b|\bcomparison\b/i`. Rejected if it doesn't.
- `modifiedAt` must be ≥ `publishedAt`.

### Banned promotional superlatives

The following phrases are rejected when they appear _outside_ a quoted passage AND _without_ an attribution marker (`per`, `by`, `according to`, `source:`, or a `[Named Source]` / `(Named Source)` within ~80 chars):

`industry-leading`, `industry leading`, `best-in-class`, `best in class`, `revolutionary`, `game-changing`, `game changing`, `cutting-edge`, `cutting edge`, `world-class`, `world class`, `world's leading`, `worlds leading`, `the leading`, `the premier`, `next-generation`, `next generation`, `first-of-its-kind`, `one of a kind`.

See SOP §5h for the rationale (measured citation penalty).

## Soft quality heuristics

Soft heuristics surface SOP guidance that is too noisy to enforce as hard errors. They never block generation; `auto-geo doctor` audits live pages against the same signals (entity density, question-format H2s, image cadence, answer-first ledes) and ranks the fixes by citation lift.

### Per-section

| Path                        | Trigger                                                    | SOP |
| --------------------------- | ---------------------------------------------------------- | --- |
| `sections[N].totalWords`    | Section (heading + capsule + blocks) outside 134-167 words | §5b |
| `sections[N].heading`       | Heading outside 4-12 words                                 | §3  |
| `sections[N].heading`       | Heading does not contain `?`                               | §3  |
| `sections[N].blocks[M]`     | Paragraph or callout outside 40-120 words                  | §5b |
| `sections[N].outboundLinks` | Zero outbound external links                               | §5c |
| `sections[N].outboundLinks` | More than 4 outbound external links                        | §5c |

### Page-level

| Path                     | Trigger                                      | SOP |
| ------------------------ | -------------------------------------------- | --- |
| `totalWords`             | Page below `pageType.minWords`               | §4  |
| `totalWords`             | Page above `pageType.maxWords`               | §4  |
| `statisticsDensity`      | Statistics density below page-type threshold | §7  |
| `entityDensity`          | Fewer than 15 named entities                 | §5g |
| `listCount`              | Fewer list blocks than page-type minimum     | §7  |
| `tableCount`             | Fewer tables than page-type minimum          | §7  |
| `imageCadence`           | Images below `floor(total / 500)`            | §7b |
| `relatedGuides.items[N]` | Self-link in Related Guides                  | §5d |

### Acting on heuristics

Heuristics never block a `write`/`fix` run. The loop:

1. **Ship as-is.** Appropriate when the flags are low-severity or you have reason to override (e.g., a short listicle that legitimately has fewer lists than the threshold).
2. **Iterate.** Publish the page, run `auto-geo doctor <url>`, and address the ranked fixes. Re-run until the score clears your CI gate (default 75%).
3. **Verify.** `auto-geo check` measures whether the improved page actually earns citations; `auto-geo history` shows the trend.
