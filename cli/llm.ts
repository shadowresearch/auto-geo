import type { LanguageModel } from "ai";
import { generateObject, NoObjectGeneratedError } from "ai";
import { z } from "zod";
import {
  resourcePublishSchema,
  type ResourceAuthor,
  type ResourcePublishPayload,
} from "../core/schema";

/**
 * Shared LLM helper for the `auto-geo write` CLI. Wraps the Vercel AI
 * SDK's `generateObject` so consumers can swap providers via a
 * `--provider` flag and we re-validate every payload against the
 * canonical `resourcePublishSchema` defense-in-depth.
 *
 * Design notes:
 *
 * - `generateObject` enforces JSON-mode + tool-use against the schema
 *   we hand it, so the LLM cannot return malformed JSON. But the SDK's
 *   Zod adapter doesn't run our `superRefine` callbacks (word counts,
 *   banned superlatives, etc.), so we re-validate with
 *   `resourcePublishSchema.safeParse` after the call.
 *
 * - On validation failure we re-prompt up to `maxRetries` times,
 *   feeding the Zod issues back to the model as a self-correction
 *   loop. We never make the loop unbounded — cost and time both blow
 *   up otherwise.
 *
 * - This module is provider-agnostic. The CLI passes a resolved
 *   `LanguageModel` from `@ai-sdk/openai` or `@ai-sdk/anthropic` so
 *   the `fix` agent can reuse `generateResourcePayload` against its
 *   own caller-resolved model.
 *
 * - Token usage is surfaced for cost reporting (`usage` on the SDK
 *   result). The cost table lives in `cli/cost.ts` so users can audit
 *   the per-token rates.
 */

// ── Public types ──────────────────────────────────────────────────

export type ProviderId = "openai" | "anthropic";

/**
 * Alias retained for `cli/fix.ts` and the v0.1.3-era CLI surface that
 * referred to the provider type as `LlmProvider`. New code should use
 * `ProviderId`; the alias is kept so the public type surface stays
 * additive across the `fix` + `write` merge.
 */
export type LlmProvider = ProviderId;

export type GenerateResourceUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type GenerateResourceOptions = {
  /** Resolved `LanguageModel` instance from the AI SDK provider package. */
  model: LanguageModel;
  /** Provider id — informational, used for cost lookup. */
  provider: ProviderId;
  /** Model name string — informational, used for cost lookup + logs. */
  modelName: string;
  /** Publisher domain (used for internal relatedGuides links). */
  domain: string;
  /** Base path under which the publisher serves resources (default /resources). */
  basePath: string;
  /** The target query the page must be cited for. */
  query: string;
  /** Author block — applied verbatim to the generated payload. */
  author: ResourceAuthor;
  /** Slug derived from the query — set deterministically by the caller. */
  slug: string;
  /** Today's date in yyyy-mm-dd; used for `publishedAt`. */
  publishedAt: string;
  /** Maximum re-prompt attempts on validation failure. Default 2. */
  maxRetries?: number;
  /** Optional system-prompt override — exported mainly for tests + docs. */
  systemPrompt?: string;
  /**
   * Optional source-page plain text. The `fix` subcommand populates this
   * with the original page's prose so the model can rewrite-with-context
   * rather than draft greenfield. Truncated to `sourceTextMaxChars`
   * before being embedded in the prompt to bound input cost.
   */
  sourceText?: string;
  /** Optional source-page URL — included verbatim in the user prompt. */
  sourceUrl?: string;
  /**
   * Optional doctor report digest — the "before" audit, included so the
   * model knows which checks failed on the source page and why. `fix`
   * populates this; `write` leaves it undefined.
   */
  doctorReport?: string;
  /**
   * Truncate source-page text to this many characters before embedding
   * in the user prompt. Default: 24,000 (~6k tokens). Only used when
   * `sourceText` is provided.
   */
  sourceTextMaxChars?: number;
};

export type GenerateResourceResult = {
  payload: ResourcePublishPayload;
  usage: GenerateResourceUsage;
  /** Number of self-correction retries that were needed (0 = first try). */
  retries: number;
  /**
   * Total attempts made (1 on first-try success; retries + 1 on later
   * success). Surfaced for the `fix` CLI's "self-correction fired"
   * line so users see how many LLM calls were billed.
   */
  attempts: number;
  /** Elapsed wall time in milliseconds. */
  elapsedMs: number;
};

