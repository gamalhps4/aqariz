/**
 * PropertyPro - The office's bank, cash, POS and gateway accounts
 *
 * GET  — each with its balance and whether the posting rules use it by
 *        default.
 * POST — open one: { name, kind, bankName?, iban?, accountNumber?,
 *        currency?, notes?, ledgerAccountId? } — a new account under the cash
 *        heading, or an existing asset account when one is named.
 */

import { createSuccessResponse } from "@/lib/api-utils";
import { LEDGER_MANAGE_ACCESS, LEDGER_VIEW_ACCESS, ledgerRoute, readJson } from "@/lib/accounting/api";
import { createBankAccount, listBankAccounts, type BankAccountInput } from "@/lib/accounting/banks.service";

export const dynamic = "force-dynamic";

export const GET = ledgerRoute(LEDGER_VIEW_ACCESS, async () =>
  createSuccessResponse({ accounts: await listBankAccounts() }),
);

export const POST = ledgerRoute(LEDGER_MANAGE_ACCESS, async (_user, request) => {
  const created = await createBankAccount(await readJson<BankAccountInput>(request));
  return createSuccessResponse(created, "Account opened");
});
