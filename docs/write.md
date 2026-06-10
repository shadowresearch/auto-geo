# auto-geo write

Generate publish-ready GEO resource pages from a set of target queries — the questions you want your domain to be cited for inside ChatGPT, Perplexity, Claude, Gemini, and Google AI Overviews.

```bash
npx auto-geo write \
  --domain https://www.shadow.inc \
  --query "what is GEO" \
  --query "GEO vs SEO" \
  --query "how to get cited by ChatGPT" \
  --out ./resources \
  --provider openai \
  --model gpt-4o
```

Each query produces one JSON file in `<out>/<slug>.json`, validated against the canonical [`resourcePublishSchema`](../cli/schema.ts). Files are ready to publish through your own pipeline — CMS import, static-site build, or custom renderer.

## Why this exists

`auto-geo doctor` audits whether a page is shaped for citation. `auto-geo write` produces a page that already passes the audit. It encodes the [GEO SOP](./sop.md) as a system prompt, uses the Vercel AI SDK's `generateObject` with a Zod schema to constrain output, re-validates with the same schema your publish endpoint enforces, and feeds Zod issues back to the model on failure for a bounded self-correction loop.

## Install + auth

The CLI ships with `auto-geo`. The AI SDK and provider packages are installed alongside as runtime dependencies, so a fresh `npx auto-geo` invocation already has everything it needs.

```bash
npx auto-geo write --help
```

Set the API key for the provider you choose:

```bash
export OPENAI_API_KEY=sk-…     # for --provider openai (default)
# or
export ANTHROPIC_API_KEY=sk-…  # for --provider anthropic
```

If the relevant key is missing, the CLI exits with a clear error (exit code 2). `--dry-run` does not require an API key.

## Flags

| Flag                    | Default             | What it does                                                                                            |
| ----------------------- | ------------------- | ------------------------------------------------------------------------------------------------------- |
| `--domain <url>`        | _required_          | Publisher domain. Used to scope internal relatedGuides links.                                           |
| `--query <text>`        | _required, repeats_ | Target query. One page per `--query`.                                                                   |
| `--queries-file <path>` |                     | Newline-separated file of queries. Lines beginning `#` are comments.                                    |
| `--out <dir>`           | `./out`             | Output directory. Created if it doesn't exist.                                                          |
| `--provider <id>`       | `openai`            | LLM provider (`openai` \| `anthropic`).                                                                 |
| `--model <name>`        | provider default    | `gpt-4o-mini` for openai, `claude-sonnet-4-6` for anthropic. Cheap defaults so a small run stays cheap. |
| `--basepath <path>`     | `/resources`        | URL path under your domain where resources are served.                                                  |
| `--author-name <text>`  | Shadow Research     | Used for the page's `author.name`.                                                                      |
| `--author-jobtitle <t>` | …                   | Used for `author.jobTitle`.                                                                             |
| `--author-bio <text>`   | Shadow team bio     | Used for `author.bio`. Pass `@path/to/bio.txt` to read from a file.                                     |
| `--author-linkedin <u>` |                     | Used for `author.linkedinUrl`.                                                                          |
| `--max-retries N`       | `2`                 | Self-correction retries when the LLM draft fails Zod validation.                                        |
| `--concurrency N`       | `2`                 | Parallel LLM calls. Capped at 2 by default to respect rate limits + cost predictability.                |
| `--dry-run`             |                     | Compute the plan + cost estimate without calling the LLM.                                               |
| `--json`                |                     | Emit a machine-readable summary on stdout.                                                              |
| `--no-color`            |                     | Disable ANSI colors even on a TTY.                                                                      |

Exit code: `0` if every page validates and writes; `1` if any page fails after retries; `2` on bad arguments or missing env.

## Slug derivation

The slug is derived from the query: lowercased, kebab-case, with question-form stopwords (`what`, `how`, `is`, `the`, `a`, `to`, `by`, …) stripped. Examples:

| Query                         | Slug                |
| ----------------------------- | ------------------- |
| `what is GEO`                 | `geo`               |
| `how does GEO work?`          | `geo-work`          |
| `GEO vs SEO`                  | `geo-vs-seo`        |
| `how to get cited by ChatGPT` | `get-cited-chatgpt` |

When multiple queries collapse to the same slug, the second and subsequent get `-2`, `-3`, … appended.

