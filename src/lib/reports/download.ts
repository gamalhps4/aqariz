/**
 * PropertyPro - Fetching a report file from the browser
 *
 * `ReportExportButton` fetches an export endpoint and saves what comes back.
 * A page that has its own menu of export items — the emergency list's Print,
 * CSV and PDF — needs the same thing without the button, so it is here: the
 * same query (`format`, `lang`, `rtl`), the same refusal handling, the same
 * saved file name. The file is made by the same server path, so a menu item and
 * the shared button hand out the same document.
 *
 * Browser only, and it imports nothing of the report engine: that pulls the
 * database into the page.
 */

export type DownloadFormat = "xlsx" | "pdf" | "csv";

export interface ReportRequest {
  /** The endpoint, without a query: `/api/maintenance/emergency`. */
  endpoint: string;
  /** What the list is filtered by. */
  params: URLSearchParams;
  format: DownloadFormat;
  /** The interface language: headings and stored values are written in it. */
  language: string;
  /** An Arabic reader gets a PDF laid out right to left. */
  rtl: boolean;
}

export type ReportFetch =
  | { ok: true; blob: Blob; fileName: string }
  | { ok: false; error: string | null };

/** The name the server gave the file — RFC 6266's `filename*` first. */
function fileNameFrom(disposition: string | null, format: DownloadFormat): string {
  if (disposition) {
    const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
    if (encoded) {
      try {
        return decodeURIComponent(encoded[1]);
      } catch {
        // Fall through to the plain form.
      }
    }
    const plain = /filename="([^"]+)"/i.exec(disposition);
    if (plain) return plain[1];
  }
  return `report.${format}`;
}

/**
 * Ask the server for the file. A refusal — no export right, a bad filter —
 * comes back as its message rather than as a page of raw JSON.
 */
export async function fetchReportFile(
  request: ReportRequest,
  extra: Record<string, string> = {},
): Promise<ReportFetch> {
  const query = new URLSearchParams(request.params);
  query.set("format", request.format);
  query.set("lang", request.language);
  if (request.format === "pdf" && request.rtl) query.set("rtl", "1");
  for (const [key, value] of Object.entries(extra)) query.set(key, value);

  try {
    const response = await fetch(`${request.endpoint}?${query.toString()}`);
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      return { ok: false, error: payload?.error ?? null };
    }
    return {
      ok: true,
      blob: await response.blob(),
      fileName: fileNameFrom(
        response.headers.get("Content-Disposition"),
        request.format,
      ),
    };
  } catch (error) {
    console.error("Export failed:", error);
    return { ok: false, error: null };
  }
}

/** Save a file the way a link with `download` does. */
export function saveFile(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Open the report's PDF in a window of its own and ask the viewer to print
 * it. Called from a click: the window opens before anything is awaited, so a
 * popup blocker lets it through, and shows `waiting` until the file arrives.
 * Resolves to the refusal when the file could not be made, and the window is
 * closed again.
 */
export async function printReportFile(
  request: Omit<ReportRequest, "format">,
  waiting: string,
): Promise<ReportFetch | null> {
  const printWindow = window.open("", "_blank", "width=900,height=700");
  if (!printWindow) return null;

  const dir = request.rtl ? "rtl" : "ltr";
  printWindow.document.open();
  printWindow.document.write(
    `<!DOCTYPE html><html lang="${escapeHtml(request.language)}" dir="${dir}"><head><meta charset="UTF-8" /><title>${escapeHtml(waiting)}</title></head><body style="font-family:Arial,Tahoma,sans-serif;color:#6b7280;padding:24px;">${escapeHtml(waiting)}</body></html>`,
  );
  printWindow.document.close();

  const result = await fetchReportFile({ ...request, format: "pdf" }, { print: "1" });
  if (!result.ok || printWindow.closed) {
    if (!printWindow.closed) printWindow.close();
    return result;
  }
  const url = URL.createObjectURL(result.blob);
  printWindow.location.replace(url);
  // The viewer has long since read it by then.
  setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
  return result;
}
