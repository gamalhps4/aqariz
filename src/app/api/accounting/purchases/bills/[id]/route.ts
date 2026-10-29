/**
 * PropertyPro - One purchase bill
 *
 * GET — the bill with its lines (account, VAT, building and unit) and what
 *       has been paid on it.
 * PUT — rewrite a bill that is waiting for approval: the body of a new one,
 *       and `version` (the one that was read) to refuse an edit made over
 *       someone else's.
 */

import { createErrorResponse, createSuccessResponse } from "@/lib/api-utils";
import {
  PURCHASE_EDIT_ACCESS,
  PURCHASE_VIEW_ACCESS,
  ledgerRoute,
  readJson,
} from "@/lib/accounting/purchases/api";
import { getBill, updateBill } from "@/lib/accounting/purchases/bills.service";

export const dynamic = "force-dynamic";

export const GET = ledgerRoute(PURCHASE_VIEW_ACCESS, async (_user, _request, context) => {
  const { id } = await context.params;
  const bill = await getBill(id);
  if (!bill) return createErrorResponse("Bill not found", 404, undefined, "PURCHASE_BILL_NOT_FOUND");
  return createSuccessResponse(bill);
});

export const PUT = ledgerRoute(PURCHASE_EDIT_ACCESS, async (_user, request, context) => {
  const { id } = await context.params;
  const bill = await updateBill(id, await readJson(request));
  return createSuccessResponse(bill, "Bill updated");
});
