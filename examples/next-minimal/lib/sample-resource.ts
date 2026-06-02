import type { ResourcePublishPayload } from "auto-geo";

/**
 * Seed payload — populates the `/resources` index on first run so the
 * example app is interactive without needing a publish call first.
 *
 * This payload satisfies all hard schema constraints. It will not pass
 * every soft warning (it's deliberately short for demo purposes), which
 * mirrors the real iteration loop: ship, see warnings, iterate.
 */
export const sampleResource: ResourcePublishPayload = {
  slug: "what-is-a-geo-resource-page",
  title: "What is a GEO resource page? The 2026 guide to AI search citation",
  metaDescription:
    "A GEO resource page is a public web page engineered to be cited by AI search engines. This guide covers the architecture, density, and validation.",
  category: "AI & Search",
  excerpt:
    "GEO resource pages are the successor to SEO landing pages. They are structured so that ChatGPT, Perplexity, and Google AI Overviews can extract and quote them verbatim.",
  author: {
    name: "Jane Doe",
    jobTitle: "Head of Content",
    bio: "Jane writes about generative engine optimization and the architecture of pages that AI search engines cite. Previously: search at a large platform.",
    linkedinUrl: "https://www.linkedin.com/in/janedoe",
  },
  publishedAt: "2026-06-01",
  modifiedAt: "2026-06-01",
  keywords: ["GEO", "generative engine optimization", "AI search"],
  geoMetadata: {
    targetQueries: [
      "what is a GEO resource page",
      "generative engine optimization architecture",
      "how to write pages AI engines cite",
    ],
    pageType: "definitive",
    primaryFunction:
      "Define the GEO resource page format and explain why each constraint exists, so readers can adopt the architecture in their own publishing.",
    optimizationFramework: ["GEO", "AEO", "LLMO"],
    targetPlatforms: ["chatgpt", "perplexity", "google_aio", "claude"],
    informationGainStatement:
      "First-party definition of the seven-block page architecture and the empirical thresholds (entity density, statistics-per-thousand, image cadence) calibrated to current AI engine retrieval behavior.",
    refreshCadence: "quarterly",
  },
  about: [
    { name: "Generative Engine Optimization" },
    { name: "Schema.org Article" },
    { name: "ChatGPT" },
    { name: "Perplexity" },
    { name: "Google AI Overviews" },
  ],
  tldr: {
    text: "A GEO resource page is a public web page composed of seven validated blocks (TL;DR, intro, question-format H2 sections with answer capsules, related guides, key takeaways, FAQ, and disclosure) engineered so AI search engines like ChatGPT and Perplexity can extract and quote answer chunks verbatim in their responses.",
  },
  intro: {
    blocks: [
      {
        type: "paragraph",
        text: "GEO resource pages are the successor to SEO landing pages. Where SEO optimized for keyword matching against an inverted index, GEO optimizes for retrieval and quotation by large language models that answer questions on the user's behalf. The win condition is being quoted in the AI's answer.",
      },
    ],
  },
  sections: [
    {
      heading: "Why does AI search require a different page format?",
      answerCapsule:
        "AI engines do not read pages, they extract chunks. The chunk most likely to be quoted is one that fully answers a question on its own, without requiring context from the rest of the page. Traditional blog structure embeds answers inside flowing narrative, which AI retrieval pipelines cannot cleanly extract or quote.",
      blocks: [
        {
          type: "paragraph",
          text: "Modern retrieval pipelines (RAG, hybrid search) chunk documents before embedding. A 60-100 word self-contained paragraph is one chunk; a 300-word flowing argument is one degraded chunk. Architecture that respects chunk boundaries is architecture that gets quoted. See research from [Anthropic on RAG patterns](https://www.anthropic.com/research) for retrieval mechanics detail.",
        },
        {
          type: "list",
          style: "bullet",
          items: [
            "**Self-contained chunks** are quoted; embedded clauses are not.",
            "**Question-format H2s** match the way users phrase prompts.",
            "**Structured data** (Schema.org) is over-weighted by retrieval pipelines.",
          ],
        },
      ],
    },
    {
      heading: "What are the seven blocks of the page architecture?",
      answerCapsule:
        "The seven blocks are TL;DR (40-60 word answer capsule), intro, sections (each with a 6-10 word question-format H2 and a 40-60 word answer capsule), related guides (4-8), key takeaways (4-6), FAQ (3-10), and disclosure. They appear in this fixed order on every page, and each is validated by the publishing schema before going live.",
      blocks: [
        {
          type: "paragraph",
          text: "Block order is load-bearing. AI retrieval pipelines weight position: TL;DR at the top is the highest-signal chunk; FAQ near the bottom drives the FAQPage Schema.org type. Reordering breaks the implicit contract the page is making with retrieval, even though the same content would still be present. Per [Schema.org guidance](https://schema.org/Article), structured FAQ markup is parsed independently of the page body.",
        },
      ],
    },
  ],
  relatedGuides: {
    items: [
      {
        title: "How do AI search engines decide which pages to cite?",
        url: "https://www.shadow.inc/resources/ai-search-citation",
      },
      {
        title: "GEO vs SEO: What's actually different",
        url: "https://www.shadow.inc/resources/geo-vs-seo",
      },
      {
        title: "Schema.org markup for GEO: A 2026 reference",
        url: "https://www.shadow.inc/resources/schema-org-for-geo",
      },
      {
        title: "Entity density and citation lift: The empirical case",
        url: "https://www.shadow.inc/resources/entity-density-citation",
      },
    ],
  },
  keyTakeaways: {
    items: [
      "AI search engines extract chunks, not documents — page architecture must respect chunk boundaries to be quoted.",
      "The seven-block GEO page architecture (TL;DR, intro, Q-format sections, related guides, key takeaways, FAQ, disclosure) maximizes chunk extractability.",
      "Each H2 section opens with a 40-60 word answer capsule that fully answers the heading without context from elsewhere on the page.",
      "Entity-dense pages show approximately 4.8x higher citation probability than entity-sparse pages of similar length.",
    ],
  },
  faq: {
    items: [
      {
        question: "Is GEO different from SEO?",
        answer:
          "Yes. SEO optimizes for ranking in a search results page; GEO optimizes for being quoted inside an AI engine's synthesized answer. The two practices share signal types (entities, links, structure) but diverge sharply on what makes a page win: a click versus a citation. GEO pages are structured for extraction, not for click-through.",
      },
      {
        question: "Do I need to redo my entire site to adopt GEO?",
        answer:
          "No. GEO architecture applies to resource pages, definitive guides, and FAQ-style content. Marketing landing pages, product pages, and conversion-focused surfaces retain their existing structure. The split mirrors the split between top-of-funnel discovery (where AI citation matters) and bottom-of-funnel conversion (where AI citation does not).",
      },
      {
        question: "How long does it take to see citation lift from a GEO page?",
        answer:
          "AI engine retrieval indexes update on different cadences. Perplexity reflects new pages within hours; ChatGPT and Google AI Overviews can take several weeks. The fastest signal is appearing as a citation source in a Perplexity answer to one of your target queries; absence after 30 days suggests structural problems rather than indexing latency.",
      },
    ],
  },
  disclosure: {
    text: "This page was assembled from internal research and public GEO literature. Numerical thresholds (entity density, statistics-per-thousand, image cadence) reflect working consensus from experimentation and may shift as AI engines evolve. Last reviewed June 2026.",
  },
};
