/**
 * The Arabic marketing pages.
 *
 * /ar is the English landing content with an Arabic overlay of its words. What
 * matters: the Arabic replaces text and nothing else — an image, a link, an
 * icon or a rating can never differ between the pages; lists follow the
 * English; internal links on /ar stay on the Arabic pages; the shipped
 * translation covers every default string and stops applying to a string the
 * operator has rewritten; and what is stored is only what the operator wrote.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_LANDING,
  type LandingData,
} from "@/lib/marketing/landing-types";
import { DEFAULT_LANDING_AR } from "@/lib/marketing/landing-ar";
import {
  SHARED_KEYS,
  alternateLanguagePath,
  arabicView,
  isSafeLandingHref,
  localizeHref,
  localizeLanding,
  marketingLangOf,
  overlayFromView,
  pruneOverlay,
  resolveArabicOverlay,
  storedArabicOverlay,
} from "@/lib/marketing/landing-i18n";
import { toLandingData } from "@/lib/marketing/landing-merge";

/** The defaults with a given Arabic overlay (unresolved). */
function withArabic(overlay: LandingData["translations"]["ar"]): LandingData {
  return { ...structuredClone(DEFAULT_LANDING), translations: { ar: overlay } };
}

/** Every translatable string leaf of a value, with its path. */
function textLeaves(value: unknown, path = ""): Array<[string, string]> {
  if (typeof value === "string") return [[path, value]];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => textLeaves(item, `${path}[${index}]`));
  }
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) =>
      SHARED_KEYS.has(key) ? [] : textLeaves(item, path ? `${path}.${key}` : key),
    );
  }
  return [];
}

const ARABIC_LETTERS = /[؀-ۿ]/;

describe("localizeHref", () => {
  test("pages with an Arabic twin go to it", () => {
    assert.equal(localizeHref("/", "ar"), "/ar");
    assert.equal(localizeHref("/pricing", "ar"), "/ar/pricing");
    assert.equal(localizeHref("/pricing/", "ar"), "/ar/pricing");
    assert.equal(localizeHref("/contact", "ar"), "/ar/contact");
  });

  test("anchors and queries on those pages are kept", () => {
    assert.equal(localizeHref("/#features", "ar"), "/ar#features");
    assert.equal(localizeHref("/#how-it-works", "ar"), "/ar#how-it-works");
    assert.equal(localizeHref("/pricing?plan=pro#faq", "ar"), "/ar/pricing?plan=pro#faq");
  });

  test("everything else is left exactly as written", () => {
    for (const href of [
      "/auth/signup",
      "/auth/signin",
      "/terms",
      "/privacy",
      "/dashboard/settings/billing",
      "#product",
      "https://example.com/pricing",
      "//evil.example/pricing",
      "mailto:support@example.com",
      "/ar/pricing",
      "",
    ]) {
      assert.equal(localizeHref(href, "ar"), href, href);
    }
  });

  test("the English page writes links unchanged", () => {
    assert.equal(localizeHref("/pricing", "en"), "/pricing");
    assert.equal(localizeHref("/#features", "en"), "/#features");
  });
});

describe("the language switch", () => {
  test("each page links to its twin", () => {
    assert.equal(alternateLanguagePath("/"), "/ar");
    assert.equal(alternateLanguagePath("/pricing"), "/ar/pricing");
    assert.equal(alternateLanguagePath("/contact"), "/ar/contact");
    assert.equal(alternateLanguagePath("/ar"), "/");
    assert.equal(alternateLanguagePath("/ar/pricing"), "/pricing");
    assert.equal(alternateLanguagePath("/ar/contact/"), "/contact");
  });

  test("a page with no twin falls back to the other language's homepage", () => {
    assert.equal(alternateLanguagePath("/terms"), "/ar");
    assert.equal(alternateLanguagePath("/privacy"), "/ar");
    assert.equal(alternateLanguagePath("/ar/terms"), "/");
    assert.equal(alternateLanguagePath(null), "/ar");
  });

  test("only /ar and below read as Arabic", () => {
    assert.equal(marketingLangOf("/ar"), "ar");
    assert.equal(marketingLangOf("/ar/pricing"), "ar");
    assert.equal(marketingLangOf("/arabic-news"), "en");
    assert.equal(marketingLangOf("/area"), "en");
    assert.equal(marketingLangOf("/"), "en");
  });
});

