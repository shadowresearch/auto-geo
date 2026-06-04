# Page architecture

> The HTTP contract that enforces this architecture is described in machine-readable form at [`openapi.yaml`](../openapi.yaml) — drop it into Postman, Insomnia, or a ChatGPT Custom GPT Action to call the publish endpoint against your own deployment.

A GEO resource page is composed of seven blocks, in fixed order:

1. **TL;DR** — 40-60 word answer capsule
2. **Intro** — ≥1 content blocks
3. **Sections** — ≥1 H2 with a 40-60 word answer capsule + content blocks
4. **Related Guides** — 4-8 entries
5. **Key Takeaways** — 4-6 declarative bullets
6. **FAQ** — 3-10 Q&A items with 40-60 word answers
7. **Disclosure** — sourcing note, timestamp, publisher line

The host renderer also auto-injects:

- **Metadata line** — "Last updated · By [author]" above the TL;DR.
- **About the Author** — derived from `author.bio`, between FAQ and disclosure.

Every block is validated at the publish boundary. Omissions return 400 with a Zod issue list.

## The seven blocks

### 1. TL;DR (`tldr`)

```json
{ "tldr": { "text": "40-60 word answer to the page's primary query." } }
```

Constraints: 40-60 words, no banned superlatives without attribution, no raw HTML.

Renders as a callout above the page body. Acts as the page-level answer capsule — the chunk an AI engine is most likely to quote when summarizing the page in a citation response.

### 2. Intro (`intro`)

```json
{ "intro": { "blocks": [ContentBlock, ...] } }
```

1-10 content blocks. No explicit answer capsule, but should orient the reader to what the page covers without restating the TL;DR.

### 3. Sections (`sections`)

```json
{
  "sections": [
    {
      "heading": "6-10 word H2 in question format",
      "answerCapsule": "40-60 word self-contained answer (renders as the first paragraph)",
      "blocks": [ContentBlock, ...]
    }
  ]
}
```

1-40 sections. Each section:

- **Heading**: 6-10 words ideal (4-12 hard range), question format. Soft warning if not a question. Question-format H2s match the way users phrase prompts to AI engines.
- **Answer capsule**: 40-60 words, self-contained. Must answer the section's heading without requiring context from elsewhere on the page. This is the load-bearing chunk.
- **Blocks**: 0-40 content blocks expanding on the answer.

Each section ideally totals 134-167 words (heading + capsule + blocks). Outside that range surfaces a soft warning.

### 4. Related Guides (`relatedGuides`)

```json
{
  "relatedGuides": {
    "items": [{ "title": "Other resource title", "url": "https://..." }]
  }
}
```

4-8 entries. URLs must be absolute. Self-links are rejected with a soft warning. Related guides are an entity-graph signal — they tell AI engines this page is part of a coherent cluster.

### 5. Key Takeaways (`keyTakeaways`)

```json
{
  "keyTakeaways": { "items": ["10-35 word declarative bullet", ...] }
}
```

4-6 items. Each 10-35 words. Declarative, not interrogative — these are the page's claims, surfaced for extraction.

### 6. FAQ (`faq`)

```json
{
  "faq": {
    "heading": "Optional override (default: 'Frequently Asked Questions')",
    "items": [
      { "question": "5-300 char question", "answer": "40-60 word answer" }
    ]
  }
}
```

3-10 Q&A items. The FAQ block drives `FAQPage` JSON-LD, which is a Schema.org type AI engines extract directly and often surface verbatim in answer responses.

### 7. Disclosure (`disclosure`)

```json
{ "disclosure": { "text": "Sourcing note, last-updated timestamp, etc." } }
```

20-1000 character disclosure. Use it for: how the page was assembled, who reviewed it, when it was last refreshed, whether AI assisted in drafting. Transparency is increasingly a citation signal.

## Content blocks

Both intro and sections accept a discriminated union of content blocks:

### `paragraph`

```json
{
  "type": "paragraph",
  "text": "60-100 word paragraph (ideal range; warning outside 40-120)."
}
```

One claim per paragraph. Inline syntax: `**bold**`, `*italic*`, `[label](url)`.

### `h3`

```json
{ "type": "h3", "text": "Subheading" }
```

### `list`

```json
{ "type": "list", "style": "bullet", "items": ["item 1", "item 2", ...] }
```

`style`: `"bullet"` or `"number"`. 2-30 items.

### `table`

```json
{
  "type": "table",
  "caption": "Optional caption",
  "headers": ["Col A", "Col B"],
  "rows": [
    ["a1", "b1"],
    ["a2", "b2"]
  ]
}
```

Every row must have one cell per header (validated). 2-10 columns; 1-50 rows.

### `quote`

```json
{
  "type": "quote",
  "text": "Quoted text",
  "attribution": "Required attribution"
}
```

### `image`

```json
{
  "type": "image",
  "src": "https://...",
  "alt": "Descriptive alt text with entity + context (≥20 chars).",
  "caption": "Optional caption"
}
```

The alt text minimum (20 chars) enforces SOP §7b's requirement that alt text includes entity name and context. Generic alt ("chart", "image of X") is rejected.

### `callout`

```json
{ "type": "callout", "variant": "info", "text": "..." }
```

`variant`: `"info"` or `"stat"`. Stat callouts are visually distinct (left border, accent fill) and intended for surface quantitative findings the agent wants AI engines to pick up.

## Inline syntax

Inside any prose field (`text`, `items[]`, `answer`, etc.):

- `**bold**` → `<strong>`
- `*italic*` → `<em>`
- `[label](url)` → link. URLs starting with `/` render as internal links (via the host's link component if provided); `https://` renders as external (`target="_blank"`).

No raw HTML. No code spans. No headings inside paragraphs. The schema rejects HTML; everything else is literal.

## Why this architecture

The architecture is calibrated to three empirical observations about how AI engines retrieve and quote web content:

1. **Self-contained chunks are quoted; embedded clauses are not.** Each answer capsule is fully self-contained — readable without context from the rest of the page. AI engines extract chunk-level, not document-level. Anaphora and "as discussed above" break extractability.
2. **Question-format headings match prompt format.** Users phrase prompts to AI engines as questions. Pages whose H2s mirror those question forms are retrieved as direct matches against query intent.
3. **Structured data (Schema.org) is over-weighted.** `Article`, `FAQPage`, and `BreadcrumbList` JSON-LD are extracted directly by retrieval pipelines, often before the page's main content is parsed. Schema markup is a citation amplifier.

The seven-block architecture is the smallest set of constraints that satisfies all three. Smaller (e.g., dropping Related Guides) weakens the entity-graph signal; larger (e.g., adding required citations) hampers iteration speed for content teams.

See `docs/sop.md` for the full standard operating procedure and the empirical basis for each constraint.
