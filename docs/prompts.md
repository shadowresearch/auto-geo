# auto-geo prompts

Manage your **tracked prompts** — the questions you want AI engines to answer by citing your domain. The tracked set is what [`auto-geo check`](./check.md) runs when invoked without `--query` / `--queries-file`, and what [`auto-geo history`](./history.md) trends over time.

```bash
npx auto-geo prompts add "best media monitoring tools" "what is GEO"
npx auto-geo prompts            # numbered list (same as `prompts list`)
npx auto-geo prompts rm 2       # remove by index — or by exact text
npx auto-geo prompts discover   # LLM proposes new prompts for your domain
```

## Where prompts live

`.auto-geo/prompts.txt` — plain text, one prompt per line, `#` comments allowed. The file is meant to be committed: a diff of `prompts.txt` is the record of how your GEO target set evolved.

```text
# auto-geo tracked prompts
best media monitoring tools
what is GEO
how do I get cited by ChatGPT
```

You can edit the file by hand; the CLI and the file are equivalent interfaces.

## Actions

| Action             | Behavior                                                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list` (default)   | Numbered list of tracked prompts, with count and file path.                                                                                       |
| `add <text> [...]` | Append one or more prompts. Duplicates (case-insensitive) are skipped. Creates the `.auto-geo/` workspace on first use — no `init` required.      |
| `rm <index\|text>` | Remove exactly one prompt, by its `list` index (1-based) or exact text (case-insensitive). Comments and other lines are preserved byte-identical. |

## `prompts discover` — LLM-assisted prompt discovery

The hard part of a GEO program is knowing _which_ questions to compete for. `discover` proposes them: it fetches your homepage for grounding, shows the model what you already track, and asks for N new high-intent queries a target customer would put to an AI engine — queries your domain should be the cited answer for.

```bash
npx auto-geo prompts discover --dry-run    # preview without writing
npx auto-geo prompts discover --count 15   # propose and track 15
```

Guarantees (same contract as `prompts add`):

- **Never overwrites** — proposals are appended; existing lines stay byte-identical.
- **Never duplicates** — case-insensitive dedupe against the tracked set and within the batch.
- `--dry-run` previews the candidates and what would be added/skipped without writing anything.

| Flag              | Effect                                                             |
| ----------------- | ------------------------------------------------------------------ |
| `--count N`       | How many prompts to propose (default 10).                          |
| `--domain <url>`  | Publisher domain (defaults to the config domain).                  |
| `--provider <id>` | `openai` or `anthropic` (auto-detected from which API key is set). |
| `--model <name>`  | Model override (defaults: `gpt-5.4` / `claude-sonnet-4-6`).        |
| `--dry-run`       | Preview only.                                                      |

Requires an `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` (auto-loaded from `.env.local`). A failed homepage fetch degrades gracefully — generation proceeds from domain context alone. Prune anything you don't want with `prompts rm`.

## Flags

`--json` (machine-readable outcome), `--no-color`, `--narrow`.

## The loop

```bash
npx auto-geo prompts add "the query you want to win"
npx auto-geo check                 # measures every tracked prompt, saves the run
npx auto-geo history               # which prompts you gained / lost since last run
```
