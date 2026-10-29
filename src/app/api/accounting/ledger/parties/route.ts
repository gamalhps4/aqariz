/**
 * PropertyPro - Tenants or owners by name, for a journal line's party
 *
 * GET `?type=tenant|owner&search=` — up to 20.
 */

import { createSuccessResponse } from "@/lib/api-utils";
import { LEDGER_VIEW_ACCESS, ledgerRoute } from "@/lib/accounting/api";
import { searchParties } from "@/lib/accounting/parties.service";
import { ledgerError } from "@/lib/accounting/errors";

export const dynamic = "force-dynamic";

export const GET = ledgerRoute(LEDGER_VIEW_ACCESS, async (_user, request) => {
  const params = request.nextUrl.searchParams;
  const type = params.get("type");
  if (type !== "tenant" && type !== "owner") {
    throw ledgerError("LEDGER_PARTY_INVALID", "Ask for tenants or owners");
  }
  return createSuccessResponse({ parties: await searchParties(type, params.get("search")) });
});
