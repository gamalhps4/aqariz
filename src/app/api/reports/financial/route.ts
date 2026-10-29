/**
 * PropertyPro - Financial Reports API
 * Income & Expense Summary, Rent Roll, Collections
 *
 * `?format=xlsx|pdf|csv` returns the report as a download instead of JSON.
 * These three used to be the only reports in the product with no real export —
 * the page serialised whatever JSON it was holding to a `.json` file, which is
 * not something an owner or an accountant can open. They now go through the
 * same writer as every other report, so an Arabic PDF and a summable Excel
 * sheet come out of the same query the screen is showing.
 */

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import {
  applyScope,
  expenseScopeSql,
  invoiceScopeSql,
  leaseScope,
  paymentScopeSql,
  type ScopeActor,
} from "@/lib/db/scopes";
import { leaseRentAmount, leaseSecurityDeposit } from "@/lib/lease-money";
import { Prisma } from "@/generated/prisma/client";
import { PaymentStatus, LeaseStatus } from "@/types";
import {
  BILLED_INVOICE_STATUSES,
  COUNTED_EXPENSE_STATUSES,
} from "@/lib/reports/report-where";
import {
  allOf,
  expenseFilterConditions,
  INVOICE_COLUMNS,
  paymentFilterConditions,
  type FinancialFilters,
} from "@/lib/report-filters/financial-sql";
import { leaseFilterWhere } from "@/lib/report-filters/lease-where";
import { monthLabel } from "@/lib/report-filters/months";
import { readDayParam, readFilterIds } from "@/lib/report-filters/params";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  withPermissionAndDB,
} from "@/lib/api-utils";
import { requirePlanFeature } from "@/lib/billing/entitlements";
import { ACCOUNTING_READ_PERMISSIONS } from "@/lib/finance-permissions";
import {
  businessDay,
  businessDayStart,
  businessToday,
  endOfBusinessDay,
  startOfBusinessDay,
} from "@/lib/dates/business-day";
import { describeAppliedFilters } from "@/lib/report-filters/describe";
import { ledgerDay } from "@/lib/accounting/dates";
import { loadPostingContext, ownershipOn } from "@/lib/accounting/documents.service";
import { accountingPhase0Available } from "@/lib/invoice/phase0-columns";
import {
  officeIncome,
  type IncomePaymentRow,
  type IncomeSettlementRow,
} from "@/lib/reports/office-income";
import {
  buildReportResponse,
  canExport,
  capExportRows,
  EXPORT_ROW_LIMIT,
  EXPORT_DENIED_MESSAGE,
  isReportFormat,
  isRtlReportRequest,
  reportLanguage,
  type ReportLanguage,
  type ReportColumn,
  type ReportFormat,
  type ReportSheet,
} from "@/lib/reports/export";

