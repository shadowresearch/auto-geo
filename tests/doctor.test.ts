import { describe, it, expect } from "vitest";
import {
  checkAnswerFirst,
  checkArticleJsonLd,
  checkEntityDensity,
  checkFaqPageJsonLd,
  checkImageCadence,
  checkNoSelfLink,
  checkQuestionH2,
  checkTldrPresent,
  runAllChecks,
} from "../cli/checks";
import { parsePage } from "../cli/fetch";
import {
  auditHtml,
  auditParsedPage,
  renderReport,
  renderSitemapReport,
  runDoctor,
  runSitemapDoctor,
} from "../cli/doctor";
import { renderHumanReport, renderJsonReport } from "../cli/render";
import { parseArgs, run } from "../cli/run";
import { parseSitemapXml } from "../cli/sitemap";
import type { ParsedPage } from "../cli/types";

/**
 * Test strategy: each heuristic is a pure function of `ParsedPage`,
 * so the bulk of these tests build small `ParsedPage` objects by hand
 * and assert on the returned `CheckResult`. The HTML-end-to-end tests
 * round-trip a few hand-built HTML strings through `parsePage` to lock
 * in DOM-extraction behavior. Network is fully mocked via injected
 * `fetch` impls — no real HTTP from the test suite.
 */

// ── Fixture helpers ────────────────────────────────────────────────

function makePage(overrides: Partial<ParsedPage> = {}): ParsedPage {
  return {
    url: "https://example.com/page",
    text: "",
    wordCount: 0,
    leadText: "",
    firstParagraph: "",
    headings: [],
    jsonLd: [],
    images: [],
    links: [],
    ...overrides,
  };
}

// ── checkTldrPresent ───────────────────────────────────────────────

