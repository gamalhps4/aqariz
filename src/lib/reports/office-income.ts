/**
 * PropertyPro - What of the money received is the office's income
 *
 * The income and expense summary counted every riyal received as the
 * office's income: the owners' rent it collects for them, the VAT on it, and
 * the tenants' security deposits it holds. A stop-gap until the ledger books
 * the office's income itself (accounting phase 0):
 *
 *  - deposits are held, not earned: left out;
 *  - VAT is the state's: left out — a payment's share of the tax on the
 *    invoice it paid, or, for rent paid without one, the VAT its contract's
 *    rate puts inside it;
 *  - rent and charges collected on an owner's building are the owner's money
 *    (as the ledger posts them): shown apart as "rent collected for owners",
 *    the office's commission still inside them until the ledger takes it out;
 *  - what owners and other customers paid on the office's own invoices is
 *    its income, net of VAT.
 *
 * Pure: the route reads the rows and decides whose building each is on.
 */

const DEPOSIT_TYPES = new Set(["security_deposit", "pet_deposit"]);
/** Paid without an invoice, these carry the VAT their contract charges. */
const CONTRACT_TAXED_TYPES = new Set(["rent", "utility"]);

export interface IncomePaymentRow {
  type: string;
  propertyId: string | null;
  propertyName: string | null;
  paidDate: Date;
  /** What it brought in. */
  received: number;
  invoiceTax: number | null;
  invoiceTotal: number | null;
  leaseTaxEnabled: boolean | null;
  leaseTaxRate: number | null;
  /** On a building an owner holds, on the day it was paid. */
  onOwnersBuilding: boolean;
}

export interface IncomeSettlementRow {
  /** The invoice's category: what the office charged for. */
  category: string;
  paidDate: Date;
  amount: number;
  invoiceTax: number;
  invoiceTotal: number;
}

export interface IncomeGroup {
  _id: string;
  amount: number;
  count: number;
}

export interface IncomePropertyGroup {
  _id: string | null;
  propertyName: string;
  amount: number;
  count: number;
}

export interface OfficeIncome {
  /** Every riyal received, deposits and VAT included. */
  grossReceived: number;
  depositsHeld: number;
  vatCollected: number;
  rentCollectedForOwners: number;
  /** The office's own income, net of VAT. */
  officeIncome: number;
  byCategory: IncomeGroup[];
  byProperty: IncomePropertyGroup[];
  /** "2026-10" (UTC month, as the expense months are grouped) → income. */
  byMonth: Map<string, number>;
}

const cents = (value: number) => Math.round((Number(value) || 0) * 100);
const amount = (value: number) => {
  const result = value / 100;
  return Object.is(result, -0) ? 0 : result;
};

/** The VAT inside a payment, in halalas. */
export function paymentVat(row: IncomePaymentRow): number {
  const received = cents(row.received);
  if (DEPOSIT_TYPES.has(row.type)) return 0;
  const tax = Number(row.invoiceTax);
  const total = Number(row.invoiceTotal);
  if (row.invoiceTotal !== null && Number.isFinite(total) && total > 0) {
    return Math.round((received * (Number.isFinite(tax) ? tax : 0)) / total);
  }
  const rate = Number(row.leaseTaxRate) || 0;
  if (row.leaseTaxEnabled && rate > 0 && CONTRACT_TAXED_TYPES.has(row.type)) {
    return Math.round((received * rate) / (100 + rate));
  }
  return 0;
}

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${date.getUTCMonth() + 1}`;
}

export function officeIncome(
  payments: readonly IncomePaymentRow[],
  settlements: readonly IncomeSettlementRow[] = [],
): OfficeIncome {
  let gross = 0;
  let deposits = 0;
  let vat = 0;
  let owners = 0;
  let office = 0;
  const byCategory = new Map<string, { amount: number; count: number }>();
  const byProperty = new Map<string, { id: string | null; name: string; amount: number; count: number }>();
  const byMonth = new Map<string, number>();

  const credit = (
    category: string,
    property: { id: string | null; name: string | null },
    date: Date,
    net: number,
  ) => {
    office += net;
    const group = byCategory.get(category) ?? { amount: 0, count: 0 };
    group.amount += net;
    group.count += 1;
    byCategory.set(category, group);
    const key = property.id ?? "";
    const building = byProperty.get(key) ?? {
      id: property.id,
      name: property.name ?? "Unassigned",
      amount: 0,
      count: 0,
    };
    building.amount += net;
    building.count += 1;
    byProperty.set(key, building);
    byMonth.set(monthKey(date), (byMonth.get(monthKey(date)) ?? 0) + net);
  };

  for (const row of payments) {
    const received = cents(row.received);
    gross += received;
    if (DEPOSIT_TYPES.has(row.type)) {
      deposits += received;
      continue;
    }
    const tax = paymentVat(row);
    vat += tax;
    const net = received - tax;
    if (row.onOwnersBuilding) {
      owners += net;
      continue;
    }
    credit(row.type, { id: row.propertyId, name: row.propertyName }, row.paidDate, net);
  }

  for (const row of settlements) {
    const received = cents(row.amount);
    gross += received;
    const total = Number(row.invoiceTotal);
    const tax = total > 0 ? Math.round((received * Number(row.invoiceTax)) / total) : 0;
    vat += tax;
    credit(row.category, { id: null, name: null }, row.paidDate, received - tax);
  }

  return {
    grossReceived: amount(gross),
    depositsHeld: amount(deposits),
    vatCollected: amount(vat),
    rentCollectedForOwners: amount(owners),
    officeIncome: amount(office),
    byCategory: [...byCategory.entries()]
      .map(([category, group]) => ({ _id: category, amount: amount(group.amount), count: group.count }))
      .sort((a, b) => b.amount - a.amount),
    byProperty: [...byProperty.values()]
      .map((group) => ({
        _id: group.id,
        propertyName: group.name,
        amount: amount(group.amount),
        count: group.count,
      }))
      .sort((a, b) => b.amount - a.amount),
    byMonth: new Map([...byMonth.entries()].map(([key, value]) => [key, amount(value)])),
  };
}
