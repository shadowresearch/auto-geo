import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ResourceAuthor, ResourcePublishPayload } from "../core/schema";
import { estimateCost, estimateCostPerPage, formatUsd, sumUsage } from "./cost";
import {
  generateResourcePayload,
  SchemaValidationError,
  type GenerateResourceUsage,
  type ProviderId,
} from "./llm";
import { deriveUniqueSlugs } from "./slug";
import type { LanguageModel } from "ai";
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
  statusMark,
  type UiOptions,
} from "./ui";

/**
 * Orchestrator for `auto-geo write`. Owns the per-query loop, slug
 * derivation, on-disk persistence, and the human/JSON summary.
 *
 * Concurrency is capped at 2 in series-friendly mode: LLM providers
 * have aggressive per-minute rate limits and most users running this
 * CLI care more about cost predictability than throughput. The cap is
 * exposed so a programmatic caller can opt into higher parallelism.
 *
 * `dryRun: true` short-circuits the LLM call and returns a result that
 * shows what *would* be generated plus the estimated cost.
 */

// ── Public types ──────────────────────────────────────────────────

export type RunWriteOptions = {
  domain: string;
  queries: string[];
  outDir: string;
  provider: ProviderId;
  modelName: string;
  /** Resolved AI SDK model. Omit only when dryRun is true. */
  model?: LanguageModel;
  basePath: string;
  author: ResourceAuthor;
  publishedAt: string;
  maxRetries: number;
  /** Concurrency cap. Default 2. */
  concurrency?: number;
  dryRun?: boolean;
  /** Override "now" for deterministic test runs. */
  now?: Date;
};

export type WriteOutcomeOk = {
  kind: "ok";
  query: string;
  slug: string;
  filePath: string;
  payload: ResourcePublishPayload;
  usage: GenerateResourceUsage;
  retries: number;
  cost: number;
};

export type WriteOutcomeFailed = {
  kind: "failed";
  query: string;
  slug: string;
  filePath: string;
  error: string;
  issues?: { path: string; message: string }[];
  usage: GenerateResourceUsage;
};

export type WriteOutcomeDryRun = {
  kind: "dry-run";
  query: string;
  slug: string;
  filePath: string;
  estimatedCost: number;
};

export type WriteOutcome =
  | WriteOutcomeOk
  | WriteOutcomeFailed
  | WriteOutcomeDryRun;

export type WriteSummary = {
  domain: string;
  provider: ProviderId;
  modelName: string;
  outDir: string;
  dryRun: boolean;
  outcomes: WriteOutcome[];
  totalUsage: GenerateResourceUsage;
  totalCost: number;
  elapsedMs: number;
};

// ── Author helper ─────────────────────────────────────────────────

export const DEFAULT_AUTHOR: ResourceAuthor = {
  name: "Shadow Research",
  jobTitle: "Generative Engine Optimization Team",
  bio: "Shadow is a media research lab building AI-powered media intelligence and communications technology. The team publishes GEO resource pages using auto-geo, the same MIT publishing engine that powers shadow.inc/resources.",
  linkedinUrl: "https://www.linkedin.com/company/shadow-research",
};

// ── Orchestrator ──────────────────────────────────────────────────

export async function runWrite(opts: RunWriteOptions): Promise<WriteSummary> {
  const startedAt = opts.now ?? new Date();
  const startMs = startedAt.getTime();

  const slugs = deriveUniqueSlugs(opts.queries);
  const outDir = path.resolve(opts.outDir);
  await mkdir(outDir, { recursive: true });

  const outcomes: WriteOutcome[] = new Array(opts.queries.length);

  if (opts.dryRun) {
    const perPage = estimateCostPerPage(opts.provider, opts.modelName);
    for (let i = 0; i < opts.queries.length; i++) {
      const query = opts.queries[i]!;
      const slug = slugs[i]!;
      outcomes[i] = {
        kind: "dry-run",
        query,
        slug,
        filePath: path.join(outDir, `${slug}.json`),
        estimatedCost: perPage,
      };
    }
    return {
      domain: opts.domain,
      provider: opts.provider,
      modelName: opts.modelName,
      outDir,
      dryRun: true,
      outcomes,
      totalUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      totalCost: perPage * opts.queries.length,
      elapsedMs: Date.now() - startMs,
    };
  }

  if (!opts.model) {
    throw new Error(
      "runWrite: `model` is required unless dryRun is true. Pass a resolved LanguageModel from @ai-sdk/openai or @ai-sdk/anthropic."
    );
  }

  const concurrency = Math.max(1, opts.concurrency ?? 2);
  const publishedAt = formatYmd(startedAt);

  // Bounded promise-pool — mirrors the shape used by cli/doctor.ts. We
  // hand-roll instead of pulling p-limit so the package keeps its
  // single-runtime-dep posture (linkedom only).
  let cursor = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = cursor++;
      if (i >= opts.queries.length) return;
      const query = opts.queries[i]!;
      const slug = slugs[i]!;
      const filePath = path.join(outDir, `${slug}.json`);
      outcomes[i] = await runOne({
        ...opts,
        model: opts.model!,
        query,
        slug,
        filePath,
        publishedAt,
      });
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, opts.queries.length) }, () =>
      worker()
    )
  );

  const usages = outcomes
    .filter(
      (o): o is WriteOutcomeOk | WriteOutcomeFailed =>
        o.kind === "ok" || o.kind === "failed"
    )
    .map((o) => o.usage);
  const totalUsage = sumUsage(usages);
  const totalCost = estimateCost(opts.provider, opts.modelName, totalUsage);

  return {
    domain: opts.domain,
    provider: opts.provider,
    modelName: opts.modelName,
    outDir,
    dryRun: false,
    outcomes,
    totalUsage,
    totalCost,
    elapsedMs: Date.now() - startMs,
  };
}

