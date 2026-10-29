/**
 * PropertyPro - Paying owners out
 *
 * GET  — what the office owes each owner, and the payouts made
 *        (`?ownerId&page&limit`).
 * POST — { ownerId, amount, date, bankAccountId, reference?, notes? }.
 */

import { createSuccessResponse } from "@/lib/api-utils";
import { LEDGER_MANAGE_ACCESS, LEDGER_VIEW_ACCESS, ledgerRoute, pageParams, pagination, readJson, stringOrNull } from "@/lib/accounting/api";
import { createPayout, listPayouts, ownerBalances } from "@/lib/accounting/owners.service";
import { ledgerError } from "@/lib/accounting/errors";

export const dynamic = "force-dynamic";

export const GET = ledgerRoute(LEDGER_VIEW_ACCESS, async (_user, request) => {
  const params = request.nextUrl.searchParams;
  const { page, limit } = pageParams(params);
  const [balances, payouts] = await Promise.all([
    ownerBalances(),
    listPayouts({ ownerId: params.get("ownerId"), page, limit }),
  ]);
  return createSuccessResponse(
    { balances, payouts: payouts.rows },
    undefined,
    pagination(page, limit, payouts.total),
  );
});

export const POST = ledgerRoute(LEDGER_MANAGE_ACCESS, async (user, request) => {
  const body = await readJson(request);
  const ownerId = stringOrNull(body.ownerId);
  const bankAccountId = stringOrNull(body.bankAccountId);
  if (!ownerId) throw ledgerError("LEDGER_OWNER_REQUIRED", "Choose the owner");
  if (!bankAccountId) throw ledgerError("LEDGER_BANK_REQUIRED", "Choose the account it was paid from");
  const payout = await createPayout(
    {
      ownerId,
      bankAccountId,
      amount: body.amount,
      date: body.date,
      reference: stringOrNull(body.reference),
      notes: stringOrNull(body.notes),
    },
    user.id,
  );
  return createSuccessResponse(payout, `Payout posted as journal ${payout.journalNumber}`);
});
