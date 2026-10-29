/**
 * PropertyPro - Send an approved bill back
 *
 * POST { version? } — an approved bill nobody has paid on goes back to waiting
 * for approval, and what the ledger posted for it is reversed, so it can be
 * corrected.
 */

import { createSuccessResponse } from "@/lib/api-utils";
import { PURCHASE_EDIT_ACCESS, ledgerRoute, readJson } from "@/lib/accounting/purchases/api";
import { reopenBill } from "@/lib/accounting/purchases/bills.service";

export const dynamic = "force-dynamic";

export const POST = ledgerRoute(PURCHASE_EDIT_ACCESS, async (user, request, context) => {
  const { id } = await context.params;
  const body = await readJson<{ version?: unknown }>(request).catch(() => ({}) as { version?: unknown });
  const bill = await reopenBill(id, { id: user.id }, body.version);
  return createSuccessResponse(bill, `Bill ${bill.displayNumber} sent back`);
});
