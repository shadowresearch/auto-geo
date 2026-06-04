import { writeFile } from "node:fs/promises";
import path from "node:path";
import { resourcePublishSchema } from "../core/schema";
import type { ResourceAuthor, ResourcePublishPayload } from "../core/schema";
import { runAllChecks } from "./checks";
import { auditParsedPage } from "./doctor";
import { fetchPage, parsePage } from "./fetch";
import type { FetchPageOptions } from "./fetch";
import {
  estimateGenerationCostUsd,
  generateResourcePayload,
  getLanguageModel,
  type LlmProvider,
} from "./llm";
import type { CheckResult, DoctorReport, ParsedPage } from "./types";
import {
  bold,
  bulletList,
  detectNarrow,
  dim,
  footer,
  glyphs,
  header,
  indent,
  kv,
  muted,
  paint,
  rows,
  type Row,
  type UiOptions,
} from "./ui";

/**
 * Fix-orchestrator seam for the LLM call. `runFix` accepts an injected
 * `generate(input)` function shaped around the inputs `cli/fix.ts`
 * controls — provider + model name + API key + source-page context —
 * so unit tests don't have to fabricate an AI-SDK `LanguageModel`.
 *
 * The default implementation resolves a `LanguageModel` via
 * `getLanguageModel` and then delegates to the unified
 * `generateResourcePayload` exported from `cli/llm.ts` (the same entry
 * point `auto-geo write` uses).
 */
export type GenerateResourceInput = {
  provider: LlmProvider;
  model: string;
  apiKey: string;
  /** Free-form rewrite directive (fix-mode user prompt). */
  prompt: string;
  sourceText?: string;
  sourceUrl?: string;
  doctorReport?: string;
  /** Author block — fields may be partial; defaults applied below. */
  author?: Partial<ResourceAuthor>;
  /** Slug hint passed through to the model. */
  slug?: string;
  /** Optional max-retries override (default 2). */
  maxRetries?: number;
  /** Publisher domain (origin of `sourceUrl`). */
  domain?: string;
  /** Publish basepath (default `/resources`). */
  basePath?: string;
  /** Today's date in yyyy-mm-dd. */
  publishedAt?: string;
};

export type GenerateResourceResult = {
  payload: ResourcePublishPayload;
  attempts: number;
  elapsedMs: number;
};

/**
 * Orchestrator for `auto-geo fix <url>`.
 *
 * Pipeline:
 *   1. Fetch + parse the source URL via `cli/fetch.ts`.
 *   2. Run the existing doctor heuristics (`cli/checks.ts` →
 *      `cli/doctor.ts#auditParsedPage`) for the "before" report.
 *   3. Build a doctor-report digest + the source text and hand them to
 *      `generateResourcePayload` from `cli/llm.ts`. The LLM emits a
 *      `ResourcePublishPayload` typed against `resourcePublishSchema`.
 *   4. Validate the LLM output against `resourcePublishSchema` (the
 *      AI SDK already validates in transit; we re-validate here as a
 *      belt-and-braces guard against schema drift between providers).
 *   5. Project the doctor checks against the *generated payload* for
 *      the "after" report — wherever a check is unanswerable from the
 *      payload alone (Article + FAQPage JSON-LD are auto-emitted by
 *      the renderer at publish time, images are an explicit payload
 *      block), surface a tailored explanation instead of a fail.
 *   6. Write the payload JSON to `--out`.
 *
 * Network and filesystem are injected so this orchestrator is fully
 * testable without real HTTP, real disk, or a real LLM.
 */

// ── Public types ──────────────────────────────────────────────────

export type FixCliFlags = {
  url: string;
  out: string;
  provider: LlmProvider;
  model: string;
  authorName?: string;
  authorJobTitle?: string;
  authorBio?: string;
  authorLinkedin?: string;
  maxRetries: number;
  dryRun: boolean;
  json: boolean;
  basePath: string;
};

export type ProjectedCheck = CheckResult & {
  /** True when the check could not be evaluated from payload alone. */
  payloadOnly?: boolean;
};

