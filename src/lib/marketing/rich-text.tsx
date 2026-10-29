/**
 * PropertyPro SaaS - Marketing copy emphasis
 *
 * The landing headlines mix weights inside a single sentence — "**Everything**
 * You Need. Nothing **You Don't.**", "Now **Relax** and let". Splitting those
 * into three or four separate console fields per headline made the editor
 * unusable, so the CMS stores them as one string and marks the bold runs with
 * `**…**`; a blank line or `\n` starts a new line.
 *
 * This is deliberately *not* markdown: only `**bold**` and hard line breaks are
 * recognised, everything else is literal text. Nothing is parsed as HTML, so
 * console copy can never inject markup into the public page.
 */

import { Fragment, type ReactNode } from "react";

/** Split on `**…**`, keeping the delimiters' contents. */
const BOLD = /\*\*([\s\S]+?)\*\*/g;

function renderLine(line: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  BOLD.lastIndex = 0;
  while ((match = BOLD.exec(line)) !== null) {
    if (match.index > cursor) {
      nodes.push(line.slice(cursor, match.index));
    }
    nodes.push(
      <span key={`${keyPrefix}-b${match.index}`} className="font-bold">
        {match[1]}
      </span>,
    );
    cursor = match.index + match[0].length;
  }
  if (cursor < line.length) nodes.push(line.slice(cursor));
  return nodes;
}

/**
 * Render CMS copy, honouring `**bold**` runs and line breaks. Everything that
 * is *not* wrapped inherits the surrounding element's weight, so a heading set
 * in `font-light` reads light with bold accents and a body element set normal
 * reads normal with bold accents — the same string works in both.
 */
export function Emphasis({ text }: { text: string }): ReactNode {
  if (!text) return null;
  const lines = text.split("\n");
  return lines.map((line, index) => (
    <Fragment key={index}>
      {index > 0 && <br />}
      {renderLine(line, `l${index}`)}
    </Fragment>
  ));
}

/** Plain-text form of the same string — for `alt`, `title` and metadata. */
export function stripEmphasis(text: string): string {
  return text.replace(BOLD, "$1").replace(/\n/g, " ").trim();
}
