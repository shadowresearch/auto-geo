import {
  wordCount,
  type ResourceContentBlock,
  type ResourceContentSection,
  type ResourcePageType,
  type ResourcePublishPayload,
} from "./schema";

/**
 * Soft validation pass that runs AFTER the Zod schema passes. These are
 * GEO-quality heuristics from the SOP — density, cadence, and structure
 * signals that don't justify a hard reject (the heuristics will have
 * false negatives) but should surface so the calling agent can iterate.
 *
 * Returned as `warnings[]` on a 200 publish response. Hard errors are
 * always Zod's job; if you find yourself adding a true must-fix here,
 * promote it to the schema.
 *
 * Heuristics are intentionally simple and English-only — they're meant
 * to flag obvious structural deficiencies, not catch every nuance.
 *
 * Re-export this list as `docs/validation.md` keeps in sync.
 */

export type ResourceWarning = {
  /** Dotted path to the offending field, mirrors Zod's `issue.path`. */
  path: string;
  /** Short, actionable message. */
  message: string;
  /** Source SOP section for reference (informational). */
  sop?: string;
};

// ── Helpers ───────────────────────────────────────────────────────

function paragraphsOfBlock(block: ResourceContentBlock): string[] {
  if (block.type === "paragraph") return [block.text];
  if (block.type === "callout") return [block.text];
  return [];
}

function imageCount(blocks: ResourceContentBlock[]): number {
  return blocks.filter((b) => b.type === "image").length;
}

function tableCount(blocks: ResourceContentBlock[]): number {
  return blocks.filter((b) => b.type === "table").length;
}

function listCount(blocks: ResourceContentBlock[]): number {
  return blocks.filter((b) => b.type === "list").length;
}

function allBlocks(payload: ResourcePublishPayload): ResourceContentBlock[] {
  return [
    ...payload.intro.blocks,
    ...payload.sections.flatMap((s) => s.blocks),
  ];
}

function externalLinkCount(text: string): number {
  const matches = text.match(/\]\((https?:\/\/[^)]+)\)/g);
  return matches ? matches.length : 0;
}

function textContent(blocks: ResourceContentBlock[]): string {
  return blocks
    .map((b) => {
      switch (b.type) {
        case "paragraph":
        case "callout":
        case "h3":
          return b.text;
        case "list":
          return b.items.join(" ");
        case "table":
          return [
            b.caption ?? "",
            b.headers.join(" "),
            b.rows.flat().join(" "),
          ].join(" ");
        case "quote":
          return `${b.text} ${b.attribution}`;
        case "image":
          return b.alt;
      }
    })
    .join("\n\n");
}

function totalWordCount(payload: ResourcePublishPayload): number {
  const sectionText = payload.sections
    .map((s) => `${s.heading} ${s.answerCapsule} ${textContent(s.blocks)}`)
    .join("\n");
  const introText = textContent(payload.intro.blocks);
  return wordCount(
    [
      payload.tldr.text,
      introText,
      sectionText,
      payload.relatedGuides.items.map((g) => g.title).join(" "),
      payload.keyTakeaways.items.join(" "),
      payload.faq.items.map((f) => `${f.question} ${f.answer}`).join(" "),
      payload.disclosure.text,
    ].join("\n\n")
  );
}

/**
 * Count statistics-like tokens (percentages, digit-led numbers, scientific
 * notation). Tolerant heuristic — matches the SOP's "10 stats per 1,000
 * words" guidance close enough to flag obvious deficiencies.
 */
function statisticsCount(text: string): number {
  const patterns = [
    /\b\d+(\.\d+)?\s?%/g,
    /\b\d{1,3}(,\d{3})+(\.\d+)?/g,
    /\$\d+(\.\d+)?[kmbKMB]?\b/g,
    /\b\d+(\.\d+)?[kmbKMB]\b/g,
    /\b\d+x\b/g,
    /\bOR=\d+(\.\d+)?\b/gi,
  ];
  return patterns.reduce(
    (acc, re) => acc + (text.match(re) || []).length,
    0
  );
}

