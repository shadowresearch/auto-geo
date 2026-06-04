import { json, error } from "@sveltejs/kit";
import { runPublish, runDelete } from "auto-geo";
import { publishOpts } from "$lib/auto-geo.js";
import type { RequestHandler } from "./$types.js";

/**
 * SvelteKit endpoint for the auto-geo publish contract. No SvelteKit-
 * specific adapter ships with auto-geo, so we call runPublish and
 * runDelete from the package directly.
 *
 * - Auth: Bearer GEO_PUBLISH_TOKEN, read from env at request time.
 * - Hard validation errors → 400 with issues array.
 * - Reserved slug collision → 409.
 * - Store failure → 502.
 * - Success → 200 with slug, url, warnings.
 */

function authorize(request: Request): "ok" | "no-token" | "unauthorized" {
  const expected = process.env.GEO_PUBLISH_TOKEN;
  if (!expected) return "no-token";
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return "unauthorized";
  return header.slice("Bearer ".length).trim() === expected
    ? "ok"
    : "unauthorized";
}

export const POST: RequestHandler = async ({ request }) => {
  const auth = authorize(request);
  if (auth === "no-token") {
    console.error("auto-geo: GEO_PUBLISH_TOKEN is not configured.");
    throw error(500, "Server configuration error.");
  }
  if (auth === "unauthorized") throw error(401, "Unauthorized.");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw error(400, "Invalid JSON body.");
  }

  const result = await runPublish(body, publishOpts);
  switch (result.kind) {
    case "validation_failed":
      return json(
        { error: "Validation failed.", issues: result.issues },
        { status: 400 }
      );
    case "slug_reserved":
      return json(
        {
          error: `Slug "${result.slug}" is reserved by a static page and cannot be overwritten via this API.`,
        },
        { status: 409 }
      );
    case "store_failed":
      console.error("auto-geo: store.publish threw:", result.error);
      return json({ error: "Failed to publish resource." }, { status: 502 });
    case "ok":
      return json({
        success: true,
        slug: result.slug,
        url: result.url,
        warnings: result.warnings,
      });
  }
};

export const DELETE: RequestHandler = async ({ request, url }) => {
  const auth = authorize(request);
  if (auth === "no-token") throw error(500, "Server configuration error.");
  if (auth === "unauthorized") throw error(401, "Unauthorized.");

  const slug = url.searchParams.get("slug");
  if (!slug) throw error(400, "Missing `slug` query parameter.");

  const result = await runDelete(slug, publishOpts);
  switch (result.kind) {
    case "slug_reserved":
      return json(
        {
          error: `Slug "${result.slug}" is reserved by a static page and cannot be deleted via this API.`,
        },
        { status: 409 }
      );
    case "not_found":
      return json({ error: "Resource not found." }, { status: 404 });
    case "store_failed":
      console.error("auto-geo: store.delete threw:", result.error);
      return json({ error: "Failed to delete resource." }, { status: 502 });
    case "ok":
      return json({ success: true, slug: result.slug });
  }
};
