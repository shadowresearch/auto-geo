import type { GenerateResourceUsage, ProviderId } from "./llm";

/**
 * Per-token cost estimation for `auto-geo write`. We hardcode public
 * USD rates for the cheap default models so the CLI can display a
 * "~$0.18" estimate without an API call to billing endpoints. Users on
 * premium models are expected to verify against their own bill — we
 * fall back to a conservative estimate using a `default` row.
 *
 * Rates are USD per 1M tokens. Update when providers publish new
 * pricing. Sources:
 * - https://openai.com/api/pricing/
 * - https://www.anthropic.com/pricing
 *
 * If you find a divergence, treat the displayed estimate as
 * indicative — the user's billing dashboard is the ground truth.
 */

type Rate = {
  /** USD per 1,000,000 input tokens. */
  input: number;
  /** USD per 1,000,000 output tokens. */
  output: number;
};

// Per-model rates. Keys are lowercased model id prefixes. We pick the
// longest prefix that matches a given model so callers can pass either
// "gpt-5.4" or "gpt-5.4-2026-03-05".
//
// v0.6.2 — cost tables narrowed to the latest three generations from
// each provider (per project policy: no gpt-4o* or claude-3-5-* in
// defaults or rate tables). Users who pin an older model via `--model`
// fall through to DEFAULT_RATES for the estimate; their actual bill
// is unaffected — the estimate is advisory.
const OPENAI_RATES: Record<string, Rate> = {
  // gpt-5.5 (April 2026) — newest full-tier model.
  "gpt-5.5": { input: 5, output: 20 },
  // gpt-5.4 (March 2026) — current default. The full/mini/nano triple
  // covers the same span gpt-4o family did at lower cost and with
  // materially better instruction-following on tight schemas (the
  // reason mini/4o fell over on resourcePublishSchema in v0.6.x).
  "gpt-5.4-nano": { input: 0.1, output: 0.4 },
  "gpt-5.4-mini": { input: 0.5, output: 2 },
  "gpt-5.4": { input: 2.5, output: 10 },
  // gpt-5.2 (December 2025) — kept so longest-prefix lookup answers
  // for users who pin it explicitly.
  "gpt-5.2": { input: 2, output: 8 },
};

const ANTHROPIC_RATES: Record<string, Rate> = {
  // Latest of each tier from the claude-4-* family.
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-opus-4-8": { input: 15, output: 75 },
  // Generic family prefixes — catches any point releases the provider
  // ships before this table is updated (e.g. claude-sonnet-4-7).
  "claude-haiku": { input: 1, output: 5 },
  "claude-sonnet": { input: 3, output: 15 },
  "claude-opus": { input: 15, output: 75 },
};

// Conservative defaults when the model id doesn't match any prefix.
// Tuned upward so we never under-quote.
const DEFAULT_RATES: Record<ProviderId, Rate> = {
  openai: { input: 5, output: 20 },
  anthropic: { input: 3, output: 15 },
};

export function lookupRate(provider: ProviderId, modelName: string): Rate {
  const table = provider === "openai" ? OPENAI_RATES : ANTHROPIC_RATES;
  const id = modelName.toLowerCase();
  // Longest matching prefix wins so "gpt-5.4-2026-03-05" matches
  // "gpt-5.4" and not "gpt-5.4-mini" by accident.
  let best: { prefix: string; rate: Rate } | null = null;
  for (const [prefix, rate] of Object.entries(table)) {
    if (id.startsWith(prefix)) {
      if (!best || prefix.length > best.prefix.length) {
        best = { prefix, rate };
      }
    }
  }
  return best ? best.rate : DEFAULT_RATES[provider];
}

export function estimateCost(
  provider: ProviderId,
  modelName: string,
  usage: GenerateResourceUsage
): number {
  const rate = lookupRate(provider, modelName);
  const inputCost = (usage.inputTokens / 1_000_000) * rate.input;
  const outputCost = (usage.outputTokens / 1_000_000) * rate.output;
  return inputCost + outputCost;
}

export function sumUsage(
  usages: GenerateResourceUsage[]
): GenerateResourceUsage {
  return usages.reduce<GenerateResourceUsage>(
    (acc, u) => ({
      inputTokens: acc.inputTokens + u.inputTokens,
      outputTokens: acc.outputTokens + u.outputTokens,
      totalTokens: acc.totalTokens + u.totalTokens,
    }),
    { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
  );
}

export function formatUsd(amount: number): string {
  if (amount < 0.01) return "<$0.01";
  if (amount < 1) return `$${amount.toFixed(2)}`;
  if (amount < 100) return `$${amount.toFixed(2)}`;
  return `$${amount.toFixed(0)}`;
}

/**
 * Approximate the cost of a single page before any LLM call. Used by
 * --dry-run. Based on observed runs: ~1.2k input tokens (system + user
 * + schema description) and ~3.5k output tokens (a full resource
 * payload). Conservative; real costs come from `estimateCost` against
 * actual usage.
 */
export function estimateCostPerPage(
  provider: ProviderId,
  modelName: string
): number {
  const usage: GenerateResourceUsage = {
    inputTokens: 1200,
    outputTokens: 3500,
    totalTokens: 4700,
  };
  return estimateCost(provider, modelName, usage);
}
