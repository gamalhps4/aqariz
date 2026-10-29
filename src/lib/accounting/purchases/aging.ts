/**
 * PropertyPro - Payables aging
 *
 * What the office owes each supplier at a day, by how long it has been due:
 * not yet due, 1–30 days overdue, 31–60, 61–90, over 90. Built from the
 * documents the supplier's account is made of — approved bills with what is
 * still unpaid on them, and expenses approved with a supplier but not paid —
 * less the payments sitting on account (what a voucher paid beyond the bills
 * it was allocated to).
 *
 * A bill due today is not yet overdue. Everything is in halalas until the
 * result is written out, so the columns always add up to the total.
 *
 * Pure: the service reads the documents, the screen and the export show this.
 */

import { toHalalas } from "../money";
import { formatDay } from "../dates";
import { AGING_BUCKETS, type AgingBucket } from "./types";

const DAY_MS = 86_400_000;

/** Whole days past the due day: zero or less while it is not yet overdue. */
export function daysPastDue(asOf: Date, dueDate: Date): number {
  return Math.floor((asOf.getTime() - dueDate.getTime()) / DAY_MS);
}

export function bucketFor(asOf: Date, dueDate: Date): AgingBucket {
  const days = daysPastDue(asOf, dueDate);
  if (days <= 0) return "current";
  if (days <= 30) return "d1_30";
  if (days <= 60) return "d31_60";
  if (days <= 90) return "d61_90";
  return "d90_plus";
}

/** One thing the office owes a supplier, as it stands at the day. */
export interface AgingItem {
  /** A purchase bill, or an expense approved with a supplier and not paid. */
  kind: "bill" | "expense";
  id: string;
  /** What the screens show: BILL-000012, or the expense's number. */
  number: string;
  supplierId: string;
  supplierName: string;
  /** The supplier's own invoice number. */
  reference: string | null;
  date: Date;
  dueDate: Date;
  /** What it was for, riyals. */
  total: number;
  /** What was still unpaid at the day, riyals. */
  outstanding: number;
}

/** What a voucher paid beyond the bills it was allocated to. */
export interface AgingAdvance {
  supplierId: string;
  supplierName: string;
  voucherId: string;
  /** PV-000045 */
  number: string;
  date: Date;
  /** Riyals. */
  amount: number;
}

export interface AgedItem extends Omit<AgingItem, "date" | "dueDate"> {
  date: string;
  dueDate: string;
  daysPastDue: number;
  bucket: AgingBucket;
}

export interface AgedAdvance extends Omit<AgingAdvance, "date"> {
  date: string;
}

export interface AgingSupplierRow {
  supplierId: string;
  supplierName: string;
  buckets: Record<AgingBucket, number>;
  /** The five columns together. */
  outstanding: number;
  /** Paid on account, to be set against what falls due. */
  onAccount: number;
  /** outstanding less onAccount: what the office owes them (negative: they owe it). */
  net: number;
  items: AgedItem[];
  advances: AgedAdvance[];
}

export interface AgingTotals {
  buckets: Record<AgingBucket, number>;
  outstanding: number;
  onAccount: number;
  net: number;
}

export interface AgingReport {
  asOf: string;
  rows: AgingSupplierRow[];
  totals: AgingTotals;
}

const zeroBuckets = (): Record<AgingBucket, number> => ({
  current: 0,
  d1_30: 0,
  d31_60: 0,
  d61_90: 0,
  d90_plus: 0,
});

const riyals = (halalas: number) => halalas / 100 || 0;

/** Group the items by supplier into the aging columns at `asOf`. */
export function buildAging(
  items: readonly AgingItem[],
  advances: readonly AgingAdvance[],
  asOf: Date,
): AgingReport {
  interface Working {
    supplierId: string;
    supplierName: string;
    buckets: Record<AgingBucket, number>;
    onAccount: number;
    items: AgedItem[];
    advances: AgedAdvance[];
  }
  const bySupplier = new Map<string, Working>();
  const working = (supplierId: string, supplierName: string): Working => {
    let row = bySupplier.get(supplierId);
    if (!row) {
      row = { supplierId, supplierName, buckets: zeroBuckets(), onAccount: 0, items: [], advances: [] };
      bySupplier.set(supplierId, row);
    }
    return row;
  };

  for (const item of items) {
    const outstanding = toHalalas(item.outstanding);
    if (outstanding <= 0) continue;
    const row = working(item.supplierId, item.supplierName);
    const bucket = bucketFor(asOf, item.dueDate);
    row.buckets[bucket] += outstanding;
    row.items.push({
      ...item,
      date: formatDay(item.date),
      dueDate: formatDay(item.dueDate),
      outstanding: riyals(outstanding),
      daysPastDue: Math.max(0, daysPastDue(asOf, item.dueDate)),
      bucket,
    });
  }
  for (const advance of advances) {
    const amount = toHalalas(advance.amount);
    if (amount <= 0) continue;
    const row = working(advance.supplierId, advance.supplierName);
    row.onAccount += amount;
    row.advances.push({ ...advance, date: formatDay(advance.date), amount: riyals(amount) });
  }

  const total = { buckets: zeroBuckets(), onAccount: 0 };
  const rows = [...bySupplier.values()]
    .map((row): AgingSupplierRow => {
      const outstanding = AGING_BUCKETS.reduce((sum, bucket) => sum + row.buckets[bucket], 0);
      for (const bucket of AGING_BUCKETS) total.buckets[bucket] += row.buckets[bucket];
      total.onAccount += row.onAccount;
      return {
        supplierId: row.supplierId,
        supplierName: row.supplierName,
        buckets: Object.fromEntries(
          AGING_BUCKETS.map((bucket) => [bucket, riyals(row.buckets[bucket])]),
        ) as Record<AgingBucket, number>,
        outstanding: riyals(outstanding),
        onAccount: riyals(row.onAccount),
        net: riyals(outstanding - row.onAccount),
        items: row.items.sort(
          (a, b) => a.dueDate.localeCompare(b.dueDate) || a.number.localeCompare(b.number),
        ),
        advances: row.advances.sort((a, b) => a.date.localeCompare(b.date)),
      };
    })
    .sort((a, b) => a.supplierName.localeCompare(b.supplierName));

  const outstanding = AGING_BUCKETS.reduce((sum, bucket) => sum + total.buckets[bucket], 0);
  return {
    asOf: formatDay(asOf),
    rows,
    totals: {
      buckets: Object.fromEntries(
        AGING_BUCKETS.map((bucket) => [bucket, riyals(total.buckets[bucket])]),
      ) as Record<AgingBucket, number>,
      outstanding: riyals(outstanding),
      onAccount: riyals(total.onAccount),
      net: riyals(outstanding - total.onAccount),
    },
  };
}

/** The report with the books' own figure beside it (purchases/aging.service.ts). */
export interface PayablesAging extends AgingReport {
  /**
   * What the books hold on the suppliers' payable account at the day, and how
   * far the report is from it; null before accounting is set up.
   */
  ledger: { balance: number; difference: number } | null;
}
