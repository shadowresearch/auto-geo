import {
  resourcePublishSchema,
  type ResourcePublishPayload,
} from "./schema";
import { auditResource, type ResourceWarning } from "./validation";
import type { ContentStore } from "./store";

/**
 * Framework-agnostic publish pipeline. HTTP adapters (Next.js, Hono,
 * Express, etc.) parse incoming requests and call this function with
 * the parsed JSON body. The function is pure with respect to its inputs
 * (modulo the store side effect).
 *
 * The pipeline:
 *   1. Authenticate the caller (handled by the adapter; this layer
 *      assumes auth has passed).
 *   2. Validate the body against `resourcePublishSchema`. On failure,
 *      return `{ kind: "validation_failed", issues }`. Adapters map this
 *      to HTTP 400.
 *   3. Check the slug against the reserved-slug list (configurable;
 *      empty by default). On collision, return `{ kind: "slug_reserved" }`.
 *      Adapters map this to HTTP 409.
 *   4. Persist via `store.publish(payload)`. On thrown error, return
 *      `{ kind: "store_failed", error }`. Adapters map this to HTTP 502.
 *   5. Run soft validation (`auditResource`). Warnings are non-blocking.
 *   6. Return `{ kind: "ok", slug, url, warnings }`. Adapters map this
 *      to HTTP 200.
 *
 * The function does NOT call any framework-specific revalidation API.
 * Adapters are responsible for that (e.g., Next.js's `revalidatePath`).
 *
 * The `url` returned by step 6 is constructed from `siteConfig.origin`
 * + `siteConfig.basePath` + slug. Adapters MAY override the url before
 * returning it to the client (e.g., to strip the origin during dev).
 */

export type PublishResult =
  | {
      kind: "ok";
      slug: string;
      url: string;
      warnings: ResourceWarning[];
    }
  | {
      kind: "validation_failed";
      issues: { path: string; message: string }[];
    }
  | {
      kind: "slug_reserved";
      slug: string;
    }
  | {
      kind: "store_failed";
      error: Error;
    };

export type SiteConfig = {
  /** Origin (no trailing slash), e.g. "https://example.com". */
  origin: string;
  /** Base path for resource URLs. Default: "/resources". No trailing slash. */
  basePath?: string;
  /** Publisher identity for JSON-LD. */
  publisher: {
    name: string;
    url: string;
    logo: string;
  };
};

export type PublishOptions = {
  store: ContentStore;
  site: SiteConfig;
  /**
   * Slugs that are statically routed in the host app and MUST NOT be
   * overwritten via this endpoint. Defaults to empty.
   */
  reservedSlugs?: readonly string[];
};

export async function runPublish(
  body: unknown,
  opts: PublishOptions
): Promise<PublishResult> {
  const parsed = resourcePublishSchema.safeParse(body);
  if (!parsed.success) {
    return {
      kind: "validation_failed",
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    };
  }

  const payload: ResourcePublishPayload = parsed.data;

  if (opts.reservedSlugs?.includes(payload.slug)) {
    return { kind: "slug_reserved", slug: payload.slug };
  }

  const warnings = auditResource(payload);

  try {
    await opts.store.publish(payload);
  } catch (error) {
    return {
      kind: "store_failed",
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }

  const basePath = opts.site.basePath ?? "/resources";
  const url = `${opts.site.origin}${basePath}/${payload.slug}`;

  return {
    kind: "ok",
    slug: payload.slug,
    url,
    warnings,
  };
}

/**
 * Companion delete pipeline. Returns `{ kind: "ok" }` on success, or
 * one of the failure variants. Adapters map status codes the same way
 * as publish.
 */

export type DeleteResult =
  | { kind: "ok"; slug: string }
  | { kind: "slug_reserved"; slug: string }
  | { kind: "not_found"; slug: string }
  | { kind: "store_failed"; error: Error };

export async function runDelete(
  slug: string,
  opts: PublishOptions
): Promise<DeleteResult> {
  if (opts.reservedSlugs?.includes(slug)) {
    return { kind: "slug_reserved", slug };
  }
  const existing = await opts.store.get(slug);
  if (!existing) return { kind: "not_found", slug };
  try {
    await opts.store.delete(slug);
  } catch (error) {
    return {
      kind: "store_failed",
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
  return { kind: "ok", slug };
}
