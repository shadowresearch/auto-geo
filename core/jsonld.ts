import type { ResourceContentBlock, ResourcePublishPayload } from "./schema";
import type { SiteConfig } from "./publish";

/**
 * Schema.org JSON-LD derivation for published resources. Auto-emits all
 * the schema types the GEO SOP §13 calls out: Article, BreadcrumbList,
 * FAQPage, Person (author), ImageObject (per image block), and the
 * Organization publisher. The agent never has to hand-craft JSON-LD —
 * the typed payload is enough.
 *
 * All JSON-LD MUST be serialized via `safeJsonLd` (defensive escapes
 * for `<`, `>`, `&`, U+2028, U+2029) to keep authored text from breaking
 * out of the `<script>` container.
 *
 * Site identity (origin, base path, publisher) is supplied via the
 * `SiteConfig` parameter so this module remains host-agnostic. The
 * derivation never reads environment variables or globals.
 */

function basePath(site: SiteConfig): string {
  return site.basePath ?? "/resources";
}

function resourceUrl(
  payload: ResourcePublishPayload,
  site: SiteConfig
): string {
  return `${site.origin}${basePath(site)}/${payload.slug}`;
}

function flatBlocks(payload: ResourcePublishPayload): ResourceContentBlock[] {
  return [
    ...payload.intro.blocks,
    ...payload.sections.flatMap((s) => s.blocks),
  ];
}

export function safeJsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

// ── Individual schema derivers ────────────────────────────────────

export function deriveBreadcrumb(
  payload: ResourcePublishPayload,
  site: SiteConfig
) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Home",
        item: `${site.origin}/`,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "Resources",
        item: `${site.origin}${basePath(site)}`,
      },
      {
        "@type": "ListItem",
        position: 3,
        name: payload.title,
        item: resourceUrl(payload, site),
      },
    ],
  };
}

export function deriveArticle(
  payload: ResourcePublishPayload,
  site: SiteConfig
) {
  const url = resourceUrl(payload, site);
  const article: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: payload.title,
    description: payload.metaDescription,
    url,
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    articleSection: payload.category,
    datePublished: payload.publishedAt,
    dateModified: payload.modifiedAt ?? payload.publishedAt,
    author: {
      "@type": "Person",
      name: payload.author.name,
      jobTitle: payload.author.jobTitle,
      description: payload.author.bio,
      ...(payload.author.linkedinUrl
        ? { sameAs: [payload.author.linkedinUrl] }
        : {}),
    },
    publisher: {
      "@type": "Organization",
      name: site.publisher.name,
      url: site.publisher.url,
      logo: { "@type": "ImageObject", url: site.publisher.logo },
    },
  };

  if (payload.keywords?.length) {
    article.keywords = payload.keywords.join(", ");
  }
  if (payload.about?.length) {
    article.about = payload.about.map((e) => ({
      "@type": "Thing",
      name: e.name,
      ...(e.url ? { url: e.url } : {}),
    }));
  }
  if (payload.mentions?.length) {
    article.mentions = payload.mentions.map((e) => ({
      "@type": "Thing",
      name: e.name,
      ...(e.url ? { url: e.url } : {}),
    }));
  }
  if (payload.citations?.length) {
    article.citation = payload.citations.map((c) => ({
      "@type": "CreativeWork",
      url: c.url,
      ...(c.title ? { name: c.title } : {}),
      ...(c.publisher
        ? { publisher: { "@type": "Organization", name: c.publisher } }
        : {}),
    }));
  }
  if (payload.ogImage) {
    article.image = payload.ogImage;
  }

  return article;
}

export function deriveFaqPage(payload: ResourcePublishPayload) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: payload.faq.items.map((q) => ({
      "@type": "Question",
      name: q.question,
      acceptedAnswer: { "@type": "Answer", text: q.answer },
    })),
  };
}

export function deriveImageObjects(payload: ResourcePublishPayload) {
  const images = flatBlocks(payload).filter(
    (b): b is Extract<ResourceContentBlock, { type: "image" }> =>
      b.type === "image"
  );
  if (images.length === 0) return null;
  return images.map((img) => ({
    "@context": "https://schema.org",
    "@type": "ImageObject",
    contentUrl: img.src,
    name: img.alt,
    description: img.caption ?? img.alt,
  }));
}

// ── Aggregate ──────────────────────────────────────────────────────

export type ResourceJsonLdBundle = {
  article: ReturnType<typeof deriveArticle>;
  breadcrumb: ReturnType<typeof deriveBreadcrumb>;
  faq: ReturnType<typeof deriveFaqPage>;
  images: ReturnType<typeof deriveImageObjects>;
};

export function deriveAllJsonLd(
  payload: ResourcePublishPayload,
  site: SiteConfig
): ResourceJsonLdBundle {
  return {
    article: deriveArticle(payload, site),
    breadcrumb: deriveBreadcrumb(payload, site),
    faq: deriveFaqPage(payload),
    images: deriveImageObjects(payload),
  };
}
