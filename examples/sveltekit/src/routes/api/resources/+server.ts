import { json } from "@sveltejs/kit";
import { store, site } from "$lib/auto-geo.js";
import type { RequestHandler } from "./$types.js";

/**
 * Read-side helper: list every stored resource. Endpoint-only examples
 * use this to confirm a publish round-tripped without needing a render
 * page. Production apps would render the index via +page.svelte.
 */
export const GET: RequestHandler = async () => {
  const items = await store.list();
  return json({
    count: items.length,
    items: items.map((r) => ({
      slug: r.slug,
      title: r.title,
      category: r.category,
      publishedAt: r.publishedAt,
      url: `${site.origin}${site.basePath}/${r.slug}`,
    })),
  });
};
