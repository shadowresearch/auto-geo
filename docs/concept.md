# What is a GEO resource page?

A **GEO resource page** (Generative Engine Optimization resource page) is a public web page whose structure, density, and citation signals are engineered to be quoted verbatim by AI search engines (ChatGPT, Perplexity, Google AI Overviews, Claude, Gemini) when answering user queries.

It is a successor to the SEO landing page. Where SEO optimized for keyword matching against an inverted index, GEO optimizes for _retrieval and quotation_ by large language models that answer questions on the user's behalf.

## How a GEO resource page differs from a blog post

|                         | Blog post                     | GEO resource page                                         |
| ----------------------- | ----------------------------- | --------------------------------------------------------- |
| **Composition**         | Freeform prose                | Named, validated blocks                                   |
| **Opening**             | Hook or lede                  | 40-60 word TL;DR answer capsule                           |
| **H2 headings**         | Topic labels ("Our approach") | Questions a user would ask an AI ("How does X work?")     |
| **Section opening**     | Setup paragraph               | 40-60 word self-contained answer                          |
| **FAQ block**           | Optional                      | Mandatory, with strict word-count                         |
| **Entity density**      | Incidental                    | Engineered, ~15+ named entities                           |
| **Schema.org**          | Optional, often missing       | Article + BreadcrumbList + FAQPage + Person, auto-derived |
| **Voice**               | Personality, opinion          | Sourced claims, neutral register                          |
| **Optimization target** | Click-through from search     | Citation by an AI engine answering a query                |

## Why the structure is rigid

AI engines do not read pages; they _extract chunks_. The chunk most likely to be quoted is one that fully answers a question on its own — no anaphora, no "as we discussed above," no setup. The TL;DR + question-format H2 + answer-capsule pattern produces exactly that shape: every block is independently extractable.

Rigid validation makes the contract enforceable. A generation run that produces an under-length TL;DR or skips the FAQ block is told no, in machine-readable form, before the page ever ships. The schema is the SOP.

## What auto-geo is

`auto-geo` is the CLI engine that enforces — and closes the loop on — this contract. It provides:

1. **A strict Zod schema** (`cli/schema.ts`) — the contract. Validates payload shape, length constraints, banned superlatives, structural blocks.
2. **`auto-geo doctor`** — audits any public URL (or a whole sitemap) against the architecture's citation signals.
3. **`auto-geo write` / `auto-geo fix`** — generate new pages from target queries, or rewrite existing ones, with output constrained to the schema and a self-correction loop on violation.
4. **`auto-geo check`** — measures the outcome: do AI engines (Perplexity, ChatGPT, Claude, Gemini, Grok) actually cite your domain for the prompts you track?
5. **`auto-geo history`** — trends citation coverage over time from the saved check runs in `.auto-geo/checks/`.

`auto-geo` generates _page payloads_, not live pages. Rendering and hosting — your CMS, your framework, your pipeline — stay yours. `auto-geo`'s job is to make sure whatever ships conforms to the GEO architecture, and to prove whether it's working.

## When to use auto-geo

You have content you want AI engines to cite, and you want tooling that enforces the GEO architecture so your pipeline can iterate against a typed contract rather than freeform prose review — and that measures whether the citations actually materialize.

Examples:

- An agency runs a content pipeline that produces topic-level resource pages on behalf of clients. `auto-geo write` generates the pages, `doctor` gates them in CI, and `check` is the weekly client scorecard.
- A SaaS company wants definitive pages for every query its customers ask AI assistants. `auto-geo` lets the marketing team plus an AI agent maintain a programmatic catalog at scale.
- A research org publishes findings and wants them surfaced by AI search. The schema's `citations[]` array drives `Article.citation` in Schema.org, which is a credibility signal AI engines weight heavily.

## When not to use auto-geo

- You want a personality-driven blog. Use a CMS.
- You want a documentation site. Use a docs framework.
- Your content is consumed by an authenticated app, not the public web. There is no AI-engine citation surface to optimize for.
