/**
 * PropertyPro - The font report PDFs are drawn with
 *
 * jsPDF's built-in fonts are Latin-only — every Arabic character comes out
 * blank — so an Arabic report has to embed a font that actually carries the
 * glyphs. Amiri is used because it covers Arabic AND Latin in one face: a
 * report mixing a tenant's Arabic name with a Latin contract number and
 * Western digits is one font run, not a per-character font switch.
 *
 * Shaping and direction are jsPDF's own: it registers an Arabic parser on the
 * `preProcessText` event that joins letters into their contextual forms and
 * reverses the run. Nothing here has to do that work — but it only becomes
 * visible once a font with the glyphs is loaded, which is what this file is.
 *
 * Loaded from disk once per process and cached. The file is listed in
 * `outputFileTracingIncludes` (next.config.ts) so the deployment carries it;
 * without that entry the bundler would not see this read and the font would
 * be missing in production.
 *
 * Licensed under the SIL Open Font License 1.1 — see Amiri-OFL.txt beside the
 * font. Redistribution inside this application is exactly what that permits.
 */

import { readFileSync } from "fs";
import path from "path";

/** The name jsPDF knows the face by, once registered on a document. */
export const REPORT_FONT_NAME = "Amiri";

export const REPORT_FONT_FILE = "Amiri-Regular.ttf";

let cached: string | null = null;

/**
 * The font as base64, which is the only form `addFileToVFS` accepts.
 *
 * Reading 431KB and base64-encoding it on every export would be wasteful, and
 * the file never changes at runtime, so the result is held for the life of
 * the process.
 */
export function reportFontBase64(): string {
  if (cached) return cached;

  const file = path.join(
    process.cwd(),
    "src",
    "assets",
    "fonts",
    REPORT_FONT_FILE,
  );

  cached = readFileSync(file).toString("base64");
  return cached;
}
