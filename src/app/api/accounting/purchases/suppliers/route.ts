/**
 * PropertyPro - Suppliers
 *
 * GET  — the office's suppliers with what it owes each, `?search&status&page&limit`
 *        (status: active — the default — inactive or all). `?options=1[&limit=n]`
 *        answers the light list the pickers use (the first 1,000 by name unless
 *        asked for fewer or, at most, 2,000). `?format=xlsx|pdf|csv` downloads
 *        the list as filtered.
 * POST — add one: { name, vatNumber?, phone?, contactName?, email?, address?,
 *        city?, crNumber?, bankName?, iban?, paymentTermsDays?, notes? }.
 */

import { NextResponse } from "next/server";
import { createSuccessResponse } from "@/lib/api-utils";
import { businessToday } from "@/lib/dates/business-day";
import { capExportRows, EXPORT_FETCH_LIMIT, EXPORT_ROW_LIMIT } from "@/lib/reports/export";
import {
  PURCHASE_CREATE_ACCESS,
  PURCHASE_VIEW_ACCESS,
  exportAsk,
  fileResponse,
  ledgerRoute,
  pageParams,
  pagination,
  readJson,
} from "@/lib/accounting/purchases/api";
import { suppliersSheet } from "@/lib/accounting/purchases/sheets";
import { createSupplier, listSuppliers, supplierOptions } from "@/lib/accounting/purchases/suppliers.service";

export const dynamic = "force-dynamic";

function statusParam(value: string | null): "active" | "inactive" | "all" {
  return value === "inactive" || value === "all" ? value : "active";
}

export const GET = ledgerRoute(PURCHASE_VIEW_ACCESS, async (user, request) => {
  const params = request.nextUrl.searchParams;
  const status = statusParam(params.get("status"));
  const search = params.get("search") ?? undefined;

  if (params.get("options") === "1") {
    return createSuccessResponse({
      suppliers: await supplierOptions({
        search,
        includeInactive: status === "all",
        limit: Number(params.get("limit")) || undefined,
      }),
    });
  }

  const ask = exportAsk(user, params, "purchase_export");
  if (ask instanceof NextResponse) return ask;
  if (ask) {
    const { rows } = await listSuppliers({ search, status, page: 1, limit: EXPORT_FETCH_LIMIT });
    const capped = capExportRows(rows);
    return fileResponse(
      suppliersSheet(capped.rows, {
        filters: [
          ["Status", status],
          ["Search", search],
        ],
        truncated: capped.truncated,
        limit: EXPORT_ROW_LIMIT,
      }),
      ask,
      "Suppliers",
      businessToday(),
    );
  }

  const { page, limit } = pageParams(params);
  const { rows, total } = await listSuppliers({ search, status, page, limit });
  return createSuccessResponse({ suppliers: rows }, undefined, pagination(page, limit, total));
});

export const POST = ledgerRoute(PURCHASE_CREATE_ACCESS, async (_user, request) => {
  const supplier = await createSupplier(await readJson(request));
  return createSuccessResponse(supplier, "Supplier added");
});
