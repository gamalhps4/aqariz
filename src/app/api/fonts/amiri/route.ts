/**
 * PropertyPro - The PDF face, for documents drawn in the browser
 *
 * Invoices downloaded or printed from the contract page are drawn with jsPDF
 * in the browser, and need the same Arabic-capable face the server embeds in
 * its PDFs (see lib/invoice/pdf-text.ts). The file lives beside the server
 * code rather than in /public so there is one copy of it; this serves it.
 *
 * Amiri is licensed under the SIL Open Font License, which permits exactly
 * this redistribution — nothing here is private, so there is no auth check.
 */

import { reportFontBase64 } from "@/lib/reports/pdf-font";

export async function GET(): Promise<Response> {
  const font = Buffer.from(reportFontBase64(), "base64");
  return new Response(new Uint8Array(font), {
    headers: {
      "Content-Type": "font/ttf",
      "Content-Length": String(font.byteLength),
      // The file never changes between deployments.
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
    },
  });
}
