# auto-geo check

A built-in CLI for measuring whether AI search engines actually cite your domain. Where [`auto-geo doctor`](./doctor.md) grades a page's _structural readiness_ for citation, `auto-geo check` measures the _outcome_: for a given list of queries, do the engines surface your pages in their answers?

```bash
npx auto-geo check \
  --domain shadow.inc \
  --query "what is GEO" \
  --query "how do I get cited by ChatGPT" \
  --engine perplexity
```

This is the holy-grail metric for a GEO program: not "is my page optimized?", but "is my page actually being cited?". Use it as a CI gate, a weekly scorecard, or a one-shot competitive audit.

## Install

The CLI ships with the `auto-geo` package — no separate install step.

```bash
# One-shot
npx auto-geo@latest check --domain shadow.inc --query "what is GEO"

# Installed locally
pnpm add auto-geo
pnpm exec auto-geo check --domain shadow.inc --query "what is GEO"
```

Node `>=18.17` required.

## Setup — engine API keys

`check` calls real grounded-search APIs. Provision the key for the engine you want to use as an environment variable:

| Engine                 | Model default       | Env var                                | Pricing (approx)                       | How to get a key                            |
| ---------------------- | ------------------- | -------------------------------------- | -------------------------------------- | ------------------------------------------- |
| `perplexity` (default) | `sonar`             | `PERPLEXITY_API_KEY`                   | $1/M in · $1/M out · $0.005/req        | https://www.perplexity.ai/settings/api      |
| `openai`               | `gpt-4o-mini`       | `OPENAI_API_KEY`                       | $0.15/M in · $0.60/M out · $0.025/call | https://platform.openai.com/api-keys        |
| `anthropic`            | `claude-sonnet-4-5` | `ANTHROPIC_API_KEY`                    | $3/M in · $15/M out · $0.01/search     | https://console.anthropic.com/settings/keys |
| `gemini`               | `gemini-2.5-flash`  | `GOOGLE_API_KEY` (or `GEMINI_API_KEY`) | $0.075/M in · $0.30/M out · $0.035/req | https://aistudio.google.com/app/apikey      |
| `xai` (alias: `grok`)  | `grok-2-latest`     | `XAI_API_KEY`                          | $2/M in · $10/M out · $0.025/source    | https://console.x.ai                        |

Pricing columns are point-in-time mid-2026 estimates used for the `--json` cost surface; your provider invoice is the source of truth. If a model isn't in our internal lookup table the adapter falls back to a conservative per-tier default.

```bash
# Single-engine examples — one per provider.
export PERPLEXITY_API_KEY=pplx-xxxx
npx auto-geo check --domain shadow.inc --query "what is GEO" --engine perplexity

export OPENAI_API_KEY=sk-xxxx
npx auto-geo check --domain shadow.inc --query "what is GEO" --engine openai

export ANTHROPIC_API_KEY=sk-ant-xxxx
npx auto-geo check --domain shadow.inc --query "what is GEO" --engine anthropic

export GOOGLE_API_KEY=AIza-xxxx        # or GEMINI_API_KEY
npx auto-geo check --domain shadow.inc --query "what is GEO" --engine gemini

export XAI_API_KEY=xai-xxxx
npx auto-geo check --domain shadow.inc --query "what is GEO" --engine xai
# `--engine grok` is accepted as an alias for xai.
```

Keys are read at request time and never persisted. The CLI never logs them. If you ask for `--engine <name>` without its API key set, the run fails fast (exit 2) with an error naming the missing env var rather than emitting an opaque adapter error mid-run.

## Usage

```text
auto-geo check --domain <d> --query <q> [--query <q> ...]
auto-geo check --domain <d> --queries-file queries.txt
auto-geo check --domain <d> --query <q> --json
```

Flags:

