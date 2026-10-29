/**
 * PropertyPro - One journal entry, with its lines
 */

import { createErrorResponse, createSuccessResponse } from "@/lib/api-utils";
import { LEDGER_VIEW_ACCESS, ledgerRoute } from "@/lib/accounting/api";
import { getJournal } from "@/lib/accounting/journals.service";

export const dynamic = "force-dynamic";

export const GET = ledgerRoute(LEDGER_VIEW_ACCESS, async (_user, _request, context) => {
  const { id } = await context.params;
  const entry = await getJournal(id);
  if (!entry) return createErrorResponse("Journal entry not found", 404, undefined, "LEDGER_ENTRY_NOT_FOUND");
  return createSuccessResponse(entry);
});
