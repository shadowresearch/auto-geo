import { generateObject } from "ai";
import { z } from "zod";
import { fetchPage, type FetchPageOptions } from "./fetch";
import { estimateCost } from "./cost";
import type { ProviderId } from "./llm";
import {
  bold,
  cyan,
  dim,
  glyphs,
  green,
  header,
  indent,
  type UiOptions,
} from "./ui";
import { addPrompts, ensureWorkspace, loadPrompts } from "./workspace";

/**
 * `auto-geo prompts discover` — LLM-assisted prompt discovery.
 * Introduced in v0.8.0.
 *
 * The hard part of a GEO program is knowing WHICH questions to compete
 * for. `discover` proposes them: it fetches the publisher's homepage
 * for grounding, shows the LLM what's already tracked, and asks for N
 * NEW high-intent queries a target customer would put to an AI engine —
 * queries this domain should be the cited answer for.
 *
 * Guarantees (same contract as `prompts add`):
 *   - NEVER overwrites — generated prompts are appended to
 *     `.auto-geo/prompts.txt`; existing lines stay byte-identical.
 *   - NEVER duplicates — case-insensitive dedupe against both the
 *     existing tracked set and within the generated batch.
 *   - `--dry-run` previews the candidates without writing anything.
 */

// ── Generation ────────────────────────────────────────────────────

export const DEFAULT_DISCOVER_COUNT = 10;

/** Max characters of homepage text fed to the LLM as grounding. */
const PAGE_CONTEXT_CHAR_BUDGET = 6_000;

const discoveryResultSchema = z.object({
  prompts: z
    .array(z.string().min(5).max(160))
    .min(1)
    .describe("Candidate prompts, one natural-language query per entry."),
});

export type DiscoverUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type DiscoverGeneration = {
  prompts: string[];
  usage?: DiscoverUsage;
};

/**
 * The generation function contract — injectable so tests exercise the
 * full discover flow with zero network and zero LLM spend.
 */
export type DiscoverGenerate = (args: {
  system: string;
  prompt: string;
}) => Promise<DiscoverGeneration>;

export function buildDiscoverSystemPrompt(): string {
  return [
    "You are a Generative Engine Optimization (GEO) strategist.",
    "Your job: propose the questions a publisher should compete to be cited for in AI search engines (ChatGPT, Perplexity, Google AI Overviews, Claude, Gemini).",
    "",
    "Rules for every prompt you propose:",
    "- Write it exactly as a real user would type it into an AI assistant — natural language, no keyword-stuffing, no quotes.",
    "- High intent: questions where being THE cited answer wins the publisher a customer, a reader, or authority in their field.",
    "- Specific enough to be winnable. 'best software' is unwinnable; 'best media monitoring tools for PR agencies' is winnable.",
    "- Mix question types: comparisons ('X vs Y'), recommendations ('best tools for…'), definitions ('what is…'), and how-tos.",
    "- NEVER repeat or trivially rephrase a prompt the publisher already tracks.",
    "- Each prompt must stand alone — no numbering, no commentary, no explanations.",
  ].join("\n");
}

export function buildDiscoverUserPrompt(opts: {
  domain: string;
  count: number;
  existingPrompts: string[];
  pageTitle?: string;
  pageText?: string;
}): string {
  const lines: string[] = [];
  lines.push(`Publisher domain: ${opts.domain}`);
  if (opts.pageTitle) lines.push(`Homepage title: ${opts.pageTitle}`);
  if (opts.pageText) {
    lines.push("");
    lines.push("Homepage content (extracted, truncated):");
    lines.push('"""');
    lines.push(opts.pageText.slice(0, PAGE_CONTEXT_CHAR_BUDGET));
    lines.push('"""');
  }
  lines.push("");
  if (opts.existingPrompts.length > 0) {
    lines.push("Already tracked (do NOT repeat or rephrase these):");
    for (const p of opts.existingPrompts) lines.push(`- ${p}`);
  } else {
    lines.push("No prompts are tracked yet — this is the starting set.");
  }
  lines.push("");
  lines.push(
    `Propose exactly ${opts.count} new prompts this publisher should track.`
  );
  return lines.join("\n");
}

/**
 * Default `DiscoverGenerate` backed by the Vercel AI SDK. `model` is a
 * resolved `LanguageModel`; provider/model names ride along for cost
 * attribution at the call site.
 */
export function makeAiSdkGenerate(model: unknown): DiscoverGenerate {
  return async ({ system, prompt }) => {
    const result = await generateObject({
      // The caller resolves the model via the same path `write` uses.
      model: model as Parameters<typeof generateObject>[0]["model"],
      system,
      prompt,
      schema: discoveryResultSchema,
    });
    const object = result.object as z.infer<typeof discoveryResultSchema>;
    return {
      prompts: object.prompts,
      usage: result.usage
        ? {
            inputTokens: result.usage.inputTokens ?? 0,
            outputTokens: result.usage.outputTokens ?? 0,
            totalTokens: result.usage.totalTokens ?? 0,
          }
        : undefined,
    };
  };
}

// ── Runner ────────────────────────────────────────────────────────

export type DiscoverOptions = {
  domain: string;
  count?: number;
  dryRun?: boolean;
  cwd?: string;
  generate: DiscoverGenerate;
  /** Cost attribution for the summary line. */
  provider?: ProviderId;
  modelName?: string;
  /** Injectable fetch for tests. */
  fetchOptions?: FetchPageOptions;
};

