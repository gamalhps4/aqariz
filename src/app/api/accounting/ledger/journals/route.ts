/**
 * PropertyPro - The journal
 *
 * GET  — entries, newest first: `?from&to` (YYYY-MM-DD), `?sourceType`,
 *        `?accountId`, `?status=posted|reversed`, `?search` (number, memo,
 *        reference), `?page&limit`.
 * POST — a manual journal: { date, memo?, reference?, lines: [{ accountId,
 *        debit?, credit?, memo?, partyType?, partyId?, propertyId? }] }.
 */

import { createSuccessResponse } from "@/lib/api-utils";
import { LEDGER_MANAGE_ACCESS, LEDGER_VIEW_ACCESS, ledgerRoute, pageParams, pagination, readJson } from "@/lib/accounting/api";
import { listJournals } from "@/lib/accounting/journals.service";
import { postManualJournal } from "@/lib/accounting/ledger.service";
import type { ManualLineInput } from "@/lib/accounting/posting/manual";
import { parseDay } from "@/lib/accounting/dates";
import { ledgerError } from "@/lib/accounting/errors";

export const dynamic = "force-dynamic";

export const GET = ledgerRoute(LEDGER_VIEW_ACCESS, async (_user, request) => {
  const params = request.nextUrl.searchParams;
  const { page, limit } = pageParams(params);
  const { rows, total } = await listJournals({
    page,
    limit,
    from: parseDay(params.get("from")),
    to: parseDay(params.get("to")),
    sourceType: params.get("sourceType"),
    accountId: params.get("accountId"),
    status: params.get("status"),
    search: params.get("search"),
  });
  return createSuccessResponse({ entries: rows }, undefined, pagination(page, limit, total));
});

export const POST = ledgerRoute(LEDGER_MANAGE_ACCESS, async (user, request) => {
  const body = await readJson<{ date?: unknown; memo?: string; reference?: string; lines?: ManualLineInput[] }>(request);
  if (!Array.isArray(body.lines)) {
    throw ledgerError("LEDGER_TOO_FEW_LINES", "A journal needs at least two lines");
  }
  const entry = await postManualJournal(
    { date: body.date, memo: body.memo ?? null, reference: body.reference ?? null, lines: body.lines },
    user.id,
  );
  return createSuccessResponse(entry, `Journal ${entry.number} posted`);
});