// ── Prompt template ───────────────────────────────────────────────

/**
 * The GEO SOP digest as a system prompt. Encodes the hard rules
 * enforced by `core/schema.ts` (word counts, count ranges, banned
 * superlatives, slug regex, no raw HTML) and the soft heuristics from
 * `core/validation.ts` + `cli/checks.ts` (question-format H2s, entity
 * density, image cadence, answer-first lede).
 *
 * Kept in this module — not in a separate file — so the LLM helper is
 * one file the `fix` agent can read end-to-end.
 */
export const SYSTEM_PROMPT = `You are auto-geo, a publishing engine that drafts GEO (Generative Engine Optimization) resource pages — the pages large language models cite when answering user queries.

Every payload you produce MUST satisfy the auto-geo resourcePublishSchema. The schema is enforced server-side; malformed pages are rejected.

# Hard rules (rejection criteria)

1. **TL;DR**: tldr.text must be 40-60 words (words counted by whitespace, after stripping markdown inline syntax). It must directly answer the target query.
2. **Answer capsules**: every section.answerCapsule must be 40-60 words. The capsule must answer the section's H2 question by itself.
3. **FAQ answers**: every faq.items[].answer must be 40-60 words.
4. **Related guides**: relatedGuides.items must have between 4 and 8 entries. Use a mix of internal links under the publisher domain (paths like \`/{basePath}/<slug>\`) and authoritative external links (Princeton GEO paper at https://arxiv.org/abs/2311.09735, Search Engine Land, Schema.org, Google blog, OpenAI / Anthropic / Perplexity primary sources).
5. **Key takeaways**: keyTakeaways.items must have 4-6 entries; each takeaway 10-35 words.
6. **FAQ**: faq.items must have 3-10 entries; questions 5-300 characters.
7. **Sections**: ≥1 H2 section; each section's body blocks 0-40 items.
8. **No raw HTML** inside any prose field. Use inline syntax only: \`**bold**\`, \`*italic*\`, \`[text](url)\`.
9. **No banned promotional superlatives** unattributed: "industry-leading", "best-in-class", "revolutionary", "game-changing", "cutting-edge", "world-class", "the leading", "the premier", "next-generation", "first-of-its-kind". If you must use them, attribute the claim (e.g., \`#1 ranked by [Named Source]\`) or place inside straight double-quotes.
10. **Slug regex**: \`^[a-z0-9]+(-[a-z0-9]+)*$\` — lowercase letters/digits/single hyphens only. The caller will pre-fill this; do not change it.
11. **All URLs absolute** with scheme. Relative paths only allowed where the schema explicitly accepts them — \`relatedGuides\` requires full URLs.
12. **metaDescription**: 50-180 characters. **excerpt**: 50-400 characters. **author.bio**: 20-600 characters.
13. **Dates**: yyyy-mm-dd only (no full ISO timestamps).
14. **Tables** (if you use them): every row must have the same number of cells as headers.
15. **Image alt text**: ≥20 chars; include the entity name + context.

# Soft heuristics (don't reject but degrade citation)

- **H2 headings in question form**: end each H2 with a question mark. Phrase H2s as the questions a user would ask an AI engine.
- **Entity density**: ≥8 named entities (companies, people, products, frameworks) per 1,000 words. Wikipedia-style proper-noun chains like "Google AI Overviews" count as one entity.
- **Image cadence**: ~1 image per 500 words of body content.
- **Answer-first lede**: the first paragraph of the intro must open with a declarative answer, not "In this article we will…", "Let's explore…", "Welcome…".
- **Paragraph length**: 60-100 words per paragraph in section bodies.
- **Section total**: 134-167 words per section (heading + answer capsule + blocks).
- **Outbound links**: 1-2 outbound links per H2 to non-self authoritative domains.
- **Statistics density**: ≥3 stats (percentages, counts, dollar figures) per 1,000 words.

# Content quality bar

- The H1/title MUST be the target query phrased as a question. If the query is already a question, use it directly; otherwise rewrite as a question ("GEO vs SEO" → "How does GEO differ from SEO?").
- The TL;DR MUST directly answer the target query in 40-60 words. No throat-clearing.
- Use the publisher's domain for INTERNAL related guides via paths like \`/<basePath>/<slug>\`. Use full external URLs for the rest (Princeton GEO paper, Schema.org, Search Engine Land, Google blog).
- Cite primary sources (papers, vendor docs, blog posts from the company in question) — not aggregator content.
- Write for AI engines and human readers simultaneously: structured, entity-dense, factually grounded, and free of marketing fluff.

# Output

Return a single resourcePublishSchema-conformant JSON object. No prose, no preamble.`;