export type DiscoverOutcome = {
  domain: string;
  /** What the LLM proposed, post-normalization, pre-dedupe. */
  candidates: string[];
  /** Appended to prompts.txt this run (empty under --dry-run). */
  added: string[];
  /** Dropped as duplicates of the tracked set or within the batch. */
  skipped: string[];
  /** Full tracked set after the run. */
  prompts: string[];
  promptsPath: string;
  dryRun: boolean;
  /** True when the homepage fetch failed and generation ran domain-only. */
  pageFetchFailed: boolean;
  estimatedCostUsd?: number;
};

export async function runDiscover(
  opts: DiscoverOptions
): Promise<DiscoverOutcome> {
  const count = Math.max(1, opts.count ?? DEFAULT_DISCOVER_COUNT);
  const cwd = opts.cwd ?? process.cwd();

  // Same bootstrap contract as `prompts add` — discover creates the
  // workspace on first use rather than demanding `init` first.
  const { workspace } = await ensureWorkspace(cwd);
  const existingPrompts = await loadPrompts(workspace);

  // Grounding: homepage text. Fetch failure is survivable — the LLM
  // still gets the domain + existing prompts.
  let pageTitle: string | undefined;
  let pageText: string | undefined;
  let pageFetchFailed = false;
  const homepage = /^https?:\/\//.test(opts.domain)
    ? opts.domain
    : `https://${opts.domain}`;
  try {
    const page = await fetchPage(homepage, opts.fetchOptions);
    pageText = page.text;
    pageTitle = page.headings.find((h) => h.level === 1)?.text;
  } catch {
    pageFetchFailed = true;
  }

  const generation = await opts.generate({
    system: buildDiscoverSystemPrompt(),
    prompt: buildDiscoverUserPrompt({
      domain: opts.domain,
      count,
      existingPrompts,
      pageTitle,
      pageText,
    }),
  });

  // Normalize: trim, strip accidental list markers/quotes, drop
  // empties, cap at the requested count.
  const candidates = generation.prompts
    .map((p) =>
      p
        .trim()
        .replace(/^[-*\d.)\s]+/, "")
        .replace(/^["']|["']$/g, "")
    )
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, count);

  let estimatedCostUsd: number | undefined;
  if (generation.usage && opts.provider && opts.modelName) {
    estimatedCostUsd = estimateCost(
      opts.provider,
      opts.modelName,
      generation.usage
    );
  }

  if (opts.dryRun) {
    // Preview only — compute what WOULD be added without writing.
    const seen = new Set(existingPrompts.map((p) => p.toLowerCase()));
    const added: string[] = [];
    const skipped: string[] = [];
    for (const c of candidates) {
      const key = c.toLowerCase();
      if (seen.has(key)) skipped.push(c);
      else {
        seen.add(key);
        added.push(c);
      }
    }
    return {
      domain: opts.domain,
      candidates,
      added,
      skipped,
      prompts: existingPrompts,
      promptsPath: workspace.promptsPath,
      dryRun: true,
      pageFetchFailed,
      estimatedCostUsd,
    };
  }

  const { added, skipped } = await addPrompts(workspace, candidates);
  return {
    domain: opts.domain,
    candidates,
    added,
    skipped,
    prompts: await loadPrompts(workspace),
    promptsPath: workspace.promptsPath,
    dryRun: false,
    pageFetchFailed,
    estimatedCostUsd,
  };
}

// ── Renderers ─────────────────────────────────────────────────────

export function renderDiscoverOutcome(
  outcome: DiscoverOutcome,
  opts: { colors: boolean; narrow?: boolean }
): string {
  const ui: UiOptions = { colors: opts.colors, narrow: opts.narrow };
  const g = glyphs(ui.colors);
  const id = indent(ui);
  const lines: string[] = [];

  lines.push(
    header(
      "auto-geo prompts discover",
      `propose tracked prompts for ${outcome.domain}`,
      ui
    )
  );
  lines.push("");

  if (outcome.pageFetchFailed) {
    lines.push(
      `${id}${dim("(homepage fetch failed — generated from domain context only)", ui.colors)}`
    );
    lines.push("");
  }

  const verb = outcome.dryRun ? "would add" : "added";
  for (const p of outcome.added) {
    lines.push(`${id}${green(g.ok, ui.colors)} ${verb}  ${p}`);
  }
  for (const p of outcome.skipped) {
    lines.push(
      `${id}${dim(`${g.bullet} skipped  ${p} (already tracked)`, ui.colors)}`
    );
  }
  if (outcome.added.length === 0 && outcome.skipped.length === 0) {
    lines.push(
      `${id}${dim("No usable prompts came back — try again.", ui.colors)}`
    );
  }

  lines.push("");
  const costNote =
    outcome.estimatedCostUsd !== undefined
      ? ` ${g.bullet} ~$${outcome.estimatedCostUsd.toFixed(2)}`
      : "";
  if (outcome.dryRun) {
    lines.push(
      `${id}${dim(
        `dry-run — nothing written ${g.bullet} ${outcome.added.length} new, ${outcome.skipped.length} duplicate${costNote}`,
        ui.colors
      )}`
    );
    lines.push("");
    lines.push(
      `${id}${bold("Next:", ui.colors)} re-run without ${cyan("--dry-run", ui.colors)} to track these.`
    );
  } else {
    lines.push(
      `${id}${dim(
        `${outcome.prompts.length} tracked ${g.bullet} ${outcome.promptsPath}${costNote}`,
        ui.colors
      )}`
    );
    lines.push("");
    lines.push(
      `${id}${bold("Next:", ui.colors)} run ${cyan("auto-geo check", ui.colors)} to baseline the new prompts ${dim(`(prune with auto-geo prompts rm <n>)`, ui.colors)}.`
    );
  }
  return lines.join("\n");
}

export function renderDiscoverJson(outcome: DiscoverOutcome): string {
  return JSON.stringify(outcome, null, 2);
}
