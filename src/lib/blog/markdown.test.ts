/**
 * The blog's Markdown subset: what it reads, and what it refuses.
 *
 * A post is written by an operator but read by everyone, so the parser is a
 * trust boundary. What matters: the marks a writer expects work (headings,
 * emphasis, links, lists, quotes, images), nothing becomes HTML, no address
 * but http(s) and site paths survives into a link and none but https and site
 * paths into an image, and hostile input is parsed in bounded time.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  imageSources,
  inlineText,
  parseInline,
  parseMarkdown,
  plainText,
  safeImageUrl,
  safeLinkUrl,
  truncateText,
  type BlockNode,
  type InlineNode,
} from "@/lib/blog/markdown";

/** Every node of a tree, flattened — for "no node of kind X anywhere". */
function allNodes(blocks: BlockNode[]): Array<BlockNode | InlineNode> {
  const out: Array<BlockNode | InlineNode> = [];
  const inline = (nodes: InlineNode[]) => {
    for (const node of nodes) {
      out.push(node);
      if ("children" in node) inline(node.children);
    }
  };
  const walk = (list: BlockNode[]) => {
    for (const block of list) {
      out.push(block);
      if (block.type === "quote") walk(block.children);
      else if (block.type === "list") {
        for (const item of block.items) {
          inline(item.children);
          walk(item.blocks);
        }
      } else if ("children" in block) inline(block.children as InlineNode[]);
    }
  };
  walk(blocks);
  return out;
}

describe("safeLinkUrl", () => {
  test("http(s) addresses are external, site paths and anchors internal", () => {
    assert.deepEqual(safeLinkUrl("https://example.com/a?b=1#c"), {
      href: "https://example.com/a?b=1#c",
      external: true,
    });
    assert.deepEqual(safeLinkUrl("HTTP://Example.com"), { href: "HTTP://Example.com", external: true });
    for (const href of ["/pricing", "/ar/blog/x", "#section", "other-post", "?page=2", "./a", "../b"]) {
      assert.deepEqual(safeLinkUrl(href), { href, external: false }, href);
    }
  });

  test("script, data and every other scheme is refused", () => {
    for (const href of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "  javascript:alert(1)",
      "jav\tascript:alert(1)",
      "java\nscript:alert(1)",
      "\u0000javascript:alert(1)",
      "javascript​:alert(1)",
      "vbscript:msgbox(1)",
      "data:text/html,<script>alert(1)</script>",
      "data:image/svg+xml;base64,PHN2Zz4=",
      "file:///etc/passwd",
      "mailto:a@example.com",
      "tel:+966500000000",
      "blob:https://example.com/x",
    ]) {
      assert.equal(safeLinkUrl(href), null, JSON.stringify(href));
    }
  });

  test("protocol-relative, backslashed and hostless forms are refused", () => {
    for (const href of [
      "//evil.example",
      "/\\evil.example",
      "\\\\evil.example",
      "https://",
      "https:///path",
      "https://user@evil.example",
      "https:evil.example",
      "",
      "   ",
      `https://example.com/${"a".repeat(3000)}`,
    ]) {
      assert.equal(safeLinkUrl(href), null, JSON.stringify(href.slice(0, 40)));
    }
  });
});

describe("safeImageUrl", () => {
  test("https addresses and site paths", () => {
    assert.equal(safeImageUrl("https://pub.r2.dev/a.png"), "https://pub.r2.dev/a.png");
    assert.equal(safeImageUrl("/images/a.png"), "/images/a.png");
  });

  test("http, data, javascript, protocol-relative and bare relative paths are refused", () => {
    for (const src of [
      "http://example.com/a.png",
      "data:image/png;base64,iVBOR",
      "javascript:alert(1)",
      "//evil.example/a.png",
      "a.png",
      "../a.png",
      "https://",
      "/a b.png",
    ]) {
      assert.equal(safeImageUrl(src), null, src);
    }
  });
});

