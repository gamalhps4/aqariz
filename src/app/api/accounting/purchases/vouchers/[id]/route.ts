/**
 * PropertyPro - One payment voucher
 *
 * GET — the voucher with the bills it paid and what it left on account.
 */

import { createErrorResponse, createSuccessResponse } from "@/lib/api-utils";
import { PURCHASE_VIEW_ACCESS, ledgerRoute } from "@/lib/accounting/purchases/api";
import { getVoucher } from "@/lib/accounting/purchases/vouchers.service";

export const dynamic = "force-dynamic";

export const GET = ledgerRoute(PURCHASE_VIEW_ACCESS, async (_user, _request, context) => {
  const { id } = await context.params;
  const voucher = await getVoucher(id);
  if (!voucher) {
    return createErrorResponse("Payment voucher not found", 404, undefined, "PURCHASE_VOUCHER_NOT_FOUND");
  }
  return createSuccessResponse(voucher);
});
