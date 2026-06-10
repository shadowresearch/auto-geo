---
title: Commands
nav_order: 2
has_children: true
description: Reference for every auto-geo command — init, doctor, write, fix, prompts, check, history.
---

# Commands

The engine is one loop, run in order:

| Command                         | What it answers                                          |
| :------------------------------ | :------------------------------------------------------- |
| [`auto-geo init`](./init)       | Set up the full system — config, `.env.local`, workspace |
| [`auto-geo doctor`](./doctor)   | Is this page shaped for citation?                        |
| [`auto-geo write`](./write)     | Generate publish-ready pages for target queries          |
| [`auto-geo fix`](./fix)         | Rewrite an existing page so it passes the audit          |
| [`auto-geo prompts`](./prompts) | Which queries are we competing for?                      |
| [`auto-geo check`](./check)     | Do AI engines actually cite us?                          |
| [`auto-geo history`](./history) | How is coverage trending?                                |

Every command supports `--json` (machine-readable stdout), `--no-color`, and stable exit codes — `doctor` and `check` are CI gates out of the box. Progress goes to stderr; results go to stdout.
