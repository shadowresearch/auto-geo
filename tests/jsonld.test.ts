import { describe, it, expect } from "vitest";
import {
  deriveArticle,
  deriveBreadcrumb,
  deriveFaqPage,
  deriveImageObjects,
  deriveAllJsonLd,
  safeJsonLd,
} from "../core/jsonld";
import type { SiteConfig } from "../core/publish";
import { VALID_PAYLOAD } from "./fixtures/payload";

const SITE: SiteConfig = {
  origin: "https://example.com",
  basePath: "/resources",
  publisher: {
    name: "Shadow",
    url: "https://www.shadow.inc",
    logo: "https://www.shadow.inc/logo.svg",
  },
};

describe("deriveArticle", () => {
  it("uses Schema.org Article type", () => {
    const article = deriveArticle(VALID_PAYLOAD, SITE);
    expect(article["@type"]).toBe("Article");
    expect(article["@context"]).toBe("https://schema.org");
  });

  it("sets headline, description, and URL from payload + site", () => {
    const article = deriveArticle(VALID_PAYLOAD, SITE);
    expect(article.headline).toBe(VALID_PAYLOAD.title);
    expect(article.description).toBe(VALID_PAYLOAD.metaDescription);
    expect(article.url).toBe(
      `https://example.com/resources/${VALID_PAYLOAD.slug}`
    );
  });

  it("emits Person author with sameAs when linkedinUrl is present", () => {
    const article = deriveArticle(VALID_PAYLOAD, SITE);
    const author = article.author as Record<string, unknown>;
    expect(author["@type"]).toBe("Person");
    expect(author.name).toBe(VALID_PAYLOAD.author.name);
    expect(author.sameAs).toEqual([VALID_PAYLOAD.author.linkedinUrl]);
  });

  it("emits publisher Organization from site config", () => {
    const article = deriveArticle(VALID_PAYLOAD, SITE);
    const publisher = article.publisher as Record<string, unknown>;
    expect(publisher["@type"]).toBe("Organization");
    expect(publisher.name).toBe("Shadow");
    expect(publisher.url).toBe("https://www.shadow.inc");
  });

  it("includes citations when present", () => {
    const article = deriveArticle(VALID_PAYLOAD, SITE);
    expect(Array.isArray(article.citation)).toBe(true);
    expect((article.citation as unknown[])[0]).toMatchObject({
      "@type": "CreativeWork",
      url: "https://schema.org/Article",
    });
  });

  it("omits citations when not present", () => {
    const { citations: _citations, ...rest } = VALID_PAYLOAD;
    const article = deriveArticle(rest, SITE);
    expect("citation" in article).toBe(false);
  });
});

describe("deriveBreadcrumb", () => {
  it("emits three list items: Home, Resources, Page", () => {
    const bc = deriveBreadcrumb(VALID_PAYLOAD, SITE);
    expect(bc["@type"]).toBe("BreadcrumbList");
    expect(bc.itemListElement).toHaveLength(3);
    expect(bc.itemListElement[2]).toMatchObject({
      name: VALID_PAYLOAD.title,
      position: 3,
    });
  });

  it("uses custom basePath when provided", () => {
    const bc = deriveBreadcrumb(VALID_PAYLOAD, { ...SITE, basePath: "/guides" });
    expect(bc.itemListElement[1].item).toBe("https://example.com/guides");
  });
});

describe("deriveFaqPage", () => {
  it("maps every FAQ item to a Question", () => {
    const faq = deriveFaqPage(VALID_PAYLOAD);
    expect(faq["@type"]).toBe("FAQPage");
    expect(faq.mainEntity).toHaveLength(VALID_PAYLOAD.faq.items.length);
    expect(faq.mainEntity[0]).toMatchObject({
      "@type": "Question",
      name: VALID_PAYLOAD.faq.items[0].question,
      acceptedAnswer: {
        "@type": "Answer",
        text: VALID_PAYLOAD.faq.items[0].answer,
      },
    });
  });
});

describe("deriveImageObjects", () => {
  it("returns null when no image blocks present", () => {
    const result = deriveImageObjects(VALID_PAYLOAD);
    expect(result).toBeNull();
  });

  it("emits one ImageObject per image block", () => {
    const withImage = {
      ...VALID_PAYLOAD,
      intro: {
        blocks: [
          {
            type: "image" as const,
            src: "https://example.com/img.png",
            alt: "Diagram showing the auto-geo publish pipeline architecture.",
            caption: "Architecture",
          },
        ],
      },
    };
    const result = deriveImageObjects(withImage);
    expect(result).not.toBeNull();
    expect(result!).toHaveLength(1);
    expect(result![0]).toMatchObject({
      "@type": "ImageObject",
      contentUrl: "https://example.com/img.png",
    });
  });
});

describe("deriveAllJsonLd", () => {
  it("returns article, breadcrumb, faq, and images keys", () => {
    const bundle = deriveAllJsonLd(VALID_PAYLOAD, SITE);
    expect(bundle.article).toBeDefined();
    expect(bundle.breadcrumb).toBeDefined();
    expect(bundle.faq).toBeDefined();
    expect("images" in bundle).toBe(true);
  });
});

describe("safeJsonLd", () => {
  it("escapes < and > to prevent script breakout", () => {
    const out = safeJsonLd({ x: "</script>" });
    expect(out).not.toContain("</script>");
    expect(out).toContain("\\u003c");
    expect(out).toContain("\\u003e");
  });

  it("escapes ampersands", () => {
    const out = safeJsonLd({ x: "A & B" });
    expect(out).toContain("\\u0026");
    expect(out).not.toContain(" & ");
  });

  it("escapes line/paragraph separators", () => {
    const out = safeJsonLd({ x: "before\u2028after\u2029end" });
    expect(out).toContain("\\u2028");
    expect(out).toContain("\\u2029");
  });

  it("produces valid JSON after escaping", () => {
    const out = safeJsonLd({ a: 1, b: "hello & </tag>" });
    // We can't JSON.parse the escaped output directly because the
    // backslash sequences are valid JSON string escapes — they will
    // round-trip cleanly.
    const parsed = JSON.parse(out);
    expect(parsed.a).toBe(1);
    expect(parsed.b).toBe("hello & </tag>");
  });
});
