/**
 * The console's list of blog posts.
 *
 * What matters: a request's query is read defensively (bad values fall back
 * to defaults), a post is listed by whichever title it has, and every sort is
 * stable and puts never-published posts last.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { parseBlogListQuery, rowLanguages, sortBlogRows, type BlogListRow } from "@/lib/blog/admin-list";

describe("parseBlogListQuery", () => {
  test("defaults: everything, newest change first, 25 a page", () => {
    assert.deepEqual(parseBlogListQuery(new URLSearchParams()), {
      search: "",
      status: "all",
      page: 1,
      pageSize: 25,
      sort: "updated",
      direction: "desc",
    });
  });

  test("bad values fall back rather than fail", () => {
    const query = parseBlogListQuery(
      new URLSearchParams("status=deleted&page=-3&pageSize=1000&sort=password&direction=sideways"),
    );
    assert.equal(query.status, "all");
    assert.equal(query.page, 1);
    assert.equal(query.pageSize, 25);
    assert.equal(query.sort, "updated");
  });

  test("valid values are kept", () => {
    const query = parseBlogListQuery(
      new URLSearchParams("status=draft&page=3&pageSize=10&sort=title&direction=desc&search=%20rent%20"),
    );
    assert.deepEqual(query, {
      search: "rent",
      status: "draft",
      page: 3,
      pageSize: 10,
      sort: "title",
      direction: "desc",
    });
  });
});

function row(id: string, overrides: Partial<BlogListRow>): BlogListRow {
  return {
    id,
    slug: id,
    status: "draft",
    titleEn: "",
    titleAr: "",
    publishedAt: null,
    updatedAt: "2026-10-01T00:00:00Z",
    tags: [],
    languages: { en: "empty", ar: "empty" },
    ...overrides,
  };
}

describe("sortBlogRows", () => {
  const rows = [
    row("a", { titleEn: "Zebra", updatedAt: "2026-10-03T00:00:00Z", status: "published", publishedAt: "2026-09-01T00:00:00Z" }),
    row("b", { titleAr: "إيجار", updatedAt: "2026-10-02T00:00:00Z" }),
    row("c", { titleEn: "apple", updatedAt: "2026-10-01T00:00:00Z", status: "published", publishedAt: "2026-10-01T00:00:00Z" }),
  ];

  test("by title, whichever language it is in, ignoring case", () => {
    assert.deepEqual(sortBlogRows(rows, "title", "asc").map((r) => r.id), ["c", "a", "b"]);
  });

  test("by publication date, never-published last both ways", () => {
    assert.deepEqual(sortBlogRows(rows, "published", "desc").map((r) => r.id), ["c", "a", "b"]);
    assert.deepEqual(sortBlogRows(rows, "published", "asc").map((r) => r.id), ["a", "c", "b"]);
  });

  test("by last change", () => {
    assert.deepEqual(sortBlogRows(rows, "updated", "desc").map((r) => r.id), ["a", "b", "c"]);
  });

  test("by status, ties by last change", () => {
    assert.deepEqual(sortBlogRows(rows, "status", "asc").map((r) => r.id), ["b", "a", "c"]);
  });
});

describe("rowLanguages", () => {
  test("a title and content make a language; one of them is partial", () => {
    const languages = rowLanguages(
      { id: "x", titleEn: "Rent", titleAr: "الإيجار" },
      { en: new Set(["x"]), ar: new Set() },
    );
    assert.deepEqual(languages, { en: "complete", ar: "partial" });
  });
});
