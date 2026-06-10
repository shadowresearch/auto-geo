---
title: "GEO SOP"
parent: "Reference"
nav_order: 2
description: "The standard operating procedure behind every constraint the auto-geo schema enforces."
---

# The GEO SOP

The standard operating procedure for generative engine optimization resource pages.

This document is the substantive spec behind `auto-geo`'s schema and validation heuristics. Every word-count constraint in `cli/schema.ts` and every soft-warning threshold in `cli/checks.ts` traces back to a section here. Read this document before deviating from any rule the code enforces.

The SOP is calibrated to the public retrieval and citation behavior of major AI search engines (ChatGPT, Perplexity, Google AI Overviews, Google AI Mode, Claude, Gemini, Copilot) as of early 2026. Specific numerical thresholds (e.g., citation lift percentages, density ratios) are heuristic — they reflect the working consensus from internal experimentation and external GEO research. Treat them as starting points, not laws.

---

## §1. Definition

A **GEO resource page** is a public web page whose architecture, density, and metadata are engineered to be retrieved and quoted by large language models acting as search interfaces.

GEO is the successor to SEO. Where SEO optimized for keyword matching against an inverted index, GEO optimizes for citation by AI engines that answer questions on the user's behalf. The win condition is not a click — it is being quoted in the AI's answer, with the user's downstream click being a bonus.

---

## §2. The three optimization frameworks

A GEO resource page typically serves one or more of:

- **AEO** (Answer Engine Optimization) — Optimizes for direct quotation in answer-format responses (ChatGPT, Perplexity).
- **GEO** (Generative Engine Optimization) — Optimizes for inclusion in synthesized responses (Google AI Overviews, AI Mode).
- **LLMO** (Large Language Model Optimization) — Optimizes for inclusion in the underlying training and retrieval corpora of LLMs themselves.

A page can serve all three. `cli/schema.ts`'s `geoMetadata.optimizationFramework` field records which.

---

## §3. Question-format H2 headings

H2 headings are written as the questions a user would type into an AI engine, not as topic labels. Ideal length: 6-10 words.

**Wrong**: "Our approach to onboarding"
**Right**: "How does an effective onboarding process work?"

Rationale: AI engines retrieve against query intent. A page whose H2s mirror prompt phrasing is matched directly. A page whose H2s are internal labels requires the engine to synthesize a connection — synthesis costs the engine; direct matches are cheap.

`cli/checks.ts` flags H2s that don't contain `?` or are outside 4-12 words.

---

## §4. Page type and word-count targets

Five page types, each with calibrated word-count and density targets:

| Page type    | Min words | Max words | Min tables | Min lists | Stats/1k words |
| ------------ | --------- | --------- | ---------- | --------- | -------------- |
| `definitive` | 3000      | —         | 2          | 5         | 10             |
| `resource`   | 800       | 1500      | 0          | 3         | 3              |
| `comparison` | 1000      | 1500      | 1          | 3         | 3              |
| `category`   | 2000      | 4000      | 1          | 5         | 5              |
| `listicle`   | 1500      | 3000      | 1          | 5         | 3              |

- **Definitive**: The canonical answer to a query cluster. Long-form, dense, multi-entity. Target: be the page an AI engine quotes when asked "what is X."
- **Resource**: A focused, single-topic guide. Shorter, more focused. Target: be cited as one source among several in an answer.
- **Comparison**: "X vs Y" or "X alternatives." Tables are load-bearing; AI engines extract comparison tables directly. Title must match `vs.?|alternatives?|comparison` patterns (hard-validated).
- **Category**: An overview-style page that organizes a topic and links out to deeper pages. Drives entity-graph coverage.
- **Listicle**: "Top N X." High extractability; AI engines often quote individual list items verbatim.

`geoMetadata.pageType` selects the expectation set. `cli/checks.ts` surfaces soft warnings when page totals are outside the range.

---

## §5. Structural and quality rules

### §5a. Title formulas

Five title patterns map to the five page types. Use the formula that matches the page's intent:

- **How-to**: "How to [verb phrase]"
- **Definitive**: "What is [X]? The [N]-year guide to [domain]"
- **Category**: "[X]: Definition, types, and use cases"
- **Comparison**: "[A] vs [B]: [Differentiator]"
- **Listicle**: "[N] [things] for [audience] in [year]"

### §5b. Section and paragraph length

- Each H2 section (heading + answer capsule + blocks): 134-167 words ideal.
- Each paragraph: 60-100 words ideal (40-120 soft warning range).

Rationale: chunks at this length match the optimal extraction window for current retrieval models. Shorter chunks lack context; longer chunks dilute the answer signal.

### §5c. Outbound links

Each H2 section should contain 1-2 outbound links to authoritative non-self domains. Zero links flags as under-cited; more than 4 flags as aggregator content. Aggregator-style heavy linking carries a measured citation discount — AI engines prefer to cite primary sources, not link-dense intermediaries.

### §5d. Related Guides

4-8 entries. Self-links are explicitly forbidden (soft warning).

Related Guides are an entity-graph signal: they tell AI engines this page sits inside a coherent cluster of related content. The cluster signal lifts citation probability for every page in the cluster.

### §5e. Key Takeaways

4-6 declarative bullets. Each 10-35 words.

These are the page's claims, surfaced for extraction. AI engines often pull Key Takeaway bullets verbatim into answer responses.

### §5f. FAQ

3-10 Q&A items. Each answer 40-60 words.

The FAQ block drives `FAQPage` Schema.org markup, which is extracted by retrieval pipelines independently of the page body. FAQ items often appear in AI engine responses as direct quotations of the answer text.