| Flag                    | What it does                                                                                                                                        |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--domain <d>`          | Bare domain (`shadow.inc`) or full origin (`https://shadow.inc`). **Required.**                                                                     |
| `--query <text>`        | A single query. Repeatable — at least one `--query` or `--queries-file` is required.                                                                |
| `--queries-file <path>` | Newline-separated queries. `#` lines are treated as comments and skipped.                                                                           |
| `--engine <name>`       | One of `perplexity` (default), `openai`, `anthropic`, `gemini`, `xai` (alias: `grok`), or `all` (run every engine whose API key is present in env). |
| `--model <name>`        | Engine-specific model. Default `sonar` for Perplexity.                                                                                              |
| `--concurrency N`       | Parallel queries. Default 2. Higher → faster but more likely to hit engine rate limits.                                                             |
| `--json`                | Machine-readable JSON conforming to the `CheckReport` shape in `cli/check.ts`.                                                                      |
| `--out <path>`          | Also write the full JSON report to `<path>` (alongside whatever else gets printed).                                                                 |
| `--no-color`            | Disable ANSI colors even on a TTY.                                                                                                                  |

Exit code: `0` if coverage > 0% (any query cited your domain), `1` if coverage is 0%. CI-friendly:

```bash
npx auto-geo check --domain shadow.inc --queries-file critical-queries.txt && deploy
```

A `0%` coverage run will fail the build — surfacing GEO regressions before they ship.

## Example output

```text
auto-geo check — measure citation coverage in AI search engines
domain:    shadow.inc
queries:   3
engine:    perplexity (sonar)

[1/3] "what is GEO"
  ✗ shadow.inc NOT cited (5 sources: arxiv.org, searchengineland.com, …)

[2/3] "how do I get cited by ChatGPT"
  ✓ shadow.inc cited — 2 pages
    · https://www.shadow.inc/resources/get-cited-by-ai-search (rank 1 of 6)
    · https://github.com/shadowresearch/auto-geo (rank 4 of 6)

[3/3] "open source GEO tools"
  ✓ shadow.inc cited — 1 page
    · https://github.com/shadowresearch/auto-geo (rank 2 of 4)

Coverage: 2/3 queries (67%) · 3 page citations total · ~$0.012 spent

Next steps:
  - Audit the un-cited queries' targeted pages with `npx auto-geo doctor <url>`
  - Re-run `auto-geo check` after publishing new pages targeting uncited queries
```

## How it works per-engine

Each engine is a thin adapter under `cli/engines/<name>.ts` that talks to the provider's grounded-search API and normalizes the response into a common `CitedSource[]` shape. Adapters are independent — adding or swapping an engine never touches the orchestrator.

### Perplexity (`--engine perplexity`)

Uses Perplexity's [Chat Completions API](https://docs.perplexity.ai/api-reference/chat-completions) with `sonar` (or `sonar-pro`). Sonar performs grounded web search server-side and returns citations as a top-level array on the response. The adapter prefers the richer `search_results` field (carries titles) when present, falling back to the bare `citations` URL array.

Default model: `sonar`. Override with `--model sonar-pro` for the higher-quality (and more expensive) tier.

### OpenAI (`--engine openai`)

