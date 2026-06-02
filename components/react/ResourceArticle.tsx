import type { ComponentType, ReactNode } from "react";
import { renderInline, type InlineLinkProps } from "./inline";
import type {
  ResourceAuthor,
  ResourceContentBlock,
  ResourceContentSection,
  ResourceFaqItem,
  ResourcePublishPayload,
} from "../../core/schema";

/**
 * `ResourceArticle` — the reference renderer.
 *
 * Renders a validated `ResourcePublishPayload` into the page architecture
 * mandated by the GEO SOP. The renderer is the dual of `core/schema.ts`:
 * the schema enforces the structure at the publish boundary; this file
 * trusts that structure and walks it.
 *
 * Page architecture, in order (SOP §5j):
 *   1. "Last updated" metadata
 *   2. TL;DR callout
 *   3. Intro blocks
 *   4. Sections (H2 + answer capsule + child blocks)
 *   5. Related Guides
 *   6. Key Takeaways
 *   7. FAQ
 *   8. About the Author (auto-injected from author.bio)
 *   9. Disclosure
 *
 * Styling uses neutral Tailwind utility classes — `text-gray-900`,
 * `text-gray-500`, `border-gray-200`, `text-blue-600`. Override via the
 * `classNames` prop or fork the component for full design control.
 *
 * `LinkComponent` (e.g. `next/link`'s default export) is forwarded to
 * the inline parser for internal-link client-side navigation.
 */

// ─────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────

export type ResourceArticleClassNames = {
  /** Wrapper around the whole article body. */
  root?: string;
  /** "Last updated …" line above the TL;DR. */
  meta?: string;
  /** H1 (if `showTitle` is true). */
  h1?: string;
  /** H2 (section headings). */
  h2?: string;
  /** H3 (sub-section headings). */
  h3?: string;
  /** Default paragraph. */
  paragraph?: string;
  /** TL;DR callout wrapper. */
  tldr?: string;
  /** Info callout. */
  calloutInfo?: string;
  /** Stat callout. */
  calloutStat?: string;
  /** Bulleted list `<ul>`. */
  bulletList?: string;
  /** Numbered list `<ol>`. */
  numberList?: string;
  /** Quote block. */
  quote?: string;
  /** Image figure. */
  figure?: string;
  /** Image caption. */
  caption?: string;
  /** Table wrapper. */
  tableWrap?: string;
  /** Table. */
  table?: string;
  /** Inline link. */
  link?: string;
  /** About-the-author block. */
  authorBlock?: string;
  /** Disclosure block. */
  disclosure?: string;
};

const DEFAULTS: Required<ResourceArticleClassNames> = {
  root: "max-w-2xl mx-auto px-4 py-8 text-gray-900",
  meta: "text-xs font-mono uppercase tracking-wider text-gray-500 -mt-2 mb-4",
  h1: "text-4xl font-semibold tracking-tight text-gray-900 mb-4",
  h2: "text-2xl font-semibold tracking-tight text-gray-900 mt-12 mb-3",
  h3: "text-lg font-semibold text-gray-900 mt-6 mb-2",
  paragraph: "text-base leading-relaxed text-gray-900 my-4",
  tldr: "my-8 border border-gray-200 bg-gray-50 px-6 py-5 rounded-md",
  calloutInfo:
    "my-6 border-l-2 border-gray-300 bg-gray-50 px-5 py-4 text-base text-gray-900",
  calloutStat:
    "my-6 border-l-2 border-blue-500 bg-blue-50 px-5 py-4 text-base text-gray-900",
  bulletList: "list-disc pl-6 space-y-2 my-4",
  numberList: "list-decimal pl-6 space-y-2 my-4",
  quote: "my-6 border-l-2 border-gray-300 pl-5 py-1 italic text-gray-700",
  figure: "my-8",
  caption: "mt-3 text-xs font-mono uppercase tracking-wider text-gray-500",
  tableWrap: "overflow-x-auto my-6",
  table: "w-full text-sm border-collapse",
  link: "text-blue-600 underline-offset-2 hover:underline",
  authorBlock: "mt-12 border-t border-gray-200 pt-8",
  disclosure: "text-sm text-gray-500 mt-12",
};

export type ResourceArticleProps = {
  payload: ResourcePublishPayload;
  /** Pass `next/link`'s default export to enable client-side internal links. */
  LinkComponent?: ComponentType<InlineLinkProps>;
  /** Show the H1 title above the metadata line. Default: false (assumes host renders it). */
  showTitle?: boolean;
  /** Override individual element class names. Defaults to neutral Tailwind. */
  classNames?: ResourceArticleClassNames;
  /**
   * Custom rendering for the disclosure trailer (publisher line). Defaults
   * to the "Built with auto-geo by Shadow" credit. Pass `null` to
   * suppress, or override with your own JSX, e.g.
   * `<>Published by <a href="/">{publisher.name}</a>.</>`.
   */
  disclosureSuffix?: ReactNode;
};

