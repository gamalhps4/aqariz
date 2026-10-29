/**
 * PropertyPro - What settling an owner's period would post
 *
 * GET `?ownerId&periodStart&periodEnd&agreementId` — the statement's figures
 * as the books would take them. Reads only.
 */

import { createSuccessResponse } from "@/lib/api-utils";
import { LEDGER_VIEW_ACCESS, ledgerRoute, stringOrNull } from "@/lib/accounting/api";
import { previewSettlement } from "@/lib/accounting/owners.service";
import { ledgerError } from "@/lib/accounting/errors";

export const dynamic = "force-dynamic";

export const GET = ledgerRoute(LEDGER_VIEW_ACCESS, async (user, request) => {
  const params = request.nextUrl.searchParams;
  const ownerId = stringOrNull(params.get("ownerId"));
  if (!ownerId) throw ledgerError("LEDGER_OWNER_REQUIRED", "Choose the owner");
  const figures = await previewSettlement(
    {
      ownerId,
      periodStart: params.get("periodStart"),
      periodEnd: params.get("periodEnd"),
      agreementId: stringOrNull(params.get("agreementId")),
    },
    user,
  );
  return createSuccessResponse(figures);
});
