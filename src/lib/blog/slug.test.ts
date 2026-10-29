/**
 * Blog post addresses.
 *
 * A slug is the one part of a post's address both languages share, so it
 * must be a plain URL segment: lowercase ASCII words and single hyphens. What
 * matters: titles become readable slugs, an Arabic title (nothing Latin to
 * work from) falls back to a placeholder rather than an empty or encoded
 * slug, the words the blog's own routes use are never handed out, and a made
 * up slug never collides.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  BLOG_SLUG_MAX_LENGTH,
  fallbackBlogSlug,
  isValidBlogSlug,
  slugify,
  suggestBlogSlug,
  uniqueBlogSlug,
} from "@/lib/blog/slug";

describe("slugify", () => {
  test("words joined by single hyphens, lowercase", () => {
    assert.equal(slugify("How to Collect Rent on Time"), "how-to-collect-rent-on-time");
    assert.equal(slugify("  Rent -- reminders!!  "), "rent-reminders");
    assert.equal(slugify("Q3 2026: what changed?"), "q3-2026-what-changed");
  });

  test("accents fold, apostrophes vanish, ampersands read as 'and'", () => {
    assert.equal(slugify("Café résumé"), "cafe-resume");
    assert.equal(slugify("Don't miss a payment"), "dont-miss-a-payment");
    assert.equal(slugify("Landlord’s guide"), "landlords-guide");
    assert.equal(slugify("Leases & renewals"), "leases-and-renewals");
  });

  test("Arabic, emoji and punctuation alone give nothing", () => {
    assert.equal(slugify("كيف تحصّل الإيجار"), "");
    assert.equal(slugify("🏠🏠"), "");
    assert.equal(slugify("---"), "");
    assert.equal(slugify(""), "");
  });

  test("Arabic with Latin words keeps the Latin", () => {
    assert.equal(slugify("دليل ZATCA 2026"), "zatca-2026");
  });

  test("cut to the limit without a trailing hyphen", () => {
    const slug = slugify("word ".repeat(60));
    assert.ok(slug.length <= BLOG_SLUG_MAX_LENGTH);
    assert.ok(!slug.endsWith("-"));
    assert.ok(isValidBlogSlug(slug));
  });

  test("whatever goes in, what comes out is valid or empty", () => {
    for (const title of ["<script>alert(1)</script>", "../../etc/passwd", "a/b\\c", "%2F%2E", "javascript:alert(1)"]) {
      const slug = slugify(title);
      assert.ok(slug === "" || isValidBlogSlug(slug), `${title} → ${slug}`);
    }
  });
});

describe("isValidBlogSlug", () => {
  test("plain lowercase words and digits", () => {
    for (const slug of ["rent", "rent-2026", "a", "2026", "a-b-c"]) {
      assert.equal(isValidBlogSlug(slug), true, slug);
    }
  });

  test("anything a URL would need to encode, or could misread, is refused", () => {
    for (const slug of [
      "",
      "Rent",
      "rent--day",
      "-rent",
      "rent-",
      "rent day",
      "rent/day",
      "..",
      "rent.html",
      "إيجار",
      "a".repeat(BLOG_SLUG_MAX_LENGTH + 1),
    ]) {
      assert.equal(isValidBlogSlug(slug), false, slug);
    }
  });

  test("the blog's own route words are reserved", () => {
    assert.equal(isValidBlogSlug("page"), false);
    assert.equal(isValidBlogSlug("feed"), false);
    assert.equal(isValidBlogSlug("pages"), true);
  });
});

describe("suggestBlogSlug", () => {
  test("from the English title", () => {
    assert.equal(suggestBlogSlug("Hello World", 0), "hello-world");
  });

  test("an Arabic-only post gets a neutral placeholder", () => {
    const slug = suggestBlogSlug("", 1_760_000_000_000);
    assert.equal(slug, fallbackBlogSlug(1_760_000_000_000));
    assert.match(slug, /^post-[a-z0-9]+$/);
    assert.ok(isValidBlogSlug(slug));
  });

  test("a reserved word is nudged off", () => {
    assert.equal(suggestBlogSlug("Page"), "page-post");
    assert.ok(isValidBlogSlug(suggestBlogSlug("RSS")));
  });
});

describe("uniqueBlogSlug", () => {
  test("free slugs are kept, taken ones numbered", () => {
    assert.equal(uniqueBlogSlug("rent", new Set()), "rent");
    assert.equal(uniqueBlogSlug("rent", new Set(["rent"])), "rent-2");
    assert.equal(uniqueBlogSlug("rent", new Set(["rent", "rent-2", "rent-3"])), "rent-4");
  });

  test("the suffix fits inside the limit", () => {
    const long = "a".repeat(BLOG_SLUG_MAX_LENGTH);
    const slug = uniqueBlogSlug(long, new Set([long]));
    assert.equal(slug.length, BLOG_SLUG_MAX_LENGTH);
    assert.ok(slug.endsWith("-2"));
    assert.ok(isValidBlogSlug(slug));
  });
});
