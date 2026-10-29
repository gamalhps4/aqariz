/**
 * PropertyPro - A statement's tables, worded once
 *
 * The payments table and the expenses table of an owner or agreement
 * statement, laid out as the client's sample lays them out — التاريخ،
 * المستأجر، الوحدة، العقد، دورة الإيجار، إجمالي العقد، المستلم، المبلغ،
 * ملاحظة، السند — with their headings and cell words taken from one catalogue
 * by the screen (its `t`) and by the exports (the report's language), so the
 * two cannot say different things.
 *
 * No database and nothing server-only: the screen imports it too.
 */

import type { ReportColumn } from "@/lib/reports/export";
import type { LineTranslate } from "@/lib/statements/line-text";
import { formatRate } from "@/lib/statements/summary";
import type {
  StatementExpenseRow,
  StatementPaymentRow,
} from "@/types/owner";
import { businessDay } from "@/lib/dates/business-day";
import { describeNoteWith } from "@/lib/i18n/charge-description";

const words = (value: string) => value.replace(/_/g, " ");

/**
 * The day a statement row is dated, as exports write every table date. One
 * place, so a change to how report dates are written reaches these too.
 */
export function statementDay(value: string): string {
  return businessDay(value);
}

/** الوحدة — "إستراحة 29 - مجمع قنوات 102": the unit, then its building. */
export function paymentUnitText(row: StatementPaymentRow): string {
  return [row.unitNumber, row.propertyName].filter(Boolean).join(" - ");
}

/** دورة الإيجار — the contract's cycle ("شهري"), blank without a contract. */
export function paymentCycleText(
  row: StatementPaymentRow,
  tr: LineTranslate,
): string {
  return row.frequency
    ? tr(`leases.contract.frequency.${row.frequency}`, words(row.frequency))
    : "";
}

/** المستلم — the owner or the office (المالك / المشغل). */
export function receivedByText(
  row: StatementPaymentRow,
  tr: LineTranslate,
): string {
  return row.receivedBy === "owner"
    ? tr("clients.statement.payments.receivedByOwner", "Owner")
    : tr("clients.statement.payments.receivedByOffice", "Office");
}

/**
 * ملاحظة — what the office typed. A payment that is not rent says what it
 * is first ("تأمين — …"): only rent is charged commission, and the reader
 * checking the commission has to be able to tell.
 */
export function paymentNoteText(
  row: StatementPaymentRow,
  tr: LineTranslate,
): string {
  const kind =
    row.paymentType && row.paymentType !== "rent"
      ? tr(`exports.value.${row.paymentType}`, words(row.paymentType))
      : null;
  // A note the system wrote ("Recorded in bulk") is said in the statement's
  // language; what the office typed stays as typed.
  return [kind, describeNoteWith(row.notes, tr)].filter(Boolean).join(" — ");
}

/**
 * An agreement's fee for the details line — "2% من الإيجار المحصل قبل
 * الضريبة", or "3,000 / شهري" for a flat fee. The one place a statement
 * states the percentage in full; the summary's label repeats only the rate.
 */
export function feeDetailText(
  fee: { type: string; percentage: number; amount: number; frequency: string },
  commissionBasis: string,
  tr: LineTranslate,
): string {
  if (fee.type === "percentage") {
    const values = { rate: formatRate(fee.percentage) };
    return commissionBasis === "billed"
      ? tr(
          "clients.statement.details.feePercentageBilled",
          "{rate}% of rent billed, before VAT",
          values,
        )
      : tr(
          "clients.statement.details.feePercentage",
          "{rate}% of rent collected, before VAT",
          values,
        );
  }
  const amount = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(fee.amount);
  const frequency = tr(
    `leases.contract.frequency.${fee.frequency}`,
    words(fee.frequency),
  );
  return `${amount} / ${frequency}`;
}

/** البند — an expense's category in the reader's language. */
export function expenseItemText(
  row: StatementExpenseRow,
  tr: LineTranslate,
): string {
  return tr(`expenses.categories.${row.category}`, words(row.category));
}

/** The payments table of an exported statement. */
export function statementPaymentColumns(
  tr: LineTranslate,
): ReportColumn<StatementPaymentRow>[] {
  return [
    {
      header: tr("clients.statement.payments.date", "Date"),
      value: (row) => statementDay(row.date),
    },
    {
      header: tr("clients.statement.payments.tenant", "Tenant"),
      value: (row) => row.tenantName,
    },
    {
      header: tr("clients.statement.payments.unit", "Unit"),
      value: (row) => paymentUnitText(row),
    },
    {
      header: tr("clients.statement.payments.contract", "Contract"),
      value: (row) => row.contractNumber ?? "",
    },
    {
      header: tr("clients.statement.payments.cycle", "Rent cycle"),
      value: (row) => paymentCycleText(row, tr),
    },
    {
      header: tr("clients.statement.payments.contractTotal", "Contract total"),
      value: (row) => row.contractTotal ?? "",
    },
    {
      header: tr("clients.statement.payments.receivedBy", "Received by"),
      value: (row) => receivedByText(row, tr),
    },
    {
      header: tr("clients.statement.payments.amount", "Amount"),
      value: (row) => row.amount,
    },
    {
      header: tr("clients.statement.payments.note", "Note"),
      value: (row) => paymentNoteText(row, tr),
    },
    {
      header: tr("clients.statement.payments.receipt", "Receipt"),
      value: (row) => row.receiptNumber,
    },
  ];
}

/** The expenses table of an exported statement. */
export function statementExpenseColumns(
  tr: LineTranslate,
): ReportColumn<StatementExpenseRow>[] {
  return [
    {
      header: tr("clients.statement.payments.date", "Date"),
      value: (row) => statementDay(row.date),
    },
    {
      header: tr("clients.statement.expenseRows.property", "Property"),
      value: (row) => row.propertyName,
    },
    {
      header: tr("clients.statement.expenseRows.item", "Item"),
      value: (row) => expenseItemText(row, tr),
    },
    {
      header: tr("clients.statement.expenseRows.description", "Description"),
      value: (row) => row.description,
    },
    {
      header: tr("clients.statement.expenseRows.reference", "Reference"),
      value: (row) => row.reference ?? "",
    },
    {
      header: tr("clients.statement.payments.amount", "Amount"),
      value: (row) => row.amount,
    },
  ];
}
