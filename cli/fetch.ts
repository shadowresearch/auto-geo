import { parseHTML } from "linkedom";
import type { ParsedPage } from "./types";

/**
 * Fetch + parse a URL into a `ParsedPage`. Two responsibilities:
 *
 *   1. Issue the HTTP request (with a sane UA + redirect handling) and
 *      hand back the raw HTML.
 *   2. Walk the parsed DOM to extract the few signals the heuristics
 *      need — headings, JSON-LD, images, links, lead text — into a
 *      normalized object shape so the heuristic layer (`cli/checks.ts`)
 *      stays pure.
 *
 * Why linkedom: pure JS, MIT-licensed, no native deps, ships a real
 * `document` with `querySelectorAll` + `textContent` semantics. jsdom
 * would also work but pulls a much heavier surface (we don't need
 * script execution, layout, or window globals here).
 *
 * Nav / footer / aside stripping is best-effort heuristic: we drop
 * common landmark elements (`<nav>`, `<footer>`, `<aside>`, header
 * elements with `role="banner"`) before extracting body text. This
 * matches what AI engines see when extracting "main content" via the
 * same landmark signals.
 *
 * We use the global DOM types (the tsconfig pulls in `lib: ["DOM"]`)
 * because linkedom's elements are structurally compatible with them —
 * declaring a local interface fights TypeScript's nominal sense of
 * `Element` rather than helping.
 */

export type FetchPageOptions = {
  /** Override fetch impl for tests. Defaults to global fetch (Node ≥18). */
  fetch?: typeof globalThis.fetch;
  /** Override User-Agent. */
  userAgent?: string;
  /** Override the AbortSignal-driven timeout (ms). Default 15s. */
  timeoutMs?: number;
};

const DEFAULT_UA =
  "auto-geo-doctor/1.0 (+https://github.com/shadowresearch/auto-geo)";

const DEFAULT_TIMEOUT_MS = 15_000;

export async function fetchPage(
  url: string,
  options: FetchPageOptions = {}
): Promise<ParsedPage> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const ua = options.userAgent ?? DEFAULT_UA;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: { "user-agent": ua, accept: "text/html,*/*" },
      redirect: "follow",
      signal: controller.signal,
    });
  } catch (err) {
    throw decorateNetworkError(err, url, timeoutMs);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new Error(explainHttpStatus(response.status, response.statusText));
  }

  const html = await response.text();
  return parsePage(url, html);
}

/**
 * Translate raw HTTP status codes into actionable hints. The audience for
 * these errors is twofold: agents driving the CLI (e.g. `npx auto-geo
 * doctor` inside a Claude/Cursor sandbox) and humans on a terminal. Both
 * benefit from a one-line cause hypothesis over a raw status string —
 * agents act on actionable text, humans skip a Google round-trip.
 */
function explainHttpStatus(status: number, statusText: string): string {
  if (status === 401 || status === 403) {
    return `${status} ${statusText} — the page blocked the request (bot detection, WAF, or auth wall). Try a public URL or pass a browser-like User-Agent via the calling environment; sandboxed/egress-restricted runtimes will see this against any site that isn't allowlisted.`;
  }
  if (status === 404) {
    return `${status} ${statusText} — the URL doesn't exist on the target host. Check the slug/path and try again.`;
  }
  if (status === 429) {
    return `${status} ${statusText} — the host is rate-limiting the request. Wait and retry, or audit a different URL on the same host.`;
  }
  if (status >= 500) {
    return `${status} ${statusText} — the target server returned a server error. The page is likely down or misconfigured; retry later.`;
  }
  return `fetch failed: ${status} ${statusText}`;
}

/**
 * Translate fetch-time exceptions (DNS, refused, timeout, sandbox egress
 * block) into actionable hints. Same rationale as `explainHttpStatus` —
 * the consumer often needs to know the *category* of failure to react.
 */
function decorateNetworkError(
  err: unknown,
  url: string,
  timeoutMs: number
): Error {
  const e = err as { name?: string; code?: string; message?: string };
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  })();

  if (e?.name === "AbortError") {
    return new Error(
      `request timed out after ${Math.round(timeoutMs / 1000)}s while fetching ${host}. The host may be slow or blocking the request; retry, or raise the timeout.`
    );
  }
  if (e?.code === "ENOTFOUND" || /ENOTFOUND/i.test(e?.message ?? "")) {
    return new Error(
      `DNS lookup failed for ${host}. Check the URL spelling, or confirm the domain resolves from this network.`
    );
  }
  if (e?.code === "ECONNREFUSED" || /ECONNREFUSED/i.test(e?.message ?? "")) {
    return new Error(
      `connection refused by ${host}. The host isn't accepting connections on the requested port; the service may be down.`
    );
  }
  if (e?.code === "ETIMEDOUT" || /ETIMEDOUT/i.test(e?.message ?? "")) {
    return new Error(
      `connection to ${host} timed out at the TCP layer. The host is unreachable from this network (firewall, sandbox egress block, or genuinely down).`
    );
  }
  if (/fetch failed/i.test(e?.message ?? "")) {
    // Generic undici "TypeError: fetch failed" — happens in sandboxed
    // runtimes where outbound HTTPS to non-allowlisted domains is
    // proxy-blocked. Surface that hypothesis so the caller knows where
    // to look first.
    return new Error(
      `unable to reach ${host} (network error). If you're running in a sandboxed environment (Claude Code with a restricted egress proxy, CI without internet, a VPN-blocked host), the target domain may not be allowlisted. Try a known-public URL like https://www.npmjs.com first to isolate.`
    );
  }
  return new Error(e?.message ?? String(err));
}

