#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import { z } from "zod";

/**
 * auto-geo MCP server.
 *
 * Exposes a single tool, `publish_resource`, that wraps the
 * `/api/resources/publish` endpoint of your auto-geo deployment. Any
 * MCP-aware AI client (Claude Desktop, Claude Code, Cursor, your own
 * agent) can register this server and publish resources as a tool call.
 *
 * Built by Shadow (https://www.shadow.inc).
 *
 * Configuration (via env vars set in the MCP client's config):
 *   - AUTO_GEO_PUBLISH_URL   — full URL to your publish endpoint.
 *                              e.g. https://yoursite.com/api/resources/publish
 *   - AUTO_GEO_PUBLISH_TOKEN — bearer token matching GEO_PUBLISH_TOKEN
 *                              on the server.
 *
 * The tool input schema mirrors the publish API contract. The server is
 * a typed bridge: it forwards the validated payload to your deployment
 * and returns whatever the publish endpoint returned, including the
 * warnings array. All structural validation happens server-side via
 * Zod — this MCP layer is just transport.
 *
 * Claude Desktop config example:
 *
 *   {
 *     "mcpServers": {
 *       "auto-geo": {
 *         "command": "npx",
 *         "args": ["-y", "auto-geo-mcp"],
 *         "env": {
 *           "AUTO_GEO_PUBLISH_URL": "https://yoursite.com/api/resources/publish",
 *           "AUTO_GEO_PUBLISH_TOKEN": "..."
 *         }
 *       }
 *     }
 *   }
 */

// ── Input schema (mirrors the publish API contract) ───────────────

const entityRef = z
  .object({
    name: z.string().min(1).describe("Entity display name."),
    url: z.string().url().optional().describe("Canonical URL for the entity."),
  })
  .describe("Reference to a named entity (company, person, product).");

const citation = z
  .object({
    url: z.string().url().describe("URL of the cited work."),
    title: z.string().optional().describe("Title of the cited work."),
    publisher: z.string().optional().describe("Publisher name."),
  })
  .describe("A source cited by the page.");

const author = z
  .object({
    name: z.string().min(1).max(120),
    jobTitle: z.string().min(1).max(120),
    bio: z
      .string()
      .min(20)
      .max(600)
      .describe("2-3 sentence bio, rendered in the About the Author block."),
    linkedinUrl: z.string().url().optional(),
  })
  .describe("Author of the resource.");

const contentBlock = z
  .discriminatedUnion("type", [
    z.object({
      type: z.literal("paragraph"),
      text: z.string().describe("Paragraph text. 60-100 words ideal."),
    }),
    z.object({
      type: z.literal("h3"),
      text: z.string().describe("H3 heading."),
    }),
    z.object({
      type: z.literal("list"),
      style: z.enum(["bullet", "number"]),
      items: z.array(z.string()).min(2).max(30),
    }),
    z.object({
      type: z.literal("table"),
      caption: z.string().optional(),
      headers: z.array(z.string()).min(2).max(10),
      rows: z
        .array(z.array(z.string()))
        .describe("Each row must have exactly one cell per header."),
    }),
    z.object({
      type: z.literal("quote"),
      text: z.string(),
      attribution: z.string(),
    }),
    z.object({
      type: z.literal("image"),
      src: z.string().url(),
      alt: z
        .string()
        .min(20)
        .max(300)
        .describe("Alt text with entity name and context. ≥20 chars."),
      caption: z.string().optional(),
    }),
    z.object({
      type: z.literal("callout"),
      variant: z.enum(["info", "stat"]),
      text: z.string(),
    }),
  ])
  .describe("Content block. Inline syntax: **bold**, *italic*, [label](url).");

