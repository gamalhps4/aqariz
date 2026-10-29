/**
 * PropertyPro - The language the first paint is drawn in
 *
 * Every page used to arrive as left-to-right English (`<html lang="en">`) and
 * switch to Arabic only after the session and the display settings had loaded
 * in the browser. An Arabic office saw an English page flash first, and React
 * threw the page away and drew it again (hydration error #418): the providers
 * changed language while parts of the page were still being hydrated.
 *
 * Three small cookies carry the office's choice to the server, so the very
 * first HTML response is already written in it — `lang`, `dir`, and the
 * providers' starting language and currency:
 *
 *   pp-locale    "ar" | "en"
 *   pp-dir       "rtl" | "ltr"
 *   pp-currency  ISO 4217 code, e.g. "SAR"
 *
 * They are written in the browser whenever the language changes — when the
 * office's display settings load after sign-in, when they are saved, and when
 * someone switches language in the preferences drawer (see SettingsProvider).
 * They are not secret and not httpOnly: the browser writes them, the server
 * only reads them.
 *
 * This module has no server or browser dependencies, so the root layout, the
 * providers and the tests share one reading of the cookies.
 */

import { ACTIVE_REGION, APP_CURRENCY } from "@/lib/regional/region";
import {
  directionFor,
  isAppLanguage,
  toAppLanguage,
  type AppLanguage,
  type TextDirection,
} from "./languages";

export const LOCALE_COOKIE = "pp-locale";
export const DIRECTION_COOKIE = "pp-dir";
export const CURRENCY_COOKIE = "pp-currency";

/** A year: the choice should outlive a session, as the display settings do. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export interface DisplayLocale {
  language: AppLanguage;
  dir: TextDirection;
  /** ISO 4217. */
  currency: string;
}

/**
 * What a page is drawn in before anybody has chosen: the market this
 * deployment ships for — Arabic, right to left, riyals.
 */
export const REGION_DISPLAY_LOCALE: DisplayLocale = {
  language: toAppLanguage(ACTIVE_REGION.language, "ar"),
  dir: directionFor(ACTIVE_REGION.language, ACTIVE_REGION.rtl),
  currency: ACTIVE_REGION.currency,
};

/**
 * What a statically rendered page is drawn in. Only the public marketing
 * pages (home, pricing, contact, privacy, terms) are rendered ahead of any
 * request, and their copy is English — so they are laid out English, left to
 * right, whoever opens them.
 */
export const STATIC_PAGE_LOCALE: DisplayLocale = {
  language: "en",
  dir: "ltr",
  currency: ACTIVE_REGION.currency,
};

/**
 * The display locale for a page render.
 *
 * - No request (a static render): `STATIC_PAGE_LOCALE`.
 * - Otherwise the cookies, each checked against what the product ships, so a
 *   hand-edited cookie can never put arbitrary text into the `<html>` tag.
 * - A cookie that is missing or not understood falls back to the region's.
 *
 * Arabic is always right to left whatever `pp-dir` says; another language is
 * right to left only when the cookie says so (the appearance settings allow
 * it).
 */
export function resolveDisplayLocale(input: {
  isRequest: boolean;
  readCookie: (name: string) => string | undefined;
  fallback?: DisplayLocale;
}): DisplayLocale {
  if (!input.isRequest) return STATIC_PAGE_LOCALE;
  const fallback = input.fallback ?? REGION_DISPLAY_LOCALE;

  const rawLanguage = input.readCookie(LOCALE_COOKIE)?.trim().toLowerCase();
  const language = isAppLanguage(rawLanguage) ? rawLanguage : fallback.language;

  const rawDir = input.readCookie(DIRECTION_COOKIE)?.trim().toLowerCase();
  const dir =
    rawDir === "rtl" || rawDir === "ltr"
      ? directionFor(language, rawDir === "rtl")
      : rawLanguage === language
        ? directionFor(language)
        : fallback.dir;

  // One currency, whatever the cookie says (lib/regional/region): a cookie
  // left from when an office could pick dollars must not draw the page in
  // them.
  return { language, dir, currency: APP_CURRENCY };
}

/** `Set-Cookie`/`document.cookie` strings for a display locale. */
export function serializeDisplayLocale(
  locale: Partial<DisplayLocale>,
  options: { secure?: boolean } = {},
): string[] {
  const attributes = `; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE}; SameSite=Lax${
    options.secure ? "; Secure" : ""
  }`;
  const cookies: string[] = [];
  if (locale.language && isAppLanguage(locale.language)) {
    cookies.push(`${LOCALE_COOKIE}=${locale.language}${attributes}`);
  }
  if (locale.dir === "rtl" || locale.dir === "ltr") {
    cookies.push(`${DIRECTION_COOKIE}=${locale.dir}${attributes}`);
  }
  if (locale.currency) {
    cookies.push(`${CURRENCY_COOKIE}=${APP_CURRENCY}${attributes}`);
  }
  return cookies;
}

/**
 * The display locale a settings object describes — the shape the display
 * settings API returns (`language`, `rtl`, `currency`).
 */
export function displayLocaleFromSettings(settings: {
  language?: string | null;
  rtl?: boolean | null;
  currency?: string | null;
}): Partial<DisplayLocale> {
  const locale: Partial<DisplayLocale> = {};
  if (settings.language) {
    const language = toAppLanguage(settings.language, REGION_DISPLAY_LOCALE.language);
    locale.language = language;
    locale.dir = directionFor(language, settings.rtl);
  } else if (typeof settings.rtl === "boolean") {
    locale.dir = settings.rtl ? "rtl" : "ltr";
  }
  // Whatever an older settings row holds: the app works in riyal only.
  if (settings.currency) locale.currency = APP_CURRENCY;
  return locale;
}

/**
 * Remember the display locale in this browser so the next page — a reload,
 * a new tab, the sign-in screen after signing out — is drawn in it from the
 * first paint. Does nothing outside the browser.
 */
export function writeDisplayLocaleCookies(locale: Partial<DisplayLocale>): void {
  if (typeof document === "undefined") return;
  const secure =
    typeof window !== "undefined" && window.location?.protocol === "https:";
  try {
    for (const cookie of serializeDisplayLocale(locale, { secure })) {
      document.cookie = cookie;
    }
  } catch {
    // A browser refusing cookies only loses the first-paint language.
  }
}
