/**
 * A blog post's body as the browser receives it.
 *
 * The parser's tree is safe; this checks the last step, the markup React
 * writes from it — the place an XSS would actually land. What matters: the
 * marks become the expected elements, external links open safely, the
 * direction-sensitive spacing is logical (so /ar/blog mirrors), and nothing
 * a post says — tags, handlers, script addresses — reaches the page as
 * anything but escaped text.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { BlogContent } from "@/lib/blog/markdown-render";

const render = (source: string) => renderToStaticMarkup(createElement(BlogContent, { source }));

describe("BlogContent", () => {
  test("headings, paragraphs and emphasis", () => {
    const html = render("## Rent\n\nPay **on time** and *early*.\n\n### Why");
    assert.match(html, /<h2[^>]*>Rent<\/h2>/);
    assert.match(html, /<h3[^>]*>Why<\/h3>/);
    assert.match(html, /<strong[^>]*>on time<\/strong>/);
    assert.match(html, /<em[^>]*>early<\/em>/);
    assert.doesNotMatch(html, /<h1/);
  });

  test("lists: bullets, numbers from where they start, nesting", () => {
    const html = render("- a\n  - b\n\n3. c\n4. d");
    assert.match(html, /<ul[^>]*><li[^>]*>a<ul[^>]*><li[^>]*>b<\/li><\/ul><\/li><\/ul>/);
    assert.match(html, /<ol start="3"[^>]*>/);
  });

  test("external links open in a new tab without the opener; site links do not", () => {
    const html = render("[docs](https://example.com) and [pricing](/pricing)");
    assert.match(html, /<a href="https:\/\/example.com" target="_blank" rel="noopener noreferrer"[^>]*>docs<\/a>/);
    assert.match(html, /<a href="\/pricing" class="[^"]*">pricing<\/a>/);
  });

  test("a figure with its description and caption", () => {
    const html = render('![A villa](/images/v.jpg "Riyadh")');
    assert.match(html, /<figure[^>]*><img src="\/images\/v.jpg" alt="A villa" loading="lazy"/);
    assert.match(html, /<figcaption[^>]*>Riyadh<\/figcaption>/);
  });

  test("spacing and markers are logical, so the Arabic page mirrors", () => {
    const html = render("- a\n\n> quote");
    assert.match(html, /<ul class="[^"]*\bps-6\b/);
    assert.match(html, /<blockquote class="[^"]*\bborder-s-4\b/);
    assert.doesNotMatch(html, /\b(pl|pr|ml|mr|border-l|border-r|text-left|text-right)-/);
  });

  test("an empty post draws an empty body", () => {
    assert.equal(render(""), '<div class="break-words text-[17px] text-slate-700"></div>');
  });
});

describe("XSS attempts come out as text", () => {
  const attempts = [
    "<script>alert(1)</script>",
    "<img src=x onerror=alert(1)>",
    '<a href="javascript:alert(1)">click</a>',
    "<svg/onload=alert(1)>",
    '"><script>alert(1)</script>',
    "<iframe src=javascript:alert(1)></iframe>",
    "<style>body{display:none}</style>",
    "[click](javascript:alert(1))",
    "[click](JaVaScRiPt:alert(1))",
    "[click](javascript&#58;alert(1))",
    "[click](  javascript:alert(1))",
    "[click](java\tscript:alert(1))",
    "[click](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)",
    "[click](vbscript:msgbox(1))",
    '[click](https://example.com" onmouseover="alert(1))',
    "[click](https://example.com/\"onmouseover=alert(1))",
    "![x](javascript:alert(1))",
    '![x" onerror="alert(1)](/a.png)',
    "![x](/a.png\" onerror=\"alert(1))",
    "![x](data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+)",
    "**<b onmouseover=alert(1)>bold</b>**",
    "> <script>alert(1)</script>",
    "- <img src=x onerror=alert(1)>",
  ];

  /** The elements and attributes actually in the markup. Text React wrote
   * is escaped (`&lt;`), so every literal "<" starts a real tag. */
  const ALLOWED_TAGS = new Set([
    "div", "p", "h2", "h3", "strong", "em", "a", "br", "ul", "ol", "li",
    "blockquote", "figure", "figcaption", "img", "hr",
  ]);
  const ALLOWED_ATTRIBUTES = new Set([
    "class", "href", "target", "rel", "src", "alt", "loading", "decoding", "start",
  ]);
  function elements(html: string) {
    const found: Array<{ tag: string; attributes: Array<[string, string]> }> = [];
    for (const match of html.matchAll(/<([a-z0-9]+)((?: [a-z-]+="[^"]*")*)\s?\/?>/g)) {
      const attributes = [...match[2].matchAll(/ ([a-z-]+)="([^"]*)"/g)].map(
        (attribute) => [attribute[1], attribute[2]] as [string, string],
      );
      found.push({ tag: match[1], attributes });
    }
    return found;
  }

  for (const attempt of attempts) {
    test(JSON.stringify(attempt).slice(0, 70), () => {
      const html = render(attempt);
      // Every "<" that opens a tag opens a well-formed one: a quote in a post
      // never closes an attribute early.
      const opened = (html.match(/<[a-z]/g) ?? []).length;
      const tags = elements(html);
      assert.equal(tags.length, opened, html);
      for (const { tag, attributes } of tags) {
        // Only the elements the marks make, with only the attributes the
        // renderer writes — no handler, no style, nothing else.
        assert.ok(ALLOWED_TAGS.has(tag), `<${tag}> in ${html}`);
        for (const [name, value] of attributes) {
          assert.ok(ALLOWED_ATTRIBUTES.has(name), `${name}= in ${html}`);
          if (name === "href" || name === "src") {
            const decoded = value.replace(/&amp;/g, "&").replace(/&quot;/g, '"');
            assert.doesNotMatch(decoded.replace(/[\s\u0000-\u001f]/g, ""), /^(javascript|vbscript|data|file):/i, value);
            assert.ok(!decoded.startsWith("//"), value);
          }
        }
      }
    });
  }

  test("text that looks like markup is escaped, not dropped", () => {
    const html = render("<b>not bold</b> & <i>not italic</i>");
    assert.match(html, /&lt;b&gt;not bold&lt;\/b&gt; &amp; &lt;i&gt;not italic&lt;\/i&gt;/);
  });

  test("a quote inside an address is escaped in the attribute", () => {
    const html = render('[x](/a"b)');
    assert.match(html, /href="\/a&quot;b"/);
  });
});