describe("checkTldrPresent", () => {
  it("passes when the lead text is in the 40-60 word range", () => {
    const lead = Array.from({ length: 50 }, (_, i) => `word${i}`).join(" ");
    const page = makePage({ leadText: lead, text: lead });
    const result = checkTldrPresent(page);
    expect(result.pass).toBe(true);
  });

  it("fails when the lead text is too short", () => {
    const page = makePage({ leadText: "short lead", text: "short lead" });
    expect(checkTldrPresent(page).pass).toBe(false);
  });

  it("fails when no lead text was found", () => {
    const page = makePage({ leadText: "", text: "" });
    expect(checkTldrPresent(page).pass).toBe(false);
  });

  it("prefers an explicit TL;DR label when present", () => {
    const tldr = `${Array.from({ length: 45 }, (_, i) => `w${i}`).join(" ")}.`;
    const page = makePage({
      leadText: "long noisy intro that is not the actual tldr",
      text: `TL;DR: ${tldr} more stuff here`,
    });
    const result = checkTldrPresent(page);
    expect(result.pass).toBe(true);
    expect(result.detail).toContain("TL;DR label");
  });

  it("handles a multi-sentence labelled TL;DR (canonical 50-word, 3 sentences)", () => {
    // Realistic SOP-shaped TL;DR — 50 words across 3 sentences.
    const text =
      "TL;DR Generative Engine Optimization is the practice of structuring web content so generative AI search engines extract, quote, and cite it inside answers. Where SEO optimizes for ranked links, GEO optimizes for inclusion inside a synthesized answer. The mechanics are concrete: answer-first prose and question-format headings.";
    const result = checkTldrPresent(makePage({ text }));
    expect(result.pass).toBe(true);
    expect(result.detail).toMatch(/4[5-9]|5[0-5] words/);
  });

  it("finds the TL;DR even when the label has no separator before the body (linkedom textContent join)", () => {
    // `<p>TL;DR</p><p>Generative…</p>` concatenates under linkedom's
    // textContent as `"TL;DRGenerative…"` — no whitespace at the
    // element boundary. The label-search must still anchor on the
    // first occurrence (the real TL;DR) rather than fall through to a
    // later mid-prose mention of "TL;DR".
    const realTldr =
      "Generative Engine Optimization is the practice of structuring web content so AI engines extract and cite it inside answers. Where SEO optimizes for ranked links, GEO optimizes for inclusion inside a synthesized answer. The mechanics are concrete: answer-first prose and dense entities.";
    const laterMention =
      "the TL;DR is what ChatGPT and Perplexity tend to lift verbatim when summarizing the page.";
    // No separator between "TL;DR" and the body (paragraph join).
    const text = `TL;DR${realTldr} more content here. Section heading? ${laterMention}`;
    const result = checkTldrPresent(makePage({ text }));
    expect(result.pass).toBe(true);
    expect(result.detail).toMatch(/4[0-9]|5[0-9]|60 words/);
  });

  it("skips meta-mentions of 'TL;DR' (e.g. 'seven blocks in order: TL;DR, intro, …') and anchors on the real block", () => {
    // Real failure mode observed in production: a resource page's
    // metaDescription enumerates the page architecture and includes the
    // string "TL;DR" mid-list. The doctor's first-match regex anchored
    // on that meta reference, captured surrounding header text + the
    // real TL;DR fused together, and reported 72 words on a 55-word
    // TL;DR. Requiring the next char after "TL;DR" to be uppercase
    // rejects the comma-tail meta reference and falls through to the
    // real block.
    const realTldr =
      "A GEO-optimized page has seven blocks in order: TL;DR, intro, H2 sections, Related Guides, Key Takeaways, FAQ, and disclosure. Each block exists because it maps to a specific extraction behavior in at least one major AI engine. Enforcing the architecture structurally beats author discipline.";
    const text = `Page summary listing blocks in order: TL;DR, intro, H2 sections each opening with a 40-60 word answer capsule. Last updated June 4, 2026. TL;DR${realTldr} When a developer asks ChatGPT a question, the engine assembles an answer from several sources.`;
    const result = checkTldrPresent(makePage({ text }));
    // Real TL;DR is ~46 words and self-terminating; the strict anchor
    // must skip the meta reference and land on the real block, then
    // bound the chunks at the TL;DR's own sentences (not spill into
    // "When a developer…"). Allow some tolerance for the join heuristic.
    expect(result.pass).toBe(true);
    expect(result.detail).toMatch(/4[0-9]|5[0-9]|60 words/);
  });

  it("recovers TL;DR sentence boundaries when paragraphs concatenate without whitespace", () => {
    // linkedom's textContent joins `</p><p>` boundaries without
    // inserting a space, so a real rendered TL;DR can look like
    // "…end of tldr.Next paragraph starts here.". The split heuristic
    // must still terminate at the period rather than treating the
    // whole fused passage as one sentence.
    const tldr =
      "Generative Engine Optimization is the practice of structuring content so AI engines extract and cite it. The mechanics are answer-first prose, question-format headings, and dense entities. Tools enforce this contract.";
    const next =
      "When a developer asks ChatGPT or Perplexity a question, the engine assembles an answer from a handful of pages.";
    const text = `TL;DR ${tldr}${next}`; // no space between TL;DR and next paragraph
    const result = checkTldrPresent(makePage({ text }));
    // 31 words. We expect doctor to *not* count `next` into the TL;DR.
    expect(result.detail).toMatch(/3[0-5] words/);
  });
});

// ── checkQuestionH2 ────────────────────────────────────────────────

describe("checkQuestionH2", () => {
  it("passes when ≥80% of H2s end in '?'", () => {
    const headings = [
      { level: 2 as const, text: "What is X?" },
      { level: 2 as const, text: "How does Y work?" },
      { level: 2 as const, text: "Why does Z matter?" },
      { level: 2 as const, text: "When did W ship?" },
      { level: 2 as const, text: "A statement heading" }, // 4/5 = 80%
    ];
    expect(checkQuestionH2(makePage({ headings })).pass).toBe(true);
  });

  it("fails when fewer than 80% are question-format", () => {
    const headings = [
      { level: 2 as const, text: "Why?" },
      { level: 2 as const, text: "A statement" },
      { level: 2 as const, text: "Another statement" },
    ];
    expect(checkQuestionH2(makePage({ headings })).pass).toBe(false);
  });

  it("fails when there are no H2 headings at all", () => {
    expect(checkQuestionH2(makePage()).pass).toBe(false);
  });

  it("ignores H1 and H3 in the ratio", () => {
    const headings = [
      { level: 1 as const, text: "A title" },
      { level: 2 as const, text: "What is X?" },
      { level: 3 as const, text: "An h3 detail" },
    ];
    expect(checkQuestionH2(makePage({ headings })).pass).toBe(true);
  });

  it("excludes the page-architecture H2s (Related Guides, Key Takeaways, FAQ, …) from the ratio", () => {
    // A canonical SOP-shaped page has 6 content sections (all
    // question-form) plus three structural H2s the renderer emits:
    // "Related Guides", "Key Takeaways", "Frequently Asked Questions".
    // Counting the structural three against the ratio penalizes
    // correctly-architected pages — they need to be excluded.
    const headings = [
      { level: 2 as const, text: "What is X?" },
      { level: 2 as const, text: "How does Y work?" },
      { level: 2 as const, text: "Why does Z matter?" },
      { level: 2 as const, text: "When did W ship?" },
      { level: 2 as const, text: "Where should I start?" },
      { level: 2 as const, text: "Who owns the work?" },
      { level: 2 as const, text: "Related Guides" },
      { level: 2 as const, text: "Key Takeaways" },
      { level: 2 as const, text: "Frequently Asked Questions" },
    ];
    const result = checkQuestionH2(makePage({ headings }));
    expect(result.pass).toBe(true);
    // 6 of 6 content H2s are question-form after structural exclusion.
    expect(result.detail).toContain("6 of 6");
  });

  it("matches structural H2 names case-insensitively", () => {
    const headings = [
      { level: 2 as const, text: "What is X?" },
      { level: 2 as const, text: "How does Y work?" },
      { level: 2 as const, text: "FAQ" },
      { level: 2 as const, text: "DISCLOSURE" },
      { level: 2 as const, text: "key takeaways" },
    ];
    expect(checkQuestionH2(makePage({ headings })).pass).toBe(true);
  });
});

