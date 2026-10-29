/**
 * PropertyPro - Where a payment's money went, for the books
 *
 * A payment says which installments it paid in `allocations`
 * (`[{ invoiceId, amount }]`). A refund or a deletion empties that list and
 * writes what it took back into the payment's history (`reversed` on the
 * "refunded" / "deleted" entry — lib/services/payment-invoice-linking), and a
 * payment written by the older add-payment path names only its `invoiceId`.
 * The receipt has to post the same way before and after a refund, so all
 * three are read, in that order.
 *
 * Pure.
 */

import { toHalalas, type Halalas } from "../money";
import { ownerShareOf, type InvoiceSplit } from "./invoice";

export interface PaymentMoneyFacts {
  allocations: unknown;
  invoiceId: string | null;
  /** What was received, in riyals. */
  collected: number;
  paymentHistory: unknown;
}

export interface Allocation {
  invoiceId: string;
  amount: Halalas;
}

function readAllocations(value: unknown): Allocation[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const row = (item ?? {}) as Record<string, unknown>;
      return {
        invoiceId: typeof row.invoiceId === "string" ? row.invoiceId : String(row.invoiceId ?? ""),
        amount: toHalalas(row.amount as number),
      };
    })
    .filter((row) => row.invoiceId && row.amount > 0);
}

function historyEntries(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    : [];
}

/** The installments a payment paid and how much went to each. */
export function paymentAllocations(payment: PaymentMoneyFacts): Allocation[] {
  const recorded = readAllocations(payment.allocations);
  if (recorded.length > 0) return recorded;

  const undone = [...historyEntries(payment.paymentHistory)]
    .reverse()
    .find((entry) => entry.event === "refunded" || entry.event === "deleted");
  const reversed = readAllocations(undone?.reversed);
  if (reversed.length > 0) return reversed;

  const collected = toHalalas(payment.collected);
  return payment.invoiceId && collected > 0
    ? [{ invoiceId: payment.invoiceId, amount: collected }]
    : [];
}

/**
 * The owner's part of a payment, in halalas: each installment's owner share
 * of what was applied to it, and — for money applied to nothing — all of it
 * or none by whose money a charge of the payment's kind would be. Null when
 * the payment was applied to no installment at all.
 */
export function paymentOwnerPortion(input: {
  collected: Halalas;
  allocations: readonly Allocation[];
  splits: ReadonlyMap<string, InvoiceSplit>;
  /** Whose money the payment's own kind of charge is, on its building. */
  unappliedBeneficiary: "owner" | "office";
}): Halalas | null {
  const { collected, allocations, splits, unappliedBeneficiary } = input;
  if (allocations.length === 0) return null;

  const applied = allocations.reduce((sum, allocation) => sum + allocation.amount, 0);
  // Allocations can outlive a correction to the payment: never more than
  // was actually received, scaled the way commission-base.ts scales them.
  const scale = applied > collected && applied > 0 ? collected / applied : 1;

  let owner = 0;
  let counted = 0;
  for (const allocation of allocations) {
    const amount = Math.round(allocation.amount * scale);
    counted += amount;
    const split = splits.get(allocation.invoiceId);
    if (split && split.total > 0) {
      owner += ownerShareOf(split, amount);
    } else if (unappliedBeneficiary === "owner") {
      // The installment is gone; judge the money by its kind, like money
      // applied to nothing.
      owner += amount;
    }
  }
  const unapplied = Math.max(0, collected - counted);
  if (unappliedBeneficiary === "owner") owner += unapplied;
  return Math.min(owner, collected);
}

/** When a refunded payment's money went back: its "refunded" history entry. */
export function refundDateOf(paymentHistory: unknown, fallback: Date): Date {
  const refunded = [...historyEntries(paymentHistory)]
    .reverse()
    .find((entry) => entry.event === "refunded");
  const at = refunded?.at;
  if (typeof at === "string") {
    const parsed = new Date(at);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return fallback;
}
