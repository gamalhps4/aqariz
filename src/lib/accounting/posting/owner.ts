/**
 * PropertyPro - Posting an owner's settlement and payout
 *
 * By the time a period is settled, the owner's money is already where it
 * belongs: every rent collected for them was credited to "owners' payable"
 * as it arrived, and every expense on their buildings debited there. What
 * the settlement adds is the office's own side of the agreement, for the
 * period:
 *
 *   the commission and the VAT on it — the office earns it out of the
 *   owner's money:
 *     Dr owners' payable / Cr commission income (percentage fee)
 *                        / Cr management fee income (fixed fee)
 *                        / Cr output VAT
 *   the rent of buildings the office holds under investment — the office
 *   owes it to the owner:
 *     Dr investment rent expense / Cr owners' payable
 *
 * Once the office issues its tax invoice for the commission (closing a
 * settlement issues one, or links the one already issued — see
 * lib/accounting/owners.service.ts), the invoice is the sale: it posts the
 * commission income and the output VAT on its own date, and is paid from the
 * owner's balance (Dr owners' payable / Cr the owner's receivable — an
 * `owner_balance` settlement on the invoice, posting/invoice.ts). The
 * settlement then posts only the investment rent, so the commission is
 * booked once. Settlements closed before that kept the commission here.
 *
 * What is left on the owner's payable after that is what the office owes the
 * owner, carried forward from one period to the next; a debit balance is the
 * owner owing the office (rent the owner received directly, with the fee
 * still to pay). A payout pays it:
 *     Dr owners' payable / Cr the bank or cash account it was paid from
 */

import { toHalalas } from "../money";
import type { PartyType, PostingPlan } from "../types";
import { credit, debit, finishPlan } from "./common";

export interface SettlementCloseDoc {
  id: string;
  /** The last day of the settled period. */
  date: Date;
  ownerId: string;
  agreementId?: string | null;
  /** Commission charged as a percentage of rent, before VAT. */
  commission: number;
  /** Commission charged as a fixed fee, before VAT. */
  managementFee: number;
  /** VAT on both. */
  commissionVat: number;
  /** Rent the office owes the owner under investment agreements. */
  investmentRent: number;
  /**
   * The commission and its VAT are on the office's tax invoice to the owner,
   * which posts them: the settlement leaves them out.
   */
  invoiced?: boolean;
  sourceRef?: string | null;
}

export function planSettlementClose(doc: SettlementCloseDoc): PostingPlan | null {
  const fee = (value: number) => (doc.invoiced ? 0 : Math.max(0, toHalalas(value)));
  const commission = fee(doc.commission);
  const managementFee = fee(doc.managementFee);
  const vat = fee(doc.commissionVat);
  const investmentRent = Math.max(0, toHalalas(doc.investmentRent));
  const owner = {
    partyType: "owner" as PartyType,
    partyId: doc.ownerId,
    agreementId: doc.agreementId ?? null,
  };
  const agreement = { agreementId: doc.agreementId ?? null };

  return finishPlan({
    sourceType: "owner_settlement",
    sourceId: doc.id,
    sourceRef: doc.sourceRef ?? null,
    date: doc.date,
    lines: [
      debit("owner_payable", commission + managementFee + vat, owner),
      credit("commission_income", commission, { ...agreement, vatCode: vat > 0 ? "S" : "E" }),
      credit("management_fee_income", managementFee, { ...agreement, vatCode: vat > 0 ? "S" : "E" }),
      credit("output_vat", vat, { ...agreement, vatCode: "S" }),
      debit("investment_rent_expense", investmentRent, agreement),
      credit("owner_payable", investmentRent, owner),
    ],
  });
}

export interface OwnerPayoutDoc {
  id: string;
  date: Date;
  ownerId: string;
  amount: number;
  /** The ledger account of the bank or cash account it was paid from. */
  paidFromAccountId: string;
  sourceRef?: string | null;
  memo?: string | null;
}

export function planOwnerPayout(doc: OwnerPayoutDoc): PostingPlan | null {
  const amount = toHalalas(doc.amount);
  if (amount <= 0) return null;
  return finishPlan({
    sourceType: "owner_payout",
    sourceId: doc.id,
    sourceRef: doc.sourceRef ?? null,
    date: doc.date,
    memo: doc.memo ?? null,
    lines: [
      debit("owner_payable", amount, { partyType: "owner", partyId: doc.ownerId }),
      credit({ id: doc.paidFromAccountId }, amount),
    ],
  });
}
