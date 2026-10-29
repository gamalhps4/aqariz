/**
 * PropertyPro - Reconciling a bank or cash account with its statement
 *
 * GET  `?bankAccountId&asOf&from&status&search&page&limit` — the account's
 *      book balance and reconciled balance at the day (today when left out),
 *      and its lines (status: unreconciled — the default — reconciled or all).
 * POST { bankAccountId, lineIds, reconciled, reconciledOn? } — tick lines off
 *      against the statement (`reconciled: true`, on the day the bank cleared
 *      them, today by default) or take the tick away (`false`).
 */

import { createSuccessResponse } from "@/lib/api-utils";
import {
  LEDGER_MANAGE_ACCESS,
  LEDGER_VIEW_ACCESS,
  ledgerRoute,
  pageParams,
  pagination,
  readJson,
} from "@/lib/accounting/api";
import { ledgerError } from "@/lib/accounting/errors";
import { dayParam } from "@/lib/accounting/purchases/api";
import {
  RECONCILIATION_STATUSES,
  reconciliationView,
  setReconciled,
  type ReconcileInput,
} from "@/lib/accounting/reconciliation.service";

export const dynamic = "force-dynamic";

export const GET = ledgerRoute(LEDGER_VIEW_ACCESS, async (_user, request) => {
  const params = request.nextUrl.searchParams;
  const bankAccountId = params.get("bankAccountId");
  if (!bankAccountId) throw ledgerError("RECONCILE_BANK_REQUIRED", "Choose an account");
  const { page, limit } = pageParams(params, 50);
  const status = RECONCILIATION_STATUSES.find((value) => value === params.get("status"));
  const view = await reconciliationView({
    bankAccountId,
    asOf: dayParam(params, "asOf"),
    from: dayParam(params, "from"),
    status,
    search: params.get("search") ?? undefined,
    page,
    limit,
  });
  const { total, ...rest } = view;
  return createSuccessResponse(rest, undefined, pagination(page, limit, total));
});

export const POST = ledgerRoute(LEDGER_MANAGE_ACCESS, async (user, request) => {
  const body = await readJson<Partial<ReconcileInput>>(request);
  if (!body.bankAccountId) throw ledgerError("RECONCILE_BANK_REQUIRED", "Choose an account");
  if (!Array.isArray(body.lineIds)) throw ledgerError("RECONCILE_NO_LINES", "Choose the lines first");
  const result = await setReconciled(
    {
      bankAccountId: body.bankAccountId,
      lineIds: body.lineIds as string[],
      reconciled: body.reconciled !== false,
      reconciledOn: body.reconciledOn,
    },
    user.id,
  );
  return createSuccessResponse(
    result,
    body.reconciled === false ? "Reconciliation removed" : "Lines reconciled",
  );
});
