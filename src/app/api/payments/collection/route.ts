/**
 * PropertyPro - Collection API
 *
 * Collected versus outstanding, grouped by contract or by tenant, with the
 * payments behind each. Filtered by building, owner, compound, tenant and
 * the installments' due dates. `?format=` returns the same rows as a
 * download.
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  withPermissionAndDB,
} from "@/lib/api-utils";
import {
  getCollectionReport,
  isCollectionScope,
  type CollectionRecord,
  type CollectionScope,
} from "@/lib/services/collection.service";
import {
  buildReportResponse,
  isReportFormat,
  isRtlReportRequest,
  reportLanguage,
  type ReportColumn,
  type ReportFormat,
  type ReportSheet,
} from "@/lib/reports/export";
import type { CollectionPaymentLine } from "@/types/collection";
import {
  businessDay,
  businessDayEnd,
  businessDayStart,
  businessToday,
  parseBusinessDay,
} from "@/lib/dates/business-day";

/** A contract's (or tenant's) row, or one of its payments beneath it. */
interface Line {
  record: CollectionRecord;
  payment?: CollectionPaymentLine;
}

type Cell = string | number | null | undefined;

/** A cell only the record's own row fills, so a column still adds up. */
function onRecord(value: (row: CollectionRecord) => Cell) {
  return (line: Line): Cell => (line.payment ? null : value(line.record));
}

/** A cell only a payment row fills. */
function onPayment(value: (payment: CollectionPaymentLine) => Cell) {
  return (line: Line): Cell => (line.payment ? value(line.payment) : null);
}

/**
 * What a PDF leaves out to keep its page readable — with a payment row under
 * each contract the sheet runs to sixteen columns. The spreadsheet and the
 * CSV keep every one.
 */
const PDF_OMITTED_HEADERS: ReadonlySet<string> = new Set([
  "Overdue invoices",
  "Oldest unpaid due",
  "Installment due date",
  "Reference",
]);

export const GET = withPermissionAndDB([
  "financial_management",
  "payment_processing",
  "financial_reports",
])(async (user: AuthenticatedAccessUser, request: NextRequest) => {
  try {
    const { searchParams } = request.nextUrl;

    const scopeParam = searchParams.get("scope") ?? "by-contract";
    if (!isCollectionScope(scopeParam)) {
      return createErrorResponse(`Unknown scope "${scopeParam}"`, 400);
    }
    const scope: CollectionScope = scopeParam;

    const rawFormat = searchParams.get("format");
    if (rawFormat && !isReportFormat(rawFormat)) {
      return createErrorResponse(
        `Unsupported export format "${rawFormat}"`,
        400,
      );
    }
    const format: ReportFormat | null = rawFormat
      ? (rawFormat as ReportFormat)
      : null;

    // No date filter by default: collection is about what is owed overall,
    // not about a period. A range narrows it to invoices due inside it.
    const startParam = searchParams.get("startDate");
    const endParam = searchParams.get("endDate");
    const startDay = startParam ? parseBusinessDay(startParam) : null;
    const endDay = endParam ? parseBusinessDay(endParam) : null;

    if ((startParam && !startDay) || (endParam && !endDay)) {
      return createErrorResponse("Invalid date range provided", 400);
    }
    if (startDay && endDay && endDay < startDay) {
      return createErrorResponse("End date must be after the start date", 400);
    }
    // Both ends are whole days on the office's calendar.
    const startDate = startDay ? businessDayStart(startDay) : undefined;
    const endDate = endDay ? businessDayEnd(endDay) : undefined;

    const report = await getCollectionReport({
      actor: user,
      scope,
      startDate,
      endDate,
      propertyId: searchParams.get("propertyId") || undefined,
      ownerId: searchParams.get("ownerId") || undefined,
      compoundId: searchParams.get("compoundId") || undefined,
      tenantId: searchParams.get("tenantId") || undefined,
      arrearsOnly: searchParams.get("arrearsOnly") === "true",
    });

    if (!format) {
      return createSuccessResponse(report, "Collection retrieved successfully");
    }

    // Each contract (or tenant), then a row for every payment behind its
    // "collected", with the payment's date. The amounts are written as
    // numbers in the office's currency; a column repeating "SAR" on every
    // row said nothing the heading does not.
    const columns: ReportColumn<Line>[] = [
      {
        header: scope === "by-contract" ? "Contract" : "Tenant",
        value: (line) => line.record.label,
      },
      ...(scope === "by-contract"
        ? [{ header: "Tenant", value: (line: Line) => line.record.tenantName }]
        : []),
      { header: "Mobile", value: onRecord((row) => row.tenantPhone) },
      { header: "Building", value: onRecord((row) => row.buildings.join(", ")) },
      { header: "Unit", value: onRecord((row) => row.units.join(", ")) },
      { header: "Invoices", value: onRecord((row) => row.invoiceCount) },
      { header: "Billed", value: onRecord((row) => row.billed) },
      { header: "Collected", value: onRecord((row) => row.collected) },
      { header: "Outstanding", value: onRecord((row) => row.outstanding) },
      { header: "Overdue", value: onRecord((row) => row.overdue) },
      { header: "Overdue invoices", value: onRecord((row) => row.overdueCount) },
      {
        header: "Collection rate %",
        value: onRecord((row) => row.collectionRate),
      },
      {
        header: "Oldest unpaid due",
        value: onRecord((row) =>
          row.oldestDueDate ? businessDay(row.oldestDueDate) : "",
        ),
      },
      {
        header: "Payment no.",
        value: onPayment((payment) => payment.paymentNumber ?? ""),
      },
      {
        header: "Payment date",
        value: onPayment((payment) => businessDay(payment.paidDate)),
      },
      { header: "Installment", value: onPayment((payment) => payment.invoiceNumber) },
      {
        header: "Installment due date",
        value: onPayment((payment) => businessDay(payment.installmentDueDate)),
      },
      { header: "Payment amount", value: onPayment((payment) => payment.amount) },
      { header: "Method", value: onPayment((payment) => payment.method) },
      { header: "Reference", value: onPayment((payment) => payment.reference ?? "") },
    ];

    const sheet: ReportSheet<Line> = {
      title:
        scope === "by-contract" ? "Collection by Contract" : "Collection by Tenant",
      columns:
        format === "pdf"
          ? columns.filter((column) => !PDF_OMITTED_HEADERS.has(column.header))
          : columns,
      rows: report.records.flatMap((record) => [
        { record },
        ...record.payments.map((payment) => ({ record, payment })),
      ]),
      summary: [
        ...(startDate || endDate
          ? ([
              [
                "Due between",
                `${startParam ? businessDay(startParam) : "…"} to ${endParam ? businessDay(endParam) : "…"}`,
              ],
            ] as Array<[string, string]>)
          : []),
        [scope === "by-contract" ? "Contracts" : "Tenants", report.summary.recordCount],
        ["Invoices", report.summary.invoiceCount],
        ["Total billed", report.summary.totalBilled],
        ["Total collected", report.summary.totalCollected],
        ["Total outstanding", report.summary.totalOutstanding],
        ["Total overdue", report.summary.totalOverdue],
        ["Collection rate %", report.summary.collectionRate],
        ["Fully collected", report.summary.fullyCollected],
        ["With arrears", report.summary.withArrears],
      ],
    };

    return buildReportResponse(sheet, {
      format,
      rtl: isRtlReportRequest(searchParams),
      lang: reportLanguage(searchParams),
      fileName: sheet.title,
      dateStamp: businessToday(),
    });
  } catch (error) {
    return handleApiError(error, "Failed to retrieve collection");
  }
});
