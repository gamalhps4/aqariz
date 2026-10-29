/**
 * The pricing cards on the Arabic pages.
 *
 * Each field comes from the plan's Arabic where it was given, else the shipped
 * Arabic of the seeded wording (only while the English is still that wording),
 * else the English — never blank, and never a translation of a line the
 * operator rewrote. Prices, links and flags are untouched.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { localizePlan, normalizePlanTranslations } from "@/lib/billing/plan-i18n";
import type { BillingPlanDefinition } from "@/lib/billing/plan-constants";

function plan(patch: Partial<BillingPlanDefinition> = {}): BillingPlanDefinition {
  return {
    key: "starter",
    name: "Starter",
    description: "For small property-management teams.",
    monthlyPrice: 29,
    yearlyPrice: null,
    annualEnabled: false,
    yearlyDiscountPercent: 0,
    yearlyPriceOverride: false,
    isCustom: false,
    priceSuffix: "per month",
    stripePriceId: null,
    stripePriceIdYearly: null,
    limits: {} as BillingPlanDefinition["limits"],
    features: [],
    modules: [],
    highlights: ["Up to 25 properties", "Owner statements"],
    featuresHeader: "Everything in Free +",
    ctaLabel: "Start free trial",
    ctaHref: "/auth/signup",
    popular: false,
    isPublic: true,
    isActive: true,
    isSystem: false,
    sortOrder: 1,
    ...patch,
  };
}

describe("localizePlan", () => {
  test("English is the plan unchanged", () => {
    const source = plan();
    assert.equal(localizePlan(source, "en"), source);
  });

  test("the seeded wording reads in Arabic with nothing entered", () => {
    const card = localizePlan(plan(), "ar");
    assert.equal(card.name, "الأساسية");
    assert.equal(card.priceSuffix, "شهريًا");
    assert.equal(card.ctaLabel, "ابدأ تجربتك المجانية");
    assert.equal(card.featuresHeader, "كل ما في المجانية +");
    assert.equal(card.highlights[0], "حتى 25 عقارًا");
    // A bullet the operator wrote has no shipped Arabic: it stays English.
    assert.equal(card.highlights[1], "Owner statements");
  });

  test("the plan's own Arabic outranks everything, field by field", () => {
    const card = localizePlan(
      plan({
        translations: {
          ar: { name: "المبتدئة", highlights: ["", "كشوف الملاك"] },
        },
      }),
      "ar",
    );
    assert.equal(card.name, "المبتدئة");
    assert.deepEqual(card.highlights, ["حتى 25 عقارًا", "كشوف الملاك"]);
    assert.equal(card.description, "لفرق إدارة العقارات الصغيرة.");
  });

  test("a rewritten English line is never shown the seeded Arabic", () => {
    const card = localizePlan(plan({ name: "Starter Plus", priceSuffix: "per office" }), "ar");
    assert.equal(card.name, "Starter Plus");
    assert.equal(card.priceSuffix, "per office");
  });

  test("prices, links and flags are untouched; extra Arabic bullets are ignored", () => {
    const source = plan({
      translations: { ar: { highlights: ["أ", "ب", "ج"] } },
      popular: true,
    });
    const card = localizePlan(source, "ar");
    assert.equal(card.monthlyPrice, 29);
    assert.equal(card.ctaHref, "/auth/signup");
    assert.equal(card.popular, true);
    assert.equal(card.highlights.length, 2);
  });
});

describe("normalizePlanTranslations", () => {
  test("keeps known non-empty fields, trims, and drops trailing empty bullets", () => {
    assert.deepEqual(
      normalizePlanTranslations({
        ar: { name: "  الأعمال ", description: "", highlights: ["", "دعم", "", " "], other: "x" },
      }),
      { ar: { name: "الأعمال", highlights: ["", "دعم"] } },
    );
  });

  test("no Arabic at all is null", () => {
    assert.equal(normalizePlanTranslations(null), null);
    assert.equal(normalizePlanTranslations({}), null);
    assert.equal(normalizePlanTranslations({ ar: { name: " ", highlights: ["", ""] } }), null);
  });
});
