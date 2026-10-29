/**
 * What the console may save for the homepage's custom sections and its Arabic.
 *
 * A custom section's button and image are written into the public page's
 * `href` and `src` as typed, so only paths on this site, anchors and http(s)
 * addresses get through. The section list may name `custom:<id>` slots beside
 * the eight built-ins, within a cap; ids are what place a section and key its
 * Arabic, so they must be well formed and unique.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { landingUpdateSchema } from "@/lib/validations";
import {
  DEFAULT_LANDING,
  MAX_CUSTOM_SECTIONS,
  emptyCustomSection,
  type CustomSection,
} from "@/lib/marketing/landing-types";

/** The default document as the console sends it, plus overrides. */
function payload(extra: Record<string, unknown> = {}) {
  const { translations: _translations, ...english } = structuredClone(DEFAULT_LANDING);
  return { ...english, ...extra };
}

function section(id: string, patch: Partial<CustomSection> = {}): CustomSection {
  return { ...emptyCustomSection(id), heading: "Why us", ...patch };
}

describe("landingUpdateSchema — custom sections", () => {
  test("a document from before custom sections still saves", () => {
    const result = landingUpdateSchema.safeParse(payload());
    assert.equal(result.success, true);
    assert.deepEqual(result.success && result.data.customSections, []);
  });

  test("a section and its slot are accepted", () => {
    const result = landingUpdateSchema.safeParse(
      payload({
        sections: [
          ...DEFAULT_LANDING.sections,
          { key: "custom:why-us", enabled: false, order: 8 },
        ],
        customSections: [
          section("why-us", {
            body: "First paragraph with **bold**.\n\nSecond paragraph.",
            image: "/images/marketing/hero-visual.jpg",
            imagePosition: "start",
            ctaLabel: "See pricing",
            ctaHref: "/pricing#plans",
            background: "tinted",
          }),
        ],
      }),
    );
    assert.equal(result.success, true, JSON.stringify(!result.success && result.error.issues));
  });

  test("an unknown section key is refused", () => {
    const result = landingUpdateSchema.safeParse(
      payload({
        sections: [...DEFAULT_LANDING.sections, { key: "banner", enabled: true, order: 8 }],
      }),
    );
    assert.equal(result.success, false);
  });

  test("script, data and protocol-relative links are refused on the button and the image", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "//evil.example"]) {
      for (const field of ["ctaHref", "image"] as const) {
        const result = landingUpdateSchema.safeParse(
          payload({ customSections: [section("a", { [field]: bad })] }),
        );
        assert.equal(result.success, false, `${field}=${bad}`);
      }
    }
  });

  test("https links and site paths are accepted", () => {
    for (const href of ["https://example.com/offer", "/contact", "#pricing", ""]) {
      const result = landingUpdateSchema.safeParse(
        payload({ customSections: [section("a", { ctaHref: href })] }),
      );
      assert.equal(result.success, true, href);
    }
  });

  test("ids must be well formed and unique", () => {
    assert.equal(
      landingUpdateSchema.safeParse(payload({ customSections: [section("Bad Id")] })).success,
      false,
    );
    assert.equal(
      landingUpdateSchema.safeParse(payload({ customSections: [section("a"), section("a")] })).success,
      false,
    );
  });

  test("layout and background take only the offered values", () => {
    assert.equal(
      landingUpdateSchema.safeParse(
        payload({ customSections: [{ ...section("a"), imagePosition: "left" }] }),
      ).success,
      false,
    );
    assert.equal(
      landingUpdateSchema.safeParse(
        payload({ customSections: [{ ...section("a"), background: "red" }] }),
      ).success,
      false,
    );
  });

  test("counts and lengths are capped", () => {
    const many = Array.from({ length: MAX_CUSTOM_SECTIONS + 1 }, (_, index) => section(`s${index}`));
    assert.equal(landingUpdateSchema.safeParse(payload({ customSections: many })).success, false);
    assert.equal(
      landingUpdateSchema.safeParse(
        payload({ customSections: [section("a", { heading: "x".repeat(161) })] }),
      ).success,
      false,
    );
    assert.equal(
      landingUpdateSchema.safeParse(
        payload({ customSections: [section("a", { body: "x".repeat(4001) })] }),
      ).success,
      false,
    );
  });
});

describe("landingUpdateSchema — the Arabic overlay", () => {
  test("text in the blocks' shape is accepted", () => {
    const result = landingUpdateSchema.safeParse(
      payload({
        translations: {
          ar: {
            hero: { eyebrow: "منصة متكاملة", bullets: ["", "تجربة مجانية"] },
            custom: { a: { heading: "لماذا نحن" } },
            seo: { title: "إدارة العقارات" },
          },
        },
      }),
    );
    assert.equal(result.success, true);
  });

  test("anything but text, lists and objects is refused", () => {
    const result = landingUpdateSchema.safeParse(
      payload({ translations: { ar: { hero: { eyebrow: 42 } } } }),
    );
    assert.equal(result.success, false);
  });
});
