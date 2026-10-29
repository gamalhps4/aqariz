/**
 * PropertyPro - The Purchases & Payments register
 *
 * GET `?from&to&kind&status&supplierId&propertyId&search&page&limit&order` —
 * the bills the office entered and the vouchers it wrote, in date order, with
 * totals over everything the filters match. kind is all, bills or payments;
 * status is a bill's, `posted` or `cancelled` for vouchers, or all (a building
 * filter is about bills). `?format=xlsx|pdf|csv` downloads it as filtered.
 */

import { NextResponse } from "next/server";
import { createSuccessResponse } from "@/lib/api-utils";
import { businessToday } from "@/lib/dates/business-day";
import { capExportRows, EXPORT_FETCH_LIMIT, EXPORT_ROW_LIMIT } from "@/lib/reports/export";
import { describeAppliedFilters } from "@/lib/report-filters/describe";
import {
  PURCHASE_VIEW_ACCESS,
  exportAsk,
  fileResponse,
  isoDay,
  ledgerRoute,
  orderParam,
  pageParams,
  pagination,
  periodParams,
} from "@/lib/accounting/purchases/api";
import { purchaseRegisterSheet } from "@/lib/accounting/registers-sheets";
import { purchaseRegister } from "@/lib/accounting/registers.service";
import { PURCHASE_KIND_FILTERS, type PurchaseKindFilter, type PurchaseRegisterQuery } from "@/lib/accounting/registers";
import { supplierName } from "@/lib/accounting/purchases/suppliers.service";

export const dynamic = "force-dynamic";

export const GET = ledgerRoute(PURCHASE_VIEW_ACCESS, async (user, request) => {
  const params = request.nextUrl.searchParams;
  const ask = exportAsk(user, params, "purchase_export");
  if (ask instanceof NextResponse) return ask;

  const { from, to } = periodParams(params);
  const { page, limit } = pageParams(params, 50);
  const kind = PURCHASE_KIND_FILTERS.find((value) => value === params.get("kind")) as PurchaseKindFilter | undefined;
  const query: Omit<PurchaseRegisterQuery, "page" | "limit"> = {
    from,
    to,
    kind,
    status: params.get("status") ?? undefined,
    supplierId: params.get("supplierId") || undefined,
    propertyId: params.get("propertyId") || undefined,
    search: params.get("search") ?? undefined,
    order: orderParam(params),
  };

  if (ask) {
    const result = await purchaseRegister({ ...query, page: 1, limit: EXPORT_FETCH_LIMIT });
    const capped = capExportRows(result.rows);
    const supplier = query.supplierId ? await supplierName(query.supplierId) : null;
    return fileResponse(
      purchaseRegisterSheet(capped.rows, result.totals, {
        period: { from: isoDay(from), to: isoDay(to) },
        filters: [
          ["Document", kind && kind !== "all" ? (kind === "bills" ? "purchase_bill" : "payment_voucher") : null],
          ["Status", query.status && query.status !== "all" ? query.status : null],
          ["Supplier", supplier],
          ...(query.propertyId ? await describeAppliedFilters(user, { propertyId: query.propertyId }) : []),
          ["Search", query.search],
        ],
        truncated: capped.truncated,
        limit: EXPORT_ROW_LIMIT,
        language: ask.lang,
      }),
      ask,
      "Purchases and payments",
      businessToday(),
    );
  }

  const result = await purchaseRegister({ ...query, page, limit });
  return createSuccessResponse(
    { rows: result.rows, totals: result.totals },
    undefined,
    pagination(page, limit, result.total),
  );
});
