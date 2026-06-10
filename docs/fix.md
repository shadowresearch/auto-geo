# auto-geo fix

A built-in CLI for generating a GEO-optimized rewrite of any public webpage. Where [`auto-geo doctor`](./doctor.md) tells you what's wrong with a page, `auto-geo fix` produces a `ResourcePublishPayload` that would pass all 8 doctor checks.

```bash
npx auto-geo fix https://www.example.com/some-blog-post --out ./fixed.json
```

The output is a JSON file that conforms to the canonical [`resourcePublishSchema`](../cli/schema.ts). Publish it through your own pipeline and render at `/<basepath>/<slug>`; the structured fields map directly onto Article, BreadcrumbList, and FAQPage JSON-LD.

## What it does

The `fix` pipeline orchestrates five steps:

1. **Fetch + parse** the source URL via the same `cli/fetch.ts` the doctor uses.
2. **Audit** the parsed page with the existing doctor heuristics (`cli/checks.ts`) for the "before" report.
3. **Generate** a rewrite by calling the configured LLM provider via the Vercel AI SDK (`generateObject` against `resourcePublishSchema` as the typed-output target). The prompt embeds the GEO SOP as a system prompt and the doctor report + source-page text as the user prompt.
4. **Validate** the LLM output against `resourcePublishSchema`. If parsing fails, the Zod issues are fed back as a follow-up user message and the call is retried (up to `--max-retries`, default 2).
5. **Write** the validated payload to `--out` (default `./fixed.json`).

## Install

`auto-geo fix` ships with the `auto-geo` package — no separate install. The AI SDK (`ai`, `@ai-sdk/openai`, `@ai-sdk/anthropic`) is bundled as a runtime dependency so a fresh `npx` invocation works without extra setup. Node `>=18.17` required.

```bash
# One-shot
npx auto-geo@latest fix https://example.com/page --out ./fixed.json

# Installed locally
pnpm add auto-geo
pnpm exec auto-geo fix https://example.com/page --out ./fixed.json
```

## Usage

```text
auto-geo fix <url> [flags]
```

Flags:

| Flag                    | Default        | What it does                                                                         |
| ----------------------- | -------------- | ------------------------------------------------------------------------------------ |
| `--out <path>`          | `./fixed.json` | Output file path for the generated payload JSON.                                     |
| `--provider <p>`        | `openai`       | `openai` or `anthropic`.                                                             |
| `--model <name>`        | `gpt-4o-mini`  | Provider model. Pass any model string the provider accepts.                          |
| `--max-retries N`       | `2`            | Self-correction retries when the LLM output fails `resourcePublishSchema.safeParse`. |
| `--dry-run`             | off            | Fetch + audit + estimate cost. Skip the LLM call. Useful for cost-estimation in CI.  |
| `--json`                | off            | Emit machine-readable JSON instead of the human report.                              |
| `--basepath <path>`     | `/resources`   | Publish base path for the URL preview line.                                          |
| `--author-name <s>`     | —              | Author name (propagated into `payload.author.name`).                                 |
| `--author-jobtitle <s>` | —              | Author job title.                                                                    |
| `--author-bio <s>`      | —              | Author bio (must be ≥20 chars to satisfy the schema).                                |
| `--author-linkedin <u>` | —              | Author LinkedIn URL. Drives `Person.sameAs` in the auto-emitted JSON-LD.             |

## Environment variables

The fix CLI authenticates to the chosen provider via the standard environment variable:

- **`OPENAI_API_KEY`** — required when `--provider openai`.
- **`ANTHROPIC_API_KEY`** — required when `--provider anthropic`.

Missing keys produce a clear error before any network is issued; the dry-run flag does not require a key.

## Example session

```text
$ npx auto-geo fix https://www.example.com/some-blog-post \
    --out ./fixed.json \
    --provider openai \
    --model gpt-4o-mini

auto-geo fix — generate a GEO-optimized rewrite
url:      https://www.example.com/some-blog-post
fetched:  1,247 words

Audit (before):
✗ TL;DR present
✗ Question-format H2 headings (2 of 6)
✗ Article JSON-LD present
✗ FAQPage JSON-LD present
✓ Entity density (12.3/1k)
✗ Image cadence (0/page)
✓ Answer-first first paragraph
✗ Self-link detected

Score (before): 3 / 8

Generating rewrite via openai gpt-4o-mini...

Audit (projected for rewrite):
✓ TL;DR present (52 words)
✓ Question-format H2 headings (6 of 6)
✓ Article JSON-LD (auto-emitted by ResourceArticle renderer)
✓ FAQPage JSON-LD (auto-emitted)
✓ Entity density (18.1/1k)
✓ Image cadence (n/a — payload doesn't include images yet; add via the publish endpoint)
✓ Answer-first first paragraph
✓ No self-link

Score (projected): 8 / 8 — strong GEO posture

→ ./fixed.json (validated by resourcePublishSchema)
Total: ~$0.04 estimated · 12s elapsed

Next steps:
  1. Review ./fixed.json (especially TL;DR + FAQ — the citation-target chunks)
  2. Publish to your endpoint
  3. Re-audit: npx auto-geo doctor https://www.example.com/<new-slug>
```

