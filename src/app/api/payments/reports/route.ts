/**
 * PropertyPro - Payments module reports API
 *
 * Serves the reports the payments section owes:
 *   overdue-tenants · overdue · outstanding · collections ·
 *   collections-by-building · expenses-by-building
 *
 * `?format=csv` returns the same data as a download instead of JSON, so the
 * on-screen report and the exported file are produced by one query and cannot
 * disagree.
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
  getCollectionsByBuildingReport,
  getCollectionsReport,
  getExpensesByBuildingReport,
  getOutstandingReport,
  getOverdueReport,
  getOverdueTenantsReport,
  isPaymentReportType,
  type PaymentReportType,
  type ReceivableRow,
} from "@/lib/services/payment-reports.service";
import {
  receivableLines,
  type ReceivableLine,
} from "@/lib/payments/report-lines";
import {
  DEFAULT_CHARGE_FILTER,
  isChargeFilter,
  type ChargeFilter,
  type ChargeGroup,
} from "@/lib/payments/charge-category";
import type { ChargeGroupTotal } from "@/lib/services/payment-reports.service";
import type {
  CollectionRow,
  InstallmentPayment,
  PaymentReceiver,
  PaymentRegisterGroup,
} from "@/types/payment-report";
import {
  buildReportResponse,
  isReportFormat,
  isRtlReportRequest,
  reportLanguage,
  reportSection,
  type ReportColumn,
  type ReportFormat,
  type ReportSheet,
  canExport,
  EXPORT_DENIED_MESSAGE,
  EXPORT_ROW_LIMIT,
  capExportRows,
  type FilterValue,
} from "@/lib/reports/export";
import { staffName } from "@/lib/reports/filter-names";
import { describeAppliedFilters } from "@/lib/report-filters/describe";
import {
  isPaymentRegisterStatus,
  type PaymentRegisterFilters,
  type PaymentRegisterStatus,
} from "@/lib/reports/report-where";
import {
  businessDay,
  businessDayEnd,
  businessDayStart,
  businessMonthRange,
  businessToday,
  parseBusinessDay,
} from "@/lib/dates/business-day";

const REPORT_TITLES: Record<PaymentReportType, string> = {
  "overdue-tenants": "Overdue Tenants",
  overdue: "Overdue Rent Payments",
  outstanding: "Due Rent Payments",
  collections: "Payment Report",
  "collections-by-building": "Payments by Building",
  "expenses-by-building": "Expenses by Building",
};

/** Money is written unformatted so the spreadsheet keeps it numeric. */
function money(value: number): number {
  return Math.round(value * 100) / 100;
}

type Cell = string | number | null | undefined;
type Line = ReceivableLine<ReceivableRow>;

/** A cell only the installment's own row fills. */
function onInstallment(value: (row: ReceivableRow) => Cell) {
  return (line: Line): Cell => (line.payment ? null : value(line.installment));
}

/** A cell only a payment row fills. */
function onPayment(value: (payment: InstallmentPayment) => Cell) {
  return (line: Line): Cell => (line.payment ? value(line.payment) : null);
}

/**
 * The columns a payment row fills, one row per payment under the installment
 * it paid: the client asked for each payment to appear separately, with its
 * date clearly shown. The method is written as its stored code and read out
 * in the reader's language on the way out, like every other stored value.
 */
const PAYMENT_COLUMNS: ReportColumn<Line>[] = [
  {
    header: "Payment no.",
    value: onPayment((payment) => payment.paymentNumber ?? ""),
  },
  {
    header: "Payment date",
    value: onPayment((payment) => businessDay(new Date(payment.paidDate))),
  },
  { header: "Payment amount", value: onPayment((payment) => money(payment.amount)) },
  { header: "Method", value: onPayment((payment) => payment.method) },
  { header: "Reference", value: onPayment((payment) => payment.reference ?? "") },
  {
    // "Online" is translated on the way out, as in the payments export.
    header: "Recorded by",
    value: onPayment(
      (payment) => payment.recordedBy ?? (payment.online ? "Online" : ""),
    ),
  },
];

