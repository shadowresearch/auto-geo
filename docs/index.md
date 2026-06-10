---
layout: default
title: auto-geo
description: >-
  The open-source GEO (Generative Engine Optimization) engine — a CLI that
  audits, generates, fixes, and tracks the pages large language models cite.
  Open-source (MIT), built by Shadow.
---

# auto-geo

> The open-source GEO engine — audit, generate, fix, and track the pages
> large language models cite. Built by [Shadow](https://www.shadow.inc),
> a media research lab building the next generation of AI-powered media
> intelligence and communications technology, in partnership with the
> teams that put OpenAI, TikTok, Meta, Amazon, and Lovable on the map.

`auto-geo` is a command-line engine for **Generative Engine
Optimization** — making your pages the ones AI search engines (ChatGPT,
Perplexity, Google AI Overviews, Claude, Gemini) quote when they answer
a user's question.

One workflow, file-based and committable:

```
auto-geo init      # set up the system once
auto-geo doctor    # audit any page for citation readiness
auto-geo write     # generate publish-ready pages from target queries
auto-geo fix       # rewrite an existing page so it passes the audit
auto-geo check     # measure: do AI engines actually cite you?
auto-geo history   # track citation coverage over time
```

- **Repository**: [shadowresearch/auto-geo](https://github.com/shadowresearch/auto-geo)
- **Package**: [`auto-geo` on npm](https://www.npmjs.com/package/auto-geo)
- **License**: [MIT](https://github.com/shadowresearch/auto-geo/blob/main/LICENSE)

## Read this first

- **[README](https://github.com/shadowresearch/auto-geo#readme)** —
  quickstart and the full workflow.
- **[What is a GEO resource page?](./concept)** — the architecture, why
  it differs from a blog post.
- **[GEO SOP](./sop)** — the substantive standard operating procedure
  behind every constraint the engine enforces. The five page types, the
  seven-block architecture, the answer-capsule pattern, the banned
  superlatives, information gain, and refresh cadence.

## Command reference

- **[init](./init)** — one-shot setup: config, `.env.local`, and the
  `.auto-geo/` workspace.
- **[doctor](./doctor)** — audit any URL (or a whole sitemap) for
  citation readiness.
- **[write](./write)** — generate publish-ready resource pages from
  target queries.
- **[fix](./fix)** — LLM-driven GEO rewrite of an existing page.
- **[prompts](./prompts)** — manage the tracked prompt set that `check`
  runs by default.
- **[check](./check)** — measure citation coverage across AI engines.
- **[history](./history)** — citation coverage over time.

## Architecture reference

- **[Page architecture](./architecture)** — the seven mandatory blocks
  in order, every content-block type, and the inline-syntax spec.
- **[Validation reference](./validation)** — every hard reject and soft
  warning the schema enforces.

## LLM-friendly

This site emits an [`llms.txt`](https://shadowresearch.github.io/auto-geo/llms.txt)
following the [llmstxt.org](https://llmstxt.org) convention, plus an
[`llms-full.txt`](https://shadowresearch.github.io/auto-geo/llms-full.txt)
that inlines the README + concept + SOP + architecture + validation docs
into a single ingestible bundle. Every page in this site also advertises
both files via `<link rel="alternate" type="text/plain">` in the
`<head>` so well-behaved crawlers and AI agents discover them
automatically.
