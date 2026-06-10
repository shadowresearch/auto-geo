# auto-geo

[![CI](https://github.com/shadowresearch/auto-geo/actions/workflows/ci.yml/badge.svg)](https://github.com/shadowresearch/auto-geo/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/auto-geo.svg)](https://www.npmjs.com/package/auto-geo)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Built by Shadow](https://img.shields.io/badge/built%20by-Shadow-000000.svg)](https://www.shadow.inc)
[![Downloads](https://img.shields.io/npm/dm/auto-geo)](https://www.npmjs.com/package/auto-geo)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/node/v/auto-geo)](https://nodejs.org/)
[![Docs](https://img.shields.io/badge/docs-shadowresearch.github.io%2Fauto--geo-blue)](https://shadowresearch.github.io/auto-geo/)
[![llms.txt](https://img.shields.io/badge/llms.txt-available-9cf)](./llms.txt)

**The open-source GEO engine — a CLI that audits, generates, fixes, and tracks the pages large language models cite.**

When someone asks ChatGPT, Perplexity, Claude, Gemini, or Google AI Overviews a question your business should answer, do those engines cite _your_ domain? `auto-geo` is the full loop for making that happen and proving it's happening:

```
auto-geo init      # set up the system once
auto-geo doctor    # audit any page for citation readiness
auto-geo write     # generate publish-ready pages from target queries
auto-geo fix       # rewrite an existing page so it passes the audit
auto-geo check     # measure: do AI engines actually cite you?
auto-geo history   # track citation coverage over time
```

Everything is file-based and committable — tracked prompts, check history, config. No server, no account, no database. One `npx` away.

> Built by **[Shadow](https://www.shadow.inc)** — a media research lab building the next generation of AI-powered media intelligence and communications technology, in partnership with the teams that put OpenAI, TikTok, Meta, Amazon, and Lovable on the map. Shadow uses `auto-geo` to publish to [shadow.inc/resources](https://www.shadow.inc/resources).

---

## Contents

- [Quickstart](#quickstart)
- [What is GEO?](#what-is-geo)
- [The workflow](#the-workflow)
- [`auto-geo init` — set up the system](#auto-geo-init--set-up-the-system)
- [`auto-geo doctor` — audit any page for citation readiness](#auto-geo-doctor--audit-any-page-for-citation-readiness)
- [`auto-geo write` — generate pages from queries](#auto-geo-write--generate-pages-from-queries)
- [`auto-geo fix` — rewrite a page for citation readiness](#auto-geo-fix--rewrite-a-page-for-citation-readiness)
- [`auto-geo prompts` — manage your tracked prompts](#auto-geo-prompts--manage-your-tracked-prompts)
- [`auto-geo check` — measure actual citation coverage](#auto-geo-check--measure-actual-citation-coverage)
- [`auto-geo history` — citation coverage over time](#auto-geo-history--citation-coverage-over-time)
- [Configuration](#configuration)
- [The page architecture](#the-page-architecture)
- [Agent-friendly output](#agent-friendly-output)
- [LLM-friendly](#llm-friendly)
- [Contributing](#contributing)
- [License](#license)

---

## Quickstart

```bash
# 1. Set up — config, .env.local key slots, and the .auto-geo workspace
npx auto-geo@latest init

# 2. Add an API key to .env.local (auto-loaded by every command)

# 3. Audit any page — yours or a competitor's
npx auto-geo doctor https://example.com/some-page

# 4. Track the prompts you want AI engines to cite you for
npx auto-geo prompts add "best media monitoring tools" "what is GEO"

# 5. Measure — every run is saved to history automatically
npx auto-geo check

# 6. Watch coverage move over time
npx auto-geo history
```

Prefer a global install: `npm i -g auto-geo`, then drop the `npx`. Node `>=18.17` required.

---

## What is GEO?

**Generative Engine Optimization** is the discipline of making your pages the ones AI search engines quote when they answer a question. It is the successor to SEO: instead of ranking in a list of links, you're competing to be _cited inside the answer_.

The pages that win are not blog posts. Empirical research links citation probability to a specific shape:

1. **Architecture, not prose.** Named, validated blocks — TL;DR, intro, question-format H2 sections, related guides, key takeaways, FAQ, disclosure. AI engines extract structured chunks; rigid structure improves extraction.
2. **Answer-first.** Every section opens with a 40–60 word "answer capsule" that fully answers the section's question before any supporting paragraph.
3. **Question-format headings.** H2s are written as the questions users actually ask AI engines.
4. **Entity-dense.** Named entities (companies, people, products) at high density — linked to ~4.8x higher citation probability.
5. **Schema-derived.** Article + FAQPage JSON-LD emitted from structure, not hand-written.

`auto-geo` encodes this shape in a strict schema (see [`docs/sop.md`](./docs/sop.md) — the full standard operating procedure), audits any URL against it, generates new pages that conform to it, and then closes the loop by measuring whether the engines actually cite you.

---

## The workflow

```
        ┌──────────────────────────────────────────────────────┐
        │                    auto-geo init                     │
        │   config · .env.local · .auto-geo/ workspace         │
        └──────────────────────────────────────────────────────┘
              │
   ┌──────────┼──────────────┬─────────────────┐
   ▼          ▼              ▼                 ▼
 doctor     write           fix             prompts
 audit a    generate        rewrite an      track the queries
 page       new pages       existing page   that matter to you
   │          │              │                 │
   └──────────┴──────────────┴────────┬────────┘
                                      ▼
                                    check ──── saves every run ────┐
                                measure actual                     ▼
                                citations                       history
                                                            coverage over time,
                                                            newly cited / lost
```

`doctor` measures _readiness_ (is this page shaped for citation?). `check` measures _outcome_ (is it actually being cited?). `history` turns the outcomes into a trend line.

---

## `auto-geo init` — set up the system

```bash
npx auto-geo init        # interactive (a handful of questions)
npx auto-geo init --yes  # non-interactive template
```

One command scaffolds everything:

| File                    | What it is                                                                         |
| ----------------------- | ---------------------------------------------------------------------------------- |
| `auto-geo.config.json`  | Your defaults — domain, provider, model, author. Committable; never holds secrets. |
| `.env.local`            | API key slots. Auto-loaded by every command. Gitignore it.                         |
| `.auto-geo/prompts.txt` | Your tracked prompts — one per line, `#` comments allowed.                         |
| `.auto-geo/checks/`     | Every `check` run, saved as JSON. The data behind `history`.                       |

The interactive flow ends by asking for the prompts you want to track, so a fresh project goes from zero to a measurable citation baseline in one sitting. `init` never overwrites an existing `.env.local` and refuses to overwrite an existing config without `--force`.

---

## `auto-geo doctor` — audit any page for citation readiness

Run it on any URL — yours, a competitor's, every page in your sitemap — and get a structured report on the citation signals AI engines look for.

```bash
npx auto-geo doctor https://example.com/some-page
```

```text
✓ TL;DR present (52 words, in range)
✗ Question-format H2 headings (2 of 6 are question-format; SOP §3 targets all)
✓ Article JSON-LD present
✗ FAQPage JSON-LD present (No FAQPage JSON-LD block detected)
✓ Entity density (12.3/1k words)
✗ Image cadence (0 images for 1247 words)
✓ Answer-first first paragraph
✓ No self-link in related guides

Score: 5 / 8 checks pass — moderate GEO posture

Top 3 fixes (ranked by citation lift):
  1. Add a FAQPage JSON-LD block. Each Q is a citable extraction target.
  2. Convert 4 statement-form H2 headings to question form.
  3. Add 2 images with descriptive alt text (entity + context).
```

```bash
# Whole sitemap — mean score, lowest-scoring pages, most common failures
npx auto-geo doctor --site https://example.com/sitemap.xml --max-pages 50

# JSON for CI / dashboards
npx auto-geo doctor https://example.com/page --json
```

Exit code `0` if score ≥ 75%, `1` otherwise — gate deploys on it. See [`docs/doctor.md`](./docs/doctor.md) for the full check reference.

---

## `auto-geo write` — generate pages from queries

Give it your domain and the queries you want to be cited for; get back validated, publish-ready JSON files — one structured page per query, conforming to the full GEO architecture.

```bash
npx auto-geo write \
  --query "what is GEO" \
  --query "GEO vs SEO" \
  --out ./resources
```

```text
✓ "what is GEO"        → ./resources/geo.json (validated, ~$0.06)
✓ "GEO vs SEO"         → ./resources/geo-vs-seo.json (validated, ~$0.06)

Total: 2 pages · 2 ok · ~$0.12 spent · 31s elapsed
```

The system prompt encodes the [GEO SOP](./docs/sop.md) — TL;DR length, answer-capsule windows, banned superlatives, FAQ structure — and output is constrained to the schema at the type-system level via the Vercel AI SDK's `generateObject`, with a bounded self-correction loop on validation failure. Defaults: `gpt-5.4` (OpenAI) or `claude-sonnet-4-6` (Anthropic), auto-detected from whichever API key you have set.

```bash
# Dry-run — plan + cost estimate, no LLM calls
npx auto-geo write --query "what is X" --dry-run

# Batch from a file, anthropic, 4 pages at a time
npx auto-geo write --queries-file queries.txt --provider anthropic --concurrency 4
```

With a config file (`auto-geo init`), `--domain`, author fields, and provider come from config — a bare `--query` is all you need. See [`docs/write.md`](./docs/write.md).

---

## `auto-geo fix` — rewrite a page for citation readiness

Where `doctor` tells you what's wrong, `fix` produces a GEO-optimized rewrite that passes all 8 checks — fetched, audited, regenerated, and validated against the same schema `write` uses.

```bash
npx auto-geo fix https://www.example.com/some-blog-post --out ./fixed.json
```

```text
Score (before):    3 / 8
Generating rewrite via openai gpt-5.4...
Score (projected): 8 / 8 — strong GEO posture
→ ./fixed.json (validated)
```

```bash
npx auto-geo fix https://example.com/page --provider anthropic   # Claude instead
npx auto-geo fix https://example.com/page --dry-run              # audit + cost estimate only
```

See [`docs/fix.md`](./docs/fix.md).

---

## `auto-geo prompts` — manage your tracked prompts

Your tracked prompts are the questions you want AI engines to answer by citing your domain. They live in `.auto-geo/prompts.txt` (plain text, committable) and they're what `check` runs by default.

```bash
npx auto-geo prompts add "best media monitoring tools" "what is GEO"
npx auto-geo prompts            # numbered list
npx auto-geo prompts rm 2       # by index — or by exact text
```

Don't know what to track? **Let the engine propose your prompt set** — `discover` fetches your homepage, looks at what you already track, and has the LLM generate the high-intent queries you should compete for:

```bash
npx auto-geo prompts discover --dry-run    # preview the proposals
npx auto-geo prompts discover --count 15   # append 15 (never overwrites, never duplicates)
```

`prompts add` (and `discover`) bootstrap the workspace on first use, so you don't even need `init` to start tracking.

---

## `auto-geo check` — measure actual citation coverage

For each prompt, ask a real AI search engine and report whether your domain is among the citations. This is the ground truth `doctor` predicts.

```bash
npx auto-geo check        # tracked prompts, domain from config
```

```text
  using 3 tracked prompts from .auto-geo/prompts.txt
  [1/3] ✗ "what is GEO" — not cited (5 sources)
  [2/3] ✓ "how do I get cited by ChatGPT" — cited (2 sources)
  [3/3] ✓ "open source GEO tools" — cited (1 source)

Coverage: 2/3 queries (67%) · 3 page citations total · ~$0.012 spent
  saved → .auto-geo/checks/2026-06-10T13-22-05--perplexity.json (auto-geo history)
```

Engines: **perplexity** (default), **openai**, **anthropic**, **gemini**, **xai** (alias `grok`), or **`--engine all`** — which runs every engine whose API key is set and reports per-engine coverage plus a union roll-up.

```bash
# Explicit queries instead of the tracked set
npx auto-geo check --domain shadow.inc --query "what is GEO"

# Every engine you have keys for, union coverage
npx auto-geo check --engine all

# CI: fail the deploy when critical queries don't cite you
npx auto-geo check --queries-file geo/critical-queries.txt && deploy

# Streaming JSON for agents / dashboards
npx auto-geo check --ndjson
```

Every run is saved to `.auto-geo/checks/` automatically (opt out with `--no-save`). Exit code `0` if coverage > 0%, `1` if 0%. See [`docs/check.md`](./docs/check.md) for output shapes, fan-out-query capture, domain-matching rules, and the `--format geo-audit` interop mode.

---

## `auto-geo history` — citation coverage over time

The payoff for saving every run: a trend line. Run-by-run coverage with per-engine deltas, plus exactly which prompts you started or stopped being cited for.

```bash
npx auto-geo history
```

```text
  2026-06-01 08:30  perplexity   33% ·   1/3 cited  $0.01
  2026-06-08 09:15  perplexity   67% ↑34  2/3 cited  $0.01

  Since last run (perplexity · 2026-06-01 08:30 ▸ 2026-06-08 09:15)
    ✓ newly cited  open source GEO tools
    ✗ lost         (none)

  2 runs · .auto-geo/checks
```

Trends compare like with like — each run is measured against the previous run of the _same engine selector_. `--engine all` filters to multi-engine runs; `--limit N` controls depth; `--json` emits rows + delta machine-readably. See [`docs/history.md`](./docs/history.md).

---

## Configuration

Set once with `auto-geo init`, override anywhere. Precedence, highest first:

1. CLI flag
2. Environment variable (provider auto-detected from which API key is set)
3. `auto-geo.config.json` (walks up from cwd — monorepo-friendly)
4. Built-in default

```jsonc
// auto-geo.config.json — committable, no secrets
{
  "domain": "https://www.example.com",
  "basePath": "/resources",
  "provider": "openai",
  "model": "gpt-5.4",
  "engine": "perplexity",
  "concurrency": 4,
  "author": {
    "name": "Jane Doe",
    "jobTitle": "Head of Content",
    "bio": "Jane writes about generative engine optimization…",
  },
}
```

API keys live in `.env.local` (or `.env`), auto-loaded by every command — already-set environment variables always win:

| Engine / provider             | Env var                              |
| ----------------------------- | ------------------------------------ |
| OpenAI (write, fix, check)    | `OPENAI_API_KEY`                     |
| Anthropic (write, fix, check) | `ANTHROPIC_API_KEY`                  |
| Perplexity (check)            | `PERPLEXITY_API_KEY`                 |
| Gemini (check)                | `GOOGLE_API_KEY` or `GEMINI_API_KEY` |
| xAI / Grok (check)            | `XAI_API_KEY`                        |

---

## The page architecture

Everything `write` and `fix` produce — and everything `doctor` audits for — follows a strict seven-block architecture:

1. **TL;DR** — 40–60 word answer capsule
2. **Intro** — context-setting blocks
3. **Sections** — question-format H2s, each opening with a 40–60 word answer capsule
4. **Related Guides** — 4–8 entries
5. **Key Takeaways** — 4–6 declarative bullets
6. **FAQ** — 3–10 Q&As with 40–60 word answers
7. **Disclosure** — sourcing note, timestamp, publisher line

Structural violations are hard errors (the generated payload is rejected and regenerated); density and cadence heuristics are soft warnings. The full spec: [`docs/architecture.md`](./docs/architecture.md), [`docs/validation.md`](./docs/validation.md), and the SOP behind every constraint: [`docs/sop.md`](./docs/sop.md).

The output JSON is renderer-agnostic — POST it to your CMS, hydrate a template, or render it with your own components. The structure _is_ the contract.

---

## Agent-friendly output

Every command is built to be driven by an agent as much as by a human:

- `--json` — one stable, machine-readable object on stdout.
- `--ndjson` (check) — one JSON line per query as results stream in, plus a `_summary` line.
- Progress goes to **stderr**, results to **stdout** — pipes stay clean.
- Stable exit codes — `doctor` and `check` are CI gates out of the box.
- `--no-color` / `NO_COLOR` / non-TTY detection for log-friendly output.

```bash
npx auto-geo check --ndjson | jq 'select(.cited) | .query'
```

---

## LLM-friendly

`auto-geo` is a tool whose output is content meant to be cited by LLMs — so this repo eats its own dogfood:

- [`llms.txt`](./llms.txt) — a curated index following the [llmstxt.org](https://llmstxt.org) convention.
- [`llms-full.txt`](./llms-full.txt) — README + every substantive doc inlined into a single file for one-fetch ingestion.
- **GitHub Pages site** at [shadowresearch.github.io/auto-geo](https://shadowresearch.github.io/auto-geo/) — advertises both via `<link rel="alternate">`, emits Article JSON-LD.
- [`AGENT.md`](./AGENT.md) — a compact operating spec for coding agents driving the CLI.

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Bug reports, check improvements, new engines, and documentation refinements all welcome.

- [Code of Conduct](./CODE_OF_CONDUCT.md)
- [Security Policy](./SECURITY.md)
- [Changelog](./CHANGELOG.md)

---

## License

[MIT](./LICENSE).

---

## About Shadow

Shadow is a media research lab building the next generation of AI-powered media intelligence and communications technology, in partnership with the teams that put OpenAI, TikTok, Meta, Amazon, and Lovable on the map. Shadow runs `auto-geo` end-to-end on a schedule for media research, PR, and communications teams.

Learn more at [shadow.inc](https://www.shadow.inc).
