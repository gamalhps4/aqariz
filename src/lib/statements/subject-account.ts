/**
 * PropertyPro - A compound's, a building's or a unit's account for a period
 *
 * The compound, building and unit statements settle exactly as the owner's
 * statement does (lib/statements/settlement.ts): over the rows of the time
 * each building was the owner's to report on (`statementTime` — never the
 * time an investment agreement held it, whatever held it at the close), with
 * the commission and the investment rent each agreement charged for its own
 * part of the period (`CommissionPart`). What they add is the breakdown — a
 * compound by building, a building by unit — and the rows add up to the
 * statement:
 *
 *   cash, bills, expenses   to the unit they were written against. What no
 *                           current unit carries — the building's own
 *                           expenses, money received without a contract — is
 *                           the building's own row.
 *   a percentage            to each unit by the rent before VAT it brought in
 *                           (what the percentage was charged on), to the cent.
 *   a flat fee, an          in equal shares between the building's units, as
 *   investment rent         the engine shares one between buildings
 *                           (`shareOfAgreementAmount`).
 *
 * A unit's own statement is its row of its building's account, so the two
 * can never disagree.
 *
 * Pure: the rows come already read, and subject-account.test.ts pins the
 * arithmetic.
 */

import {
  shareOfAgreementAmount,
  statementTime,
  type CommissionPart,
  type Period,
} from "@/lib/agreement-math";
import { settle, type Settlement } from "@/lib/statements/settlement";

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * An amount shared in proportion to weights, to the cent: each share is its
 * exact part rounded down, and the cents left over go to the largest
 * remainders (the earlier share on a tie) — so the shares always add back up
 * to the amount. A weight at or below zero takes nothing; all of them there,
 * and nothing is shared.
 */
export function apportion(amount: number, weights: readonly number[]): number[] {
  const cents = Math.round(amount * 100);
  const positive = weights.map((weight) => (weight > 0 ? weight : 0));
  const total = positive.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) return weights.map(() => 0);

  const exact = positive.map((weight) => (cents * weight) / total);
  const shares = exact.map((value) => Math.floor(value));
  let left = cents - shares.reduce((sum, share) => sum + share, 0);
  const order = exact
    .map((value, index) => ({ index, remainder: value - shares[index] }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const { index } of order) {
    if (left <= 0) break;
    if (positive[index] === 0) continue;
    shares[index] += 1;
    left -= 1;
  }
  return shares.map((share) => share / 100);
}

/** One building of the subject, as the commission run read it. */
export interface AccountBuilding {
  id: string;
  /** What each agreement charged it, in order of time. */
  parts: readonly CommissionPart[];
  /** Every current unit, in a fixed order — who shares a flat amount. */
  unitIds: readonly string[];
}

/** A payment or an invoice as the commission run read it, with its unit. */
export interface AccountEntry {
  propertyId: string;
  unitId: string | null;
  date: Date;
  /** Everything in it. */
  amount: number;
  /** Of that, the rent before VAT a percentage is charged on. */
  base: number;
}

/** A payment the statement lists. */
export interface AccountPayment {
  propertyId: string;
  unitId: string | null;
  date: string;
  amount: number;
  receivedBy: "owner" | "office";
}

/** An expense the statement deducts. */
export interface AccountExpense {
  propertyId: string | null;
  unitId: string | null;
  date: string;
  amount: number;
}

export interface AccountFigures {
  rentBilled: number;
  rentCollected: number;
  collectedByOwner: number;
  expenses: number;
  /** Rent before VAT the commission was charged on. */
  commissionBase: number;
  commission: number;
  investmentRent: number;
}

/** One row of the breakdown, settled on its own. */
export interface AccountRow extends AccountFigures {
  /** The building's id, the unit's id, or `buildingRowKey` for a building's own row. */
  key: string;
  propertyId: string;
  /** The unit — null on a building's row, and on every row of a compound. */
  unitId: string | null;
  settlement: Settlement;
}

export interface SubjectAccountInput<
  P extends AccountPayment,
  E extends AccountExpense,
> {
  period: Period;
  buildings: readonly AccountBuilding[];
  /** Every payment received in the period (the statement's rows). */
  payments: readonly P[];
  /** Every expense deducted in the period. */
  expenses: readonly E[];
  /** What the commission run charged from: every payment, every invoice due. */
  received: readonly AccountEntry[];
  billed: readonly AccountEntry[];
  /** An agreement's commission basis — "billed" charges on invoices due. */
  basisOf: (agreementId: string) => string | undefined;
  commissionTaxRate: number;
  /** A compound breaks down by building, a building by unit. */
  breakdown: "property" | "unit";
}

export interface SubjectAccount<P, E> {
  /** The payments the account counts: those of the owner's time. */
  payments: P[];
  expenses: E[];
  /** Buildings in the order given; a building's units, then its own row. */
  rows: AccountRow[];
  totals: AccountFigures;
  settlement: Settlement;
}

/** The key of what belongs to a building and no current unit of it. */
export function buildingRowKey(propertyId: string): string {
  return `building:${propertyId}`;
}

function noFigures(): AccountFigures {
  return {
    rentBilled: 0,
    rentCollected: 0,
    collectedByOwner: 0,
    expenses: 0,
    commissionBase: 0,
    commission: 0,
    investmentRent: 0,
  };
}

function isEmpty(figures: AccountFigures): boolean {
  return Object.values(figures).every((value) => value === 0);
}

function within(date: Date, span: Period): boolean {
  return date >= span.startDate && date <= span.endDate;
}

