import type { CheckResult, ParsedPage } from "./types";

/**
 * Pure heuristic functions over a `ParsedPage`. Each function returns
 * one `CheckResult`. They take no I/O dependencies so each is unit
 * testable in isolation against hand-built fixtures.
 *
 * The heuristics mirror `core/validation.ts` where possible (e.g. the
 * `namedEntityCount` heuristic is ported verbatim so audit semantics
 * match the publish-time validator) and re-interpret the rest for
 * HTML-as-input (no typed payload to inspect).
 *
 * SOP references match `docs/sop.md`. Thresholds are the SOP's
 * empirically-derived targets, not arbitrary picks.
 */

// ── Helpers (ported from core/validation.ts) ───────────────────────

/**
 * Heuristic for named entities: count capitalized words that are not
 * sentence-starters, after stripping inline-syntax markers. Joins
 * back-to-back capitalized words ("Google AI Overviews") as one entity.
 *
 * Verbatim from `core/validation.ts` so the audit signal matches the
 * publish-time validator. Keep in lockstep when one changes.
 */
function namedEntityCount(text: string): number {
  const stripped = text
    .replace(/\*\*/g, "")
    .replace(/\*/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  const sentences = stripped.split(/[.!?]\s+/);
  let count = 0;
  for (const sentence of sentences) {
    const tokens = sentence.split(/\s+/);
    let inEntity = false;
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i]!.replace(/[^a-zA-Z']/g, "");
      const isCapStart = /^[A-Z]/.test(t);
      if (i === 0) {
        inEntity = false;
        continue;
      }
      if (isCapStart) {
        if (!inEntity) {
          count++;
          inEntity = true;
        }
      } else {
        inEntity = false;
      }
    }
  }
  return count;
}

function wordCountOf(s: string): number {
  const m = s.match(/\b[\w'-]+\b/g);
  return m ? m.length : 0;
}

/** Does a JSON-LD block (or its `@graph` children) declare any of `types`? */
function ldHasType(block: unknown, types: string[]): boolean {
  if (!block || typeof block !== "object") return false;
  const obj = block as Record<string, unknown>;

  const t = obj["@type"];
  const matches = (val: unknown): boolean => {
    if (typeof val === "string") return types.some((target) => val === target);
    if (Array.isArray(val))
      return val.some((v) => typeof v === "string" && types.includes(v));
    return false;
  };
  if (matches(t)) return true;

  const graph = obj["@graph"];
  if (Array.isArray(graph)) return graph.some((node) => ldHasType(node, types));

  return false;
}

/** "Article"-ish types per Schema.org: Article + its subtypes. */
const ARTICLE_TYPES = [
  "Article",
  "NewsArticle",
  "BlogPosting",
  "TechArticle",
  "Report",
  "ScholarlyArticle",
];

// ── Checks ─────────────────────────────────────────────────────────

export function checkTldrPresent(page: ParsedPage): CheckResult {
  // Heuristic: a TL;DR is the first text chunk before any H2, OR a
  // chunk explicitly labelled "TL;DR" / "TLDR" / "TL;DR:". Target
  // word count from SOP §5j: 40-60.
  //
  // The "find the end of the TL;DR" split is sensitive to how the page
  // emits whitespace between adjacent <p> elements. linkedom's
  // `textContent` concatenates element text without inserting a space,
  // so `</p><p>` boundaries surface as `"…end.Next…"` (no whitespace
  // after the period). A naïve `[.!?]\s+` split misses those boundaries
  // entirely and treats the whole element-fused passage as one
  // sentence — overcounting a 50-word TL;DR up to 80+ words.
  //
  // The fix: split on a sentence terminator followed by *either*
  // whitespace OR an uppercase letter (i.e., the next paragraph's
  // capitalized first word abutting the previous paragraph's period).
  // That recovers the real sentence boundary across element joins
  // without changing behavior for well-spaced prose.
  // The separator after the label is `[:\s]*` (zero-or-more) rather
  // than `+`, because `<p>TL;DR</p><p>Generative…</p>` concatenates
  // under linkedom's textContent as `"TL;DRGenerative…"` with no
  // separator. With `+`, the first match falls through to a later
  // mid-prose mention of "TL;DR" and captures unrelated content.
  const labelMatch = page.text.match(/TL;?DR[:\s]*([\s\S]{0,800})/i);
  // Read up to 3 sentence-bounded chunks for the labelled-TL;DR case.
  // A canonical SOP-shaped TL;DR is 40–60 words, frequently 2–3
  // sentences; taking only the first sentence under-counts and reports
  // <40 even when the page is correct.
  const labelChunks = labelMatch
    ? labelMatch[1]!.split(/[.!?](?=\s|[A-Z]|$)/).filter((s) => s.trim())
    : [];
  const candidate = labelChunks.slice(0, 3).join(". ").trim();
  const usingLabel = candidate.length > 0;
  const source = usingLabel ? candidate : page.leadText;

  // Cap the TL;DR window at ~80 words — a labelled TL;DR can be the
  // entire pre-H2 region, and we don't want a 500-word intro to score
  // as a "TL;DR." The first three sentence-bounded chunks are the
  // citable unit.
  const wc = Math.min(wordCountOf(source), 80);
  const inRange = wc >= 40 && wc <= 60;

  return {
    id: "tldr-present",
    name: "TL;DR present",
    pass: inRange,
    detail: usingLabel
      ? `Found TL;DR label, ${wc} words${inRange ? ", in range" : " (target 40-60)"}`
      : wc > 0
        ? `Lead text is ${wc} words${inRange ? ", in range" : " (target 40-60)"}`
        : "No lead text found above first H2",
    fixSuggestion:
      "Add a 40-60 word TL;DR block immediately after the H1. Label it 'TL;DR' for explicit extraction.",
    citationImpactRank: 2,
    sop: "§5j",
  };
}

export function checkQuestionH2(page: ParsedPage): CheckResult {
  // The GEO page architecture pins structural H2s that aren't content
  // questions: "Related Guides", "Key Takeaways", "FAQ" / "Frequently
  // Asked Questions", "About the Author", "Disclosure", "References".
  // These are page-architecture furniture, not topic headings the AI
  // engine extracts as Q&A targets — counting them against the
  // question-format ratio penalizes correctly-architected pages.
  const STRUCTURAL_H2_PATTERNS = [
    /^related\s+guides?$/i,
    /^key\s+takeaways?$/i,
    /^faq$/i,
    /^frequently\s+asked\s+questions?$/i,
    /^about\s+the\s+author$/i,
    /^disclosure$/i,
    /^references$/i,
    /^citations?$/i,
    /^table\s+of\s+contents$/i,
    /^contents$/i,
  ];

  const allH2s = page.headings.filter((h) => h.level === 2);
  const h2s = allH2s.filter(
    (h) => !STRUCTURAL_H2_PATTERNS.some((re) => re.test(h.text.trim()))
  );
  const total = h2s.length;
  const questions = h2s.filter((h) => /\?\s*$/.test(h.text)).length;
  const ratio = total === 0 ? 0 : questions / total;
  // SOP §3 targets question-format for every H2. We pass at ≥80% to
  // tolerate the occasional valid statement-form heading.
  const pass = total > 0 && ratio >= 0.8;

  return {
    id: "question-h2",
    name: "Question-format H2 headings",
    pass,
    detail:
      total === 0
        ? "No H2 headings found"
        : `${questions} of ${total} are question-format${pass ? "" : "; SOP §3 targets all"}`,
    fixSuggestion: `Convert ${total - questions} statement-form H2 heading${total - questions === 1 ? "" : "s"} to question form (the questions a user would ask an AI engine).`,
    citationImpactRank: 3,
    sop: "§3",
  };
}

export function checkArticleJsonLd(page: ParsedPage): CheckResult {
  const present = page.jsonLd.some((b) => ldHasType(b, ARTICLE_TYPES));
  return {
    id: "article-jsonld",
    name: "Article JSON-LD present",
    pass: present,
    detail: present
      ? "Schema.org/Article JSON-LD found"
      : "No Article JSON-LD block detected",
    fixSuggestion:
      "Emit a Schema.org/Article JSON-LD block with @type 'Article', headline, author, datePublished, and publisher.",
    citationImpactRank: 4,
    sop: "§13",
  };
}

export function checkFaqPageJsonLd(page: ParsedPage): CheckResult {
  const present = page.jsonLd.some((b) => ldHasType(b, ["FAQPage"]));
  return {
    id: "faqpage-jsonld",
    name: "FAQPage JSON-LD present",
    pass: present,
    detail: present
      ? "Schema.org/FAQPage JSON-LD found"
      : "No FAQPage JSON-LD block detected",
    fixSuggestion:
      "Add a FAQPage JSON-LD block. Each Q is a citable extraction target.",
    // Per SOP §5f, FAQPage drives independent extraction → highest impact fix
    // when missing. Ranked 1.
    citationImpactRank: 1,
    sop: "§13",
  };
}

export function checkEntityDensity(page: ParsedPage): CheckResult {
  const entities = namedEntityCount(page.text);
  const per1k = page.wordCount > 0 ? (entities / page.wordCount) * 1000 : 0;
  // SOP §5g: 15+ entities per page, which on a typical resource page
  // (≥800 words) is ~8 per 1k. We use the per-1k threshold so the
  // check generalizes to pages of any length.
  const pass = per1k >= 8;

  return {
    id: "entity-density",
    name: "Entity density",
    pass,
    detail: `${per1k.toFixed(1)}/1k words (${entities} entities in ${page.wordCount} words)`,
    fixSuggestion:
      "Add named entities (companies, people, products, frameworks) inline — pages with ≥15 entities show ~4.8x higher citation probability.",
    citationImpactRank: 5,
    sop: "§5g",
  };
}

export function checkImageCadence(page: ParsedPage): CheckResult {
  const images = page.images.length;
  const expected = Math.max(1, Math.floor(page.wordCount / 500));
  const pass = images >= expected;
  return {
    id: "image-cadence",
    name: "Image cadence",
    pass,
    detail: `${images} image${images === 1 ? "" : "s"} for ${page.wordCount} words (target ~${expected}, 1 per 500 words)`,
    fixSuggestion: `Add ${Math.max(1, expected - images)} image${expected - images === 1 ? "" : "s"} with descriptive alt text (entity + context).`,
    citationImpactRank: 6,
    sop: "§7b",
  };
}

export function checkAnswerFirst(page: ParsedPage): CheckResult {
  const p = page.firstParagraph;
  const wc = wordCountOf(p);
  // Heuristics: a healthy answer-first lede is a single declarative
  // sentence, 20-120 words, not opening with throat-clearing phrases.
  const HEDGES = [
    /^in this (article|guide|post),?\s+we\b/i,
    /^this (article|guide|post)\b/i,
    /^we will\b/i,
    /^let'?s\b/i,
    /^welcome\b/i,
  ];
  const hedged = HEDGES.some((re) => re.test(p));
  const pass = !hedged && wc >= 20 && wc <= 120 && p.length > 0;
  return {
    id: "answer-first",
    name: "Answer-first first paragraph",
    pass,
    detail:
      p.length === 0
        ? "No first paragraph found"
        : hedged
          ? `First paragraph opens with a hedge phrase (${wc} words)`
          : wc < 20
            ? `First paragraph is ${wc} words (too short — target 20-120)`
            : wc > 120
              ? `First paragraph is ${wc} words (too long — target 20-120)`
              : `${wc}-word lede, leads with a declarative answer`,
    fixSuggestion:
      "Open with a self-contained answer to the page's primary question. Cut 'in this article we will…' style hedges.",
    citationImpactRank: 7,
    sop: "§6",
  };
}

export function checkNoSelfLink(page: ParsedPage): CheckResult {
  // Detect a self-link in the related section. We compare paths because
  // origins may legitimately differ (canonical vs alt). The page's own
  // URL is the source-of-truth identity.
  let pageHost = "";
  let pagePath = "";
  try {
    const u = new URL(page.url);
    pageHost = u.host;
    pagePath = u.pathname.replace(/\/+$/, "");
  } catch {
    // Bad URL — skip self-link detection; mark pass to avoid false positive.
    return {
      id: "no-self-link",
      name: "No self-link in related guides",
      pass: true,
      detail: "Page URL could not be parsed; skipped self-link check",
      fixSuggestion: "n/a",
      citationImpactRank: 8,
      sop: "§5d",
    };
  }

  const selfLinks = page.links.filter((l) => {
    if (!l.inRelatedSection) return false;
    if (!l.href) return false;
    try {
      const u = new URL(l.href, page.url);
      const linkPath = u.pathname.replace(/\/+$/, "");
      return u.host === pageHost && linkPath === pagePath;
    } catch {
      return false;
    }
  });
  const pass = selfLinks.length === 0;
  return {
    id: "no-self-link",
    name: "No self-link in related guides",
    pass,
    detail: pass
      ? "No self-links detected in related section"
      : `${selfLinks.length} self-link${selfLinks.length === 1 ? "" : "s"} detected in related section`,
    fixSuggestion:
      "Remove self-links from the related guides block. SOP §5d explicitly forbids them — they dilute the entity-graph signal.",
    citationImpactRank: 8,
    sop: "§5d",
  };
}

/** Run all checks. Order is fixed so the human report renders consistently. */
export function runAllChecks(page: ParsedPage): CheckResult[] {
  return [
    checkTldrPresent(page),
    checkQuestionH2(page),
    checkArticleJsonLd(page),
    checkFaqPageJsonLd(page),
    checkEntityDensity(page),
    checkImageCadence(page),
    checkAnswerFirst(page),
    checkNoSelfLink(page),
  ];
}
