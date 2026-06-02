import { describe, it, expect } from "vitest";
import { resourcePublishSchema, wordCount } from "../core/schema";
import { VALID_PAYLOAD } from "./fixtures/payload";

describe("resourcePublishSchema", () => {
  describe("happy path", () => {
    it("accepts the canonical valid payload", () => {
      const result = resourcePublishSchema.safeParse(VALID_PAYLOAD);
      if (!result.success) {
        console.error(result.error.issues);
      }
      expect(result.success).toBe(true);
    });

    it("accepts optional fields omitted", () => {
      const { keywords, ogImage, about, mentions, citations, modifiedAt, ...rest } =
        VALID_PAYLOAD;
      const result = resourcePublishSchema.safeParse(rest);
      expect(result.success).toBe(true);
    });
  });

  describe("identity validation", () => {
    it("rejects slugs with uppercase letters", () => {
      const result = resourcePublishSchema.safeParse({
        ...VALID_PAYLOAD,
        slug: "Has-Uppercase",
      });
      expect(result.success).toBe(false);
    });

    it("rejects slugs with leading hyphen", () => {
      const result = resourcePublishSchema.safeParse({
        ...VALID_PAYLOAD,
        slug: "-leading-hyphen",
      });
      expect(result.success).toBe(false);
    });

    it("rejects slugs with consecutive hyphens", () => {
      const result = resourcePublishSchema.safeParse({
        ...VALID_PAYLOAD,
        slug: "two--hyphens",
      });
      expect(result.success).toBe(false);
    });

    it("rejects metaDescription under 50 chars", () => {
      const result = resourcePublishSchema.safeParse({
        ...VALID_PAYLOAD,
        metaDescription: "too short",
      });
      expect(result.success).toBe(false);
    });

    it("rejects metaDescription over 180 chars", () => {
      const result = resourcePublishSchema.safeParse({
        ...VALID_PAYLOAD,
        metaDescription: "x".repeat(181),
      });
      expect(result.success).toBe(false);
    });
  });

  describe("date validation", () => {
    it("rejects non-ISO publishedAt", () => {
      const result = resourcePublishSchema.safeParse({
        ...VALID_PAYLOAD,
        publishedAt: "June 1, 2026",
      });
      expect(result.success).toBe(false);
    });

    it("rejects modifiedAt earlier than publishedAt", () => {
      const result = resourcePublishSchema.safeParse({
        ...VALID_PAYLOAD,
        publishedAt: "2026-06-02",
        modifiedAt: "2026-06-01",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some((i) => i.path.join(".") === "modifiedAt")
        ).toBe(true);
      }
    });
  });

  describe("TL;DR length", () => {
    it("rejects TL;DR below 40 words", () => {
      const result = resourcePublishSchema.safeParse({
        ...VALID_PAYLOAD,
        tldr: { text: "Way too short." },
      });
      expect(result.success).toBe(false);
    });

    it("rejects TL;DR above 60 words", () => {
      const longText = Array.from({ length: 80 }, (_, i) => `word${i}`).join(" ");
      const result = resourcePublishSchema.safeParse({
        ...VALID_PAYLOAD,
        tldr: { text: longText },
      });
      expect(result.success).toBe(false);
    });

    it("accepts TL;DR at exactly 40 words", () => {
      const text = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");
      const result = resourcePublishSchema.safeParse({
        ...VALID_PAYLOAD,
        tldr: { text },
      });
      expect(result.success).toBe(true);
    });

    it("accepts TL;DR at exactly 60 words", () => {
      const text = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
      const result = resourcePublishSchema.safeParse({
        ...VALID_PAYLOAD,
        tldr: { text },
      });
      expect(result.success).toBe(true);
    });
  });

  describe("related guides constraints", () => {
    it("rejects fewer than 4 related guides", () => {
      const result = resourcePublishSchema.safeParse({
        ...VALID_PAYLOAD,
        relatedGuides: {
          items: VALID_PAYLOAD.relatedGuides.items.slice(0, 3),
        },
      });
      expect(result.success).toBe(false);
    });

    it("rejects more than 8 related guides", () => {
      const items = Array.from({ length: 9 }, (_, i) => ({
        title: `Guide ${i}`,
        url: `https://example.com/${i}`,
      }));
      const result = resourcePublishSchema.safeParse({
        ...VALID_PAYLOAD,
        relatedGuides: { items },
      });
      expect(result.success).toBe(false);
    });

    it("rejects non-absolute URLs in related guides", () => {
      const result = resourcePublishSchema.safeParse({
        ...VALID_PAYLOAD,
        relatedGuides: {
          items: [
            ...VALID_PAYLOAD.relatedGuides.items.slice(0, 3),
            { title: "Bad", url: "/relative/url" },
          ],
        },
      });
      expect(result.success).toBe(false);
    });
  });

  describe("key takeaways constraints", () => {
    it("rejects fewer than 4 takeaways", () => {
      const result = resourcePublishSchema.safeParse({
        ...VALID_PAYLOAD,
        keyTakeaways: { items: VALID_PAYLOAD.keyTakeaways.items.slice(0, 3) },
      });
      expect(result.success).toBe(false);
    });

    it("rejects takeaway below 10 words", () => {
      const result = resourcePublishSchema.safeParse({
        ...VALID_PAYLOAD,
        keyTakeaways: {
          items: [
            "Too short here only",
            ...VALID_PAYLOAD.keyTakeaways.items.slice(1),
          ],
        },
      });
      expect(result.success).toBe(false);
    });

    it("rejects takeaway above 35 words", () => {
      const long = Array.from({ length: 40 }, (_, i) => `w${i}`).join(" ");
      const result = resourcePublishSchema.safeParse({
        ...VALID_PAYLOAD,
        keyTakeaways: {
          items: [long, ...VALID_PAYLOAD.keyTakeaways.items.slice(1)],
        },
      });
      expect(result.success).toBe(false);
    });
  });

  describe("FAQ constraints", () => {
    it("rejects fewer than 3 FAQ items", () => {
      const result = resourcePublishSchema.safeParse({
        ...VALID_PAYLOAD,
        faq: { items: VALID_PAYLOAD.faq.items.slice(0, 2) },
      });
      expect(result.success).toBe(false);
    });

    it("rejects FAQ answer outside 40-60 words", () => {
      const result = resourcePublishSchema.safeParse({
        ...VALID_PAYLOAD,
        faq: {
          items: [
            ...VALID_PAYLOAD.faq.items.slice(0, 2),
            { question: "Q?", answer: "Too short answer." },
          ],
        },
      });
      expect(result.success).toBe(false);
    });
  });

  describe("banned superlatives", () => {
    it("rejects unattributed 'industry-leading' in TL;DR", () => {
      const text = `Our industry-leading auto-geo publishing pipeline runs validation, persistence, revalidation, and JSON-LD derivation in a fixed order so every published resource page is structurally correct and immediately discoverable; this is a description for testing the banned superlative rejection path completely.`;
      const result = resourcePublishSchema.safeParse({
        ...VALID_PAYLOAD,
        tldr: { text },
      });
      expect(result.success).toBe(false);
    });

    it("allows attributed 'industry-leading' (per Source)", () => {
      const text = `Our industry-leading platform per Gartner runs validation, persistence, revalidation, and JSON-LD derivation in a fixed order so every published resource page is structurally correct and immediately discoverable; this is a description for testing the attribution allowance path completely.`;
      const result = resourcePublishSchema.safeParse({
        ...VALID_PAYLOAD,
        tldr: { text },
      });
      expect(result.success).toBe(true);
    });

    it("allows 'industry-leading' inside a quoted passage", () => {
      const text = `The analyst said "this is industry-leading work" about our publishing pipeline which runs validation, persistence, revalidation, and JSON-LD derivation in a fixed order so every published resource page is structurally correct and immediately discoverable here.`;
      const result = resourcePublishSchema.safeParse({
        ...VALID_PAYLOAD,
        tldr: { text },
      });
      expect(result.success).toBe(true);
    });
  });

  describe("raw HTML rejection", () => {
    it("rejects <script> in paragraph text", () => {
      const result = resourcePublishSchema.safeParse({
        ...VALID_PAYLOAD,
        intro: {
          blocks: [
            {
              type: "paragraph",
              text: "<script>alert(1)</script> some prose here padding to length.",
            },
          ],
        },
      });
      expect(result.success).toBe(false);
    });

    it("rejects raw HTML in TL;DR", () => {
      const text = `<div>This payload includes embedded HTML</div> which the schema must reject because raw HTML in prose fields breaks the contract auto-geo enforces at the publish boundary for downstream renderers to handle reliably and consistently.`;
      const result = resourcePublishSchema.safeParse({
        ...VALID_PAYLOAD,
        tldr: { text },
      });
      expect(result.success).toBe(false);
    });
  });

  describe("table constraints", () => {
    it("rejects table row with wrong cell count", () => {
      const result = resourcePublishSchema.safeParse({
        ...VALID_PAYLOAD,
        intro: {
          blocks: [
            {
              type: "table",
              headers: ["A", "B"],
              rows: [["a1"]],
            },
          ],
        },
      });
      expect(result.success).toBe(false);
    });

    it("accepts a well-formed table", () => {
      const result = resourcePublishSchema.safeParse({
        ...VALID_PAYLOAD,
        intro: {
          blocks: [
            {
              type: "table",
              headers: ["A", "B"],
              rows: [
                ["a1", "b1"],
                ["a2", "b2"],
              ],
            },
          ],
        },
      });
      expect(result.success).toBe(true);
    });
  });

  describe("comparison page sanity", () => {
    it("rejects comparison page without vs/alternatives/comparison in title", () => {
      const result = resourcePublishSchema.safeParse({
        ...VALID_PAYLOAD,
        title: "Some generic title",
        geoMetadata: {
          ...VALID_PAYLOAD.geoMetadata,
          pageType: "comparison",
        },
      });
      expect(result.success).toBe(false);
    });

    it("accepts comparison page with 'vs' in title", () => {
      const result = resourcePublishSchema.safeParse({
        ...VALID_PAYLOAD,
        title: "Tool A vs Tool B for content publishing",
        geoMetadata: {
          ...VALID_PAYLOAD.geoMetadata,
          pageType: "comparison",
        },
      });
      expect(result.success).toBe(true);
    });
  });

  describe("image block constraints", () => {
    it("rejects image with alt under 20 chars", () => {
      const result = resourcePublishSchema.safeParse({
        ...VALID_PAYLOAD,
        intro: {
          blocks: [
            {
              type: "image",
              src: "https://example.com/img.png",
              alt: "short alt",
            },
          ],
        },
      });
      expect(result.success).toBe(false);
    });
  });
});

describe("wordCount", () => {
  it("counts simple words", () => {
    expect(wordCount("one two three")).toBe(3);
  });

  it("strips inline syntax markers before counting", () => {
    expect(wordCount("**bold** and *italic* text")).toBe(4);
  });

  it("counts link label, not URL", () => {
    expect(wordCount("[label text](https://example.com)")).toBe(2);
  });

  it("returns 0 for empty / whitespace-only string", () => {
    expect(wordCount("")).toBe(0);
    expect(wordCount("   \n\t  ")).toBe(0);
  });
});
