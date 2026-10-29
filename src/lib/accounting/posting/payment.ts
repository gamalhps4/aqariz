/**
 * PropertyPro - Posting money received from a tenant
 *
 * A payment is posted on the day the money arrived. What it does depends on
 * who received it and whose money it is.
 *
 * Received by the office (cash, POS, transfer, gateway):
 *     Dr cash / bank / POS clearing / gateway clearing   (by method)
 *     Cr tenant receivable
 *   and for the part that is an owner's money, the office now holds it:
 *     Dr owners' uncollected rent / Cr owners' payable
 *
 * Received by the owner directly (cash to the owner, transfer to the owner,
 * Ejar — OWNER_RECEIVED_METHODS in lib/payments/methods.ts): nothing reaches
 * the office. The owner's part clears the tenant's debt against the owner's
 * uncollected rent; a part that was the office's (rent of a building under
 * investment, a deposit the office holds) is now owed to the office by the
 * owner, so it comes off what the office owes them:
 *     Dr owners' uncollected rent   (owner's part)
 *     Dr owners' payable            (office's part)
 *     Cr tenant receivable
 *
 * How much of a payment is the owner's comes from the installments it paid
 * (`ownerShareOf` in ./invoice.ts) — the service works it out and hands it
 * in. A payment applied to no installment at all (an older row, written
 * before every payment carried its installment) has no receivable to clear:
 * it is posted as charged and collected at once, by what it was for.
 *
 * Money held as the tenant's credit (lib/payments/tenant-credit.ts — a
 * tenant who paid online for something already paid at the desk) is not
 * income and pays no installment: it is received against the tenant's own
 * account, which it leaves in credit until it is refunded or used.
 *     Dr gateway clearing (by method) / Cr tenant receivable
 *
 * A refund turns the receipt around on the day it was refunded.
 */

import { toHalalas, type Halalas } from "../money";
import type { SystemKey } from "../system-keys";
import type { DepositHolder, Ownership, PartyType, PostingPlan, VatCode } from "../types";
import { credit, debit, finishPlan, mirrorLines } from "./common";
import { chargeBeneficiary, type ChargeKind } from "./invoice";
import { isReceivedByOwner, receiptAccountKey } from "./methods";

export interface UnbilledPaymentFacts {
  /** What the payment was for, from its type. */
  kind: ChargeKind;
  depositHolder: DepositHolder;
  /** VAT the contract charges on rent, as a percentage; 0 when exempt. */
  vatRate: number;
}

export interface PaymentDoc {
  id: string;
  number?: string | null;
  /** The day the money arrived. */
  date: Date;
  /** What was received. */
  amount: number;
  method: string | null;
  /** Captured by a payment gateway rather than recorded at the desk. */
  online?: boolean;
  /** Held as the tenant's credit: received against their account, not income. */
  credit?: boolean;
  tenantId: string;
  ownerId: string | null;
  propertyId?: string | null;
  unitId?: string | null;
  leaseId?: string | null;
  /** Whose building it is on the payment day. */
  ownership: Ownership;
  /**
   * The owner's part of the amount, in halalas, from the installments the
   * payment was applied to. Null when it was applied to none (`unbilled`).
   */
  ownerPortion: Halalas | null;
  unbilled?: UnbilledPaymentFacts;
}

/**
 * The account money received by the owner lands in when the "owner" is the
 * office itself — a building the office owns, recorded as paid to its owner.
 */
function ownMoneyKey(method: string | null): SystemKey {
  return method === "owner_cash" ? "cash_on_hand" : "bank";
}