// ── Per-query runner ──────────────────────────────────────────────

type RunOneInput = Omit<RunWriteOptions, "queries" | "now" | "dryRun"> & {
  model: LanguageModel;
  query: string;
  slug: string;
  filePath: string;
  publishedAt: string;
};

async function runOne(input: RunOneInput): Promise<WriteOutcome> {
  try {
    const { payload, usage, retries } = await generateResourcePayload({
      model: input.model,
      provider: input.provider,
      modelName: input.modelName,
      domain: input.domain,
      basePath: input.basePath,
      query: input.query,
      slug: input.slug,
      author: input.author,
      publishedAt: input.publishedAt,
      maxRetries: input.maxRetries,
    });

    // Sanity: the schema lets the model pick its own slug; we override
    // with the deterministic caller-derived slug to keep filenames and
    // payloads aligned.
    const finalPayload: ResourcePublishPayload = {
      ...payload,
      slug: input.slug,
    };

    await writeFile(
      input.filePath,
      JSON.stringify(finalPayload, null, 2) + "\n",
      "utf8"
    );

    return {
      kind: "ok",
      query: input.query,
      slug: input.slug,
      filePath: input.filePath,
      payload: finalPayload,
      usage,
      retries,
      cost: estimateCost(input.provider, input.modelName, usage),
    };
  } catch (err) {
    if (err instanceof SchemaValidationError) {
      return {
        kind: "failed",
        query: input.query,
        slug: input.slug,
        filePath: input.filePath,
        error: err.message,
        issues: err.issues.map((iss) => ({
          path: iss.path.length === 0 ? "<root>" : iss.path.join("."),
          message: iss.message,
        })),
        usage: err.usage ?? {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
        },
      };
    }
    return {
      kind: "failed",
      query: input.query,
      slug: input.slug,
      filePath: input.filePath,
      error: err instanceof Error ? err.message : String(err),
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    };
  }
}

// ── Rendering ─────────────────────────────────────────────────────

