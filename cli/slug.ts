/**
 * Slug derivation for `auto-geo write`.
 *
 * The contract is small: turn a target query like "what is GEO" into a
 * stable, schema-conforming slug ("geo"). The schema regex is
 * `^[a-z0-9]+(-[a-z0-9]+)*$` so we lowercase, strip non-alphanumerics,
 * remove a curated set of question-leading stopwords, and collapse runs
 * of hyphens.
 *
 * Stopwords are intentionally narrow — only the kinds of words that
 * dominate query-phrasing without carrying topical signal (what, how,
 * the, an, etc.). Topical words like "GEO", "SEO", "ChatGPT" survive.
 *
 * Multiple queries can map to the same slug (e.g. "what is GEO" and
 * "what is generative engine optimization" both collapsing to a short
 * stem); `deriveUniqueSlugs` discriminates by appending `-2`, `-3`, …
 * to later collisions.
 */

const STOPWORDS = new Set([
  "what",
  "whats",
  "how",
  "why",
  "when",
  "where",
  "which",
  "who",
  "whom",
  "is",
  "are",
  "am",
  "was",
  "were",
  "be",
  "been",
  "being",
  "do",
  "does",
  "did",
  "doing",
  "the",
  "a",
  "an",
  "and",
  "or",
  "of",
  "to",
  "in",
  "on",
  "for",
  "by",
  "with",
  "from",
  "at",
  "as",
  "into",
  "about",
  "it",
  "this",
  "that",
  "these",
  "those",
  "i",
  "you",
  "we",
  "they",
  "my",
  "your",
  "our",
  "their",
  "can",
  "should",
  "would",
  "could",
  "will",
  "shall",
]);

const MAX_LEN = 80;

export function slugifyQuery(query: string): string {
  // Lowercase, replace non-alphanumeric runs with single hyphens.
  const normalized = query
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");

  if (!normalized) return "page";

  const kept: string[] = [];
  for (const token of normalized.split("-")) {
    if (!token) continue;
    if (STOPWORDS.has(token)) continue;
    kept.push(token);
  }

  // If every token was a stopword (degenerate query like "what is it"),
  // fall back to the un-stopworded form so we still produce a slug.
  const out = kept.length > 0 ? kept.join("-") : normalized;
  return truncate(out);
}

function truncate(slug: string): string {
  if (slug.length <= MAX_LEN) return slug;
  // Truncate to the last hyphen boundary so we don't slice a word.
  const cut = slug.slice(0, MAX_LEN);
  const lastDash = cut.lastIndexOf("-");
  return lastDash > 20 ? cut.slice(0, lastDash) : cut;
}

/**
 * Map a list of queries to unique, schema-conforming slugs. Stable: the
 * first query mapping to a slug wins it; later collisions get `-2`,
 * `-3`, … appended.
 */
export function deriveUniqueSlugs(queries: string[]): string[] {
  const seen = new Map<string, number>();
  const out: string[] = [];
  for (const q of queries) {
    const base = slugifyQuery(q);
    const count = seen.get(base) ?? 0;
    if (count === 0) {
      seen.set(base, 1);
      out.push(base);
    } else {
      const next = count + 1;
      // Truncate base to leave room for the discriminator suffix.
      const suffix = `-${next}`;
      const room = MAX_LEN - suffix.length;
      const stem =
        base.length > room ? base.slice(0, room).replace(/-+$/, "") : base;
      out.push(`${stem}${suffix}`);
      seen.set(base, next);
    }
  }
  return out;
}
