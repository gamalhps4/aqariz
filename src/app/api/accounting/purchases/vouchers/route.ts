/**
 * PropertyPro - Payment vouchers (سند صرف)
 *
 * GET  — `?search&status&supplierId&bankAccountId&from&to&page&limit&sortBy
 *        &order`; the figures carry the total paid in `summary`.
 *        `?format=xlsx|pdf|csv` downloads the list as filtered.
 * POST — write one: { supplierId, bankAccountId, voucherDate, amount, method?,
 *        reference?, notes?, allocations: [{ billId, amount }] }. It is posted
 *        to the books at once; what its allocations leave over is on account
 *        with the supplier. Paying a supplier is a right of its own.
 */

import { NextResponse } from "next/server";
import { createSuccessResponse } from "@/lib/api-utils";
import { businessToday } from "@/lib/dates/business-day";
import { capExportRows, EXPORT_FETCH_LIMIT, EXPORT_ROW_LIMIT } from "@/lib/reports/export";
import { db } from "@/lib/db/prisma";
import {
  PURCHASE_PAY_ACCESS,
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
import { vouchersSheet } from "@/lib/accounting/purchases/sheets";
import { supplierName } from "@/lib/accounting/purchases/suppliers.service";
import { createVoucher, listVouchers, type VoucherListQuery } from "@/lib/accounting/purchases/vouchers.service";

export const dynamic = "force-dynamic";

const SORTS = ["voucherDate", "number", "amount"] as const;

export const GET = ledgerRoute(PURCHASE_VIEW_ACCESS, async (user, request) => {
  const params = request.nextUrl.searchParams;
  const ask = exportAsk(user, params, "purchase_export");
  if (ask instanceof NextResponse) return ask;

  const { from, to } = periodParams(params);
  const { page, limit } = pageParams(params);
  const query: Omit<VoucherListQuery, "page" | "limit"> = {
    search: params.get("search") ?? undefined,
    status: params.get("status") ?? undefined,
    supplierId: params.get("supplierId") || undefined,
    bankAccountId: params.get("bankAccountId") || undefined,
    from,
    to,
    sortBy: SORTS.find((sort) => sort === params.get("sortBy")),
    sortOrder: orderParam(params),
  };

  if (ask) {
    const { rows, summary } = await listVouchers({ ...query, page: 1, limit: EXPORT_FETCH_LIMIT });
    const capped = capExportRows(rows);
    const [supplier, bank] = await Promise.all([
      query.supplierId ? supplierName(query.supplierId) : null,
      query.bankAccountId
        ? db.bankAccount.findFirst({ where: { id: query.bankAccountId }, select: { name: true } })
        : null,
    ]);
    return fileResponse(
      vouchersSheet(capped.rows, {
        period: { from: isoDay(from), to: isoDay(to) },
        filters: [
          ["Status", query.status && query.status !== "all" ? query.status : null],
          ["Supplier", supplier],
          ["Account", bank?.name],
          ["Search", query.search],
        ],
        truncated: capped.truncated,
        limit: EXPORT_ROW_LIMIT,
        totalAmount: summary.totalAmount,
        language: ask.lang,
      }),
      ask,
      "Payment vouchers",
      businessToday(),
    );
  }

  const { rows, total, summary } = await listVouchers({ ...query, page, limit });
  return createSuccessResponse({ vouchers: rows }, undefined, pagination(page, limit, total), { ...summary });
});

export const POST = ledgerRoute(PURCHASE_PAY_ACCESS, async (user, request) => {
  const voucher = await createVoucher(await readJson(request), { id: user.id });
  return createSuccessResponse(voucher, `Payment voucher ${voucher.displayNumber} written`);
});
