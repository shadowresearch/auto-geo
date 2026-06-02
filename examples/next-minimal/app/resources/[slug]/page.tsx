import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ResourceArticle } from "auto-geo/react";
import {
  deriveArticle,
  deriveBreadcrumb,
  deriveFaqPage,
  deriveImageObjects,
  safeJsonLd,
} from "auto-geo/jsonld";
import { store, site } from "@/lib/auto-geo";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export const revalidate = 300;
export const dynamicParams = true;

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const resource = await store.get(slug);
  if (!resource) return {};

  const canonical = `${site.origin}${site.basePath ?? "/resources"}/${resource.slug}`;
  const ogImage = resource.ogImage;

  return {
    title: `${resource.metaTitle ?? resource.title} | ${site.publisher.name}`,
    description: resource.metaDescription,
    keywords: resource.keywords,
    alternates: { canonical },
    authors: [{ name: resource.author.name }],
    openGraph: {
      type: "article",
      siteName: site.publisher.name,
      title: resource.title,
      description: resource.metaDescription,
      url: canonical,
      ...(ogImage
        ? { images: [{ url: ogImage, width: 1200, height: 630, alt: resource.title }] }
        : {}),
      authors: [resource.author.name],
      publishedTime: resource.publishedAt,
      modifiedTime: resource.modifiedAt ?? resource.publishedAt,
      section: resource.category,
      ...(resource.keywords ? { tags: resource.keywords } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: resource.title,
      description: resource.metaDescription,
      ...(ogImage ? { images: [ogImage] } : {}),
    },
  };
}

export default async function ResourceSlugPage({ params }: PageProps) {
  const { slug } = await params;
  const resource = await store.get(slug);
  if (!resource) notFound();

  const breadcrumb = deriveBreadcrumb(resource, site);
  const article = deriveArticle(resource, site);
  const faq = deriveFaqPage(resource);
  const images = deriveImageObjects(resource);

  return (
    <div className="flex flex-col bg-white">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(breadcrumb) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(article) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(faq) }}
      />
      {images?.map((img, i) => (
        <script
          key={`img-ld-${i}`}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: safeJsonLd(img) }}
        />
      ))}

      <div className="w-full max-w-3xl mx-auto px-4 pt-8">
        <nav className="flex items-center gap-2 text-xs font-mono text-gray-500 uppercase tracking-wider">
          <Link href="/resources" className="hover:text-gray-900 transition-colors">
            Resources
          </Link>
          <span className="text-gray-300">/</span>
          <span className="text-gray-900 truncate">{resource.category}</span>
        </nav>
        <h1 className="text-4xl font-semibold tracking-tight text-gray-900 mt-6 mb-2">
          {resource.title}
        </h1>
      </div>

      <ResourceArticle
        payload={resource}
        LinkComponent={Link}
        disclosureSuffix={
          <>
            Published by{" "}
            <Link href="/" className="text-blue-600 underline-offset-2 hover:underline">
              {site.publisher.name}
            </Link>
            .
          </>
        }
      />
    </div>
  );
}
