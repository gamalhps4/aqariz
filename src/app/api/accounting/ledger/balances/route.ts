/**
 * PropertyPro - Account balances and the ledger's totals
 *
 * GET `?asOf=YYYY-MM-DD` — each account's debits and credits up to the day,
 * and whether total debits equal total credits. The base the trial balance
 * and the statements are built on.
 */

import { createSuccessResponse } from "@/lib/api-utils";
import { LEDGER_VIEW_ACCESS, ledgerRoute } from "@/lib/accounting/api";
import { ledgerBalances } from "@/lib/accounting/journals.service";
import { parseDay } from "@/lib/accounting/dates";

export const dynamic = "force-dynamic";

export const GET = ledgerRoute(LEDGER_VIEW_ACCESS, async (_user, request) =>
  createSuccessResponse(await ledgerBalances(parseDay(request.nextUrl.searchParams.get("asOf")))),
);