Uses the [Responses API](https://developers.openai.com/api/docs/guides/tools-web-search) with the `web_search_preview` tool. Citations come back as `url_citation` annotations on the assistant message's `output_text` content items; the adapter walks the `output[] → content[] → annotations[]` tree and dedupes by URL.

Default model: `gpt-4o-mini`. Override with `--model gpt-4o`, `gpt-4.1-mini`, or `gpt-4.1` for higher-quality tiers.

### Anthropic (`--engine anthropic`)

Uses the [Messages API](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool) with the server-side `web_search_20250305` tool. Citations live in two places on the response: `web_search_tool_result` blocks (the raw search results pulled into context) and inline `web_search_result_location` citations on text blocks (the answer's actual attributions). The adapter merges both into a single deduped list, with inline-citation titles winning over raw-result titles for the same URL.

Default model: `claude-sonnet-4-5`. The tool-type id defaults to `web_search_20250305` for broad Sonnet/Opus compatibility — the newer `web_search_20260209` (with dynamic filtering) can be enabled by constructing the adapter programmatically with `{ toolType: "web_search_20260209" }`.

### Gemini (`--engine gemini`)

Uses Google's [generateContent API](https://ai.google.dev/gemini-api/docs/grounding) with the `google_search` grounding tool (the newer flow that supersedes `google_search_retrieval`). Citations are in `candidates[0].groundingMetadata.groundingChunks[]`.

**Redirect caveat:** Gemini wraps every grounded source in a `https://vertexaisearch.cloud.google.com/grounding-api-redirect/...` URL by design. The adapter preserves the wrapper as the canonical citation but ALSO emits a synthetic companion citation derived from the chunk's `title` field (which Gemini usually sets to the source host or `"Title — host.com"`). That derived citation is what allows `hostnameMatchesDomain` to light up for the user's `--domain` argument. Wrapper entries carry `notes: "Gemini-wrapped redirect URL…"` in the JSON output so consumers can distinguish them.

Default model: `gemini-2.5-flash`. Accepts either `GOOGLE_API_KEY` or `GEMINI_API_KEY` (in that priority order).

### xAI Grok (`--engine xai` or `--engine grok`)

Uses xAI's OpenAI-compatible [chat completions endpoint](https://docs.x.ai/docs/guides/live-search) with the `search_parameters` extension (`mode: "on"`, `return_citations: true`) that enables Live Search. The response is a standard chat-completions body with an additional flat `citations: string[]` field on `choices[0].message`. Because xAI returns URLs without titles, the adapter derives a display title from each citation's hostname.

Default model: `grok-2-latest`. Cost estimation uses the server-reported `num_sources_used` when present, falling back to the citation count.

> The xAI public docs have largely migrated their examples to the newer `/v1/responses` endpoint with a `web_search` tool. The chat-completions path with `search_parameters` remains operational against the v1 API and is what most existing customers integrate with, so that's what this adapter targets. If xAI hard-deprecates the chat path, the adapter will need a one-shot swap to `/v1/responses` with the same payload shape.

## `--engine all` — multi-engine rollup

```bash
export PERPLEXITY_API_KEY=pplx-xxxx
export OPENAI_API_KEY=sk-xxxx
export ANTHROPIC_API_KEY=sk-ant-xxxx
export GOOGLE_API_KEY=AIza-xxxx
export XAI_API_KEY=xai-xxxx

npx auto-geo check --domain shadow.inc \
  --query "what is GEO" \
  --query "open source GEO tools" \
  --engine all
```

Runs every engine whose primary API key is present in env (engines whose key is unset are skipped, not failed) and produces a per-query × per-engine matrix plus two roll-up metrics:

- **Union coverage** — the fraction of queries cited by AT LEAST ONE engine. The headline "are we cited anywhere in the AI-search landscape" number.
- **Mean coverage** — the average of each engine's individual coverage percentage. Useful for tracking whether a given engine is consistently citing you vs. just one engine pulling up the average.

```text
auto-geo check — multi-engine citation coverage across the AI-search landscape
domain:    shadow.inc
queries:   2
engines:   perplexity, openai, anthropic, gemini, xai

[1/2] "what is GEO"
  ✓  cited by 3/5 engines
     perplexity ✓  openai ✗  anthropic ✓  gemini ✓  xai ✗

[2/2] "open source GEO tools"
  ✓  cited by 4/5 engines
     perplexity ✓  openai ✓  anthropic ✗  gemini ✓  xai ✓

▸ Union coverage: 2/2 queries (100%)  cited by ≥1 engine · mean per-engine coverage 70% · ~$0.084 spent total

Per-engine breakdown:
  ✓ perplexity (sonar)         2/2 queries (100%)
  ✓ openai (gpt-4o-mini)       1/2 queries (50%)
  ✓ anthropic (claude-sonnet-4-5) 1/2 queries (50%)
  ✓ gemini (gemini-2.5-flash)  2/2 queries (100%)
  ✓ xai (grok-2-latest)        1/2 queries (50%)
```

JSON output (`--engine all --json`) emits a `MultiEngineCheckReport` with `perEngine` (the per-engine `CheckReport`s keyed by engine id), `acrossEngines` (the per-query union rows), and a `summary` carrying `unionCoveragePct`, `meanCoveragePct`, and aggregated `estimatedCostUsd`. Engines that were skipped because their API key wasn't set appear under `skippedEngines` with a reason.

Exit code under `--engine all`: `0` if union coverage > 0%, `1` if 0%.

## Domain matching

Matching is forgiving but precise:

- Case-insensitive
- Strips `www.` prefix from both the citation URL and the `--domain` argument
- Suffix match — `--domain shadow.inc` matches `shadow.inc`, `www.shadow.inc`, `blog.shadow.inc`, `docs.research.shadow.inc`
- Does **not** match a sneaky substring — `--domain shadow.inc` does NOT match `notshadow.inc` or `shadow.inc.evil.com`

If you want to match only the apex domain and exclude subdomains, file an issue — we'll add a `--strict` flag.

## Interpreting rank

For each cited URL, `rank` is its 1-based position in the engine's citation list, and `totalCitationsForQuery` is the denominator. `rank 1 of 6` is a stronger signal than `rank 5 of 6`: engines tend to weight earlier citations more heavily in the synthesized answer.

When a domain is cited by multiple URLs in the same query response, all of them appear under that query's `citations[]` with their individual ranks.

## JSON schema (`--json`)

```json
{
  "domain": "shadow.inc",
  "engine": "perplexity",
  "model": "sonar",
  "results": [
    {
      "query": "what is GEO",
      "cited": true,
      "citations": [
        {
          "url": "https://www.shadow.inc/resources/what-is-geo",
          "rank": 1,
          "totalCitationsForQuery": 5
        }
      ],
      "rawSources": [
        { "url": "https://www.shadow.inc/resources/what-is-geo" },
        { "url": "https://arxiv.org/abs/2311.09735" }
      ],
      "answer": "GEO stands for…",
      "usage": {
        "promptTokens": 102,
        "completionTokens": 384,
        "totalTokens": 486,
        "estimatedCostUsd": 0.000486
      }
    }
  ],
  "summary": {
    "citedQueryCount": 2,
    "totalQueries": 3,
    "coveragePct": 67,
    "totalCitations": 3,
    "estimatedCostUsd": 0.012,
    "errors": []
  },
  "generatedBy": "auto-geo check"
}
```

The full TypeScript shape is exported as `CheckReport` from `cli/check.ts`.

## CI integration

Drop `auto-geo check` into your deploy pipeline alongside `auto-geo doctor`:

```yaml
# .github/workflows/geo.yml
- name: GEO coverage check
  env:
    PERPLEXITY_API_KEY: ${{ secrets.PERPLEXITY_API_KEY }}
  run: |
    npx auto-geo check \
      --domain shadow.inc \
      --queries-file geo/critical-queries.txt \
      --json --out geo-report.json
```

The job fails (exit 1) if **none** of the critical queries cite your domain. Pair with a doctor run to fail also when a target page's structure regresses.

## Troubleshooting

**`PERPLEXITY_API_KEY is not set`** — export the key in the calling shell (or the CI runner's secret store).

**`Perplexity API 429 Too Many Requests`** — lower `--concurrency` (try `1`), or upgrade your Perplexity plan.

**Coverage is 0% but I'm sure my page is good** — the page may not yet be indexed by Perplexity's crawler. Wait 24–48 hours after publish and re-run. Also confirm the query phrasing matches a real user intent — `auto-geo doctor` grades structure, but if no one ever asks the question, no one ever cites the answer.

**One of my queries returned no sources at all** — Perplexity occasionally answers from model parametric knowledge without grounding. The query is recorded as `cited: false, rawSources: []`. Re-running usually grounds it.

## Programmatic API

`auto-geo` does not currently ship the check primitives via a top-level export, because the CLI is the supported surface. If you want to embed the orchestration in your own tooling, import from the source paths:

```ts
import { runCheck, createEngine } from "auto-geo/cli/check"; // not exported via package exports yet
```

If you have a use case, open an issue and we'll promote the surface to a real subpath export in v0.2.
