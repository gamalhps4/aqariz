/**
 * PropertyPro - What a file says it contains
 *
 * An export used to be a table with a title. Whoever received it could not
 * tell which owner it was for, which building, which month, whether the
 * "Active" column was filtered or the whole portfolio, or whether a thousand
 * rows had been cut off at five thousand. The office sends these files on to
 * owners and keeps them for reconciling, and a file that does not say what it
 * covers cannot be trusted a month later.
 *
 * So every list export carries a block under its title, in all three formats
 * and in the reader's language:
 *
 *   - how many rows the file holds,
 *   - the period it covers (or that it is not limited to one),
 *   - every filter that was applied, by name — owner, building, compound,
 *     tenant, status… — and "none" when nothing was,
 *   - and a note when the row limit cut the list short.
 *
 * A route describes what it ran with (`ReportFiltersSummary`); this turns the
 * description into the lines each writer prints. Pure and free of the
 * database, so the same words come out of the PDF, the spreadsheet and the CSV
 * and the tests can pin them.
 */

import { pdfLabel } from "@/lib/invoice/pdf-i18n";
import { formatIsoDay } from "./date-format";
import {
  translateLabel,
  translateValue,
  type ReportLanguage,
  type ValueOptions,
} from "./labels";

/** A filter's value as a route has it: anything unset is left out of the file. */
export type FilterValue = string | number | boolean | null | undefined;

export interface ReportFiltersSummary {
  /**
   * The days the file covers, as ISO days; either end may be open. Present
   * with both ends open it says the file is not limited to a period. Left
   * out, the block has no period line — for a list with no dates to it.
   */
  period?: { from?: string | null; to?: string | null };
  /** For a list as it stands today: the day it was read, as an ISO day. */
  asAt?: string | null;
  /**
   * The filters that were applied, as [label, value]. The label is the
   * English heading ("Owner", "Building"), translated for the reader; a value
   * that is a stored code ("active") is translated as a cell would be, a name
   * is left as it is. An entry with no value was not applied and is skipped.
   */
  filters?: Array<[label: string, value: FilterValue]>;
  /** The number of rows in the file. Defaults to the sheet's own. */
  rows?: number;
  /**
   * The most rows the file may hold. When the file was cut at it, the block
   * says so.
   */
  limit?: number;
  /**
   * Whether the list was cut at the limit — a route that read one row more
   * than it writes knows for certain (`capExportRows`). Left out, a file
   * that holds exactly `limit` rows is taken to have been.
   */
  truncated?: boolean;
}

/** The block as a writer prints it: a heading and its lines. */
export interface FiltersBlock {
  title: string;
  lines: Array<[string, string | number]>;
}

/** A period as the reader's language writes it, in the office's date format. */
export function periodText(
  period: { from?: string | null; to?: string | null },
  language: ReportLanguage,
  options: ValueOptions = {},
): string {
  const day = (iso: string) =>
    options.dateFormat ? formatIsoDay(iso, options.dateFormat) : iso;
  const from = period.from || null;
  const to = period.to || null;
  if (from && to) {
    return pdfLabel(language, "exports.document.period", "{from} to {to}", {
      from: day(from),
      to: day(to),
    });
  }
  if (from) {
    return pdfLabel(language, "exports.document.periodFrom", "From {from}", {
      from: day(from),
    });
  }
  if (to) {
    return pdfLabel(language, "exports.document.periodUntil", "Up to {to}", {
      to: day(to),
    });
  }
  return pdfLabel(language, "exports.document.allDates", "All dates");
}

/**
 * The lines of the block, in the reader's language.
 *
 * `rowCount` is the number of rows the file holds — what the sheet carries,
 * unless the route said otherwise.
 */
export function filtersBlock(
  summary: ReportFiltersSummary,
  rowCount: number,
  language: ReportLanguage,
  options: ValueOptions = {},
): FiltersBlock {
  const rows = summary.rows ?? rowCount;
  const lines: FiltersBlock["lines"] = [
    [pdfLabel(language, "exports.document.rowCount", "Records"), rows],
  ];

  if (summary.period) {
    lines.push([
      translateLabel("Period", language),
      periodText(summary.period, language, options),
    ]);
  }
  if (summary.asAt) {
    lines.push([
      translateLabel("As at", language),
      options.dateFormat ? formatIsoDay(summary.asAt, options.dateFormat) : summary.asAt,
    ]);
  }

  const applied: FiltersBlock["lines"] = [];
  for (const [label, value] of summary.filters ?? []) {
    if (value === null || value === undefined || value === "" || value === false) {
      continue;
    }
    applied.push([
      translateLabel(label, language),
      // What was typed into the search box is shown as typed; a stored code
      // — "overdue", "bank_transfer" — is shown as words.
      label === "Search"
        ? String(value)
        : translateValue(value === true ? "yes" : value, language, options),
    ]);
  }
  if (applied.length === 0) {
    lines.push([
      translateLabel("Filters", language),
      pdfLabel(language, "exports.document.noFilters", "None"),
    ]);
  } else {
    lines.push(...applied);
  }

  const cut =
    summary.truncated ??
    (summary.limit !== undefined && rows >= summary.limit);
  if (cut && summary.limit !== undefined) {
    lines.push([
      translateLabel("Note", language),
      pdfLabel(
        language,
        "exports.document.truncated",
        "File limit: {limit} rows — narrow the filters to see the rest",
        { limit: new Intl.NumberFormat("en-US").format(summary.limit) },
      ),
    ]);
  }

  return {
    title: pdfLabel(language, "exports.document.filtersTitle", "Filters and period"),
    lines,
  };
}
