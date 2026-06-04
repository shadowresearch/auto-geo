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

| Engine                      | Env var              | How to get one                         |
| --------------------------- | -------------------- | -------------------------------------- |
| `perplexity` (default)      | `PERPLEXITY_API_KEY` | https://www.perplexity.ai/settings/api |
| `openai` (stub — see below) | `OPENAI_API_KEY`     | https://platform.openai.com/api-keys   |

```bash
export PERPLEXITY_API_KEY=pplx-xxxx
npx auto-geo check --domain shadow.inc --query "what is GEO"
```

Keys are read at request time and never persisted. The CLI never logs them.

## Usage

```text
auto-geo check --domain <d> --query <q> [--query <q> ...]
auto-geo check --domain <d> --queries-file queries.txt
auto-geo check --domain <d> --query <q> --json
```

Flags:

| Flag                    | What it does                                                                                                            |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `--domain <d>`          | Bare domain (`shadow.inc`) or full origin (`https://shadow.inc`). **Required.**                                         |
| `--query <text>`        | A single query. Repeatable — at least one `--query` or `--queries-file` is required.                                    |
| `--queries-file <path>` | Newline-separated queries. `#` lines are treated as comments and skipped.                                               |
| `--engine <name>`       | `perplexity` (default). `openai` is scaffolded but not yet wired (see [stubs](#openai-engine-stub)). `all` is reserved. |
| `--model <name>`        | Engine-specific model. Default `sonar` for Perplexity.                                                                  |
| `--concurrency N`       | Parallel queries. Default 2. Higher → faster but more likely to hit engine rate limits.                                 |
| `--json`                | Machine-readable JSON conforming to the `CheckReport` shape in `cli/check.ts`.                                          |
| `--out <path>`          | Also write the full JSON report to `<path>` (alongside whatever else gets printed).                                     |
| `--no-color`            | Disable ANSI colors even on a TTY.                                                                                      |

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

### Perplexity (`--engine perplexity`)

Uses Perplexity's [Chat Completions API](https://docs.perplexity.ai/api-reference/chat-completions) with `sonar` (or `sonar-pro`). Sonar performs grounded web search server-side and returns citations as a top-level array on the response. The adapter prefers the richer `search_results` field (carries titles) when present, falling back to the bare `citations` URL array.

Default model: `sonar`. Override with `--model sonar-pro` for the higher-quality (and more expensive) tier.

Cost estimation uses Perplexity's published per-1M-token rates plus the flat per-request grounding fee. The number in the report is a best-effort estimate; the Perplexity dashboard is the authoritative source.

### OpenAI engine (stub)

`--engine openai` is currently scaffolded but throws "not yet implemented". The real implementation will use the [Responses API](https://platform.openai.com/docs/api-reference/responses) with the `web_search_preview` tool. Citations come back as `url_citation` annotations on the message output items — the parser for those (`parseOpenAICitations`) is already in place under `cli/engines/openai.ts` and unit-tested, so a follow-up PR only needs to wire the HTTP call.

`--engine all` is reserved for once OpenAI lands.

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