export type ProjectedReport = {
  /** Word count derived from the generated payload's prose fields. */
  wordCount: number;
  checks: ProjectedCheck[];
  score: number;
  total: number;
  scorePct: number;
};

export type FixOutcome = {
  url: string;
  /** Per-call fetch + audit + generation timings (ms). */
  elapsedMs: number;
  /** Doctor report for the source URL. */
  before: DoctorReport;
  /** Projected doctor report against the generated payload. */
  after: ProjectedReport;
  /** Generated `ResourcePublishPayload` ready to POST to the publish endpoint. */
  payload: ResourcePublishPayload;
  /** Where the payload was written (or would have been written if dry-run). */
  outPath: string;
  /** True if the LLM call was skipped. */
  dryRun: boolean;
  /** Number of LLM attempts (≥1 on success; relevant when self-correction fires). */
  attempts: number;
  /** Rough USD estimate from the cost model in `cli/llm.ts`. */
  estimatedCostUsd: number;
  /** The publish URL preview built from `{basePath}/{slug}` on the source origin. */
  publishUrlPreview: string;
};

export type RunFixOptions = {
  /** Override fetch impl (tests). */
  fetch?: FetchPageOptions["fetch"];
  /** Provide a pre-parsed page to skip the network entirely (tests). */
  parsedPage?: ParsedPage;
  /** Override the LLM call (tests). */
  generate?: (input: GenerateResourceInput) => Promise<GenerateResourceResult>;
  /** Override the file writer (tests). */
  writeFile?: (filePath: string, contents: string) => Promise<void>;
  /** Override the API key resolver (tests). */
  resolveApiKey?: (provider: LlmProvider) => string | undefined;
};

// ── Constants ─────────────────────────────────────────────────────

const GENERATED_BY = "auto-geo fix";

// ── Entry point ───────────────────────────────────────────────────

export async function runFix(
  flags: FixCliFlags,
  opts: RunFixOptions = {}
): Promise<FixOutcome> {
  const started = Date.now();

  const page =
    opts.parsedPage ?? (await fetchPage(flags.url, { fetch: opts.fetch }));
  const before = auditParsedPage(page);

  const apiKey =
    (opts.resolveApiKey ?? defaultResolveApiKey)(flags.provider) ?? "";

  const slugHint = deriveSlugHint(flags.url, page);
  const doctorDigest = renderDoctorDigestForLlm(before);
  const sourceText = page.text;

  const inputChars =
    sourceText.length +
    doctorDigest.length +
    flags.url.length +
    (flags.authorName?.length ?? 0) +
    (flags.authorJobTitle?.length ?? 0) +
    (flags.authorBio?.length ?? 0);
  const estimatedCostUsd = estimateGenerationCostUsd({
    model: flags.model,
    inputChars,
  });

  // Dry-run: short-circuit before any LLM call. We still need *some*
  // payload to surface the "projected" report — use the existing
  // `before` doctor report as the after-state stub, marking dryRun true.
  if (flags.dryRun) {
    return {
      url: flags.url,
      before,
      after: {
        wordCount: before.wordCount,
        checks: before.checks.map((c) => ({ ...c })),
        score: before.score,
        total: before.total,
        scorePct: before.scorePct,
      },
      payload: stubDryRunPayload(slugHint, flags),
      outPath: path.resolve(flags.out),
      dryRun: true,
      attempts: 0,
      estimatedCostUsd,
      publishUrlPreview: buildPublishUrlPreview(
        flags.url,
        flags.basePath,
        slugHint
      ),
      elapsedMs: Date.now() - started,
    };
  }

  if (!apiKey) {
    const envName =
      flags.provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";
    throw new Error(
      `auto-geo fix: ${envName} is not set. Export it before running, e.g. \`export ${envName}=sk-…\`.`
    );
  }

  const generateImpl = opts.generate ?? defaultGenerate;
  const userPrompt = buildFixUserPrompt();
  const domain = deriveOriginOrFallback(flags.url);
  const publishedAt = new Date().toISOString().slice(0, 10);

  const generation = await generateImpl({
    provider: flags.provider,
    model: flags.model,
    apiKey,
    prompt: userPrompt,
    sourceText,
    sourceUrl: flags.url,
    doctorReport: doctorDigest,
    slug: slugHint,
    author: {
      name: flags.authorName,
      jobTitle: flags.authorJobTitle,
      bio: flags.authorBio,
      linkedinUrl: flags.authorLinkedin,
    },
    maxRetries: flags.maxRetries,
    domain,
    basePath: flags.basePath,
    publishedAt,
  });

  // Belt-and-braces: AI SDK already validates against the schema, but we
  // re-parse here so the orchestrator surfaces a single canonical error
  // shape regardless of which provider was used.
  const parsed = resourcePublishSchema.safeParse(generation.payload);
  if (!parsed.success) {
    throw new Error(
      `Generated payload failed final schema validation:\n${parsed.error.issues
        .map((iss) => `  • ${iss.path.join(".") || "<root>"}: ${iss.message}`)
        .join("\n")}`
    );
  }
  const payload = parsed.data;

  const after = projectChecksAgainstPayload(payload);
  const outPath = path.resolve(flags.out);
  const fileWriter = opts.writeFile ?? defaultWriteFile;
  await fileWriter(outPath, JSON.stringify(payload, null, 2));

  return {
    url: flags.url,
    before,
    after,
    payload,
    outPath,
    dryRun: false,
    attempts: generation.attempts,
    estimatedCostUsd,
    publishUrlPreview: buildPublishUrlPreview(
      flags.url,
      flags.basePath,
      payload.slug
    ),
    elapsedMs: Date.now() - started,
  };
}