export function subjectAccount<P extends AccountPayment, E extends AccountExpense>(
  input: SubjectAccountInput<P, E>,
): SubjectAccount<P, E> {
  const { period, breakdown } = input;

  // The time each building was the owner's: all of the period but what an
  // investment agreement held.
  const ownersTime = new Map(
    input.buildings.map((building) => [
      building.id,
      statementTime(building.parts, period),
    ]),
  );
  const carries = (propertyId: string | null, date: Date) =>
    propertyId !== null &&
    (ownersTime.get(propertyId) ?? []).some((span) => within(date, span));

  const units = new Map(
    input.buildings.map((building) => [building.id, new Set(building.unitIds)]),
  );
  const rows = new Map<string, Omit<AccountRow, "settlement">>();
  const open = (key: string, propertyId: string, unitId: string | null) => {
    rows.set(key, { key, propertyId, unitId, ...noFigures() });
  };
  for (const building of input.buildings) {
    if (breakdown === "property") open(building.id, building.id, null);
    else for (const unitId of building.unitIds) open(unitId, building.id, unitId);
  }

  const keyOf = (propertyId: string, unitId: string | null): string =>
    breakdown === "property"
      ? propertyId
      : unitId && units.get(propertyId)?.has(unitId)
        ? unitId
        : buildingRowKey(propertyId);
  const rowOf = (key: string, propertyId: string) => {
    if (!rows.has(key)) open(key, propertyId, null);
    return rows.get(key)!;
  };
  const add = (
    propertyId: string,
    unitId: string | null,
    field: keyof AccountFigures,
    amount: number,
  ) => {
    if (!amount) return;
    const key = keyOf(propertyId, unitId);
    const row = rowOf(key, propertyId);
    row[field] = round(row[field] + amount);
  };

  const payments = input.payments.filter((payment) =>
    carries(payment.propertyId, new Date(payment.date)),
  );
  for (const payment of payments) {
    add(payment.propertyId, payment.unitId, "rentCollected", payment.amount);
    if (payment.receivedBy === "owner") {
      add(payment.propertyId, payment.unitId, "collectedByOwner", payment.amount);
    }
  }

  const expenses = input.expenses.filter((expense) =>
    carries(expense.propertyId, new Date(expense.date)),
  );
  for (const expense of expenses) {
    add(expense.propertyId!, expense.unitId, "expenses", expense.amount);
  }

  for (const invoice of input.billed) {
    if (carries(invoice.propertyId, invoice.date)) {
      add(invoice.propertyId, invoice.unitId, "rentBilled", invoice.amount);
    }
  }

  for (const building of input.buildings) {
    // A flat amount, in equal shares between the building's units.
    const spread = (field: keyof AccountFigures, amount: number) => {
      if (!amount) return;
      if (breakdown === "property" || building.unitIds.length === 0) {
        add(building.id, null, field, amount);
        return;
      }
      for (const unitId of building.unitIds) {
        add(
          building.id,
          unitId,
          field,
          shareOfAgreementAmount(amount, building.unitIds, unitId),
        );
      }
    };

    for (const part of building.parts) {
      if (part.agreementKind === "investment") {
        spread("investmentRent", part.investmentRent);
        continue;
      }

      // What the part charged a percentage on, row by row: the rent before
      // VAT of each payment received — or invoice due, where the agreement
      // charges on billed rent — inside the part.
      const charged = (
        input.basisOf(part.agreementId) === "billed" ? input.billed : input.received
      ).filter((entry) => entry.propertyId === building.id && within(entry.date, part));
      const weights = new Map<string, { unitId: string | null; base: number }>();
      for (const entry of charged) {
        const key = keyOf(building.id, entry.unitId);
        const weight = weights.get(key) ?? { unitId: entry.unitId, base: 0 };
        weight.base += entry.base;
        weights.set(key, weight);
      }
      const byBase = (field: keyof AccountFigures, amount: number) => {
        if (!amount) return;
        const shares = [...weights.values()];
        const amounts = apportion(
          amount,
          shares.map((share) => share.base),
        );
        if (amounts.every((value) => value === 0)) {
          // Nothing to weigh it by: it is the building's.
          add(building.id, null, field, amount);
          return;
        }
        shares.forEach((share, index) =>
          add(building.id, share.unitId, field, amounts[index]),
        );
      };

      byBase("commissionBase", part.commissionBase);
      if (part.feeType === "fixed") spread("commission", part.commission);
      else byBase("commission", part.commission);
    }
  }

  const settled = (figures: AccountFigures): Settlement =>
    settle({
      collected: figures.rentCollected,
      collectedByOwner: figures.collectedByOwner,
      expenses: figures.expenses,
      commission: figures.commission,
      commissionTaxRate: input.commissionTaxRate,
      investmentRent: figures.investmentRent,
    });

  // Each building's rows together: its units in order, then its own row
  // when anything landed on it.
  const ordered: AccountRow[] = [];
  for (const building of input.buildings) {
    const keys =
      breakdown === "property"
        ? [building.id]
        : [...building.unitIds, buildingRowKey(building.id)];
    for (const key of keys) {
      const row = rows.get(key);
      if (!row) continue;
      if (key === buildingRowKey(building.id) && isEmpty(row)) continue;
      ordered.push({ ...row, settlement: settled(row) });
    }
  }

  const totals = ordered.reduce<AccountFigures>((sum, row) => {
    const next = { ...sum };
    for (const field of Object.keys(sum) as Array<keyof AccountFigures>) {
      next[field] = round(sum[field] + row[field]);
    }
    return next;
  }, noFigures());

  return {
    payments,
    expenses,
    rows: ordered,
    totals,
    settlement: settled(totals),
  };
}
