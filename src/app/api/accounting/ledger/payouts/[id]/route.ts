/**
 * PropertyPro - Cancel a payout
 *
 * DELETE — reverses its entry; the payout stays on record, marked reversed.
 */

import { createSuccessResponse } from "@/lib/api-utils";
import { LEDGER_MANAGE_ACCESS, ledgerRoute } from "@/lib/accounting/api";
import { reversePayout } from "@/lib/accounting/owners.service";

export const dynamic = "force-dynamic";

export const DELETE = ledgerRoute(LEDGER_MANAGE_ACCESS, async (user, _request, context) => {
  const { id } = await context.params;
  await reversePayout(id, user.id);
  return createSuccessResponse({ id }, "Payout cancelled");
});