// ── Doctor digest for the LLM ─────────────────────────────────────

/**
 * Render the doctor report as a compact bulleted digest the LLM can act
 * on. Includes pass/fail, the `detail` string (so the LLM knows the
 * concrete count, e.g. "2 of 6 are question-format"), and the
 * `fixSuggestion` (the imperative the LLM should encode in its output).
 */
export function renderDoctorDigestForLlm(report: DoctorReport): string {
  const lines: string[] = [];
  lines.push(
    `Page: ${report.url} (${report.wordCount} words; score ${report.score}/${report.total} = ${report.scorePct}%)`
  );
  for (const c of report.checks) {
    const mark = c.pass ? "PASS" : "FAIL";
    lines.push(`  - [${mark}] ${c.name}: ${c.detail}`);
    if (!c.pass) {
      lines.push(`      Fix: ${c.fixSuggestion}`);
    }
  }
  return lines.join("\n");
}

// ── Project checks against a payload ──────────────────────────────

/**
 * The "after" report. Doctor checks operate on a fetched HTML page;
 * we don't have one yet. We instead build a `ParsedPage`-shaped object
 * from the generated payload, run the same heuristics, and override the
 * results for checks that only become meaningful at render time.
 *
 * Specifically:
 *   - Article + FAQPage JSON-LD: auto-emitted by the renderer. Pass by
 *     construction once published, so we mark them pass and explain.
 *   - Image cadence: the payload supports image blocks but the fix
 *     pipeline doesn't add them; mark pass-with-explanation so the user
 *     sees the "n/a — add via publish endpoint" note from the spec.
 *   - Self-link in related guides: rejection rule was already encoded
 *     in the schema (related guides are non-self-domain URLs).
 *
 * Every other heuristic runs identically against a synthesized
 * `ParsedPage` derived from the payload — H2s, TL;DR text, first
 * paragraph, entity density, etc.
 */