export function buildUserPrompt(opts: {
  domain: string;
  basePath: string;
  query: string;
  slug: string;
  author: ResourceAuthor;
  publishedAt: string;
  /** Source-page URL (fix-mode only). */
  sourceUrl?: string;
  /** Source-page plain text (fix-mode only). */
  sourceText?: string;
  /** Doctor-report digest of the source page (fix-mode only). */
  doctorReport?: string;
  /** Cap on `sourceText` characters embedded in the prompt. */
  sourceTextMaxChars?: number;
}): string {
  const internalLink = `${stripTrailingSlash(opts.domain)}${ensureLeadingSlash(opts.basePath)}/<related-slug>`;
  const rewriteMode = Boolean(
    opts.sourceText || opts.sourceUrl || opts.doctorReport
  );

  const verb = rewriteMode ? "Rewrite the source page below as" : "Draft";
  const lines: string[] = [];
  lines.push(
    `${verb} a GEO resource page for the publisher at ${opts.domain}.`
  );
  lines.push("");
  lines.push(`Target query: ${JSON.stringify(opts.query)}`);
  lines.push(`Slug (use exactly): ${JSON.stringify(opts.slug)}`);
  lines.push(`publishedAt (use exactly): ${JSON.stringify(opts.publishedAt)}`);
  lines.push(
    "Internal relatedGuides URLs should be on the publisher's domain, shaped like:"
  );
  lines.push(`  ${internalLink}`);
  lines.push(
    "External relatedGuides URLs should cite authoritative non-self sources."
  );
  lines.push("");
  lines.push("Author (use exactly):");
  lines.push(JSON.stringify(opts.author, null, 2));

  if (opts.sourceUrl) {
    lines.push("");
    lines.push(`Source URL: ${opts.sourceUrl}`);
  }
  if (opts.doctorReport) {
    lines.push("");
    lines.push("Audit report for the source page (this is what's wrong now):");
    lines.push(opts.doctorReport);
  }
  if (opts.sourceText) {
    const max = opts.sourceTextMaxChars ?? DEFAULT_SOURCE_TEXT_MAX_CHARS;
    const text = truncateText(opts.sourceText, max);
    lines.push("");
    lines.push(
      "Source page text (preserve substantive claims; restructure for citation extraction):"
    );
    lines.push("```");
    lines.push(text);
    lines.push("```");
  }

  lines.push("");
  lines.push("Constraints:");
  lines.push("- The H1/title MUST be the target query phrased as a question.");
  lines.push(
    "- The TL;DR MUST directly answer the target query in 40-60 words."
  );
  lines.push('- All H2 headings MUST end in "?".');
  lines.push(
    "- Every H2's answerCapsule MUST be 40-60 words and self-contained."
  );
  lines.push("- Every FAQ answer MUST be 40-60 words.");
  lines.push("- 4-8 relatedGuides items (mix internal + external).");
  lines.push("- 4-6 keyTakeaways items, each 10-35 words.");
  lines.push("- 3-10 FAQ items.");
  lines.push(
    '- pageType "resource"; optimizationFramework includes "GEO"; targetPlatforms covers chatgpt + perplexity + google_aio at minimum.'
  );
  lines.push('- refreshCadence "quarterly".');
  if (rewriteMode) {
    lines.push(
      "- The rewrite must pass all 8 doctor checks (TL;DR present, question-format H2s, Article + FAQPage JSON-LD, entity density, image cadence, answer-first first paragraph, no self-link)."
    );
    lines.push(
      "- Preserve the source author's substantive claims, facts, and statistics — do not invent facts."
    );
  }

  return lines.join("\n");
}

const DEFAULT_SOURCE_TEXT_MAX_CHARS = 24_000;

/**
 * Truncate text by character count, keeping a balanced head + tail
 * window. A head-only truncate would lose closing material like a
 * trailing FAQ block; an even head+tail split keeps the LLM aware of
 * both ends of the source page.
 */