describe("isSafeLandingHref", () => {
  test("paths, anchors and http(s) addresses are accepted", () => {
    for (const href of ["", "/", "/pricing", "/#features", "#product", "https://example.com", "http://example.com/a?b=c"]) {
      assert.equal(isSafeLandingHref(href), true, href);
    }
  });

  test("script and data URLs, protocol-relative and odd forms are refused", () => {
    for (const href of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      " javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "//evil.example",
      "/\\evil.example",
      "vbscript:msgbox(1)",
      "https://",
      "/pricing page",
      "ftp://example.com",
    ]) {
      assert.equal(isSafeLandingHref(href), false, href);
    }
  });
});

describe("localizeLanding", () => {
  test("English is the content unchanged", () => {
    const data = toLandingData(null);
    assert.equal(localizeLanding(data, "en"), data);
  });

  test("a non-empty Arabic string replaces the English; an empty one does not", () => {
    const data = withArabic({ hero: { eyebrow: "منصة", headingTop: "  ", subtext: "" } });
    const ar = localizeLanding(data, "ar");
    assert.equal(ar.hero.eyebrow, "منصة");
    assert.equal(ar.hero.headingTop, DEFAULT_LANDING.hero.headingTop);
    assert.equal(ar.hero.subtext, DEFAULT_LANDING.hero.subtext);
  });

  test("images, icons, ratings and other shared values always come from the English", () => {
    const data = withArabic({
      hero: { image: "/evil.png", imageAlt: "صورة" },
      cta: { panelImage: "/x.png", cards: [{ title: "عقارات", icon: "wallet", href: "https://evil.example" }] },
      testimonial: { slides: [{ rating: 1, cardQuote: "رائع" }] },
    } as never);
    const ar = localizeLanding(data, "ar");
    assert.equal(ar.hero.image, DEFAULT_LANDING.hero.image);
    assert.equal(ar.hero.imageAlt, "صورة");
    assert.equal(ar.cta.panelImage, DEFAULT_LANDING.cta.panelImage);
    assert.equal(ar.cta.cards[0].title, "عقارات");
    assert.equal(ar.cta.cards[0].icon, DEFAULT_LANDING.cta.cards[0].icon);
    assert.equal(ar.testimonial.slides[0].rating, DEFAULT_LANDING.testimonial.slides[0].rating);
    assert.equal(ar.testimonial.slides[0].cardQuote, "رائع");
    assert.equal(ar.testimonial.autoplaySeconds, DEFAULT_LANDING.testimonial.autoplaySeconds);
  });

  test("lists keep the English length and go by position", () => {
    const data = withArabic({
      hero: { bullets: ["الأول", "", "زائد", "زائد آخر"] },
      header: { navLinks: [{ label: "المزايا" }] },
    });
    const ar = localizeLanding(data, "ar");
    assert.equal(ar.hero.bullets.length, DEFAULT_LANDING.hero.bullets.length);
    assert.deepEqual(ar.hero.bullets, ["الأول", DEFAULT_LANDING.hero.bullets[1]]);
    assert.equal(ar.header.navLinks.length, DEFAULT_LANDING.header.navLinks.length);
    assert.equal(ar.header.navLinks[0].label, "المزايا");
    assert.equal(ar.header.navLinks[1].label, DEFAULT_LANDING.header.navLinks[1].label);
  });

  test("internal links point at the Arabic pages; sign-up and external links do not change", () => {
    const ar = localizeLanding(toLandingData(null), "ar");
    assert.equal(ar.header.navLinks[0].href, "/ar#features");
    assert.equal(ar.header.navLinks[2].href, "/ar/contact");
    assert.equal(ar.header.navLinks[3].href, "/ar/pricing");
    assert.equal(ar.header.cta.href, "/auth/signup");
    assert.equal(ar.cta.priceLink.href, "/ar/pricing");
    assert.equal(ar.footer.ctaHref, "/auth/signup");
    assert.equal(ar.footer.columns[2].links[0].href, "/terms");
    // The English content itself is untouched.
    assert.equal(DEFAULT_LANDING.header.navLinks[0].href, "/#features");
  });

  test("custom sections are overlaid by id, whatever their order", () => {
    const base = withArabic({
      custom: { b: { heading: "القسم ب", body: "نص" }, a: { ctaLabel: "اشترك" } },
    });
    const data: LandingData = {
      ...base,
      customSections: [
        { id: "a", heading: "A", body: "Body A", image: "/a.png", imageAlt: "", imagePosition: "start", ctaLabel: "Join", ctaHref: "/pricing", background: "white" },
        { id: "b", heading: "B", body: "Body B", image: "", imageAlt: "", imagePosition: "none", ctaLabel: "", ctaHref: "", background: "tinted" },
      ],
    };
    const ar = localizeLanding(data, "ar");
    assert.equal(ar.customSections[0].heading, "A");
    assert.equal(ar.customSections[0].ctaLabel, "اشترك");
    assert.equal(ar.customSections[0].ctaHref, "/ar/pricing");
    assert.equal(ar.customSections[0].image, "/a.png");
    assert.equal(ar.customSections[1].heading, "القسم ب");
    assert.equal(ar.customSections[1].body, "نص");
    assert.equal(ar.customSections[1].background, "tinted");
  });

  test("the SEO title and description come from the overlay", () => {
    const ar = localizeLanding(withArabic({ seo: { title: "إدارة العقارات" } }), "ar");
    assert.equal(ar.seo.title, "إدارة العقارات");
    assert.equal(ar.seo.description, DEFAULT_LANDING.seo.description);
  });
});