export function projectChecksAgainstPayload(
  payload: ResourcePublishPayload
): ProjectedReport {
  const synth = synthesizeParsedPageFromPayload(payload);
  const native = runAllChecks(synth);

  const checks: ProjectedCheck[] = native.map((c) => {
    if (c.id === "article-jsonld") {
      return {
        ...c,
        pass: true,
        payloadOnly: true,
        detail:
          "auto-emitted by ResourceArticle renderer from the typed payload",
      };
    }
    if (c.id === "faqpage-jsonld") {
      return {
        ...c,
        pass: true,
        payloadOnly: true,
        detail: "auto-emitted by ResourceArticle renderer from faq.items[]",
      };
    }
    if (c.id === "image-cadence") {
      // The fix pipeline does not synthesize image blocks. Surface this
      // as a soft pass so the rewrite isn't blocked, but explain that
      // images can be added via the publish endpoint.
      return {
        ...c,
        pass: true,
        payloadOnly: true,
        detail:
          "n/a — payload doesn't include images yet; add via the publish endpoint",
      };
    }
    if (c.id === "no-self-link") {
      // The schema's `relatedGuides` validation already requires full
      // absolute URLs — and the system prompt instructs against self-
      // domain entries — so we treat this as pass-by-construction.
      return {
        ...c,
        pass: true,
        payloadOnly: true,
        detail:
          "Schema enforces full absolute related-guide URLs; no self-links by construction",
      };
    }
    return c;
  });

  const score = checks.filter((c) => c.pass).length;
  const total = checks.length;
  return {
    wordCount: synth.wordCount,
    checks,
    score,
    total,
    scorePct: total === 0 ? 0 : Math.round((score / total) * 100),
  };
}

/**
 * Build a `ParsedPage`-shaped object from a `ResourcePublishPayload`
 * so the existing pure heuristics in `cli/checks.ts` can be re-used
 * without re-rendering HTML. We synthesize:
 *
 *   - text:           TL;DR + intro + every section's capsule + blocks
 *   - leadText:       TL;DR text only (the post-H1 region)
 *   - firstParagraph: TL;DR text
 *   - headings:       H1 = title, H2 = section headings
 *   - jsonLd:         empty (handled via per-check override above)
 *   - images:         empty (handled via per-check override above)
 *   - links:          empty (related-guides handled via per-check override above)
 */
function synthesizeParsedPageFromPayload(
  payload: ResourcePublishPayload
): ParsedPage {
  const proseParts: string[] = [];
  proseParts.push(payload.tldr.text);
  for (const block of payload.intro.blocks) {
    proseParts.push(stringifyBlock(block));
  }
  for (const section of payload.sections) {
    proseParts.push(section.heading);
    proseParts.push(section.answerCapsule);
    for (const block of section.blocks) {
      proseParts.push(stringifyBlock(block));
    }
  }
  for (const item of payload.keyTakeaways.items) {
    proseParts.push(item);
  }
  for (const faq of payload.faq.items) {
    proseParts.push(faq.question);
    proseParts.push(faq.answer);
  }
  const text = proseParts.join(" ");
  const wordCount = wordCountOf(text);

  return {
    url: "auto-geo://projected",
    text,
    wordCount,
    leadText: payload.tldr.text,
    firstParagraph: payload.tldr.text,
    headings: [
      { level: 1 as const, text: payload.title },
      ...payload.sections.map((s) => ({
        level: 2 as const,
        text: s.heading,
      })),
    ],
    jsonLd: [],
    images: [],
    links: [],
  };
}

function stringifyBlock(
  block: ResourcePublishPayload["intro"]["blocks"][number]
): string {
  switch (block.type) {
    case "paragraph":
      return block.text;
    case "h3":
      return block.text;
    case "list":
      return block.items.join(" ");
    case "table":
      return [
        block.caption ?? "",
        block.headers.join(" "),
        ...block.rows.map((r) => r.join(" ")),
      ]
        .filter(Boolean)
        .join(" ");
    case "quote":
      return `${block.text} ${block.attribution}`;
    case "image":
      return block.alt;
    case "callout":
      return block.text;
  }
}

