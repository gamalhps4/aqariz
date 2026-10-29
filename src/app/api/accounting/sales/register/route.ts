/**
 * PropertyPro - The Sales & Receipts register
 *
 * GET `?from&to&kind&status&tenantId&ownerId&propertyId&search&page&limit&order`
 * — the invoices and credit notes the office issued and the receipts it gave
 * (a tenant's payment under its voucher number, and what an owner or a
 * customer paid on their invoice), in date order, with totals over everything
 * the filters match. kind is all, invoices, credit_notes or receipts.
 * `?format=xlsx|pdf|csv` downloads it as filtered.
 */

import { NextResponse } from "next/server";
import { createSuccessResponse } from "@/lib/api-utils";
import { businessToday } from "@/lib/dates/business-day";
import { ACCOUNTING_READ_PERMISSIONS } from "@/lib/finance-permissions";
import { capExportRows, EXPORT_FETCH_LIMIT, EXPORT_ROW_LIMIT } from "@/lib/reports/export";
import { describeAppliedFilters } from "@/lib/report-filters/describe";
import { ledgerRoute, pageParams, pagination } from "@/lib/accounting/api";
import {
  exportAsk,
  fileResponse,
  isoDay,
  orderParam,
  periodParams,
} from "@/lib/accounting/purchases/api";
import { salesRegisterSheet } from "@/lib/accounting/registers-sheets";
import { salesRegister } from "@/lib/accounting/registers.service";
import { SALES_KIND_FILTERS, type SalesKindFilter, type SalesRegisterQuery } from "@/lib/accounting/registers";

export const dynamic = "force-dynamic";

export const GET = ledgerRoute({ permissions: [...ACCOUNTING_READ_PERMISSIONS] }, async (user, request) => {
  const params = request.nextUrl.searchParams;
  const ask = exportAsk(user, params, "accounting_export");
  if (ask instanceof NextResponse) return ask;

  const { from, to } = periodParams(params);
  const { page, limit } = pageParams(params, 50);
  const kind = SALES_KIND_FILTERS.find((value) => value === params.get("kind")) as SalesKindFilter | undefined;
  const query: Omit<SalesRegisterQuery, "page" | "limit"> = {
    from,
    to,
    kind,
    status: params.get("status") ?? undefined,
    tenantId: params.get("tenantId") || undefined,
    ownerId: params.get("ownerId") || undefined,
    propertyId: params.get("propertyId") || undefined,
    search: params.get("search") ?? undefined,
    order: orderParam(params),
  };

  if (ask) {
    const result = await salesRegister({ ...query, page: 1, limit: EXPORT_FETCH_LIMIT });
    const capped = capExportRows(result.rows);
    return fileResponse(
      salesRegisterSheet(capped.rows, result.totals, {
        period: { from: isoDay(from), to: isoDay(to) },
        filters: [
          [
            "Document",
            kind && kind !== "all"
              ? kind === "invoices"
                ? "invoice"
                : kind === "credit_notes"
                  ? "credit_note"
                  : "receipt_voucher"
              : null,
          ],
          ["Status", query.status && query.status !== "all" ? query.status : null],
          ...(await describeAppliedFilters(user, {
            ownerId: query.ownerId,
            propertyId: query.propertyId,
            tenantId: query.tenantId,
          })),
          ["Search", query.search],
        ],
        truncated: capped.truncated,
        limit: EXPORT_ROW_LIMIT,
      }),
      ask,
      "Sales and receipts",
      businessToday(),
    );
  }

  const result = await salesRegister({ ...query, page, limit });
  return createSuccessResponse(
    { rows: result.rows, totals: result.totals },
    undefined,
    pagination(page, limit, result.total),
  );
});
