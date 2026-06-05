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

| Flag                    | What it does                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--domain <d>`          | Bare domain (`shadow.inc`) or full origin (`https://shadow.inc`). **Required.**                                                                                                                                                                                                                                                                                                |
| `--query <text>`        | A single query. Repeatable — at least one `--query` or `--queries-file` is required.                                                                                                                                                                                                                                                                                           |
| `--queries-file <path>` | Newline-separated queries. `#` lines are treated as comments and skipped.                                                                                                                                                                                                                                                                                                      |
| `--engine <name>`       | One of `perplexity` (default), `openai`, `anthropic`, `gemini`, `xai` (alias: `grok`), or `all` (run every engine whose API key is present in env).                                                                                                                                                                                                                            |
| `--model <name>`        | Engine-specific model. Default `sonar` for Perplexity.                                                                                                                                                                                                                                                                                                                         |
| `--concurrency N`       | Parallel queries **per engine**. Default `12` (bumped from `6` in v0.5.0). Recommended cap ~20 per engine; `--concurrency 50` is safe for batch jobs against a single fast engine. Lower for restrictive accounts. Under `--engine all` each engine gets its own pool of this size — `5 engines × 12 = up to 60` in-flight requests, each respecting that engine's rate limit. |
| `--answers <mode>`      | Render the engine's natural-language answer under each query in human output. `preview` (default, ~3 sentences, ~400 chars), `full`, or `none`. Ignored under `--json` / `--ndjson`.                                                                                                                                                                                           |
| `--json`                | One single JSON object on stdout when the run completes. Conforms to `CheckReport` in `cli/check.ts` (default `--format`).                                                                                                                                                                                                                                                     |
| `--ndjson`              | Stream one JSON object per line to stdout AS each query resolves; final line is the summary tagged `{"_summary":true,…}`. Mutually exclusive with `--json`.                                                                                                                                                                                                                    |
| `--format <id>`         | `auto-geo` (default) — the stable `CheckReport` / `MultiEngineCheckReport` shape. `geo-audit` — per-row `LlmQueryResult` shape for parity with Shadow's in-product `geoAudit` tool (`packages/core/src/lib/tools/geoAudit.tool.ts`). See [Output shapes](#output-shapes) below. Affects `--json` / `--ndjson` only; human output is unchanged.                                 |
| `--timeout-per-query N` | Per-query outer timeout in seconds (default `60`). A query that exceeds it is marked `error: "timed out after Ns"`; the rest of the run continues.                                                                                                                                                                                                                             |
| `--max-runtime N`       | Whole-run timeout in seconds (default: no cap). When exceeded, pending queries are marked `error: "skipped — max runtime exceeded"`, partial results are emitted, exit 2.                                                                                                                                                                                                      |
| `--out <path>`          | Also write the full JSON report to `<path>` (alongside whatever else gets printed).                                                                                                                                                                                                                                                                                            |
| `--no-color`            | Disable ANSI colors even on a TTY.                                                                                                                                                                                                                                                                                                                                             |

Exit code: `0` if coverage > 0% (any query cited your domain), `1` if coverage is 0%, `2` if `--max-runtime` tripped. CI-friendly:

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

## Performance

`check` is built around a bounded promise-pool — each engine adapter is a thin `fetch` wrapper, and Node's global `fetch` (undici-backed) reuses HTTP connections per origin automatically. The bottleneck is the engine API's per-request latency, not local overhead.

### Defaults that matter

