/**
 * PropertyPro - Fitting a table to a page
 *
 * The report PDF is one table on an A4 landscape page, and the table is
 * whatever the report says: four columns, or the overdue register's thirteen.
 * Two things went wrong when it was wide.
 *
 * The fit estimated a font size by scaling the TEXT widths, but every column
 * also carries a fixed inset on both sides that does not scale with type. The
 * estimate overshot, the columns were then squeezed by another 3-7% to make up
 * the difference, and a squeezed column is narrower than its own text — so the
 * last character of a date was clipped, and every long cell ended in "…".
 *
 * And a long note was cut at the column's edge and lost; the full text was
 * only ever in the Excel file.
 *
 * Here the widths are solved exactly, from the measured text:
 *
 *   1. as it is — each column as wide as its widest cell — when that fits;
 *   2. otherwise the type is shrunk a little, as far as a comfortable size,
 *      when that alone makes it fit;
 *   3. otherwise the columns that hold running text are narrowed, and their
 *      cells wrap onto further lines. Dates, numbers, codes and phone numbers
 *      keep their whole width, always;
 *   4. only a table too wide even for that goes to smaller type, and last of
 *      all is squeezed — which is the one case that can still clip.
 *
 * Pure arithmetic on measured widths, so it is tested without a PDF.
 */

/**
 * The size text is measured at unless a caller says otherwise. Text width is
 * exactly linear in type size, so one measurement serves every size the fit
 * tries.
 */
export const REFERENCE_FONT_SIZE = 10;

/** What it takes to place one column: how wide its text is, how narrow it can go. */
export interface ColumnMeasure {
  /** Its widest cell or header on one line, at the reference size. */
  natural: number;
  /**
   * The narrowest it can be and still show every word whole: its longest
   * word, at the reference size. Equal to `natural` for a column of
   * dates, numbers and codes, which have no spaces to wrap at.
   */
  minimum: number;
}

export interface ColumnFitOptions {
  /** Width of the area the table fills. */
  contentWidth: number;
  /**
   * The type size the measures were taken at. Measuring at the size the
   * table is normally set in makes that case exact, with no scaling at all.
   * Defaults to REFERENCE_FONT_SIZE.
   */
  referenceFontSize?: number;
  /** The type a table is set in when it fits as it is. */
  maxFontSize: number;
  /**
   * The smallest type a table is shrunk to *instead of* wrapping. Below it,
   * wrapping text reads better than still smaller type.
   */
  comfortFontSize: number;
  /** Smallest type that still photocopies and reads on paper. */
  minFontSize: number;
  /** Room a cell needs beside its text: the inset on both sides. */
  padding: number;
  /**
   * The least room a cell can do with. A table that is only just too wide
   * for the smallest type gives up the difference here before any column is
   * made narrower than its text. Defaults to `padding`.
   */
  tightPadding?: number;
  /** No column is narrower than this. */
  minColumnWidth: number;
  /**
   * How narrow a column of running text is made before the type is
   * reduced instead: a column of one word to a line is hard to read.
   */
  comfortColumnWidth: number;
  /** How finely the type size is stepped when it has to go down. */
  step?: number;
}

export type ColumnFitMode = "fits" | "shrunk" | "wrapped" | "squeezed";

export interface ColumnFit {
  widths: number[];
  fontSize: number;
  mode: ColumnFitMode;
  /**
   * The columns narrower than their own widest cell, whose cells may need
   * more than one line. The others never wrap.
   */
  wraps: boolean[];
}

const EPSILON = 0.01;

const sum = (values: readonly number[]) =>
  values.reduce((total, value) => total + value, 0);

/** Each column as wide as its widest cell, at a type size. */
function naturalWidths(
  measures: readonly ColumnMeasure[],
  fontSize: number,
  options: ColumnFitOptions,
): number[] {
  const scale = fontSize / (options.referenceFontSize ?? REFERENCE_FONT_SIZE);
  return measures.map((measure) =>
    Math.max(measure.natural * scale + options.padding, options.minColumnWidth),
  );
}