describe("inline marks", () => {
  test("bold and italic, with either character", () => {
    assert.deepEqual(parseInline("a **b** c"), [
      { type: "text", value: "a " },
      { type: "strong", children: [{ type: "text", value: "b" }] },
      { type: "text", value: " c" },
    ]);
    assert.deepEqual(parseInline("__b__ *i* _j_"), [
      { type: "strong", children: [{ type: "text", value: "b" }] },
      { type: "text", value: " " },
      { type: "em", children: [{ type: "text", value: "i" }] },
      { type: "text", value: " " },
      { type: "em", children: [{ type: "text", value: "j" }] },
    ]);
  });

  test("marks nest", () => {
    assert.deepEqual(parseInline("*a **b** c*"), [
      {
        type: "em",
        children: [
          { type: "text", value: "a " },
          { type: "strong", children: [{ type: "text", value: "b" }] },
          { type: "text", value: " c" },
        ],
      },
    ]);
  });

  test("unmatched or spaced marks stay literal", () => {
    assert.deepEqual(parseInline("2 * 3 * 4"), [{ type: "text", value: "2 * 3 * 4" }]);
    assert.deepEqual(parseInline("**open"), [{ type: "text", value: "**open" }]);
    assert.deepEqual(parseInline("****"), [{ type: "text", value: "****" }]);
  });

  test("underscores inside words are letters", () => {
    assert.deepEqual(parseInline("snake_case_name"), [{ type: "text", value: "snake_case_name" }]);
  });

  test("a backslash makes a mark literal", () => {
    assert.deepEqual(parseInline("\\*not italic\\*"), [{ type: "text", value: "*not italic*" }]);
    assert.deepEqual(parseInline("\\[not](a link)"), [{ type: "text", value: "[not](a link)" }]);
  });

  test("a line break inside a paragraph is kept", () => {
    assert.deepEqual(parseInline("one\ntwo"), [
      { type: "text", value: "one" },
      { type: "break" },
      { type: "text", value: "two" },
    ]);
  });

  test("Arabic text with marks", () => {
    assert.deepEqual(parseInline("هذا **مهم** جدًا"), [
      { type: "text", value: "هذا " },
      { type: "strong", children: [{ type: "text", value: "مهم" }] },
      { type: "text", value: " جدًا" },
    ]);
  });
});

describe("links", () => {
  test("internal and external links, with formatted text", () => {
    assert.deepEqual(parseInline("[Pricing](/pricing)"), [
      { type: "link", href: "/pricing", external: false, children: [{ type: "text", value: "Pricing" }] },
    ]);
    assert.deepEqual(parseInline("see [**the** docs](https://example.com/x \"Docs\")"), [
      { type: "text", value: "see " },
      {
        type: "link",
        href: "https://example.com/x",
        external: true,
        children: [
          { type: "strong", children: [{ type: "text", value: "the" }] },
          { type: "text", value: " docs" },
        ],
      },
    ]);
  });

  test("balanced parentheses stay in the address", () => {
    const [link] = parseInline("[w](https://en.wikipedia.org/wiki/Riyadh_(city))");
    assert.equal(link.type, "link");
    assert.equal((link as { href: string }).href, "https://en.wikipedia.org/wiki/Riyadh_(city)");
  });

  test("parentheses nested deeper than any real address are not a link", () => {
    assert.equal(parseInline("[x](/a(b(c(d))))")[0].type, "link");
    assert.ok(parseInline("[x](/a(b(c(d(e)))))").every((node) => node.type !== "link"));
  });

  test("a refused address leaves the words and drops the link", () => {
    assert.deepEqual(parseInline("[click](javascript:alert(1))"), [{ type: "text", value: "click" }]);
    assert.deepEqual(parseInline("[x](JAVASCRIPT:alert(document.cookie))"), [{ type: "text", value: "x" }]);
    assert.deepEqual(parseInline("[x](data:text/html;base64,PHNjcmlwdD4=)"), [{ type: "text", value: "x" }]);
    assert.deepEqual(parseInline("[x](//evil.example)"), [{ type: "text", value: "x" }]);
  });

  test("links do not nest", () => {
    const nodes = parseInline("[a [b](/b)](/a)");
    const links = nodes.filter((node) => node.type === "link");
    for (const link of links) {
      assert.ok(!(link as { children: InlineNode[] }).children.some((child) => child.type === "link"));
    }
  });

  test("text that only looks like a link stays text", () => {
    assert.deepEqual(parseInline("[not a link] (here)"), [{ type: "text", value: "[not a link] (here)" }]);
  });
});

describe("images", () => {
  test("an image alone in a paragraph is a figure, with an optional caption", () => {
    assert.deepEqual(parseMarkdown("![A villa](https://pub.r2.dev/v.jpg \"Riyadh, 2026\")"), [
      { type: "figure", src: "https://pub.r2.dev/v.jpg", alt: "A villa", caption: "Riyadh, 2026" },
    ]);
    assert.deepEqual(parseMarkdown("![](/images/a.png)"), [
      { type: "figure", src: "/images/a.png", alt: "", caption: "" },
    ]);
  });

  test("an image inside text stays inline", () => {
    assert.deepEqual(parseInline("before ![i](/i.png) after"), [
      { type: "text", value: "before " },
      { type: "image", src: "/i.png", alt: "i" },
      { type: "text", value: " after" },
    ]);
  });

  test("an image with a refused address leaves only its description", () => {
    assert.deepEqual(parseMarkdown("![logo](javascript:alert(1))"), [
      { type: "paragraph", children: [{ type: "text", value: "logo" }] },
    ]);
    assert.deepEqual(parseMarkdown("![x](http://insecure.example/a.png)"), [
      { type: "paragraph", children: [{ type: "text", value: "x" }] },
    ]);
    // A space ends an address, so this is not even an image: all text.
    assert.deepEqual(parseInline("a ![](data:image/svg+xml,<svg onload=alert(1)>) b"), [
      { type: "text", value: "a ![](data:image/svg+xml,<svg onload=alert(1)>) b" },
    ]);
    assert.deepEqual(parseInline("a ![x](data:image/svg+xml;base64,PHN2Zz4=) b"), [
      { type: "text", value: "a " },
      { type: "text", value: "x" },
      { type: "text", value: " b" },
    ]);
  });
});

