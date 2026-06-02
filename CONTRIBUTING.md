# Contributing to auto-geo

Thanks for your interest in contributing. `auto-geo` is built by [Shadow](https://www.shadow.inc) and maintained as a public good for the GEO community. We welcome bug reports, schema improvements, new storage adapters, additional HTTP adapters, framework integrations, and documentation refinements.

## Code of Conduct

Participation in this project is governed by our [Code of Conduct](./CODE_OF_CONDUCT.md). By participating, you agree to uphold it.

## Quick start

```bash
git clone https://github.com/shadowresearch/auto-geo.git
cd auto-geo
pnpm install
pnpm test          # run the Vitest suite
pnpm typecheck     # tsc --noEmit
pnpm lint
```

The example app:

```bash
cd examples/next-minimal
cp .env.example .env.local
pnpm dev
```

## What we accept

- **Bug fixes** to existing behavior, with a regression test.
- **New storage adapters** that implement `ContentStore` from `core/store.ts` and ship with unit tests.
- **New HTTP adapters** (Express, Fastify, Elysia, etc.) that wrap `core/publish.ts`'s `runPublish`/`runDelete` and follow the same status-code conventions as `adapters/http/next.ts`.
- **Renderer improvements** that keep the seven-block architecture intact.
- **Documentation** — typos, clarifications, additional examples, translation of the SOP.
- **Test coverage improvements** on existing code.

## What we generally do not accept

- **Loosening the schema constraints in `core/schema.ts`.** The word counts, block constraints, and banned-superlative list are calibrated to the SOP. If you have evidence a constraint is wrong, open an issue with data — don't open a PR that flips the constraint.
- **Adding markdown parsing.** Inline syntax is intentionally limited to `**bold**`, `*italic*`, `[label](url)`. The rigid contract is the product.
- **Breaking changes to the `ContentStore` interface.** It is a public API; the bar for changing it is a deprecation cycle.
- **Adding new mandatory page-architecture blocks.** Optional fields can be discussed; mandatory additions break every existing payload.

## Schema changes

The schema (`core/schema.ts`) and validation heuristics (`core/validation.ts`) are tied to the GEO SOP in `docs/sop.md`. PRs that touch the schema must also update the SOP doc with the rationale for the change. PRs that touch validation thresholds must explain the empirical basis in the doc.

A schema change is a semver-major event if it tightens a constraint (existing payloads start failing). Loosening a constraint is semver-minor. Adding optional fields is semver-minor.

## Development conventions

### Tests are mandatory

Every PR that touches code must include or update Vitest tests. Coverage thresholds in `vitest.config.ts` are enforced in CI.

### Conventional commits

We use [Conventional Commits](https://www.conventionalcommits.org/) for commit messages:

```
feat(schema): allow optional H4 block type
fix(jsonld): escape U+2028 in safeJsonLd
docs(sop): clarify entity density rationale
refactor(publish): extract validation into runValidation
chore(deps): bump zod to 3.24
test(memory-store): cover limit/offset edge cases
```

The first line is ≤72 characters. The body, if any, explains _why_, not what.

### Code style

`pnpm format` runs Prettier with the repo config. CI runs `pnpm format:check` and `pnpm lint`; PRs with failures will not merge.

### Type safety

`pnpm typecheck` must pass. No `any` without an inline `// eslint-disable-next-line` and a justification comment.

## Pull request checklist

Before opening a PR:

- [ ] Tests added or updated; `pnpm test` passes locally.
- [ ] `pnpm typecheck` passes.
- [ ] `pnpm lint` passes with zero warnings.
- [ ] `pnpm format:check` passes.
- [ ] If schema or validation changed: `docs/sop.md` updated with rationale.
- [ ] If a new storage or HTTP adapter: it follows the existing adapter's structure and includes tests.
- [ ] `CHANGELOG.md` updated under the `## [Unreleased]` heading.
- [ ] Commit messages follow Conventional Commits.

## Reporting bugs

Use the [bug report template](./.github/ISSUE_TEMPLATE/bug_report.yml). Include:

- The version of `auto-geo` you're running.
- A minimal reproduction (a payload that should pass but doesn't, or vice versa).
- The expected vs. actual behavior.
- Node.js version and runtime (Node, Bun, Vercel Functions, etc.).

## Requesting features

Use the [feature request template](./.github/ISSUE_TEMPLATE/feature_request.yml). Be explicit about:

- The problem you're solving (not the feature you want, the underlying need).
- What you've tried that doesn't work today.
- How you'd expect the feature to integrate with the existing schema / publish / render pipeline.

Feature requests that are mostly preference ("I'd prefer if X was named Y") are unlikely to land.

## Security

If you find a security vulnerability, **do not open a public issue**. See [SECURITY.md](./SECURITY.md) for the disclosure process.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