export function renderWriteSummary(
  summary: WriteSummary,
  opts: { colors?: boolean; narrow?: boolean } = {}
): string {
  const ui: UiOptions = {
    colors: opts.colors ?? false,
    narrow: detectNarrow(process.stdout?.columns, opts.narrow),
    width: process.stdout?.columns,
  };
  const g = glyphs(ui.colors);
  const lines: string[] = [];

  lines.push(
    header(
      "auto-geo write",
      "generate publish-ready resource pages from target queries",
      ui
    )
  );
  lines.push("");
  lines.push(kv("domain", summary.domain, { ...ui, valueCol: 12 }));
  lines.push(
    kv("queries", String(summary.outcomes.length), { ...ui, valueCol: 12 })
  );
  lines.push(
    kv("provider", `${summary.provider} (${summary.modelName})`, {
      ...ui,
      valueCol: 12,
    })
  );
  if (summary.dryRun) {
    lines.push(
      kv("mode", "dry-run (no LLM calls)", {
        ...ui,
        valueCol: 12,
        valueColor: "yellow",
      })
    );
  }
  lines.push("");

  // Per-outcome rows: mark + JSON.stringified query + path + meta dim.
  for (const o of summary.outcomes) {
    if (o.kind === "ok") {
      lines.push(
        `${indent(ui)}${statusMark("ok", ui.colors)}  ${JSON.stringify(o.query)}`
      );
      const meta = `(validated${o.retries > 0 ? `, ${o.retries} retry${o.retries === 1 ? "" : "ies"}` : ""}, ${formatUsd(o.cost)})`;
      lines.push(
        `${indent(ui)}   ${dim(
          `\u2192 ${path.relative(process.cwd(), o.filePath) || o.filePath} ${meta}`,
          ui.colors
        )}`
      );
    } else if (o.kind === "dry-run") {
      lines.push(
        `${indent(ui)}${statusMark("info", ui.colors)}  ${JSON.stringify(o.query)}`
      );
      lines.push(
        `${indent(ui)}   ${dim(
          `\u2192 ${path.relative(process.cwd(), o.filePath) || o.filePath} (dry-run, ~${formatUsd(o.estimatedCost)})`,
          ui.colors
        )}`
      );
    } else {
      lines.push(
        `${indent(ui)}${statusMark("fail", ui.colors)}  ${JSON.stringify(o.query)}`
      );
      lines.push(`${indent(ui)}   ${paint(o.error, "red", ui.colors)}`);
      if (o.issues && o.issues.length > 0) {
        for (const iss of o.issues.slice(0, 5)) {
          lines.push(
            `${indent(ui)}     ${dim(`${g.bullet} [${iss.path}] ${iss.message}`, ui.colors)}`
          );
        }
        if (o.issues.length > 5) {
          lines.push(
            `${indent(ui)}     ${dim(`… ${o.issues.length - 5} more`, ui.colors)}`
          );
        }
      }
    }
  }

  // Total callout.
  lines.push("");
  const okCount = summary.outcomes.filter((o) => o.kind === "ok").length;
  const failedCount = summary.outcomes.filter(
    (o) => o.kind === "failed"
  ).length;
  const dryCount = summary.outcomes.filter((o) => o.kind === "dry-run").length;
  const parts: string[] = [];
  parts.push(
    `${summary.outcomes.length} page${plural(summary.outcomes.length)}`
  );
  if (okCount > 0) parts.push(`${okCount} ok`);
  if (failedCount > 0)
    parts.push(paint(`${failedCount} failed`, "red", ui.colors));
  if (dryCount > 0) parts.push(`${dryCount} dry-run`);
  parts.push(
    `~${formatUsd(summary.totalCost)} ${summary.dryRun ? "estimated" : "spent"}`
  );
  parts.push(`${(summary.elapsedMs / 1000).toFixed(1)}s elapsed`);
  lines.push(
    `${indent(ui)}${g.arrow} ${bold("Total:", ui.colors)} ${parts.join(
      ` ${dim("\u00b7", ui.colors)} `
    )}`
  );

  if (okCount > 0 && !summary.dryRun) {
    lines.push("");
    lines.push(`${indent(ui)}${bold("Next steps:", ui.colors)}`);
    const steps = bulletList(
      [
        "Review each file",
        "Publish via your endpoint",
        `Re-audit after publish: npx auto-geo doctor ${summary.domain}/<basePath>/<slug>`,
      ],
      ui
    );
    for (const ln of steps) lines.push(ln);
    // Concrete publish snippet (dim so it doesn't dominate the row stack).
    lines.push("");
    const outRel =
      path.relative(process.cwd(), summary.outDir) || summary.outDir;
    lines.push(
      `${indent(ui)}  ${dim(`for f in ${outRel}/*.json; do`, ui.colors)}`
    );
    lines.push(
      `${indent(ui)}  ${dim(
        `  curl -X POST "$PUBLISH_URL" -H "Authorization: Bearer $PUBLISH_TOKEN" \\`,
        ui.colors
      )}`
    );
    lines.push(
      `${indent(ui)}  ${dim(
        `    -H "Content-Type: application/json" -d @"$f"`,
        ui.colors
      )}`
    );
    lines.push(`${indent(ui)}  ${dim(`done`, ui.colors)}`);
  }

  const footerLines = footer(
    [
      `auto-geo write \u00b7 github.com/shadowresearch/auto-geo`,
      `Re-run: npx auto-geo write --domain ${summary.domain} --query "<q>"`,
    ],
    ui
  );
  for (const ln of footerLines) lines.push(ln);
  lines.push(`${indent(ui)}${dim(`Generated by auto-geo write`, ui.colors)}`);

  // Hint to silence unused-var lint when no muted/Row consumers fire.
  void muted;

  return lines.join("\n");
}

export function renderWriteJson(summary: WriteSummary): string {
  // Strip the heavy `payload` from the JSON summary — callers who want
  // the full payload should read the files. Keep the slug + path so the
  // caller can re-locate everything.
  return JSON.stringify(
    {
      domain: summary.domain,
      provider: summary.provider,
      model: summary.modelName,
      outDir: summary.outDir,
      dryRun: summary.dryRun,
      totalUsage: summary.totalUsage,
      totalCost: summary.totalCost,
      elapsedMs: summary.elapsedMs,
      outcomes: summary.outcomes.map((o) => {
        if (o.kind === "ok") {
          return {
            kind: o.kind,
            query: o.query,
            slug: o.slug,
            filePath: o.filePath,
            usage: o.usage,
            retries: o.retries,
            cost: o.cost,
          };
        }
        return o;
      }),
      generatedBy: "auto-geo write",
    },
    null,
    2
  );
}

// ── Tiny helpers ──────────────────────────────────────────────────

function plural(n: number): string {
  return n === 1 ? "" : "s";
}

function formatYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
