import type { ResourcePublishPayload } from "auto-geo";

/**
 * Minimal seed payload that satisfies all hard schema constraints.
 * Used to populate the in-memory store so GET /api/resources returns
 * something on first run.
 */
export const seedResource: ResourcePublishPayload = {
  slug: "hello-auto-geo",
  title: "Hello from the auto-geo SvelteKit example",
  metaDescription:
    "A seeded resource that demonstrates the auto-geo publish flow running inside a SvelteKit +server.ts endpoint, served entirely from memory.",
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
  keywords: ["auto-geo", "sveltekit", "endpoints"],
  geoMetadata: {
    targetQueries: [
      "auto-geo sveltekit example",
      "how to run auto-geo on sveltekit",
      "auto-geo endpoint only example",
    ],
    pageType: "resource",
    primaryFunction:
      "Demonstrate the auto-geo publish endpoint wired into a SvelteKit +server.ts handler using runPublish directly, with no framework-specific adapter.",
    optimizationFramework: ["GEO"],
    targetPlatforms: ["chatgpt", "perplexity"],
    informationGainStatement:
      "First-party reference for wiring auto-geo into SvelteKit by calling runPublish from a +server.ts handler with the in-memory store for local development.",
    refreshCadence: "quarterly",
  },
  about: [{ name: "auto-geo" }, { name: "SvelteKit" }, { name: "Vite" }],
  tldr: {
    text: "This seeded resource exists so the auto-geo SvelteKit example has a non-empty store on first run, which lets the GET listing endpoint and GET by slug endpoint return useful JSON before you have published any payload of your own to the running server.",
  },
  intro: {
    blocks: [
      {
        type: "paragraph",
        text: "The auto-geo SvelteKit example calls runPublish from the auto-geo package directly inside a +server.ts POST handler, plus a small in-memory store seeded with this payload so reads work immediately. Replace it by posting your own payload to /api/resources/publish.",
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
      "SvelteKit +server.ts handlers can call runPublish from the auto-geo package directly without a custom adapter.",
      "Bearer auth is read from the GEO_PUBLISH_TOKEN env var at request time, so rotating the secret takes effect immediately.",
      "The in-memory store is fine for local dev and demos; swap to KV or Supabase for production with no other code changes.",
      "This example exposes endpoint-only behavior; for the full React render path see examples/next-minimal/.",
    ],
  },
  faq: {
    items: [
      {
        question:
          "Why does this example use +server.ts instead of a Svelte page?",
        answer:
          "The +server.ts file is the SvelteKit primitive for HTTP endpoints, which is the right shape for the auto-geo publish contract. It exposes POST and DELETE methods directly and integrates with SvelteKit hooks for auth. Svelte components are for HTML rendering, not API surfaces.",
      },
      {
        question:
          "Can I render the published payload as a Svelte component too?",
        answer:
          "Yes, by writing a +page.svelte that fetches from the SvelteKit load function and renders the stored payload using your own Svelte template. auto-geo ships only a React renderer today, so for Svelte rendering you author your own component against the stored payload shape.",
      },
      {
        question: "Where does the publish endpoint return warnings?",
        answer:
          "Soft validation warnings come back as the warnings array on the 200 success response. They are non-blocking and surface issues like heading format, paragraph length, or entity density that the auditResource function checks after the strict schema passes.",
      },
    ],
  },
  disclosure: {
    text: "This is a seed payload included with the auto-geo SvelteKit example. It satisfies the hard schema constraints but is deliberately short for demonstration purposes and will surface soft warnings on republish, which mirrors the real iteration loop.",
  },
};
