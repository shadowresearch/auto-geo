import type { ResourcePublishPayload } from "../../cli/schema";

/**
 * Canonical valid payload used across the test suite. Every constraint
 * in `cli/schema.ts` is satisfied; remaining soft-quality heuristics
 * may or may not fire (they're not the schema's concern). Tests that
 * exercise specific rejection paths produce a variant by spreading this
 * fixture and overriding the offending field.
 *
 * Hand-tuned: each prose field is the exact word count the schema
 * requires, so trimming a single word in a derived test will trip the
 * constraint cleanly.
 */
export const VALID_PAYLOAD: ResourcePublishPayload = {
  slug: "sample-resource",
  title: "How does the auto-geo publishing pipeline work end to end?",
  metaDescription:
    "A concise walkthrough of the auto-geo publishing flow including schema validation, storage adapters, and JSON-LD derivation behavior.",
  category: "Tutorials",
  excerpt:
    "Auto-geo enforces a strict page architecture at the publish boundary so AI search engines can extract and quote your content reliably without bespoke prose review.",
  author: {
    name: "Jane Doe",
    jobTitle: "Head of Content",
    bio: "Jane writes about generative engine optimization and the architecture of pages that AI search engines cite. Previously at a search infrastructure company.",
    linkedinUrl: "https://www.linkedin.com/in/janedoe",
  },
  publishedAt: "2026-06-01",
  modifiedAt: "2026-06-02",
  keywords: ["auto-geo", "GEO", "publishing"],
  ogImage: "https://example.com/og.png",
  geoMetadata: {
    targetQueries: [
      "how does the auto-geo publish pipeline work",
      "auto-geo schema validation walkthrough",
    ],
    pageType: "resource",
    primaryFunction:
      "Walk a reader through the auto-geo publish pipeline end to end.",
    optimizationFramework: ["GEO", "AEO"],
    targetPlatforms: ["chatgpt", "perplexity"],
    informationGainStatement:
      "First-party explanation of how auto-geo validation, persistence, and JSON-LD derivation interact, which is not documented elsewhere outside this repo.",
    refreshCadence: "quarterly",
  },
  about: [{ name: "auto-geo" }, { name: "Shadow" }],
  mentions: [{ name: "Vercel KV" }],
  citations: [
    {
      url: "https://schema.org/Article",
      title: "Schema.org Article",
      publisher: "Schema.org",
    },
  ],
  tldr: {
    // 50 words
    text: "Auto-geo's publish pipeline runs validation, persistence, revalidation, and JSON-LD derivation in a fixed order so every published resource page is structurally correct and immediately discoverable; this walkthrough explains each step in turn, the contracts between them, and the error modes you can expect when an agent submits a malformed payload to the endpoint.",
  },
  intro: {
    blocks: [
      {
        type: "paragraph",
        // 50 words
        text: "This guide walks through every step of the auto-geo publish pipeline so a developer integrating the system can predict its behavior under both happy-path and error conditions; we cover validation, persistence, revalidation, and rendering, plus the iteration loop that the warnings array enables for agentic publishing workflows from start to finish.",
      },
    ],
  },
  sections: [
    {
      heading: "What does the validation step actually check?",
      // 50 words
      answerCapsule:
        "The validation step runs the incoming JSON body through the auto-geo resource Zod schema which enforces structural blocks, prose word counts, banned promotional phrases, raw HTML rejection, and URL validity; failures return HTTP 400 with a path-and-message issue array the caller can act on programmatically without parsing prose.",
      blocks: [
        {
          type: "paragraph",
          // 65 words
          text: "Each prose field accepts only the inline syntax bold, italic, and links, validated by [the schema source](https://example.com/schema). Raw HTML is rejected at the boundary which is intentional, since AI engine retrieval pipelines treat HTML noise as a quality signal and downweight pages that include it. The constraint forces clean prose and gives renderers a deterministic input contract to render against.",
        },
      ],
    },
  ],
  relatedGuides: {
    items: [
      { title: "Schema validation reference", url: "https://example.com/v" },
      { title: "Storage adapter guide", url: "https://example.com/s" },
      { title: "The GEO SOP", url: "https://example.com/sop" },
      { title: "What is a GEO resource page", url: "https://example.com/c" },
    ],
  },
  keyTakeaways: {
    items: [
      // 20 words
      "Validation runs first and rejects malformed payloads with HTTP 400 and a path-message issue array the caller can iterate on.",
      // 18 words
      "Storage adapters are pluggable so KV, Supabase, or a custom backend can sit behind the same publish contract.",
      // 19 words
      "JSON-LD derivation is automatic so agents never write Schema.org markup by hand and never produce inconsistent markup across pages.",
      // 17 words
      "Revalidation invalidates Next.js ISR caches so newly published pages appear immediately rather than waiting for the next refresh.",
    ],
  },
  faq: {
    items: [
      {
        question: "What happens when validation fails?",
        // 50 words
        answer:
          "The endpoint returns HTTP 400 with a body containing an error string and an issues array of path-message objects; the calling agent inspects the issues, edits the offending fields in its draft, and re-posts the same slug, since the publish endpoint is idempotent on slug and overwrites the existing entry.",
      },
      {
        question: "How do soft warnings differ from hard rejections?",
        // 50 words
        answer:
          "Soft warnings come back in the warnings array of a successful HTTP 200 response and never block the publish; they surface SOP quality heuristics like entity density, image cadence, and section length so the calling agent can iterate without being blocked by every non-critical structural recommendation in the document.",
      },
      {
        question: "Can a publish overwrite an existing slug?",
        // 50 words
        answer:
          "Yes, the publish endpoint is idempotent on slug, so re-posting the same slug with a new payload overwrites the prior entry in storage and triggers Next.js path revalidation so the updated page appears immediately on subsequent requests without any cache invalidation steps required from the calling agent or operator.",
      },
    ],
  },
  disclosure: {
    text: "This is a test fixture used by the auto-geo test suite to exercise the validation, persistence, and JSON-LD derivation pipelines end to end.",
  },
};