function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const headChars = Math.floor(maxChars * 0.7);
  const tailChars = maxChars - headChars - 24; // 24 ≈ separator length
  const head = text.slice(0, headChars).trimEnd();
  const tail = text.slice(-tailChars).trimStart();
  return `${head}\n\n[…truncated for context window…]\n\n${tail}`;
}

// ── Generator ─────────────────────────────────────────────────────

/**
 * Generate a `ResourcePublishPayload` for a single target query. Calls
 * the LLM via the AI SDK, validates against the canonical schema, and
 * retries with the Zod issues fed back to the model on failure.
 */
export async function generateResourcePayload(
  opts: GenerateResourceOptions
): Promise<GenerateResourceResult> {
  const startedAt = Date.now();
  const maxRetries = opts.maxRetries ?? 2;
  const system = opts.systemPrompt ?? SYSTEM_PROMPT;
  const baseUserPrompt = buildUserPrompt({
    domain: opts.domain,
    basePath: opts.basePath,
    query: opts.query,
    slug: opts.slug,
    author: opts.author,
    publishedAt: opts.publishedAt,
    sourceUrl: opts.sourceUrl,
    sourceText: opts.sourceText,
    doctorReport: opts.doctorReport,
    sourceTextMaxChars: opts.sourceTextMaxChars,
  });

  let totalInput = 0;
  let totalOutput = 0;
  let totalTotal = 0;
  let lastIssues: z.ZodIssue[] = [];
  let lastDraft: unknown = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const userPrompt =
      attempt === 0
        ? baseUserPrompt
        : `${baseUserPrompt}

The previous draft failed schema validation. Fix every issue and return a new payload.

Previous draft (for context):
${JSON.stringify(lastDraft, null, 2)}

Validation issues (each must be resolved):
${formatIssues(lastIssues)}`;

    // We accept generateObject's loose schema typing and validate strictly
    // ourselves with `resourcePublishSchema` below — the SDK's Zod adapter
    // doesn't run `superRefine` callbacks.
    let result;
    try {
      result = await generateObject({
        model: opts.model,
        system,
        prompt: userPrompt,
        // Pass the schema to the SDK — it constrains JSON output but
        // doesn't enforce our custom refinements.
        schema:
          resourcePublishSchema as unknown as z.ZodType<ResourcePublishPayload>,
      });
    } catch (err) {
      // The SDK throws NoObjectGeneratedError when the model fails to
      // produce JSON at all. Surface as a structured error on the final
      // attempt; otherwise loop.
      if (attempt === maxRetries || !(err instanceof NoObjectGeneratedError)) {
        throw err;
      }
      lastDraft = null;
      lastIssues = [
        {
          code: "custom",
          path: [],
          message: `Model did not return parseable JSON: ${
            err instanceof Error ? err.message : String(err)
          }. Return a single JSON object matching the schema.`,
        } as z.ZodIssue,
      ];
      continue;
    }

    if (result.usage) {
      totalInput += result.usage.inputTokens ?? 0;
      totalOutput += result.usage.outputTokens ?? 0;
      totalTotal += result.usage.totalTokens ?? 0;
    }

    const parsed = resourcePublishSchema.safeParse(result.object);
    if (parsed.success) {
      return {
        payload: parsed.data,
        usage: {
          inputTokens: totalInput,
          outputTokens: totalOutput,
          totalTokens: totalTotal,
        },
        retries: attempt,
        attempts: attempt + 1,
        elapsedMs: Date.now() - startedAt,
      };
    }

    lastDraft = result.object;
    lastIssues = parsed.error.issues;
  }

  // Exhausted retries — surface the Zod issues as a structured error.
  const err = new SchemaValidationError(
    `Generated payload failed schema validation after ${maxRetries + 1} attempts.`,
    lastIssues
  );
  err.usage = {
    inputTokens: totalInput,
    outputTokens: totalOutput,
    totalTokens: totalTotal,
  };
  throw err;
}

// ── Error type ────────────────────────────────────────────────────

export class SchemaValidationError extends Error {
  readonly issues: z.ZodIssue[];
  usage?: GenerateResourceUsage;
  constructor(message: string, issues: z.ZodIssue[]) {
    super(message);
    this.name = "SchemaValidationError";
    this.issues = issues;
  }
}

// ── Helpers ───────────────────────────────────────────────────────

