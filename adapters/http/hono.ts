import { Hono } from "hono";
import { runPublish, runDelete, type PublishOptions } from "../../core/publish";

/**
 * Hono router for `auto-geo`. Mount on whatever path you want, but the
 * conventional mount is `/api/resources/publish`:
 *
 *   import { Hono } from "hono";
 *   import { createHonoRouter } from "auto-geo/hono";
 *   import { createKvStore } from "auto-geo/storage/kv";
 *
 *   const app = new Hono();
 *   app.route(
 *     "/api/resources/publish",
 *     createHonoRouter({
 *       store: createKvStore(),
 *       site: { origin: "https://example.com", publisher: { ... } },
 *     })
 *   );
 *
 * Auth: reads `GEO_PUBLISH_TOKEN` (override with `tokenEnv`) and expects
 * `Authorization: Bearer <token>`. Hono runs in any Node, Bun, Deno,
 * Cloudflare Workers, or Vercel Functions runtime — pick your env-var
 * source accordingly.
 *
 * This adapter is the canonical reference for non-Next backends. Adapt
 * it for Express, Fastify, Elysia, etc. by translating the request /
 * response idioms; the call into `runPublish` stays the same.
 */

export type HonoRouterOptions = PublishOptions & {
  tokenEnv?: string;
  /**
   * Optional hook called after a successful publish or delete. Use this
   * to plug in framework-specific cache invalidation (e.g., purging an
   * external CDN). Errors are caught and logged, not propagated.
   */
  onSuccess?: (event: {
    kind: "publish" | "delete";
    slug: string;
  }) => void | Promise<void>;
};

function checkAuth(authHeader: string | undefined, expected: string): boolean {
  if (!authHeader?.startsWith("Bearer ")) return false;
  return authHeader.slice("Bearer ".length).trim() === expected;
}

export function createHonoRouter(opts: HonoRouterOptions) {
  const app = new Hono();
  const tokenEnv = opts.tokenEnv ?? "GEO_PUBLISH_TOKEN";

  app.post("/", async (c) => {
    const expected = process.env[tokenEnv];
    if (!expected) {
      console.error(`auto-geo: ${tokenEnv} is not configured.`);
      return c.json({ error: "Server configuration error." }, 500);
    }
    if (!checkAuth(c.req.header("authorization"), expected)) {
      return c.json({ error: "Unauthorized." }, 401);
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body." }, 400);
    }

    const result = await runPublish(body, opts);
    switch (result.kind) {
      case "validation_failed":
        return c.json(
          { error: "Validation failed.", issues: result.issues },
          400
        );
      case "slug_reserved":
        return c.json(
          {
            error: `Slug "${result.slug}" is reserved by a static page and cannot be overwritten via this API.`,
          },
          409
        );
      case "store_failed":
        console.error("auto-geo: store.publish threw:", result.error);
        return c.json({ error: "Failed to publish resource." }, 502);
      case "ok":
        if (opts.onSuccess) {
          try {
            await opts.onSuccess({ kind: "publish", slug: result.slug });
          } catch (e) {
            console.error("auto-geo: onSuccess hook threw:", e);
          }
        }
        return c.json({
          success: true,
          slug: result.slug,
          url: result.url,
          warnings: result.warnings,
        });
      default: {
        const _exhaustive: never = result;
        return _exhaustive;
      }
    }
  });

  app.delete("/", async (c) => {
    const expected = process.env[tokenEnv];
    if (!expected) {
      return c.json({ error: "Server configuration error." }, 500);
    }
    if (!checkAuth(c.req.header("authorization"), expected)) {
      return c.json({ error: "Unauthorized." }, 401);
    }
    const slug = c.req.query("slug");
    if (!slug) {
      return c.json({ error: "Missing `slug` query parameter." }, 400);
    }

    const result = await runDelete(slug, opts);
    switch (result.kind) {
      case "slug_reserved":
        return c.json(
          {
            error: `Slug "${result.slug}" is reserved by a static page and cannot be deleted via this API.`,
          },
          409
        );
      case "not_found":
        return c.json({ error: "Resource not found." }, 404);
      case "store_failed":
        console.error("auto-geo: store.delete threw:", result.error);
        return c.json({ error: "Failed to delete resource." }, 502);
      case "ok":
        if (opts.onSuccess) {
          try {
            await opts.onSuccess({ kind: "delete", slug: result.slug });
          } catch (e) {
            console.error("auto-geo: onSuccess hook threw:", e);
          }
        }
        return c.json({ success: true, slug: result.slug });
      default: {
        const _exhaustive: never = result;
        return _exhaustive;
      }
    }
  });

  return app;
}
