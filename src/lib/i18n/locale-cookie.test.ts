/**
 * The language the first HTML response is drawn in.
 *
 * The root layout hands `resolveDisplayLocale` the request's cookies; what it
 * returns becomes `<html lang dir>` and the providers' starting language. The
 * cases that matter: an Arabic office's page is Arabic and right to left from
 * the first byte, a prerendered marketing page is English, a forged cookie
 * cannot put arbitrary text into the `<html>` tag, and Arabic can never be
 * drawn left to right.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  CURRENCY_COOKIE,
  DIRECTION_COOKIE,
  LOCALE_COOKIE,
  REGION_DISPLAY_LOCALE,
  STATIC_PAGE_LOCALE,
  displayLocaleFromSettings,
  resolveDisplayLocale,
  serializeDisplayLocale,
} from "@/lib/i18n/locale-cookie";
import {
  directionFor,
  localeCodeFor,
  toAppLanguage,
} from "@/lib/i18n/languages";

function jar(values: Record<string, string>) {
  return (name: string) => values[name];
}

describe("resolveDisplayLocale", () => {
  test("no cookie: the market's default — Arabic, right to left, riyals", () => {
    const locale = resolveDisplayLocale({ isRequest: true, readCookie: jar({}) });
    assert.deepEqual(locale, { language: "ar", dir: "rtl", currency: "SAR" });
    assert.deepEqual(locale, REGION_DISPLAY_LOCALE);
  });

  test("an English office's cookies draw the page English, left to right", () => {
    const locale = resolveDisplayLocale({
      isRequest: true,
      readCookie: jar({
        [LOCALE_COOKIE]: "en",
        [DIRECTION_COOKIE]: "ltr",
        // Left from when an office could pick dollars: riyal only now.
        [CURRENCY_COOKIE]: "USD",
      }),
    });
    assert.deepEqual(locale, { language: "en", dir: "ltr", currency: "SAR" });
  });

  test("a static render (no request) is the marketing pages' English", () => {
    const locale = resolveDisplayLocale({
      isRequest: false,
      readCookie: jar({ [LOCALE_COOKIE]: "ar" }),
    });
    assert.deepEqual(locale, STATIC_PAGE_LOCALE);
    assert.equal(locale.dir, "ltr");
  });

  test("Arabic is right to left even when the direction cookie says otherwise", () => {
    const locale = resolveDisplayLocale({
      isRequest: true,
      readCookie: jar({ [LOCALE_COOKIE]: "ar", [DIRECTION_COOKIE]: "ltr" }),
    });
    assert.equal(locale.dir, "rtl");
  });

  test("another language may be right to left when the settings asked for it", () => {
    const locale = resolveDisplayLocale({
      isRequest: true,
      readCookie: jar({ [LOCALE_COOKIE]: "en", [DIRECTION_COOKIE]: "rtl" }),
    });
    assert.deepEqual([locale.language, locale.dir], ["en", "rtl"]);
  });

  test("a language cookie alone sets its own direction", () => {
    const english = resolveDisplayLocale({
      isRequest: true,
      readCookie: jar({ [LOCALE_COOKIE]: "en" }),
    });
    assert.equal(english.dir, "ltr");
  });

  test("forged or unknown values fall back instead of reaching the markup", () => {
    const locale = resolveDisplayLocale({
      isRequest: true,
      readCookie: jar({
        [LOCALE_COOKIE]: 'en" onload="alert(1)',
        [DIRECTION_COOKIE]: "sideways",
        [CURRENCY_COOKIE]: "<script>",
      }),
    });
    assert.deepEqual(locale, REGION_DISPLAY_LOCALE);
  });

  test("an unsupported language falls back to the market's", () => {
    const locale = resolveDisplayLocale({
      isRequest: true,
      readCookie: jar({ [LOCALE_COOKIE]: "zh" }),
    });
    assert.equal(locale.language, "ar");
    assert.equal(locale.dir, "rtl");
  });
});

describe("cookies written by the browser", () => {
  test("serializes only valid values, site-wide, for a year", () => {
    const cookies = serializeDisplayLocale(
      { language: "ar", dir: "rtl", currency: "SAR" },
      { secure: true },
    );
    assert.equal(cookies.length, 3);
    assert.ok(cookies[0].startsWith("pp-locale=ar; Path=/; Max-Age=31536000; SameSite=Lax"));
    assert.ok(cookies.every((cookie) => cookie.endsWith("; Secure")));

    const rejected = serializeDisplayLocale({
      language: "xx" as never,
      dir: "up" as never,
    });
    assert.deepEqual(rejected, []);
    // Any currency asked for is written as the app's one.
    assert.deepEqual(serializeDisplayLocale({ currency: "dollars" }), [
      "pp-currency=SAR; Path=/; Max-Age=31536000; SameSite=Lax",
    ]);
  });

  test("the display settings' shape maps onto the cookies", () => {
    assert.deepEqual(
      displayLocaleFromSettings({ language: "ar-SA", rtl: false, currency: "sar" }),
      { language: "ar", dir: "rtl", currency: "SAR" },
    );
    assert.deepEqual(
      displayLocaleFromSettings({ language: "en", rtl: false, currency: "USD" }),
      { language: "en", dir: "ltr", currency: "SAR" },
    );
    assert.deepEqual(displayLocaleFromSettings({ rtl: true }), { dir: "rtl" });
  });
});

describe("languages", () => {
  test("normalises codes and maps them to the browser locales", () => {
    assert.equal(toAppLanguage("AR-sa", "en"), "ar");
    assert.equal(toAppLanguage("pt-BR", "en"), "en");
    assert.equal(toAppLanguage(undefined, "ar"), "ar");
    assert.equal(localeCodeFor("ar"), "ar-SA");
    // French was removed on 2026-10-16: it formats as the English it reads.
    assert.equal(localeCodeFor("fr"), "en-US");
    assert.equal(localeCodeFor("nope"), "en-US");
    assert.equal(directionFor("ar"), "rtl");
    assert.equal(directionFor("en"), "ltr");
    assert.equal(directionFor("en", true), "rtl");
  });
});
