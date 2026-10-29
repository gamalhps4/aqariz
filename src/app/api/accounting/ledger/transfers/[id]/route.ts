/**
 * PropertyPro - Cancel a transfer
 *
 * DELETE (`?date=YYYY-MM-DD`, default today) — reverses its entry; the
 * transfer stays on record, marked reversed.
 */

import { createSuccessResponse } from "@/lib/api-utils";
import { LEDGER_MANAGE_ACCESS, ledgerRoute } from "@/lib/accounting/api";
import { reverseTransfer } from "@/lib/accounting/banks.service";

export const dynamic = "force-dynamic";

export const DELETE = ledgerRoute(LEDGER_MANAGE_ACCESS, async (user, request, context) => {
  const { id } = await context.params;
  await reverseTransfer(id, { date: request.nextUrl.searchParams.get("date"), userId: user.id });
  return createSuccessResponse({ id }, "Transfer cancelled");
});
