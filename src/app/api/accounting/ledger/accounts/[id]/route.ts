/**
 * PropertyPro - One account of the chart
 *
 * PATCH  — rename, renumber, move under another heading, switch on or off.
 * DELETE — only an account with no postings that no posting rule uses.
 */

import { createSuccessResponse } from "@/lib/api-utils";
import { LEDGER_MANAGE_ACCESS, ledgerRoute, readJson } from "@/lib/accounting/api";
import { deleteAccount, updateAccount, type AccountInput } from "@/lib/accounting/accounts.service";

export const dynamic = "force-dynamic";

export const PATCH = ledgerRoute(LEDGER_MANAGE_ACCESS, async (_user, request, context) => {
  const { id } = await context.params;
  await updateAccount(id, await readJson<AccountInput>(request));
  return createSuccessResponse({ id }, "Account saved");
});

export const DELETE = ledgerRoute(LEDGER_MANAGE_ACCESS, async (_user, _request, context) => {
  const { id } = await context.params;
  await deleteAccount(id);
  return createSuccessResponse({ id }, "Account deleted");
});
