/**
 * PropertyPro - A statement's words, in the reader's language
 *
 * Statements are worded where the reader's language is known: on the screen
 * with its `t`, in an export with the report's language. The wording helpers
 * (summary.ts, document.ts, entity-details.ts) take whichever translator the
 * caller has, in this one shape — so a screen and its download say the same
 * thing in the same words.
 */

/** (catalogue key, English, values) → text in the reader's language. */
export type LineTranslate = (
  key: string,
  english: string,
  values?: Record<string, string | number>,
) => string;
