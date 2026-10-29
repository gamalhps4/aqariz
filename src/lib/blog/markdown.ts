/**
 * PropertyPro SaaS - The blog's Markdown subset
 *
 * Posts are written in the console as plain text with a few Markdown marks,
 * and this turns that text into a small tree the renderer
 * (`markdown-render.tsx`) draws as React elements. What it understands:
 *
 *   ## Heading, ### Smaller heading   (a single # is read as ##: the post's
 *                                       title is the page's only <h1>)
 *   **bold**, __bold__, *italic*, _italic_
 *   [text](https://… or /path or #anchor)
 *   ![description](https://… or /path "optional caption")
 *   - bullets (or * / +), 1. numbered items, nested by indenting
 *   > quotes (which may hold lists and paragraphs)
 *   --- a dividing line
 *
 * A blank line starts a new paragraph; a single line break stays a line
 * break, which is what someone typing into a text box expects. A backslash
 * makes the next mark literal (\*).
 *
 * What it never does is produce HTML. There is no raw-HTML pass: "<script>"
 * in a post is the text "<script>", escaped by React like any other text.
 * Every URL is checked here (`safeLinkUrl`, `safeImageUrl`); one that fails
 * becomes plain text. The tree holds only strings and the node kinds below,
 * so there is nothing a post can say that reaches an attribute other than a
 * vetted href or src.
 *
 * Hostile input is bounded too: nesting is capped, and the searches for a
 * closing mark remember where they have already failed, so a post of 100,000
 * asterisks or brackets parses in linear time.
 *
 * Pure: the public pages, the console's preview and the tests share it.
 */

// ---------------------------------------------------------------------------
// The tree
// ---------------------------------------------------------------------------

export type InlineNode =
  | { type: "text"; value: string }
  | { type: "break" }
  | { type: "strong"; children: InlineNode[] }
  | { type: "em"; children: InlineNode[] }
  | { type: "link"; href: string; external: boolean; children: InlineNode[] }
  | { type: "image"; src: string; alt: string };

export interface ListItemNode {
  /** The item's own text. */
  children: InlineNode[];
  /** What is indented under it: nested lists, further paragraphs. */
  blocks: BlockNode[];
}

export type BlockNode =
  | { type: "heading"; level: 2 | 3; children: InlineNode[] }
  | { type: "paragraph"; children: InlineNode[] }
  | { type: "list"; ordered: boolean; start: number; items: ListItemNode[] }
  | { type: "quote"; children: BlockNode[] }
  | { type: "figure"; src: string; alt: string; caption: string }
  | { type: "rule" };

/** Quotes and lists inside quotes and lists stop nesting at this depth; deeper
 * marks are read as text. */
const MAX_BLOCK_DEPTH = 4;
/** Bold inside italic inside a link… stops here; deeper marks are text. */
const MAX_INLINE_DEPTH = 6;
/** Longer addresses are refused rather than carried into an attribute. */
export const MAX_URL_LENGTH = 2048;
/** An image caption in `![alt](src "caption")` is at most this long. */
const MAX_TITLE_LENGTH = 500;
/** Nested parentheses an address may hold: "Riyadh_(city)" needs one. */
const MAX_URL_PARENS = 3;

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

/**
 * Control characters, whitespace and backslashes. Browsers drop tabs and line
 * breaks inside a URL and skip leading control characters, so "java\tscript:"
 * is javascript:, and "/\evil.example" is another site to some of them. None
 * of these belong in an address typed into a post, so any of them refuses it.
 */
const UNSAFE_URL_CHARACTERS =
  /[\u0000-\u0020\u007f-\u00a0\u1680\u2000-\u200f\u2028-\u202f\u205f-\u2060\u3000\ufeff\\]/;

/** "javascript:", "data:", "http:" — a scheme is letters first, then letters,
 * digits, "+", "-" or ".", then a colon. */
const SCHEME = /^([a-z][a-z0-9+.-]*):/i;

/**
 * A link target a post may carry, and whether it leaves the site:
 *
 *   - http:// and https:// addresses with a host — external;
 *   - anything without a scheme — a path on this site ("/pricing",
 *     "other-post", "?q=1") or an anchor ("#section") — internal.
 *
 * Every other scheme (javascript:, data:, vbscript:, mailto:, file:…),
 * protocol-relative "//host" and anything holding whitespace, control
 * characters or backslashes is refused: null.
 */