export function formatIssues(issues: z.ZodIssue[]): string {
  if (issues.length === 0) return "(no issues)";
  return issues
    .map((iss, i) => {
      const path = iss.path.length === 0 ? "<root>" : iss.path.join(".");
      return `${i + 1}. [${path}] ${iss.message}`;
    })
    .join("\n");
}

function stripTrailingSlash(s: string): string {
  return s.replace(/\/+$/, "");
}

function ensureLeadingSlash(s: string): string {
  if (!s) return "/";
  return s.startsWith("/") ? s : `/${s}`;
}

// ── Cost estimator (used by `auto-geo fix` for pre-call posture) ──

/**
 * Per-1k-token prices (USD) for a small set of well-known models.
 * Used only for the pre-generation cost estimate the CLI prints — the
 * actual cost is whatever the provider bills. The authoritative cost
 * table for `auto-geo write` lives in `cli/cost.ts`; this minimal
 * inline table exists so `cli/fix.ts` can render a single estimate
 * before the LLM call without dragging in the cost module.
 */
const FIX_COST_TABLE: Record<
  string,
  { inputPer1k: number; outputPer1k: number }
> = {
  "gpt-4o-mini": { inputPer1k: 0.00015, outputPer1k: 0.0006 },
  "gpt-4o": { inputPer1k: 0.0025, outputPer1k: 0.01 },
  "gpt-4.1-mini": { inputPer1k: 0.0004, outputPer1k: 0.0016 },
  "gpt-4.1": { inputPer1k: 0.002, outputPer1k: 0.008 },
  "claude-3-5-haiku-latest": { inputPer1k: 0.0008, outputPer1k: 0.004 },
  "claude-3-5-sonnet-latest": { inputPer1k: 0.003, outputPer1k: 0.015 },
  "claude-haiku-4-5": { inputPer1k: 0.001, outputPer1k: 0.005 },
  "claude-sonnet-4-5": { inputPer1k: 0.003, outputPer1k: 0.015 },
  "claude-sonnet-4-6": { inputPer1k: 0.003, outputPer1k: 0.015 },
  "claude-opus-4-5": { inputPer1k: 0.015, outputPer1k: 0.075 },
};

const FIX_DEFAULT_COST = { inputPer1k: 0.001, outputPer1k: 0.005 };

/**
 * Very rough USD estimate for one generation call. Counts ~4 chars/token
 * for input and assumes ~2k output tokens for a typical resource payload.
 *
 * Intended for the "Total: ~$0.04 estimated" footer — not accounting.
 * The `write` CLI uses the canonical per-usage cost table in `cli/cost.ts`.
 */
export function estimateGenerationCostUsd(args: {
  model: string;
  inputChars: number;
  /** Output token estimate. Defaults to 2,000 — a typical full payload. */
  outputTokens?: number;
}): number {
  const inputTokens = Math.ceil(args.inputChars / 4);
  const outputTokens = args.outputTokens ?? 2_000;
  const rate = FIX_COST_TABLE[args.model] ?? FIX_DEFAULT_COST;
  return (
    (inputTokens / 1_000) * rate.inputPer1k +
    (outputTokens / 1_000) * rate.outputPer1k
  );
}

// ── Model resolver (used by `auto-geo fix`) ──────────────────────

/**
 * Resolve a `LanguageModel` from `(provider, modelName, apiKey)`.
 * Async + dynamic-import so the AI SDK provider packages aren't loaded
 * until the user actually invokes a subcommand that hits a provider —
 * keeping `auto-geo doctor` startup fast.
 *
 * `auto-geo write` resolves the model in `cli/run.ts` for the same
 * reason; this helper exists so `cli/fix.ts` (which has its own
 * orchestrator entry point that accepts an `apiKey` flag) can share the
 * exact same resolver wiring.
 */
export async function getLanguageModel(
  provider: ProviderId,
  modelName: string,
  apiKey: string
) {
  if (provider === "openai") {
    const { createOpenAI } = await import("@ai-sdk/openai");
    return createOpenAI({ apiKey })(modelName);
  }
  if (provider === "anthropic") {
    const { createAnthropic } = await import("@ai-sdk/anthropic");
    return createAnthropic({ apiKey })(modelName);
  }
  throw new Error(
    `unknown provider "${String(provider)}"; expected "openai" or "anthropic"`
  );
}
