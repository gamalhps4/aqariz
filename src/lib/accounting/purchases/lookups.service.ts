/**
 * PropertyPro - What the purchases screens read from the books
 *
 * A clerk who enters bills and a cashier who writes vouchers need the chart's
 * cost accounts and the office's bank and cash accounts, but not the books
 * themselves: the ledger's own lists (the whole chart with its balances, the
 * bank list with IBANs) ask for the right to view the books. These are lean
 * lists for the purchases rights — a cost account is an id and its names, a
 * bank account its name and kind, and its balance only for someone who may
 * see the books or pays from it.
 */

import "server-only";

import { db } from "@/lib/db/prisma";
import { listBankAccounts } from "../banks.service";
import { getAccountingSettings, loadChart } from "../settings.service";
import { canChargePurchase } from "./cost-accounts";
import { requirePurchases } from "./common";
import type { CostAccountOption, PayingAccountOption, PurchaseLookups } from "./types";

export async function purchaseLookups(options: {
  accounts: boolean;
  banks: boolean;
  /** Accounts to list whether or not they qualify: the ones a saved bill already uses. */
  alsoAccountIds?: readonly string[];
  /** Whether the reader may see the books' balances. */
  showBalances: boolean;
}): Promise<PurchaseLookups> {
  await requirePurchases();
  const settings = await getAccountingSettings();
  if (!settings) {
    return {
      setUp: false,
      ...(options.accounts ? { accounts: [] } : {}),
      ...(options.banks ? { banks: [] } : {}),
    };
  }

  const result: PurchaseLookups = { setUp: true };

  if (options.accounts) {
    const [chart, banks] = await Promise.all([
      loadChart(),
      db.bankAccount.findMany({ select: { ledgerAccountId: true } }),
    ]);
    const bankLinked = new Set(banks.map((bank) => bank.ledgerAccountId));
    const also = new Set(options.alsoAccountIds ?? []);
    result.accounts = chart
      .map((account): CostAccountOption => ({
        id: account.id,
        code: account.code,
        nameAr: account.nameAr,
        nameEn: account.nameEn,
        type: account.type,
        postable: account.postable,
        active: account.active,
        qualifies: canChargePurchase({ ...account, bankLinked: bankLinked.has(account.id) }),
      }))
      .filter((account) => account.qualifies || also.has(account.id));
  }

  if (options.banks) {
    result.banks = (await listBankAccounts()).map(
      (bank): PayingAccountOption => ({
        id: bank.id,
        kind: bank.kind,
        name: bank.name,
        currency: bank.currency,
        active: bank.active,
        ledgerAccount: {
          id: bank.ledgerAccount.id,
          code: bank.ledgerAccount.code,
          nameAr: bank.ledgerAccount.nameAr,
          nameEn: bank.ledgerAccount.nameEn,
          active: bank.ledgerAccount.active,
        },
        balance: options.showBalances ? bank.balance : null,
      }),
    );
  }
  return result;
}