const PublishResourceSchema = z
  .object({
    slug: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
      .describe("URL slug (lowercase letters, numbers, single hyphens)."),
    title: z.string().min(1).max(160).describe("H1 + Open Graph title."),
    metaTitle: z
      .string()
      .min(1)
      .max(160)
      .optional()
      .describe("Optional <title> override; defaults to title."),
    metaDescription: z
      .string()
      .min(50)
      .max(180)
      .describe("<meta name=description> content. 50-180 chars."),
    category: z
      .string()
      .min(1)
      .max(80)
      .describe("Index grouping category."),
    excerpt: z
      .string()
      .min(50)
      .max(400)
      .describe("Index-card preview text on /resources."),
    author,
    publishedAt: z.string().describe("ISO yyyy-mm-dd publication date."),
    modifiedAt: z
      .string()
      .optional()
      .describe("ISO yyyy-mm-dd last-modified date. Must be ≥ publishedAt."),
    keywords: z.array(z.string()).max(15).optional(),
    ogImage: z.string().url().optional(),
    about: z
      .array(entityRef)
      .max(30)
      .optional()
      .describe("Primary entities the page is about (3-7 ideal)."),
    mentions: z.array(entityRef).max(30).optional(),
    citations: z.array(citation).max(50).optional(),
    geoMetadata: z
      .object({
        targetQueries: z.array(z.string()).min(1).max(20),
        pageType: z.enum([
          "definitive",
          "resource",
          "comparison",
          "category",
          "listicle",
        ]),
        primaryFunction: z.string().min(5).max(300),
        optimizationFramework: z.array(z.enum(["AEO", "GEO", "LLMO"])).min(1),
        targetPlatforms: z
          .array(
            z.enum([
              "chatgpt",
              "perplexity",
              "google_aio",
              "google_ai_mode",
              "claude",
              "gemini",
              "copilot",
            ])
          )
          .min(1),
        informationGainStatement: z.string().min(20).max(600),
        proprietaryAssetOpportunity: z.string().max(600).optional(),
        refreshCadence: z.enum(["monthly", "quarterly"]),
      })
      .describe("Internal GEO metadata per SOP §14. Stored, not rendered."),
    tldr: z
      .object({
        text: z.string().describe("40-60 word answer capsule."),
      })
      .describe("Page-level answer capsule (TL;DR). 40-60 words."),
    intro: z.object({ blocks: z.array(contentBlock).min(1).max(10) }),
    sections: z
      .array(
        z.object({
          heading: z.string().describe("Question-format H2. 6-10 words ideal."),
          answerCapsule: z
            .string()
            .describe("40-60 word self-contained answer to the heading."),
          blocks: z.array(contentBlock).max(40),
        })
      )
      .min(1)
      .max(40),
    relatedGuides: z.object({
      items: z
        .array(z.object({ title: z.string(), url: z.string().url() }))
        .min(4)
        .max(8),
    }),
    keyTakeaways: z.object({
      items: z
        .array(z.string().describe("10-35 word declarative bullet."))
        .min(4)
        .max(6),
    }),
    faq: z.object({
      heading: z.string().optional(),
      items: z
        .array(
          z.object({
            question: z.string().min(5).max(300),
            answer: z.string().describe("40-60 word answer."),
          })
        )
        .min(3)
        .max(10),
    }),
    disclosure: z.object({
      text: z.string().min(20).max(1000),
    }),
  })
  .describe("Resource publish payload.");

// ── Server ────────────────────────────────────────────────────────

const server = new Server(
  { name: "auto-geo", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

const TOOL_DESCRIPTION = `Publish a GEO resource page to your auto-geo deployment.

GEO resource pages are public web pages structured for citation by AI search engines (ChatGPT, Perplexity, Google AI Overviews, Claude, Gemini). The architecture is rigid: TL;DR → intro → sections (H2 + answer capsule + blocks) → Related Guides → Key Takeaways → FAQ → disclosure. The publish endpoint validates against a strict Zod schema and returns 400 with an issues array on structural failures.

Hard constraints:
- TL;DR: 40-60 words
- Section answer capsule: 40-60 words
- FAQ answer: 40-60 words
- Key Takeaway: 10-35 words each
- Related Guides: 4-8 entries
- Key Takeaways: 4-6 entries
- FAQ: 3-10 entries
- No raw HTML in prose fields
- No promotional superlatives without attribution

Inline syntax (inside any text field):
- **bold**, *italic*, [label](url)

On success: returns { slug, url, warnings }. Warnings are non-blocking quality heuristics; surface them to the user and iterate by re-posting if any are worth addressing (publish is idempotent on slug).

See https://github.com/shadowresearch/auto-geo/blob/main/docs/sop.md for the full GEO SOP.`;

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "publish_resource",
      description: TOOL_DESCRIPTION,
      inputSchema: zodToJsonSchema(PublishResourceSchema, {
        target: "openApi3",
        $refStrategy: "none",
      }) as Record<string, unknown>,
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name !== "publish_resource") {
    return {
      content: [{ type: "text", text: `Unknown tool: ${req.params.name}` }],
      isError: true,
    };
  }

  const url = process.env.AUTO_GEO_PUBLISH_URL;
  const token = process.env.AUTO_GEO_PUBLISH_TOKEN;
  if (!url) {
    return {
      content: [{ type: "text", text: "AUTO_GEO_PUBLISH_URL is not set." }],
      isError: true,
    };
  }
  if (!token) {
    return {
      content: [{ type: "text", text: "AUTO_GEO_PUBLISH_TOKEN is not set." }],
      isError: true,
    };
  }

  // Forward raw arguments. The publish endpoint is the source of truth
  // for validation; duplicating Zod parsing here would risk drifting from
  // server-side behavior.
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(req.params.arguments ?? {}),
    });

    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { raw: text };
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { status: response.status, body: parsed },
            null,
            2
          ),
        },
      ],
      isError: !response.ok,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: `Failed to reach publish endpoint at ${url}: ${message}`,
        },
      ],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
