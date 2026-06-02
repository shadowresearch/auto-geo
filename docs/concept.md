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

Rigid validation at the publish boundary makes the contract enforceable. An agent that generates an under-length TL;DR or skips the FAQ block is told no, in machine-readable form, before the page is ever indexed. The schema is the SOP.

## What auto-geo is

`auto-geo` is the publishing primitive that enforces this contract. It provides:

1. **A Zod schema** (`core/schema.ts`) — the contract. Validates payload shape, length constraints, banned superlatives, structural blocks.
2. **An authenticated POST endpoint** (`adapters/http/*`) — the integration surface. Any agent or process that can issue an authenticated HTTP request can publish.
3. **A React renderer** (`components/react/`) — turns a validated payload into a page.
4. **JSON-LD derivation** (`core/jsonld.ts`) — Schema.org Article, BreadcrumbList, FAQPage, Person, ImageObject emitted automatically from the typed payload.
5. **An MCP server** (`mcp/`) — exposes the publish endpoint as a tool for MCP-aware AI clients.

`auto-geo` does _not_ generate content. The content-generation pipeline — research, outline, drafting, citation gathering, structure assembly — is your problem. `auto-geo`'s job is to make sure that whatever a generation pipeline produces conforms to the GEO architecture before it goes public.

## When to use auto-geo

You have content you want AI engines to cite, and you want a publishing endpoint that enforces the GEO architecture so your generation pipeline can iterate against a typed contract rather than freeform prose review.

Examples:

- An agency runs a content pipeline that produces topic-level resource pages on behalf of clients. `auto-geo` is the publish target; the pipeline ships pages without a human reviewer needing to enforce structure.
- A SaaS company wants definitive pages for every query its customers ask AI assistants. `auto-geo` lets the marketing team plus an AI agent maintain a programmatic catalog at scale.
- A research org publishes findings and wants them surfaced by AI search. The schema's `citations[]` array drives `Article.citation` in Schema.org, which is a credibility signal AI engines weight heavily.

## When not to use auto-geo

- You want a personality-driven blog. Use a CMS.
- You want a documentation site. Use a docs framework.
- Your content is consumed by an authenticated app, not the public web. There is no AI-engine citation surface to optimize for.