/**
 * Default disclosure trailer credits Shadow and links back to the
 * project. Override via the `disclosureSuffix` prop; pass `null` to
 * suppress entirely.
 *
 * The credit is part of the OSS contract — see the project README. It
 * lifts no behavior; it is purely a small attribution signal that helps
 * the project remain discoverable. You can replace it freely under the
 * MIT license.
 */
const DEFAULT_DISCLOSURE_SUFFIX: ReactNode = (
  <>
    Built with{" "}
    <a
      href="https://github.com/shadowresearch/auto-geo"
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-600 underline-offset-2 hover:underline"
    >
      auto-geo
    </a>{" "}
    by{" "}
    <a
      href="https://www.shadow.inc"
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-600 underline-offset-2 hover:underline"
    >
      Shadow
    </a>
    .
  </>
);

// ─────────────────────────────────────────────────────────────────
// Block-level renderers
// ─────────────────────────────────────────────────────────────────

type RenderCtx = {
  cls: Required<ResourceArticleClassNames>;
  inline: { LinkComponent?: ComponentType<InlineLinkProps>; linkClassName: string };
};

function ParagraphBlock({ text, ctx }: { text: string; ctx: RenderCtx }) {
  return <p className={ctx.cls.paragraph}>{renderInline(text, ctx.inline)}</p>;
}

function H3Block({ text, ctx }: { text: string; ctx: RenderCtx }) {
  return <h3 className={ctx.cls.h3}>{renderInline(text, ctx.inline)}</h3>;
}

function ListBlock({
  style,
  items,
  ctx,
}: {
  style: "bullet" | "number";
  items: string[];
  ctx: RenderCtx;
}) {
  const Tag = style === "number" ? "ol" : "ul";
  const listClass = style === "number" ? ctx.cls.numberList : ctx.cls.bulletList;
  return (
    <Tag className={listClass}>
      {items.map((item, i) => (
        <li key={i}>{renderInline(item, ctx.inline)}</li>
      ))}
    </Tag>
  );
}

