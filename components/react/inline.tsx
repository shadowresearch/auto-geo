import type { ComponentType, ReactNode } from "react";

/**
 * Inline text renderer for resource content. Parses three — and only
 * three — forms of inline syntax out of plain strings:
 *
 *   - `**bold**`     → <strong>
 *   - `*italic*`     → <em>
 *   - `[text](url)`  → <a> (external) or the user-supplied <Link>
 *                       component (internal, when url starts with "/")
 *
 * Anything else renders literally. No raw HTML, no code, no headings,
 * no blockquotes — those are first-class block types in `schema.ts` so
 * structure is validated explicitly rather than parsed out of prose.
 *
 * The parser walks the string once, consuming tokens left-to-right.
 * Nested formatting (e.g. **bold *italic***) is supported because each
 * delimiter type recursively renders its inner content through the same
 * parser. Unterminated markers fall back to literal text — we never
 * want a typo to throw at render time on a production page.
 *
 * `LinkComponent` (default: undefined → plain `<a>`) lets host apps
 * inject framework-native routers (e.g., Next.js `next/link`,
 * `react-router` `Link`). The component must accept `href` and
 * `children`.
 */

export type InlineLinkProps = {
  href: string;
  children: ReactNode;
  className?: string;
};

export type InlineOptions = {
  /**
   * Component to render internal links (href starting with `/`). When
   * omitted, all links render as `<a>`. Pass `next/link`'s default
   * export or a `react-router` `Link` to enable client-side navigation.
   */
  LinkComponent?: ComponentType<InlineLinkProps>;
  /** Tailwind/CSS class applied to every link. */
  linkClassName?: string;
};

const TOKENS = [
  {
    open: "**",
    close: "**",
    render: (kids: ReactNode) => <strong>{kids}</strong>,
  },
  { open: "*", close: "*", render: (kids: ReactNode) => <em>{kids}</em> },
] as const;

function isInternalUrl(url: string): boolean {
  return url.startsWith("/") && !url.startsWith("//");
}

function renderLink(
  label: string,
  url: string,
  keyIdx: number,
  options: InlineOptions
): ReactNode {
  const linkClass =
    options.linkClassName ?? "text-blue-600 underline-offset-2 hover:underline";
  const internal = isInternalUrl(url);

  if (internal && options.LinkComponent) {
    const L = options.LinkComponent;
    return (
      <L key={`l${keyIdx}`} href={url} className={linkClass}>
        {renderInline(label, options, keyIdx * 1000)}
      </L>
    );
  }
  return (
    <a
      key={`a${keyIdx}`}
      href={url}
      {...(internal ? {} : { target: "_blank", rel: "noopener noreferrer" })}
      className={linkClass}
    >
      {renderInline(label, options, keyIdx * 1000)}
    </a>
  );
}

export function renderInline(
  text: string,
  options: InlineOptions = {},
  seedKey = 0
): ReactNode[] {
  const out: ReactNode[] = [];
  let i = 0;
  let buf = "";
  let keyIdx = seedKey;

  function flushBuf() {
    if (buf.length > 0) {
      out.push(buf);
      buf = "";
    }
  }

  while (i < text.length) {
    if (text[i] === "[") {
      const closeBracket = text.indexOf("]", i + 1);
      if (closeBracket !== -1 && text[closeBracket + 1] === "(") {
        const closeParen = text.indexOf(")", closeBracket + 2);
        if (closeParen !== -1) {
          const label = text.slice(i + 1, closeBracket);
          const url = text.slice(closeBracket + 2, closeParen);
          flushBuf();
          out.push(renderLink(label, url, keyIdx++, options));
          i = closeParen + 1;
          continue;
        }
      }
    }

    let matched = false;
    for (const tok of TOKENS) {
      if (text.startsWith(tok.open, i)) {
        const closeIdx = text.indexOf(tok.close, i + tok.open.length);
        // Require a non-empty inner span. This also prevents the single-`*`
        // token from chewing the second asterisk of an unterminated `**`,
        // which would otherwise render as an empty <em> and swallow the
        // markers entirely.
        if (closeIdx > i + tok.open.length) {
          const inner = text.slice(i + tok.open.length, closeIdx);
          flushBuf();
          const innerNodes = renderInline(inner, options, keyIdx * 7);
          out.push(
            <span key={`t${keyIdx++}`}>{tok.render(<>{innerNodes}</>)}</span>
          );
          i = closeIdx + tok.close.length;
          matched = true;
          break;
        }
      }
    }
    if (matched) continue;

    buf += text[i];
    i++;
  }

  flushBuf();
  return out;
}
