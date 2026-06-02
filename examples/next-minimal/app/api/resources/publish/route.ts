import { createNextHandlers } from "auto-geo/next";
import { store, site } from "@/lib/auto-geo";

/**
 * Publish endpoint.
 *
 * Auth: Bearer GEO_PUBLISH_TOKEN (env). The handler reads the token at
 * request time so rotating the secret takes effect on the next request.
 *
 * Validation: handled by `runPublish` from auto-geo/core, which is wired
 * inside `createNextHandlers`. Hard errors return 400 with an issues
 * array; soft warnings come back inside the 200 body.
 *
 * Revalidation: `createNextHandlers` calls `revalidatePath('/resources')`
 * and `revalidatePath('/resources/<slug>')` on a successful publish or
 * delete, so the index and slug page appear immediately.
 */

const handlers = createNextHandlers({
  store,
  site,
  // reservedSlugs: STATIC_SLUGS,  // optional: protect statically routed pages
});

export const POST = handlers.POST;
export const DELETE = handlers.DELETE;
