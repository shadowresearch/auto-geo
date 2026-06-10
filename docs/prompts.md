# auto-geo prompts

Manage your **tracked prompts** — the questions you want AI engines to answer by citing your domain. The tracked set is what [`auto-geo check`](./check.md) runs when invoked without `--query` / `--queries-file`, and what [`auto-geo history`](./history.md) trends over time.

```bash
npx auto-geo prompts add "best media monitoring tools" "what is GEO"
npx auto-geo prompts            # numbered list (same as `prompts list`)
npx auto-geo prompts rm 2       # remove by index — or by exact text
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

## Flags

`--json` (machine-readable outcome), `--no-color`, `--narrow`.

## The loop

```bash
npx auto-geo prompts add "the query you want to win"
npx auto-geo check                 # measures every tracked prompt, saves the run
npx auto-geo history               # which prompts you gained / lost since last run
```