describe("the shipped Arabic", () => {
  test("translates every default English string", () => {
    const english = textLeaves({ ...DEFAULT_LANDING, sections: [], customSections: [], translations: {} });
    const arabic = new Map(textLeaves(DEFAULT_LANDING_AR));
    for (const [path] of english) {
      assert.ok(ARABIC_LETTERS.test(arabic.get(path) ?? ""), `no Arabic for ${path}`);
    }
  });

  test("carries words only — no image, link or key the English does not have", () => {
    const english = new Set(textLeaves({ ...DEFAULT_LANDING, sections: [], customSections: [], translations: {} }).map(([path]) => path));
    for (const [path] of textLeaves(DEFAULT_LANDING_AR)) {
      assert.ok(english.has(path), `stray Arabic at ${path}`);
    }
    const json = JSON.stringify(DEFAULT_LANDING_AR);
    for (const key of SHARED_KEYS) assert.ok(!json.includes(`"${key}":`), key);
  });

  test("with nothing stored, /ar is Arabic throughout", () => {
    const ar = localizeLanding(toLandingData(null), "ar");
    const leaves = textLeaves({ ...ar, sections: [], translations: {} });
    assert.ok(leaves.length > 80);
    for (const [path, text] of leaves) {
      assert.ok(ARABIC_LETTERS.test(text), `${path} is not Arabic: ${text}`);
    }
  });

  test("stops applying to a string the operator rewrote in English", () => {
    const english = structuredClone(DEFAULT_LANDING);
    english.hero.eyebrow = "Built for Riyadh";
    const overlay = resolveArabicOverlay(english, undefined);
    assert.equal(overlay.hero?.eyebrow, undefined);
    assert.equal(overlay.hero?.subtext, DEFAULT_LANDING_AR.hero.subtext);
    const ar = localizeLanding({ ...english, translations: { ar: overlay } }, "ar");
    assert.equal(ar.hero.eyebrow, "Built for Riyadh");
  });

  test("still applies when the console only trimmed the English", () => {
    const english = structuredClone(DEFAULT_LANDING);
    english.testimonial.quoteBefore = english.testimonial.quoteBefore.trim();
    const overlay = resolveArabicOverlay(english, undefined);
    assert.equal(overlay.testimonial?.quoteBefore, DEFAULT_LANDING_AR.testimonial.quoteBefore);
  });

  test("what the operator wrote outranks it", () => {
    const overlay = resolveArabicOverlay(DEFAULT_LANDING, { hero: { eyebrow: "حل شامل" } });
    assert.equal(overlay.hero?.eyebrow, "حل شامل");
    assert.equal(overlay.hero?.headingTop, DEFAULT_LANDING_AR.hero.headingTop);
  });
});