export function planPaymentReceipt(doc: PaymentDoc): PostingPlan | null {
  const amount = toHalalas(doc.amount);
  if (amount <= 0) return null;

  const dims = {
    propertyId: doc.propertyId ?? null,
    unitId: doc.unitId ?? null,
    leaseId: doc.leaseId ?? null,
  };
  const tenantParty = { partyType: "tenant" as PartyType, partyId: doc.tenantId };
  const ownerParty = doc.ownerId
    ? { partyType: "owner" as PartyType, partyId: doc.ownerId }
    : {};

  const byOwner = isReceivedByOwner(doc.method);
  // On the office's own building the owner IS the office: money "paid to the
  // owner" is the office's money all the same.
  const officeReceived = !byOwner || doc.ownership === "office";
  const moneyKey: SystemKey = byOwner
    ? ownMoneyKey(doc.method)
    : receiptAccountKey(doc.method, { online: doc.online });

  const base = {
    sourceType: "payment" as const,
    sourceId: doc.id,
    sourceRef: doc.number ?? null,
    date: doc.date,
  };

  if (doc.credit) {
    return finishPlan({
      ...base,
      lines: [
        debit(moneyKey, amount, dims),
        credit("tenant_receivables", amount, { ...tenantParty, ...dims }),
      ],
    });
  }

  if (doc.ownerPortion === null) {
    return planUnbilled(doc, amount, { officeReceived, moneyKey, dims, tenantParty, ownerParty, base });
  }

  const ownerPart = Math.min(Math.max(doc.ownerPortion, 0), amount);
  const officePart = amount - ownerPart;

  if (officeReceived) {
    return finishPlan({
      ...base,
      lines: [
        debit(moneyKey, amount, dims),
        credit("tenant_receivables", amount, { ...tenantParty, ...dims }),
        debit("owner_uncollected_rent", ownerPart, { ...ownerParty, ...dims }),
        credit("owner_payable", ownerPart, { ...ownerParty, ...dims }),
      ],
    });
  }

  return finishPlan({
    ...base,
    lines: [
      debit("owner_uncollected_rent", ownerPart, { ...ownerParty, ...dims }),
      debit("owner_payable", officePart, { ...ownerParty, ...dims }),
      credit("tenant_receivables", amount, { ...tenantParty, ...dims }),
    ],
  });
}

interface UnbilledContext {
  officeReceived: boolean;
  moneyKey: SystemKey;
  dims: { propertyId: string | null; unitId: string | null; leaseId: string | null };
  tenantParty: { partyType: PartyType; partyId: string };
  ownerParty: { partyType?: PartyType; partyId?: string };
  base: Pick<PostingPlan, "sourceType" | "sourceId" | "sourceRef" | "date">;
}

/** Charged and collected at once: a payment applied to no installment. */
function planUnbilled(
  doc: PaymentDoc,
  amount: Halalas,
  context: UnbilledContext,
): PostingPlan | null {
  const facts: UnbilledPaymentFacts = doc.unbilled ?? {
    kind: "other",
    depositHolder: "owner",
    vatRate: 0,
  };
  const beneficiary = chargeBeneficiary(facts.kind, doc.ownership, facts.depositHolder);
  const { officeReceived, moneyKey, dims, tenantParty, ownerParty, base } = context;

  // The owner was paid their own money and nothing was ever charged in the
  // office's books: there is nothing to record.
  if (!officeReceived && beneficiary === "owner") return null;

  const receivedLines = officeReceived
    ? [debit(moneyKey, amount, dims)]
    : // The owner holds money that is the office's.
      [debit("owner_payable", amount, { ...ownerParty, ...dims })];

  if (beneficiary === "owner") {
    return finishPlan({
      ...base,
      lines: [
        ...receivedLines,
        credit("owner_payable", amount, { ...ownerParty, ...dims, vatCode: "O" }),
      ],
    });
  }

  if (facts.kind === "deposit") {
    return finishPlan({
      ...base,
      lines: [
        ...receivedLines,
        credit("security_deposits", amount, { ...tenantParty, ...dims, vatCode: "O" }),
      ],
    });
  }

  const rate = facts.kind === "rent" ? Math.max(0, Number(facts.vatRate) || 0) : 0;
  const vat = rate > 0 ? Math.round((amount * rate) / (100 + rate)) : 0;
  const incomeVat: VatCode = vat > 0 ? "S" : "E";
  const incomeKey: SystemKey =
    facts.kind === "rent"
      ? doc.ownership === "investment"
        ? "investment_rent_income"
        : "rent_income"
      : "other_income";

  return finishPlan({
    ...base,
    lines: [
      ...receivedLines,
      credit(incomeKey, amount - vat, { ...dims, vatCode: incomeVat }),
      credit("output_vat", vat, { ...dims, vatCode: "S" }),
    ],
  });
}

/** A refund: the receipt turned around on the day the money went back. */
export function planPaymentRefund(
  receipt: PostingPlan,
  refund: { date: Date; sourceRef?: string | null },
): PostingPlan | null {
  return finishPlan({
    sourceType: "payment_refund",
    sourceId: receipt.sourceId,
    sourceRef: refund.sourceRef ?? receipt.sourceRef ?? null,
    date: refund.date,
    lines: mirrorLines(receipt.lines),
  });
}
