/**
 * PropertyPro SaaS - The blog editor's formatting buttons
 *
 * What each toolbar button does to the text box: given its value and
 * selection, the new value and the selection to restore. Wrapping marks
 * (bold, italic, link) go round the selection, or round a placeholder that is
 * left selected so typing replaces it; line marks (headings, lists, quotes)
 * go at the start of every selected line, and come off again when every line
 * already has them.
 *
 * Pure, so the editor stays a thin shell and the behaviour is tested.
 */

export type MarkdownFormat =
  | "heading2"
  | "heading3"
  | "bold"
  | "italic"
  | "link"
  | "bulletList"
  | "numberedList"
  | "quote";

export interface TextEdit {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

/** Words put in when nothing is selected — in the editing language. */
export interface FormatPlaceholders {
  text: string;
  linkText: string;
  url: string;
}

function clampSelection(value: string, start: number, end: number): [number, number] {
  const a = Math.max(0, Math.min(start, value.length));
  const b = Math.max(0, Math.min(end, value.length));
  return a <= b ? [a, b] : [b, a];
}

function wrap(
  value: string,
  start: number,
  end: number,
  mark: string,
  placeholder: string,
): TextEdit {
  const selected = value.slice(start, end);
  // Selections often carry the space after a double-clicked word; the marks
  // go round the word, the space stays outside.
  const leading = selected.match(/^\s*/)?.[0] ?? "";
  const trailing = selected.slice(leading.length).match(/\s*$/)?.[0] ?? "";
  const inner = selected.slice(leading.length, selected.length - trailing.length);
  const text = inner || placeholder;
  const before = value.slice(0, start) + leading + mark;
  return {
    value: `${before}${text}${mark}${trailing}${value.slice(end)}`,
    selectionStart: before.length,
    selectionEnd: before.length + text.length,
  };
}

/** The [start, end) of the whole lines the selection touches. */
function lineRange(value: string, start: number, end: number): [number, number] {
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  // A selection ending just after a line break does not take the next line.
  const effectiveEnd = end > start && value[end - 1] === "\n" ? end - 1 : end;
  const nextBreak = value.indexOf("\n", effectiveEnd);
  return [lineStart, nextBreak === -1 ? value.length : nextBreak];
}

const LINE_MARKS: Record<"heading2" | "heading3" | "bulletList" | "numberedList" | "quote", RegExp> = {
  heading2: /^## /,
  heading3: /^### /,
  bulletList: /^[-*+] /,
  numberedList: /^\d+[.)] /,
  quote: /^> ?/,
};

/** Any heading or list mark a line already carries, which a new one replaces. */
const ANY_LINE_MARK = /^(?:#{1,6} |[-*+] |\d+[.)] )/;

function prefixLines(
  value: string,
  start: number,
  end: number,
  format: keyof typeof LINE_MARKS,
): TextEdit {
  const [from, to] = lineRange(value, start, end);
  const lines = value.slice(from, to).split("\n");
  const mark = LINE_MARKS[format];
  const content = lines.filter((line) => line.trim() !== "");
  const removing = content.length > 0 && content.every((line) => mark.test(line));
  let number = 0;
  const next = lines.map((line) => {
    if (removing) return line.replace(mark, "");
    if (line.trim() === "" && lines.length > 1) return line;
    const bare = format === "quote" ? line : line.replace(ANY_LINE_MARK, "");
    switch (format) {
      case "heading2":
        return `## ${bare}`;
      case "heading3":
        return `### ${bare}`;
      case "bulletList":
        return `- ${bare}`;
      case "numberedList":
        number += 1;
        return `${number}. ${bare}`;
      case "quote":
        return `> ${bare}`;
    }
  });
  const replaced = next.join("\n");
  const result = value.slice(0, from) + replaced + value.slice(to);
  // A single empty line gets its mark and the caret after it, ready to type.
  if (lines.length === 1 && lines[0] === "" && !removing) {
    return { value: result, selectionStart: from + replaced.length, selectionEnd: from + replaced.length };
  }
  return { value: result, selectionStart: from, selectionEnd: from + replaced.length };
}

/** `format` applied to `value` with the selection [start, end). */
export function applyMarkdownFormat(
  value: string,
  start: number,
  end: number,
  format: MarkdownFormat,
  placeholders: FormatPlaceholders,
): TextEdit {
  const [a, b] = clampSelection(value, start, end);
  switch (format) {
    case "bold":
      return wrap(value, a, b, "**", placeholders.text);
    case "italic":
      return wrap(value, a, b, "*", placeholders.text);
    case "link": {
      const selected = value.slice(a, b).trim();
      // A selected address becomes the link's target; selected words its text.
      const isUrl = /^(https?:\/\/|\/)\S*$/i.test(selected);
      const label = isUrl ? placeholders.linkText : selected || placeholders.linkText;
      const url = isUrl ? selected : placeholders.url;
      const inserted = `[${label}](${url})`;
      const result = value.slice(0, a) + inserted + value.slice(b);
      // Select what still needs typing: the address, or the words.
      const selectFrom = isUrl || !selected ? a + 1 : a + label.length + 3;
      const selectTo = isUrl || !selected ? a + 1 + label.length : selectFrom + url.length;
      return { value: result, selectionStart: selectFrom, selectionEnd: selectTo };
    }
    default:
      return prefixLines(value, a, b, format);
  }
}

/**
 * `block` (an image line, say) on lines of its own at the caret: a blank line
 * before and after unless one is already there. The caret ends after it.
 */
export function insertBlock(value: string, start: number, end: number, block: string): TextEdit {
  const [a, b] = clampSelection(value, start, end);
  const before = value.slice(0, a);
  const after = value.slice(b);
  const lead = before === "" ? "" : before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  const tail = after === "" ? "\n" : after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
  const inserted = `${lead}${block}${tail}`;
  const caret = before.length + lead.length + block.length;
  return { value: before + inserted + after, selectionStart: caret, selectionEnd: caret };
}

/** The Markdown for an uploaded image; brackets in the description escaped. */
export function imageMarkdown(url: string, alt: string): string {
  const description = alt.replace(/[[\]\\]/g, (character) => `\\${character}`);
  return `![${description}](${url})`;
}