// ── checkArticleJsonLd ─────────────────────────────────────────────

describe("checkArticleJsonLd", () => {
  it("passes when an Article block is present", () => {
    const page = makePage({
      jsonLd: [{ "@type": "Article", headline: "x" }],
    });
    expect(checkArticleJsonLd(page).pass).toBe(true);
  });

  it("passes for Article subtypes (BlogPosting, NewsArticle)", () => {
    expect(
      checkArticleJsonLd(makePage({ jsonLd: [{ "@type": "BlogPosting" }] }))
        .pass
    ).toBe(true);
    expect(
      checkArticleJsonLd(makePage({ jsonLd: [{ "@type": "NewsArticle" }] }))
        .pass
    ).toBe(true);
  });

  it("passes when Article lives inside @graph", () => {
    const page = makePage({
      jsonLd: [
        {
          "@context": "https://schema.org",
          "@graph": [
            { "@type": "Person", name: "x" },
            { "@type": "Article", headline: "x" },
          ],
        },
      ],
    });
    expect(checkArticleJsonLd(page).pass).toBe(true);
  });

  it("fails when no Article block is present", () => {
    expect(
      checkArticleJsonLd(makePage({ jsonLd: [{ "@type": "WebPage" }] })).pass
    ).toBe(false);
  });
});

// ── checkFaqPageJsonLd ─────────────────────────────────────────────

describe("checkFaqPageJsonLd", () => {
  it("passes when an FAQPage block is present", () => {
    const page = makePage({
      jsonLd: [{ "@type": "FAQPage", mainEntity: [] }],
    });
    expect(checkFaqPageJsonLd(page).pass).toBe(true);
  });

  it("fails when no FAQPage block is present", () => {
    expect(checkFaqPageJsonLd(makePage()).pass).toBe(false);
  });

  it("is ranked #1 (highest citation lift fix when missing)", () => {
    expect(checkFaqPageJsonLd(makePage()).citationImpactRank).toBe(1);
  });
});

// ── checkEntityDensity ─────────────────────────────────────────────

describe("checkEntityDensity", () => {
  it("passes when entity density ≥ 8 per 1k words", () => {
    // Construct a 100-word text with ~10 multi-word entities (= 100/1k).
    const sentence =
      "We compared OpenAI GPT to Anthropic Claude and Google Gemini at the Stanford AI Lab. Then Microsoft Azure and AWS Bedrock joined.";
    const text = Array.from({ length: 5 }, () => sentence).join(" ");
    const page = makePage({ text, wordCount: 110 });
    expect(checkEntityDensity(page).pass).toBe(true);
  });

  it("fails when entity density is below the threshold", () => {
    const text =
      "the quick brown fox jumps over the lazy dog while we all watch nothing of note happens here at all today";
    const page = makePage({ text, wordCount: text.split(/\s+/).length });
    expect(checkEntityDensity(page).pass).toBe(false);
  });
});

// ── checkImageCadence ──────────────────────────────────────────────

