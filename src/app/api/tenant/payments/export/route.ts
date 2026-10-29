/**
 * PropertyPro - A tenant's own payments, as a file
 *
 * GET /api/tenant/payments/export?format=xlsx|pdf|csv&status=&type=&startDate=&endDate=
 *
 * The tenant's payment history page asked this route for its download and the
 * route did not exist, so the request failed every time. It carries the same
 * filters as the history list — status, type, a window on when the row was
 * written — and every one of the tenant's payments they match, each with its
 * payment number (the receipt number), in the tenant's language.
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";
import {
  AuthenticatedAccessUser,
  createErrorResponse,
  handleApiError,
  withPermissionAndDB,
} from "@/lib/api-utils";
import {
  EXPORT_FETCH_LIMIT,
  EXPORT_ROW_LIMIT,
  buildReportResponse,
  capExportRows,
  isReportFormat,
  isRtlReportRequest,
  reportLanguage,
  type ReportFormat,
  type ReportSheet,
} from "@/lib/reports/export";
import { paymentDisplayStatus } from "@/lib/payments/display-status";
import { paymentReference } from "@/lib/payments/report-lines";
import { formatPaymentNumber } from "@/lib/payments/receipt-number";
import { paymentNumbersAvailable } from "@/lib/payments/payment-number";
import {
  businessDay,
  businessRange,
  businessToday,
  parseBusinessDay,
} from "@/lib/dates/business-day";

export const GET = withPermissionAndDB("payment_portal")(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const { searchParams } = new URL(request.url);
      const format = searchParams.get("format") ?? "xlsx";
      if (!isReportFormat(format)) {
        return createErrorResponse(`Unsupported export format "${format}"`, 400);
      }

      // The signed-in tenant's own payments, and nobody else's.
      const where: Prisma.PaymentWhereInput = { tenantId: user.id };
      const status = searchParams.get("status");
      if (status && status !== "all") {
        const statuses = status.split(",").map((value) => value.trim()).filter(Boolean);
        where.status = statuses.length > 1 ? { in: statuses } : statuses[0];
      }
      const type = searchParams.get("type");
      if (type && type !== "all") where.type = type;
      // The days the tenant picked, on the office's calendar, the last one
      // in full.
      const startDate = parseBusinessDay(searchParams.get("startDate"));
      const endDate = parseBusinessDay(searchParams.get("endDate"));
      const written = businessRange(startDate, endDate);
      if (written) where.createdAt = written;

      const withNumber = await paymentNumbersAvailable();
      const fetched = await db.payment.findMany({
        where,
        omit: { number: !withNumber },
        include: {
          property: { select: { name: true } },
          lease: { select: { unit: { select: { unitNumber: true } } } },
          invoice: { select: { invoiceNumber: true } },
        },
        orderBy: [{ dueDate: "desc" }, { id: "desc" }],
        take: EXPORT_FETCH_LIMIT,
      });
      const { rows, truncated } = capExportRows(fetched);

      const sheet: ReportSheet<(typeof rows)[number]> = {
        title: "Payment history",
        columns: [
          {
            header: "Payment no.",
            value: (row) =>
              formatPaymentNumber((row as { number?: number | null }).number) ?? "",
          },
          { header: "Due date", value: (row) => businessDay(row.dueDate) },
          {
            header: "Paid date",
            value: (row) => (row.paidDate ? businessDay(row.paidDate) : ""),
          },
          { header: "Building", value: (row) => row.property?.name ?? "" },
          { header: "Unit", value: (row) => row.lease?.unit?.unitNumber ?? "" },
          { header: "Installment", value: (row) => row.invoice?.invoiceNumber ?? "" },
          { header: "Type", value: (row) => row.type },
          // What the screen's badge says, not the stored lifecycle value.
          { header: "Status", value: (row) => paymentDisplayStatus(row) },
          { header: "Method", value: (row) => row.paymentMethod ?? "" },
          { header: "Amount", value: (row) => Number(row.amount) },
          { header: "Paid", value: (row) => Number(row.amountPaid ?? 0) },
          {
            header: "Outstanding",
            value: (row) => Math.max(0, Number(row.amount) - Number(row.amountPaid ?? 0)),
          },
          { header: "Reference", value: (row) => paymentReference(row) ?? "" },
        ],
        rows,
        filtersSummary: {
          period:
            startDate || endDate
              ? { from: startDate ?? undefined, to: endDate ?? undefined }
              : undefined,
          filters: [
            ["Status", status && status !== "all" ? status : undefined],
            ["Type", type && type !== "all" ? type : undefined],
          ],
          limit: EXPORT_ROW_LIMIT,
          truncated,
        },
      };

      return buildReportResponse(sheet, {
        format: format as ReportFormat,
        rtl: isRtlReportRequest(searchParams),
        lang: reportLanguage(searchParams),
        fileName: "Payment history",
        dateStamp: businessToday(),
      });
    } catch (error) {
      return handleApiError(error, "Failed to export the payments");
    }
  },
);
