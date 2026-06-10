---
title: Home
nav_order: 1
description: >-
  The open-source GEO (Generative Engine Optimization) engine — a CLI that
  audits, generates, fixes, and tracks the pages large language models cite.
permalink: /
---

# auto-geo

The open-source GEO engine — audit, generate, fix, and track the pages large language models cite.
{: .fs-6 .fw-300 }

[Get started](#quickstart){: .btn .btn-primary .fs-5 .mb-4 .mb-md-0 .mr-2 }
[View on GitHub](https://github.com/shadowresearch/auto-geo){: .btn .fs-5 .mb-4 .mb-md-0 }

---

When someone asks ChatGPT, Perplexity, Claude, Gemini, or Google AI Overviews a question your business should answer, do those engines cite **your** domain? `auto-geo` is the full loop for making that happen — and proving it's happening.

```
auto-geo init      # set up the system once
auto-geo doctor    # audit any page for citation readiness
auto-geo write     # generate publish-ready pages from target queries
auto-geo fix       # rewrite an existing page so it passes the audit
auto-geo check     # measure: do AI engines actually cite you?
auto-geo history   # track citation coverage over time
```

Everything is file-based and committable — tracked prompts, check history, config. No server, no account, no database.

## Quickstart

```bash
# 0. Install once (or run any command one-shot via `npx auto-geo@latest`)
npm i -g auto-geo

# 1. Set up — config, .env.local key slots, and the .auto-geo workspace
auto-geo init

# 2. Add an API key to .env.local (auto-loaded by every command)

# 3. Audit any page — yours or a competitor's
auto-geo doctor https://example.com/some-page

# 4. Track the prompts you want AI engines to cite you for
auto-geo prompts add "best media monitoring tools" "what is GEO"
#    …or let the engine propose them:
auto-geo prompts discover

# 5. Measure — every run is saved to history automatically
auto-geo check

# 6. Watch coverage move over time
auto-geo history
```

Node `>=18.17` required. Full walkthrough: [Commands](./commands).

## How it fits together

`doctor` measures **readiness** (is this page shaped for citation?). `check` measures **outcome** (is it actually being cited?). `history` turns the outcomes into a trend line, and `write`/`fix` close the gap the measurements expose.

|              |                                                                                              |
| :----------- | :------------------------------------------------------------------------------------------- |
| **Audit**    | [`doctor`](./doctor) scores any URL or sitemap against the 8 citation-readiness checks       |
| **Generate** | [`write`](./write) produces validated, publish-ready pages for the queries you want to win   |
| **Improve**  | [`fix`](./fix) rewrites an existing page to pass the audit                                   |
| **Measure**  | [`prompts`](./prompts) + [`check`](./check) run your tracked queries against real AI engines |
| **Track**    | [`history`](./history) shows coverage over time — what you newly won, what you lost          |

## Why pages need a specific shape

AI engines don't read pages — they extract chunks. The pages that win citations follow a strict architecture: a 40–60 word TL;DR, question-format H2 headings each opening with a self-contained answer capsule, dense named entities, FAQ schema, and structure-derived JSON-LD. The full rationale lives in the [GEO SOP](./sop); the enforced contract is the [page architecture](./architecture).

## Links

- **Repository** — [github.com/shadowresearch/auto-geo](https://github.com/shadowresearch/auto-geo)
- **Package** — [`auto-geo` on npm](https://www.npmjs.com/package/auto-geo)
- **Agents** — [AGENT.md](https://github.com/shadowresearch/auto-geo/blob/main/AGENT.md), the operating spec for coding agents driving the CLI
- **LLM-friendly** — [llms.txt](https://shadowresearch.github.io/auto-geo/llms.txt) · [llms-full.txt](https://shadowresearch.github.io/auto-geo/llms-full.txt)
- **License** — [MIT](https://github.com/shadowresearch/auto-geo/blob/main/LICENSE)

---

Built by [Shadow](https://www.shadow.inc) — a media research lab building the next generation of AI-powered media intelligence and communications technology, in partnership with the teams that put OpenAI, TikTok, Meta, Amazon, and Lovable on the map. Shadow runs `auto-geo` end-to-end at [shadow.inc/resources](https://www.shadow.inc/resources).
