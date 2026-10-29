/**
 * Where the blog's pages are, and the language switch between them.
 *
 * What matters: every page has exactly one address (page 1 is /blog, not
 * /blog/page/1), malformed addresses are recognised before any database read,
 * and the header's switch takes a post to its other language only when the
 * post has it — otherwise to the other language's blog, never to a 404.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  BLOG_PAGE_SIZE,
  blogIndexPath,
  blogPageCount,
  blogPostPath,
  isBlogSlugParam,
  parseBlogPageParam,
  parseBlogPath,
} from "@/lib/blog/paths";
import {
  alternateLanguagePath,
  languagePair,
  localizeHref,
  marketingLangOf,
} from "@/lib/marketing/landing-i18n";

describe("blog addresses", () => {
  test("index, numbered pages and posts in both languages", () => {
    assert.equal(blogIndexPath("en"), "/blog");
    assert.equal(blogIndexPath("ar"), "/ar/blog");
    assert.equal(blogIndexPath("en", 1), "/blog");
    assert.equal(blogIndexPath("en", 2), "/blog/page/2");
    assert.equal(blogIndexPath("ar", 3), "/ar/blog/page/3");
    assert.equal(blogPostPath("rent-tips", "en"), "/blog/rent-tips");
    assert.equal(blogPostPath("rent-tips", "ar"), "/ar/blog/rent-tips");
  });

  test("pages of nine; an empty blog is one page", () => {
    assert.equal(BLOG_PAGE_SIZE, 9);
    assert.equal(blogPageCount(0), 1);
    assert.equal(blogPageCount(9), 1);
    assert.equal(blogPageCount(10), 2);
    assert.equal(blogPageCount(27), 3);
  });

  test("a page segment is a whole number from 2, written plainly", () => {
    assert.equal(parseBlogPageParam("2"), 2);
    assert.equal(parseBlogPageParam("15"), 15);
    for (const value of ["1", "0", "02", "-2", "2.5", "two", "", "1e3", undefined]) {
      assert.equal(parseBlogPageParam(value), null, String(value));
    }
  });

  test("a slug segment must be shaped like a slug", () => {
    assert.equal(isBlogSlugParam("rent-tips"), true);
    for (const value of ["Rent", "rent tips", "%D8%A7", "إيجار", "a/b", "", undefined]) {
      assert.equal(isBlogSlugParam(value), false, String(value));
    }
  });

  test("reading a path back", () => {
    assert.deepEqual(parseBlogPath("/blog"), { kind: "index", lang: "en" });
    assert.deepEqual(parseBlogPath("/ar/blog/"), { kind: "index", lang: "ar" });
    assert.deepEqual(parseBlogPath("/blog/page/3"), { kind: "page", lang: "en", page: 3 });
    assert.deepEqual(parseBlogPath("/ar/blog/rent-tips"), { kind: "post", lang: "ar", slug: "rent-tips" });
    assert.deepEqual(parseBlogPath("/blog/rent-tips?x=1#y"), { kind: "post", lang: "en", slug: "rent-tips" });
    assert.equal(parseBlogPath("/blogs"), null);
    assert.equal(parseBlogPath("/pricing"), null);
    assert.equal(parseBlogPath("/ar"), null);
  });
});

describe("the language switch on the blog", () => {
  const twins = ["both-languages"];

  test("the index goes to the other index", () => {
    assert.equal(alternateLanguagePath("/blog"), "/ar/blog");
    assert.equal(alternateLanguagePath("/ar/blog"), "/blog");
    assert.equal(alternateLanguagePath("/blog/"), "/ar/blog");
  });

  test("a post in both languages goes to its twin", () => {
    assert.equal(alternateLanguagePath("/blog/both-languages", twins), "/ar/blog/both-languages");
    assert.equal(alternateLanguagePath("/ar/blog/both-languages", twins), "/blog/both-languages");
  });

  test("a post in one language goes to the other blog's index", () => {
    assert.equal(alternateLanguagePath("/blog/english-only", twins), "/ar/blog");
    assert.equal(alternateLanguagePath("/ar/blog/arabic-only", twins), "/blog");
    assert.equal(alternateLanguagePath("/blog/both-languages"), "/ar/blog");
  });

  test("a numbered page goes to the other blog's first page", () => {
    assert.equal(alternateLanguagePath("/blog/page/3", twins), "/ar/blog");
    assert.equal(alternateLanguagePath("/ar/blog/page/2", twins), "/blog");
  });

  test("the other pages still switch as before", () => {
    assert.equal(alternateLanguagePath("/pricing", twins), "/ar/pricing");
    assert.equal(alternateLanguagePath("/ar/terms", twins), "/");
    assert.equal(alternateLanguagePath("/terms", twins), "/ar");
  });

  test("the blog is a page pair, and Arabic content links to the Arabic blog", () => {
    assert.deepEqual(languagePair("/blog"), { en: "/blog", ar: "/ar/blog" });
    assert.equal(localizeHref("/blog", "ar"), "/ar/blog");
    assert.equal(localizeHref("/blog", "en"), "/blog");
    // A post's link is left alone: it may have no Arabic.
    assert.equal(localizeHref("/blog/english-only", "ar"), "/blog/english-only");
    assert.equal(marketingLangOf("/ar/blog/x"), "ar");
    assert.equal(marketingLangOf("/blog/x"), "en");
  });
});