// The accounting reports: Financial reports as always, or View accounting.
export const GET = withPermissionAndDB([...ACCOUNTING_READ_PERMISSIONS])(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      await requirePlanFeature(user.organizationId!, "advanced_analytics");
      const { searchParams } = request.nextUrl;
      const reportType = searchParams.get("type") || "income-expense";
      // A day names the whole of it: a window ending on the 3rd takes in the
      // 3rd. Absent means the year so far, as it always has.
      const start = readDayParam(searchParams.get("startDate"), "start");
      const end = readDayParam(searchParams.get("endDate"), "end");
      if (start === null || end === null) {
        return createErrorResponse("Invalid date range provided", 400);
      }
      const startDate =
        start ?? businessDayStart(`${businessToday().slice(0, 4)}-01-01`);
      const endDate = end ?? endOfBusinessDay();
      if (reportType !== "rent-roll" && endDate < startDate) {
        return createErrorResponse("End date must be after the start date", 400);
      }

      // The review's filters: owner, compound, building, unit, tenant,
      // contract and status. Each report reads the ones that apply to it
      // (see `filtersFor`) and every one is narrowed by the caller's scope,
      // never substituted for it.
      const named = readFilterIds(searchParams, [
        "ownerId",
        "compoundId",
        "propertyId",
        "unitId",
        "tenantId",
        "leaseId",
      ]);
      if (!named.ok) {
        return createErrorResponse(`Invalid ${named.key} filter`, 400);
      }
      const status = searchParams.get("status") || undefined;
      if (
        status &&
        !(Object.values(PaymentStatus) as string[]).includes(status)
      ) {
        return createErrorResponse(`Unknown status "${status}"`, 400);
      }
      const filters: FinancialFilters = { ...named.ids, status };

      // Absent means "render on screen"; present means "download".
      const rawFormat = searchParams.get("format");
      // Export is its own right, not a by-product of reading the report —
      // the same rule every other report's download follows.
      if (rawFormat && !canExport(user, "accounting_export", "financial_management")) {
        return createErrorResponse(EXPORT_DENIED_MESSAGE, 403);
      }
      if (rawFormat && !isReportFormat(rawFormat)) {
        return createErrorResponse(
          `Unsupported export format "${rawFormat}"`,
          400,
        );
      }
      const format = (rawFormat as ReportFormat | null) ?? null;
      const rtl = isRtlReportRequest(searchParams);
      const lang = reportLanguage(searchParams);

      switch (reportType) {
        case "income-expense":
          return await generateIncomeExpenseReport(
            user,
            startDate,
            endDate,
            filtersFor("income-expense", filters),
            { format, rtl, lang }
          );
        case "rent-roll":
          return await generateRentRollReport(
            user,
            filtersFor("rent-roll", filters),
            {
              format,
              rtl,
              lang,
            },
          );
        case "collections":
          return await generateCollectionsReport(
            user,
            startDate,
            endDate,
            filtersFor("collections", filters),
            { format, rtl, lang }
          );
        default:
          return createErrorResponse(
            "Invalid report type. Valid types: income-expense, rent-roll, collections",
            400
          );
      }
    } catch (error) {
      return handleApiError(error);
    }
  }
);

// ============================================================================
// INCOME & EXPENSE SUMMARY REPORT
// ============================================================================

/**
 * How the caller wants the report back. `format: null` is the on-screen JSON
 * the dashboard reads; anything else is a download.
 */
interface ExportOptions {
  format: ReportFormat | null;
  rtl: boolean;
  lang: ReportLanguage;
}

/**
 * The filters a report reads. A filter that does not describe what a report
 * is made of is not applied to it: an expense names no tenant and no
 * contract, and the rent roll lists contracts in force, so a status or a
 * payment's tenant says nothing about it.
 */
function filtersFor(
  report: "income-expense" | "rent-roll" | "collections",
  filters: FinancialFilters,
): FinancialFilters {
  const { ownerId, compoundId, propertyId, unitId, tenantId, leaseId, status } =
    filters;
  switch (report) {
    case "income-expense":
      return { ownerId, compoundId, propertyId };
    case "rent-roll":
      return { ownerId, compoundId, propertyId, unitId, tenantId, leaseId };
    case "collections":
      return {
        ownerId,
        compoundId,
        propertyId,
        unitId,
        tenantId,
        leaseId,
        status,
      };
  }
}

/**
 * The caller's entitlement as a condition on `payments p`.
 *
 * The income and collections reports below aggregate in SQL and were built
 * from the query string alone: whoever could open them read the whole
 * organization's money, or any one building's by naming it. This is AND-ed in
 * after the caller's own `propertyId`, as the rent roll's scope is.
 */
function paymentScopeCondition(actor: ScopeActor): Prisma.Sql | null {
  return paymentScopeSql(actor, {
    tenantId: Prisma.sql`p."tenantId"`,
    propertyId: Prisma.sql`p."propertyId"`,
  });
}

/**
 * What owners and other customers paid in the window on the office's own
 * invoices (accounting phase 0): kept on the invoice, not as payments. They
 * are on no building, so a report narrowed to buildings — by its filters or
 * by the reader's reach — leaves them out.
 */
