/**
 * PropertyPro - Cancel a payment voucher
 *
 * POST { reason? } — the voucher keeps its number and is marked cancelled; the
 * bills it paid are released and what the ledger posted is reversed. Refused
 * while the payment is reconciled with the bank statement.
 */

import { createSuccessResponse } from "@/lib/api-utils";
import { PURCHASE_PAY_ACCESS, ledgerRoute, readJson } from "@/lib/accounting/purchases/api";
import { cancelVoucher } from "@/lib/accounting/purchases/vouchers.service";

export const dynamic = "force-dynamic";

export const POST = ledgerRoute(PURCHASE_PAY_ACCESS, async (user, request, context) => {
  const { id } = await context.params;
  const body = await readJson(request).catch(() => ({}));
  const voucher = await cancelVoucher(id, body, { id: user.id });
  return createSuccessResponse(voucher, `Payment voucher ${voucher.displayNumber} cancelled`);
});
