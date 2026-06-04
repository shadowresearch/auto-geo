import { parseHTML } from "linkedom";

/**
 * Minimal XML sitemap parser. Supports two shapes:
 *
 *   - `<urlset><url><loc>…</loc></url>…</urlset>` (standard sitemap)
 *   - `<sitemapindex><sitemap><loc>…</loc></sitemap>…</sitemapindex>`
 *     (index sitemap; recursively fetched and flattened to a URL list)
 *
 * Why linkedom for XML: we already depend on it for HTML and its
 * `parseHTML` accepts XML well enough for `<loc>` extraction. Avoids
 * pulling a second XML parser dep.
 *
 * Index recursion is depth-limited (default 2) to avoid pathological
 * sitemaps that nest unbounded levels.
 */

export type FetchSitemapOptions = {
  fetch?: typeof globalThis.fetch;
  /** Max recursion depth into sitemap indexes. Default 2. */
  maxDepth?: number;
  /** Hard cap on URLs returned. Default 500. Prevents runaway audits. */
  maxUrls?: number;
};

export async function fetchSitemap(
  sitemapUrl: string,
  options: FetchSitemapOptions = {}
): Promise<string[]> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const maxDepth = options.maxDepth ?? 2;
  const maxUrls = options.maxUrls ?? 500;

  const visited = new Set<string>();
  const urls: string[] = [];

  async function visit(url: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    if (visited.has(url)) return;
    visited.add(url);
    if (urls.length >= maxUrls) return;

    const res = await fetchImpl(url, {
      headers: { accept: "application/xml,text/xml,*/*" },
      redirect: "follow",
    });
    if (!res.ok) {
      throw new Error(
        `sitemap fetch failed (${url}): ${res.status} ${res.statusText}`
      );
    }
    const xml = await res.text();
    const { children, isIndex } = parseSitemapXml(xml);
    if (isIndex) {
      for (const child of children) {
        if (urls.length >= maxUrls) break;
        await visit(child, depth + 1);
      }
    } else {
      for (const loc of children) {
        if (urls.length >= maxUrls) break;
        urls.push(loc);
      }
    }
  }

  await visit(sitemapUrl, 0);
  return urls;
}

export function parseSitemapXml(xml: string): {
  children: string[];
  isIndex: boolean;
} {
  // linkedom's parseHTML is lenient enough to parse XML for our purposes.
  // We only need <loc> contents; we don't care about declarations or DTD.
  const { document } = parseHTML(xml);

  // sitemapindex detection
  const isIndex = !!document.querySelector("sitemapindex");
  const locs = document.querySelectorAll("loc");
  const children: string[] = [];
  for (const node of locs) {
    const text = (node.textContent ?? "").trim();
    if (text) children.push(text);
  }
  return { children, isIndex };
}
