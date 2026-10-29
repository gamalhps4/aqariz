/**
 * PropertyPro - Cancel a settlement
 *
 * DELETE — reverses its entry (in the first open day if its own is closed);
 * the settlement stays on record, marked reversed, and the period can be
 * settled again. Its tax invoice is unpaid again — and, when the settlement
 * issued it, credited in full.
 */

import { createSuccessResponse } from "@/lib/api-utils";
import { LEDGER_MANAGE_ACCESS, ledgerRoute } from "@/lib/accounting/api";
import { reverseSettlement } from "@/lib/accounting/owners.service";

export const dynamic = "force-dynamic";

export const DELETE = ledgerRoute(LEDGER_MANAGE_ACCESS, async (user, _request, context) => {
  const { id } = await context.params;
  await reverseSettlement(id, user.id, user);
  return createSuccessResponse({ id }, "Settlement cancelled");
});
