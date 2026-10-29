/**
 * PropertyPro - Posting security deposits
 *
 * A deposit is usually billed as an installment of its own and paid like one
 * (./invoice.ts and ./payment.ts post those). Two things are left here:
 *
 * A deposit collected with no payment behind it — marked collected on the
 * deposit itself — is posted from the deposit, on the day it was collected:
 *     Dr cash / bank / … (by method)
 *     Cr deposits held   (the office holds it)
 *     or Cr owners' payable (it goes to the owner with the rent)
 *
 * Its settlement at the end of the contract, on the day of the refund:
 *   held by the office —
 *     Dr deposits held   / Cr bank          the part refunded
 *     Dr deposits held   / Cr other income  the part kept, on the office's
 *                                            own building
 *     Dr deposits held   / Cr owners' payable the part kept, on an owner's
 *                                            building (it compensates them)
 *   held by the owner —
 *     Dr owners' payable / Cr bank          the part the office refunded on
 *                                            the owner's behalf; nothing for
 *                                            the part kept, the owner has it
 *
 * A refund the owner paid themselves (refund method owner_cash /
 * owner_account) moves no office money: on a deposit the office holds, the
 * office then owes the owner what they paid.
 */

import { toHalalas } from "../money";
import type { DepositHolder, Ownership, PartyType, PostingPlan } from "../types";
import { credit, debit, finishPlan } from "./common";
import { disbursementAccountKey, isReceivedByOwner, receiptAccountKey } from "./methods";

interface DepositFacts {
  id: string;
  /** The day the deposit was collected, or refunded. */
  date: Date;
  tenantId: string;
  ownerId: string | null;
  propertyId?: string | null;
  unitId?: string | null;
  leaseId?: string | null;
  ownership: Ownership;
  depositHolder: DepositHolder;
}

/** Who holds the deposit: always the office on its own buildings. */
export function depositHeldBy(
  ownership: Ownership,
  depositHolder: DepositHolder,
): DepositHolder {
  return ownership === "owner" ? depositHolder : "office";
}

function parties(doc: DepositFacts) {
  return {
    dims: {
      propertyId: doc.propertyId ?? null,
      unitId: doc.unitId ?? null,
      leaseId: doc.leaseId ?? null,
    },
    tenant: { partyType: "tenant" as PartyType, partyId: doc.tenantId },
    owner: doc.ownerId
      ? { partyType: "owner" as PartyType, partyId: doc.ownerId }
      : {},
  };
}

export interface DepositReceiptDoc extends DepositFacts {
  amount: number;
  /** How it was collected, when known. */
  method?: string | null;
}

export function planDepositReceipt(doc: DepositReceiptDoc): PostingPlan | null {
  const amount = toHalalas(doc.amount);
  if (amount <= 0) return null;
  const { dims, tenant, owner } = parties(doc);
  const holder = depositHeldBy(doc.ownership, doc.depositHolder);
  const byOwner = isReceivedByOwner(doc.method) && doc.ownership !== "office";

  // Paid straight to an owner who keeps deposits: nothing of the office's moved.
  if (byOwner && holder === "owner") return null;

  return finishPlan({
    sourceType: "deposit_receipt",
    sourceId: doc.id,
    date: doc.date,
    lines: [
      byOwner
        ? debit("owner_payable", amount, { ...owner, ...dims })
        : debit(receiptAccountKey(doc.method), amount, dims),
      holder === "office"
        ? credit("security_deposits", amount, { ...tenant, ...dims, vatCode: "O" })
        : credit("owner_payable", amount, { ...owner, ...dims, vatCode: "O" }),
    ],
  });
}

export interface DepositSettlementDoc extends DepositFacts {
  /** The deposit as collected. */
  amount: number;
  /** What went back to the tenant; the rest was kept (deducted). */
  refundAmount: number;
  refundMethod?: string | null;
}

export function planDepositSettlement(doc: DepositSettlementDoc): PostingPlan | null {
  const amount = toHalalas(doc.amount);
  if (amount <= 0) return null;
  const refunded = Math.min(Math.max(toHalalas(doc.refundAmount), 0), amount);
  const kept = amount - refunded;
  const { dims, tenant, owner } = parties(doc);
  const holder = depositHeldBy(doc.ownership, doc.depositHolder);
  const ownerPaidRefund =
    isReceivedByOwner(doc.refundMethod) && doc.ownership !== "office";

  const base = {
    sourceType: "deposit_settlement" as const,
    sourceId: doc.id,
    date: doc.date,
  };

  if (holder === "owner") {
    // The owner has the deposit; only a refund the office paid for them
    // touches the office's books.
    if (ownerPaidRefund || refunded === 0) return null;
    return finishPlan({
      ...base,
      lines: [
        debit("owner_payable", refunded, { ...owner, ...dims }),
        credit(disbursementAccountKey(doc.refundMethod), refunded, dims),
      ],
    });
  }

  return finishPlan({
    ...base,
    lines: [
      debit("security_deposits", amount, { ...tenant, ...dims, vatCode: "O" }),
      ownerPaidRefund
        ? credit("owner_payable", refunded, { ...owner, ...dims })
        : credit(disbursementAccountKey(doc.refundMethod), refunded, dims),
      doc.ownership === "owner"
        ? credit("owner_payable", kept, { ...owner, ...dims, vatCode: "O" })
        : credit("other_income", kept, { ...dims, vatCode: "O" }),
    ],
  });
}