function TableBlock({
  caption,
  headers,
  rows,
  ctx,
}: {
  caption?: string;
  headers: string[];
  rows: string[][];
  ctx: RenderCtx;
}) {
  return (
    <div className={ctx.cls.tableWrap}>
      <table className={ctx.cls.table}>
        {caption ? (
          <caption className={`${ctx.cls.caption} text-left pb-3`}>
            {caption}
          </caption>
        ) : null}
        <thead>
          <tr className="border-b border-gray-200">
            {headers.map((h, i) => (
              <th key={i} className="text-left py-3 pr-4 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-gray-200">
              {row.map((cell, j) => (
                <td key={j} className="py-3 pr-4 align-top">
                  {renderInline(cell, ctx.inline)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function QuoteBlock({
  text,
  attribution,
  ctx,
}: {
  text: string;
  attribution: string;
  ctx: RenderCtx;
}) {
  return (
    <blockquote className={ctx.cls.quote}>
      <span className="block">{renderInline(text, ctx.inline)}</span>
      <cite className="mt-3 block not-italic text-xs font-mono uppercase tracking-wider text-gray-500">
        — {attribution}
      </cite>
    </blockquote>
  );
}

function ImageBlock({
  src,
  alt,
  caption,
  ctx,
}: {
  src: string;
  alt: string;
  caption?: string;
  ctx: RenderCtx;
}) {
  return (
    <figure className={ctx.cls.figure}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        className="w-full rounded-md border border-gray-200"
      />
      {caption ? (
        <figcaption className={ctx.cls.caption}>{caption}</figcaption>
      ) : null}
    </figure>
  );
}

function CalloutBlock({
  variant,
  text,
  ctx,
}: {
  variant: "info" | "stat";
  text: string;
  ctx: RenderCtx;
}) {
  const cls = variant === "stat" ? ctx.cls.calloutStat : ctx.cls.calloutInfo;
  return <div className={cls}>{renderInline(text, ctx.inline)}</div>;
}

function ContentBlockRenderer({
  block,
  ctx,
}: {
  block: ResourceContentBlock;
  ctx: RenderCtx;
}) {
  switch (block.type) {
    case "paragraph":
      return <ParagraphBlock text={block.text} ctx={ctx} />;
    case "h3":
      return <H3Block text={block.text} ctx={ctx} />;
    case "list":
      return <ListBlock style={block.style} items={block.items} ctx={ctx} />;
    case "table":
      return (
        <TableBlock
          caption={block.caption}
          headers={block.headers}
          rows={block.rows}
          ctx={ctx}
        />
      );
    case "quote":
      return <QuoteBlock text={block.text} attribution={block.attribution} ctx={ctx} />;
    case "image":
      return (
        <ImageBlock src={block.src} alt={block.alt} caption={block.caption} ctx={ctx} />
      );
    case "callout":
      return <CalloutBlock variant={block.variant} text={block.text} ctx={ctx} />;
  }
}

function BlockList({
  blocks,
  ctx,
}: {
  blocks: ResourceContentBlock[];
  ctx: RenderCtx;
}) {
  return (
    <>
      {blocks.map((block, i) => (
        <ContentBlockRenderer key={i} block={block} ctx={ctx} />
      ))}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────
// Page-architecture renderers
// ─────────────────────────────────────────────────────────────────

function TldrBlock({ text, ctx }: { text: string; ctx: RenderCtx }) {
  return (
    <div className={ctx.cls.tldr}>
      <p className="text-xs font-mono uppercase tracking-wider text-gray-500 mb-2">
        TL;DR
      </p>
      <p className="text-base text-gray-900 leading-relaxed">
        {renderInline(text, ctx.inline)}
      </p>
    </div>
  );
}

function SectionBlock({
  section,
  ctx,
}: {
  section: ResourceContentSection;
  ctx: RenderCtx;
}) {
  return (
    <section>
      <h2 className={ctx.cls.h2}>{renderInline(section.heading, ctx.inline)}</h2>
      <p className={ctx.cls.paragraph}>
        {renderInline(section.answerCapsule, ctx.inline)}
      </p>
      <BlockList blocks={section.blocks} ctx={ctx} />
    </section>
  );
}

function RelatedGuides({
  items,
  ctx,
}: {
  items: { title: string; url: string }[];
  ctx: RenderCtx;
}) {
  return (
    <section>
      <h2 className={ctx.cls.h2}>Related Guides</h2>
      <ul className={ctx.cls.bulletList}>
        {items.map((g, i) => (
          <li key={i}>
            <a href={g.url} className={ctx.cls.link}>
              {g.title}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

function KeyTakeaways({ items, ctx }: { items: string[]; ctx: RenderCtx }) {
  return (
    <section>
      <h2 className={ctx.cls.h2}>Key Takeaways</h2>
      <ul className={ctx.cls.bulletList}>
        {items.map((it, i) => (
          <li key={i}>{renderInline(it, ctx.inline)}</li>
        ))}
      </ul>
    </section>
  );
}

function Faq({
  heading,
  items,
  ctx,
}: {
  heading?: string;
  items: ResourceFaqItem[];
  ctx: RenderCtx;
}) {
  return (
    <section>
      <h2 className={ctx.cls.h2}>{heading ?? "Frequently Asked Questions"}</h2>
      {items.map((item, i) => (
        <div key={i}>
          <h3 className={ctx.cls.h3}>{item.question}</h3>
          <p className={ctx.cls.paragraph}>{renderInline(item.answer, ctx.inline)}</p>
        </div>
      ))}
    </section>
  );
}

function AboutTheAuthor({
  author,
  ctx,
}: {
  author: ResourceAuthor;
  ctx: RenderCtx;
}) {
  return (
    <section className={ctx.cls.authorBlock}>
      <p className="text-xs font-mono uppercase tracking-wider text-gray-500 mb-3">
        About the Author
      </p>
      <p className="text-base text-gray-900">
        <strong>{author.name}</strong>
        {author.jobTitle ? ` · ${author.jobTitle}` : null}
      </p>
      <p className="mt-2 text-sm text-gray-600 leading-relaxed">{author.bio}</p>
      {author.linkedinUrl ? (
        <p className="mt-3 text-sm">
          <a
            href={author.linkedinUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={ctx.cls.link}
          >
            LinkedIn ↗
          </a>
        </p>
      ) : null}
    </section>
  );
}

function Disclosure({
  text,
  suffix,
  ctx,
}: {
  text: string;
  suffix: ReactNode;
  ctx: RenderCtx;
}) {
  return (
    <p className={ctx.cls.disclosure}>
      {renderInline(text, ctx.inline)} {suffix}
    </p>
  );
}

// ─────────────────────────────────────────────────────────────────
// Top-level renderer
// ─────────────────────────────────────────────────────────────────

function formatLastUpdated(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function ResourceArticle({
  payload,
  LinkComponent,
  showTitle = false,
  classNames,
  disclosureSuffix = DEFAULT_DISCLOSURE_SUFFIX,
}: ResourceArticleProps): ReactNode {
  const cls: Required<ResourceArticleClassNames> = {
    ...DEFAULTS,
    ...(classNames ?? {}),
  };
  const ctx: RenderCtx = {
    cls,
    inline: { LinkComponent, linkClassName: cls.link },
  };

  const lastUpdated = formatLastUpdated(
    payload.modifiedAt ?? payload.publishedAt
  );

  return (
    <article className={cls.root}>
      {showTitle ? <h1 className={cls.h1}>{payload.title}</h1> : null}

      <p className={cls.meta}>
        Last updated: {lastUpdated} · By {payload.author.name},{" "}
        {payload.author.jobTitle}
      </p>

      <TldrBlock text={payload.tldr.text} ctx={ctx} />

      <BlockList blocks={payload.intro.blocks} ctx={ctx} />

      {payload.sections.map((section, i) => (
        <SectionBlock key={i} section={section} ctx={ctx} />
      ))}

      <RelatedGuides items={payload.relatedGuides.items} ctx={ctx} />
      <KeyTakeaways items={payload.keyTakeaways.items} ctx={ctx} />
      <Faq heading={payload.faq.heading} items={payload.faq.items} ctx={ctx} />
      <AboutTheAuthor author={payload.author} ctx={ctx} />
      <Disclosure text={payload.disclosure.text} suffix={disclosureSuffix} ctx={ctx} />
    </article>
  );
}
