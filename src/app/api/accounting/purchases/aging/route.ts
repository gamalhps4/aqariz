/**
 * PropertyPro - Payables aging
 *
 * GET `?asOf=YYYY-MM-DD&supplierId` — what the office owes each supplier at the
 * day (today when left out), by how long it has been due, with the books'
 * own figure for the suppliers' payable account beside it.
 * `?format=xlsx|pdf|csv` downloads it.
 */

import { NextResponse } from "next/server";
import { createSuccessResponse } from "@/lib/api-utils";
import { today } from "@/lib/accounting/dates";
import { payablesAging } from "@/lib/accounting/purchases/aging.service";
import {
  PURCHASE_VIEW_ACCESS,
  dayParam,
  exportAsk,
  fileResponse,
  ledgerRoute,
} from "@/lib/accounting/purchases/api";
import { agingSheet } from "@/lib/accounting/purchases/sheets";
import { supplierName } from "@/lib/accounting/purchases/suppliers.service";
import { translateLabel } from "@/lib/reports/labels";

export const dynamic = "force-dynamic";

export const GET = ledgerRoute(PURCHASE_VIEW_ACCESS, async (user, request) => {
  const params = request.nextUrl.searchParams;
  const ask = exportAsk(user, params, "purchase_export");
  if (ask instanceof NextResponse) return ask;

  const asOf = dayParam(params, "asOf") ?? today();
  const supplierId = params.get("supplierId") || null;
  const report = await payablesAging(asOf, { supplierId });
  if (!ask) return createSuccessResponse(report);

  const supplier = supplierId ? await supplierName(supplierId) : null;
  return fileResponse(
    agingSheet(report.rows, report.totals, {
      asOf: report.asOf,
      filters: [["Supplier", supplier]],
      ledger: report.ledger,
      totalLabel: translateLabel("Total", ask.lang),
    }),
    ask,
    "Payables aging",
    report.asOf,
  );
});
