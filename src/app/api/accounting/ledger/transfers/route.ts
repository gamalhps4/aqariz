/**
 * PropertyPro - Transfers between the office's accounts
 *
 * GET  — newest first, `?page&limit`.
 * POST — { fromBankAccountId, toBankAccountId, amount, date, reference?,
 *        memo? }, posted as one journal entry.
 */

import { createSuccessResponse } from "@/lib/api-utils";
import { LEDGER_MANAGE_ACCESS, LEDGER_VIEW_ACCESS, ledgerRoute, pageParams, pagination, readJson } from "@/lib/accounting/api";
import { createTransfer, listTransfers, type TransferInput } from "@/lib/accounting/banks.service";

export const dynamic = "force-dynamic";

export const GET = ledgerRoute(LEDGER_VIEW_ACCESS, async (_user, request) => {
  const { page, limit } = pageParams(request.nextUrl.searchParams);
  const { rows, total } = await listTransfers({ page, limit });
  return createSuccessResponse({ transfers: rows }, undefined, pagination(page, limit, total));
});

export const POST = ledgerRoute(LEDGER_MANAGE_ACCESS, async (user, request) => {
  const transfer = await createTransfer(await readJson<TransferInput>(request), user.id);
  return createSuccessResponse(transfer, `Transfer posted as journal ${transfer.journalNumber}`);
});
