/**
 * PropertyPro - Which accounts a purchase can be charged to
 *
 * A bill line is charged to an expense account, or to an asset account for
 * something the office capitalises. Never to money (the bank, the cash box,
 * the POS and gateway accounts, or any account a bank account is kept in), nor
 * to what others owe the office (the receivables), nor to input VAT or the
 * investment rent owed to owners, which the posting rules fill in themselves,
 * nor to a contra-asset (accumulated depreciation): a purchase adds to an
 * asset, it does not write one off. The server refuses the same accounts
 * (bills.service.ts); the picker simply does not offer them.
 *
 * Pure: the server, the lookups and the screens all ask here.
 */

import type { AccountType } from "../types";

/**
 * System accounts a purchase is never charged to: money held, what is owed to
 * the office, and the entries the posting rules make themselves.
 */
export const NOT_A_COST_KEYS: ReadonlySet<string> = new Set([
  "cash_on_hand",
  "bank",
  "pos_clearing",
  "gateway_clearing",
  "tenant_receivables",
  "customer_receivables",
  "input_vat",
  "investment_rent_expense",
]);

export interface CostAccountFacts {
  type: AccountType | string;
  postable: boolean;
  active: boolean;
  systemKey: string | null;
  /** A bank or cash account is kept in it. */
  bankLinked: boolean;
  /** An asset that is credit-normal is a contra account; left out, the account is taken as it comes. */
  normalSide?: string;
}

/** Whether a bill line can be charged to this account. */
export function canChargePurchase(account: CostAccountFacts): boolean {
  return (
    account.postable &&
    account.active &&
    (account.type === "expense" || (account.type === "asset" && account.normalSide !== "credit")) &&
    !account.bankLinked &&
    !(account.systemKey && NOT_A_COST_KEYS.has(account.systemKey))
  );
}
