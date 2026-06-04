import { runPublish, runDelete, type PublishOptions } from "../../core/publish";

/**
 * Cloudflare Workers handlers for auto-geo's publish/delete endpoints.
 *
 * Two integration styles are exported:
 *
 *   1. `createCloudflareHandlers` returns `{ publish, delete }` functions
 *      that you call from your own `fetch` handler. Use this if you want
 *      to compose auto-geo with other routes.
 *
 *   2. `createCloudflareFetch` returns a complete `fetch` handler that
 *      handles routing internally and 404s anything else. Use this if
 *      auto-geo owns the whole Worker.
 *
 * Both forms read the bearer token from `env[tokenEnv]` (default
 * `GEO_PUBLISH_TOKEN`) at request time — there is no `process.env` on
 * Workers, so the `env` argument is the source of truth.
 *
 * The adapter uses only the Fetch API (`Request`, `Response`, `URL`),
 * so it runs unchanged on Workers, Pages Functions, Deno Deploy, Bun, and
 * any other modern Fetch-compatible runtime. There is no Cloudflare SDK
 * dependency and no `@cloudflare/workers-types` import — the relevant
 * globals come from the standard `DOM` lib.
 *
 * @example Route-handler form
 * ```ts
 * import { createCloudflareHandlers } from "auto-geo/cloudflare";
 * import { createKvStore } from "auto-geo/storage/kv";
 *
 * const handlers = createCloudflareHandlers({
 *   store: createKvStore(),
 *   site: {
 *     origin: "https://example.com",
 *     publisher: { name: "Acme", url: "https://example.com", logo: "https://example.com/logo.png" },
 *   },
 * });
 *
 * export default {
 *   async fetch(request: Request, env: Env): Promise<Response> {
 *     const url = new URL(request.url);
 *     if (url.pathname === "/api/resources/publish") {
 *       if (request.method === "POST") return handlers.publish(request, env);
 *       if (request.method === "DELETE") return handlers.delete(request, env);
 *     }
 *     return new Response("Not found", { status: 404 });
 *   },
 * };
 * ```
 *
 * @example Fetch-default form
 * ```ts
 * import { createCloudflareFetch } from "auto-geo/cloudflare";
 *
 * export default {
 *   fetch: createCloudflareFetch({ store, site, basePath: "/api/resources/publish" }),
 * };
 * ```
 */

/**
 * Minimal env shape — any object whose values at the configured token
 * key are strings. Mirrors the Workers bindings convention without
 * requiring `@cloudflare/workers-types`.
 */
export type CloudflareEnv = Record<string, unknown>;

export type CloudflareHandlerOptions = PublishOptions & {
  /**
   * Override the env property name that holds the bearer token. Defaults
   * to `GEO_PUBLISH_TOKEN`.
   */
  tokenEnv?: string;
  /**
   * Optional hook called after a successful publish or delete. Use this
   * to plug in cache invalidation (e.g., purging a Cloudflare CDN tag
   * via the API). Errors are caught and logged, not propagated.
   */
  onSuccess?: (event: {
    kind: "publish" | "delete";
    slug: string;
  }) => void | Promise<void>;
};

export type CloudflareFetchOptions = CloudflareHandlerOptions & {
  /**
   * Path prefix that the `fetch` wrapper owns. POST/DELETE on this
   * exact path route to the publish/delete handler. Anything else
   * returns 404. Defaults to `/api/resources/publish`.
   */
  basePath?: string;
};

