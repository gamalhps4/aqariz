/**
 * PropertyPro SaaS - A blog post's body, drawn
 *
 * The tree `parseMarkdown` makes, as React elements: React escapes every
 * string, and the only attributes that carry anything from the post are
 * `href` and `src`, which `markdown.ts` has already vetted. Nothing here
 * touches `dangerouslySetInnerHTML`.
 *
 * Styles live on the elements rather than in a stylesheet, so the console's
 * live preview and the public page draw a post identically. Spacing and
 * markers use logical properties (`ps-*`, `border-s-*`): on /ar/blog, whose
 * wrapper is `dir="rtl"`, bullets, numbers and the quote rule sit on the
 * right with no extra rules.
 *
 * No hooks and no client-only imports: the public pages render it on the
 * server, the console inside a client component.
 */

import type { ReactNode } from "react";
import {
  parseMarkdown,
  type BlockNode,
  type InlineNode,
  type ListItemNode,
} from "./markdown";

const LINK_CLASS =
  "font-medium text-blue-600 underline decoration-blue-600/30 underline-offset-4 transition [overflow-wrap:anywhere] hover:decoration-blue-600";

function renderInline(nodes: InlineNode[], key: string): ReactNode[] {
  return nodes.map((node, index) => {
    const id = `${key}.${index}`;
    switch (node.type) {
      case "text":
        return node.value;
      case "break":
        return <br key={id} />;
      case "strong":
        return (
          <strong key={id} className="font-semibold text-slate-900">
            {renderInline(node.children, id)}
          </strong>
        );
      case "em":
        return (
          <em key={id} className="italic">
            {renderInline(node.children, id)}
          </em>
        );
      case "link":
        // Out of the site: a new tab, without handing it this window
        // (`noopener`) or the page address (`noreferrer`).
        return node.external ? (
          <a
            key={id}
            href={node.href}
            target="_blank"
            rel="noopener noreferrer"
            className={LINK_CLASS}
          >
            {renderInline(node.children, id)}
          </a>
        ) : (
          <a key={id} href={node.href} className={LINK_CLASS}>
            {renderInline(node.children, id)}
          </a>
        );
      case "image":
        return (
          // Addresses come from the post and their size is unknown, so
          // next/image (fixed hosts, known dimensions) does not fit; the
          // address is vetted by safeImageUrl and the API's host check.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={id}
            src={node.src}
            alt={node.alt}
            loading="lazy"
            decoding="async"
            className="inline-block h-auto max-w-full rounded-lg align-middle"
          />
        );
      default:
        return null;
    }
  });
}

function renderItem(item: ListItemNode, key: string): ReactNode {
  return (
    <li key={key} className="ps-1.5 leading-[1.8]">
      {renderInline(item.children, key)}
      {item.blocks.length > 0 && renderBlocks(item.blocks, key, true)}
    </li>
  );
}

function renderBlocks(blocks: BlockNode[], key: string, nested = false): ReactNode[] {
  // The first block of the body, of a quote or of a list item sits flush with
  // what holds it; the rest are spaced.
  return blocks.map((block, index) => {
    const id = `${key}-${index}`;
    const gap = index === 0 ? (nested ? "mt-2" : "mt-0") : undefined;
    switch (block.type) {
      case "heading":
        return block.level === 2 ? (
          <h2
            key={id}
            className={`${gap ?? "mt-12"} text-2xl font-bold leading-snug tracking-[-0.01em] text-slate-900 text-balance sm:text-[28px]`}
          >
            {renderInline(block.children, id)}
          </h2>
        ) : (
          <h3
            key={id}
            className={`${gap ?? "mt-9"} text-xl font-semibold leading-snug text-slate-900 text-balance`}
          >
            {renderInline(block.children, id)}
          </h3>
        );
      case "paragraph":
        return (
          <p key={id} className={`${gap ?? "mt-5"} leading-[1.8]`}>
            {renderInline(block.children, id)}
          </p>
        );
      case "list": {
        const className = `${gap ?? "mt-5"} space-y-2 ps-6 marker:text-slate-400 ${
          block.ordered ? "list-decimal" : "list-disc"
        }`;
        const items = block.items.map((item, itemIndex) => renderItem(item, `${id}.${itemIndex}`));
        return block.ordered ? (
          <ol key={id} start={block.start !== 1 ? block.start : undefined} className={className}>
            {items}
          </ol>
        ) : (
          <ul key={id} className={className}>
            {items}
          </ul>
        );
      }
      case "quote":
        return (
          <blockquote
            key={id}
            className={`${gap ?? "mt-6"} rounded-e-xl border-s-4 border-blue-600/70 bg-slate-50 py-4 ps-5 pe-5 text-slate-700`}
          >
            {renderBlocks(block.children, id)}
          </blockquote>
        );
      case "figure":
        return (
          <figure key={id} className={gap ?? "mt-8"}>
            {/* eslint-disable-next-line @next/next/no-img-element -- see the inline image above */}
            <img
              src={block.src}
              alt={block.alt}
              loading="lazy"
              decoding="async"
              className="h-auto w-full rounded-2xl border border-slate-200 bg-slate-50"
            />
            {block.caption && (
              <figcaption className="mt-3 text-center text-sm text-slate-500">
                {block.caption}
              </figcaption>
            )}
          </figure>
        );
      case "rule":
        return <hr key={id} className={`${gap ?? "my-10"} border-slate-200`} />;
      default:
        return null;
    }
  });
}

/**
 * A post's body. `source` is the stored text; it is parsed here, so the
 * caller never handles anything but the text the operator wrote.
 */
export function BlogContent({
  source,
  className = "",
}: {
  source: string;
  className?: string;
}) {
  const blocks = parseMarkdown(source);
  return (
    <div className={`break-words text-[17px] text-slate-700 ${className}`.trim()}>
      {renderBlocks(blocks, "b")}
    </div>
  );
}