## The system prompt

`auto-geo write` ships a single system prompt that encodes the schema's hard rejection criteria and the audit's soft heuristics. Read the canonical version at [`cli/llm.ts`](../cli/llm.ts) (look for `SYSTEM_PROMPT`). Highlights:

- **TL;DR**: 40–60 words, must answer the target query.
- **Answer capsules**: 40–60 words per H2, self-contained.
- **FAQ answers**: 40–60 words each, 3–10 FAQ items.
- **Related guides**: 4–8 entries; mix of internal (`/{basepath}/<slug>`) and authoritative external (Princeton GEO paper, Schema.org, Search Engine Land).
- **Key takeaways**: 4–6 entries, each 10–35 words.
- **H1 title**: the target query phrased as a question.
- **No banned superlatives**: `industry-leading`, `revolutionary`, `cutting-edge`, `world-class`, `next-generation`, etc., unless attributed or inside quotes.
- **No raw HTML**: `**bold**`, `*italic*`, `[text](url)` only.

## Self-correction loop

```
1. LLM call (generateObject) → candidate payload
2. resourcePublishSchema.safeParse → pass or issues[]
3. If pass: write to <out>/<slug>.json, done
4. If fail and attempts < maxRetries:
   - Re-prompt with the previous draft + numbered Zod issues
   - Go to 1
5. If fail and attempts exhausted:
   - Emit a `failed` outcome with the issue list
```

The SDK's `generateObject` already enforces JSON-mode + tool-use against the Zod schema, so the model can't return malformed JSON. But the SDK adapter doesn't run our custom `superRefine` callbacks (word-count windows, banned-superlative regex, table-row consistency), so we re-validate defense-in-depth.

Most validation failures clear on the first retry: the model sees the exact numeric path that's wrong and corrects it.

## Cost estimation

Token usage is read from the AI SDK result (`usage.inputTokens`, `usage.outputTokens`) and multiplied by per-model rates hardcoded in [`cli/cost.ts`](../cli/cost.ts). Cheap-default models are quoted accurately; premium models fall back to a conservative provider default — verify against your billing dashboard.

```text
Total: 3 pages · ~$0.18 spent · 47s elapsed
```

`--dry-run` shows the same line with `estimated` instead of `spent` based on observed per-page token counts (~4.7k tokens).

## Programmatic API

```ts
import { runWrite, DEFAULT_AUTHOR } from "auto-geo/cli/write"; // not a published subpath; for internal use
import { createOpenAI } from "@ai-sdk/openai";

const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY! });
const summary = await runWrite({
  domain: "https://www.shadow.inc",
  queries: ["what is GEO", "GEO vs SEO"],
  outDir: "./resources",
  provider: "openai",
  modelName: "gpt-4o-mini",
  model: openai("gpt-4o-mini"),
  basePath: "/resources",
  author: DEFAULT_AUTHOR,
  publishedAt: "2026-06-02",
  maxRetries: 2,
});
```

The same `runWrite` powers the CLI; it's a single function call so you can wire it into your own pipeline (Inngest job, cron, webhook).

## Troubleshooting

**"OPENAI_API_KEY is not set"** — Export the env var, or switch to `--provider anthropic` with `ANTHROPIC_API_KEY` set.

**"Generated payload failed schema validation after N attempts"** — The model couldn't produce a schema-conformant page. Raise `--max-retries`, switch to a smarter model (`--model gpt-4o`, `--model claude-opus-4-5`), or rephrase the query. Inspect the issue list in the failure output.

**"--provider must be 'openai' or 'anthropic'"** — Only these two providers are wired in. Add a feature request to extend; the AI SDK supports many more.

**Cost surprises** — Always run `--dry-run` first on a large query batch. Tighter cost control: use `--model gpt-4o-mini` or `--model claude-haiku`, both ~10x cheaper than the flagship models.

**Self-link in relatedGuides** — The schema doesn't reject self-links (the audit warns instead). The system prompt instructs the model to avoid them, but if you see one, edit the generated JSON before publishing.

## Re-audit after publish

Once you've published the JSON, point `auto-geo doctor` at the live URL to confirm the page renders with the expected citation signals:

```bash
npx auto-geo doctor https://www.shadow.inc/resources/geo
```
