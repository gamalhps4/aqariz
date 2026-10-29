/**
 * PropertyPro - One bank or cash account
 *
 * PATCH — rename it, change its bank details, switch it on or off. Its ledger
 * account and history stay as they are.
 */

import { createSuccessResponse } from "@/lib/api-utils";
import { LEDGER_MANAGE_ACCESS, ledgerRoute, readJson } from "@/lib/accounting/api";
import { updateBankAccount, type BankAccountInput } from "@/lib/accounting/banks.service";

export const dynamic = "force-dynamic";

export const PATCH = ledgerRoute(LEDGER_MANAGE_ACCESS, async (_user, request, context) => {
  const { id } = await context.params;
  await updateBankAccount(id, await readJson<BankAccountInput>(request));
  return createSuccessResponse({ id }, "Account saved");
});
