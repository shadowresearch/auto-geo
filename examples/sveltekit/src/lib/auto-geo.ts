import { createMemoryStore } from "auto-geo/storage/memory";
import type { SiteConfig, PublishOptions } from "auto-geo";
import { seedResource } from "./seed.js";

/**
 * Single shared store + site config. Import from any +server.ts handler.
 *
 * Replace `createMemoryStore` with `createKvStore` (`auto-geo/storage/kv`)
 * or `createSupabaseStore` (`auto-geo/storage/supabase`) for production.
 * The publish endpoint, list, and get all go through the ContentStore
 * interface — nothing else changes.
 */

const PORT = Number(process.env.PORT ?? 3003);

export const store = createMemoryStore({ seed: [seedResource] });

export const site: SiteConfig = {
  origin: process.env.SITE_ORIGIN ?? `http://localhost:${PORT}`,
  basePath: "/resources",
  publisher: {
    name: "Shadow",
    url: "https://www.shadow.inc",
    logo: "https://www.shadow.inc/logo2.svg",
  },
};

export const publishOpts: PublishOptions = { store, site };