/** The last payment's own date, on the installment's row. */
const LAST_PAYMENT_COLUMN: ReportColumn<Line> = {
  header: "Last payment date",
  value: onInstallment((row) =>
    row.lastPaymentDate ? businessDay(new Date(row.lastPaymentDate)) : "",
  ),
};

/**
 * What a PDF of the arrears registers leaves out. With a payment row under
 * each installment they run to nineteen columns; a printed page holds about
 * fifteen, and past that the PDF shrinks the type and trims every column,
 * dates included — when the payment date is the one thing the client asked
 * to see clearly. The spreadsheet and the CSV keep every column.
 *
 * The tenant's phone stays: the client asked for the mobile number on these
 * registers by name, and a printed chase list is where it is needed most.
 */
const PDF_OMITTED_HEADERS: ReadonlySet<string> = new Set([
  "Discount",
  "Reference",
  "Recorded by",
]);

function columnsFor(
  format: ReportFormat,
  columns: ReportColumn<Line>[],
  installments: readonly ReceivableRow[] = [],
): ReportColumn<Line>[] {
  if (format !== "pdf") return columns;
  // A page of rent installments needs no column saying "Rent" on every row:
  // the summary names the charges. Kept when the charges differ.
  const oneCategory =
    new Set(installments.map((row) => row.category)).size <= 1;
  return columns.filter(
    (column) =>
      !PDF_OMITTED_HEADERS.has(column.header) &&
      !(oneCategory && column.header === CATEGORY_COLUMN.header),
  );
}

/**
 * What an installment is for: its category as stored ("rent",
 * "security_deposit"), read out in the reader's language on the way out. On
 * every row, payment rows included, like the contract and invoice.
 */
const CATEGORY_COLUMN: ReportColumn<Line> = {
  header: "Category",
  value: (line) => line.installment.category,
};

/**
 * The charges a register holds, as a stored-code-shaped value the export's
 * catalogue reads out ("Rent and the utilities billed with it").
 */
const CHARGES_VALUES: Record<ChargeFilter, string> = {
  rent: "charges_rent",
  deposit: "charges_deposit",
  other: "charges_other",
  all: "charges_all",
};

const GROUP_OWED_LABELS: Record<ChargeGroup, string> = {
  rent: "Rent owed",
  deposit: "Security deposits owed",
  other: "Other charges owed",
};

/**
 * The summary lines that say which charges are listed, and what is owed in
 * the others — a deposit is reported beside the rent, not mixed into it.
 * `overdue` reads each group's overdue money rather than all it owes.
 */
function chargeSummary(
  category: ChargeFilter,
  byCategory: readonly ChargeGroupTotal[],
  overdue: boolean,
): Array<[string, string | number]> {
  return [
    ["Charges", CHARGES_VALUES[category]],
    ...byCategory
      .filter((group) => category === "all" || group.group !== category)
      .map(
        (group): [string, number] => [
          GROUP_OWED_LABELS[group.group],
          money(overdue ? group.overdueBalance : group.balance),
        ],
      ),
  ];
}

/**
 * Written as stored-code-shaped values so the export's value catalogue reads
 * them out ("Office", "المكتب"). A bare "office" is a property category too.
 */
const RECEIVER_VALUES: Record<PaymentReceiver, string> = {
  office: "received_by_office",
  owner: "received_by_owner",
};

/** Lines a page of the payment report holds unless asked otherwise. */
const REGISTER_PAGE_DEFAULT = 25;
const REGISTER_PAGE_MAX = 200;

/** A stored code: lower-case words joined by underscores ("bank_transfer"). */
const CODE = /^[a-z][a-z0-9_]{0,39}$/;

/**
 * The payment report's own filters, read and checked. Ids are passed on as
 * given — the where AND-s them with the reader's scope, so an id outside it
 * matches nothing.
 */