export function safeLinkUrl(
  raw: string,
): { href: string; external: boolean } | null {
  if (typeof raw !== "string") return null;
  const url = raw.trim();
  if (!url || url.length > MAX_URL_LENGTH) return null;
  if (UNSAFE_URL_CHARACTERS.test(url)) return null;
  if (url.startsWith("//")) return null;
  const scheme = SCHEME.exec(url);
  if (scheme) {
    const name = scheme[1].toLowerCase();
    if (name !== "http" && name !== "https") return null;
    if (!/^https?:\/\/[^/?#@:]+(?::\d+)?(?:[/?#]|$)/i.test(url)) return null;
    return { href: url, external: true };
  }
  return { href: url, external: false };
}

/**
 * An image address a post may carry: an https:// address with a host, or a
 * path on this site starting with "/". Plain http is refused (the site is
 * served over https and would block it as mixed content), as is every other
 * scheme — data: and javascript: included — and any relative path that does
 * not start at the site root, which would resolve differently on /blog and
 * /ar/blog.
 */
export function safeImageUrl(raw: string): string | null {
  if (typeof raw !== "string") return null;
  const url = raw.trim();
  if (!url || url.length > MAX_URL_LENGTH) return null;
  if (UNSAFE_URL_CHARACTERS.test(url)) return null;
  if (url.startsWith("/")) return url.startsWith("//") ? null : url;
  return /^https:\/\/[^/?#@:]+(?::\d+)?(?:[/?#]|$)/i.test(url) ? url : null;
}

// ---------------------------------------------------------------------------
// Inline marks
// ---------------------------------------------------------------------------

/** Characters a backslash makes literal. */
const ESCAPABLE = new Set([..."\\`*_{}[]()#+-.!>|~"]);

const WORD_CHARACTER = /[\p{L}\p{N}]/u;
const WHITESPACE = /\s/;

function isWordCharacter(character: string | undefined): boolean {
  return character !== undefined && WORD_CHARACTER.test(character);
}

function isWhitespace(character: string | undefined): boolean {
  return character === undefined || WHITESPACE.test(character);
}

/** Whether the character at `index` is escaped by an odd run of backslashes. */
function isEscaped(source: string, index: number): boolean {
  let slashes = 0;
  for (let i = index - 1; i >= 0 && source[i] === "\\"; i -= 1) slashes += 1;
  return slashes % 2 === 1;
}

interface InlineState {
  source: string;
  /**
   * Per closing mark and range end: the earliest position a search has
   * failed from. A search from any later position in the same range can only
   * fail too (it looks at a subset of the same candidates), so it is skipped.
   */
  failedFrom: Map<string, number>;
  /** The last "]" found per range end, and where that search started. */
  bracket: Map<number, { from: number; at: number }>;
}

/** Text with the escapes applied: "\*" → "*". */
function unescape(text: string): string {
  return text.replace(/\\(.)/g, (whole, character: string) =>
    ESCAPABLE.has(character) ? character : whole,
  );
}

/**
 * The index of the closing `mark` for content starting at `from`, within
 * [from + 1, end), or -1 — so there is always at least one character between
 * opener and closer. A closer is not escaped and does not follow whitespace.
 * A single `*`/`_` is not half of a double; an underscore closer is not
 * followed by a letter, so snake_case_words stay words.
 */
function findCloser(state: InlineState, mark: string, from: number, end: number): number {
  const memoKey = `${mark}:${end}`;
  const failed = state.failedFrom.get(memoKey);
  if (failed !== undefined && from >= failed) return -1;
  const { source } = state;
  const single = mark.length === 1;
  let index = source.indexOf(mark, from + 1);
  while (index !== -1 && index + mark.length <= end) {
    const ok =
      !isEscaped(source, index) &&
      !isWhitespace(source[index - 1]) &&
      (!single || (source[index - 1] !== mark && source[index + 1] !== mark)) &&
      (mark[0] !== "_" || !isWordCharacter(source[index + mark.length]));
    if (ok) return index;
    index = source.indexOf(mark, index + 1);
  }
  if (failed === undefined || from < failed) state.failedFrom.set(memoKey, from);
  return -1;
}

/** The index of the first unescaped "]" at or after `from` before `end`, or -1. */
function findBracketClose(state: InlineState, from: number, end: number): number {
  const cached = state.bracket.get(end);
  if (cached && from >= cached.from && (cached.at === -1 || from <= cached.at)) {
    return cached.at;
  }
  const { source } = state;
  let index = source.indexOf("]", from);
  while (index !== -1 && index < end && isEscaped(source, index)) {
    index = source.indexOf("]", index + 1);
  }
  const at = index !== -1 && index < end ? index : -1;
  state.bracket.set(end, { from, at });
  return at;
}

/**
 * `(destination "optional title")` starting at `open` (the "("), within
 * `end`. Destinations may hold one level of balanced parentheses —
 * Wikipedia's "Foo_(bar)" — but no whitespace.
 */
function readDestination(
  source: string,
  open: number,
  end: number,
): { url: string; title: string; next: number } | null {
  let index = open + 1;
  while (index < end && (source[index] === " " || source[index] === "\t")) index += 1;
  const start = index;
  // Bounded: an address longer than the limit is refused anyway, and an
  // unbounded scan per "[" would make "[a]([a]([a](…" quadratic.
  const limit = Math.min(end, start + MAX_URL_LENGTH + 1);
  let depth = 0;
  while (index < limit) {
    const character = source[index];
    if (character === "\\" && index + 1 < end) {
      index += 2;
      continue;
    }
    if (WHITESPACE.test(character)) break;
    if (character === "(") {
      // Three levels is more than any real address uses; deeper is not a
      // link, and refusing it early keeps "[a]([a]([a](…" from scanning
      // ahead from every bracket.
      depth += 1;
      if (depth > MAX_URL_PARENS) return null;
    }
    if (character === ")") {
      if (depth === 0) break;
      depth -= 1;
    }
    index += 1;
  }
  if (index >= limit && limit < end) return null;
  const url = source.slice(start, index);
  while (index < end && (source[index] === " " || source[index] === "\t")) index += 1;
  let title = "";
  const quote = source[index];
  if (quote === '"' || quote === "'") {
    const close = source.indexOf(quote, index + 1);
    if (close === -1 || close >= end || close - index > MAX_TITLE_LENGTH) return null;
    title = source.slice(index + 1, close);
    index = close + 1;
    while (index < end && (source[index] === " " || source[index] === "\t")) index += 1;
  }
  if (source[index] !== ")") return null;
  return { url: unescape(url), title: unescape(title), next: index + 1 };
}

/** Plain text of inline nodes — for an image's alt text and for search. */
export function inlineText(nodes: InlineNode[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case "text":
          return node.value;
        case "break":
          return " ";
        case "image":
          return node.alt;
        default:
          return inlineText(node.children);
      }
    })
    .join("");
}

function parseInlineRange(
  state: InlineState,
  start: number,
  end: number,
  depth: number,
  inLink: boolean,
): InlineNode[] {
  const { source } = state;
  const nodes: InlineNode[] = [];
  let text = "";
  const flush = () => {
    if (text) nodes.push({ type: "text", value: text });
    text = "";
  };

  let index = start;
  while (index < end) {
    const character = source[index];

    if (character === "\\" && index + 1 < end && ESCAPABLE.has(source[index + 1])) {
      text += source[index + 1];
      index += 2;
      continue;
    }

    if (character === "\n") {
      flush();
      nodes.push({ type: "break" });
      index += 1;
      continue;
    }

    // ![alt](src) and [text](href)
    const isImage = character === "!" && source[index + 1] === "[";
    if ((isImage || (character === "[" && !inLink)) && depth < MAX_INLINE_DEPTH) {
      const open = isImage ? index + 1 : index;
      const close = findBracketClose(state, open + 1, end);
      if (close !== -1 && source[close + 1] === "(") {
        const destination = readDestination(source, close + 1, end);
        if (destination) {
          flush();
          if (isImage) {
            const alt = unescape(source.slice(open + 1, close)).replace(/\s+/g, " ").trim();
            const src = safeImageUrl(destination.url);
            // An address that fails the check leaves its description as text,
            // so the reader loses the picture but not what it was of.
            if (src) nodes.push({ type: "image", src, alt });
            else if (alt) nodes.push({ type: "text", value: alt });
          } else {
            const children = parseInlineRange(state, open + 1, close, depth + 1, true);
            const link = safeLinkUrl(destination.url);
            if (link) nodes.push({ type: "link", ...link, children });
            else nodes.push(...children);
          }
          index = destination.next;
          continue;
        }
      }
    }

    // **strong** / __strong__, then *em* / _em_
    if ((character === "*" || character === "_") && depth < MAX_INLINE_DEPTH) {
      const double = source[index + 1] === character;
      const opensWord = !isWhitespace(source[index + (double ? 2 : 1)]);
      // An underscore inside a word is a character, not a mark.
      const leftFlank = character === "*" || !isWordCharacter(source[index - 1]);
      if (opensWord && leftFlank) {
        if (double) {
          const mark = character + character;
          const close = findCloser(state, mark, index + 2, end);
          if (close !== -1) {
            flush();
            nodes.push({
              type: "strong",
              children: parseInlineRange(state, index + 2, close, depth + 1, inLink),
            });
            index = close + 2;
            continue;
          }
        }
        const close = findCloser(state, character, index + 1, end);
        if (close !== -1) {
          flush();
          nodes.push({
            type: "em",
            children: parseInlineRange(state, index + 1, close, depth + 1, inLink),
          });
          index = close + 1;
          continue;
        }
      }
    }

    text += character;
    index += 1;
  }
  flush();
  return nodes;
}

/** The inline marks of one stretch of text (a paragraph, a heading). */
export function parseInline(text: string): InlineNode[] {
  const state: InlineState = { source: text, failedFrom: new Map(), bracket: new Map() };
  return parseInlineRange(state, 0, text.length, 0, false);
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const RULE = /^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const QUOTE = /^ {0,3}>[ \t]?(.*)$/;
const BULLET = /^( *)([-*+])(?:[ \t]+(.*))?$/;
const ORDERED = /^( *)(\d{1,9})[.)](?:[ \t]+(.*))?$/;

interface ListMarker {
  ordered: boolean;
  number: number;
  indent: number;
  text: string;
}

function listMarker(line: string): ListMarker | null {
  const bullet = BULLET.exec(line);
  // "-" alone on a line, or "***", is a rule or text, not an empty item.
  if (bullet && bullet[3] !== undefined && !RULE.test(line)) {
    return { ordered: false, number: 1, indent: bullet[1].length, text: bullet[3] };
  }
  const ordered = ORDERED.exec(line);
  if (ordered && ordered[3] !== undefined) {
    return {
      ordered: true,
      number: Number(ordered[2]),
      indent: ordered[1].length,
      text: ordered[3],
    };
  }
  return null;
}

function isBlank(line: string | undefined): boolean {
  return line === undefined || line.trim() === "";
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/** Remove the common leading indentation. */
function dedent(lines: string[]): string[] {
  const indents = lines.filter((line) => !isBlank(line)).map(indentOf);
  const common = indents.length ? Math.min(...indents) : 0;
  return lines.map((line) => line.slice(Math.min(common, indentOf(line))));
}

/**
 * Whether `line` begins a block that ends the paragraph above it. A numbered
 * item interrupts only when it starts at 1, so "2026. was a good year" on a
 * paragraph's second line stays text.
 */
function interruptsParagraph(line: string): boolean {
  if (HEADING.test(line) || RULE.test(line) || QUOTE.test(line)) return true;
  const marker = listMarker(line);
  if (!marker || marker.indent > 3) return false;
  return !marker.ordered || marker.number === 1;
}

function paragraphOrFigure(text: string): BlockNode {
  // A paragraph that is nothing but one image (and an optional caption) is
  // drawn as a figure: full width, captioned.
  const figure = /^!\[([^\]]*)\]\(\s*(\S+?)(?:\s+(["'])(.*)\3)?\s*\)$/.exec(text.trim());
  if (figure) {
    const src = safeImageUrl(unescape(figure[2]));
    if (src) {
      return {
        type: "figure",
        src,
        alt: unescape(figure[1]).replace(/\s+/g, " ").trim(),
        caption: unescape(figure[4] ?? "").trim(),
      };
    }
  }
  return { type: "paragraph", children: parseInline(text) };
}

function parseList(
  lines: string[],
  start: number,
  depth: number,
): { block: BlockNode; next: number } {
  const first = listMarker(lines[start]) as ListMarker;
  const items: ListItemNode[] = [];
  const baseIndent = first.indent;
  let index = start;

  const sameList = (marker: ListMarker | null): marker is ListMarker =>
    marker !== null && marker.ordered === first.ordered && marker.indent < baseIndent + 2;

  while (index < lines.length) {
    const marker = listMarker(lines[index]);
    if (!sameList(marker)) break;
    const text = [marker.text];
    const nested: string[] = [];
    index += 1;

    while (index < lines.length) {
      const line = lines[index];
      if (isBlank(line)) {
        // A blank line ends the item unless what follows is indented under it.
        let next = index + 1;
        while (next < lines.length && isBlank(lines[next])) next += 1;
        if (next < lines.length && indentOf(lines[next]) >= baseIndent + 2 && nested.length > 0) {
          nested.push(...lines.slice(index, next));
          index = next;
          continue;
        }
        break;
      }
      const indent = indentOf(line);
      if (indent >= baseIndent + 2) {
        // Indented under the item: a nested list (and whatever follows it),
        // or, before any nested list, more of the item's own text.
        if (nested.length === 0 && !listMarker(line)) text.push(line.trim());
        else nested.push(line);
        index += 1;
        continue;
      }
      if (listMarker(line) || interruptsParagraph(line)) break;
      // An unindented line straight after an item continues it.
      if (nested.length === 0) text.push(line.trim());
      else nested.push(line);
      index += 1;
    }

    const blocks =
      nested.length > 0 && depth + 1 < MAX_BLOCK_DEPTH
        ? parseBlocks(dedent(nested), depth + 1)
        : [];
    if (nested.length > 0 && blocks.length === 0) {
      text.push(...nested.filter((line) => !isBlank(line)).map((line) => line.trim()));
    }
    items.push({ children: parseInline(text.join("\n")), blocks });

    // Blank lines between two items of the same list keep it going.
    let next = index;
    while (next < lines.length && isBlank(lines[next])) next += 1;
    if (next !== index && next < lines.length && sameList(listMarker(lines[next]))) {
      index = next;
    }
  }

  return {
    block: { type: "list", ordered: first.ordered, start: first.number, items },
    next: index,
  };
}

function parseBlocks(lines: string[], depth: number): BlockNode[] {
  const blocks: BlockNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (isBlank(line)) {
      index += 1;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const text = heading[2].trim();
      if (text) {
        blocks.push({
          type: "heading",
          level: heading[1].length <= 2 ? 2 : 3,
          children: parseInline(text),
        });
      }
      index += 1;
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ type: "rule" });
      index += 1;
      continue;
    }

    if (QUOTE.test(line)) {
      const quoted: string[] = [];
      while (index < lines.length) {
        const match = QUOTE.exec(lines[index]);
        if (!match) break;
        quoted.push(match[1]);
        index += 1;
      }
      blocks.push({
        type: "quote",
        children:
          depth + 1 < MAX_BLOCK_DEPTH
            ? parseBlocks(quoted, depth + 1)
            : [{ type: "paragraph", children: parseInline(quoted.join("\n").trim()) }],
      });
      continue;
    }

    if (listMarker(line) && depth < MAX_BLOCK_DEPTH) {
      const { block, next } = parseList(lines, index, depth);
      blocks.push(block);
      index = next;
      continue;
    }

    const paragraph: string[] = [line.trim()];
    index += 1;
    while (index < lines.length && !isBlank(lines[index]) && !interruptsParagraph(lines[index])) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push(paragraphOrFigure(paragraph.join("\n")));
  }

  return blocks;
}

/** A post's text as blocks. Windows and old-Mac line endings read as "\n";
 * a tab counts as four spaces of indentation. */
export function parseMarkdown(source: string): BlockNode[] {
  if (typeof source !== "string" || source.trim() === "") return [];
  const lines = source.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n");
  return parseBlocks(lines, 0);
}

// ---------------------------------------------------------------------------
// Reading the tree
// ---------------------------------------------------------------------------

/** Every image a post shows — for checking where they are hosted. */
export function imageSources(blocks: BlockNode[]): string[] {
  const sources: string[] = [];
  const inline = (nodes: InlineNode[]) => {
    for (const node of nodes) {
      if (node.type === "image") sources.push(node.src);
      else if (node.type !== "text" && node.type !== "break") inline(node.children);
    }
  };
  const walk = (list: BlockNode[]) => {
    for (const block of list) {
      switch (block.type) {
        case "figure":
          sources.push(block.src);
          break;
        case "heading":
        case "paragraph":
          inline(block.children);
          break;
        case "quote":
          walk(block.children);
          break;
        case "list":
          for (const item of block.items) {
            inline(item.children);
            walk(item.blocks);
          }
          break;
        default:
          break;
      }
    }
  };
  walk(blocks);
  return sources;
}

/** The words of a post with the marks taken out, whitespace collapsed — for
 * a search description when the operator wrote none. */
export function plainText(blocks: BlockNode[]): string {
  const parts: string[] = [];
  const walk = (list: BlockNode[]) => {
    for (const block of list) {
      switch (block.type) {
        case "heading":
        case "paragraph":
          parts.push(inlineText(block.children));
          break;
        case "quote":
          walk(block.children);
          break;
        case "list":
          for (const item of block.items) {
            parts.push(inlineText(item.children));
            walk(item.blocks);
          }
          break;
        case "figure":
          if (block.caption) parts.push(block.caption);
          break;
        default:
          break;
      }
    }
  };
  walk(blocks);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/** `text` cut to at most `max` characters at a word boundary, with "…". */
export function truncateText(text: string, max: number): string {
  const value = text.replace(/\s+/g, " ").trim();
  if (value.length <= max) return value;
  const cut = value.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