### §5g. Entity density

15+ named entities per page (companies, people, products, frameworks, places).

The empirical link: entity-dense pages show ~4.8x higher citation probability than entity-sparse pages of similar length. Entity density is a credibility signal — pages that name specific actors are treated as more authoritative than pages that gesture at abstractions.

`cli/checks.ts` runs a simple heuristic (joined capitalized words after stripping inline markers and sentence-starters) and flags pages below 15.

### §5h. Banned promotional superlatives

The following phrases carry a measured citation penalty (~26%) when used without attribution:

- "industry-leading", "best-in-class", "revolutionary", "game-changing", "cutting-edge", "world-class", "world's leading", "the leading", "the premier", "next-generation", "first-of-its-kind", "one of a kind"

`cli/schema.ts` rejects these as **hard errors** unless:

- The phrase appears inside straight double-quotes (quoted passage).
- The phrase is followed within ~80 characters by an attribution marker: `(per ...)`, `(Source: ...)`, `[Named Source]`, or `by [Named Source]`.

Rationale: AI engines empirically downweight pages whose voice reads as marketing copy. The ban is a hard constraint, not a guideline.

### §5j. Mandatory page architecture

In order:

1. H1 + last-updated metadata
2. TL;DR (40-60 words)
3. Intro blocks
4. Sections (each: H2 + answer capsule + blocks)
5. Related Guides (4-8)
6. Key Takeaways (4-6)
7. FAQ (3-10)
8. About the Author (auto-injected)
9. Disclosure

The order is load-bearing. AI engines extract chunks; chunk position matters. TL;DR at top, FAQ near the bottom — this is the pattern retrieval pipelines are trained against.

---

## §6. The answer capsule

Every H2 section opens with a 40-60 word **answer capsule** — a fully self-contained answer to the section's heading, written before any supporting paragraph or block.

Rules:

- Must answer the section heading without requiring context from elsewhere on the page.
- No anaphora ("the above," "this," "we discussed").
- One main claim per capsule.
- 40-60 words, hard-enforced by `cli/schema.ts`.

The answer capsule is the highest-value chunk on the page. It is the most likely thing to be quoted verbatim by an AI engine. Every other block on the page exists to support the capsule.

---

## §7. Multimodal density

### §7a. Lists, tables, callouts

Lists and tables are extractable as structured data. The minimum-block-count targets in §4 force a baseline of structure per page.

### §7b. Images

Image cadence: ~1 image per 500 words. Each image's `alt` text must:

- Include the entity name being depicted.
- Include context (what the image shows in relation to the page topic).
- Be at least 20 characters. Generic alt ("chart", "image") is rejected.

Multimodal pages (text + images) show empirical citation lift of 156-317% over text-only pages of similar length. AI engines that ground their answers in retrieved pages preferentially cite pages with strong visual content.

---

## §8. Information gain

`geoMetadata.informationGainStatement` is a required field stating what the page contains that is **not in current AI engine responses** for its target queries.

Rationale: AI engines have an implicit novelty filter. Pages that restate what the engine can already synthesize from existing training data contribute nothing — they are not cited because they are not informative. Pages with proprietary data, original analysis, or first-party research provide information gain and are cited disproportionately.

Before publishing, articulate what makes this page non-redundant. If the answer is "nothing," the page should not exist.

---

## §13. Schema.org markup

Derived mechanically from the typed payload by the host renderer — the agent never writes JSON-LD by hand. Five schema types map directly from structured fields:

- **Article** — page metadata, author, publisher, dates, citations
- **BreadcrumbList** — Home → Resources → page title
- **FAQPage** — drives FAQ extraction
- **Person** — author identity, drives author-graph signals
- **ImageObject** — per image block

JSON-LD is rendered inside `<script type="application/ld+json">` tags, with text safely escaped via `safeJsonLd` to prevent breakout.

---

## §14. GEO metadata

`geoMetadata` is internal metadata stored on the published payload but not rendered to the page. Fields:

- `targetQueries` (1-20) — the query cluster the page is optimized for.
- `pageType` — drives expectations per §4.
- `primaryFunction` — one-sentence statement of what GEO function this page closes.
- `optimizationFramework` — AEO / GEO / LLMO.
- `targetPlatforms` — chatgpt / perplexity / google_aio / google_ai_mode / claude / gemini / copilot.
- `informationGainStatement` — per §8.
- `proprietaryAssetOpportunity` — optional. Any calculator, template, or asset that bridges citation → click-through.
- `refreshCadence` — monthly or quarterly.

The metadata is what makes a page auditable after publication. A team can run a regular audit asking "is this page still surfacing for its target queries, and if not, why."

---

## §15. Refresh cadence

GEO resource pages decay. The query landscape shifts as AI engines update their training and retrieval pipelines; the answers AI engines synthesize without your page also evolve over time, eroding your information gain.

Two cadences:

- **Monthly** — for pages serving fast-moving queries (current events, product comparisons, AI tooling, regulation).
- **Quarterly** — for pages serving stable queries (definitions, evergreen how-to, foundational explainers).

`geoMetadata.refreshCadence` records the page's cadence. A separate audit pipeline (out of scope for `auto-geo`'s core) reads the metadata and surfaces pages due for refresh.

---

## Maintenance

This SOP is versioned with `auto-geo`. When the empirical thresholds in `cli/checks.ts` change, update the corresponding section here. The intent is that this document and the code stay in lockstep — reading the SOP should always tell you what the code is doing and why.

External GEO research is rapidly evolving. Treat specific numerical claims (e.g., "4.8x citation lift") as snapshots, not eternal truths.