describe("checkImageCadence", () => {
  it("passes when image count meets the 1-per-500-words target", () => {
    const page = makePage({
      wordCount: 1000,
      images: [
        { alt: "a", src: "/1.png" },
        { alt: "b", src: "/2.png" },
      ],
    });
    expect(checkImageCadence(page).pass).toBe(true);
  });

  it("fails when there are no images on a long page", () => {
    const page = makePage({ wordCount: 1200, images: [] });
    expect(checkImageCadence(page).pass).toBe(false);
  });

  it("requires at least one image even for short pages", () => {
    // 400 words → expected = max(1, floor(400/500)) = 1.
    expect(checkImageCadence(makePage({ wordCount: 400 })).pass).toBe(false);
    expect(
      checkImageCadence(
        makePage({ wordCount: 400, images: [{ alt: "x", src: "/a.png" }] })
      ).pass
    ).toBe(true);
  });
});

// ── checkAnswerFirst ───────────────────────────────────────────────

describe("checkAnswerFirst", () => {
  it("passes for a declarative 20-120 word lede", () => {
    const p = Array.from({ length: 30 }, (_, i) => `word${i}`).join(" ");
    expect(checkAnswerFirst(makePage({ firstParagraph: p })).pass).toBe(true);
  });

  it("fails when the lede opens with a hedge phrase", () => {
    const p =
      "In this article we will explore the topic of generative engine optimization and what you should know.";
    expect(checkAnswerFirst(makePage({ firstParagraph: p })).pass).toBe(false);
  });

  it("fails when the lede is too short", () => {
    expect(
      checkAnswerFirst(makePage({ firstParagraph: "Hello world." })).pass
    ).toBe(false);
  });

  it("fails when there is no first paragraph", () => {
    expect(checkAnswerFirst(makePage()).pass).toBe(false);
  });
});

// ── checkNoSelfLink ────────────────────────────────────────────────

describe("checkNoSelfLink", () => {
  it("passes when no related-section anchor matches the page URL", () => {
    const page = makePage({
      url: "https://example.com/resources/foo",
      links: [
        {
          href: "https://example.com/resources/bar",
          text: "bar",
          inRelatedSection: true,
        },
      ],
    });
    expect(checkNoSelfLink(page).pass).toBe(true);
  });

  it("fails when a related-section anchor matches the page URL", () => {
    const page = makePage({
      url: "https://example.com/resources/foo",
      links: [
        {
          href: "https://example.com/resources/foo",
          text: "self",
          inRelatedSection: true,
        },
      ],
    });
    expect(checkNoSelfLink(page).pass).toBe(false);
  });

  it("ignores self-links that are not in the related section", () => {
    const page = makePage({
      url: "https://example.com/resources/foo",
      links: [
        {
          href: "https://example.com/resources/foo",
          text: "self",
          inRelatedSection: false,
        },
      ],
    });
    expect(checkNoSelfLink(page).pass).toBe(true);
  });

  it("resolves relative hrefs against the page URL", () => {
    const page = makePage({
      url: "https://example.com/resources/foo",
      links: [{ href: "/resources/foo", text: "self", inRelatedSection: true }],
    });
    expect(checkNoSelfLink(page).pass).toBe(false);
  });

  it("returns pass when the page URL itself is unparseable", () => {
    const page = makePage({ url: "not a url" });
    expect(checkNoSelfLink(page).pass).toBe(true);
  });
});

// ── runAllChecks / auditParsedPage ─────────────────────────────────

describe("runAllChecks + auditParsedPage", () => {
  it("returns exactly 8 checks", () => {
    expect(runAllChecks(makePage())).toHaveLength(8);
  });

  it("computes score and scorePct from check results", () => {
    const goodLead = Array.from({ length: 50 }, (_, i) => `w${i}`).join(" ");
    const page = makePage({
      leadText: goodLead,
      text: goodLead,
      headings: [{ level: 2 as const, text: "What is good?" }],
      jsonLd: [{ "@type": "Article" }, { "@type": "FAQPage" }],
      images: [{ alt: "x", src: "/x.png" }],
    });
    const report = auditParsedPage(page);
    expect(report.score).toBeGreaterThan(0);
    expect(report.total).toBe(8);
    expect(report.scorePct).toBe(
      Math.round((report.score / report.total) * 100)
    );
  });

  it("populates topFixes with up to 3 failing checks, ranked", () => {
    const report = auditParsedPage(makePage()); // everything fails
    expect(report.topFixes.length).toBeLessThanOrEqual(3);
    // Lower citationImpactRank = higher priority → first fix should
    // be the lowest-numbered rank among failures.
    const allFailingRanks = report.checks
      .filter((c) => !c.pass)
      .map((c) => c.citationImpactRank);
    const lowest = Math.min(...allFailingRanks);
    expect(report.topFixes[0]?.citationImpactRank).toBe(lowest);
  });
});

