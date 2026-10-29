/**
 * PropertyPro - Posting a transfer between the office's own accounts
 *
 * Money moved from one bank or cash account to another — cash banked, a POS
 * settlement reaching the bank, a gateway payout:
 *     Dr the account it went to / Cr the account it came from
 */

import { toHalalas } from "../money";
import type { PostingPlan } from "../types";
import { credit, debit, finishPlan, LedgerRuleError } from "./common";

export interface BankTransferDoc {
  id: string;
  date: Date;
  amount: number;
  fromAccountId: string;
  toAccountId: string;
  reference?: string | null;
  memo?: string | null;
}

export function planBankTransfer(doc: BankTransferDoc): PostingPlan {
  const amount = toHalalas(doc.amount);
  if (amount <= 0) {
    throw new LedgerRuleError("LEDGER_INVALID_AMOUNT", "The amount must be above zero");
  }
  if (doc.fromAccountId === doc.toAccountId) {
    throw new LedgerRuleError(
      "LEDGER_SAME_ACCOUNT",
      "Choose two different accounts to transfer between",
    );
  }
  const plan = finishPlan({
    sourceType: "bank_transfer",
    sourceId: doc.id,
    sourceRef: doc.reference ?? null,
    date: doc.date,
    memo: doc.memo ?? null,
    lines: [
      debit({ id: doc.toAccountId }, amount),
      credit({ id: doc.fromAccountId }, amount),
    ],
  });
  // Unreachable with a positive amount and two accounts; kept for the type.
  if (!plan) {
    throw new LedgerRuleError("LEDGER_INVALID_AMOUNT", "The amount must be above zero");
  }
  return plan;
}