describe("what is stored", () => {
  test("only words for fields that exist, with shared values and blanks dropped", () => {
    const pruned = pruneOverlay(DEFAULT_LANDING.hero, {
      eyebrow: "منصة ",
      headingTop: "   ",
      image: "/evil.png",
      primaryCta: { label: "ابدأ", href: "javascript:alert(1)" },
      bullets: ["", "تجربة", "زائد"],
      invented: "x",
      subtext: "",
    });
    assert.deepEqual(pruned, {
      // Kept as written: an edge space can be the gap before the next string.
      eyebrow: "منصة ",
      primaryCta: { label: "ابدأ" },
      bullets: ["", "تجربة"],
    });
  });

  test("the shipped translation is not frozen into storage", () => {
    const stored = storedArabicOverlay(DEFAULT_LANDING, resolveArabicOverlay(DEFAULT_LANDING, undefined));
    assert.deepEqual(stored, {});
  });

  test("text the operator wrote is kept, beside untouched shipped text", () => {
    const sent = resolveArabicOverlay(DEFAULT_LANDING, undefined);
    sent.hero = { ...sent.hero, eyebrow: "حل شامل" };
    sent.footer = { ...sent.footer, columns: [{ title: "منتجنا" }] };
    const stored = storedArabicOverlay(DEFAULT_LANDING, sent);
    assert.deepEqual(stored, {
      hero: { eyebrow: "حل شامل" },
      footer: { columns: [{ title: "منتجنا" }] },
    });
  });

  test("custom sections keep their Arabic only while they exist", () => {
    const english = {
      ...DEFAULT_LANDING,
      customSections: [
        { id: "keep", heading: "H", body: "", image: "", imageAlt: "", imagePosition: "none" as const, ctaLabel: "", ctaHref: "", background: "white" as const },
      ],
    };
    const stored = storedArabicOverlay(english, {
      custom: { keep: { heading: "عنوان", image: "/x.png" }, gone: { heading: "قديم" } },
    });
    assert.deepEqual(stored, { custom: { keep: { heading: "عنوان" } } });
  });
});

describe("the console's Arabic view", () => {
  test("round-trips through the English structure", () => {
    const overlay = { navLinks: [{ label: "المزايا" }], cta: { label: "" } };
    const view = arabicView(DEFAULT_LANDING.header, overlay);
    assert.equal(view.navLinks[0].label, "المزايا");
    assert.equal(view.navLinks[0].href, DEFAULT_LANDING.header.navLinks[0].href);
    assert.equal(view.navLinks[1].label, "");
    assert.equal(view.signIn.label, "");
    const back = overlayFromView(DEFAULT_LANDING.header, view) as typeof overlay;
    // Kept exactly as typed — an emptied field included — until saved.
    assert.equal((back as { cta: { label: string } }).cta.label, "");
    assert.equal("href" in (back as { cta: object }).cta, false);
  });
});