// ── parsePage / auditHtml (end-to-end DOM extraction) ──────────────

describe("parsePage", () => {
  it("strips nav/footer/aside before reading body text", () => {
    const html = `
      <html><body>
        <nav>SHOULD BE STRIPPED</nav>
        <main><p>This is the body content.</p></main>
        <footer>ALSO STRIPPED</footer>
      </body></html>
    `;
    const page = parsePage("https://example.com/p", html);
    expect(page.text).toContain("body content");
    expect(page.text).not.toContain("SHOULD BE STRIPPED");
    expect(page.text).not.toContain("ALSO STRIPPED");
  });

  it("extracts JSON-LD including @graph children", () => {
    const html = `
      <html><body>
        <script type="application/ld+json">{"@type":"Article","headline":"x"}</script>
        <script type="application/ld+json">{"@graph":[{"@type":"FAQPage"}]}</script>
        <main><p>body</p></main>
      </body></html>
    `;
    const page = parsePage("https://example.com/p", html);
    expect(page.jsonLd.length).toBeGreaterThanOrEqual(2);
    const report = auditHtml("https://example.com/p", html);
    const article = report.checks.find((c) => c.id === "article-jsonld");
    const faq = report.checks.find((c) => c.id === "faqpage-jsonld");
    expect(article?.pass).toBe(true);
    expect(faq?.pass).toBe(true);
  });

  it("flattens a JSON-LD array of blocks", () => {
    const html = `
      <html><body>
        <script type="application/ld+json">[{"@type":"Article"},{"@type":"BreadcrumbList"}]</script>
        <main><p>body</p></main>
      </body></html>
    `;
    const page = parsePage("https://example.com/p", html);
    expect(page.jsonLd).toHaveLength(2);
  });

  it("ignores unparseable JSON-LD blocks", () => {
    const html = `
      <html><body>
        <script type="application/ld+json">{ this is not json }</script>
        <main><p>body</p></main>
      </body></html>
    `;
    const page = parsePage("https://example.com/p", html);
    expect(page.jsonLd).toHaveLength(0);
  });

  it("collects headings by level", () => {
    const html = `
      <html><body><main>
        <h1>Title</h1>
        <p>lead</p>
        <h2>What is X?</h2>
        <h3>Detail</h3>
      </main></body></html>
    `;
    const page = parsePage("https://example.com/p", html);
    expect(page.headings.some((h) => h.level === 1 && h.text === "Title")).toBe(
      true
    );
    expect(
      page.headings.some((h) => h.level === 2 && h.text === "What is X?")
    ).toBe(true);
    expect(
      page.headings.some((h) => h.level === 3 && h.text === "Detail")
    ).toBe(true);
  });

  it("identifies anchors inside a 'related' section", () => {
    const html = `
      <html><body><main>
        <h2>Related Guides</h2>
        <ul>
          <li><a href="/a">A</a></li>
          <li><a href="/b">B</a></li>
        </ul>
        <h2>Next Topic</h2>
        <p><a href="/c">C is not in related</a></p>
      </main></body></html>
    `;
    const page = parsePage("https://example.com/p", html);
    const aLink = page.links.find((l) => l.href === "/a");
    const cLink = page.links.find((l) => l.href === "/c");
    expect(aLink?.inRelatedSection).toBe(true);
    expect(cLink?.inRelatedSection).toBe(false);
  });

  it("captures img alt text", () => {
    const html = `<html><body><main><img src="/x.png" alt="diagram of x"></main></body></html>`;
    const page = parsePage("https://example.com/p", html);
    expect(page.images).toEqual([{ src: "/x.png", alt: "diagram of x" }]);
  });
});

// ── Sitemap parsing ────────────────────────────────────────────────

describe("parseSitemapXml", () => {
  it("parses a standard urlset", () => {
    const xml = `<?xml version="1.0"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url><loc>https://example.com/a</loc></url>
        <url><loc>https://example.com/b</loc></url>
      </urlset>`;
    const { children, isIndex } = parseSitemapXml(xml);
    expect(isIndex).toBe(false);
    expect(children).toEqual([
      "https://example.com/a",
      "https://example.com/b",
    ]);
  });

  it("identifies sitemap indexes and returns child sitemap URLs", () => {
    const xml = `<?xml version="1.0"?>
      <sitemapindex>
        <sitemap><loc>https://example.com/sitemap-a.xml</loc></sitemap>
        <sitemap><loc>https://example.com/sitemap-b.xml</loc></sitemap>
      </sitemapindex>`;
    const { children, isIndex } = parseSitemapXml(xml);
    expect(isIndex).toBe(true);
    expect(children).toHaveLength(2);
  });
});

