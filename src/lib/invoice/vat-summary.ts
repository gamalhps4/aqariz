/**
 * PropertyPro - The VAT summary
 *
 * What the office charged VAT on and what it paid VAT on, per category and
 * rate, over a period — the figures a VAT return is filled from, before the
 * ledger keeps them (phase 0):
 *
 *  - output VAT from its invoices and credit notes (a credit note takes its
 *    figures off), each line by its own category; an invoice without lines —
 *    an installment, an older invoice — by its one treatment
 *    (vat.ts `legacyInvoiceVat`);
 *  - rent billed on an owner's building is the owner's supply, not the
 *    office's: it is shown apart, as the ledger posts it (out of scope for the
 *    office), so the office's own output VAT is not overstated;
 *  - input VAT from its approved and paid expenses. VAT on an owner's
 *    building is the owner's cost, which the office cannot reclaim — shown
 *    apart as well;
 *  - input VAT from its approved purchase bills (always the office's own
 *    purchases), line by line;
 *  - output VAT on its commission from owner settlements that booked it
 *    themselves (closed before settlements issued a tax invoice; one with an
 *    invoice is counted through the invoice), and off again when cancelled.
 *
 * Every document is dated the way the ledger posts it, so the summary and the
 * ledger's VAT return agree for any period: an installment on its due day, a
 * custom invoice or credit note on its issue day (`invoicePostingDate`), a
 * bill on its date, a settlement on its entry's day.
 *
 * Pure: the route reads the documents and decides whose building each is on.
 */

import {
  legacyInvoiceVat,
  VAT_CATEGORIES,
  type VatBreakdownRow,
  type VatCategory,
} from "@/lib/invoice/vat";
import { ledgerDay } from "@/lib/accounting/dates";
import { invoicePostingDate } from "@/lib/accounting/posting/invoice";
import { businessDay } from "@/lib/dates/business-day";

export type VatPeriodGrouping = "month" | "quarter";

export interface VatInvoiceDoc {
  id: string;
  /** The office's calendar day it was issued on: "2026-10-04". */
  day: string;
  documentType: "invoice" | "credit_note";
  category: string | null;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  /** Its own lines, when it was written line by line. */
  lines: Array<Pick<VatBreakdownRow, "vatCategory" | "vatRate" | "netAmount" | "vatAmount">>;
  /** Billed on a building an owner holds (the owner's supply). */
  onOwnersBuilding: boolean;
}

export interface VatExpenseDoc {
  id: string;
  day: string;
  /** What was paid, VAT included. */
  amount: number;
  vatAmount: number;
  vatCategory: VatCategory | null;
  /** Spent on a building an owner holds (the owner's cost). */
  onOwnersBuilding: boolean;
}

/** A purchase bill's VAT lines, on the bill's date. */
export interface VatBillDoc {
  id: string;
  day: string;
  lines: Array<Pick<VatBreakdownRow, "vatCategory" | "vatRate" | "netAmount" | "vatAmount">>;
}

/**
 * The commission an owner settlement booked itself, on its entry's day; its
 * cancellation is one more of these, negative, on the cancellation's day.
 */
export interface VatSettlementDoc {
  id: string;
  day: string;
  netAmount: number;
  vatAmount: number;
  vatRate: number;
}

/**
 * The office's day an invoice counts on: the day the ledger posts it (an
 * installment's due day, a custom invoice's or credit note's issue day).
 */
export function invoiceVatDay(invoice: { issueDate: Date; dueDate: Date }, lined: boolean): string {
  return businessDay(ledgerDay(invoicePostingDate(invoice, lined)));
}

/** One standard-rated line of an owner settlement's entry, as the books hold it. */
export interface SettlementVatLine {
  entryId: string;
  day: string;
  debit: number;
  credit: number;
  /** On an income account (the commission); otherwise the output VAT. */
  income: boolean;
}

