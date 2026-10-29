/**
 * Where each homepage section goes.
 *
 * The console stores an ordered on/off list of the eight built-in sections and
 * the operator's own (`custom:<id>`). A custom section keeps its place and its
 * switch; one whose content was deleted loses its slot; one with content but
 * no slot still shows; and nothing can take two places.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_LANDING,
  LANDING_SECTION_KEYS,
} from "@/lib/marketing/landing-types";
import {
  mergeSections,
  normalizeCustomSections,
  toLandingData,
} from "@/lib/marketing/landing-merge";

const keysOf = (sections: { key: string }[]) => sections.map((s) => s.key);

describe("mergeSections", () => {
  test("nothing stored: the eight built-ins in their default order", () => {
    assert.deepEqual(keysOf(mergeSections(undefined)), [...LANDING_SECTION_KEYS]);
  });

  test("custom sections are kept where they were stored, with their switch", () => {
    const stored = [
      { key: "hero", enabled: true, order: 0 },
      { key: "custom:intro", enabled: true, order: 1 },
      { key: "product", enabled: true, order: 2 },
      { key: "features", enabled: true, order: 3 },
      { key: "howItWorks", enabled: true, order: 4 },
      { key: "testimonial", enabled: true, order: 5 },
      { key: "pricing", enabled: true, order: 6 },
      { key: "custom:faq", enabled: false, order: 7 },
      { key: "cta", enabled: true, order: 8 },
      { key: "footer", enabled: true, order: 9 },
    ];
    const merged = mergeSections(stored, [{ id: "faq" }, { id: "intro" }]);
    assert.deepEqual(keysOf(merged), [
      "hero",
      "custom:intro",
      "product",
      "features",
      "howItWorks",
      "testimonial",
      "pricing",
      "custom:faq",
      "cta",
      "footer",
    ]);
    assert.equal(merged.find((s) => s.key === "custom:faq")?.enabled, false);
    assert.deepEqual(merged.map((s) => s.order), merged.map((_, index) => index));
  });

  test("a custom slot whose content is gone is dropped", () => {
    const stored = [
      { key: "hero", enabled: true, order: 0 },
      { key: "custom:deleted", enabled: true, order: 1 },
    ];
    const merged = mergeSections(stored, []);
    assert.equal(keysOf(merged).includes("custom:deleted"), false);
    assert.equal(merged.length, LANDING_SECTION_KEYS.length);
  });

  test("content with no slot is shown last rather than lost", () => {
    const merged = mergeSections(
      DEFAULT_LANDING.sections,
      [{ id: "orphan" }],
    );
    assert.equal(merged.at(-1)?.key, "custom:orphan");
    assert.equal(merged.at(-1)?.enabled, true);
  });

  test("a key stored twice takes one place; malformed keys are ignored", () => {
    const stored = [
      { key: "custom:x", enabled: true, order: 0 },
      { key: "custom:x", enabled: false, order: 5 },
      { key: "custom:Bad Id", enabled: true, order: 1 },
      { key: "nonsense", enabled: true, order: 2 },
    ];
    const merged = mergeSections(stored, [{ id: "x" }]);
    assert.equal(keysOf(merged).filter((key) => key === "custom:x").length, 1);
    // The first entry wins: shown, in the first slot after the built-in that
    // shares its stored order.
    const slot = merged.find((s) => s.key === "custom:x");
    assert.equal(slot?.enabled, true);
    assert.equal(keysOf(merged).indexOf("custom:x"), 1);
    assert.equal(merged.length, LANDING_SECTION_KEYS.length + 1);
  });

  test("a built-in added after the document was saved still lands at its default place", () => {
    const stored = LANDING_SECTION_KEYS.filter((key) => key !== "howItWorks").map(
      (key, order) => ({ key, enabled: true, order }),
    );
    const merged = mergeSections(stored, []);
    assert.equal(keysOf(merged).indexOf("howItWorks"), keysOf(merged).indexOf("features") + 1);
  });
});

describe("normalizeCustomSections", () => {
  test("fills missing fields and keeps the kinds the renderer expects", () => {
    const [section] = normalizeCustomSections([
      { id: "promo", heading: "Hi", imagePosition: "sideways", background: 3 },
    ]);
    assert.deepEqual(section, {
      id: "promo",
      heading: "Hi",
      body: "",
      image: "",
      imageAlt: "",
      imagePosition: "end",
      ctaLabel: "",
      ctaHref: "",
      background: "white",
    });
  });

  test("drops entries without a usable id, and repeats of an id", () => {
    const sections = normalizeCustomSections([
      { id: "a" },
      { id: "a", heading: "again" },
      { id: "Not Valid" },
      { heading: "no id" },
      null,
      "text",
    ]);
    assert.deepEqual(sections.map((s) => s.id), ["a"]);
  });

  test("anything but a list is no sections", () => {
    assert.deepEqual(normalizeCustomSections(null), []);
    assert.deepEqual(normalizeCustomSections({ id: "a" }), []);
  });
});

describe("toLandingData", () => {
  test("no document: the defaults, with the shipped Arabic resolved", () => {
    const data = toLandingData(null);
    assert.deepEqual(data.sections, DEFAULT_LANDING.sections);
    assert.deepEqual(data.hero, DEFAULT_LANDING.hero);
    assert.deepEqual(data.customSections, []);
    assert.equal(typeof data.translations.ar?.hero?.eyebrow, "string");
  });

  test("custom sections place themselves through the stored section list", () => {
    const data = toLandingData({
      sections: [
        ...DEFAULT_LANDING.sections.slice(0, 2),
        { key: "custom:about", enabled: true, order: 1.5 },
      ],
      customSections: [{ id: "about", heading: "About us" }],
    });
    assert.deepEqual(keysOf(data.sections).slice(0, 3), ["hero", "product", "custom:about"]);
    assert.equal(data.customSections[0].heading, "About us");
  });
});

describe("the CTA price line", () => {
  test("the old dollar default reads as today's riyal one, with its Arabic", () => {
    const data = toLandingData({
      cta: { ...DEFAULT_LANDING.cta, priceLink: { label: "100 units at $29", href: "/pricing" } },
    });
    assert.equal(data.cta.priceLink.label, "100 units at SAR 29");
    assert.equal(data.translations.ar?.cta?.priceLink?.label, "100 وحدة بـ 29 ريالًا");
  });

  test("a line the operator wrote is left alone", () => {
    const data = toLandingData({
      cta: { ...DEFAULT_LANDING.cta, priceLink: { label: "From SAR 99 a month", href: "/pricing" } },
    });
    assert.equal(data.cta.priceLink.label, "From SAR 99 a month");
  });
});
