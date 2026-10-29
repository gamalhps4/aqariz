/**
 * Which languages a blog post is in.
 *
 * One row holds both languages, and each blog shows only its own. What
 * matters: a language exists only with both a title and content (an excerpt
 * or a title alone is not a post), a draft needs a name, a published post
 * needs one whole language, and the console names a post by whichever title
 * it has.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  canPublish,
  displayTitle,
  hasAnyTitle,
  hasLanguage,
  languageState,
  localizePost,
  postLanguages,
} from "@/lib/blog/languages";

const empty = {
  titleEn: "",
  titleAr: "",
  excerptEn: "",
  excerptAr: "",
  contentEn: "",
  contentAr: "",
};

describe("languages of a post", () => {
  test("English only, Arabic only, both, neither", () => {
    assert.deepEqual(postLanguages({ ...empty, titleEn: "Rent", contentEn: "Body" }), ["en"]);
    assert.deepEqual(postLanguages({ ...empty, titleAr: "الإيجار", contentAr: "نص" }), ["ar"]);
    assert.deepEqual(
      postLanguages({ ...empty, titleEn: "Rent", contentEn: "Body", titleAr: "الإيجار", contentAr: "نص" }),
      ["en", "ar"],
    );
    assert.deepEqual(postLanguages(empty), []);
  });

  test("a title without content, or content without a title, is not a language", () => {
    assert.equal(hasLanguage({ ...empty, titleEn: "Rent" }, "en"), false);
    assert.equal(hasLanguage({ ...empty, contentAr: "نص" }, "ar"), false);
    assert.equal(languageState({ ...empty, titleEn: "Rent" }, "en"), "partial");
    assert.equal(languageState({ ...empty, contentEn: "Body" }, "en"), "partial");
    assert.equal(languageState(empty, "ar"), "empty");
  });

  test("whitespace is not text", () => {
    assert.equal(hasLanguage({ ...empty, titleEn: "  ", contentEn: "\n\n" }, "en"), false);
    assert.equal(languageState({ ...empty, titleEn: " ", contentEn: " " }, "en"), "empty");
  });

  test("one language's text never counts for the other", () => {
    const english = { ...empty, titleEn: "Rent", contentEn: "Body", excerptAr: "مقتطف" };
    assert.equal(hasLanguage(english, "ar"), false);
  });
});

describe("what a save needs", () => {
  test("publishing needs one whole language", () => {
    assert.equal(canPublish(empty), false);
    assert.equal(canPublish({ ...empty, titleEn: "Rent" }), false);
    assert.equal(canPublish({ ...empty, titleEn: "Rent", contentAr: "نص" }), false);
    assert.equal(canPublish({ ...empty, titleAr: "الإيجار", contentAr: "نص" }), true);
  });

  test("a draft needs a title in either language", () => {
    assert.equal(hasAnyTitle(empty), false);
    assert.equal(hasAnyTitle({ ...empty, titleAr: "مسودة" }), true);
  });
});

describe("naming and localizing a post", () => {
  test("the English title first, else the Arabic", () => {
    assert.deepEqual(displayTitle({ titleEn: " Rent ", titleAr: "الإيجار" }), { title: "Rent", lang: "en" });
    assert.deepEqual(displayTitle({ titleEn: "", titleAr: "الإيجار" }), { title: "الإيجار", lang: "ar" });
  });

  test("each language reads its own fields; a cover without a description is decorative", () => {
    const post = {
      ...empty,
      titleEn: "Rent",
      titleAr: "الإيجار",
      excerptAr: "مقتطف",
      contentAr: "نص",
      seoTitleAr: "عنوان البحث",
      coverImageAlt: "A villa",
      coverImageAltAr: null,
    };
    const arabic = localizePost(post, "ar");
    assert.equal(arabic.title, "الإيجار");
    assert.equal(arabic.excerpt, "مقتطف");
    assert.equal(arabic.seoTitle, "عنوان البحث");
    assert.equal(arabic.coverAlt, "");
    assert.equal(localizePost(post, "en").coverAlt, "A villa");
    assert.equal(localizePost(post, "en").seoDescription, "");
  });
});
