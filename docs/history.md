---
title: "history"
parent: "Commands"
nav_order: 7
description: "auto-geo history — citation coverage over time, with per-engine trends and deltas."
---

# auto-geo history

Citation coverage over time. [`auto-geo check`](./check.md) saves every run to `.auto-geo/checks/`; `history` reads those files and renders the trend — run-by-run coverage with per-engine deltas, plus exactly which prompts you started or stopped being cited for.

```bash
auto-geo history
```

```text
  2026-06-01 08:30  perplexity   33% ·   1/3 cited  $0.01
  2026-06-08 09:15  perplexity   67% ↑34  2/3 cited  $0.01

  Since last run (perplexity · 2026-06-01 08:30 ▸ 2026-06-08 09:15)
    ✓ newly cited  open source GEO tools
    ✗ lost         (none)

  2 runs · .auto-geo/checks
```

## How trends are computed

Trends compare **like with like**: each run's coverage delta (`↑34`, `↓12`, `→0`) is measured against the previous run of the _same engine selector_. A Perplexity run is never compared to a Gemini run — engines have different grounding behavior, so cross-engine deltas would be noise. Multi-engine runs (`check --engine all`) are tracked as the selector `all` using union coverage.

The "Since last run" block diffs the **cited-query sets** of the latest run and its same-engine predecessor:

- **newly cited** — prompts cited now that weren't before (your wins)
- **lost** — prompts cited before that aren't now (regressions to investigate)

## Flags

| Flag                     | Effect                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------ |
| `--engine <name>`        | Only runs for one engine selector (`perplexity`, `openai`, `anthropic`, `gemini`, `xai`, `all`). |
| `--limit N`              | Most recent runs to show (default 15). Older runs stay on disk.                                  |
| `--json`                 | Machine-readable rows + delta.                                                                   |
| `--no-color`, `--narrow` | Output controls.                                                                                 |

## The data on disk

Each run is one JSON file: `.auto-geo/checks/<ISO-timestamp>--<engine>.json`, containing a `{ savedAt, kind, report }` envelope where `report` is byte-identical to `check --json` output. Files are append-only history — don't edit them. A bare `check --out` report dropped into the directory by hand is also picked up (its timestamp falls back to the file's mtime).

Skip saving a throwaway run with `check --no-save`.

## JSON shape

```bash
auto-geo history --json
```

```jsonc
{
  "workspaceDir": "/path/to/.auto-geo",
  "totalRuns": 12,
  "rows": [
    {
      "savedAt": "2026-06-08T09:15:00.000Z",
      "engine": "perplexity",
      "domain": "shadow.inc",
      "totalQueries": 3,
      "citedQueryCount": 2,
      "coveragePct": 67,
      "coverageDeltaPct": 34,
      "estimatedCostUsd": 0.012,
      "citedQueries": ["…"],
      "path": "…",
      "file": "…",
    },
  ],
  "delta": {
    "engine": "perplexity",
    "previousSavedAt": "…",
    "latestSavedAt": "…",
    "newlyCited": ["open source GEO tools"],
    "lost": [],
  },
}
```
