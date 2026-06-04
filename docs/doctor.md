# auto-geo doctor

A built-in CLI for auditing any public webpage against the GEO citation-readiness checks codified in [the GEO SOP](./sop.md).

```bash
npx auto-geo doctor https://example.com/some-page
```

Designed as the shareable artifact for the `auto-geo` project: run it on any URL, get a structured report on whether the page is shaped for AI-search citation, and a ranked list of fixes if it isn't. Useful in CI (the binary exits non-zero when the page falls below 75%), useful as a one-shot competitive audit, useful as a sitemap-wide health check.

## Install

The CLI ships with the `auto-geo` package — no separate install step. Either invoke it through `npx` for one-shot use, or add `auto-geo` as a dependency and call `auto-geo doctor` from your scripts.

```bash
# One-shot
npx auto-geo@latest doctor https://example.com/page

# Installed locally
pnpm add auto-geo
pnpm exec auto-geo doctor https://example.com/page
```

Node `>=18.17` required (uses native `fetch` and `AbortController`).

## Usage

```text
auto-geo doctor <url>                Audit a single page
auto-geo doctor --site <sitemap>     Audit every URL in an XML sitemap
auto-geo doctor <url> --json         Emit machine-readable JSON
auto-geo doctor --help               Show help
```

Flags:

| Flag              | What it does                                                                              |
| ----------------- | ----------------------------------------------------------------------------------------- |
| `--json`          | Emit JSON conforming to the schema in `cli/types.ts` (`DoctorReport` or `SitemapReport`). |
| `--no-color`      | Disable ANSI colors even on a TTY.                                                        |
| `--max-pages N`   | Cap on URLs audited in `--site` mode. Default 100.                                        |
| `--concurrency N` | Concurrent fetches in `--site` mode. Default 5.                                           |

Exit code: `0` if score ≥ 75%, `1` otherwise. The sitemap variant uses the mean score across all successfully-fetched pages. This is intentionally usable in CI:

```bash
npx auto-geo doctor https://example.com/page && deploy
```

## What it checks

Each check returns one of three things: a clear pass, a clear fail, or a fail with a fix suggestion. The fix list is ranked by `citationImpactRank` — the SOP-derived ordering of which signals carry the largest measured citation lift.

| #   | Check                          | Source        | Pass threshold                                                                                                                                                                                       |
| --- | ------------------------------ | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | TL;DR present                  | SOP §5j       | 40–60 words in the lead chunk (or under an explicit `TL;DR:` label).                                                                                                                                 |
| 2   | Question-format H2 headings    | SOP §3        | ≥80% of H2s end in `?`.                                                                                                                                                                              |
| 3   | Article JSON-LD present        | SOP §13       | Any `<script type="application/ld+json">` declares `@type: Article` (or a known subtype: `NewsArticle`, `BlogPosting`, `TechArticle`, `Report`, `ScholarlyArticle`). `@graph` children are searched. |
| 4   | FAQPage JSON-LD present        | SOP §13 + §5f | Any LD block declares `@type: FAQPage`.                                                                                                                                                              |
| 5   | Entity density                 | SOP §5g       | ≥8 named entities per 1,000 words (heuristic: capitalized non-sentence-initial tokens).                                                                                                              |
| 6   | Image cadence                  | SOP §7b       | ≥1 `<img>` per 500 words (and at least 1 image total).                                                                                                                                               |
| 7   | Answer-first first paragraph   | SOP §6        | First `<p>` is 20–120 words and doesn't open with hedge phrases ("in this article we will…", "let's…", "welcome…").                                                                                  |
| 8   | No self-link in related guides | SOP §5d       | No anchor inside a section whose heading matches `/related/i` resolves to the audited page's URL.                                                                                                    |

The fix-ranking puts **missing FAQPage JSON-LD** at #1 because it costs little effort to add and unlocks an independent extraction surface (every Q is a citable target). **Missing TL;DR** is #2 because it sets the citable lede for the entire page. **Statement-form H2s** is #3 — high impact but more labor-intensive to fix.

