/**
 * PropertyPro - The languages the product is written in
 *
 * Two catalogues ship under `src/locales/<language>/`: Arabic and English.
 * German, Spanish and French were removed at the client's request
 * (2026-10-16); a stored "de"/"es"/"fr" reads as the caller's fallback
 * through `toAppLanguage`. Everything that has to
 * decide "which language, which direction" — the first HTML response, the
 * providers, an email, an SMS — asks here, so the answer cannot drift between
 * the screen and what is sent.
 *
 * No imports on purpose: the root layout, the browser bundle and the email
 * service all load this file.
 */

export const APP_LANGUAGES = ["ar", "en"] as const;

export type AppLanguage = (typeof APP_LANGUAGES)[number];

export type TextDirection = "rtl" | "ltr";

/**
 * The locale each language formats with in the browser — a key of `LOCALES`
 * in `services/localization.service.ts`.
 */
export const LANGUAGE_LOCALES: Record<AppLanguage, string> = {
  ar: "ar-SA",
  en: "en-US",
};

/** Scripts written right to left. Only Arabic ships today. */
const RTL_LANGUAGES = new Set(["ar", "he", "fa", "ur"]);

export function isAppLanguage(value: unknown): value is AppLanguage {
  return APP_LANGUAGES.includes(value as AppLanguage);
}

/**
 * "ar-SA", "AR" or "ar" → "ar"; anything not shipped → `fallback`.
 *
 * Display settings store a short code, the browser service a full locale, and
 * older rows either; every reader normalises through here.
 */
export function toAppLanguage(
  value: unknown,
  fallback: AppLanguage,
): AppLanguage {
  if (typeof value !== "string") return fallback;
  const base = value.trim().toLowerCase().split(/[-_]/)[0];
  return isAppLanguage(base) ? base : fallback;
}

export function isRtlLanguage(language: string | null | undefined): boolean {
  if (!language) return false;
  return RTL_LANGUAGES.has(language.trim().toLowerCase().split(/[-_]/)[0]);
}

/**
 * The direction a page is laid out in.
 *
 * An Arabic page is always right to left. The appearance settings can also
 * turn right-to-left on for another language (`rtl: true`), so that is
 * honoured — but never the other way round: Arabic cannot be set left to
 * right, which is the same rule the preferences drawer enforces.
 */
export function directionFor(
  language: string | null | undefined,
  rtlSetting?: boolean | null,
): TextDirection {
  return isRtlLanguage(language) || rtlSetting === true ? "rtl" : "ltr";
}

/** The browser locale a language formats with ("ar" → "ar-SA"). */
export function localeCodeFor(language: string | null | undefined): string {
  return LANGUAGE_LOCALES[toAppLanguage(language, "en")];
}
