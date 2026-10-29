/**
 * PropertyPro - The catalogue as a translate function, for server code
 *
 * Screens translate through the localization context; the activity writer
 * (an English description for every entry) and the activity exports (headings
 * and sentences in the reader's language) run on the server with no context.
 * This reads the same catalogue the screens read, with the same lookup order —
 * the language, then English, then the default — and the same {token}
 * replacement.
 */

import { translations } from "@/locales";
import type { AuditTranslate } from "./render";

export function catalogTranslator(language: string): AuditTranslate {
  const code = (language || "en").split("-")[0].toLowerCase();
  return (key, options) => {
    const entry = translations[key];
    const base =
      (entry && (entry[code] || entry.en)) || options?.defaultValue || key;
    const values = options?.values;
    if (!values) return base;
    return Object.keys(values).reduce((text, token) => {
      const value = String(values[token]);
      return text
        .replace(new RegExp(`\\{\\{${token}\\}\\}`, "g"), value)
        .replace(new RegExp(`\\{${token}\\}`, "g"), value);
    }, base);
  };
}