## How the prompt is constructed

The system prompt is a deliberately compact digest of the [GEO SOP](./sop.md):

- The seven-block page architecture in order.
- Every hard rule the schema enforces (word counts, slug regex, banned promotional language, etc.).
- The empirical quality drivers (question-format H2s, entity density ≥15, answer-first ledes, self-contained answer capsules).
- A note that JSON-LD is **auto-emitted** by the renderer from the typed payload — the LLM should not generate it.

The user prompt adds:

- The source URL.
- A digested doctor report with pass/fail for each of the 8 checks and the imperative fix suggestion for the failing ones.
- The source page text, truncated to ~24,000 characters with a head/tail split so the LLM sees both the opening and the closing material. Public web pages can be hundreds of KB; without a cap, the context window blows up before generation begins.
- An optional author block built from the `--author-*` flags. The schema requires `author.{name, jobTitle, bio}`; if any are missing, the LLM is told to invent reasonable defaults that satisfy the schema.

## Self-correction loop

The LLM occasionally emits a payload that satisfies `generateObject`'s in-transit type-check but fails the stricter `resourcePublishSchema.safeParse` (typically on word-count refinements or the slug regex). When this happens:

1. The Zod issues are formatted as a bulleted list with the field path.
2. The original user prompt is concatenated with a follow-up instruction: "Your previous output failed schema validation. Fix every issue below and emit a NEW payload that satisfies the schema."
3. The call is retried.

After `--max-retries` failed attempts (default 2, so up to 3 total calls), the CLI throws with the final Zod issue list.

## Cost model

The "Total: ~$0.04 estimated" line is a rough USD estimate derived from a small in-process price table covering the common OpenAI and Anthropic models. The model assumes:

- ~4 characters per token for input (a standard heuristic).
- ~2,000 output tokens for a typical full payload.

The estimate is for budgeting; the actual cost is whatever your provider bills. The dry-run mode prints the estimate without issuing a request.

## Auto-emitted JSON-LD

Two of the doctor checks — `article-jsonld` and `faqpage-jsonld` — are renderer concerns: the structured fields on the payload map directly onto `Article`, `BreadcrumbList`, `FAQPage`, `Person`, and `ImageObject` JSON-LD blocks, so whatever renders the payload should emit them mechanically. The LLM does not need to generate any JSON-LD itself; the projected-audit lines for those two checks call this out explicitly.

## Programmatic API

The orchestrator is also importable for callers that want to embed `fix` in their own tooling:

```ts
import { runFix } from "auto-geo/cli/fix";

const outcome = await runFix({
  url: "https://example.com/page",
  out: "./fixed.json",
  provider: "openai",
  model: "gpt-4o-mini",
  maxRetries: 2,
  dryRun: false,
  json: false,
  basePath: "/resources",
});

console.log(outcome.before.scorePct, "→", outcome.after.scorePct);
console.log(outcome.payload);
```

All network, LLM, and filesystem dependencies are injectable for testing — see `tests/fix.test.ts` for the patterns.

## Troubleshooting

- **"OPENAI_API_KEY is not set"** — Export the key (`export OPENAI_API_KEY=sk-…`) before invoking. The dry-run flag does not require a key.
- **"Generated payload failed final schema validation"** — The LLM's output failed `resourcePublishSchema.safeParse` even after `--max-retries`. Bump `--max-retries 4` or switch to a more capable model (`gpt-4o`, `claude-sonnet-4-5`).
- **Sluggish on a large page** — The source text is capped at ~24,000 characters by default; very long pages get a head/tail summarized window. The LLM call itself is what takes the bulk of the time.
- **Wants to add images to the payload** — Image blocks are not synthesized by the fix CLI. Edit the JSON before publishing, or POST it as-is and add images via a follow-up publish (the publish endpoint is idempotent on slug).
