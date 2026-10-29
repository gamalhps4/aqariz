/**
 * PropertyPro - The chart of accounts
 *
 * GET  — every account in tree order with its balance (`?asOf=YYYY-MM-DD`)
 *        and what protects it from deletion.
 * POST — add an account under a heading.
 */

import { createSuccessResponse } from "@/lib/api-utils";
import { LEDGER_MANAGE_ACCESS, LEDGER_VIEW_ACCESS, ledgerRoute, readJson } from "@/lib/accounting/api";
import { createAccount, listAccounts, type AccountInput } from "@/lib/accounting/accounts.service";
import { parseDay } from "@/lib/accounting/dates";

export const dynamic = "force-dynamic";

export const GET = ledgerRoute(LEDGER_VIEW_ACCESS, async (_user, request) => {
  const asOf = parseDay(request.nextUrl.searchParams.get("asOf"));
  return createSuccessResponse({ accounts: await listAccounts({ asOf }) });
});

export const POST = ledgerRoute(LEDGER_MANAGE_ACCESS, async (_user, request) => {
  const body = await readJson<AccountInput>(request);
  const created = await createAccount(body);
  return createSuccessResponse(created, "Account added");
});
