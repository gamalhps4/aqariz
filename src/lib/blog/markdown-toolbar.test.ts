/**
 * The blog editor's formatting buttons.
 *
 * What matters: each button produces the mark the renderer reads, leaves the
 * selection where the writer will type next, and pressing a line button on
 * lines that already carry its mark takes the mark off.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { applyMarkdownFormat, imageMarkdown, insertBlock } from "@/lib/blog/markdown-toolbar";

const placeholders = { text: "text", linkText: "link text", url: "https://" };

/** The value with the selection drawn in as [ and ]. */
function show(edit: { value: string; selectionStart: number; selectionEnd: number }): string {
  const { value, selectionStart: a, selectionEnd: b } = edit;
  return `${value.slice(0, a)}[${value.slice(a, b)}]${value.slice(b)}`;
}

describe("wrapping marks", () => {
  test("bold and italic go round the selection", () => {
    assert.equal(show(applyMarkdownFormat("pay rent now", 4, 8, "bold", placeholders)), "pay **[rent]** now");
    assert.equal(show(applyMarkdownFormat("pay rent now", 4, 8, "italic", placeholders)), "pay *[rent]* now");
  });

  test("a trailing space in the selection stays outside the marks", () => {
    assert.equal(show(applyMarkdownFormat("pay rent now", 4, 9, "bold", placeholders)), "pay **[rent]** now");
  });

  test("with nothing selected, a placeholder is inserted and selected", () => {
    assert.equal(show(applyMarkdownFormat("pay ", 4, 4, "bold", placeholders)), "pay **[text]**");
  });

  test("links: selected words become the text, the address is left to type", () => {
    assert.equal(
      show(applyMarkdownFormat("see the docs", 4, 12, "link", placeholders)),
      "see [the docs]([https://])",
    );
    assert.equal(show(applyMarkdownFormat("", 0, 0, "link", placeholders)), "[[link text]](https://)");
    assert.equal(
      show(applyMarkdownFormat("https://example.com", 0, 19, "link", placeholders)),
      "[[link text]](https://example.com)",
    );
  });
});

describe("line marks", () => {
  test("headings replace any heading or list mark already there", () => {
    assert.equal(applyMarkdownFormat("Title", 2, 2, "heading2", placeholders).value, "## Title");
    assert.equal(applyMarkdownFormat("## Title", 0, 0, "heading3", placeholders).value, "### Title");
    assert.equal(applyMarkdownFormat("- item", 0, 0, "heading2", placeholders).value, "## item");
  });

  test("every selected line gets the mark; numbers count up", () => {
    assert.equal(applyMarkdownFormat("a\nb\nc", 0, 5, "bulletList", placeholders).value, "- a\n- b\n- c");
    assert.equal(applyMarkdownFormat("a\nb\nc", 0, 5, "numberedList", placeholders).value, "1. a\n2. b\n3. c");
    assert.equal(applyMarkdownFormat("a\nb", 0, 3, "quote", placeholders).value, "> a\n> b");
  });

  test("only the touched lines change", () => {
    assert.equal(applyMarkdownFormat("keep\nthis\nkeep", 6, 6, "bulletList", placeholders).value, "keep\n- this\nkeep");
  });

  test("pressing again takes the mark off", () => {
    assert.equal(applyMarkdownFormat("- a\n- b", 0, 7, "bulletList", placeholders).value, "a\nb");
    assert.equal(applyMarkdownFormat("## Title", 0, 8, "heading2", placeholders).value, "Title");
    assert.equal(applyMarkdownFormat("> a", 0, 3, "quote", placeholders).value, "a");
  });

  test("on an empty line the caret lands after the mark", () => {
    const edit = applyMarkdownFormat("text\n\n", 6, 6, "bulletList", placeholders);
    assert.equal(show(edit), "text\n\n- []");
  });

  test("Arabic lines take marks the same way", () => {
    assert.equal(applyMarkdownFormat("تجديد\nتحصيل", 0, 11, "bulletList", placeholders).value, "- تجديد\n- تحصيل");
  });
});

describe("inserting an image", () => {
  test("on lines of its own, blank lines around it", () => {
    assert.equal(insertBlock("before", 6, 6, "![a](/a.png)").value, "before\n\n![a](/a.png)\n");
    assert.equal(insertBlock("before\n\nafter", 7, 7, "![a](/a.png)").value, "before\n\n![a](/a.png)\n\nafter");
    assert.equal(insertBlock("", 0, 0, "![a](/a.png)").value, "![a](/a.png)\n");
  });

  test("a description with brackets cannot break the mark", () => {
    assert.equal(imageMarkdown("/a.png", "plan [v2]"), "![plan \\[v2\\]](/a.png)");
  });
});
