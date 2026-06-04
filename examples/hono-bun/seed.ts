import type { ResourcePublishPayload } from "auto-geo";

/**
 * Minimal seed payload that satisfies all hard schema constraints.
 * Used to populate the in-memory store so GET /api/resources returns
 * something on first run.
 */
export const seedResource: ResourcePublishPayload = {
  slug: "hello-auto-geo",
  title: "Hello from the auto-geo Hono on Bun example",
  metaDescription:
    "A seeded resource that demonstrates the auto-geo publish flow running on a Hono server with the Bun runtime, served entirely from memory.",
  category: "Examples",
  excerpt:
    "This seeded resource exists so the GET /api/resources endpoint returns something on first run before you POST your own payload.",
  author: {
    name: "Shadow",
    jobTitle: "Maintainer",
    bio: "Shadow is a media research lab building AI-powered media intelligence and communications technology in partnership with leading product teams.",
    linkedinUrl: "https://www.linkedin.com/company/shadow-inc",
  },
  publishedAt: "2026-06-02",
  keywords: ["auto-geo", "hono", "bun"],
  geoMetadata: {
    targetQueries: [
      "auto-geo hono bun example",
      "how to run auto-geo on hono",
      "auto-geo endpoint only example",
    ],
    pageType: "resource",
    primaryFunction:
      "Demonstrate the auto-geo publish endpoint running on a Hono server with the Bun runtime, end to end, with no framework lock-in.",
    optimizationFramework: ["GEO"],
    targetPlatforms: ["chatgpt", "perplexity"],
    informationGainStatement:
      "First-party reference for wiring the auto-geo Hono adapter into a Bun server with the in-memory store for local development.",
    refreshCadence: "quarterly",
  },
  about: [{ name: "auto-geo" }, { name: "Hono" }, { name: "Bun" }],
  tldr: {
    text: "This seeded resource exists so the auto-geo Hono on Bun example has a non-empty store on first run, which lets the GET listing endpoint and GET by slug endpoint return useful JSON before you have published any payload of your own to the running server.",
  },
  intro: {
    blocks: [
      {
        type: "paragraph",
        text: "The auto-geo Hono on Bun example uses the auto-geo/hono adapter to expose POST and DELETE endpoints, plus a small in-memory store seeded with this payload so reads work immediately. Replace it by posting your own payload to /api/resources/publish.",
      },
    ],
  },
  sections: [
    {
      heading: "How do I publish my own resource to this example?",
      answerCapsule:
        "Send an HTTP POST to /api/resources/publish with the Authorization Bearer header set to your GEO_PUBLISH_TOKEN env value and a JSON body that satisfies the auto-geo resourcePublishSchema. The endpoint returns the new URL and any soft warnings on success.",
      blocks: [
        {
          type: "paragraph",
          text: "See the README for a working curl example. The same payload shape works against every auto-geo example app — the only thing that changes between frameworks is which port the server is listening on.",
        },
      ],
    },
    {
      heading: "How do I verify the publish worked end to end?",
      answerCapsule:
        "After a successful publish, call GET /api/resources to confirm the slug is in the listing and GET /api/resources/:slug to read back the stored payload. The in-memory store persists for the lifetime of the running process and is wiped on restart.",
      blocks: [
        {
          type: "paragraph",
          text: "For production use, swap the memory store for the KV or Supabase adapter — the publish endpoint and read endpoints both go through the ContentStore interface, so nothing else changes.",
        },
      ],
    },
  ],
  relatedGuides: {
    items: [
      {
        title: "auto-geo on GitHub",
        url: "https://github.com/shadowresearch/auto-geo",
      },
      {
        title: "The GEO SOP",
        url: "https://github.com/shadowresearch/auto-geo/blob/main/docs/sop.md",
      },
      {
        title: "Storage adapter guide",
        url: "https://github.com/shadowresearch/auto-geo/blob/main/docs/storage-adapters.md",
      },
      {
        title: "Schema validation reference",
        url: "https://github.com/shadowresearch/auto-geo/blob/main/docs/validation.md",
      },
    ],
  },
  keyTakeaways: {
    items: [
      "Hono works on Bun, Node, Deno, and Cloudflare Workers with the same auto-geo/hono adapter.",
      "Bearer auth is read from the GEO_PUBLISH_TOKEN env var at request time, so rotating the secret takes effect immediately.",
      "The in-memory store is fine for local dev and demos; swap to KV or Supabase for production with no other code changes.",
      "This example exposes endpoint-only behavior; for the full React render path see examples/next-minimal/.",
    ],
  },
  faq: {
    items: [
      {
        question: "Do I need Bun, or can I run this on Node?",
        answer:
          "The example is configured for Bun for zero-config TypeScript execution and built-in HTTP serving, but the auto-geo/hono adapter itself runs on Node, Deno, and Cloudflare Workers without code changes. Swap the package scripts and Bun.serve call for your runtime of choice.",
      },
      {
        question: "Why is the in-memory store fine for an example?",
        answer:
          "The example exists to demonstrate the auto-geo wiring, not the storage layer. The memory adapter has zero setup and zero dependencies, which keeps the example focused on the publish flow. Use the KV or Supabase adapter when you move to a real deployment.",
      },
      {
        question: "Where does the publish endpoint return warnings?",
        answer:
          "Soft validation warnings come back as the warnings array on the 200 success response. They are non-blocking and surface issues like heading format, paragraph length, or entity density that the auditResource function checks after the strict schema passes.",
      },
    ],
  },
  disclosure: {
    text: "This is a seed payload included with the auto-geo Hono on Bun example. It satisfies the hard schema constraints but is deliberately short for demonstration purposes and will surface soft warnings on republish, which mirrors the real iteration loop.",
  },
};