/** The commission and its VAT per settlement entry (a reversal comes out negative). */
export function settlementVatDocs(lines: readonly SettlementVatLine[], vatRate: number): VatSettlementDoc[] {
  const byEntry = new Map<string, { day: string; net: number; vat: number }>();
  for (const line of lines) {
    const entry = byEntry.get(line.entryId) ?? { day: line.day, net: 0, vat: 0 };
    const amount = cents(line.credit) - cents(line.debit);
    if (line.income) entry.net += amount;
    else entry.vat += amount;
    byEntry.set(line.entryId, entry);
  }
  return [...byEntry.entries()].map(([id, entry]) => ({
    id,
    day: entry.day,
    netAmount: amount(entry.net),
    vatAmount: amount(entry.vat),
    vatRate,
  }));
}

export interface VatSummaryRow {
  vatCategory: VatCategory;
  vatRate: number;
  netAmount: number;
  vatAmount: number;
  /** Documents with a line in this row. */
  count: number;
}

export interface VatSummaryBlock {
  rows: VatSummaryRow[];
  netAmount: number;
  vatAmount: number;
}

export interface VatPeriodRow {
  /** "2026-10" or "2026-Q4". */
  key: string;
  outputVat: number;
  inputVat: number;
  netVat: number;
}

export interface VatSummary {
  /** The office's own supplies: what its VAT return declares. */
  output: VatSummaryBlock;
  /** Rent and charges billed on owners' buildings: the owners' supplies. */
  ownersOutput: VatSummaryBlock;
  /** VAT the office paid and may reclaim. */
  input: VatSummaryBlock;
  /** VAT paid on owners' buildings: theirs, not reclaimable by the office. */
  ownersInput: VatSummaryBlock;
  creditNotes: { count: number; netAmount: number; vatAmount: number };
  /** Output VAT less reclaimable input VAT: what the office owes (negative: is owed). */
  netVatDue: number;
  periods: VatPeriodRow[];
}

const cents = (value: number) => Math.round(value * 100);
const amount = (value: number) => {
  const result = value / 100;
  return Object.is(result, -0) ? 0 : result;
};

/** "2026-10" or "2026-Q4" for a day. */
export function vatPeriodKey(day: string, grouping: VatPeriodGrouping): string {
  const year = day.slice(0, 4);
  const month = Number(day.slice(5, 7));
  return grouping === "quarter"
    ? `${year}-Q${Math.floor((month - 1) / 3) + 1}`
    : `${year}-${String(month).padStart(2, "0")}`;
}

class Accumulator {
  private rows = new Map<string, { row: VatSummaryRow; net: number; vat: number; ids: Set<string> }>();

  add(id: string, line: Pick<VatBreakdownRow, "vatCategory" | "vatRate" | "netAmount" | "vatAmount">) {
    const rate = line.vatCategory === "S" ? Number(line.vatRate) : 0;
    const key = `${line.vatCategory}:${rate}`;
    const entry = this.rows.get(key) ?? {
      row: { vatCategory: line.vatCategory, vatRate: rate, netAmount: 0, vatAmount: 0, count: 0 },
      net: 0,
      vat: 0,
      ids: new Set<string>(),
    };
    entry.net += cents(line.netAmount);
    entry.vat += cents(line.vatAmount);
    entry.ids.add(id);
    this.rows.set(key, entry);
  }

  block(): VatSummaryBlock {
    const rows = [...this.rows.values()]
      .map(({ row, net, vat, ids }) => ({
        ...row,
        netAmount: amount(net),
        vatAmount: amount(vat),
        count: ids.size,
      }))
      .sort(
        (a, b) =>
          VAT_CATEGORIES.indexOf(a.vatCategory) - VAT_CATEGORIES.indexOf(b.vatCategory) ||
          b.vatRate - a.vatRate,
      );
    return {
      rows,
      netAmount: amount(rows.reduce((sum, row) => sum + cents(row.netAmount), 0)),
      vatAmount: amount(rows.reduce((sum, row) => sum + cents(row.vatAmount), 0)),
    };
  }
}

