import { z } from "zod";

/**
 * auto-geo resource publish schema — the contract between content-generating
 * agents and the `/api/resources/publish` endpoint.
 *
 * Encodes the page architecture mandated by the GEO SOP (see docs/sop.md)
 * rather than accepting freeform prose: every published page MUST have a
 * TL;DR, an intro, ≥1 H2 section (each with a 40-60 word answer capsule),
 * a Related Guides block (4-8 entries), a Key Takeaways block (4-6
 * entries), an FAQ block (3-10 entries), and a disclosure. The renderer
 * trusts this structure; validation rejects malformed publishes at the
 * boundary.
 *
 * Inline syntax allowed inside any `text` / `items[]` / `answer` field:
 *   - `**bold**`
 *   - `*italic*`
 *   - `[label](url)`  (internal if starts with "/", external otherwise)
 * No raw HTML; everything else is literal.
 *
 * Hard error policy (rejected with 400): structural omissions, length
 * violations on answer capsules / TLDR / FAQ answers, promotional
 * superlatives without attribution, invalid URLs.
 *
 * Soft warnings (200 with `warnings[]` in response): density / cadence
 * heuristics, run via `auditResource` in `validation.ts`.
 */

// ── Reusable primitives ───────────────────────────────────────────

const entityRefSchema = z.object({
  name: z
    .string()
    .min(1, "Entity name is required (e.g. 'OpenAI', 'Vercel KV')."),
  url: z
    .string()
    .url("Entity url must be a full URL like 'https://openai.com' or omitted.")
    .optional(),
});

const citationSchema = z.object({
  url: z
    .string()
    .url(
      "Citation url must be a full URL like 'https://schema.org/Article' — relative paths and bare domains are not allowed."
    ),
  title: z.string().optional(),
  publisher: z.string().optional(),
});

const authorSchema = z.object({
  name: z
    .string()
    .min(1, "author.name is required (e.g. 'Jane Doe').")
    .max(120, "author.name must be at most 120 characters."),
  jobTitle: z
    .string()
    .min(
      1,
      "author.jobTitle is required (e.g. 'Head of Content', 'Staff Engineer')."
    )
    .max(120, "author.jobTitle must be at most 120 characters."),
  /** 2-3 sentence bio rendered in the auto-injected "About the Author" block. */
  bio: z
    .string()
    .min(
      20,
      "author.bio must be at least 20 characters — typically 2-3 sentences establishing the author's relevant expertise."
    )
    .max(600, "author.bio must be at most 600 characters."),
  /** Drives Person.sameAs in JSON-LD. */
  linkedinUrl: z
    .string()
    .url(
      "author.linkedinUrl must be a full URL like 'https://www.linkedin.com/in/jane-doe' or omitted."
    )
    .optional(),
});

// ── Word-count helpers ────────────────────────────────────────────