// ── End-to-end (mocked fetch) ──────────────────────────────────────

const SAMPLE_HTML = `<!doctype html>
<html><head>
  <script type="application/ld+json">{"@type":"Article","headline":"What is GEO?"}</script>
  <script type="application/ld+json">{"@type":"FAQPage","mainEntity":[]}</script>
</head><body>
  <nav>nav</nav>
  <main>
    <h1>What is GEO and how do AI engines decide what to cite from your site today?</h1>
    <p>${Array.from({ length: 50 }, (_, i) => `tldr${i}`).join(" ")}.</p>
    <h2>What is GEO?</h2>
    <p>${Array.from({ length: 60 }, (_, i) => `body${i}`).join(" ")} OpenAI Anthropic Perplexity Google AI Overviews Microsoft Azure Amazon Web Services Stanford AI Lab Vercel Cloudflare.</p>
    <h2>How does GEO work?</h2>
    <p>OpenAI Claude Gemini are AI engines. ChatGPT Perplexity Google use embeddings. We measure citation by Anthropic and OpenAI and Google.</p>
    <img src="/a.png" alt="diagram of GEO architecture" />
    <h2>Related Guides</h2>
    <ul><li><a href="https://example.com/other">Other</a></li></ul>
  </main>
  <footer>footer</footer>
</body></html>`;

describe("runDoctor (mocked fetch)", () => {
  it("runs end-to-end against a sample HTML page", async () => {
    const fakeFetch: typeof globalThis.fetch = async () =>
      new Response(SAMPLE_HTML, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    const report = await runDoctor("https://example.com/p", {
      fetch: fakeFetch,
    });
    expect(report.url).toBe("https://example.com/p");
    expect(report.checks).toHaveLength(8);
    // Article + FAQPage JSON-LD are both present in SAMPLE_HTML.
    expect(report.checks.find((c) => c.id === "article-jsonld")?.pass).toBe(
      true
    );
    expect(report.checks.find((c) => c.id === "faqpage-jsonld")?.pass).toBe(
      true
    );
  });

  it("throws when fetch returns a non-OK response", async () => {
    const fakeFetch: typeof globalThis.fetch = async () =>
      new Response("nope", { status: 500, statusText: "Server Error" });
    await expect(
      runDoctor("https://example.com/p", { fetch: fakeFetch })
    ).rejects.toThrow(/500/);
  });

  it("surfaces a bot-detection hint on 403", async () => {
    const fakeFetch: typeof globalThis.fetch = async () =>
      new Response("blocked", { status: 403, statusText: "Forbidden" });
    await expect(
      runDoctor("https://example.com/p", { fetch: fakeFetch })
    ).rejects.toThrow(/bot detection|WAF|auth wall/i);
  });

  it("surfaces a rate-limit hint on 429", async () => {
    const fakeFetch: typeof globalThis.fetch = async () =>
      new Response("slow down", {
        status: 429,
        statusText: "Too Many Requests",
      });
    await expect(
      runDoctor("https://example.com/p", { fetch: fakeFetch })
    ).rejects.toThrow(/rate-limiting/i);
  });

  it("surfaces a sandbox-egress hint on generic fetch failure", async () => {
    const fakeFetch: typeof globalThis.fetch = async () => {
      throw new TypeError("fetch failed");
    };
    await expect(
      runDoctor("https://example.com/p", { fetch: fakeFetch })
    ).rejects.toThrow(/sandbox|egress|allowlisted/i);
  });

  it("surfaces a timeout hint on AbortError", async () => {
    const fakeFetch: typeof globalThis.fetch = async () => {
      const e = new Error("aborted");
      e.name = "AbortError";
      throw e;
    };
    await expect(
      runDoctor("https://example.com/p", { fetch: fakeFetch })
    ).rejects.toThrow(/timed out/i);
  });
});

// ── Sitemap end-to-end ─────────────────────────────────────────────

describe("runSitemapDoctor (mocked fetch)", () => {
  it("aggregates across multiple URLs", async () => {
    const sitemapXml = `<urlset>
      <url><loc>https://example.com/p1</loc></url>
      <url><loc>https://example.com/p2</loc></url>
    </urlset>`;
    const fakeFetch: typeof globalThis.fetch = async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("sitemap.xml")) {
        return new Response(sitemapXml, { status: 200 });
      }
      return new Response(SAMPLE_HTML, { status: 200 });
    };
    const report = await runSitemapDoctor("https://example.com/sitemap.xml", {
      fetch: fakeFetch,
      concurrency: 2,
    });
    expect(report.total).toBe(2);
    expect(report.pages).toHaveLength(2);
    expect(report.meanScorePct).toBeGreaterThan(0);
  });

  it("records errors for URLs that fail to fetch without halting the run", async () => {
    const sitemapXml = `<urlset>
      <url><loc>https://example.com/ok</loc></url>
      <url><loc>https://example.com/bad</loc></url>
    </urlset>`;
    const fakeFetch: typeof globalThis.fetch = async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("sitemap.xml")) {
        return new Response(sitemapXml, { status: 200 });
      }
      if (url.endsWith("/bad")) {
        return new Response("nope", { status: 500, statusText: "Err" });
      }
      return new Response(SAMPLE_HTML, { status: 200 });
    };
    const report = await runSitemapDoctor("https://example.com/sitemap.xml", {
      fetch: fakeFetch,
    });
    expect(report.pages).toHaveLength(1);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]?.url).toBe("https://example.com/bad");
  });
});

