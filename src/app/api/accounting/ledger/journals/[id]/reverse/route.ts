/**
 * PropertyPro - Reverse a manual journal or opening balance
 *
 * POST { date?, memo? } — the entry's lines turned around, dated today unless
 * a day is given. Entries posted from documents follow their documents and
 * are refused here.
 */

import { createSuccessResponse } from "@/lib/api-utils";
import { LEDGER_MANAGE_ACCESS, ledgerRoute, readJson } from "@/lib/accounting/api";
import { reverseEntry } from "@/lib/accounting/ledger.service";

export const dynamic = "force-dynamic";

export const POST = ledgerRoute(LEDGER_MANAGE_ACCESS, async (user, request, context) => {
  const { id } = await context.params;
  const body = await readJson<{ date?: unknown; memo?: string }>(request).catch(() => ({}) as { date?: unknown; memo?: string });
  const reversal = await reverseEntry(id, { date: body.date, memo: body.memo ?? null }, user.id);
  return createSuccessResponse(reversal, `Reversed by journal ${reversal.number}`);
});
