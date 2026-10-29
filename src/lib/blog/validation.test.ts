/**
 * What a blog post may hold.
 *
 * Every console write passes these checks before it is stored. What matters:
 * lengths and counts are bounded, tags are tidied, blank optional fields are
 * stored as "not set", the language rules hold (a name to save, a whole
 * language to publish), the slug is a clean address, and no image is accepted
 * from a host the site's security policy would block.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  BLOG_LIMITS,
  EMPTY_BLOG_POST,
  blogPostCreateSchema,
  blogPostPatchSchema,
  blogPostProblem,
  isAllowedImageUrl,
  mergeBlogPost,
  normalizeTags,
  type BlogPostDraft,
} from "@/lib/blog/validation";

const HOSTS = ["*.r2.dev", "cdn.propertypro.example", "app.propertypro.example"];

const english: BlogPostDraft = {
  ...EMPTY_BLOG_POST,
  slug: "rent-tips",
  titleEn: "Rent tips",
  contentEn: "Pay on time.",
};

const problem = (post: Partial<BlogPostDraft>) =>
  blogPostProblem({ ...english, ...post }, { imageHosts: HOSTS });

describe("the schema", () => {
  test("fields are trimmed and unknown keys dropped", () => {
    const parsed = blogPostCreateSchema.parse({
      titleEn: "  Rent  ",
      slug: " Rent-Tips ",
      id: "attacker-chosen",
      createdById: "someone-else",
      publishedAt: "2020-01-01",
    });
    assert.deepEqual(parsed, { titleEn: "Rent", slug: "rent-tips" });
  });

  test("lengths are bounded, with a message naming the field", () => {
    const result = blogPostPatchSchema.safeParse({ titleAr: "ع".repeat(BLOG_LIMITS.title + 1) });
    assert.equal(result.success, false);
    assert.match(result.success ? "" : result.error.issues[0].message, /Arabic title/);
    assert.equal(
      blogPostPatchSchema.safeParse({ contentEn: "x".repeat(BLOG_LIMITS.content + 1) }).success,
      false,
    );
    assert.equal(blogPostPatchSchema.safeParse({ contentEn: "x".repeat(BLOG_LIMITS.content) }).success, true);
  });

  test("status is draft or published, nothing else", () => {
    assert.equal(blogPostPatchSchema.safeParse({ status: "published" }).success, true);
    assert.equal(blogPostPatchSchema.safeParse({ status: "scheduled" }).success, false);
  });

  test("wrong types are refused, not coerced", () => {
    assert.equal(blogPostPatchSchema.safeParse({ titleEn: 12 }).success, false);
    assert.equal(blogPostPatchSchema.safeParse({ tags: "a,b" }).success, false);
    assert.equal(blogPostPatchSchema.safeParse({ tags: Array(BLOG_LIMITS.rawTags + 1).fill("t") }).success, false);
  });
});

describe("merging an edit", () => {
  test("only the given fields change; blanks become 'not set'", () => {
    const merged = mergeBlogPost(
      { ...english, seoTitleEn: "Old", authorName: "Sara" },
      { seoTitleEn: "   ", titleAr: "نصائح" },
    );
    assert.equal(merged.titleEn, "Rent tips");
    assert.equal(merged.titleAr, "نصائح");
    assert.equal(merged.seoTitleEn, null);
    assert.equal(merged.authorName, "Sara");
  });

  test("tags are tidied: spaces collapsed, blanks and repeats dropped, first spelling kept", () => {
    assert.deepEqual(normalizeTags(["  Rent  ", "rent", "", "Saudi   Arabia", "RENT", "إيجار"]), [
      "Rent",
      "Saudi Arabia",
      "إيجار",
    ]);
  });
});

describe("the rules a post must pass", () => {
  test("a complete English post passes", () => {
    assert.equal(problem({}), null);
    assert.equal(problem({ status: "published" }), null);
  });

  test("a draft needs a title; publishing needs a whole language", () => {
    assert.match(problem({ titleEn: "", contentEn: "" }) ?? "", /title/);
    assert.equal(problem({ contentEn: "" }), null);
    assert.match(problem({ contentEn: "", status: "published" }) ?? "", /published post needs/);
    assert.equal(
      problem({ titleEn: "", contentEn: "", titleAr: "نصائح", contentAr: "ادفع", status: "published" }),
      null,
    );
    assert.match(
      problem({ titleEn: "Rent", contentEn: "", titleAr: "", contentAr: "ادفع", status: "published" }) ?? "",
      /published post needs/,
    );
  });

  test("the slug must be a clean, unreserved address", () => {
    assert.match(problem({ slug: "" }) ?? "", /slug/);
    assert.match(problem({ slug: "Rent Tips" }) ?? "", /lowercase/);
    assert.match(problem({ slug: "rent--tips" }) ?? "", /lowercase/);
    assert.match(problem({ slug: "إيجار" }) ?? "", /lowercase/);
    assert.match(problem({ slug: "page" }) ?? "", /reserved/);
  });

  test("at most ten tags of forty characters", () => {
    assert.match(problem({ tags: Array.from({ length: 11 }, (_, i) => `t${i}`) }) ?? "", /at most 10/);
    assert.match(problem({ tags: ["x".repeat(41)] }) ?? "", /40 characters/);
    assert.equal(problem({ tags: Array.from({ length: 10 }, (_, i) => `t${i}`) }), null);
  });

  test("the cover must be on this site or the upload host", () => {
    assert.equal(problem({ coverImage: "https://pub-123.r2.dev/blog/a.jpg" }), null);
    assert.equal(problem({ coverImage: "/images/cover.png" }), null);
    assert.equal(problem({ coverImage: "https://cdn.propertypro.example/a.jpg" }), null);
    for (const cover of [
      "https://images.unsplash.com/a.jpg",
      "http://pub-123.r2.dev/a.jpg",
      "javascript:alert(1)",
      "data:image/png;base64,AAAA",
      "//pub-123.r2.dev/a.jpg",
      "https://r2.dev.evil.example/a.jpg",
      "https://evilr2.dev/a.jpg",
    ]) {
      assert.match(problem({ coverImage: cover }) ?? "", /cover image/, cover);
    }
  });

  test("images in either language's content are held to the same hosts", () => {
    assert.equal(problem({ contentEn: "![a](https://pub-1.r2.dev/a.png)\n\ntext" }), null);
    assert.match(
      problem({ contentAr: "نص\n\n![صورة](https://images.unsplash.com/a.jpg)", titleAr: "ع" }) ?? "",
      /Arabic content is hosted elsewhere/,
    );
    // Addresses the parser refuses never become images, so they are not
    // "hosted elsewhere" either: they publish as text.
    assert.equal(problem({ contentEn: "![a](javascript:alert(1))" }), null);
  });
});

describe("isAllowedImageUrl", () => {
  test("exact hosts and wildcard subdomains", () => {
    assert.equal(isAllowedImageUrl("https://a.r2.dev/x.png", HOSTS), true);
    assert.equal(isAllowedImageUrl("https://r2.dev/x.png", HOSTS), false);
    assert.equal(isAllowedImageUrl("https://CDN.propertypro.example/x.png", HOSTS), true);
    assert.equal(isAllowedImageUrl("https://cdn.propertypro.example.evil/x.png", HOSTS), false);
    assert.equal(isAllowedImageUrl("/x.png", []), true);
  });
});