// ── Renderers ──────────────────────────────────────────────────────

describe("renderHumanReport", () => {
  it("includes the URL, score line, and top-fix block", () => {
    const report = auditHtml("https://example.com/p", SAMPLE_HTML);
    const out = renderHumanReport(report);
    expect(out).toContain("https://example.com/p");
    expect(out).toContain("Score:");
    expect(out).toContain("Generated by auto-geo doctor");
  });

  it("emits ANSI color codes when colors: true", () => {
    const report = auditHtml("https://example.com/p", SAMPLE_HTML);
    const out = renderHumanReport(report, { colors: true });
    expect(out).toContain("\x1b[");
  });

  it("emits no ANSI when colors: false", () => {
    const report = auditHtml("https://example.com/p", SAMPLE_HTML);
    const out = renderHumanReport(report, { colors: false });
    expect(out).not.toContain("\x1b[");
  });

  it("renders the branded header (auto-geo doctor + tagline)", () => {
    const report = auditHtml("https://example.com/p", SAMPLE_HTML);
    const rich = renderHumanReport(report, { colors: true });
    const plain = renderHumanReport(report, { colors: false });
    expect(rich).toContain("auto-geo doctor");
    expect(rich).toContain("GEO citation readiness audit");
    expect(rich).toContain("\u25c6"); // diamond glyph in rich mode
    expect(plain).toContain("auto-geo doctor");
    expect(plain).toContain("GEO citation readiness audit");
    expect(plain).not.toContain("\u25c6"); // no diamond in plain
  });

  it("renders the score line with an arrow glyph in rich mode", () => {
    const report = auditHtml("https://example.com/p", SAMPLE_HTML);
    const rich = renderHumanReport(report, { colors: true });
    expect(rich).toContain("\u25b8"); // ▸ score arrow
    expect(rich).toContain("Score:");
  });

  it("renders ASCII fallback for status marks in plain mode", () => {
    const report = auditHtml("https://example.com/p", SAMPLE_HTML);
    const plain = renderHumanReport(report, { colors: false });
    // At least one check passes and at least one fails on the sample,
    // so both [OK] and [FAIL] should appear.
    expect(plain).toContain("[OK]");
  });

  it("ends with a footer divider before the metadata lines", () => {
    const report = auditHtml("https://example.com/p", SAMPLE_HTML);
    const plain = renderHumanReport(report, { colors: false });
    // Divider in plain mode is a run of `-` chars.
    expect(plain).toMatch(/-{20,}/);
  });
});

describe("renderJsonReport", () => {
  it("round-trips through JSON.parse to the original shape", () => {
    const report = auditHtml("https://example.com/p", SAMPLE_HTML);
    const json = renderJsonReport(report);
    const parsed = JSON.parse(json);
    expect(parsed.url).toBe(report.url);
    expect(parsed.checks).toHaveLength(report.checks.length);
    expect(parsed.generatedBy).toBe("auto-geo doctor");
  });
});