function readToken(env: CloudflareEnv, key: string): string | undefined {
  const value = env[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function checkAuth(authHeader: string | null, expected: string): boolean {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return false;
  return authHeader.slice("Bearer ".length).trim() === expected;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function runOnSuccess(
  opts: CloudflareHandlerOptions,
  event: { kind: "publish" | "delete"; slug: string }
): Promise<void> {
  if (!opts.onSuccess) return;
  try {
    await opts.onSuccess(event);
  } catch (e) {
    console.error("auto-geo: onSuccess hook threw:", e);
  }
}

export function createCloudflareHandlers(opts: CloudflareHandlerOptions) {
  const tokenEnv = opts.tokenEnv ?? "GEO_PUBLISH_TOKEN";

  async function publish(
    request: Request,
    env: CloudflareEnv
  ): Promise<Response> {
    const expected = readToken(env, tokenEnv);
    if (!expected) {
      console.error(`auto-geo: ${tokenEnv} is not configured.`);
      return jsonResponse({ error: "Server configuration error." }, 500);
    }
    if (!checkAuth(request.headers.get("authorization"), expected)) {
      return jsonResponse({ error: "Unauthorized." }, 401);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON body." }, 400);
    }

    const result = await runPublish(body, opts);
    switch (result.kind) {
      case "validation_failed":
        return jsonResponse(
          { error: "Validation failed.", issues: result.issues },
          400
        );
      case "slug_reserved":
        return jsonResponse(
          {
            error: `Slug "${result.slug}" is reserved by a static page and cannot be overwritten via this API.`,
            slug: result.slug,
          },
          409
        );
      case "store_failed":
        console.error("auto-geo: store.publish threw:", result.error);
        return jsonResponse({ error: "Failed to publish resource." }, 502);
      case "ok":
        await runOnSuccess(opts, { kind: "publish", slug: result.slug });
        return jsonResponse(
          {
            success: true,
            slug: result.slug,
            url: result.url,
            warnings: result.warnings,
          },
          200
        );
      default: {
        const _exhaustive: never = result;
        return _exhaustive;
      }
    }
  }

  async function del(request: Request, env: CloudflareEnv): Promise<Response> {
    const expected = readToken(env, tokenEnv);
    if (!expected) {
      console.error(`auto-geo: ${tokenEnv} is not configured.`);
      return jsonResponse({ error: "Server configuration error." }, 500);
    }
    if (!checkAuth(request.headers.get("authorization"), expected)) {
      return jsonResponse({ error: "Unauthorized." }, 401);
    }

    const slug = new URL(request.url).searchParams.get("slug");
    if (!slug) {
      return jsonResponse({ error: "Missing `slug` query parameter." }, 400);
    }

    const result = await runDelete(slug, opts);
    switch (result.kind) {
      case "slug_reserved":
        return jsonResponse(
          {
            error: `Slug "${result.slug}" is reserved by a static page and cannot be deleted via this API.`,
            slug: result.slug,
          },
          409
        );
      case "not_found":
        return jsonResponse({ error: "Resource not found." }, 404);
      case "store_failed":
        console.error("auto-geo: store.delete threw:", result.error);
        return jsonResponse({ error: "Failed to delete resource." }, 502);
      case "ok":
        await runOnSuccess(opts, { kind: "delete", slug: result.slug });
        return jsonResponse({ success: true, slug: result.slug }, 200);
      default: {
        const _exhaustive: never = result;
        return _exhaustive;
      }
    }
  }

  return { publish, delete: del };
}

/**
 * One-liner fetch handler. Owns a single `basePath` and routes:
 *   - POST   {basePath}              → publish
 *   - DELETE {basePath}              → delete
 *   - everything else                → 404
 *
 * For composition with other routes, use `createCloudflareHandlers` and
 * call the returned functions from your own `fetch`.
 */
export function createCloudflareFetch(opts: CloudflareFetchOptions) {
  const handlers = createCloudflareHandlers(opts);
  const basePath = opts.basePath ?? "/api/resources/publish";

  return async function fetch(
    request: Request,
    env: CloudflareEnv
  ): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === basePath) {
      if (request.method === "POST") return handlers.publish(request, env);
      if (request.method === "DELETE") return handlers.delete(request, env);
      return new Response("Method not allowed", {
        status: 405,
        headers: { allow: "POST, DELETE" },
      });
    }
    return new Response("Not found", { status: 404 });
  };
}