describe("blocks", () => {
  test("headings: ## and ###; a single # is demoted; #hashtag is text", () => {
    assert.deepEqual(parseMarkdown("## Two\n### Three\n# One\n#### Four\n#hashtag"), [
      { type: "heading", level: 2, children: [{ type: "text", value: "Two" }] },
      { type: "heading", level: 3, children: [{ type: "text", value: "Three" }] },
      { type: "heading", level: 2, children: [{ type: "text", value: "One" }] },
      { type: "heading", level: 3, children: [{ type: "text", value: "Four" }] },
      { type: "paragraph", children: [{ type: "text", value: "#hashtag" }] },
    ]);
  });

  test("a heading keeps a # that belongs to it", () => {
    assert.deepEqual(parseMarkdown("## C# tips ##"), [
      { type: "heading", level: 2, children: [{ type: "text", value: "C# tips" }] },
    ]);
  });

  test("blank lines separate paragraphs; Windows line endings read the same", () => {
    assert.deepEqual(parseMarkdown("one\r\n\r\ntwo\r\nthree"), [
      { type: "paragraph", children: [{ type: "text", value: "one" }] },
      {
        type: "paragraph",
        children: [{ type: "text", value: "two" }, { type: "break" }, { type: "text", value: "three" }],
      },
    ]);
  });

  test("bulleted and numbered lists, and where numbering starts", () => {
    assert.deepEqual(parseMarkdown("- a\n* b\n+ c\n\n3. x\n4) y"), [
      {
        type: "list",
        ordered: false,
        start: 1,
        items: [
          { children: [{ type: "text", value: "a" }], blocks: [] },
          { children: [{ type: "text", value: "b" }], blocks: [] },
          { children: [{ type: "text", value: "c" }], blocks: [] },
        ],
      },
      {
        type: "list",
        ordered: true,
        start: 3,
        items: [
          { children: [{ type: "text", value: "x" }], blocks: [] },
          { children: [{ type: "text", value: "y" }], blocks: [] },
        ],
      },
    ]);
  });

  test("indented items nest; a following line continues its item", () => {
    const [list] = parseMarkdown("- parent\n  - child one\n  - child two\n- next\n  more of next");
    assert.equal(list.type, "list");
    if (list.type !== "list") return;
    assert.equal(list.items.length, 2);
    assert.deepEqual(list.items[0].blocks, [
      {
        type: "list",
        ordered: false,
        start: 1,
        items: [
          { children: [{ type: "text", value: "child one" }], blocks: [] },
          { children: [{ type: "text", value: "child two" }], blocks: [] },
        ],
      },
    ]);
    assert.deepEqual(list.items[1].children, [
      { type: "text", value: "next" },
      { type: "break" },
      { type: "text", value: "more of next" },
    ]);
  });

  test("blank lines between items keep one list", () => {
    const blocks = parseMarkdown("1. a\n\n2. b\n\n3. c");
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].type === "list" && blocks[0].items.length, 3);
  });

  test("a year at the start of a paragraph's second line is not a list", () => {
    assert.deepEqual(parseMarkdown("We grew a lot in\n2026. Then more."), [
      {
        type: "paragraph",
        children: [
          { type: "text", value: "We grew a lot in" },
          { type: "break" },
          { type: "text", value: "2026. Then more." },
        ],
      },
    ]);
  });

  test("quotes hold paragraphs and lists", () => {
    assert.deepEqual(parseMarkdown("> **Tip:** pay early\n>\n> - one\n> - two"), [
      {
        type: "quote",
        children: [
          {
            type: "paragraph",
            children: [
              { type: "strong", children: [{ type: "text", value: "Tip:" }] },
              { type: "text", value: " pay early" },
            ],
          },
          {
            type: "list",
            ordered: false,
            start: 1,
            items: [
              { children: [{ type: "text", value: "one" }], blocks: [] },
              { children: [{ type: "text", value: "two" }], blocks: [] },
            ],
          },
        ],
      },
    ]);
  });

  test("a dividing line", () => {
    assert.deepEqual(parseMarkdown("a\n\n---\n\nb").map((block) => block.type), ["paragraph", "rule", "paragraph"]);
    assert.deepEqual(parseMarkdown("***").map((block) => block.type), ["rule"]);
  });

  test("Arabic lists and quotes parse like English ones", () => {
    const blocks = parseMarkdown("## العقود\n\n- تجديد العقد\n- تحصيل الإيجار\n\n> نصيحة مهمة");
    assert.deepEqual(blocks.map((block) => block.type), ["heading", "list", "quote"]);
  });

  test("empty input is no blocks", () => {
    assert.deepEqual(parseMarkdown(""), []);
    assert.deepEqual(parseMarkdown("  \n\n "), []);
  });
});

