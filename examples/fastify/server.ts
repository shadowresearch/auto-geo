import Fastify, { type FastifyRequest, type FastifyReply } from "fastify";
import { runPublish, runDelete } from "auto-geo";
import { createMemoryStore } from "auto-geo/storage/memory";
import type { SiteConfig, PublishOptions } from "auto-geo";
import { seedResource } from "./seed.js";

/**
 * Fastify — endpoint-only example for auto-geo.
 *
 * No official Fastify adapter ships with auto-geo, so this example
 * wires `runPublish` and `runDelete` from the package directly.
 *
 * - Auth: Bearer GEO_PUBLISH_TOKEN, read from env at request time.
 * - Storage: in-memory (process-local), seeded with one valid payload.
 *
 * This example does NOT render HTML. For the full React render path see
 * examples/next-minimal/.
 */

const PORT = Number(process.env.PORT ?? 3004);

const store = createMemoryStore({ seed: [seedResource] });

const site: SiteConfig = {
  origin: process.env.SITE_ORIGIN ?? `http://localhost:${PORT}`,
  basePath: "/resources",
  publisher: {
    name: "Shadow",
    url: "https://www.shadow.inc",
    logo: "https://www.shadow.inc/logo2.svg",
  },
};

const publishOpts: PublishOptions = { store, site };

const app = Fastify({ logger: false });

function authorize(
  request: FastifyRequest
): "ok" | "no-token" | "unauthorized" {
  const expected = process.env.GEO_PUBLISH_TOKEN;
  if (!expected) return "no-token";
  const header = request.headers["authorization"];
  if (typeof header !== "string" || !header.startsWith("Bearer ")) {
    return "unauthorized";
  }
  return header.slice("Bearer ".length).trim() === expected
    ? "ok"
    : "unauthorized";
}

app.get("/", async () => ({
  name: "auto-geo fastify example",
  endpoints: {
    publish: "POST /api/resources/publish",
    delete: "DELETE /api/resources/publish?slug=<slug>",
    list: "GET /api/resources",
    get: "GET /api/resources/:slug",
  },
}));

app.post(
  "/api/resources/publish",
  async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = authorize(request);
    if (auth === "no-token") {
      console.error("auto-geo: GEO_PUBLISH_TOKEN is not configured.");
      return reply.code(500).send({ error: "Server configuration error." });
    }
    if (auth === "unauthorized") {
      return reply.code(401).send({ error: "Unauthorized." });
    }

    const result = await runPublish(request.body, publishOpts);
    switch (result.kind) {
      case "validation_failed":
        return reply
          .code(400)
          .send({ error: "Validation failed.", issues: result.issues });
      case "slug_reserved":
        return reply.code(409).send({
          error: `Slug "${result.slug}" is reserved by a static page and cannot be overwritten via this API.`,
        });
      case "store_failed":
        console.error("auto-geo: store.publish threw:", result.error);
        return reply.code(502).send({ error: "Failed to publish resource." });
      case "ok":
        return reply.send({
          success: true,
          slug: result.slug,
          url: result.url,
          warnings: result.warnings,
        });
    }
  }
);

app.delete<{ Querystring: { slug?: string } }>(
  "/api/resources/publish",
  async (request, reply) => {
    const auth = authorize(request);
    if (auth === "no-token") {
      return reply.code(500).send({ error: "Server configuration error." });
    }
    if (auth === "unauthorized") {
      return reply.code(401).send({ error: "Unauthorized." });
    }
    const slug = request.query.slug;
    if (!slug) {
      return reply.code(400).send({ error: "Missing `slug` query parameter." });
    }

    const result = await runDelete(slug, publishOpts);
    switch (result.kind) {
      case "slug_reserved":
        return reply.code(409).send({
          error: `Slug "${result.slug}" is reserved by a static page and cannot be deleted via this API.`,
        });
      case "not_found":
        return reply.code(404).send({ error: "Resource not found." });
      case "store_failed":
        console.error("auto-geo: store.delete threw:", result.error);
        return reply.code(502).send({ error: "Failed to delete resource." });
      case "ok":
        return reply.send({ success: true, slug: result.slug });
    }
  }
);

app.get("/api/resources", async () => {
  const items = await store.list();
  return {
    count: items.length,
    items: items.map((r) => ({
      slug: r.slug,
      title: r.title,
      category: r.category,
      publishedAt: r.publishedAt,
      url: `${site.origin}${site.basePath}/${r.slug}`,
    })),
  };
});

app.get<{ Params: { slug: string } }>(
  "/api/resources/:slug",
  async (request, reply) => {
    const resource = await store.get(request.params.slug);
    if (!resource) return reply.code(404).send({ error: "Not found." });
    return resource;
  }
);

if (!process.env.GEO_PUBLISH_TOKEN) {
  console.warn(
    "auto-geo: GEO_PUBLISH_TOKEN is not set. Publish requests will 500 until it is."
  );
}

app.listen({ port: PORT, host: "0.0.0.0" }, (err) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.warn(
    `auto-geo fastify example listening on http://localhost:${PORT}`
  );
});