/**
 * The narrowest each column may be made at a type size. A column with spaces
 * to wrap at goes down to its longest word — or, when `comfortable`, no
 * further than a width a few words fit in; one without cannot go below its
 * text.
 */
function narrowestWidths(
  measures: readonly ColumnMeasure[],
  fontSize: number,
  options: ColumnFitOptions,
  comfortable: boolean,
): number[] {
  const scale = fontSize / (options.referenceFontSize ?? REFERENCE_FONT_SIZE);
  const natural = naturalWidths(measures, fontSize, options);
  return measures.map((measure, index) => {
    if (measure.minimum >= measure.natural - EPSILON) return natural[index];
    const longestWord = Math.max(
      measure.minimum * scale + options.padding,
      options.minColumnWidth,
    );
    if (!comfortable) return Math.min(longestWord, natural[index]);
    const comfort =
      options.comfortColumnWidth * (fontSize / options.maxFontSize);
    return Math.min(natural[index], Math.max(longestWord, comfort));
  });
}

/** Spread what is left over in proportion to each column's width. */
function fillSlack(widths: readonly number[], contentWidth: number): number[] {
  const total = sum(widths);
  const slack = contentWidth - total;
  if (slack <= 0 || total <= 0) return [...widths];
  return widths.map((width) => width + (slack * width) / total);
}

/**
 * Narrow the columns that can wrap, each by a share of what it can give up,
 * until the table is as wide as the page. Dates and numbers give up nothing.
 */
function narrowToFit(
  natural: readonly number[],
  narrowest: readonly number[],
  contentWidth: number,
): number[] {
  const give = natural.map((width, index) => width - narrowest[index]);
  const available = sum(give);
  const deficit = sum(natural) - contentWidth;
  if (available <= 0 || deficit <= 0) return [...natural];
  const share = Math.min(1, deficit / available);
  return natural.map((width, index) => width - give[index] * share);
}

/**
 * Where each column goes, and in what size of type.
 *
 * With nothing to measure the answer is no columns.
 */
export function fitColumns(
  measures: readonly ColumnMeasure[],
  options: ColumnFitOptions,
): ColumnFit {
  const { contentWidth, maxFontSize, minFontSize } = options;
  const step = options.step ?? 0.25;
  if (measures.length === 0) {
    return { widths: [], fontSize: maxFontSize, mode: "fits", wraps: [] };
  }

  const result = (
    widths: number[],
    fontSize: number,
    mode: ColumnFitMode,
  ): ColumnFit => {
    const natural = naturalWidths(measures, fontSize, options);
    return {
      widths,
      fontSize,
      mode,
      wraps: widths.map((width, index) => width < natural[index] - EPSILON),
    };
  };

  // 1. As it is.
  const atMax = naturalWidths(measures, maxFontSize, options);
  if (sum(atMax) <= contentWidth) {
    return result(fillSlack(atMax, contentWidth), maxFontSize, "fits");
  }

  // 2. A little smaller, to avoid wrapping anything. The width is
  // increasing in type size, so the largest size that fits is found by
  // bisection; it is rounded DOWN, so float error cannot push it over.
  const comfort = Math.min(options.comfortFontSize, maxFontSize);
  if (sum(naturalWidths(measures, comfort, options)) <= contentWidth) {
    let low = comfort;
    let high = maxFontSize;
    for (let round = 0; round < 40; round += 1) {
      const middle = (low + high) / 2;
      if (sum(naturalWidths(measures, middle, options)) <= contentWidth) {
        low = middle;
      } else {
        high = middle;
      }
    }
    const fontSize = Math.floor(low * 100) / 100;
    return result(
      fillSlack(naturalWidths(measures, fontSize, options), contentWidth),
      fontSize,
      "shrunk",
    );
  }

  // 3. Wrap running text, in the largest type that lets every column keep a
  // comfortable width — a quarter of a point smaller each time round. Type
  // that small may be enough on its own, with nothing to wrap.
  for (
    let fontSize = maxFontSize;
    fontSize >= minFontSize - EPSILON;
    fontSize -= step
  ) {
    const size = Math.max(fontSize, minFontSize);
    const natural = naturalWidths(measures, size, options);
    if (sum(natural) <= contentWidth) {
      return result(fillSlack(natural, contentWidth), size, "shrunk");
    }
    const narrowest = narrowestWidths(measures, size, options, true);
    if (sum(narrowest) <= contentWidth + EPSILON) {
      return result(
        narrowToFit(natural, narrowest, contentWidth),
        size,
        "wrapped",
      );
    }
  }

  // 4. Cramped: at the smallest type, columns down to their longest word.
  const cramped = narrowestWidths(measures, minFontSize, options, false);
  if (sum(cramped) <= contentWidth + EPSILON) {
    return result(
      narrowToFit(naturalWidths(measures, minFontSize, options), cramped, contentWidth),
      minFontSize,
      "wrapped",
    );
  }

  // 5. Last of all: a table too wide for anything. First the insets are
  // taken in to the least a cell can do with, which saves a table that is
  // only just over; then its columns are squeezed in proportion, and cells
  // wider than that are cut with "…" when drawn.
  const tight = naturalWidths(measures, minFontSize, {
    ...options,
    padding: Math.min(options.tightPadding ?? options.padding, options.padding),
  });
  if (sum(tight) <= contentWidth + EPSILON) {
    return result(fillSlack(tight, contentWidth), minFontSize, "squeezed");
  }
  const total = sum(tight);
  return result(
    tight.map((width) => (width * contentWidth) / total),
    minFontSize,
    "squeezed",
  );
}

