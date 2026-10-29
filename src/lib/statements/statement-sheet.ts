/**
 * PropertyPro - A statement of account as an exported sheet
 *
 * The owner's statement and a management agreement's statement download as
 * the same document, laid out as the client's sample: the office's letterhead
 * (drawn by the export itself), the title, the details — whose, over what,
 * for which period — the summary under its heading, every payment, and the
 * expenses in a table of their own. Worded from the same catalogue as the
 * screen (lib/statements/summary.ts, document.ts).
 */

import {
  reportSection,
  type ReportColumn,
  type ReportSheet,
} from "@/lib/reports/export";
import type { LineTranslate } from "@/lib/statements/line-text";
import {
  statementSummaryRows,
  SUMMARY_TITLE_KEY,
} from "@/lib/statements/summary";
import {
  statementDay,
  statementExpenseColumns,
  statementPaymentColumns,
} from "@/lib/statements/document";
import type { OwnerStatement, StatementPaymentRow } from "@/types/owner";

export type StatementDetails = Array<[string, string | number]>;

/** "2026-01-01 to 2026-09-29" — the export writes it in the reader's words and date format. */
export function statementPeriod(statement: OwnerStatement): string {
  return `${statementDay(statement.period.startDate)} to ${statementDay(statement.period.endDate)}`;
}

/**
 * What the commission was charged on, as a detail — only when it is not
 * simply everything collected, so the reader can check the percentage in
 * the commission label against something printed.
 */
export function commissionBaseDetail(
  statement: OwnerStatement,
  tr: LineTranslate,
): StatementDetails {
  const { totals } = statement;
  if (statement.commissionSource !== "agreements") return [];
  if (Math.abs(totals.commissionBase - totals.rentCollected) < 0.005) return [];
  return [
    [
      tr("clients.statement.details.commissionBase", "Commission charged on"),
      totals.commissionBase,
    ],
  ];
}

/** The summary rows, as an export writes them. */
export function statementSummaryPairs(
  statement: OwnerStatement,
  tr: LineTranslate,
): Array<[string, number]> {
  const { totals } = statement;
  return statementSummaryRows(
    {
      collected: totals.rentCollected,
      commission: totals.commission,
      commissionTax: totals.commissionTax,
      expenses: totals.expenses,
      investmentRent: totals.investmentRent,
      collectedByOwner: totals.collectedByOwner,
      collectedByOperator: totals.collectedByOperator,
      dueToOwner: totals.dueToOwner,
      dueToOperator: totals.dueToOperator,
    },
    statement.commissionPercentage,
    tr,
  ).map((row) => [row.label, row.amount]);
}

/** The whole statement: payments as the main table, expenses after them. */
export function statementSheet(
  statement: OwnerStatement,
  options: { title: string; details: StatementDetails; tr: LineTranslate },
): ReportSheet<StatementPaymentRow> {
  const { tr } = options;
  return {
    title: options.title,
    columns: statementPaymentColumns(tr),
    rows: statement.payments,
    summary: statementSummaryPairs(statement, tr),
    document: {
      details: options.details,
      summaryTitle: tr(SUMMARY_TITLE_KEY, "Summary"),
      tableTitle: tr("clients.statement.payments.title", "Payments"),
      emptyText: tr(
        "clients.statement.payments.empty",
        "No payments were received in this period",
      ),
      sections: [
        reportSection(
          tr("clients.statement.expenseRows.title", "Expenses"),
          statementExpenseColumns(tr),
          statement.expenses,
          tr(
            "clients.statement.expenseRows.empty",
            "No expenses were deducted in this period",
          ),
        ),
      ],
    },
  };
}

/**
 * The same statement with another table in place of the payments — the rent
 * roll, which the office still exports on its own.
 */
export function statementSheetWith<R>(
  statement: OwnerStatement,
  options: {
    title: string;
    details: StatementDetails;
    tr: LineTranslate;
    columns: ReportColumn<R>[];
    rows: R[];
  },
): ReportSheet<R> {
  const { tr } = options;
  return {
    title: options.title,
    columns: options.columns,
    rows: options.rows,
    summary: statementSummaryPairs(statement, tr),
    document: {
      details: options.details,
      summaryTitle: tr(SUMMARY_TITLE_KEY, "Summary"),
    },
  };
}
