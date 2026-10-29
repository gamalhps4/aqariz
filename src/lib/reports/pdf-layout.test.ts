/**
 * A wide report has to fit its page without losing any of what it says.
 *
 * The old fit scaled the type to the page and then squeezed the columns by
 * another few percent to make up for what the scaling had not saved — because
 * each column's inset does not shrink with the type. A squeezed column is
 * narrower than its own text, so the last character of a date was clipped and
 * every long note ended in "…".
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  REFERENCE_FONT_SIZE,
  clipToWidth,
  fitColumns,
  wrapText,
  type ColumnFitOptions,
  type ColumnMeasure,
} from "@/lib/reports/pdf-layout";

/** The report PDF's own settings: A4 landscape, 32pt margins. */
const OPTIONS: ColumnFitOptions = {
  contentWidth: 842 - 64,
  maxFontSize: 8.5,
  comfortFontSize: 7.5,
  minFontSize: 6,
  padding: 8,
  tightPadding: 6.2,
  minColumnWidth: 34,
  comfortColumnWidth: 64,
};

/** Text 1pt wide per character at the reference size; an unbreakable column. */
const fixed = (characters: number): ColumnMeasure => ({
  natural: characters * 4.9,
  minimum: characters * 4.9,
});

/** A column of running text: `words` words of 5 letters on one line. */
const running = (words: number): ColumnMeasure => ({
  natural: words * 5 * 4.9 + (words - 1) * 2.5,
  minimum: 5 * 4.9,
});

const total = (widths: readonly number[]) =>
  widths.reduce((sum, width) => sum + width, 0);

/** How wide column `index`'s text is at the type size the fit chose. */
const textWidth = (measure: ColumnMeasure, fontSize: number) =>
  (measure.natural * fontSize) / REFERENCE_FONT_SIZE;

describe("a table that fits", () => {
  test("keeps its type and fills the page", () => {
    const measures = [fixed(10), fixed(14), running(4), fixed(8)];
    const fit = fitColumns(measures, OPTIONS);
    assert.equal(fit.mode, "fits");
    assert.equal(fit.fontSize, 8.5);
    assert.ok(Math.abs(total(fit.widths) - OPTIONS.contentWidth) < 1e-6);
    assert.deepEqual(fit.wraps, [false, false, false, false]);
    measures.forEach((measure, index) => {
      assert.ok(
        fit.widths[index] >= textWidth(measure, fit.fontSize) + OPTIONS.padding,
      );
    });
  });

  test("no columns is no layout", () => {
    assert.deepEqual(fitColumns([], OPTIONS).widths, []);
  });
});

describe("a table a little too wide", () => {
  // Fourteen columns of dates and codes, twelve characters each.
  const measures = Array.from({ length: 14 }, () => fixed(12));

  test("goes to smaller type, and no column is narrower than its text", () => {
    const fit = fitColumns(measures, OPTIONS);
    assert.equal(fit.mode, "shrunk");
    assert.ok(fit.fontSize < 8.5 && fit.fontSize >= OPTIONS.comfortFontSize);
    assert.ok(total(fit.widths) <= OPTIONS.contentWidth + 1e-6);
    measures.forEach((measure, index) => {
      // Every character fits, with the inset a cell needs on both sides.
      assert.ok(
        fit.widths[index] >= textWidth(measure, fit.fontSize) + OPTIONS.padding - 1e-6,
        `column ${index} is ${fit.widths[index]} for ${textWidth(measure, fit.fontSize)} of text`,
      );
    });
    assert.deepEqual(fit.wraps, measures.map(() => false));
  });

  test("the old fit clipped a table this wide, and this one does not", () => {
    // Eighteen columns: a third wider than the page at the full type size,
    // which is where the old arithmetic broke down.
    const wide = Array.from({ length: 18 }, () => fixed(12));
    // The old arithmetic, reproduced: scale the type to the page once, then
    // squeeze whatever is still over.
    const natural = (size: number) =>
      wide.map((m) =>
        Math.max((m.natural * size) / REFERENCE_FONT_SIZE + 8, 34),
      );
    let size = 8.5;
    let widths = natural(size);
    let sum = total(widths);
    size = Math.max(6, size * (OPTIONS.contentWidth / sum));
    widths = natural(size);
    sum = total(widths);
    const squeezed = widths.map((w) => (w * OPTIONS.contentWidth) / sum);
    const clipped = squeezed.filter(
      (w, index) => w - 6 < textWidth(wide[index], size),
    );
    assert.ok(
      clipped.length > 0,
      "the old fit leaves columns narrower than their text",
    );

    const fit = fitColumns(wide, OPTIONS);
    // Cells are drawn in the width less 6pt: 4 in from the reading edge, 2
    // from the far one.
    const stillClipped = fit.widths.filter(
      (w, index) => w - 6 < textWidth(wide[index], fit.fontSize) - 1e-6,
    );
    assert.equal(stillClipped.length, 0);
    assert.ok(total(fit.widths) <= OPTIONS.contentWidth + 1e-6);
  });
});

describe("a table that needs smaller type than the comfortable size", () => {
  // Fourteen columns of fourteen characters: too wide at the comfortable size,
  // narrow enough a little below it — with nothing to wrap.
  const measures = Array.from({ length: 14 }, () => fixed(14));

  test("still fills the page, and still cuts nothing", () => {
    const fit = fitColumns(measures, OPTIONS);
    assert.equal(fit.mode, "shrunk");
    assert.ok(fit.fontSize < OPTIONS.comfortFontSize);
    assert.ok(fit.fontSize >= OPTIONS.minFontSize);
    assert.ok(Math.abs(total(fit.widths) - OPTIONS.contentWidth) < 1e-6);
    assert.deepEqual(fit.wraps, measures.map(() => false));
    measures.forEach((measure, index) => {
      assert.ok(
        fit.widths[index] >= textWidth(measure, fit.fontSize) + OPTIONS.padding - 1e-6,
      );
    });
  });
});