| Setting               | Default | Why                                                                                                                                                                                                                                                                                                                                             |
| --------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--concurrency`       | `12`    | **Per engine.** Bumped from `6` → `12` in v0.5.0 — Perplexity Sonar Pro accounts comfortably sustain 12-wide parallelism, and the built-in exponential-backoff retry on `429` catches anyone hitting a per-account cap. Recommended cap ~20 per engine; `--concurrency 50` is safe for batch jobs against a single fast engine (Sonar, Gemini). |
| `--timeout-per-query` | `60s`   | Outer timeout — sits above any HTTP-level timeout in the adapter. A stuck request is aborted and recorded as an error; the rest continues.                                                                                                                                                                                                      |
| `--max-runtime`       | _none_  | Whole-run cap. Useful in CI to prevent a hung run from holding the worker. Exit `2` when tripped.                                                                                                                                                                                                                                               |

**Per-engine pools under `--engine all`.** Each engine gets its OWN worker pool of size `--concurrency`. Pools execute fully in parallel via `Promise.all`, so a slow engine never blocks a fast one and a single engine's 429-retry never delays the others. At default `--concurrency 12` with all five engines credentialed that's up to **60 concurrent requests** in flight — each respecting its OWN per-account rate limit. This is the big v0.5.0 throughput win: a 50-query × 5-engine run that took ~3.5min at v0.4.2's `--concurrency 6` × serial-ish multi-engine completes in ~40s with the v0.5.0 default.

Built-in retry: on transient failures (`429`, `5xx`, network timeouts), each query is retried up to **2 times** with exponential backoff (1s, then 4s). `4xx` errors (other than `429`) are never retried — those are configuration mistakes that retrying won't fix.

### Per-engine latency rule of thumb

These are typical default-model round-trips against a warm connection. Your real numbers depend on prompt length, grounding depth, and account tier — instrument the per-query `usage.estimatedCostUsd` field for cost, the `--ndjson` `timestamp` field for latency.

| Engine     | Default model       | Typical per-query latency |
| ---------- | ------------------- | ------------------------- |
| gemini     | `gemini-2.5-flash`  | ~3s                       |
| perplexity | `sonar`             | ~5s                       |
| xai        | `grok-2-latest`     | ~5s                       |
| openai     | `gpt-4o-mini`       | ~6s                       |
| anthropic  | `claude-sonnet-4-5` | ~8s                       |

At the default `--concurrency 6`, a 50-query Perplexity run lands around **~67s** of API time (50 × ~8s ÷ 6 concurrent) plus a one-time `npx` cold-start (~3s). Bigger query sets scale linearly.

### Recommended patterns

**One CLI call, many `--query` flags.** Each `npx auto-geo check` invocation pays a one-time `npx` cold-start (~3s) before any work begins. For a 50-query audit, run ONE process with 50 `--query` flags rather than 50 separate processes — you save ~150s of cold-start alone.

```bash
# Good — one process, one cold-start.
npx auto-geo check --domain shadow.inc \
  --query "what is GEO" \
  --query "open source GEO tools" \
  --query "how do I get cited by ChatGPT" \
  # … 47 more
```

A newline-separated file is even cleaner:

```bash
npx auto-geo check --domain shadow.inc --queries-file critical-queries.txt
```

**Stream output with `--ndjson` for agent integration.** Default human and `--json` modes wait until the whole run finishes before emitting output, which is fine for short runs but invisible-feeling for big ones. `--ndjson` emits one JSON object per line to stdout AS each query completes — partial results are available to a downstream consumer in real time, and the final line carries the rolled-up summary:

```bash
npx auto-geo check --domain shadow.inc --queries-file q.txt --ndjson \
  | tee run.ndjson \
  | jq -r 'select(.cited == true) | .query'

# Roll up the summary at the end:
tail -n 1 run.ndjson | jq '{coverage: .coveragePct, cost: .estimatedCostUsd}'
```

Per-query line shape (additive; consumers should ignore unknown fields):

```json
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
  "rawSources": [{ "url": "…" }, { "url": "…" }],
  "answer": "GEO stands for…",
  "usage": { "totalTokens": 486, "estimatedCostUsd": 0.000486 },
  "timestamp": "2026-06-04T18:01:23.000Z"
}
```

> **Fan-out queries** are captured per-result on the `CheckQueryResult` carried under the default format too — they're exposed prominently in `--format geo-audit` rows; for the default shape they're available via the in-memory `CheckReport` if you embed the orchestrator. The CLI ndjson default shape omits them today (it's an additive break-glass field — file an issue if you want them surfaced in default ndjson too).

Summary (always the last line, marked with `_summary: true`):

```json
{
  "_summary": true,
  "domain": "shadow.inc",
  "engine": "perplexity",
  "model": "sonar",
  "citedQueryCount": 34,
  "totalQueries": 50,
  "coveragePct": 68,
  "totalCitations": 41,
  "estimatedCostUsd": 0.27,
  "errors": []
}
```

Under `--engine all`, the per-line shape additionally includes an `engine` field, and the `_summary` line carries the multi-engine `engines`, `skippedEngines`, and `acrossEngines` roll-ups in addition to the union/mean coverage numbers.

**Live progress is on stderr.** In human mode, `check` prints a one-line `[i/N] ✓/✗ "query" — cited (n sources)` to stderr as each query resolves (in completion order, not request order). This way piping stdout to a file still gets you only the final report, while the terminal shows live progress.

**Cap CI runs with `--max-runtime`.** For CI integration, set a hard ceiling so a hung engine doesn't hold the runner:

```bash
npx auto-geo check --domain shadow.inc \
  --queries-file critical-queries.txt \
  --max-runtime 180 \
  --ndjson --out report.json
