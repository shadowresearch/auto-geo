import {
  createCloudflareHandlers,
  // createCloudflareFetch, // see "one-line setup" below
} from "auto-geo/cloudflare";
import { createMemoryStore } from "auto-geo/storage/memory";
import type { ResourcePublishPayload, SiteConfig } from "auto-geo";
import { seedResource } from "./seed";

/**
 * auto-geo on Cloudflare Workers — endpoint-only example.
 *
 * - Mounts the official `auto-geo/cloudflare` adapter at
 *   /api/resources/publish.
 * - Auth: Bearer GEO_PUBLISH_TOKEN (read by the adapter from the `env`
 *   argument at request time, so `wrangler secret put` takes effect on
 *   the next invoke).
 * - Storage: in-memory, seeded with one valid payload so reads return
 *   something on first run. NOTE: each worker isolate has its own memory.
 *   For production durability bind a KV namespace and write a small
 *   KV-backed ContentStore.
 *
 * Two integration styles are shown below. The default export uses the
 * "compose" style — `createCloudflareHandlers` returns `publish` and
 * `delete` functions that you call from your own `fetch` so you can add
 * other routes alongside (the GET endpoints further down).
 *
 * If auto-geo is the entire worker, the simpler style is:
 *
 *   import { createCloudflareFetch } from "auto-geo/cloudflare";
 *   export default {
 *     fetch: createCloudflareFetch({ store, site }),
 *   };
 */

interface Env {
  GEO_PUBLISH_TOKEN: string;
  // GEO_KV: KVNamespace; // uncomment when you bind a KV namespace
}

const store = createMemoryStore({ seed: [seedResource] });

const site: SiteConfig = {
  origin: "https://auto-geo-example.workers.dev",
  basePath: "/resources",
  publisher: {
    name: "Shadow",
    url: "https://www.shadow.inc",
    logo: "https://www.shadow.inc/logo2.svg",
  },
};

const handlers = createCloudflareHandlers({ store, site });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Publish + delete — delegated to the auto-geo adapter.
    if (url.pathname === "/api/resources/publish") {
      if (request.method === "POST") return handlers.publish(request, env);
      if (request.method === "DELETE") return handlers.delete(request, env);
      return new Response("Method not allowed", {
        status: 405,
        headers: { allow: "POST, DELETE" },
      });
    }

    // Read-side helpers so curl can verify storage without HTML rendering.
    if (url.pathname === "/api/resources" && request.method === "GET") {
      const items = await store.list();
      return Response.json({
        count: items.length,
        items: items.map(
          (r: ResourcePublishPayload & { storedAt: string }) => ({
            slug: r.slug,
            title: r.title,
            category: r.category,
            publishedAt: r.publishedAt,
            url: `${site.origin}${site.basePath}/${r.slug}`,
          })
        ),
      });
    }

    const slugMatch = url.pathname.match(/^\/api\/resources\/([^/]+)$/);
    if (slugMatch && request.method === "GET") {
      const resource = await store.get(slugMatch[1]);
      if (!resource)
        return Response.json({ error: "Not found." }, { status: 404 });
      return Response.json(resource);
    }

    if (url.pathname === "/") {
      return Response.json({
        name: "auto-geo cloudflare-workers example",
        endpoints: {
          publish: "POST /api/resources/publish",
          delete: "DELETE /api/resources/publish?slug=<slug>",
          list: "GET /api/resources",
          get: "GET /api/resources/:slug",
        },
      });
    }

    return new Response("Not found", { status: 404 });
  },
};
