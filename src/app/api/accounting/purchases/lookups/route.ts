/**
 * PropertyPro - What the purchases screens read from the books
 *
 * GET `?include=accounts,banks&also=<accountId>,…` — whether accounting is set
 * up (`setUp`), and on request the accounts a bill line can be charged to
 * (`accounts`; `also` adds accounts a saved bill already uses, qualifying or
 * not) and the office's bank and cash accounts (`banks`, each marked active
 * or not). Open to anyone who works in purchases, who need these lists
 * without holding the right to view the books; a bank account's balance is
 * left out unless the reader may see the books or pays suppliers.
 */

import { createSuccessResponse } from "@/lib/api-utils";
import { LEDGER_VIEW_PERMISSIONS, PURCHASE_PAY_PERMISSIONS } from "@/lib/finance-permissions";
import { ledgerRoute, PURCHASE_ANY_ACCESS, holdsAny } from "@/lib/accounting/purchases/api";
import { purchaseLookups } from "@/lib/accounting/purchases/lookups.service";

export const dynamic = "force-dynamic";

export const GET = ledgerRoute(PURCHASE_ANY_ACCESS, async (user, request) => {
  const params = request.nextUrl.searchParams;
  const include = new Set((params.get("include") ?? "").split(",").map((name) => name.trim()));
  const also = (params.get("also") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .slice(0, 200);
  const lookups = await purchaseLookups({
    accounts: include.has("accounts"),
    banks: include.has("banks"),
    alsoAccountIds: also,
    showBalances: holdsAny(user, [...LEDGER_VIEW_PERMISSIONS, ...PURCHASE_PAY_PERMISSIONS]),
  });
  return createSuccessResponse(lookups);
});
