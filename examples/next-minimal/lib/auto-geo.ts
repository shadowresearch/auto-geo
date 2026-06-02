import { createMemoryStore } from "auto-geo/storage/memory";
import type { SiteConfig } from "auto-geo";
import { sampleResource } from "./sample-resource";

/**
 * Single shared store + site config. Import from any route or page.
 *
 * Swap `createMemoryStore` for `createKvStore` or `createSupabaseStore`
 * to move from local dev to production storage. Nothing else in the app
 * changes.
 */
export const store = createMemoryStore({ seed: [sampleResource] });

export const site: SiteConfig = {
  origin:
    process.env.NEXT_PUBLIC_SITE_ORIGIN ?? "http://localhost:3000",
  basePath: "/resources",
  publisher: {
    name: "Shadow",
    url: "https://www.shadow.inc",
    logo: "https://www.shadow.inc/logo2.svg",
  },
};
