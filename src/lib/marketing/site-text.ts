/**
 * PropertyPro SaaS - The marketing pages' fixed words
 *
 * The CMS holds the landing copy; the words around it — "Back to top", the
 * pricing toggle, the FAQ, the contact form — are the app's catalogue, under
 * `site.*` in `src/locales/<lang>/marketing.json`. The pages are drawn on the
 * server for one language at a time, so they read the catalogue directly for
 * that language; client parts are handed the strings as props.
 */

import { translateFor, type TranslateValues } from "@/lib/i18n/translate";
import type { MarketingLang } from "./landing-i18n";

/** `site.<key>` in `lang`, with `{token}` values filled in. */
export function siteText(
  lang: MarketingLang,
  key: string,
  values?: TranslateValues,
): string {
  return translateFor(lang, `site.${key}`, values);
}