describe("a table with running text", () => {
  // Dates and numbers, and a notes column that would be 600pt on one line.
  const notes = running(40);
  const measures = [fixed(10), fixed(10), fixed(12), notes, fixed(9), fixed(10)];

  test("wraps the notes and leaves every other column whole", () => {
    const fit = fitColumns(measures, OPTIONS);
    assert.equal(fit.mode, "wrapped");
    // The type stays as large as it can: it is the notes that give way.
    assert.equal(fit.fontSize, 8.5);
    assert.ok(Math.abs(total(fit.widths) - OPTIONS.contentWidth) < 1e-6);
    assert.deepEqual(fit.wraps, [false, false, false, true, false, false]);
    measures.forEach((measure, index) => {
      if (index === 3) return;
      assert.ok(
        fit.widths[index] >=
          textWidth(measure, fit.fontSize) + OPTIONS.padding - 1e-6,
        `column ${index} is cut`,
      );
    });
  });

  test("never narrows the notes to a word a line while there is room", () => {
    const fit = fitColumns(measures, OPTIONS);
    assert.ok(fit.widths[3] >= OPTIONS.comfortColumnWidth);
  });

  test("the notes still hold their longest word whole", () => {
    const fit = fitColumns(measures, OPTIONS);
    assert.ok(
      fit.widths[3] >= textWidth({ natural: notes.minimum, minimum: notes.minimum }, 8.5) + 8,
    );
  });
});

describe("a table too wide for any of that", () => {
  test("goes to smaller type and wraps, before it squeezes anything", () => {
    // Sixteen columns of running text, each 260pt on one line.
    const measures = Array.from({ length: 16 }, () => running(10));
    const fit = fitColumns(measures, OPTIONS);
    assert.equal(fit.mode, "wrapped");
    assert.ok(fit.fontSize < 8.5);
    assert.ok(Math.abs(total(fit.widths) - OPTIONS.contentWidth) < 1e-6);
  });

  test("a table of unbreakable columns past the floor is squeezed, and says so", () => {
    const measures = Array.from({ length: 40 }, () => fixed(14));
    const fit = fitColumns(measures, OPTIONS);
    assert.equal(fit.mode, "squeezed");
    assert.equal(fit.fontSize, OPTIONS.minFontSize);
    assert.ok(Math.abs(total(fit.widths) - OPTIONS.contentWidth) < 1e-6);
  });

  test("the type is never smaller than the floor", () => {
    for (const count of [3, 8, 16, 24, 40, 80]) {
      const fit = fitColumns(
        Array.from({ length: count }, () => running(12)),
        OPTIONS,
      );
      assert.ok(fit.fontSize >= OPTIONS.minFontSize, `${count} columns`);
      assert.ok(total(fit.widths) <= OPTIONS.contentWidth + 1e-6, `${count} columns`);
    }
  });
});

/** Five points a character: easy to count by hand. */
const measure = (text: string) => text.length * 5;

describe("wrapping text onto lines", () => {
  test("breaks at spaces, and every line fits", () => {
    const lines = wrapText("alpha beta gamma delta epsilon zeta", 60, measure);
    assert.deepEqual(lines, ["alpha beta", "gamma delta", "epsilon zeta"]);
    assert.ok(lines.every((line) => measure(line) <= 60));
  });

  test("the lines say exactly what the text said", () => {
    const text = "Tenant reports a leak under the kitchen sink since Sunday";
    assert.equal(wrapText(text, 80, measure).join(" "), text);
  });

  test("keeps the line breaks the text already has", () => {
    assert.deepEqual(wrapText("first\nsecond line", 200, measure), [
      "first",
      "second line",
    ]);
  });

  test("a word wider than the cell is broken, not run out of it", () => {
    const lines = wrapText("INV-2026-0042-ABCDEFGHIJ", 50, measure);
    assert.ok(lines.length > 1);
    assert.ok(lines.every((line) => measure(line) <= 50));
    assert.equal(lines.join(""), "INV-2026-0042-ABCDEFGHIJ");
  });

  test("text that fits stays one line, and nothing is one empty line", () => {
    assert.deepEqual(wrapText("short", 100, measure), ["short"]);
    assert.deepEqual(wrapText("", 100, measure), [""]);
    // What fits is left exactly as written: a summary row's indentation too.
    assert.deepEqual(wrapText("  cash", 100, measure), ["  cash"]);
    assert.equal(wrapText("   ", 10, measure).length, 1);
  });

  test("a note of a thousand words is cut at the last line it may have", () => {
    const text = Array.from({ length: 1000 }, (_, index) => `w${index}`).join(" ");
    const lines = wrapText(text, 100, measure, 6);
    assert.equal(lines.length, 6);
    assert.ok(lines[5].endsWith("…"));
    assert.ok(lines.every((line) => measure(line) <= 100));
    // Cut text is marked; the whole of a shorter one never is.
    assert.ok(
      !wrapText("one two three", 100, measure, 6).some((line) => line.includes("…")),
    );
  });

  test("clipping marks the cut and respects the width", () => {
    assert.equal(clipToWidth("short", 100, measure), "short");
    const clipped = clipToWidth("a very long cell value", 60, measure);
    assert.ok(clipped.endsWith("…"));
    assert.ok(measure(clipped) <= 60);
  });
});