```

Exit `2` means the deadline tripped — even if some queries cited the domain, the run was truncated and should be re-attempted.

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

## Output shapes (`--format`)

Two formats supported. The default (`--format auto-geo`) is the stable `CheckReport` / `MultiEngineCheckReport` shape shown above and is byte-for-byte identical to v0.4.2. Pass `--format geo-audit` when you want output that's interchangeable with Shadow's in-product `geoAudit` agent tool (`packages/core/src/lib/tools/geoAudit.tool.ts`) — useful for any downstream consumer that already expects that contract.

### `--format auto-geo` (default)

```jsonc
// --json --format auto-geo (default)
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
          "totalCitationsForQuery": 5,
        },
      ],
      "rawSources": [...],
      "answer": "GEO stands for…",
      "fanOutQueries": ["what is GEO", "generative engine optimization"],
      "usage": { "totalTokens": 486, "estimatedCostUsd": 0.000486 },
    },
  ],
  "summary": { ... },
}
```

### `--format geo-audit`

`--json` returns a single `{ rows, summary }` OBJECT (not an array — easier to consume than a bare list):

```jsonc
// --json --format geo-audit
{
  "rows": [
    {
      "prompt": "what is GEO", // (was: query)
      "provider": "perplexity", // openai → "chatgpt"
      "model": "sonar",
      "responseText": "GEO stands for…", // (was: answer)
      "citations": [
        {
          "url": "https://www.shadow.inc/resources/what-is-geo",
          "title": "What is GEO?",
        },
      ],
      "fanOutQueries": ["what is GEO", "generative engine optimization"],
      "inputTokens": 102, // (was: usage.promptTokens)
      "outputTokens": 384, // (was: usage.completionTokens)
      "reasoningTokens": null, // not surfaced by check today
      "moneySpent": 0.000486, // (was: usage.estimatedCostUsd)
      "webSearchEnabled": true, // every engine grounds
      "datetime": "2026-06-04T18:01:23.000Z",
      "error": null,
    },
  ],
  "summary": {
    "promptCount": 1,
    "providerCount": 1,
    "totalQueries": 1,
    "successCount": 1,
    "errorCount": 0,
    "totalCitations": 1,
    "totalMoneySpent": 0.000486,
    "providers": ["perplexity"],
    "errors": [],
  },
}
```

`--ndjson --format geo-audit` streams one `GeoAuditRow` per line as each query resolves, then a final `_summary` line. The summary line carries BOTH the default summary AND the geoAudit summary fields layered on top — so both consumer styles work:

```jsonc
// each query line is a GeoAuditRow as above
{ "prompt": "q1", "provider": "perplexity", "model": "sonar", ... }
{ "prompt": "q2", "provider": "perplexity", "model": "sonar", ... }
// final summary line
{
  "_summary": true,
  "domain": "shadow.inc", "engine": "perplexity", "model": "sonar",
  "citedQueryCount": 2, "totalQueries": 2, "coveragePct": 100,
  // geoAudit summary fields:
  "promptCount": 2, "providerCount": 1, "totalMoneySpent": ...,
  "providers": ["perplexity"], "errors": []
}
```

**Provider name mapping.** `openai` is mapped to `chatgpt` in the geoAudit output to match the in-product tool's public-facing label. Every other engine name (`perplexity`, `anthropic`, `gemini`, `xai`) passes through unchanged.

**Human output is unchanged** under `--format geo-audit` — the flag is JSON-shape-only. Pipe stdout to a file or to `jq` to consume the geoAudit shape; the terminal report still uses the auto-geo presentation.

The exported types live in `cli/format-geo-audit.ts`: `GeoAuditRow`, `GeoAuditSummary`, `GeoAuditOutput`.

## Fan-out queries

A "fan-out query" is the literal sub-query an engine ran while grounding — the question(s) it sent to its web-search backend after expanding the user prompt. v0.5.0 captures these per-engine where the provider exposes them:

| Engine     | Source                                                | Surfaced |
| ---------- | ----------------------------------------------------- | -------- |
| perplexity | `response.search_queries[]` (newer Sonar shapes only) | yes      |
| openai     | `output[].web_search_call.action.query`               | yes      |
| anthropic  | `content[].server_tool_use.input.query`               | yes      |
| gemini     | `candidates[0].groundingMetadata.webSearchQueries[]`  | yes      |
| xai        | not exposed in the chat-completions Live Search shape | `[]`     |

Fan-out queries are surfaced as `fanOutQueries: string[]` (always an array — never undefined) on every result. They power competitor-mention analysis (what is the engine ACTUALLY searching for when the user asks X?), entity-coverage gaps, and query-side keyword discovery for `auto-geo write` follow-ups.

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