function parseRegisterFilters(
  searchParams: URLSearchParams,
):
  | { filters: Omit<PaymentRegisterFilters, "propertyId" | "ownerId" | "tenantId"> }
  | { error: string } {
  const read = (name: string) => searchParams.get(name)?.trim() || undefined;
  const method = read("method");
  if (method && !CODE.test(method)) return { error: `Unknown payment method "${method}"` };
  const paymentType = read("paymentType");
  if (paymentType && !CODE.test(paymentType)) {
    return { error: `Unknown payment type "${paymentType}"` };
  }
  const receiver = read("receiver");
  if (receiver && receiver !== "office" && receiver !== "owner") {
    return { error: `Unknown receiver "${receiver}"` };
  }
  const status = read("status");
  if (status && !isPaymentRegisterStatus(status)) {
    return { error: `Unknown payment status "${status}"` };
  }
  return {
    filters: {
      compoundId: read("compoundId"),
      unitId: read("unitId"),
      leaseId: read("leaseId"),
      method,
      receiver: receiver as PaymentRegisterFilters["receiver"],
      paymentType,
      recordedBy: read("recordedBy"),
      status: status as PaymentRegisterStatus | undefined,
    },
  };
}

/** One line of the payment report, as the spreadsheet and the PDF print it. */
const REGISTER_COLUMNS: ReportColumn<CollectionRow>[] = [
  { header: "Payment no.", value: (row) => row.paymentNumber ?? "" },
  // Days on the office's calendar, as the period and the months read them.
  { header: "Date", value: (row) => businessDay(row.paidDate) },
  // "receipt" / "refund", read out in the reader's language.
  { header: "Line", value: (row) => (row.lineType === "refund" ? "register_refund" : "register_receipt") },
  { header: "Tenant", value: (row) => row.tenantName },
  { header: "Mobile", value: (row) => row.tenantPhone },
  { header: "Building", value: (row) => row.propertyName },
  { header: "Unit", value: (row) => row.unitNumber },
  { header: "Contract no.", value: (row) => row.contractNumber },
  // The installment it paid, and when that installment was due.
  { header: "Installment", value: (row) => row.invoiceNumber },
  {
    header: "Installment due date",
    value: (row) => businessDay(row.installmentDueDate),
  },
  { header: "Type", value: (row) => row.type },
  { header: "Method", value: (row) => row.method },
  { header: "Received by", value: (row) => RECEIVER_VALUES[row.receiver] },
  { header: "Reference", value: (row) => row.reference ?? "" },
  {
    // "Online" is translated on the way out, as in the payments export.
    header: "Recorded by",
    value: (row) => row.recordedBy ?? (row.online ? "Online" : ""),
  },
  { header: "Status", value: (row) => row.status },
  { header: "Amount", value: (row) => money(row.amount) },
  { header: "Notes", value: (row) => row.notes },
];

/** The columns of one breakdown table: what it is grouped by, then the money. */
function groupColumns(
  header: string,
  label: (group: PaymentRegisterGroup) => string = (group) => group.key,
): ReportColumn<PaymentRegisterGroup>[] {
  return [
    { header, value: label },
    { header: "Payments", value: (group) => group.count },
    { header: "Received", value: (group) => money(group.received) },
    { header: "Refunded", value: (group) => money(-group.refunded) },
    { header: "Net", value: (group) => money(group.net) },
  ];
}

/**
 * Every filter the download was made under, by name — what a reader of the
 * file needs to know it is not the whole portfolio. The owner, compound,
 * building, unit, tenant and contract are named through the reader's own
 * scope (describeAppliedFilters), the rest by their stored codes, which the
 * export reads out in the reader's language.
 */
