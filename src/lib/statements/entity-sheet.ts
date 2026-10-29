/**
 * PropertyPro - A compound, building or unit statement as an exported sheet
 *
 * Laid out as the owner's statement downloads (statement-sheet.ts): the
 * office's letterhead (drawn by the export itself), the title and details
 * (entity-details.ts), the summary under its heading, then the tables — a
 * compound's buildings or a building's units, every payment received and
 * every expense; a unit's statement leads with its payments.
 *
 * Server-side: it builds on lib/reports/export.ts, which the screen must not
 * import.
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
  statementExpenseColumns,
  statementPaymentColumns,
} from "@/lib/statements/document";
import {
  breakdownLabel,
  breakdownStatus,
  breakdownTitle,
} from "@/lib/statements/entity-details";
import type {
  EntityStatement,
  EntityStatementBreakdownRow,
} from "@/types/entity-statement";
import type { StatementPaymentRow } from "@/types/owner";

/** The breakdown's columns, as the export writes them. */
export function breakdownColumns(
  statement: EntityStatement,
  tr: LineTranslate,
): ReportColumn<EntityStatementBreakdownRow>[] {
  const byUnit = statement.breakdownKind === "unit";
  const invested = statement.breakdown.some((row) => row.investmentRent > 0);
  return [
    {
      header: byUnit
        ? tr("statements.columns.unit", "Unit")
        : tr("statements.columns.building", "Building"),
      value: (row) => breakdownLabel(row, tr),
    },
    ...(byUnit
      ? [
          {
            header: tr("statements.columns.status", "Status"),
            value: (row: EntityStatementBreakdownRow) => breakdownStatus(row, tr),
          },
        ]
      : []),
    {
      header: tr("statements.columns.billed", "Billed"),
      value: (row) => row.rentBilled,
    },
    {
      header: tr("statements.columns.collected", "Collected"),
      value: (row) => row.rentCollected,
    },
    {
      header: tr("statements.columns.expenses", "Expenses"),
      value: (row) => row.expenses,
    },
    {
      header: tr("statements.columns.commission", "Commission"),
      value: (row) => row.commission,
    },
    {
      header: tr("clients.statement.settlement.commissionTax", "VAT on commission"),
      value: (row) => row.commissionTax,
    },
    ...(invested
      ? [
          {
            header: tr(
              "clients.statement.settlement.investmentRent",
              "Investment rent owed to the owner",
            ),
            value: (row: EntityStatementBreakdownRow) => row.investmentRent,
          },
        ]
      : []),
    {
      header: tr("statements.columns.ownerShare", "Owner's share"),
      value: (row) => row.ownerShare,
    },
  ];
}

/** The summary rows (الملخص), as an export writes them. */
export function entitySummaryPairs(
  statement: EntityStatement,
  tr: LineTranslate,
): Array<[string, number]> {
  const { settlement } = statement;
  return statementSummaryRows(
    {
      collected: settlement.collected,
      commission: settlement.commission,
      commissionTax: settlement.commissionTax,
      expenses: settlement.expenses,
      investmentRent: settlement.investmentRent,
      collectedByOwner: settlement.collectedByOwner,
      collectedByOperator: settlement.collectedByOperator,
      dueToOwner: settlement.dueToOwner,
      dueToOperator: settlement.dueToOperator,
    },
    statement.commissionPercentage,
    tr,
  ).map((row) => [row.label, row.amount]);
}

interface SheetOptions {
  title: string;
  details: Array<[string, string | number]>;
  tr: LineTranslate;
}

function sheetParts(statement: EntityStatement, options: SheetOptions) {
  const { tr } = options;
  return {
    paymentsTitle: tr("clients.statement.payments.title", "Payments"),
    paymentsEmpty: tr(
      "clients.statement.payments.empty",
      "No payments were received in this period",
    ),
    expenses: reportSection(
      tr("clients.statement.expenseRows.title", "Expenses"),
      statementExpenseColumns(tr),
      statement.expenses,
      tr(
        "clients.statement.expenseRows.empty",
        "No expenses were deducted in this period",
      ),
    ),
    summary: entitySummaryPairs(statement, tr),
    summaryTitle: tr(SUMMARY_TITLE_KEY, "Summary"),
  };
}

/**
 * A compound's or a building's statement as one exported document: its
 * buildings or units as the main table, then every payment and every
 * expense.
 */
export function breakdownStatementSheet(
  statement: EntityStatement,
  options: SheetOptions,
): ReportSheet<EntityStatementBreakdownRow> {
  const { tr } = options;
  const parts = sheetParts(statement, options);
  return {
    title: options.title,
    columns: breakdownColumns(statement, tr),
    rows: statement.breakdown,
    summary: parts.summary,
    document: {
      details: options.details,
      summaryTitle: parts.summaryTitle,
      tableTitle: breakdownTitle(statement, tr),
      sections: [
        reportSection(
          parts.paymentsTitle,
          statementPaymentColumns(tr),
          statement.payments,
          parts.paymentsEmpty,
        ),
        parts.expenses,
      ],
    },
  };
}

/** A unit's statement as one exported document: its payments, then its expenses. */
export function unitStatementSheet(
  statement: EntityStatement,
  options: SheetOptions,
): ReportSheet<StatementPaymentRow> {
  const { tr } = options;
  const parts = sheetParts(statement, options);
  return {
    title: options.title,
    columns: statementPaymentColumns(tr),
    rows: statement.payments,
    summary: parts.summary,
    document: {
      details: options.details,
      summaryTitle: parts.summaryTitle,
      tableTitle: parts.paymentsTitle,
      emptyText: parts.paymentsEmpty,
      sections: [parts.expenses],
    },
  };
}