/** The lines an invoice is counted by: its own, or its one treatment. */
export function invoiceVatLines(doc: VatInvoiceDoc) {
  if (doc.lines.length > 0) return doc.lines;
  return [legacyInvoiceVat(doc)];
}

/** An expense as one VAT line: its category, the VAT inside it, the rest net. */
export function expenseVatLine(doc: VatExpenseDoc) {
  const vat = Number(doc.vatAmount) || 0;
  const category: VatCategory | null = doc.vatCategory ?? (vat > 0 ? "S" : null);
  if (!category) return null;
  const net = Number(doc.amount) - vat;
  let rate = 0;
  if (category === "S" && net > 0) {
    const exact = (vat / net) * 100;
    rate =
      Math.abs(exact - Math.round(exact)) < 0.1
        ? Math.round(exact)
        : Math.round(exact * 100) / 100;
  }
  return { vatCategory: category, vatRate: rate, netAmount: net, vatAmount: vat };
}

export function summarizeVat(
  invoices: readonly VatInvoiceDoc[],
  expenses: readonly VatExpenseDoc[],
  grouping: VatPeriodGrouping = "month",
  extra: { bills?: readonly VatBillDoc[]; settlements?: readonly VatSettlementDoc[] } = {},
): VatSummary {
  const output = new Accumulator();
  const ownersOutput = new Accumulator();
  const input = new Accumulator();
  const ownersInput = new Accumulator();
  const periods = new Map<string, { output: number; input: number }>();
  const period = (day: string) => {
    const key = vatPeriodKey(day, grouping);
    const entry = periods.get(key) ?? { output: 0, input: 0 };
    periods.set(key, entry);
    return entry;
  };
  const credit = { count: 0, net: 0, vat: 0 };

  for (const doc of invoices) {
    const lines = invoiceVatLines(doc);
    const target = doc.onOwnersBuilding ? ownersOutput : output;
    for (const line of lines) target.add(doc.id, line);
    if (!doc.onOwnersBuilding) {
      period(doc.day).output += lines.reduce((sum, line) => sum + cents(line.vatAmount), 0);
    }
    if (doc.documentType === "credit_note") {
      credit.count += 1;
      credit.net += lines.reduce((sum, line) => sum + cents(line.netAmount), 0);
      credit.vat += lines.reduce((sum, line) => sum + cents(line.vatAmount), 0);
    }
  }

  for (const doc of extra.settlements ?? []) {
    const line = {
      vatCategory: (cents(doc.vatAmount) !== 0 ? "S" : "E") as VatCategory,
      vatRate: cents(doc.vatAmount) !== 0 ? doc.vatRate : 0,
      netAmount: doc.netAmount,
      vatAmount: doc.vatAmount,
    };
    output.add(doc.id, line);
    period(doc.day).output += cents(line.vatAmount);
  }

  for (const doc of expenses) {
    const line = expenseVatLine(doc);
    if (!line) continue;
    if (doc.onOwnersBuilding) {
      ownersInput.add(doc.id, line);
    } else {
      input.add(doc.id, line);
      period(doc.day).input += cents(line.vatAmount);
    }
  }

  for (const doc of extra.bills ?? []) {
    for (const line of doc.lines) {
      if (cents(line.netAmount) === 0 && cents(line.vatAmount) === 0) continue;
      input.add(doc.id, line);
      period(doc.day).input += cents(line.vatAmount);
    }
  }

  const outputBlock = output.block();
  const inputBlock = input.block();
  return {
    output: outputBlock,
    ownersOutput: ownersOutput.block(),
    input: inputBlock,
    ownersInput: ownersInput.block(),
    creditNotes: { count: credit.count, netAmount: amount(credit.net), vatAmount: amount(credit.vat) },
    netVatDue: amount(cents(outputBlock.vatAmount) - cents(inputBlock.vatAmount)),
    periods: [...periods.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => ({
        key,
        outputVat: amount(entry.output),
        inputVat: amount(entry.input),
        netVat: amount(entry.output - entry.input),
      })),
  };
}
