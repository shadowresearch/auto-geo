# AGENT.md — auto-geo operating spec

You are operating the `auto-geo` CLI on the user's behalf. `auto-geo` is the open-source GEO engine: it audits, generates, fixes, and tracks the pages AI search engines (ChatGPT, Perplexity, Google AI Overviews, Claude, Gemini) cite. This file is the canonical spec for driving it programmatically.

## 0. Invocation

```bash
npx auto-geo@latest <command> [flags]   # or: npm i -g auto-geo && auto-geo <command>
```

Node `>=18.17`. Every command supports `--json` (single machine-readable object on stdout), `--no-color`, and writes progress to stderr — stdout is always parseable.

## 1. Set up once

```bash
auto-geo init --yes
```

Writes three things at the project root:

- `auto-geo.config.json` — defaults (domain, basePath, provider, model, engine, concurrency, author). Edit this rather than re-passing flags. Committable; never holds secrets.
- `.env.local` — empty API key slots (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `PERPLEXITY_API_KEY`, `GEMINI_API_KEY`, `XAI_API_KEY`). Auto-loaded by every command; process env always wins. Must be gitignored.
- `.auto-geo/` — the workspace: `prompts.txt` (tracked prompts) and `checks/` (saved check runs).

Ask the user for at least one API key if none is set. Do not write keys into the config file. `init` exits 1 if the config already exists (`--force` to overwrite); it never overwrites `.env.local`.

Config precedence everywhere: CLI flag > env var > config file > built-in default.

## 2. The loop

| Command                                         | Question it answers                          | Exit codes                                               |
| ----------------------------------------------- | -------------------------------------------- | -------------------------------------------------------- |
| `auto-geo doctor <url>` (or `--site <sitemap>`) | Is this page shaped for citation?            | 0 if score ≥ 75%, 1 otherwise                            |
| `auto-geo write --query "<q>"`                  | Generate a publish-ready page for this query | 0 ok, 1 any page failed                                  |
| `auto-geo fix <url>`                            | Rewrite this page so it passes the audit     | 0 ok, 1 failure                                          |
| `auto-geo prompts add/list/rm`                  | Manage the tracked prompt set                | 0 ok, 1 failure                                          |
| `auto-geo check`                                | Do AI engines actually cite the domain?      | 0 if coverage > 0%, 1 if 0%, 2 if truncated/config error |
| `auto-geo history`                              | How is coverage trending?                    | 0 ok                                                     |

Recommended cadence for an agent maintaining a site's GEO posture:

1. `auto-geo prompts add "<query>"` for every query the user cares about.
2. `auto-geo check --json` — establish the baseline (runs all tracked prompts; saved to `.auto-geo/checks/` automatically).
3. For uncited prompts: `auto-geo write --query "<prompt>" --out ./resources` → publish the JSON through the user's own pipeline → `auto-geo doctor <published-url>` to verify ≥ 75%.
4. Re-run `auto-geo check` after indexing has had time to catch up (days, not minutes).
5. `auto-geo history --json` — report newly cited / lost prompts to the user.

## 3. Generation details (write / fix)

- Providers: `--provider openai` (default model `gpt-5.4`) or `--provider anthropic` (default `claude-sonnet-4-6`). Provider auto-detects from which API key is set.
- Output is a JSON payload per query, validated against the strict GEO schema (seven blocks: TL;DR, intro, question-format H2 sections with 40–60-word answer capsules, related guides, key takeaways, FAQ, disclosure). A validation failure triggers a bounded self-correction retry loop (`--max-retries`, default 3).
- `--dry-run` prints the plan + cost estimate with zero LLM calls — use it before spending.
- Cost estimates are printed per page and per run.

## 4. Measurement details (check / history)

- Engines: `perplexity` (default), `openai`, `anthropic`, `gemini`, `xai` (alias `grok`), `all`. `--engine all` runs every engine with a key present and reports a union roll-up.
- With no `--query` / `--queries-file`, `check` runs the tracked prompts from `.auto-geo/prompts.txt`.
- Every run is auto-saved to `.auto-geo/checks/<timestamp>--<engine>.json` (`--no-save` to skip). `history` reads these; trends compare runs of the same engine selector only.
- For streaming consumption use `--ndjson`: one JSON object per query as it resolves, then a `{"_summary": true, ...}` line.
- `--format geo-audit` switches JSON row shape to Shadow's in-product `geoAudit` contract.

## 5. Rules

- Never put API keys anywhere except `.env.local` / the environment.
- Never edit files under `.auto-geo/checks/` — they are the historical record.
- `.auto-geo/` and `auto-geo.config.json` should be committed; `.env.local` must not be.
- Prefer editing `auto-geo.config.json` over repeating flags.
- Respect exit codes in CI: `doctor` and `check` are deploy gates.

Full docs: <https://github.com/shadowresearch/auto-geo> · per-command references under `docs/`.
