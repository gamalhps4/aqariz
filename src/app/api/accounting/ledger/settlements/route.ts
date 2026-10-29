/**
 * PropertyPro - Owners' settlements
 *
 * GET  — settled periods, newest first (`?ownerId&page&limit`).
 * POST — settle a period: { ownerId, periodStart, periodEnd, agreementId?,
 *        notes?, invoiceId?, newInvoice? }. The figures are the owner's
 *        statement's. The commission and its VAT are invoiced to the owner —
 *        on a new tax invoice, or on `invoiceId`, one the office already
 *        issued them — and paid from the owner's payable; the entry credits
 *        any investment rent. While the owner has open invoices, one must be
 *        chosen or `newInvoice: true` sent.
 */

import { createSuccessResponse } from "@/lib/api-utils";
import { LEDGER_MANAGE_ACCESS, LEDGER_VIEW_ACCESS, ledgerRoute, pageParams, pagination, readJson, stringOrNull } from "@/lib/accounting/api";
import { closeSettlement, listSettlements } from "@/lib/accounting/owners.service";
import { ledgerError } from "@/lib/accounting/errors";

export const dynamic = "force-dynamic";

export const GET = ledgerRoute(LEDGER_VIEW_ACCESS, async (_user, request) => {
  const params = request.nextUrl.searchParams;
  const { page, limit } = pageParams(params);
  const { rows, total } = await listSettlements({ ownerId: params.get("ownerId"), page, limit });
  return createSuccessResponse({ settlements: rows }, undefined, pagination(page, limit, total));
});

export const POST = ledgerRoute(LEDGER_MANAGE_ACCESS, async (user, request) => {
  const body = await readJson(request);
  const ownerId = stringOrNull(body.ownerId);
  if (!ownerId) throw ledgerError("LEDGER_OWNER_REQUIRED", "Choose the owner");
  const settlement = await closeSettlement(
    {
      ownerId,
      periodStart: body.periodStart,
      periodEnd: body.periodEnd,
      agreementId: stringOrNull(body.agreementId),
      notes: stringOrNull(body.notes),
      invoiceId: stringOrNull(body.invoiceId),
      newInvoice: body.newInvoice === true,
    },
    user,
    user.id,
  );
  return createSuccessResponse(settlement, "Period settled");
});