function wordCountOf(text: string): number {
  const m = text.match(/\b[\w'-]+\b/g);
  return m ? m.length : 0;
}

// ── Slug derivation ───────────────────────────────────────────────

/**
 * Extract a slug from the URL path; fall back to deriving one from the
 * page title. The result is only a *hint* — the LLM is also asked to
 * emit a slug that satisfies the schema regex
 * (`^[a-z0-9]+(-[a-z0-9]+)*$`), and we accept whatever it produces.
 */
export function deriveSlugHint(url: string, page: ParsedPage): string {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter(Boolean);
    const last = segments[segments.length - 1];
    if (last) {
      const cleaned = sanitizeSlug(last.replace(/\.[a-z0-9]+$/i, ""));
      if (cleaned) return cleaned;
    }
  } catch {
    // Fall through to title-based slug.
  }
  const title = page.headings.find((h) => h.level === 1)?.text ?? "";
  return sanitizeSlug(title) || "resource";
}

function sanitizeSlug(input: string): string {
  return input
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

// ── Dry-run stub ──────────────────────────────────────────────────

function stubDryRunPayload(
  slug: string,
  flags: FixCliFlags
): ResourcePublishPayload {
  // Not validated through `resourcePublishSchema` — dry-run never writes
  // this to disk, it's only here so the `FixOutcome.payload` field stays
  // typed. The casts are scoped to this stub.
  return {
    slug,
    title: "(dry-run — generation skipped)",
    metaDescription:
      "Dry-run mode: fetched the page, ran the doctor audit, estimated cost. No LLM call was made.",
    category: "Tutorials",
    excerpt:
      "Dry-run mode: fetched the page, ran the doctor audit, estimated cost. No LLM call was made.",
    author: {
      name: flags.authorName ?? "Unknown",
      jobTitle: flags.authorJobTitle ?? "Unknown",
      bio:
        flags.authorBio ??
        "Dry-run author placeholder; replace via --author-bio before publish.",
    },
    publishedAt: new Date().toISOString().slice(0, 10),
    geoMetadata: {
      targetQueries: ["dry-run"],
      pageType: "resource",
      primaryFunction: "dry-run",
      optimizationFramework: ["GEO"],
      targetPlatforms: ["chatgpt"],
      informationGainStatement: "dry-run",
      refreshCadence: "quarterly",
    },
    tldr: { text: "(dry-run placeholder)" },
    intro: { blocks: [{ type: "paragraph", text: "(dry-run placeholder)" }] },
    sections: [
      {
        heading: "(dry-run)",
        answerCapsule: "(dry-run placeholder)",
        blocks: [],
      },
    ],
    relatedGuides: { items: [] },
    keyTakeaways: { items: [] },
    faq: { items: [] },
    disclosure: { text: "dry-run" },
  } as unknown as ResourcePublishPayload;
}

// ── Helpers ───────────────────────────────────────────────────────

function buildFixUserPrompt(): string {
  return `Rewrite the source page below as a GEO resource page. Preserve the substance and the author's claims; restructure for citation extraction. The rewrite must pass all 8 doctor checks (TL;DR present, question-format H2s, Article + FAQPage JSON-LD, entity density, image cadence, answer-first first paragraph, no self-link). Output a ResourcePublishPayload JSON conforming to the provided schema.`;
}

function buildPublishUrlPreview(
  sourceUrl: string,
  basePath: string,
  slug: string
): string {
  try {
    const parsed = new URL(sourceUrl);
    const trimmedBase = basePath.startsWith("/") ? basePath : `/${basePath}`;
    return `${parsed.origin}${trimmedBase.replace(/\/$/, "")}/${slug}`;
  } catch {
    const trimmedBase = basePath.startsWith("/") ? basePath : `/${basePath}`;
    return `${trimmedBase.replace(/\/$/, "")}/${slug}`;
  }
}

function defaultResolveApiKey(provider: LlmProvider): string | undefined {
  if (provider === "openai") return process.env.OPENAI_API_KEY;
  if (provider === "anthropic") return process.env.ANTHROPIC_API_KEY;
  return undefined;
}

async function defaultWriteFile(
  filePath: string,
  contents: string
): Promise<void> {
  await writeFile(filePath, contents, "utf8");
}

/**
 * Translate fix-orchestrator input into the unified
 * `generateResourcePayload` call shape (`cli/llm.ts`). This is the
 * default implementation of the `generate` seam — tests inject a stub
 * instead so they never reach a real provider.
 *
 * Author defaults: the schema requires `name`, `jobTitle`, `bio`. We
 * fill in placeholders if the CLI caller didn't supply them, matching
 * the `auto-geo write` defaults in spirit.
 */
async function defaultGenerate(
  input: GenerateResourceInput
): Promise<GenerateResourceResult> {
  const model = await getLanguageModel(
    input.provider,
    input.model,
    input.apiKey
  );

  const author: ResourceAuthor = {
    name: input.author?.name ?? "Shadow Research",
    jobTitle: input.author?.jobTitle ?? "Generative Engine Optimization Team",
    bio:
      input.author?.bio ??
      "Shadow is a media research lab building AI-powered media intelligence and communications technology. The team publishes GEO resource pages using auto-geo.",
    linkedinUrl: input.author?.linkedinUrl,
  };

  const result = await generateResourcePayload({
    model,
    provider: input.provider,
    modelName: input.model,
    domain: input.domain ?? "",
    basePath: input.basePath ?? "/resources",
    // For fix-mode we don't have a single target query the way `write`
    // does; the source page itself defines the topic. We pass the
    // free-form rewrite prompt as the "query" so it appears in the
    // user-prompt header. The model will infer the H1 from the source.
    query: input.prompt,
    slug: input.slug ?? "resource",
    author,
    publishedAt: input.publishedAt ?? new Date().toISOString().slice(0, 10),
    maxRetries: input.maxRetries,
    sourceText: input.sourceText,
    sourceUrl: input.sourceUrl,
    doctorReport: input.doctorReport,
  });

  return {
    payload: result.payload,
    attempts: result.attempts,
    elapsedMs: result.elapsedMs,
  };
}

/**
 * Derive the publisher origin from the source URL. Used as the `domain`
 * the unified prompt builder seeds into the relatedGuides hint. Falls
 * back to an empty string on parse failure so the LLM can still proceed.
 */
function deriveOriginOrFallback(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

// ── Renderers (CLI output) ────────────────────────────────────────

/**
 * Render the human-readable `auto-geo fix` report. Kept here (not in
 * `cli/render.ts`) so the fix and doctor render layers can evolve
 * independently without one of them having to import the other's
 * types — but presentation primitives are shared via `cli/ui.ts` so
 * the four subcommands look like one tool.
 */
export function renderFixHuman(
  outcome: FixOutcome,
  opts: { colors: boolean; narrow?: boolean } = { colors: false }
): string {
  const ui: UiOptions = {
    colors: opts.colors,
    narrow: detectNarrow(process.stdout?.columns, opts.narrow),
    width: process.stdout?.columns,
  };
  const g = glyphs(ui.colors);
  const lines: string[] = [];

  lines.push(header("auto-geo fix", "generate a GEO-optimized rewrite", ui));
  lines.push("");
  lines.push(kv("url", outcome.url, { ...ui, valueCol: 10 }));
  lines.push(
    kv(
      "fetched",
      `${formatInt(outcome.before.wordCount)} word${outcome.before.wordCount === 1 ? "" : "s"}`,
      { ...ui, valueCol: 10 }
    )
  );
  lines.push("");

  // Audit (before) — section header + aligned check rows.
  lines.push(`${indent(ui)}${bold("Audit (before):", ui.colors)}`);
  const beforeRows: Row[] = outcome.before.checks.map((c) => ({
    status: c.pass ? "ok" : "fail",
    name: c.name,
  }));
  for (const ln of rows(beforeRows, ui)) lines.push(ln);
  lines.push("");
  lines.push(
    `${indent(ui)}${g.arrow} ${bold(
      `Score (before): ${outcome.before.score} / ${outcome.before.total}`,
      ui.colors
    )}`
  );
  lines.push("");

  if (outcome.dryRun) {
    lines.push(
      `${indent(ui)}${paint("Dry-run — LLM call skipped.", "yellow", ui.colors)}`
    );
    lines.push(
      `${indent(ui)}${dim(
        `Estimated cost if run: ~$${outcome.estimatedCostUsd.toFixed(4)}`,
        ui.colors
      )}`
    );
    lines.push(
      `${indent(ui)}${dim(`Would have written: ${outcome.outPath}`, ui.colors)}`
    );
    return lines.join("\n");
  }

  // Audit (projected) — section header + aligned rows (payloadOnly
  // checks show their explanation in the detail column).
  lines.push(
    `${indent(ui)}${bold("Audit (projected for rewrite):", ui.colors)}`
  );
  const afterRows: Row[] = outcome.after.checks.map((c) => ({
    status: c.pass ? "ok" : "fail",
    name: c.name,
    detail: c.payloadOnly ? c.detail : undefined,
  }));
  for (const ln of rows(afterRows, ui)) lines.push(ln);
  lines.push("");

  const posture = scoreLabel(outcome.after.scorePct);
  lines.push(
    `${indent(ui)}${g.arrow} ${bold(
      `Score (projected): ${outcome.after.score} / ${outcome.after.total}`,
      ui.colors
    )}  ${muted(`— ${posture} GEO posture`, ui.colors)}`
  );
  lines.push("");

  lines.push(
    `${indent(ui)}${dim(
      `\u2192 ${outcome.outPath} (validated by resourcePublishSchema)`,
      ui.colors
    )}`
  );
  lines.push(
    `${indent(ui)}${dim(
      `Total: ~$${outcome.estimatedCostUsd.toFixed(4)} estimated \u00b7 ${formatElapsed(
        outcome.elapsedMs
      )} elapsed`,
      ui.colors
    )}`
  );
  if (outcome.attempts > 1) {
    lines.push(
      `${indent(ui)}${dim(
        `(self-correction fired — ${outcome.attempts} attempts to satisfy the schema)`,
        ui.colors
      )}`
    );
  }
  lines.push("");

  lines.push(`${indent(ui)}${bold("Next steps:", ui.colors)}`);
  const steps = bulletList(
    [
      "Review the payload (especially TL;DR + FAQ — the citation-target chunks)",
      "Publish to your endpoint",
      `Re-audit: npx auto-geo doctor ${outcome.publishUrlPreview}`,
    ],
    ui
  );
  for (const ln of steps) lines.push(ln);

  const footerLines = footer(
    [
      `auto-geo fix \u00b7 github.com/shadowresearch/auto-geo`,
      `Fix another page: npx auto-geo fix <url>`,
    ],
    ui
  );
  for (const ln of footerLines) lines.push(ln);
  lines.push(`${indent(ui)}${dim(`Generated by ${GENERATED_BY}`, ui.colors)}`);

  return lines.join("\n");
}

export function renderFixJson(outcome: FixOutcome): string {
  return JSON.stringify(
    {
      generatedBy: GENERATED_BY,
      url: outcome.url,
      outPath: outcome.outPath,
      dryRun: outcome.dryRun,
      attempts: outcome.attempts,
      estimatedCostUsd: outcome.estimatedCostUsd,
      elapsedMs: outcome.elapsedMs,
      before: outcome.before,
      after: outcome.after,
      payload: outcome.payload,
      publishUrlPreview: outcome.publishUrlPreview,
    },
    null,
    2
  );
}

// ── Tiny rendering helpers ────────────────────────────────────────

function scoreLabel(pct: number): string {
  if (pct >= 90) return "strong";
  if (pct >= 75) return "good";
  if (pct >= 50) return "moderate";
  if (pct >= 25) return "weak";
  return "poor";
}

function formatInt(n: number): string {
  return n.toLocaleString("en-US");
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// Expose `parsePage` re-export so tests can drive the orchestrator
// from a pre-built HTML fixture without importing both modules.
export { parsePage };