function wordCount(text: string): number {
  // Strip inline-syntax markers so they don't get counted as separate tokens.
  const stripped = text
    .replace(/\*\*/g, "")
    .replace(/\*/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  const matches = stripped.trim().match(/\S+/g);
  return matches ? matches.length : 0;
}

function wordCountBetween(min: number, max: number, label: string) {
  return (val: string, ctx: z.RefinementCtx) => {
    const wc = wordCount(val);
    if (wc < min || wc > max) {
      ctx.addIssue({
        code: "custom",
        message: `${label} must be ${min}-${max} words; got ${wc}.`,
      });
    }
  };
}

// ── Promotional language guard ────────────────────────────────────

/**
 * Per SOP §5h, these superlatives carry a measured citation penalty and
 * are not allowed unless attributed (e.g., "#1 ranked by [source]") or
 * appearing inside a quoted passage. The regex below checks for the
 * banned phrases preceded by NOT being inside straight quotes; we keep
 * the heuristic conservative because the SOP treats this as a hard
 * constraint, not a guideline.
 *
 * Allowed if:
 *   - Phrase appears inside straight double-quotes anywhere in the field
 *   - Phrase is followed by an attribution marker: "(per …)", "(Source: …)",
 *     "[Named Source]", or "by [Named Source]"
 *
 * Otherwise: reject at publish boundary.
 */
const BANNED_SUPERLATIVES = [
  "industry-leading",
  "industry leading",
  "best-in-class",
  "best in class",
  "revolutionary",
  "game-changing",
  "game changing",
  "cutting-edge",
  "cutting edge",
  "world-class",
  "world class",
  "world's leading",
  "worlds leading",
  "the leading",
  "the premier",
  "next-generation",
  "next generation",
  "first-of-its-kind",
  "one of a kind",
] as const;

function containsBannedSuperlative(text: string): string | null {
  const lower = text.toLowerCase();
  for (const phrase of BANNED_SUPERLATIVES) {
    let idx = lower.indexOf(phrase);
    while (idx !== -1) {
      const before = text.slice(0, idx);
      const openQuotes = (before.match(/"/g) || []).length;
      const inQuote = openQuotes % 2 === 1;

      const after = text.slice(idx, idx + phrase.length + 80);
      const hasAttribution =
        /\b(per|by|according to|source:|\(source[:\s])\s+[A-Z]/i.test(after) ||
        /\[[^\]]+\]/.test(after) ||
        /\(\s*[A-Z][^)]{2,40}\)/.test(after);

      if (!inQuote && !hasAttribution) {
        return phrase;
      }
      idx = lower.indexOf(phrase, idx + 1);
    }
  }
  return null;
}

function noPromotionalSuperlatives(label: string) {
  return (val: string, ctx: z.RefinementCtx) => {
    const found = containsBannedSuperlative(val);
    if (found) {
      ctx.addIssue({
        code: "custom",
        message: `${label} contains banned promotional language "${found}" without attribution. Per SOP §5h, superlatives must be attributed (e.g., #1 ranked by [Named Source]) or appear inside a quoted passage.`,
      });
    }
  };
}

// ── Inline text field (every prose field uses this) ───────────────

/**
 * Any field that accepts inline syntax (**bold**, *italic*, [text](url))
 * runs through this. Rejects raw HTML (catches `<` followed by a tag
 * character) and promotional language.
 */
function inlineText(min: number, max: number, label: string) {
  return z
    .string()
    .min(min, `${label} must be at least ${min} characters.`)
    .max(max, `${label} must be at most ${max} characters.`)
    .superRefine((val, ctx) => {
      if (/<[a-zA-Z/!]/.test(val)) {
        ctx.addIssue({
          code: "custom",
          message: `${label} cannot contain raw HTML. Use **bold**, *italic*, [text](url) inline syntax instead.`,
        });
      }
      noPromotionalSuperlatives(label)(val, ctx);
    });
}

// ── Content blocks (live inside intro + section.blocks) ───────────

const paragraphBlockSchema = z.object({
  type: z.literal("paragraph"),
  text: inlineText(1, 2000, "Paragraph"),
});

const h3BlockSchema = z.object({
  type: z.literal("h3"),
  text: inlineText(1, 200, "H3 heading"),
});

const listBlockSchema = z.object({
  type: z.literal("list"),
  style: z.enum(["bullet", "number"]),
  items: z
    .array(inlineText(1, 1000, "List item"))
    .min(2, "Lists must have ≥2 items.")
    .max(30, "Lists must have ≤30 items."),
});

// NOTE: this MUST remain a plain ZodObject (no `.superRefine` wrapping)
// because it participates in `z.discriminatedUnion` below, which only
// accepts ZodObject inputs in Zod 3.x. The row/header cell-count check
// runs at the top-level schema refine — see `resourcePublishSchema`.
const tableBlockSchema = z.object({
  type: z.literal("table"),
  caption: z.string().max(200).optional(),
  headers: z
    .array(z.string().min(1).max(120))
    .min(2, "Tables must have ≥2 columns.")
    .max(10, "Tables must have ≤10 columns."),
  rows: z
    .array(z.array(z.string().max(500)))
    .min(1, "Tables must have ≥1 row.")
    .max(50, "Tables must have ≤50 rows."),
});

const quoteBlockSchema = z.object({
  type: z.literal("quote"),
  text: inlineText(1, 1000, "Quote text"),
  attribution: z.string().min(1).max(200),
});

const imageBlockSchema = z.object({
  type: z.literal("image"),
  src: z.string().url("Image src must be a full https URL."),
  /** Per SOP §7b, alt text must include the entity name and context. */
  alt: z
    .string()
    .min(20, "Image alt text must be ≥20 chars and include entity + context.")
    .max(300),
  caption: z.string().max(300).optional(),
});

const calloutBlockSchema = z.object({
  type: z.literal("callout"),
  variant: z.enum(["info", "stat"]),
  text: inlineText(1, 600, "Callout text"),
});

const contentBlockSchema = z.discriminatedUnion("type", [
  paragraphBlockSchema,
  h3BlockSchema,
  listBlockSchema,
  tableBlockSchema,
  quoteBlockSchema,
  imageBlockSchema,
  calloutBlockSchema,
]);

// ── Page architecture blocks (mandatory order) ────────────────────

const tldrSchema = z.object({
  text: z
    .string()
    .superRefine(wordCountBetween(40, 60, "TL;DR"))
    .superRefine(noPromotionalSuperlatives("TL;DR")),
});

const introSchema = z.object({
  blocks: z
    .array(contentBlockSchema)
    .min(1, "Intro must contain ≥1 block.")
    .max(10, "Intro must contain ≤10 blocks."),
});

const contentSectionSchema = z.object({
  /** H2 heading — ideally 6-10 words per SOP §3. */
  heading: inlineText(1, 200, "Section heading"),
  /** 40-60 words; renders as the first paragraph of the section. */
  answerCapsule: z
    .string()
    .superRefine(wordCountBetween(40, 60, "Section answer capsule"))
    .superRefine(noPromotionalSuperlatives("Section answer capsule")),
  blocks: z
    .array(contentBlockSchema)
    .min(0)
    .max(40, "Section must contain ≤40 blocks."),
});

const relatedGuidesSchema = z.object({
  items: z
    .array(
      z.object({
        title: z.string().min(1).max(200),
        url: z
          .string()
          .url("Related guide URL must be a full absolute URL per SOP §5d."),
      })
    )
    .min(4, "Related Guides must have ≥4 entries (SOP §5d).")
    .max(8, "Related Guides must have ≤8 entries (SOP §5d)."),
});

const keyTakeawayItem = z
  .string()
  .superRefine((val, ctx) => {
    const wc = wordCount(val);
    if (wc < 10 || wc > 35) {
      ctx.addIssue({
        code: "custom",
        message: `Key Takeaway must be 10-35 words (SOP §5e); got ${wc}.`,
      });
    }
  })
  .superRefine(noPromotionalSuperlatives("Key Takeaway"));

const keyTakeawaysSchema = z.object({
  items: z
    .array(keyTakeawayItem)
    .min(4, "Key Takeaways must have ≥4 bullets (SOP §5e).")
    .max(6, "Key Takeaways must have ≤6 bullets (SOP §5e)."),
});

const faqItemSchema = z.object({
  question: z.string().min(5).max(300),
  answer: z
    .string()
    .superRefine(wordCountBetween(40, 60, "FAQ answer"))
    .superRefine(noPromotionalSuperlatives("FAQ answer")),
});

const faqSchema = z.object({
  /** Optional heading override; defaults to "Frequently Asked Questions". */
  heading: z.string().max(100).optional(),
  items: z
    .array(faqItemSchema)
    .min(3, "FAQ must have ≥3 items (SOP §5f).")
    .max(10, "FAQ must have ≤10 items."),
});

const disclosureSchema = z.object({
  text: inlineText(20, 1000, "Disclosure"),
});

// ── GEO metadata (SOP §14 — stored internally, not rendered) ──────

const pageTypeSchema = z.enum([
  "definitive",
  "resource",
  "comparison",
  "category",
  "listicle",
]);

const optimizationFrameworkSchema = z.enum(["AEO", "GEO", "LLMO"]);

const targetPlatformSchema = z.enum([
  "chatgpt",
  "perplexity",
  "google_aio",
  "google_ai_mode",
  "claude",
  "gemini",
  "copilot",
]);

const geoMetadataSchema = z.object({
  targetQueries: z
    .array(z.string().min(3).max(200))
    .min(1, "Provide ≥1 target query.")
    .max(20),
  pageType: pageTypeSchema,
  primaryFunction: z.string().min(5).max(300),
  optimizationFramework: z
    .array(optimizationFrameworkSchema)
    .min(1, "Provide ≥1 optimization framework."),
  targetPlatforms: z
    .array(targetPlatformSchema)
    .min(1, "Provide ≥1 target platform."),
  informationGainStatement: z.string().min(20).max(600),
  proprietaryAssetOpportunity: z.string().max(600).optional(),
  refreshCadence: z.enum(["monthly", "quarterly"]),
});

// ── Top-level resource publish schema ─────────────────────────────

export const resourcePublishSchema = z
  .object({
    // ── Identity ────────────────────────────────────────────────
    slug: z
      .string()
      .min(1)
      .max(80)
      .regex(
        /^[a-z0-9]+(-[a-z0-9]+)*$/,
        "Slug must be lowercase letters, numbers, and single hyphens (no leading/trailing hyphen)."
      ),
    /** Page title rendered as <h1>. */
    title: z
      .string()
      .min(1, "title is required — the <h1> shown on the page.")
      .max(
        160,
        "title must be at most 160 characters (e.g. 'How does retrieval-augmented generation work?')."
      ),
    /** <title> tag content; may differ from h1. Defaults to title if omitted. */
    metaTitle: z
      .string()
      .min(1, "metaTitle, if provided, must not be empty.")
      .max(160, "metaTitle must be at most 160 characters.")
      .optional(),
    /** <meta name="description"> content. */
    metaDescription: z
      .string()
      .min(
        50,
        "metaDescription must be at least 50 characters — under 50 produces a thin <meta description> that AI overviews skip."
      )
      .max(
        180,
        "metaDescription must be at most 180 characters — longer descriptions get truncated by Google and most AI engines."
      ),
    /** Index/listing card category. */
    category: z
      .string()
      .min(
        1,
        "category is required (e.g. 'Tutorials', 'Comparisons', 'Concepts')."
      )
      .max(80, "category must be at most 80 characters."),
    /** 1-2 sentence summary for listing cards on /resources. */
    excerpt: z
      .string()
      .min(
        50,
        "excerpt must be at least 50 characters — typically 1-2 sentences summarizing the page for listing cards."
      )
      .max(400, "excerpt must be at most 400 characters."),

    // ── Authoring ───────────────────────────────────────────────
    author: authorSchema,
    publishedAt: z
      .string()
      .regex(
        /^\d{4}-\d{2}-\d{2}$/,
        "publishedAt must be a calendar date in yyyy-mm-dd form (e.g. '2026-06-01') — full ISO timestamps are not accepted."
      ),
    modifiedAt: z
      .string()
      .regex(
        /^\d{4}-\d{2}-\d{2}$/,
        "modifiedAt must be a calendar date in yyyy-mm-dd form (e.g. '2026-06-02') or omitted."
      )
      .optional(),

    // ── SEO ─────────────────────────────────────────────────────
    keywords: z.array(z.string().min(1).max(80)).max(15).optional(),
    ogImage: z.string().url().optional(),

    // ── GEO metadata (SOP §14) ──────────────────────────────────
    geoMetadata: geoMetadataSchema,

    // ── Entity refs (drive JSON-LD) ─────────────────────────────
    about: z.array(entityRefSchema).max(30).optional(),
    mentions: z.array(entityRefSchema).max(30).optional(),
    citations: z.array(citationSchema).max(50).optional(),

    // ── Body — mandatory architecture, in this order ────────────
    tldr: tldrSchema,
    intro: introSchema,
    sections: z
      .array(contentSectionSchema)
      .min(1, "Page must have ≥1 H2 section.")
      .max(40, "Page must have ≤40 H2 sections."),
    relatedGuides: relatedGuidesSchema,
    keyTakeaways: keyTakeawaysSchema,
    faq: faqSchema,
    disclosure: disclosureSchema,
  })
  .superRefine((val, ctx) => {
    // Comparison-page sanity: title pattern should look like "X vs Y" or
    // "{Competitor} Alternatives" when pageType is "comparison".
    if (val.geoMetadata.pageType === "comparison") {
      const looksComparison =
        /\bvs\.?\b|\balternatives?\b|\bcomparison\b/i.test(val.title);
      if (!looksComparison) {
        ctx.addIssue({
          code: "custom",
          path: ["title"],
          message: `Comparison page titles should match patterns like "X vs Y" or "X Alternatives" per SOP §5a.`,
        });
      }
    }
    if (val.modifiedAt && val.modifiedAt < val.publishedAt) {
      ctx.addIssue({
        code: "custom",
        path: ["modifiedAt"],
        message: "modifiedAt cannot be earlier than publishedAt.",
      });
    }
    // Table row/header consistency. Lives here (not on tableBlockSchema)
    // because z.discriminatedUnion requires plain ZodObject options.
    const checkTable = (
      block: ResourceContentBlock,
      pathPrefix: (string | number)[]
    ) => {
      if (block.type !== "table") return;
      for (let i = 0; i < block.rows.length; i++) {
        const row = block.rows[i]!;
        if (row.length !== block.headers.length) {
          ctx.addIssue({
            code: "custom",
            path: [...pathPrefix, "rows", i],
            message: `Row ${i + 1} has ${row.length} cells but table has ${block.headers.length} columns.`,
          });
        }
      }
    };
    val.intro.blocks.forEach((b, i) => checkTable(b, ["intro", "blocks", i]));
    val.sections.forEach((section, si) =>
      section.blocks.forEach((b, bi) =>
        checkTable(b, ["sections", si, "blocks", bi])
      )
    );
  });

// ── Exported types ────────────────────────────────────────────────

export type ResourcePublishPayload = z.infer<typeof resourcePublishSchema>;
export type ResourceAuthor = z.infer<typeof authorSchema>;
export type ResourceEntityRef = z.infer<typeof entityRefSchema>;
export type ResourceCitation = z.infer<typeof citationSchema>;
export type ResourceContentBlock = z.infer<typeof contentBlockSchema>;
export type ResourceContentSection = z.infer<typeof contentSectionSchema>;
export type ResourceParagraphBlock = z.infer<typeof paragraphBlockSchema>;
export type ResourceH3Block = z.infer<typeof h3BlockSchema>;
export type ResourceListBlock = z.infer<typeof listBlockSchema>;
export type ResourceTableBlock = z.infer<typeof tableBlockSchema>;
export type ResourceQuoteBlock = z.infer<typeof quoteBlockSchema>;
export type ResourceImageBlock = z.infer<typeof imageBlockSchema>;
export type ResourceCalloutBlock = z.infer<typeof calloutBlockSchema>;
export type ResourceFaqItem = z.infer<typeof faqItemSchema>;
export type ResourceGeoMetadata = z.infer<typeof geoMetadataSchema>;
export type ResourcePageType = z.infer<typeof pageTypeSchema>;
export type ResourceTargetPlatform = z.infer<typeof targetPlatformSchema>;

export { wordCount };