/**
 * Parse a raw HTML string into a `ParsedPage`. Exposed separately from
 * `fetchPage` so tests (and downstream consumers) can drive the
 * heuristic pipeline from a fixture string without any network at all.
 */
export function parsePage(url: string, html: string): ParsedPage {
  // linkedom's parseHTML returns a window-like object; the `document`
  // it exposes is structurally a DOM Document for our read-only needs.
  // We cast to the global Document type so the rest of the function
  // can use familiar querySelector APIs without per-call assertions.
  const { document } = parseHTML(html) as unknown as { document: Document };

  // Read JSON-LD before we strip <script> nodes wholesale below.
  const jsonLd = extractJsonLd(document);

  const STRIP_SELECTORS = [
    "nav",
    "footer",
    "aside",
    "header",
    "[role='banner']",
    "[role='navigation']",
    "[role='contentinfo']",
    "[role='complementary']",
    "script",
    "style",
    "noscript",
    "template",
  ];
  for (const sel of STRIP_SELECTORS) {
    const nodes = document.querySelectorAll(sel);
    nodes.forEach((node) => node.parentNode?.removeChild(node));
  }

  const main = document.querySelector("main, article, [role='main']");
  const root: Element | null =
    main ?? document.body ?? document.documentElement;

  const text = normalizeText(root?.textContent ?? "");
  const wc = wordCountOf(text);

  const headings = collectHeadings(root);
  const leadText = collectLeadText(root);
  const firstParagraph = collectFirstParagraph(root);
  const images = collectImages(root);
  const links = collectLinks(root);

  return {
    url,
    text,
    wordCount: wc,
    leadText,
    firstParagraph,
    headings,
    jsonLd,
    images,
    links,
  };
}

// ── DOM walkers ────────────────────────────────────────────────────

function extractJsonLd(document: Document): unknown[] {
  const blocks: unknown[] = [];
  const nodes = document.querySelectorAll("script[type='application/ld+json']");
  nodes.forEach((node) => {
    const raw = node.textContent?.trim();
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      // A single LD block may itself be an array — flatten so callers
      // can iterate without per-block re-flattening.
      if (Array.isArray(parsed)) blocks.push(...parsed);
      else blocks.push(parsed);
    } catch {
      // Drop unparseable blocks — they don't help any heuristic.
    }
  });
  return blocks;
}

function collectHeadings(
  root: Element | null
): Array<{ level: 1 | 2 | 3; text: string }> {
  if (!root) return [];
  const out: Array<{ level: 1 | 2 | 3; text: string }> = [];
  for (const tag of ["h1", "h2", "h3"] as const) {
    const level = Number(tag[1]) as 1 | 2 | 3;
    const nodes = root.querySelectorAll(tag);
    nodes.forEach((node) => {
      const text = normalizeText(node.textContent ?? "");
      if (text) out.push({ level, text });
    });
  }
  return out;
}

function collectLeadText(root: Element | null): string {
  if (!root) return "";
  const parts: string[] = [];
  // Array.from(HTMLCollection) iteration is stable.
  for (const child of Array.from(root.children)) {
    const tag = child.tagName?.toLowerCase();
    if (tag === "h2") break;
    if (tag === "h1") continue;
    const t = normalizeText(child.textContent ?? "");
    if (t) parts.push(t);
  }
  return parts.join(" ").trim();
}

function collectFirstParagraph(root: Element | null): string {
  if (!root) return "";
  const p = root.querySelector("p");
  return normalizeText(p?.textContent ?? "");
}

function collectImages(
  root: Element | null
): Array<{ alt: string; src: string }> {
  if (!root) return [];
  const out: Array<{ alt: string; src: string }> = [];
  const nodes = root.querySelectorAll("img");
  nodes.forEach((node) => {
    out.push({
      alt: node.getAttribute("alt") ?? "",
      src: node.getAttribute("src") ?? "",
    });
  });
  return out;
}

function collectLinks(
  root: Element | null
): Array<{ href: string; text: string; inRelatedSection: boolean }> {
  if (!root) return [];
  const out: Array<{ href: string; text: string; inRelatedSection: boolean }> =
    [];

  // Identify a "related guides" / "related" container. We look for
  // heading text matching /related/i, then collect anchors in the
  // following siblings until the next heading of the same/higher level.
  const relatedAnchors = new Set<Element>();
  const headings = root.querySelectorAll("h1, h2, h3");
  headings.forEach((h) => {
    const ht = normalizeText(h.textContent ?? "");
    if (!/related/i.test(ht)) return;
    let next: Element | null = h.nextElementSibling;
    while (next) {
      const nt = next.tagName?.toLowerCase();
      if (nt === "h1" || nt === "h2" || nt === "h3") break;
      next.querySelectorAll("a").forEach((a) => relatedAnchors.add(a));
      next = next.nextElementSibling;
    }
  });

  const allAnchors = root.querySelectorAll("a");
  allAnchors.forEach((a) => {
    out.push({
      href: a.getAttribute("href") ?? "",
      text: normalizeText(a.textContent ?? ""),
      inRelatedSection: relatedAnchors.has(a),
    });
  });
  return out;
}

// ── Text helpers ───────────────────────────────────────────────────

function normalizeText(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function wordCountOf(s: string): number {
  const m = s.match(/\b[\w'-]+\b/g);
  return m ? m.length : 0;
}