async function customerSettlements(
  actor: ScopeActor,
  filters: FinancialFilters,
  startDate: Date,
  endDate: Date,
): Promise<IncomeSettlementRow[]> {
  if (filters.ownerId || filters.compoundId || filters.propertyId) return [];
  if (actor.isTenant || actor.isOwner || actor.scopedPropertyIds !== undefined) return [];
  if (!(await accountingPhase0Available())) return [];
  const invoices = await db.invoice.findMany({
    where: {
      tenantId: null,
      documentType: "invoice",
      customerType: { in: ["owner", "customer"] },
      amountPaid: { gt: 0 },
    },
    select: { category: true, taxAmount: true, totalAmount: true, metadata: true },
  });
  const rows: IncomeSettlementRow[] = [];
  for (const invoice of invoices) {
    const settlements = (invoice.metadata as { settlements?: unknown })?.settlements;
    if (!Array.isArray(settlements)) continue;
    for (const entry of settlements as Array<{ amount?: unknown; paidDate?: unknown }>) {
      const paidDate = new Date(String(entry.paidDate ?? ""));
      if (Number.isNaN(paidDate.getTime()) || paidDate < startDate || paidDate > endDate) continue;
      rows.push({
        category: invoice.category,
        paidDate,
        amount: Number(entry.amount) || 0,
        invoiceTax: Number(invoice.taxAmount),
        invoiceTotal: Number(invoice.totalAmount),
      });
    }
  }
  return rows;
}

