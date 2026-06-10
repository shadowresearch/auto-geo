# Contributing to auto-geo

Thanks for your interest in contributing. `auto-geo` is built by [Shadow](https://www.shadow.inc) and maintained as a public good for the GEO community. We welcome bug reports, doctor-check improvements, new check engines, schema rationale challenges (with data), and documentation refinements.

## Code of Conduct

Participation in this project is governed by our [Code of Conduct](./CODE_OF_CONDUCT.md). By participating, you agree to uphold it.

## Project layout

```
cli/                  The entire product — one module per command plus shared
                      infrastructure:
  run.ts                argument parsing + dispatch (start here)
  schema.ts             the GEO resource schema (Zod) — the contract
  doctor.ts/checks.ts   citation-readiness audit + the 8 checks
  write.ts/fix.ts/llm.ts  LLM generation against the schema
  check.ts              citation-coverage orchestrator
  engines/              one adapter per AI search engine
  workspace.ts          .auto-geo/ — tracked prompts + check history
  prompts.ts/history.ts the workspace commands
  init.ts/config.ts/env.ts  first-run setup, config file, .env loading
  ui.ts/help.ts/render.ts   presentation layer
docs/                 The substantive product: SOP, architecture, validation,
                      per-command references.
tests/                Vitest suite. tests/fixtures/payload.ts is the canonical
                      valid payload variants spread from.
```

## Quick start

```bash
git clone https://github.com/shadowresearch/auto-geo.git
cd auto-geo
pnpm install
pnpm test          # run the Vitest suite
pnpm typecheck     # tsc --noEmit
pnpm lint
pnpm build         # tsup → dist/cli/bin.js
node dist/cli/bin.js --help
```

## What we accept

- **Bug fixes** to existing behavior, with a regression test.
- **New check engines** (an AI search engine with a citations API) — follow the adapter pattern in [`cli/engines/`](./cli/engines); each adapter takes an injectable `fetch` so tests run with zero network.
- **Doctor check improvements** — better heuristics for existing checks, with the SOP rationale documented.
- **DX improvements** — better error messages, output rendering, flag ergonomics. The CLI is the product; polish counts.
- **Documentation** — typos, clarifications, additional examples, translation of the SOP.
- **Test coverage improvements** on existing code.

## What we generally do not accept

- **Loosening the schema constraints in `cli/schema.ts`.** The word counts, block constraints, and banned-superlative list are calibrated to the SOP. If you have evidence a constraint is wrong, open an issue with data — don't open a PR that flips the constraint.
- **Adding markdown parsing.** Inline syntax is intentionally limited to `**bold**`, `*italic*`, `[label](url)`. The rigid contract is the product.
- **New runtime dependencies.** The CLI is deliberately lean (`ai` + provider SDKs, `zod`, `linkedom`). UI is hand-rolled ANSI; argument parsing is hand-rolled. A new dependency needs a strong case.
- **Adding new mandatory page-architecture blocks.** Optional fields can be discussed; mandatory additions break every existing payload.
- **Re-adding a library surface.** v0.7.0 deliberately cut the package to CLI-only. Programmatic consumers should shell out to the CLI's `--json` / `--ndjson` modes.

## Schema changes

The schema (`cli/schema.ts`) and the doctor heuristics (`cli/checks.ts`) are tied to the GEO SOP in `docs/sop.md`. PRs that touch the schema must also update the SOP doc with the rationale for the change. PRs that touch heuristic thresholds must explain the empirical basis in the doc.

A schema change is a breaking event if it tightens a constraint (existing payloads start failing) — major post-1.0, minor pre-1.0. Loosening a constraint or adding optional fields is minor.

## Output-shape stability

The `--json` and `--ndjson` output shapes are public API. Fields are **additive only** — never rename or remove a field without a deprecation note in the CHANGELOG. The saved check-run envelope in `.auto-geo/checks/` follows the same rule (history must keep reading old files).

## Development conventions

### Tests are mandatory

Every PR that touches code must include or update Vitest tests. Coverage thresholds in `vitest.config.ts` are enforced in CI.

### Conventional commits

We use [Conventional Commits](https://www.conventionalcommits.org/) for commit messages:

```
feat(check): add brave engine adapter
fix(doctor): handle pages with no h2 elements
docs(sop): clarify entity density rationale
refactor(run): extract config merge helpers
chore(deps): bump ai sdk
test(history): cover engine-filtered trends
```

The first line is ≤72 characters. The body, if any, explains _why_, not what.

### Code style

`pnpm format` runs Prettier with the repo config. CI runs `pnpm format:check` and `pnpm lint`; PRs with failures will not merge.

### Type safety

`pnpm typecheck` must pass. No `any` without an inline `// eslint-disable-next-line` and a justification comment.

### Branch protection workflow

`main` is protected. All changes go through pull requests — no direct pushes, including from maintainers. CI must be green (lint, typecheck, format:check, test) before a PR is mergeable. Push your branch to `origin`, open a PR using the [PR template](./.github/PULL_REQUEST_TEMPLATE.md), and wait for the checks. If CI is red, fix it on the same branch — don't open a new PR.

## Pull request checklist

Before opening a PR:

- [ ] Tests added or updated; `pnpm test` passes locally.
- [ ] `pnpm typecheck` passes.
- [ ] `pnpm lint` passes with zero warnings.
- [ ] `pnpm format:check` passes.
- [ ] If schema or doctor heuristics changed: `docs/sop.md` updated with rationale.
- [ ] If `--json`/`--ndjson` output changed: fields are additive only and the CHANGELOG notes them.
- [ ] `CHANGELOG.md` updated under the `## [Unreleased]` heading.
- [ ] Commit messages follow Conventional Commits.

## Reporting bugs

Use the [bug report template](./.github/ISSUE_TEMPLATE/bug_report.yml). Include:

- The version of `auto-geo` you're running (`auto-geo --version`).
- The exact command and flags, with `--json` output where applicable.
- The expected vs. actual behavior.
- Node.js version and OS.

## Requesting features

Use the [feature request template](./.github/ISSUE_TEMPLATE/feature_request.yml). Be explicit about:

- The problem you're solving (not the feature you want, the underlying need).
- What you've tried that doesn't work today.
- How you'd expect the feature to fit the workflow (init → doctor → write → fix → check → history).

Feature requests that are mostly preference ("I'd prefer if X was named Y") are unlikely to land.

## Security

If you find a security vulnerability, **do not open a public issue**. See [SECURITY.md](./SECURITY.md) for the disclosure process.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