describe("no HTML, ever", () => {
  test("tags, handlers and entities are text", () => {
    const source = [
      "<script>alert(1)</script>",
      "<img src=x onerror=alert(1)>",
      '<a href="javascript:alert(1)">x</a>',
      "<iframe src=//evil.example></iframe>",
      "&lt;b&gt; &#106;avascript:",
    ].join("\n\n");
    const nodes = allNodes(parseMarkdown(source));
    assert.ok(nodes.every((node) => node.type === "paragraph" || node.type === "text"));
    assert.equal(
      plainText(parseMarkdown(source)),
      source.replace(/\n+/g, " "),
    );
  });

  test("no link or image carries a refused address, whatever the nesting", () => {
    const hostile = [
      "[a](javascript:alert(1))",
      "**[b](javascript:alert(1))**",
      "> - [c](vbscript:x)",
      "![d](javascript:alert(1))",
      "[e](  java\tscript:alert(1))",
      "[f](data:text/html,x)",
      "1. *[g](//evil.example)*",
    ].join("\n\n");
    for (const node of allNodes(parseMarkdown(hostile))) {
      if (node.type === "link") assert.notEqual(safeLinkUrl(node.href), null, node.href);
      if (node.type === "image" || node.type === "figure") {
        assert.notEqual(safeImageUrl(node.src), null, node.src);
      }
    }
  });
});

describe("hostile input is bounded", () => {
  test("100,000 marks parse quickly", () => {
    for (const source of [
      "*".repeat(100_000),
      "**a ".repeat(25_000),
      "[".repeat(100_000),
      "[a](".repeat(25_000),
      "_a ".repeat(33_000),
      ">".repeat(5_000) + " deep",
      "- ".repeat(50_000),
      `${"  ".repeat(2_000)}- deep`,
      "![".repeat(50_000),
      "![a](".repeat(20_000),
      ("[a](" + "b".repeat(2_000)).repeat(50),
      "*a _b **c __d ".repeat(7_000),
      "\\".repeat(100_000) + "*x*",
      "a\n".repeat(50_000),
      Array.from({ length: 2_000 }, (_, i) => `${" ".repeat((i % 40) * 2)}- item`).join("\n"),
    ]) {
      // Each of these parses in a few milliseconds; the bound is loose so a
      // busy test run stays green, and tight enough that anything quadratic
      // (minutes at this size) fails.
      const started = performance.now();
      parseMarkdown(source);
      const elapsed = performance.now() - started;
      assert.ok(elapsed < 1000, `${source.slice(0, 12)}… took ${Math.round(elapsed)}ms`);
    }
  });

  test("deep nesting stops nesting rather than recursing without end", () => {
    const quote = parseMarkdown(`${">".repeat(50)} deep`);
    let depth = 0;
    let node: BlockNode | undefined = quote[0];
    while (node && node.type === "quote") {
      depth += 1;
      node = node.children[0];
    }
    assert.ok(depth <= 4, `quote depth ${depth}`);
  });
});

describe("reading the tree", () => {
  test("plain text drops the marks", () => {
    assert.equal(
      plainText(parseMarkdown("## Title\n\nSome **bold** and [a link](/x).\n\n- one\n- two")),
      "Title Some bold and a link. one two",
    );
  });

  test("every image is found, inline and figure", () => {
    assert.deepEqual(
      imageSources(parseMarkdown("![a](/a.png)\n\ntext ![b](https://x.r2.dev/b.png)\n\n> - ![c](/c.png) c")),
      ["/a.png", "https://x.r2.dev/b.png", "/c.png"],
    );
  });

  test("inline text of an image is its description", () => {
    assert.equal(inlineText(parseInline("a ![pic](/p.png) b")), "a pic b");
  });

  test("truncation stops at a word", () => {
    assert.equal(truncateText("one two three four", 50), "one two three four");
    assert.equal(truncateText("one two three four five six", 15), "one two three…");
  });
});