async function generateIncomeExpenseReport(
  actor: ScopeActor,
  startDate: Date,
  endDate: Date,
  filters: FinancialFilters,
  exportOptions: ExportOptions
) {
  // Income is money received, counted as the payments-received register
  // counts it: paid and part-paid payments whose money arrived in the window,
  // each at what it brought in (see receivedAmount). It used to be fully
  // paid rows only, at the amount asked for — so the dashboard's revenue and
  // net income, read the register's way, could not match this report.
  const paymentConditions: Prisma.Sql[] = [
    Prisma.sql`p."deletedAt" IS NULL`,
    Prisma.sql`p.status IN (${PaymentStatus.PAID}, ${PaymentStatus.PARTIAL})`,
    Prisma.sql`p."paidDate" >= ${startDate}`,
    Prisma.sql`p."paidDate" <= ${endDate}`,
  ];

  // Approved and paid expenses — the rule every report of costs shares.
  const expenseConditions: Prisma.Sql[] = [
    Prisma.sql`e."deletedAt" IS NULL`,
    Prisma.sql`e.status IN (${Prisma.join(COUNTED_EXPENSE_STATUSES)})`,
    Prisma.sql`e.date >= ${startDate}`,
    Prisma.sql`e.date <= ${endDate}`,
  ];

  // The filters the caller asked for, then — AND-ed after them, never in
  // their place — what the caller may see.
  paymentConditions.push(...paymentFilterConditions(filters));
  expenseConditions.push(...expenseFilterConditions(filters));

  const paymentClause = paymentScopeCondition(actor);
  if (paymentClause) paymentConditions.push(paymentClause);
  // An expense with no building is office overhead, which a narrowed reader
  // does not see — the scope keys on the building.
  const expenseClause = expenseScopeSql(actor, {
    propertyId: Prisma.sql`e."propertyId"`,
  });
  if (expenseClause) expenseConditions.push(expenseClause);

  const paymentWhere = allOf(paymentConditions);
  const expenseWhere = allOf(expenseConditions);

  // Run income and expense aggregations in parallel. Income is read a
  // payment at a time: what of it is the office's — not a deposit it holds,
  // not VAT, not an owner's rent — depends on the invoice it paid, its
  // contract's tax and whose building it is on (lib/reports/office-income.ts).
  const [
    incomeRows,
    settlementRows,
    expenseByCategory,
    expenseByProperty,
    monthlyExpenses,
  ] = await Promise.all([
    db.$queryRaw<Array<Omit<IncomePaymentRow, "onOwnersBuilding">>>`
      SELECT
        p.type,
        p."propertyId",
        pr.name AS "propertyName",
        p."paidDate",
        COALESCE(NULLIF(p."amountPaid", 0), p.amount)::float AS received,
        i."taxAmount"::float AS "invoiceTax",
        i."totalAmount"::float AS "invoiceTotal",
        l."taxEnabled" AS "leaseTaxEnabled",
        l."taxRate"::float AS "leaseTaxRate"
      FROM payments p
      LEFT JOIN properties pr ON pr.id = p."propertyId"
      LEFT JOIN invoices i ON i.id = p."invoiceId"
      LEFT JOIN leases l ON l.id = p."leaseId"
      WHERE ${paymentWhere}
    `,

    customerSettlements(actor, filters, startDate, endDate),

    // Expenses grouped by category
    db.$queryRaw<Array<{ _id: string; amount: number; count: number }>>`
      SELECT
        e.category AS "_id",
        COALESCE(sum(e.amount), 0)::float AS amount,
        count(*)::int AS count
      FROM expenses e
      WHERE ${expenseWhere}
      GROUP BY e.category
      ORDER BY amount DESC
    `,

    // Expenses grouped by property
    db.$queryRaw<
      Array<{
        _id: string | null;
        propertyName: string;
        amount: number;
        count: number;
      }>
    >`
      SELECT
        e."propertyId" AS "_id",
        COALESCE(pr.name, 'Unassigned') AS "propertyName",
        COALESCE(sum(e.amount), 0)::float AS amount,
        count(*)::int AS count
      FROM expenses e
      LEFT JOIN properties pr ON pr.id = e."propertyId"
      WHERE ${expenseWhere}
      GROUP BY e."propertyId", pr.name
      ORDER BY amount DESC
    `,

    // Monthly expense trend
    db.$queryRaw<Array<{ year: number; month: number; amount: number }>>`
      SELECT
        EXTRACT(YEAR FROM e.date)::int AS year,
        EXTRACT(MONTH FROM e.date)::int AS month,
        COALESCE(sum(e.amount), 0)::float AS amount
      FROM expenses e
      WHERE ${expenseWhere}
      GROUP BY 1, 2
      ORDER BY 1, 2
    `,
  ]);

  // Whose building each payment was on, on the day it was paid, as the
  // ledger reads it: an owner's, the office's own, or one under investment.
  const ownership = await loadPostingContext(
    { cutOverDate: null, depositHolder: "owner", vatRegistered: false },
    incomeRows.map((row) => row.propertyId).filter((id): id is string => Boolean(id)),
  );
  const income = officeIncome(
    incomeRows.map((row) => ({
      ...row,
      paidDate: new Date(row.paidDate),
      onOwnersBuilding:
        Boolean(row.propertyId) &&
        ownershipOn(ownership, row.propertyId, ledgerDay(new Date(row.paidDate)))
          .ownership === "owner",
    })),
    settlementRows,
  );
  const incomeByCategory = income.byCategory;
  const incomeByProperty = income.byProperty;

  const totalIncome = income.officeIncome;
  const totalExpenses = expenseByCategory.reduce((s, r) => s + r.amount, 0);
  const netIncome = totalIncome - totalExpenses;

  // Build unified monthly trend
  const incomeMap = income.byMonth;
  const expenseMap = new Map<string, number>();
  for (const m of monthlyExpenses) {
    expenseMap.set(`${m.year}-${m.month}`, m.amount);
  }

  const monthlyTrend: Array<{
    /** The month's name in the reader's language — "Jan", "يناير". */
    month: string;
    /** 1–12, for a reader that names months itself. */
    monthNumber: number;
    year: number;
    income: number;
    expenses: number;
    net: number;
  }> = [];

  // Generate all months in range. The months the SQL grouped are UTC months
  // (EXTRACT on a timestamp), so the walk is in UTC too — in the server's own
  // zone a window opening at midnight UTC could start a month early.
  const cursor = new Date(
    Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1),
  );
  while (cursor <= endDate) {
    const monthNumber = cursor.getUTCMonth() + 1;
    const key = `${cursor.getUTCFullYear()}-${monthNumber}`;
    const income = incomeMap.get(key) || 0;
    const expenses = expenseMap.get(key) || 0;
    monthlyTrend.push({
      month: monthLabel(monthNumber, cursor.getUTCFullYear(), exportOptions.lang),
      monthNumber,
      year: cursor.getUTCFullYear(),
      income,
      expenses,
      net: income - expenses,
    });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  const profitMargin =
    totalIncome > 0 ? Math.round((netIncome / totalIncome) * 10000) / 100 : 0;

  if (exportOptions.format) {
    // The month-by-month trend is the table here: the category and property
    // breakdowns are chart material on screen, and flattening all four into
    // one sheet would produce a file nobody can read a column out of.
    const columns: ReportColumn<(typeof monthlyTrend)[number]>[] = [
      {
        header: "Month",
        // Named in the reader's language, in full, with the year after it.
        value: (row) =>
          monthLabel(row.monthNumber, row.year, exportOptions.lang, {
            withYear: true,
            style: "long",
          }),
      },
      { header: "Income", value: (row) => row.income },
      { header: "Expenses", value: (row) => row.expenses },
      { header: "Net", value: (row) => row.net },
    ];

    const sheet: ReportSheet<(typeof monthlyTrend)[number]> = {
      title: "Income & Expense Summary",
      columns,
      rows: monthlyTrend,
      filtersSummary: {
        period: { from: businessDay(startDate), to: businessDay(endDate) },
        filters: await describeAppliedFilters(actor, filters),
      },
      summary: [
        ["Total received", income.grossReceived],
        ["Deposits held", income.depositsHeld],
        ["VAT collected", income.vatCollected],
        ["Rent collected for owners", income.rentCollectedForOwners],
        ["Total income", totalIncome],
        ["Total expenses", totalExpenses],
        ["Net income", netIncome],
        ["Profit margin %", profitMargin],
      ],
    };

    return buildReportResponse(sheet, {
      format: exportOptions.format,
      rtl: exportOptions.rtl,
      lang: exportOptions.lang,
      fileName: "Income and Expense Summary",
      dateStamp: `${businessDay(startDate)}_${businessDay(endDate)}`,
    });
  }

  return createSuccessResponse(
    {
      summary: {
        totalIncome,
        totalExpenses,
        netIncome,
        profitMargin,
        // Where the money received went (lib/reports/office-income.ts):
        // income is what is left after these.
        grossReceived: income.grossReceived,
        depositsHeld: income.depositsHeld,
        vatCollected: income.vatCollected,
        rentCollectedForOwners: income.rentCollectedForOwners,
      },
      incomeByCategory,
      incomeByProperty,
      expenseByCategory,
      expenseByProperty,
      monthlyTrend,
      period: {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      },
    },
    "Income & expense report generated successfully"
  );
}

