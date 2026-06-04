import type { ResourcePublishPayload } from "auto-geo";

/**
 * Minimal seed payload that satisfies all hard schema constraints.
 * Used to populate the in-memory store so GET /api/resources returns
 * something on first run.
 */
export const seedResource: ResourcePublishPayload = {
  slug: "hello-auto-geo",
  title: "Hello from the auto-geo Cloudflare Workers example",
  metaDescription:
    "A seeded resource that demonstrates the auto-geo publish flow running on a Cloudflare Worker with the in-memory store, served entirely from the edge.",
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
  keywords: ["auto-geo", "cloudflare", "workers"],
  geoMetadata: {
    targetQueries: [
      "auto-geo cloudflare workers example",
      "how to run auto-geo on cloudflare",
      "auto-geo edge runtime example",
    ],
    pageType: "resource",
    primaryFunction:
      "Demonstrate the auto-geo publish endpoint running on a Cloudflare Worker with the Fetch API, end to end, with no Node-specific imports anywhere.",
    optimizationFramework: ["GEO"],
    targetPlatforms: ["chatgpt", "perplexity"],
    informationGainStatement:
      "First-party reference for wiring the auto-geo Cloudflare adapter into a Worker with the in-memory store for local dev.",
    refreshCadence: "quarterly",
  },
  about: [
    { name: "auto-geo" },
    { name: "Cloudflare Workers" },
    { name: "Fetch API" },
  ],
  tldr: {
    text: "This seeded resource exists so the auto-geo Cloudflare Workers example has a non-empty store on first run, which lets the GET listing endpoint and GET by slug endpoint return useful JSON before you have published any payload of your own to the running worker.",
  },
  intro: {
    blocks: [
      {
        type: "paragraph",
        text: "The auto-geo Cloudflare Workers example uses the auto-geo/cloudflare adapter to expose POST and DELETE endpoints, plus a small in-memory store seeded with this payload so reads work immediately. Replace it by posting your own payload to /api/resources/publish.",
      },
    ],
  },
  sections: [
    {
      heading: "How do I publish my own resource to this worker?",
      answerCapsule:
        "Send an HTTP POST to /api/resources/publish with the Authorization Bearer header set to your GEO_PUBLISH_TOKEN secret and a JSON body that satisfies the auto-geo resourcePublishSchema. The endpoint returns the new URL and any soft warnings on success.",
      blocks: [
        {
          type: "paragraph",
          text: "See the README for a working curl example. The same payload shape works against every auto-geo example app — the only thing that changes between runtimes is the host you point curl at.",
        },
      ],
    },
    {
      heading: "How do I verify the publish worked end to end?",
      answerCapsule:
        "After a successful publish, call GET /api/resources to confirm the slug is in the listing and GET /api/resources/:slug to read back the stored payload. The in-memory store persists for the lifetime of the worker isolate and is wiped on cold start.",
      blocks: [
        {
          type: "paragraph",
          text: "For production use, swap the memory store for a KV-backed ContentStore — bind a KV namespace in wrangler.toml and implement the four ContentStore methods against env.GEO_KV.",
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
        title: "Cloudflare Workers docs",
        url: "https://developers.cloudflare.com/workers/",
      },
    ],
  },
  keyTakeaways: {
    items: [
      "The auto-geo Cloudflare adapter uses only the Fetch API, with no Node-specific imports.",
      "Bearer auth is read from env.GEO_PUBLISH_TOKEN at request time, so wrangler secret put takes effect on next invoke.",
      "The in-memory store is fine for local dev and per-isolate demos; swap to a KV-backed store for durable production use.",
      "Two integration styles are exported: createCloudflareHandlers for composition, createCloudflareFetch for one-line setup.",
    ],
  },
  faq: {
    items: [
      {
        question: "Do I need Wrangler to run this example?",
        answer:
          "The example uses wrangler dev for local development because it gives you an isolate that closely matches production. The auto-geo/cloudflare adapter itself is pure Fetch API and runs on any runtime that exposes Request and Response globals, including Deno Deploy, Bun, and edge runtimes other than Cloudflare.",
      },
      {
        question: "Why is the in-memory store fine for an example?",
        answer:
          "The example exists to demonstrate the auto-geo wiring, not the storage layer. The memory adapter has zero setup and zero dependencies, which keeps the example focused on the publish flow. Swap in a KV-backed ContentStore for production by binding a namespace in wrangler.toml and implementing the four ContentStore methods.",
      },
      {
        question: "What's the difference between the two integration styles?",
        answer:
          "createCloudflareHandlers returns publish and delete functions that you call from your own fetch handler — use it when auto-geo composes with other routes on the same worker. createCloudflareFetch returns a complete fetch handler that owns a single basePath and 404s anything else — use it when auto-geo is the whole worker.",
      },
    ],
  },
  disclosure: {
    text: "This is a seed payload included with the auto-geo Cloudflare Workers example. It satisfies the hard schema constraints but is deliberately short for demonstration purposes and will surface soft warnings on republish, which mirrors the real iteration loop.",
  },
};
