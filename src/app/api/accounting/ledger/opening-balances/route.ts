/**
 * PropertyPro - Opening balances
 *
 * GET  — the opening-balance entries posted so far.
 * POST — { lines: [...] } from the form, or { csv: "..." } from a file; the
 *        difference goes to opening-balance equity. A CSV with any problem
 *        posts nothing and lists the lines at fault.
 */

import { NextResponse } from "next/server";
import { createErrorResponse, createSuccessResponse } from "@/lib/api-utils";
import { LEDGER_MANAGE_ACCESS, LEDGER_VIEW_ACCESS, ledgerRoute, readJson } from "@/lib/accounting/api";
import { listJournals } from "@/lib/accounting/journals.service";
import { postOpeningBalances, postOpeningBalancesCsv } from "@/lib/accounting/ledger.service";
import type { ManualLineInput } from "@/lib/accounting/posting/manual";
import { ledgerError } from "@/lib/accounting/errors";

export const dynamic = "force-dynamic";

export const GET = ledgerRoute(LEDGER_VIEW_ACCESS, async () => {
  const { rows } = await listJournals({ page: 1, limit: 100, sourceType: "opening_balance" });
  return createSuccessResponse({ entries: rows });
});

export const POST = ledgerRoute(LEDGER_MANAGE_ACCESS, async (user, request) => {
  const body = await readJson<{ lines?: ManualLineInput[]; csv?: string; memo?: string }>(request);
  if (typeof body.csv === "string") {
    if (body.csv.length > 2_000_000) {
      throw ledgerError("LEDGER_CSV_TOO_LARGE", "The file is too large");
    }
    const result = await postOpeningBalancesCsv(body.csv, body.memo ?? null, user.id);
    if (!result.entry) {
      return NextResponse.json(
        {
          success: false,
          error: "The file has problems; nothing was posted",
          code: "LEDGER_CSV_PROBLEMS",
          data: { problems: result.problems },
        },
        { status: 400 },
      );
    }
    return createSuccessResponse(result.entry, `Opening balances posted as journal ${result.entry.number}`);
  }
  if (!Array.isArray(body.lines)) {
    return createErrorResponse("Send the balances as lines or as a CSV", 400, undefined, "LEDGER_BAD_REQUEST");
  }
  const entry = await postOpeningBalances({ lines: body.lines, memo: body.memo ?? null }, user.id);
  return createSuccessResponse(entry, `Opening balances posted as journal ${entry.number}`);
});
