/**
 * PropertyPro - A security deposit as an activity entry holds it
 *
 * A deposit is named by the tenant who paid it. The entry keeps the money's
 * movement — the amount, what has been deducted (a total and a count, the
 * deductions themselves are on the record), what was refunded and how — and
 * where the deposit stands.
 *
 * Pure: no database, nothing server-only.
 */

import { AuditAction } from "@/lib/audit/vocabulary";
import {
  clip,
  dateOf,
  numberOf,
  personName,
  statusMove,
  type Row,
} from "./shared";

/** The fields compared when a deposit moves. */
export const DEPOSIT_CHANGE_KEYS = [
  "amount",
  "status",
  "collectedDate",
  "deductionsTotal",
  "deductionsCount",
  "refundAmount",
  "refundDate",
  "refundMethod",
  "refundNotes",
  "notes",
] as const;

/** One deduction as the deposit's JSON holds it. */
export interface DepositDeduction {
  id?: string;
  category?: string;
  description?: string;
  amount?: number;
}

/** The deposit's deductions as a list, whatever the JSON column held. */
export function depositDeductions(row: Row | null | undefined): DepositDeduction[] {
  const raw = row?.deductions;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (item): item is DepositDeduction => item !== null && typeof item === "object",
  );
}

/** What has been deducted so far. */
export function deductionsTotal(deductions: readonly DepositDeduction[]): number {
  const total = deductions.reduce(
    (sum, deduction) => sum + (numberOf(deduction.amount) ?? 0),
    0,
  );
  return Math.round(total * 100) / 100;
}

/** The deduction with this id (the route's `deductionId`), if the deposit has it. */
export function findDeduction(
  row: Row | null | undefined,
  deductionId: string,
): DepositDeduction | null {
  return (
    depositDeductions(row).find(
      (deduction) =>
        (deduction.id ?? (deduction as { _id?: string })._id) === deductionId,
    ) ?? null
  );
}

function textOf(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * The deposit as an entry stores it. Every field is always present, so a
 * before and an after built the same way compare field for field.
 */
export function depositSnapshot(row: Row | null | undefined, extra: Row = {}): Row {
  if (!row) return {};
  const deductions = depositDeductions(row);
  return {
    amount: numberOf(row.amount),
    status: textOf(row.status),
    collectedDate: dateOf(row.collectedDate),
    deductionsTotal: deductionsTotal(deductions),
    deductionsCount: deductions.length,
    refundAmount: numberOf(row.refundAmount),
    refundDate: dateOf(row.refundDate),
    refundMethod: textOf(row.refundMethod),
    refundNotes: clip(row.refundNotes, 300),
    notes: clip(row.notes, 300),
    ...extra,
  };
}

/** The deduction being added or taken off, as the "after" or "before" side shows it. */
export function deductionFields(
  deduction: DepositDeduction | null | undefined,
): Row {
  if (!deduction) return {};
  return {
    deductionCategory: textOf(deduction.category),
    deductionDescription: clip(deduction.description, 200),
    deductionAmount: numberOf(deduction.amount),
  };
}

/** The fields the deduction entries add to the deposit's own. */
export const DEDUCTION_KEYS = [
  "deductionCategory",
  "deductionDescription",
  "deductionAmount",
] as const;

/** The deposit's tenant as the entry names it: from the row read with its tenant. */
export function depositTenantName(row: Row | null | undefined): string | null {
  return personName(row?.tenant);
}

/** What one of the deposit's actions is recorded as. */
export interface DepositEntry {
  action: AuditAction;
  messageKey?: string;
  messageParams?: Record<string, string | number>;
  before: Row;
  after: Row;
  keys: string[];
}

/**
 * How a deposit action reads in the log. `requestAction` is the route's own
 * word (collect, add-deduction, remove-deduction, refund, update-notes);
 * `deposit` is the row before and `updated` the row after.
 *
 *  - collect and the status moves read "from → to";
 *  - a refund reads as a refund (with its amount), except a deposit kept in
 *    full, which is a status move to forfeited;
 *  - a deduction added or taken off names its category, description and amount.
 */
export function depositEntry(input: {
  requestAction: string;
  deposit: Row;
  updated: Row;
  deductionId?: string | null;
}): DepositEntry {
  const before = depositSnapshot(input.deposit);
  const after = depositSnapshot(input.updated);
  const move = statusMove(before, after);
  const keys: string[] = [...DEPOSIT_CHANGE_KEYS];

  if (input.requestAction === "add-deduction") {
    const now = depositDeductions(input.updated);
    Object.assign(after, deductionFields(now[now.length - 1]));
    return {
      action: AuditAction.UPDATE,
      messageKey: "admin.audit.msg.deposit_deduction_added",
      before,
      after,
      keys: [...keys, ...DEDUCTION_KEYS],
    };
  }

  if (input.requestAction === "remove-deduction") {
    Object.assign(
      before,
      deductionFields(
        input.deductionId ? findDeduction(input.deposit, input.deductionId) : null,
      ),
    );
    return {
      action: AuditAction.UPDATE,
      messageKey: "admin.audit.msg.deposit_deduction_removed",
      before,
      after,
      keys: [...keys, ...DEDUCTION_KEYS],
    };
  }

  if (input.requestAction === "refund" && move && move.to !== "forfeited") {
    const amount = after.refundAmount;
    const currency = textOf(input.updated.currency);
    return {
      action: AuditAction.PAYMENT_REFUNDED,
      messageKey: "admin.audit.msg.deposit_refunded",
      messageParams: {
        ...(typeof amount === "number" ? { amount } : {}),
        ...(currency ? { currency } : {}),
      },
      before,
      after,
      keys,
    };
  }

  return move
    ? {
        action: AuditAction.STATUS_CHANGED,
        messageParams: { from: move.from, to: move.to },
        before,
        after,
        keys,
      }
    : { action: AuditAction.UPDATE, before, after, keys };
}
