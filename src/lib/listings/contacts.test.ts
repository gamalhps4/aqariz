/**
 * The numbers and pictures on a listing: phones in the forms a Saudi office
 * and its visitors actually type, and which photo addresses a page may draw.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { parsePhone, telUrl, toWesternDigits, whatsappUrl } from "@/lib/listings/phone";
import {
  effectivePhotos,
  isRenderablePhotoUrl,
  isStorablePhotoUrl,
  renderablePhotos,
} from "@/lib/listings/photos";

describe("phone numbers", () => {
  test("every common way of writing one Saudi mobile reads as the same number", () => {
    for (const written of [
      "0501234567",
      "050 123 4567",
      "+966501234567",
      "+966 50 123 4567",
      "00966501234567",
      "966501234567",
      "(050) 123-4567",
      "٠٥٠١٢٣٤٥٦٧",
      "+٩٦٦٥٠١٢٣٤٥٦٧",
    ]) {
      assert.equal(parsePhone(written)?.e164, "+966501234567", written);
    }
  });

  test("a number from another country is read as written", () => {
    assert.equal(parsePhone("+971 50 123 4567")?.e164, "+971501234567");
    assert.equal(parsePhone("+44 7911 123456")?.e164, "+447911123456");
  });

  test("a landline with its area code is a number too", () => {
    assert.equal(parsePhone("011 234 5678")?.e164, "+966112345678");
  });

  test("anything else is not", () => {
    for (const bad of ["", "   ", "abc", "12345", "050123", "+966 12", null, undefined, 5, {}]) {
      assert.equal(parsePhone(bad), null, String(bad));
    }
  });

  test("links are built from the stored number", () => {
    assert.equal(whatsappUrl("+966501234567"), "https://wa.me/966501234567");
    assert.equal(
      whatsappUrl("+966501234567", "مرحبا"),
      "https://wa.me/966501234567?text=%D9%85%D8%B1%D8%AD%D8%A8%D8%A7",
    );
    assert.equal(telUrl("+966501234567"), "tel:+966501234567");
    assert.equal(telUrl("966501234567"), "tel:+966501234567");
  });

  test("Arabic digits become digits", () => {
    assert.equal(toWesternDigits("٠١٢٣٤٥٦٧٨٩ ۰۱۲۳۴۵۶۷۸۹"), "0123456789 0123456789");
  });
});

describe("photo addresses", () => {
  test("a web address or a site path may be stored", () => {
    assert.equal(isStorablePhotoUrl("https://pub-abc.r2.dev/a.jpg"), true);
    assert.equal(isStorablePhotoUrl("http://example.com/a.jpg"), true);
    assert.equal(isStorablePhotoUrl("/uploads/a.jpg"), true);
  });

  test("nothing else may — no scripts, no protocol-relative addresses, no spaces", () => {
    for (const bad of [
      "javascript:alert(1)",
      "data:image/png;base64,AAAA",
      "//evil.example/a.jpg",
      "ftp://example.com/a.jpg",
      "https://example.com/a b.jpg",
      "",
      "   ",
      "x".repeat(1001),
      null,
      42,
    ]) {
      assert.equal(isStorablePhotoUrl(bad), false, String(bad));
    }
  });

  test("a page only draws what the image optimiser would fetch", () => {
    assert.equal(isRenderablePhotoUrl("/uploads/a.jpg"), true);
    assert.equal(isRenderablePhotoUrl("https://pub-abc.r2.dev/a.jpg"), true);
    assert.equal(isRenderablePhotoUrl("https://picsum.photos/seed/x/800/600"), true);
    assert.equal(isRenderablePhotoUrl("https://evil.example/a.jpg"), false);
    assert.equal(isRenderablePhotoUrl("https://r2.dev.evil.example/a.jpg"), false);
    assert.equal(
      isRenderablePhotoUrl("https://media.office.example/a.jpg", "https://media.office.example"),
      true,
    );
    assert.equal(
      isRenderablePhotoUrl("https://other.example/a.jpg", "https://media.office.example"),
      false,
    );
  });

  test("a listing's own photos win, then the unit's, then the building's", () => {
    const unit = { images: ["/u1.jpg", "/u2.jpg"] };
    const property = { images: ["/p1.jpg"] };
    assert.deepEqual(effectivePhotos({ photos: ["/mine.jpg"] }, unit, property), ["/mine.jpg"]);
    assert.deepEqual(effectivePhotos({ photos: [] }, unit, property), ["/u1.jpg", "/u2.jpg"]);
    assert.deepEqual(effectivePhotos({ photos: [] }, { images: [] }, property), ["/p1.jpg"]);
    assert.deepEqual(effectivePhotos({ photos: [] }, null, null), []);
  });

  test("repeats and unstorable addresses are dropped, order is kept", () => {
    assert.deepEqual(
      effectivePhotos({ photos: ["/a.jpg", "/b.jpg", "/a.jpg", "javascript:x"] }),
      ["/a.jpg", "/b.jpg"],
    );
    assert.deepEqual(
      renderablePhotos(["/a.jpg", "https://evil.example/x.jpg", "https://x.r2.dev/y.jpg"]),
      ["/a.jpg", "https://x.r2.dev/y.jpg"],
    );
  });
});
