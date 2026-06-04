import { json, error } from "@sveltejs/kit";
import { store } from "$lib/auto-geo.js";
import type { RequestHandler } from "./$types.js";

/**
 * Read-side helper: fetch a single stored resource as raw JSON. Useful
 * for verifying a publish round-trip without spinning up the React
 * renderer that ships in the next-minimal example.
 */
export const GET: RequestHandler = async ({ params }) => {
  const resource = await store.get(params.slug as string);
  if (!resource) throw error(404, "Not found.");
  return json(resource);
};
