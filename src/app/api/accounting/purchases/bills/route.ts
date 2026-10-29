/**
 * PropertyPro - Purchase bills
 *
 * GET  — `?search&status&supplierId&from&to&dueFrom&dueTo&propertyId&page&limit
 *        &sortBy&order`, with totals over everything the filters match in the
 *        response's `summary`. status is a bill's status, `open` (owed and not
 *        paid in full), `overdue` or `all`. `?format=xlsx|pdf|csv` downloads
 *        the list as filtered.
 * POST — enter a bill, waiting for approval: { supplierId, billDate, dueDate?,
 *        supplierInvoiceNumber?, discountAmount?, notes?, lines: [{ description,
 *        accountId, quantity?, unitPrice, vatCategory, vatRate?, propertyId?,
 *        unitId? }] }.
 */

import { NextResponse } from "next/server";
import { createSuccessResponse } from "@/lib/api-utils";
import { businessToday } from "@/lib/dates/business-day";
import { capExportRows, EXPORT_FETCH_LIMIT, EXPORT_ROW_LIMIT } from "@/lib/reports/export";
import { describeAppliedFilters } from "@/lib/report-filters/describe";
import {
  PURCHASE_CREATE_ACCESS,
  PURCHASE_VIEW_ACCESS,
  exportAsk,
  fileResponse,
  isoDay,
  ledgerRoute,
  orderParam,
  pageParams,
  pagination,
  periodParams,
  readJson,
} from "@/lib/accounting/purchases/api";
import { createBill, listBills, type BillListQuery } from "@/lib/accounting/purchases/bills.service";
import { billsSheet } from "@/lib/accounting/purchases/sheets";
import { supplierName } from "@/lib/accounting/purchases/suppliers.service";

export const dynamic = "force-dynamic";

const SORTS = ["billDate", "dueDate", "number", "totalAmount"] as const;

export const GET = ledgerRoute(PURCHASE_VIEW_ACCESS, async (user, request) => {
  const params = request.nextUrl.searchParams;
  const ask = exportAsk(user, params, "purchase_export");
  if (ask instanceof NextResponse) return ask;

  const { from, to } = periodParams(params);
  const due = periodParams(params, "dueFrom", "dueTo");
  const sortBy = SORTS.find((sort) => sort === params.get("sortBy"));
  const { page, limit } = pageParams(params);
  const query: Omit<BillListQuery, "page" | "limit"> = {
    search: params.get("search") ?? undefined,
    status: params.get("status") ?? undefined,
    supplierId: params.get("supplierId") || undefined,
    from,
    to,
    dueFrom: due.from,
    dueTo: due.to,
    propertyId: params.get("propertyId") || undefined,
    sortBy,
    sortOrder: orderParam(params),
  };

  if (ask) {
    const { rows, summary } = await listBills({ ...query, page: 1, limit: EXPORT_FETCH_LIMIT });
    const capped = capExportRows(rows);
    const supplier = query.supplierId ? await supplierName(query.supplierId) : null;
    return fileResponse(
      billsSheet(capped.rows, {
        period: { from: isoDay(from), to: isoDay(to) },
        filters: [
          ["Status", query.status && query.status !== "all" ? query.status : null],
          ["Supplier", supplier],
          ...(query.propertyId ? await describeAppliedFilters(user, { propertyId: query.propertyId }) : []),
          ["Search", query.search],
        ],
        truncated: capped.truncated,
        limit: EXPORT_ROW_LIMIT,
        totals: summary,
      }),
      ask,
      "Purchase bills",
      businessToday(),
    );
  }

  const { rows, total, summary } = await listBills({ ...query, page, limit });
  return createSuccessResponse({ bills: rows }, undefined, pagination(page, limit, total), { ...summary });
});

export const POST = ledgerRoute(PURCHASE_CREATE_ACCESS, async (user, request) => {
  const bill = await createBill(await readJson(request), { id: user.id });
  return createSuccessResponse(bill, `Bill ${bill.displayNumber} entered, waiting for approval`);
});
