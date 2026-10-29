/**
 * PropertyPro - Set a voucher's payment on account against bills
 *
 * POST { allocations: [{ billId, amount }] } — what the voucher left on account
 * with the supplier pays more of their bills. The books do not change: the
 * supplier's account already went down by the whole voucher.
 */

import { createSuccessResponse } from "@/lib/api-utils";
import { PURCHASE_PAY_ACCESS, ledgerRoute, readJson } from "@/lib/accounting/purchases/api";
import { allocateVoucher } from "@/lib/accounting/purchases/vouchers.service";

export const dynamic = "force-dynamic";

export const POST = ledgerRoute(PURCHASE_PAY_ACCESS, async (_user, request, context) => {
  const { id } = await context.params;
  const voucher = await allocateVoucher(id, await readJson(request));
  return createSuccessResponse(voucher, "Payment applied to the bills");
});
