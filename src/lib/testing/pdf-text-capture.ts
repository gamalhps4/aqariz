/**
 * PropertyPro - What a PDF says, for tests
 *
 * Every string a jsPDF document draws, read from jsPDF's own text event — the
 * words a reader sees, before Arabic shaping — with the page it lands on,
 * where it is placed, and whether it was laid out right to left. A test can
 * then check a PDF's wording without parsing the file.
 *
 * Only documents created while `draw` runs are captured.
 */

import jsPDF from "jspdf";

export interface DrawnText {
  page: number;
  text: string;
  x: number;
  y: number;
  align?: string;
  /** Laid out as a right-to-left line (see pdf-i18n.ts `arabicLineLayout`). */
  rtl: boolean;
}

type TextPayload = {
  text: unknown;
  x: number;
  y: number;
  options?: { align?: string; isInputRtl?: boolean };
};

export async function captureDrawnText(
  draw: () => unknown,
): Promise<DrawnText[]> {
  const drawn: DrawnText[] = [];
  const hook = [
    "preProcessText",
    function (this: jsPDF, payload: TextPayload) {
      const lines = Array.isArray(payload.text) ? payload.text : [payload.text];
      for (const line of lines) {
        drawn.push({
          page: this.getCurrentPageInfo().pageNumber,
          text: String(line),
          x: payload.x,
          y: payload.y,
          align: payload.options?.align,
          rtl: payload.options?.isInputRtl === true,
        });
      }
    },
  ];
  const events = (jsPDF as unknown as { API: { events: unknown[] } }).API
    .events;
  events.push(hook);
  try {
    await draw();
  } finally {
    events.splice(events.indexOf(hook), 1);
  }
  return drawn;
}