// ============================================================================
// RENT ROLL REPORT
// ============================================================================

async function generateRentRollReport(
  actor: ScopeActor,
  filters: FinancialFilters,
  exportOptions: ExportOptions
) {
  const leaseWhere: Prisma.LeaseWhereInput = {
    status: LeaseStatus.ACTIVE,
    deletedAt: null,
  };

  // The owner, compound, building, unit, tenant and contract asked for come
  // from the query string. They and the caller's scope are each AND-ed on, so
  // a narrowed employee asking for someone else's building gets nothing
  // rather than that building.
  applyScope(leaseWhere, leaseFilterWhere(filters));
  applyScope(leaseWhere, leaseScope(actor));

  const leases = await db.lease.findMany({
    where: leaseWhere,
    select: {
      id: true,
      propertyId: true,
      unitId: true,
      startDate: true,
      endDate: true,
      status: true,
      terms: true,
      property: { select: { name: true } },
      unit: { select: { unitNumber: true } },
      tenant: { select: { firstName: true, lastName: true, email: true } },
    },
  });

  const rentRoll = leases
    .map((lease) => {
      const terms = (lease.terms as any) ?? {};
      return {
        id: lease.id,
        propertyId: lease.propertyId,
        propertyName: lease.property?.name ?? "Unknown",
        unitId: lease.unitId,
        unitNumber: lease.unit?.unitNumber ?? "",
        tenantName: `${lease.tenant?.firstName ?? ""} ${
          lease.tenant?.lastName ?? ""
        }`,
        tenantEmail: lease.tenant?.email,
        startDate: lease.startDate,
        endDate: lease.endDate,
        rentAmount: leaseRentAmount(lease),
        securityDeposit: leaseSecurityDeposit(lease),
        paymentFrequency: terms?.paymentFrequency,
        status: lease.status,
      };
    })
    .sort(
      (a, b) =>
        a.propertyName.localeCompare(b.propertyName) ||
        // Unit 2 before unit 10 — by the number the office knows it by.
        a.unitNumber.localeCompare(b.unitNumber, undefined, { numeric: true })
    );

  const totals = rentRoll.reduce(
    (acc, lease) => ({
      totalUnits: acc.totalUnits + 1,
      totalMonthlyRent: acc.totalMonthlyRent + (lease.rentAmount || 0),
      totalDeposits: acc.totalDeposits + (lease.securityDeposit || 0),
    }),
    { totalUnits: 0, totalMonthlyRent: 0, totalDeposits: 0 }
  );

  if (exportOptions.format) {
    const { rows: listed, truncated } = capExportRows(rentRoll);
    const columns: ReportColumn<(typeof rentRoll)[number]>[] = [
      { header: "Property", value: (row) => row.propertyName },
      // The unit's number — an id means nothing on a printed rent roll.
      { header: "Unit", value: (row) => row.unitNumber },
      { header: "Tenant", value: (row) => row.tenantName.trim() },
      { header: "Email", value: (row) => row.tenantEmail ?? "" },
      { header: "Start", value: (row) => businessDay(row.startDate) },
      { header: "End", value: (row) => businessDay(row.endDate) },
      { header: "Frequency", value: (row) => row.paymentFrequency ?? "" },
      { header: "Rent", value: (row) => row.rentAmount },
      { header: "Deposit", value: (row) => row.securityDeposit },
      { header: "Status", value: (row) => row.status },
    ];

    const sheet: ReportSheet<(typeof rentRoll)[number]> = {
      title: "Rent Roll",
      columns,
      rows: listed,
      filtersSummary: {
        asAt: businessToday(),
        filters: await describeAppliedFilters(actor, filters),
        limit: EXPORT_ROW_LIMIT,
        truncated,
      },
      summary: [
        ["Units", totals.totalUnits],
        ["Rent per period", totals.totalMonthlyRent],
        ["Annualised rent", totals.totalMonthlyRent * 12],
        ["Deposits held", totals.totalDeposits],
      ],
    };

    return buildReportResponse(sheet, {
      format: exportOptions.format,
      rtl: exportOptions.rtl,
      lang: exportOptions.lang,
      fileName: "Rent Roll",
      dateStamp: businessToday(),
    });
  }

  return createSuccessResponse(
    {
      rentRoll,
      totals: {
        ...totals,
        annualizedRent: totals.totalMonthlyRent * 12,
      },
      generatedAt: new Date().toISOString(),
    },
    "Rent roll report generated successfully"
  );
}