async function registerFilterLines(
  user: AuthenticatedAccessUser,
  filters: PaymentRegisterFilters,
): Promise<Array<[string, FilterValue]>> {
  const [named, recorder] = await Promise.all([
    describeAppliedFilters(user, {
      ownerId: filters.ownerId,
      compoundId: filters.compoundId,
      propertyId: filters.propertyId,
      unitId: filters.unitId,
      tenantId: filters.tenantId,
      leaseId: filters.leaseId,
      status: filters.status,
    }),
    filters.recordedBy && filters.recordedBy !== "online"
      ? staffName(filters.recordedBy)
      : null,
  ]);
  return [
    ...named,
    ["Method", filters.method],
    ["Received by", filters.receiver ? RECEIVER_VALUES[filters.receiver] : undefined],
    ["Type", filters.paymentType],
    [
      "Recorded by",
      filters.recordedBy === "online" ? "Online" : recorder || undefined,
    ],
  ];
}

export const GET = withPermissionAndDB([
  "financial_reports",
  "financial_management",
])(async (user: AuthenticatedAccessUser, request: NextRequest) => {
  try {
    const { searchParams } = request.nextUrl;

    const type = searchParams.get("type") ?? "overdue";
    if (!isPaymentReportType(type)) {
      return createErrorResponse(`Unknown report type "${type}"`, 400);
    }

    // Absent means "render on screen"; present means "download".
    const rawFormat = searchParams.get("format");
    // Export is its own permission, not a by-product of being able to
    // read the list — see canExport.
    if (rawFormat && !canExport(user, "payment_export", "financial_management")) {
      return createErrorResponse(EXPORT_DENIED_MESSAGE, 403);
    }
    if (rawFormat && !isReportFormat(rawFormat)) {
      return createErrorResponse(
        `Unsupported export format "${rawFormat}"`,
        400,
      );
    }
    const format: ReportFormat | null = rawFormat
      ? (rawFormat as ReportFormat)
      : null;

    // The overdue registers are read "as at" one date — `endDate` — and have
    // no start. The page hid the start date for them but still sent the
    // first of the month, so every "as at" before it was refused as a range
    // ending before it began. For them a start date is not read at all.
    const pointInTime = type === "overdue" || type === "overdue-tenants";

    // Default window: the current month to date. Every other report accepts
    // one, so switching report type keeps the period the operator chose.
    // The days are the office's (Riyadh), and each end is the whole day: the
    // window opens at the start of the first and closes at the last instant of
    // the last, so "to 31 March" takes in everything collected that day.
    const monthStart = businessMonthRange(businessToday()).from;
    const startParam = searchParams.get("startDate");
    const endParam = searchParams.get("endDate");
    const startDay = startParam ? parseBusinessDay(startParam) : monthStart;
    const endDay = endParam ? parseBusinessDay(endParam) : businessToday();

    if ((!pointInTime && !startDay) || !endDay) {
      return createErrorResponse("Invalid date range provided", 400);
    }
    if (!pointInTime && startDay && endDay < startDay) {
      return createErrorResponse("End date must be after the start date", 400);
    }
    const startDate = businessDayStart(startDay ?? monthStart);
    const endDate = businessDayEnd(endDay);

    // Which charges the three rent registers list: rent — with the utilities
    // billed on it — unless another group is asked for. See
    // lib/payments/charge-category.
    const categoryParam = searchParams.get("category");
    if (categoryParam && !isChargeFilter(categoryParam)) {
      return createErrorResponse(`Unknown category "${categoryParam}"`, 400);
    }
    const category: ChargeFilter =
      categoryParam && isChargeFilter(categoryParam)
        ? categoryParam
        : DEFAULT_CHARGE_FILTER;

    const propertyId = searchParams.get("propertyId") || undefined;
    // The office manages for several owners, so every money report can be
    // narrowed to one of them — which is what an owner statement conversation
    // actually starts from.
    const ownerId = searchParams.get("ownerId") || undefined;
    // "Allow selecting a specific tenant" — asked of the due-rent register
    // and of the overdue tenants report by name, and useful on every one.
    const tenantId = searchParams.get("tenantId") || undefined;
    const period = pointInTime
      ? businessDay(endDate)
      : `${businessDay(startDate)}_${businessDay(endDate)}`;

    switch (type) {
      case "overdue-tenants": {
        // "As at" the date asked about, like the overdue register it folds.
        const report = await getOverdueTenantsReport({
          propertyId,
          ownerId,
          tenantId,
          category,
          now: endDate,
          actor: user,
        });

        if (format) {
          // One row per overdue installment, grouped by tenant in the
          // screen's order, each followed by the payments made on it.
          const installments = report.rows.flatMap((tenant) => tenant.installments);
          const sheet: ReportSheet<Line> = {
            title: REPORT_TITLES[type],
            columns: columnsFor(format, [
              { header: "Tenant", value: (line) => line.installment.tenantName },
              { header: "Phone", value: onInstallment((row) => row.tenantPhone) },
              {
                header: "Contract no.",
                value: (line) => line.installment.contractNumber,
              },
              { header: "Invoice", value: (line) => line.installment.invoiceNumber },
              CATEGORY_COLUMN,
              { header: "Property", value: onInstallment((row) => row.propertyName) },
              { header: "Unit", value: onInstallment((row) => row.unitNumber) },
              {
                header: "Due date",
                value: onInstallment((row) => businessDay(new Date(row.dueDate))),
              },
              { header: "Days overdue", value: onInstallment((row) => row.daysOverdue) },
              {
                header: "Installment fee",
                value: onInstallment((row) => money(row.totalAmount)),
              },
              { header: "Paid", value: onInstallment((row) => money(row.amountPaid)) },
              {
                header: "Overdue amount",
                value: onInstallment((row) => money(row.balance)),
              },
              LAST_PAYMENT_COLUMN,
              ...PAYMENT_COLUMNS,
            ], installments),
            rows: receivableLines(installments),
            summary: [
              ["As at", businessDay(endDate)],
              ...chargeSummary(
                report.summary.category,
                report.summary.byCategory,
                true,
              ),
              ["Tenants", report.summary.tenantCount],
              ["Installments", report.summary.installmentCount],
              ["Total overdue", money(report.summary.totalOverdue)],
              ["90+ days", money(report.summary.over90)],
            ],
          };
          return buildReportResponse(sheet, {
            format,
            rtl: isRtlReportRequest(searchParams),
            lang: reportLanguage(searchParams),
            fileName: REPORT_TITLES[type],
            dateStamp: businessDay(endDate),
          });
        }

        return createSuccessResponse(report, "Report generated successfully");
      }

      case "overdue":
      case "outstanding": {
        // Overdue is "as at" the date asked about. Due rent is a window on
        // the due date, read against today: rent due next week in the window
        // is due, not overdue, however far ahead the window's end is — which
        // is how the review asks the two to be told apart.
        const report =
          type === "overdue"
            ? await getOverdueReport({
                propertyId,
                ownerId,
                tenantId,
                category,
                now: endDate,
                actor: user,
              })
            : await getOutstandingReport({
                propertyId,
                ownerId,
                tenantId,
                category,
                dueFrom: startDate,
                dueTo: endDate,
                actor: user,
              });

        if (format) {
          // Column order follows the reference report the scope supplies:
          // contract first, then who and where, then the money, then how late.
          // Then when it was last paid, and a row for each payment under it.
          const columns: ReportColumn<Line>[] = [
            {
              header: "Contract no.",
              value: (line) => line.installment.contractNumber,
            },
            { header: "Invoice", value: (line) => line.installment.invoiceNumber },
            CATEGORY_COLUMN,
            { header: "Property", value: onInstallment((row) => row.propertyName) },
            { header: "Unit", value: onInstallment((row) => row.unitNumber) },
            { header: "Tenant", value: (line) => line.installment.tenantName },
            { header: "Phone", value: onInstallment((row) => row.tenantPhone) },
            {
              header: "Installment fee",
              value: onInstallment((row) => money(row.totalAmount)),
            },
            { header: "Paid", value: onInstallment((row) => money(row.amountPaid)) },
            {
              header: "Discount",
              value: onInstallment((row) => money(row.discountAmount)),
            },
            { header: "Balance", value: onInstallment((row) => money(row.balance)) },
            {
              header: "Due date",
              value: onInstallment((row) => businessDay(new Date(row.dueDate))),
            },
            { header: "Days", value: onInstallment((row) => row.daysOverdue) },
            {
              header: "Status",
              value: onInstallment((row) =>
                row.state === "overdue" ? "Overdue" : "Due",
              ),
            },
            LAST_PAYMENT_COLUMN,
            ...PAYMENT_COLUMNS,
          ];

          const sheet: ReportSheet<Line> = {
            title: REPORT_TITLES[type],
            columns: columnsFor(format, columns, report.rows),
            rows: receivableLines(report.rows),
            summary: [
              type === "overdue"
                ? ["As at", businessDay(endDate)]
                : ["Due between", `${businessDay(startDate)} to ${businessDay(endDate)}`],
              ...chargeSummary(
                report.summary.category,
                report.summary.byCategory,
                type === "overdue",
              ),
              ["Invoices", report.summary.invoiceCount],
              ["Tenants", report.summary.tenantCount],
              ["Total invoiced", money(report.summary.totalBilled)],
              ["Total paid", money(report.summary.totalPaid)],
              ["Total balance", money(report.summary.totalBalance)],
              ["Overdue balance", money(report.summary.overdueBalance)],
              ["Not yet due", money(report.summary.aging.current)],
              ["1-30 days", money(report.summary.aging.days1to30)],
              ["31-60 days", money(report.summary.aging.days31to60)],
              ["61-90 days", money(report.summary.aging.days61to90)],
              ["90+ days", money(report.summary.aging.days90plus)],
            ],
          };

          return buildReportResponse(sheet, {
            format,
            rtl: isRtlReportRequest(searchParams),
            lang: reportLanguage(searchParams),
            fileName: REPORT_TITLES[type],
            dateStamp: businessDay(endDate),
          });
        }

        return createSuccessResponse(report, "Report generated successfully");
      }

      case "collections": {
        const parsed = parseRegisterFilters(searchParams);
        if ("error" in parsed) {
          return createErrorResponse(parsed.error, 400);
        }
        const page = Math.max(1, Number.parseInt(searchParams.get("page") ?? "1", 10) || 1);
        const limit = Math.min(
          REGISTER_PAGE_MAX,
          Math.max(1, Number.parseInt(searchParams.get("limit") ?? "", 10) || REGISTER_PAGE_DEFAULT),
        );
        // The period's days on the office's calendar (Riyadh), as its month
        // breakdown reads them, whatever zone the server runs in. Absent,
        // this month to date.
        const fromDay =
          parseBusinessDay(startParam) ?? businessMonthRange(businessToday()).from;
        const toDay = parseBusinessDay(endParam) ?? businessToday();
        if (toDay < fromDay) {
          return createErrorResponse("End date must be after the start date", 400);
        }
        const report = await getCollectionsReport({
          startDate: businessDayStart(fromDay),
          endDate: businessDayEnd(toDay),
          propertyId,
          ownerId,
          tenantId,
          ...parsed.filters,
          // A download carries every line; the screen reads a page at a time.
          ...(format ? {} : { page, limit }),
          actor: user,
        });

        if (format) {
          const { rows, truncated } = capExportRows(report.rows);
          const { summary } = report;
          const sheet: ReportSheet<CollectionRow> = {
            title: REPORT_TITLES[type],
            columns: REGISTER_COLUMNS,
            rows,
            // The block under the title: how many lines, the period, and
            // every filter by name — and a note if the limit cut the list.
            filtersSummary: {
              period: { from: fromDay, to: toDay },
              filters: await registerFilterLines(user, {
                propertyId,
                ownerId,
                tenantId,
                ...parsed.filters,
              }),
              rows: rows.length,
              limit: EXPORT_ROW_LIMIT,
              truncated,
            },
            // Over every line the filters match, not only those written.
            summary: [
              ["Payments", summary.paymentCount],
              ["Total received", money(summary.totalReceived)],
              ["Refunds", summary.refundCount],
              ["Total refunded", money(-summary.totalRefunded)],
              ["Net collected", money(summary.totalCollected)],
            ],
            document: {
              summaryTitle: "Summary",
              tableTitle: "Payments and refunds",
              emptyText: "No payments in this period",
              sections: [
                reportSection("By payment method", groupColumns("Method"), summary.byMethod),
                reportSection(
                  "By who received the money",
                  groupColumns("Received by", (group) =>
                    RECEIVER_VALUES[group.key as PaymentReceiver] ?? group.key,
                  ),
                  summary.byReceiver,
                ),
                reportSection("By month", groupColumns("Month"), summary.byMonth),
                reportSection(
                  "By building",
                  groupColumns("Building", (group) => group.label),
                  summary.byBuilding,
                ),
                reportSection(
                  "By tenant",
                  groupColumns("Tenant", (group) => group.label),
                  summary.byTenant,
                ),
                reportSection("By payment type", groupColumns("Type"), summary.byType),
              ],
            },
          };

          return buildReportResponse(sheet, {
            format,
            rtl: isRtlReportRequest(searchParams),
            lang: reportLanguage(searchParams),
            fileName: REPORT_TITLES[type],
            dateStamp: `${fromDay}_${toDay}`,
          });
        }

        return createSuccessResponse(report, "Report generated successfully");
      }

      case "collections-by-building": {
        const report = await getCollectionsByBuildingReport({
          startDate,
          endDate,
          propertyId,
          ownerId,
          actor: user,
        });

        if (format) {
          const sheet: ReportSheet<(typeof report.rows)[number]> = {
            title: REPORT_TITLES[type],
            columns: [
              { header: "Building", value: (row) => row.propertyName },
              { header: "City", value: (row) => row.city },
              { header: "Payments", value: (row) => row.paymentCount },
              { header: "Collected", value: (row) => money(row.collected) },
              { header: "Outstanding", value: (row) => money(row.outstanding) },
            ],
            rows: report.rows,
            summary: [
              ["Period", `${businessDay(startDate)} to ${businessDay(endDate)}`],
              ["Buildings", report.summary.buildingCount],
              ["Total collected", money(report.summary.totalCollected)],
              ["Total outstanding", money(report.summary.totalOutstanding)],
            ],
          };

          return buildReportResponse(sheet, {
            format,
            rtl: isRtlReportRequest(searchParams),
            lang: reportLanguage(searchParams),
            fileName: REPORT_TITLES[type],
            dateStamp: period,
          });
        }

        return createSuccessResponse(report, "Report generated successfully");
      }

      case "expenses-by-building": {
        const report = await getExpensesByBuildingReport({
          startDate,
          endDate,
          propertyId,
          ownerId,
          actor: user,
        });

        if (format) {
          const sheet: ReportSheet<(typeof report.rows)[number]> = {
            title: REPORT_TITLES[type],
            columns: [
              { header: "Building", value: (row) => row.propertyName },
              { header: "City", value: (row) => row.city },
              { header: "Expenses", value: (row) => row.expenseCount },
              { header: "Top category", value: (row) => row.topCategory },
              { header: "Total", value: (row) => money(row.total) },
            ],
            rows: report.rows,
            summary: [
              ["Period", `${businessDay(startDate)} to ${businessDay(endDate)}`],
              ["Buildings", report.summary.buildingCount],
              ["Expense entries", report.summary.expenseCount],
              ["Total expenses", money(report.summary.totalExpenses)],
              ["Not assigned to a building", money(report.summary.unassignedTotal)],
              ...report.summary.byCategory.map(
                (entry) =>
                  [`  ${entry.category}`, money(entry.amount)] as [
                    string,
                    number,
                  ],
              ),
            ],
          };

          return buildReportResponse(sheet, {
            format,
            rtl: isRtlReportRequest(searchParams),
            lang: reportLanguage(searchParams),
            fileName: REPORT_TITLES[type],
            dateStamp: period,
          });
        }

        return createSuccessResponse(report, "Report generated successfully");
      }
    }
  } catch (error) {
    return handleApiError(error, "Failed to generate report");
  }
});