/**
 * Cut `text` to a width, marking the cut with "…". For the one cell that is
 * still too long when every other way of fitting it has been used.
 */
export function clipToWidth(
  text: string,
  width: number,
  measure: (text: string) => number,
): string {
  if (measure(text) <= width) return text;
  let clipped = text;
  while (clipped.length > 1 && measure(`${clipped}…`) > width) {
    clipped = clipped.slice(0, -1);
  }
  return `${clipped.trimEnd()}…`;
}

/** A word wider than a line, broken where it must be: by characters. */
function breakWord(
  word: string,
  width: number,
  measure: (text: string) => number,
): string[] {
  const pieces: string[] = [];
  let current = "";
  for (const character of Array.from(word)) {
    if (current && measure(current + character) > width) {
      pieces.push(current);
      current = character;
    } else {
      current += character;
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

/**
 * Break text into lines no wider than `width`.
 *
 * At spaces, and at the line breaks the text already has. A word wider than a
 * whole line is broken by characters — an identifier or an address with no
 * spaces must not run out of its cell. With `maxLines`, the text that does not
 * fit is cut at the last line and marked with "…": a note of a thousand words
 * must not take a page of its own.
 */
export function wrapText(
  text: string,
  width: number,
  measure: (text: string) => number,
  maxLines = Number.POSITIVE_INFINITY,
): string[] {
  // Text that fits on a line is left exactly as it was written — its
  // indentation and its spacing included.
  if (!/[\r\n]/.test(text) && measure(text) <= width) return [text];

  const lines: string[] = [];

  for (const paragraph of text.split(/\r\n|\r|\n/)) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (measure(candidate) <= width) {
        current = candidate;
        continue;
      }
      if (current) lines.push(current);
      if (measure(word) <= width) {
        current = word;
        continue;
      }
      const pieces = breakWord(word, width, measure);
      current = pieces.pop() ?? "";
      lines.push(...pieces);
    }
    if (current) lines.push(current);
  }

  // A lone blank line from an empty cell is no line at all.
  while (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  if (lines.length <= maxLines) return lines.length ? lines : [""];

  const kept = lines.slice(0, Math.max(1, maxLines));
  kept[kept.length - 1] = clipToWidth(
    `${kept[kept.length - 1]} ${lines[kept.length] ?? ""}`.trim(),
    width,
    measure,
  );
  return kept;
}