// ============================================================================
// COLLECTIONS REPORT
// ============================================================================

/**
 * The page's status filter, read on installments. It offers payment
 * statuses; an installment is paid in full, part paid, awaiting payment or
 * late. Failed, cancelled and refunded describe a payment, never an
 * installment, so they match nothing.
 */
function installmentStatusCondition(
  status: string | undefined,
  pastDue: Date,
): Prisma.Sql | null {
  switch (status) {
    case undefined:
      return null;
    case PaymentStatus.PAID:
      return Prisma.sql`i."balanceRemaining" <= 0`;
    case PaymentStatus.PARTIAL:
      return Prisma.sql`i."amountPaid" > 0 AND i."balanceRemaining" > 0`;
    case PaymentStatus.PENDING:
      return Prisma.sql`i."balanceRemaining" > 0 AND i."dueDate" >= ${pastDue}`;
    case PaymentStatus.OVERDUE:
      return Prisma.sql`i."balanceRemaining" > 0 AND i."dueDate" < ${pastDue}`;
    default:
      return Prisma.sql`FALSE`;
  }
}

async function generateCollectionsReport(
  actor: ScopeActor,
  startDate: Date,
  endDate: Date,
  filters: FinancialFilters,
  exportOptions: ExportOptions
) {
  const now = new Date();
  // Installments, not payments. A payment row exists only once money comes
  // in, so totalling "due" from payments made due equal collected: 100% and
  // nothing overdue, whatever the tenants owed (the client's report). Billed
  // and collected come from the installment invoices, as on the collection
  // page (lib/services/collection.service.ts), so the two always agree.
  const pastDue = startOfBusinessDay(now);
  const invoiceClause = invoiceScopeSql(actor, {
    tenantId: Prisma.sql`i."tenantId"`,
    propertyId: Prisma.sql`i."propertyId"`,
  });
  const { status, ...entityFilters } = filters;
  const statusCondition = installmentStatusCondition(status, pastDue);

  const commonConditions: Prisma.Sql[] = [
    Prisma.sql`i."deletedAt" IS NULL`,
    Prisma.sql`i.status IN (${Prisma.join(BILLED_INVOICE_STATUSES)})`,
    // What tenants owe: an invoice to an owner or a customer is not part of
    // collection.
    Prisma.sql`i."tenantId" IS NOT NULL`,
    ...paymentFilterConditions(entityFilters, INVOICE_COLUMNS),
  ];
  if (statusCondition) commonConditions.push(statusCondition);
  if (invoiceClause) commonConditions.push(invoiceClause);

  const baseWhere = allOf([
    ...commonConditions,
    Prisma.sql`i."dueDate" >= ${startDate}`,
    Prisma.sql`i."dueDate" <= ${endDate}`,
  ]);
  // Aging is everything unpaid and past due today, whatever the period — the
  // old report's aging ignored the period the same way.
  const agingWhere = allOf([
    ...commonConditions,
    Prisma.sql`i."balanceRemaining" > 0`,
    Prisma.sql`i."dueDate" < ${pastDue}`,
  ]);

  // Aging bucket boundaries expressed as due-date cutoffs
  // (daysOverdue < N  ⇔  dueDate > now − N days).
  const dayMs = 24 * 60 * 60 * 1000;
  const cutoff30 = new Date(now.getTime() - 30 * dayMs);
  const cutoff60 = new Date(now.getTime() - 60 * dayMs);
  const cutoff90 = new Date(now.getTime() - 90 * dayMs);
  const cutoff180 = new Date(now.getTime() - 180 * dayMs);

  const [collectionsByProperty, overdueAging, collectionSummary] =
    await Promise.all([
      // Collection rates by property
      db.$queryRaw<
        Array<{
          _id: string | null;
          propertyName: string;
          totalDue: number;
          collected: number;
          collectedCount: number;
          overdueAmount: number;
          totalCount: number;
          collectionRate: number;
        }>
      >`
        SELECT
          i."propertyId" AS "_id",
          COALESCE(pr.name, 'Unassigned') AS "propertyName",
          COALESCE(sum(i."totalAmount"), 0)::float AS "totalDue",
          COALESCE(sum(i."amountPaid"), 0)::float AS collected,
          (count(*) FILTER (
            WHERE i."balanceRemaining" <= 0
          ))::int AS "collectedCount",
          COALESCE(sum(i."balanceRemaining") FILTER (
            WHERE i."balanceRemaining" > 0 AND i."dueDate" < ${pastDue}
          ), 0)::float AS "overdueAmount",
          count(*)::int AS "totalCount",
          CASE
            WHEN COALESCE(sum(i."totalAmount"), 0) > 0 THEN
              round(
                (
                  COALESCE(sum(i."amountPaid"), 0) / sum(i."totalAmount") * 100
                )::numeric,
                1
              )::float
            ELSE 0
          END AS "collectionRate"
        FROM invoices i
        LEFT JOIN properties pr ON pr.id = i."propertyId"
        WHERE ${baseWhere}
        GROUP BY i."propertyId", pr.name
        ORDER BY "collectionRate" DESC
      `,

      // Overdue aging buckets: what is still owed on each late installment
      db.$queryRaw<
        Array<{ _id: number; count: number; totalAmount: number }>
      >`
        SELECT
          bucket AS "_id",
          count(*)::int AS count,
          COALESCE(sum(amount), 0)::float AS "totalAmount"
        FROM (
          SELECT
            i."balanceRemaining" AS amount,
            CASE
              WHEN i."dueDate" > ${cutoff30} THEN 0
              WHEN i."dueDate" > ${cutoff60} THEN 30
              WHEN i."dueDate" > ${cutoff90} THEN 60
              WHEN i."dueDate" > ${cutoff180} THEN 90
              ELSE 180
            END AS bucket
          FROM invoices i
          WHERE ${agingWhere}
        ) buckets
        GROUP BY bucket
        ORDER BY bucket
      `,

      // Overall collection summary. Pending is what is still owed on
      // installments not yet late; overdue, on those that are.
      db.$queryRaw<
        Array<{
          totalDue: number;
          collected: number;
          pending: number;
          overdue: number;
          totalCount: number;
          paidCount: number;
        }>
      >`
        SELECT
          COALESCE(sum(i."totalAmount"), 0)::float AS "totalDue",
          COALESCE(sum(i."amountPaid"), 0)::float AS collected,
          COALESCE(sum(i."balanceRemaining") FILTER (
            WHERE i."balanceRemaining" > 0 AND i."dueDate" >= ${pastDue}
          ), 0)::float AS pending,
          COALESCE(sum(i."balanceRemaining") FILTER (
            WHERE i."balanceRemaining" > 0 AND i."dueDate" < ${pastDue}
          ), 0)::float AS overdue,
          count(*)::int AS "totalCount",
          (count(*) FILTER (
            WHERE i."balanceRemaining" <= 0
          ))::int AS "paidCount"
        FROM invoices i
        WHERE ${baseWhere}
      `,
    ]);

  // A SQL aggregate always returns one row; with nothing billed it is zeros.
  const summaryRow = collectionSummary[0];
  const summary =
    summaryRow && summaryRow.totalCount > 0
      ? { _id: null, ...summaryRow }
      : {
          totalDue: 0,
          collected: 0,
          pending: 0,
          overdue: 0,
          totalCount: 0,
          paidCount: 0,
        };

  // Map aging bucket boundaries to labels
  const agingLabels: Record<string, string> = {
    "0": "0-30 days",
    "30": "30-60 days",
    "60": "60-90 days",
    "90": "90-180 days",
    "180": "180+ days",
    "180+": "180+ days",
  };

  const overdueAgingFormatted = overdueAging.map((bucket) => ({
    range: agingLabels[String(bucket._id)] || `${bucket._id}+ days`,
    count: bucket.count,
    amount: bucket.totalAmount,
  }));

  const collectionRate =
    summary.totalDue > 0
      ? Math.round((summary.collected / summary.totalDue) * 10000) / 100
      : 0;

  if (exportOptions.format) {
    const { rows: listed, truncated } = capExportRows(collectionsByProperty);
    // Per building is the table: it is the breakdown an office acts on, and
    // the aging buckets ride along in the summary block above it.
    const columns: ReportColumn<(typeof collectionsByProperty)[number]>[] = [
      { header: "Property", value: (row) => row.propertyName },
      { header: "Installments", value: (row) => row.totalCount },
      { header: "Due", value: (row) => row.totalDue },
      { header: "Collected", value: (row) => row.collected },
      { header: "Paid in full", value: (row) => row.collectedCount },
      { header: "Overdue", value: (row) => row.overdueAmount },
      { header: "Collection rate %", value: (row) => row.collectionRate },
    ];

    const sheet: ReportSheet<(typeof collectionsByProperty)[number]> = {
      title: "Collections",
      columns,
      rows: listed,
      filtersSummary: {
        period: { from: businessDay(startDate), to: businessDay(endDate) },
        filters: await describeAppliedFilters(actor, filters),
        limit: EXPORT_ROW_LIMIT,
        truncated,
      },
      summary: [
        ["Total due", summary.totalDue],
        ["Collected", summary.collected],
        ["Collection rate %", collectionRate],
        ...overdueAgingFormatted.map(
          (bucket) =>
            [`Overdue ${bucket.range}`, bucket.amount] as [string, number],
        ),
      ],
    };

    return buildReportResponse(sheet, {
      format: exportOptions.format,
      rtl: exportOptions.rtl,
      lang: exportOptions.lang,
      fileName: "Collections",
      dateStamp: `${businessDay(startDate)}_${businessDay(endDate)}`,
    });
  }

  return createSuccessResponse(
    {
      summary: {
        ...summary,
        collectionRate,
      },
      collectionsByProperty,
      overdueAging: overdueAgingFormatted,
      period: {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      },
    },
    "Collections report generated successfully"
  );
}
