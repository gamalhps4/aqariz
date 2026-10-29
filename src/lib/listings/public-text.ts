/**
 * PropertyPro - The public pages' words
 *
 * The office page and the listing page are drawn on the server, for a
 * stranger whose language is not an account setting: Arabic unless the link
 * says `?lang=en`. So they cannot read the signed-in user's locale the way the
 * dashboard does; they read the same catalogue (`marketing.json`) directly,
 * for the one language the page was asked in.
 *
 * Pure, and the only place a public page picks its language.
 */

import ar from "@/locales/ar/marketing.json";
import en from "@/locales/en/marketing.json";

export type PublicLang = "ar" | "en";

export const PUBLIC_LANGS: readonly PublicLang[] = ["ar", "en"];

const CATALOGS: Record<PublicLang, Record<string, string>> = { ar, en };

/** The language a link asks for. Arabic is the default; anything but "en" is Arabic. */
export function resolvePublicLang(value: unknown): PublicLang {
  const asked = Array.isArray(value) ? value[0] : value;
  return typeof asked === "string" && asked.toLowerCase() === "en" ? "en" : "ar";
}

export function directionOf(lang: PublicLang): "rtl" | "ltr" {
  return lang === "ar" ? "rtl" : "ltr";
}

/** The other language, for the switch link. */
export function otherLang(lang: PublicLang): PublicLang {
  return lang === "ar" ? "en" : "ar";
}

/**
 * One line of the catalogue in a language, with `{name}` values filled in.
 * A key missing in that language reads in the other; missing in both, it
 * reads as the key — visible, never blank.
 */
export function publicText(
  lang: PublicLang,
  key: string,
  values?: Record<string, string | number>,
): string {
  const text = CATALOGS[lang][key] ?? CATALOGS[otherLang(lang)][key] ?? key;
  if (!values) return text;
  return Object.entries(values).reduce(
    (result, [name, value]) => result.split(`{${name}}`).join(String(value)),
    text,
  );
}

/** Every public string a client component needs, with a prefix, as one object. */
export function publicTextGroup(
  lang: PublicLang,
  prefix: string,
): Record<string, string> {
  const group: Record<string, string> = {};
  const keys = new Set([
    ...Object.keys(CATALOGS.ar),
    ...Object.keys(CATALOGS.en),
  ]);
  for (const key of keys) {
    if (key.startsWith(prefix)) {
      group[key.slice(prefix.length)] = publicText(lang, key);
    }
  }
  return group;
}
