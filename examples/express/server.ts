import express, { type Request, type Response } from "express";
import { runPublish, runDelete } from "auto-geo";
import { createMemoryStore } from "auto-geo/storage/memory";
import type { SiteConfig, PublishOptions } from "auto-geo";
import { seedResource } from "./seed.js";

/**
 * Express — endpoint-only example for auto-geo.
 *
 * No official express adapter ships with auto-geo, so this example wires
 * `runPublish` and `runDelete` from the package directly. The same
 * pattern works for any Node HTTP framework.
 *
 * - Auth: Bearer GEO_PUBLISH_TOKEN, read from env at request time.
 * - Storage: in-memory (process-local), seeded with one valid payload.
 *
 * This example does NOT render HTML. For the full React render path see
 * examples/next-minimal/.
 */

const PORT = Number(process.env.PORT ?? 3002);

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

const app = express();
app.use(express.json({ limit: "1mb" }));

function authorize(req: Request): "ok" | "no-token" | "unauthorized" {
  const expected = process.env.GEO_PUBLISH_TOKEN;
  if (!expected) return "no-token";
  const header = req.header("authorization");
  if (!header?.startsWith("Bearer ")) return "unauthorized";
  return header.slice("Bearer ".length).trim() === expected
    ? "ok"
    : "unauthorized";
}

app.get("/", (_req, res) => {
  res.json({
    name: "auto-geo express example",
    endpoints: {
      publish: "POST /api/resources/publish",
      delete: "DELETE /api/resources/publish?slug=<slug>",
      list: "GET /api/resources",
      get: "GET /api/resources/:slug",
    },
  });
});

app.post("/api/resources/publish", async (req: Request, res: Response) => {
  const auth = authorize(req);
  if (auth === "no-token") {
    console.error("auto-geo: GEO_PUBLISH_TOKEN is not configured.");
    return res.status(500).json({ error: "Server configuration error." });
  }
  if (auth === "unauthorized") {
    return res.status(401).json({ error: "Unauthorized." });
  }

  const result = await runPublish(req.body, publishOpts);
  switch (result.kind) {
    case "validation_failed":
      return res
        .status(400)
        .json({ error: "Validation failed.", issues: result.issues });
    case "slug_reserved":
      return res.status(409).json({
        error: `Slug "${result.slug}" is reserved by a static page and cannot be overwritten via this API.`,
      });
    case "store_failed":
      console.error("auto-geo: store.publish threw:", result.error);
      return res.status(502).json({ error: "Failed to publish resource." });
    case "ok":
      return res.json({
        success: true,
        slug: result.slug,
        url: result.url,
        warnings: result.warnings,
      });
  }
});

app.delete("/api/resources/publish", async (req: Request, res: Response) => {
  const auth = authorize(req);
  if (auth === "no-token") {
    return res.status(500).json({ error: "Server configuration error." });
  }
  if (auth === "unauthorized") {
    return res.status(401).json({ error: "Unauthorized." });
  }
  const slug = req.query.slug;
  if (typeof slug !== "string" || !slug) {
    return res.status(400).json({ error: "Missing `slug` query parameter." });
  }

  const result = await runDelete(slug, publishOpts);
  switch (result.kind) {
    case "slug_reserved":
      return res.status(409).json({
        error: `Slug "${result.slug}" is reserved by a static page and cannot be deleted via this API.`,
      });
    case "not_found":
      return res.status(404).json({ error: "Resource not found." });
    case "store_failed":
      console.error("auto-geo: store.delete threw:", result.error);
      return res.status(502).json({ error: "Failed to delete resource." });
    case "ok":
      return res.json({ success: true, slug: result.slug });
  }
});

app.get("/api/resources", async (_req, res) => {
  const items = await store.list();
  res.json({
    count: items.length,
    items: items.map((r) => ({
      slug: r.slug,
      title: r.title,
      category: r.category,
      publishedAt: r.publishedAt,
      url: `${site.origin}${site.basePath}/${r.slug}`,
    })),
  });
});

app.get("/api/resources/:slug", async (req, res) => {
  const resource = await store.get(req.params.slug);
  if (!resource) return res.status(404).json({ error: "Not found." });
  res.json(resource);
});

if (!process.env.GEO_PUBLISH_TOKEN) {
  console.warn(
    "auto-geo: GEO_PUBLISH_TOKEN is not set. Publish requests will 500 until it is."
  );
}

app.listen(PORT, () => {
  console.warn(
    `auto-geo express example listening on http://localhost:${PORT}`
  );
});
