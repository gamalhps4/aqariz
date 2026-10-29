/**
 * PropertyPro SaaS - Search metadata for a page that exists in two languages
 *
 * Each marketing page with an Arabic twin names both versions to search
 * engines (`hreflang`), points its canonical at itself, and sends anyone whose
 * language matches neither to the English one. Absolute URLs come from the
 * deployment's own address, as the listing pages' metadata does.
 */

import type { Metadata } from "next";
import { appBaseUrl } from "@/lib/listings/urls";
import { languagePair, type MarketingLang } from "./landing-i18n";

/** `metadataBase` + `alternates` for the page at `englishPath`, drawn in `lang`. */
export function languageAlternates(
  englishPath: string,
  lang: MarketingLang,
): Pick<Metadata, "metadataBase" | "alternates"> {
  const pair = languagePair(englishPath);
  return {
    metadataBase: new URL(appBaseUrl()),
    alternates: {
      canonical: lang === "ar" ? pair.ar : pair.en,
      languages: {
        en: pair.en,
        "ar-SA": pair.ar,
        "x-default": pair.en,
      },
    },
  };
}

/**
 * `metadataBase` + `alternates` for a page that may exist in only one
 * language — a blog post. `paths` holds the languages it has; the canonical
 * is the page in `lang`, `hreflang` names only versions that exist, and
 * readers matching neither language go to the English one when there is
 * one, else to the Arabic.
 */
export function partialLanguageAlternates(
  paths: Partial<Record<MarketingLang, string>>,
  lang: MarketingLang,
): Pick<Metadata, "metadataBase" | "alternates"> {
  const languages: Record<string, string> = {};
  if (paths.en) languages.en = paths.en;
  if (paths.ar) languages["ar-SA"] = paths.ar;
  const fallback = paths.en ?? paths.ar;
  if (fallback) languages["x-default"] = fallback;
  return {
    metadataBase: new URL(appBaseUrl()),
    alternates: {
      canonical: paths[lang] ?? fallback,
      languages,
    },
  };
}
