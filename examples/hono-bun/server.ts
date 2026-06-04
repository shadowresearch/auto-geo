import { Hono } from "hono";
import { createHonoRouter } from "auto-geo/hono";
import { createMemoryStore } from "auto-geo/storage/memory";
import type { SiteConfig, ResourcePublishPayload } from "auto-geo";
import { seedResource } from "./seed";

/**
 * Hono on Bun — endpoint-only example for auto-geo.
 *
 * - Mounts the official `auto-geo/hono` adapter at /api/resources/publish.
 * - Auth: Bearer GEO_PUBLISH_TOKEN (read by the adapter from env at
 *   request time, so rotating the secret takes effect on the next call).
 * - Storage: in-memory (process-local), seeded with one valid payload so
 *   GET /api/resources and GET /api/resources/:slug return something on
 *   first run.
 *
 * This example does NOT render HTML. For the full React render path see
 * examples/next-minimal/.
 */

const PORT = Number(process.env.PORT ?? 3001);

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

const app = new Hono();

app.get("/", (c) =>
  c.json({
    name: "auto-geo hono-bun example",
    endpoints: {
      publish: "POST /api/resources/publish",
      delete: "DELETE /api/resources/publish?slug=<slug>",
      list: "GET /api/resources",
      get: "GET /api/resources/:slug",
    },
  })
);

// Mount the publish/delete adapter. Auth + validation are inside it.
app.route("/api/resources/publish", createHonoRouter({ store, site }));

// Read-side helpers so curl can verify storage without HTML rendering.
app.get("/api/resources", async (c) => {
  const items = await store.list();
  return c.json({
    count: items.length,
    items: items.map((r: ResourcePublishPayload & { storedAt: string }) => ({
      slug: r.slug,
      title: r.title,
      category: r.category,
      publishedAt: r.publishedAt,
      url: `${site.origin}${site.basePath}/${r.slug}`,
    })),
  });
});

app.get("/api/resources/:slug", async (c) => {
  const slug = c.req.param("slug");
  const resource = await store.get(slug);
  if (!resource) return c.json({ error: "Not found." }, 404);
  return c.json(resource);
});

if (!process.env.GEO_PUBLISH_TOKEN) {
  console.warn(
    "auto-geo: GEO_PUBLISH_TOKEN is not set. Publish requests will 500 until it is."
  );
}

console.warn(`auto-geo hono-bun example listening on http://localhost:${PORT}`);

export default {
  port: PORT,
  fetch: app.fetch,
};