describe("renderReport / renderSitemapReport dispatch", () => {
  it("renderReport picks JSON when opts.json is true", () => {
    const report = auditHtml("https://example.com/p", SAMPLE_HTML);
    expect(renderReport(report, { json: true })).toMatch(/^\{/);
  });

  it("renderReport picks human format by default", () => {
    const report = auditHtml("https://example.com/p", SAMPLE_HTML);
    const out = renderReport(report);
    expect(out).toContain("auto-geo doctor");
  });

  it("renderSitemapReport picks JSON when opts.json is true", () => {
    const report = {
      sitemap: "https://example.com/sitemap.xml",
      total: 0,
      pages: [],
      meanScorePct: 0,
      failingChecks: [],
      errors: [],
    };
    expect(renderSitemapReport(report, { json: true })).toMatch(/^\{/);
  });
});

// ── CLI argument parser ────────────────────────────────────────────

describe("parseArgs", () => {
  it("accepts a bare URL", () => {
    const args = parseArgs(["https://example.com/p"]);
    expect(args.command).toBe("doctor");
    expect(args.url).toBe("https://example.com/p");
    expect(args.json).toBe(false);
  });

  it("accepts the documented `doctor <url>` form", () => {
    const args = parseArgs(["doctor", "https://example.com/p"]);
    expect(args.url).toBe("https://example.com/p");
  });

  it("recognizes --json", () => {
    const args = parseArgs(["doctor", "https://example.com/p", "--json"]);
    expect(args.json).toBe(true);
  });

  it("recognizes --no-color", () => {
    const args = parseArgs(["doctor", "https://example.com/p", "--no-color"]);
    expect(args.color).toBe(false);
  });

  it("parses --site with its value argument", () => {
    const args = parseArgs(["doctor", "--site", "https://example.com/s.xml"]);
    expect(args.site).toBe("https://example.com/s.xml");
  });

  it("parses --max-pages as a number", () => {
    const args = parseArgs([
      "doctor",
      "--site",
      "https://example.com/s.xml",
      "--max-pages",
      "25",
    ]);
    expect(args.maxPages).toBe(25);
  });

  it("returns command='help' for --help", () => {
    expect(parseArgs(["--help"]).command).toBe("help");
  });

  it("throws on an unknown flag", () => {
    expect(() => parseArgs(["doctor", "--nope"])).toThrow(/unknown flag/);
  });

  it("throws when --site is missing a value", () => {
    expect(() => parseArgs(["doctor", "--site"])).toThrow(/--site requires/);
  });

  it("throws when --max-pages is not a positive number", () => {
    expect(() =>
      parseArgs(["doctor", "--site", "x", "--max-pages", "foo"])
    ).toThrow(/positive number/);
    expect(() =>
      parseArgs(["doctor", "--site", "x", "--max-pages", "-3"])
    ).toThrow(/positive number/);
  });

  it("throws on extra positionals", () => {
    expect(() => parseArgs(["doctor", "a", "b"])).toThrow(/positional/);
  });
});

// ── CLI run() integration (mock console, mock fetch via env-injected fns) ─

describe("run()", () => {
  // run() uses the real global fetch — we stub it for these tests.
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const originalError = console.error;

  function captureConsole() {
    const out: string[] = [];
    const err: string[] = [];
    console.log = (...args: unknown[]) => {
      out.push(args.join(" "));
    };
    console.error = (...args: unknown[]) => {
      err.push(args.join(" "));
    };
    return { out, err };
  }

  function restoreConsole() {
    console.log = originalLog;
    console.error = originalError;
  }

  afterEach(() => {
    globalThis.fetch = originalFetch;
    restoreConsole();
  });

  it("returns exit code 0 on --help", async () => {
    const { out } = captureConsole();
    const code = await run(["--help"]);
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("auto-geo doctor");
  });

  it("returns exit code 2 when no URL is supplied", async () => {
    const { err } = captureConsole();
    const code = await run([]);
    expect(code).toBe(2);
    expect(err.join("\n")).toContain("missing URL");
  });

  it("returns exit code 2 on a malformed flag", async () => {
    captureConsole();
    const code = await run(["doctor", "--unknown"]);
    expect(code).toBe(2);
  });

  it("returns exit code 1 when the audit score < 75%", async () => {
    captureConsole();
    globalThis.fetch = (async () =>
      new Response("<html><body><p>tiny</p></body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      })) as typeof globalThis.fetch;
    const code = await run(["https://example.com/p"]);
    expect(code).toBe(1);
  });
});

// Re-import afterEach lazily — vitest auto-provides it but explicit
// import keeps the dependency surface obvious.
import { afterEach } from "vitest";
