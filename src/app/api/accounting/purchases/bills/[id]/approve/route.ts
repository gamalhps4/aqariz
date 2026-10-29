/**
 * PropertyPro - Approve a purchase bill
 *
 * POST { version? } — a bill waiting for approval becomes owed: it can be paid
 * and the ledger posts it. Approving is a right of its own.
 */

import { createSuccessResponse } from "@/lib/api-utils";
import { PURCHASE_APPROVE_ACCESS, ledgerRoute, readJson } from "@/lib/accounting/purchases/api";
import { approveBill } from "@/lib/accounting/purchases/bills.service";

export const dynamic = "force-dynamic";

export const POST = ledgerRoute(PURCHASE_APPROVE_ACCESS, async (user, request, context) => {
  const { id } = await context.params;
  const body = await readJson<{ version?: unknown }>(request).catch(() => ({}) as { version?: unknown });
  const bill = await approveBill(id, { id: user.id }, body.version);
  return createSuccessResponse(bill, `Bill ${bill.displayNumber} approved`);
});
