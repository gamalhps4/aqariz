/**
 * PropertyPro - Cancel a purchase bill
 *
 * POST { reason?, version? } — a bill with nothing paid on it is cancelled and
 * what the ledger posted for it is reversed. A bill with payments on it stays
 * until its vouchers are cancelled.
 */

import { createSuccessResponse } from "@/lib/api-utils";
import { PURCHASE_DELETE_ACCESS, ledgerRoute, readJson } from "@/lib/accounting/purchases/api";
import { cancelBill } from "@/lib/accounting/purchases/bills.service";

export const dynamic = "force-dynamic";

export const POST = ledgerRoute(PURCHASE_DELETE_ACCESS, async (user, request, context) => {
  const { id } = await context.params;
  const body = await readJson(request).catch(() => ({}));
  const bill = await cancelBill(id, body, { id: user.id });
  return createSuccessResponse(bill, `Bill ${bill.displayNumber} cancelled`);
});
