/**
 * PropertyPro - date-fns in the reader's language
 *
 * "3 hours ago" came out in English on every screen that used date-fns, in
 * whichever language the interface was set to, because no call passed a
 * locale. One mapping, so each call site only has to ask.
 */

import { formatDistanceToNow } from "date-fns";
import { ar, enUS, type Locale } from "date-fns/locale";
import { localizationService } from "@/lib/services/localization.service";

const LOCALES: Record<string, Locale> = { ar, en: enUS };

/** The date-fns locale for a language code such as "ar" or "en-US". */
export function dateFnsLocale(language: string | undefined): Locale {
  const code = (language ?? "en").split("-")[0].toLowerCase();
  return LOCALES[code] ?? enUS;
}

/**
 * "3 hours ago" in the language the app is shown in, without a hook — the
 * notification and announcement lists printed it in English whatever the
 * interface language was.
 */
export function timeAgo(value: Date | string | number): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return formatDistanceToNow(date, {
    addSuffix: true,
    locale: dateFnsLocale(localizationService.getCurrentLocale()),
  });
}