/**
 * Heuristic for named entities: count capitalized words that are not
 * sentence-starters, after stripping inline-syntax markers. Joins
 * back-to-back capitalized words ("Google AI Overviews") as one entity.
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

// ── Page-type expectations (SOP §4) ───────────────────────────────

type PageTypeExpectations = {
  minWords: number;
  maxWords: number | null;
  minTables: number;
  minLists: number;
  statsPerThousand: number;
};

const PAGE_TYPE_EXPECTATIONS: Record<ResourcePageType, PageTypeExpectations> = {
  definitive: { minWords: 3000, maxWords: null, minTables: 2, minLists: 5, statsPerThousand: 10 },
  resource: { minWords: 800, maxWords: 1500, minTables: 0, minLists: 3, statsPerThousand: 3 },
  comparison: { minWords: 1000, maxWords: 1500, minTables: 1, minLists: 3, statsPerThousand: 3 },
  category: { minWords: 2000, maxWords: 4000, minTables: 1, minLists: 5, statsPerThousand: 5 },
  listicle: { minWords: 1500, maxWords: 3000, minTables: 1, minLists: 5, statsPerThousand: 3 },
};

// ── Section-level audits ──────────────────────────────────────────

function auditSection(
  section: ResourceContentSection,
  index: number,
  warnings: ResourceWarning[]
) {
  const sectionPath = `sections[${index}]`;

  const totalWords =
    wordCount(section.heading) +
    wordCount(section.answerCapsule) +
    wordCount(textContent(section.blocks));
  if (totalWords < 134 || totalWords > 167) {
    warnings.push({
      path: `${sectionPath}.totalWords`,
      message: `Section "${section.heading.slice(0, 40)}…" is ${totalWords} words (SOP §5b ideal: 134-167).`,
      sop: "§5b",
    });
  }

  const headingWords = wordCount(section.heading);
  if (headingWords < 4 || headingWords > 12) {
    warnings.push({
      path: `${sectionPath}.heading`,
      message: `Section heading is ${headingWords} words (SOP §3 ideal: 6-10).`,
      sop: "§3",
    });
  }
  if (!/[?]/.test(section.heading)) {
    warnings.push({
      path: `${sectionPath}.heading`,
      message: `Section heading should be question-format per SOP §3 (no "?" found).`,
      sop: "§3",
    });
  }

  const paragraphs = section.blocks.flatMap(paragraphsOfBlock);
  paragraphs.forEach((p, pi) => {
    const wc = wordCount(p);
    if (wc < 40 || wc > 120) {
      warnings.push({
        path: `${sectionPath}.blocks[${pi}]`,
        message: `Paragraph is ${wc} words (SOP §5b ideal: 60-100).`,
        sop: "§5b",
      });
    }
  });

  const allInlineText = [
    section.answerCapsule,
    ...section.blocks.flatMap((b) => {
      if (b.type === "paragraph" || b.type === "callout") return [b.text];
      if (b.type === "list") return b.items;
      return [];
    }),
  ].join(" ");
  const outboundCount = externalLinkCount(allInlineText);
  if (outboundCount < 1) {
    warnings.push({
      path: `${sectionPath}.outboundLinks`,
      message: `Section has 0 outbound links; SOP §5c recommends 1-2 per H2 to authoritative non-self domains.`,
      sop: "§5c",
    });
  } else if (outboundCount > 4) {
    warnings.push({
      path: `${sectionPath}.outboundLinks`,
      message: `Section has ${outboundCount} outbound links; SOP §5c warns heavy external linking patterns as aggregator content (citation discount).`,
      sop: "§5c",
    });
  }
}

// ── Page-level audits ─────────────────────────────────────────────

export function auditResource(
  payload: ResourcePublishPayload
): ResourceWarning[] {
  const warnings: ResourceWarning[] = [];

  payload.sections.forEach((s, i) => auditSection(s, i, warnings));

  const total = totalWordCount(payload);
  const expectations = PAGE_TYPE_EXPECTATIONS[payload.geoMetadata.pageType];

  if (total < expectations.minWords) {
    warnings.push({
      path: "totalWords",
      message: `Page is ${total} words; ${payload.geoMetadata.pageType} page type targets ≥${expectations.minWords} words per SOP §4.`,
      sop: "§4",
    });
  }
  if (expectations.maxWords && total > expectations.maxWords) {
    warnings.push({
      path: "totalWords",
      message: `Page is ${total} words; ${payload.geoMetadata.pageType} page type targets ≤${expectations.maxWords} words per SOP §4.`,
      sop: "§4",
    });
  }

  const blocks = allBlocks(payload);
  const bodyText = textContent(blocks);
  const stats = statisticsCount(bodyText);
  const statsPerThousand = total > 0 ? (stats / total) * 1000 : 0;
  if (statsPerThousand < expectations.statsPerThousand) {
    warnings.push({
      path: "statisticsDensity",
      message: `Statistics density is ${statsPerThousand.toFixed(1)}/1k words; SOP §7 + §5c target ${expectations.statsPerThousand}/1k for ${payload.geoMetadata.pageType} pages.`,
      sop: "§7",
    });
  }

  const entities = namedEntityCount(bodyText);
  if (entities < 15) {
    warnings.push({
      path: "entityDensity",
      message: `~${entities} named entities detected; SOP §5g targets 15+ for ~4.8x citation probability.`,
      sop: "§5g",
    });
  }

  const lists = listCount(blocks);
  if (lists < expectations.minLists) {
    warnings.push({
      path: "listCount",
      message: `Page has ${lists} list blocks; SOP §7 targets ≥${expectations.minLists} for ${payload.geoMetadata.pageType} pages.`,
      sop: "§7",
    });
  }

  const tables = tableCount(blocks);
  if (tables < expectations.minTables) {
    warnings.push({
      path: "tableCount",
      message: `Page has ${tables} tables; SOP §7 targets ≥${expectations.minTables} for ${payload.geoMetadata.pageType} pages.`,
      sop: "§7",
    });
  }

  const images = imageCount(blocks);
  const expectedImages = Math.floor(total / 500);
  if (expectedImages > 0 && images < expectedImages) {
    warnings.push({
      path: "imageCadence",
      message: `Page has ${images} images vs. ~${expectedImages} expected (1 per 500 words per SOP §7b; multimodal lifts citation 156-317%).`,
      sop: "§7b",
    });
  }

  const selfSlugRegex = new RegExp(`/resources/${payload.slug}(?:$|[/?#])`);
  for (let i = 0; i < payload.relatedGuides.items.length; i++) {
    if (selfSlugRegex.test(payload.relatedGuides.items[i]!.url)) {
      warnings.push({
        path: `relatedGuides.items[${i}]`,
        message: `Related Guides entry links to the page itself; SOP §5d explicitly forbids self-links.`,
        sop: "§5d",
      });
    }
  }

  return warnings;
}