The score is reported as a fraction (`4 / 8 checks pass`) and a posture label (`strong` / `good` / `moderate` / `weak` / `poor`) derived from the percentage. The same percentage drives the exit code.

## Sitemap mode

```bash
npx auto-geo doctor --site https://example.com/sitemap.xml
```

Fetches the sitemap (supports both `<urlset>` and `<sitemapindex>`), audits every URL, and returns an aggregate report showing:

- Mean score across all pages.
- The lowest-scoring pages, top 5 by default.
- The most-common failing checks across the corpus.
- URLs that failed to fetch or parse (separately recorded; the run does not halt).

Concurrency is bounded to 5 by default — polite to origins and keeps memory bounded for large sitemaps. Override with `--concurrency`. The hard URL cap (100 by default) prevents runaway audits; override with `--max-pages`.

## JSON output

`--json` returns a stable serialization conforming to the `DoctorReport` (single URL) or `SitemapReport` (sitemap mode) types in `cli/types.ts`. The shape is the contract — wire it into your own dashboards and CI gates. Sample:

```json
{
  "url": "https://example.com/page",
  "wordCount": 1247,
  "score": 4,
  "total": 8,
  "scorePct": 50,
  "checks": [
    {
      "id": "faqpage-jsonld",
      "name": "FAQPage JSON-LD present",
      "pass": false,
      "detail": "No FAQPage JSON-LD block detected",
      "fixSuggestion": "Add a FAQPage JSON-LD block. Each Q is a citable extraction target.",
      "citationImpactRank": 1,
      "sop": "§13"
    }
  ],
  "topFixes": [
    /* up to 3 failing checks, sorted by citationImpactRank */
  ],
  "generatedBy": "auto-geo doctor"
}
```

## How it parses pages

- `fetch` is the Node 18+ native `fetch` (no extra HTTP dep). UA is `auto-geo-doctor/1.0`. Redirects are followed. Timeout is 15s per page.
- HTML is parsed with [`linkedom`](https://github.com/WebReflection/linkedom) — pure JS, MIT, no native deps. We strip `<nav>`, `<footer>`, `<aside>`, `<header>`, landmark `role=banner|navigation|contentinfo|complementary` elements, `<script>`, `<style>`, `<noscript>`, and `<template>` before extracting body text. JSON-LD is captured before the strip pass.
- The "main content" root is the first `<main>`, `<article>`, or `[role='main']` element — falling back to `<body>` if none of those exist.

## Heuristic alignment with publish-time validation

The `namedEntityCount` heuristic powering the entity-density check is **ported verbatim** from `core/validation.ts` so that an audit against an `auto-geo`-published page returns the same entity count the publish pipeline computed. Keep them in lockstep when one changes — both functions reference SOP §5g.

The other heuristics translate the typed-payload audits in `core/validation.ts` to HTML-as-input equivalents: where `auditResource` inspects `payload.sections[].heading`, the CLI inspects extracted H2 text; where it inspects `payload.relatedGuides.items[].url`, the CLI inspects anchors in a heading-bounded "related" container.

## Programmatic use

Every layer is exported. If you want to embed the doctor in your own tool:

```ts
import {
  runDoctor,
  runSitemapDoctor,
  auditHtml,
  renderReport,
} from "auto-geo/cli";

const report = await runDoctor("https://example.com/page");
console.log(renderReport(report, { json: true }));
```

Or skip the network and feed HTML you already have:

```ts
import { auditHtml } from "auto-geo/cli";

const report = auditHtml("https://example.com/page", htmlString);
```

## Limitations

- English-only. The capitalization-based entity heuristic and the hedge-phrase regex assume English prose.
- Client-rendered pages: the CLI does not execute JavaScript. SPAs that render their content via client-side JS will look empty to the parser. SSR or pre-rendered pages work correctly.
- The "related guides" detector matches any heading whose text contains `related` (case-insensitive). Pages that use a different label for the related-content section will not trigger the self-link check.

## Related

- [The GEO SOP](./sop.md) — the substantive spec behind every threshold.
- [Validation reference](./validation.md) — the publish-time validator the CLI mirrors.
