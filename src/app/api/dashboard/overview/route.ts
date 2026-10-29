/**
 * PropertyPro - Portfolio Dashboard Overview API
 * Aggregates cross-domain metrics for the manager/owner dashboard
 *
 * Every indicator that opens a report is counted by that report's own rule —
 * the same where-builder or the same service — over the same days the link
 * opens it on, so a card and the rows behind it cannot disagree. They did:
 * "overdue" and "due" were payment rows (full amounts, a five-day grace,
 * stored statuses, cancelled and refunded rows included) while the reports
 * read installment balances by due date; "occupied" was a count of active
 * contracts; expenses excluded the office's own costs and counted pending
 * ones, unlike either report the card could open.
 */

import {
  createSuccessResponse,
  handleApiError,
  withPermissionAndDB,
  type AuthenticatedAccessUser,
} from "@/lib/api-utils";
import {
  expenseScope,
  expenseScopeSql,
  invoiceScope,
  leaseScope,
  maintenanceScope,
  maintenanceScopeSql,
  paymentScope,
  paymentScopeSql,
  propertyScope,
  tenantRecordScope,
  TENANT_PROPERTY_LEASE_STATUSES,
  withScope,
} from "@/lib/db/scopes";
import {
  buildingExpensesWhere,
  collectionInvoicesWhere,
  collectionsWhere,
  COUNTED_EXPENSE_STATUSES,
  leaseReportWhere,
} from "@/lib/reports/report-where";
import { receivedAmount } from "@/lib/payments/report-lines";
import { getReceivablesTotals } from "@/lib/services/payment-reports.service";
import { getOccupancyCounts } from "@/lib/services/occupancy-report.service";
import { countLeaseRegister } from "@/lib/services/lease-reports.service";
import { Prisma } from "@/generated/prisma/client";
import {
  UserRole,
  MaintenanceStatus,
  MaintenancePriority,
  PaymentStatus,
  EventStatus,
  EventPriority,
  EventType,
} from "@/types";
import { db } from "@/lib/db/prisma";
import {
  DashboardAlertSeverity,
  DashboardAlertType,
  DashboardOverviewResponse,
} from "@/types/dashboard";
import {
  BUSINESS_TIME_ZONE,
  addBusinessDays,
  addBusinessMonths,
  businessDayEnd,
  businessDayStart,
  businessMonthRange,
  businessToday,
  dateOnly,
  endOfBusinessDay,
  trailingDays,
} from "@/lib/dates/business-day";

const ALERT_COLOR_MAP = ["#0ea5e9", "#22c55e", "#f97316", "#ef4444", "#8b5cf6"];

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

// A day is a calendar day, not an instant: it is written from its UTC fields
// (`dateOnly`), so the label does not move with the server's zone.
const DAY_LABEL_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

const padNumber = (value: number) => String(value).padStart(2, "0");

const buildMonthKey = (year: number, month: number) =>
  `${year}-${padNumber(month)}`;

const buildDayKey = (year: number, month: number, day: number) =>
  `${year}-${padNumber(month)}-${padNumber(day)}`;

interface MonthRevenueBucket {
  year: number;
  month: number;
  total: number;
}

interface DayRevenueBucket extends MonthRevenueBucket {
  day: number;
}

interface MonthCostBucket {
  year: number;
  month: number;
  cost: number;
  count: number;
}

interface DayCostBucket extends MonthCostBucket {
  day: number;
}

/**
 * A scope as a SQL clause for the aggregates below, which read their tables
 * unaliased. `TRUE` for a caller who is not narrowed, so each query can AND
 * it on unconditionally.
 */
function paymentClause(user: AuthenticatedAccessUser): Prisma.Sql {
  return (
    paymentScopeSql(user, {
      tenantId: Prisma.sql`"tenantId"`,
      propertyId: Prisma.sql`"propertyId"`,
    }) ?? Prisma.sql`TRUE`
  );
}

function expenseClause(user: AuthenticatedAccessUser): Prisma.Sql {
  return (
    expenseScopeSql(user, { propertyId: Prisma.sql`"propertyId"` }) ??
    Prisma.sql`TRUE`
  );
}

/**
 * A payment's or a request's instant as the Riyadh calendar day it happened
 * on, for the charts below to group by. Their columns hold UTC; read as they
 * are, a payment taken at 01:30 on the 1st fell in the previous month's bar.
 */
const riyadhTime = (column: Prisma.Sql) =>
  Prisma.sql`(${column} AT TIME ZONE 'UTC') AT TIME ZONE ${BUSINESS_TIME_ZONE}`;

const paidAt = riyadhTime(Prisma.sql`"paidDate"`);
const requestedAt = riyadhTime(Prisma.sql`"createdAt"`);

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function maintenanceClause(user: AuthenticatedAccessUser): Prisma.Sql {
  return (
    maintenanceScopeSql(user, {
      tenantId: Prisma.sql`"tenantId"`,
      propertyId: Prisma.sql`"propertyId"`,
    }) ?? Prisma.sql`TRUE`
  );
}

/**
 * Money received, as the payments-received register counts it: paid and
 * part-paid payments by the day the money arrived, each at what it brought
 * in (see receivedAmount). The series used to add up only fully paid rows,
 * at the amount asked for, by a due date when no paid date was set.
 */
const RECEIVED = Prisma.sql`COALESCE(sum(COALESCE(NULLIF("amountPaid", 0), amount)), 0)::float`;

/** Money received, bucketed by month of the day it arrived. */
function revenueByMonthSeries(from: Date, to: Date, scope: Prisma.Sql) {
  return db.$queryRaw<MonthRevenueBucket[]>`
    SELECT
      EXTRACT(YEAR FROM ${paidAt})::int AS year,
      EXTRACT(MONTH FROM ${paidAt})::int AS month,
      ${RECEIVED} AS total
    FROM payments
    WHERE "deletedAt" IS NULL
      AND status IN (${PaymentStatus.PAID}, ${PaymentStatus.PARTIAL})
      AND "paidDate" >= ${from}
      AND "paidDate" <= ${to}
      AND ${scope}
    GROUP BY 1, 2
    ORDER BY 1, 2
  `;
}

/** Money received, bucketed by the day it arrived. */
function revenueByDaySeries(from: Date, to: Date, scope: Prisma.Sql) {
  return db.$queryRaw<DayRevenueBucket[]>`
    SELECT
      EXTRACT(YEAR FROM ${paidAt})::int AS year,
      EXTRACT(MONTH FROM ${paidAt})::int AS month,
      EXTRACT(DAY FROM ${paidAt})::int AS day,
      ${RECEIVED} AS total
    FROM payments
    WHERE "deletedAt" IS NULL
      AND status IN (${PaymentStatus.PAID}, ${PaymentStatus.PARTIAL})
      AND "paidDate" >= ${from}
      AND "paidDate" <= ${to}
      AND ${scope}
    GROUP BY 1, 2, 3
    ORDER BY 1, 2, 3
  `;
}

/**
 * Expenses as the expense reports count them — approved or paid, by the
 * expense's date (see COUNTED_EXPENSE_STATUSES) — bucketed by month. The
 * chart's "expenses" used to be maintenance requests' estimated costs, a
 * different figure from the expenses card beside it.
 */
function expensesByMonthSeries(from: Date, to: Date, scope: Prisma.Sql) {
  return db.$queryRaw<Array<{ year: number; month: number; cost: number }>>`
    SELECT
      EXTRACT(YEAR FROM date)::int AS year,
      EXTRACT(MONTH FROM date)::int AS month,
      COALESCE(sum(amount), 0)::float AS cost
    FROM expenses
    WHERE "deletedAt" IS NULL
      AND status IN (${Prisma.join(COUNTED_EXPENSE_STATUSES)})
      AND date >= ${from}
      AND date <= ${to}
      AND ${scope}
    GROUP BY 1, 2
    ORDER BY 1, 2
  `;
}

/** The same expenses, bucketed by day. */
function expensesByDaySeries(from: Date, to: Date, scope: Prisma.Sql) {
  return db.$queryRaw<
    Array<{ year: number; month: number; day: number; cost: number }>
  >`
    SELECT
      EXTRACT(YEAR FROM date)::int AS year,
      EXTRACT(MONTH FROM date)::int AS month,
      EXTRACT(DAY FROM date)::int AS day,
      COALESCE(sum(amount), 0)::float AS cost
    FROM expenses
    WHERE "deletedAt" IS NULL
      AND status IN (${Prisma.join(COUNTED_EXPENSE_STATUSES)})
      AND date >= ${from}
      AND date <= ${to}
      AND ${scope}
    GROUP BY 1, 2, 3
    ORDER BY 1, 2, 3
  `;
}

/** Maintenance cost (actual ?? estimated) + request count bucketed by month. */
function maintenanceCostsByMonthSeries(
  from: Date,
  to: Date,
  scope: Prisma.Sql,
) {
  return db.$queryRaw<MonthCostBucket[]>`
    SELECT
      EXTRACT(YEAR FROM ${requestedAt})::int AS year,
      EXTRACT(MONTH FROM ${requestedAt})::int AS month,
      COALESCE(sum(COALESCE("actualCost", "estimatedCost", 0)), 0)::float AS cost,
      count(*)::int AS count
    FROM maintenance_requests
    WHERE "deletedAt" IS NULL
      AND "createdAt" >= ${from}
      AND "createdAt" <= ${to}
      AND ${scope}
    GROUP BY 1, 2
    ORDER BY 1, 2
  `;
}

/** Maintenance cost (actual ?? estimated) + request count bucketed by day. */
function maintenanceCostsByDaySeries(
  from: Date,
  to: Date,
  scope: Prisma.Sql,
) {
  return db.$queryRaw<DayCostBucket[]>`
    SELECT
      EXTRACT(YEAR FROM ${requestedAt})::int AS year,
      EXTRACT(MONTH FROM ${requestedAt})::int AS month,
      EXTRACT(DAY FROM ${requestedAt})::int AS day,
      COALESCE(sum(COALESCE("actualCost", "estimatedCost", 0)), 0)::float AS cost,
      count(*)::int AS count
    FROM maintenance_requests
    WHERE "deletedAt" IS NULL
      AND "createdAt" >= ${from}
      AND "createdAt" <= ${to}
      AND ${scope}
    GROUP BY 1, 2, 3
    ORDER BY 1, 2, 3
  `;
}

export const GET = withPermissionAndDB("profile_management")(
  async (user: AuthenticatedAccessUser) => {
    try {
      const now = new Date();
      // Every window is cut on Riyadh's calendar, not the server's: between
      // midnight and 03:00 in Riyadh the server is still on the day before,
      // and the cards counted a day (or, on the 1st, a month) short.
      const today = businessToday(now);
      const month = businessMonthRange(today);
      const thisYear = Number(today.slice(0, 4));
      const twelveMonthsAgo = businessDayStart(
        addBusinessMonths(month.from, -11),
      );
      const lastYear = thisYear - 1;
      const startOfLastYear = businessDayStart(`${lastYear}-01-01`);
      const endOfLastYear = businessDayEnd(`${lastYear}-12-31`);
      const thirtyDaysAgoDay = trailingDays(30, today).from;
      const thirtyDaysAgo = businessDayStart(thirtyDaysAgoDay);

      // The days the money cards cover, written as a link to their report
      // writes them and read back the way that report reads them: revenue
      // and expenses from the first of the month to today, overdue as at
      // today, due from today to the end of the month.
      const todayIso = today;
      const monthStartIso = month.from;
      const monthEndIso = month.to;
      const monthFrom = businessDayStart(monthStartIso);
      const todayEnd = businessDayEnd(todayIso);

      // A caller who holds only part of the portfolio gets a dashboard about
      // that part: an owner their buildings, a restricted employee the ones
      // assigned to them. Built once and spread into each query below — every
      // `where` in this handler is a literal naming no propertyId of its own,
      // so there is nothing for these to collide with.
      const propertyWhere = propertyScope(user);
      const leaseWhere = leaseScope(user);
      const paymentWhere = paymentScope(user);
      const maintenanceWhere = maintenanceScope(user);
      // The same two rules for the aggregates written in SQL. Those carried
      // no scope at all: the money and maintenance totals on this page were
      // the whole organization's, beside building counts that were the
      // caller's own — and this endpoint is open to every signed-in user.
      const paymentSql = paymentClause(user);
      const maintenanceSql = maintenanceClause(user);

      // -----------------------------------------------------------------------
      // Core portfolio information (properties, units, rent distribution)
      // -----------------------------------------------------------------------
      const properties = await db.property.findMany({
        where: { deletedAt: null, ...propertyWhere },
        select: {
          id: true,
          type: true,
          totalUnits: true,
          isMultiUnit: true,
          units: {
            // A tenant reaches the building through a lease, not every unit
            // in it: their own units only, as on the building's own page,
            // so the neighbours' rents stay out of the averages.
            where: user.isTenant
              ? {
                  deletedAt: null,
                  leases: {
                    some: {
                      tenantId: user.id,
                      status: { in: [...TENANT_PROPERTY_LEASE_STATUSES] },
                      deletedAt: null,
                    },
                  },
                }
              : { deletedAt: null },
            select: { rentAmount: true },
          },
        },
      });

      const totalProperties = properties.length;

      let totalRent = 0;
      let rentSampleCount = 0;

      const propertyTypeCounts: Record<string, number> = {};

      for (const property of properties) {
        propertyTypeCounts[property?.type ?? "unknown"] =
          (propertyTypeCounts[property?.type ?? "unknown"] || 0) + 1;

        if (property?.isMultiUnit && property?.units?.length) {
          for (const unit of property.units) {
            if (
              typeof unit?.rentAmount === "number" &&
              (unit?.rentAmount ?? 0) > 0
            ) {
              totalRent += unit.rentAmount;
              rentSampleCount += 1;
            }
          }
        }
        // Note: rentAmount is now only stored in units, no fallback to property-level
      }

      const averageRent = rentSampleCount > 0 ? totalRent / rentSampleCount : 0;

      // -----------------------------------------------------------------------
      // Lease and tenant metrics
      // -----------------------------------------------------------------------
      // Units, occupied and vacant: the occupancy report's own counts for
      // today. Active contracts and those nearing expiry: the registers the
      // cards open, with their default windows — contracts still within
      // their term, and those ending in the next thirty days.
      const [
        occupancy,
        activeLeasesCount,
        expiringLeasesCount,
        tenantStatusBuckets,
      ] = await Promise.all([
        getOccupancyCounts({ actor: user }),
        countLeaseRegister("active", { actor: user, now }),
        countLeaseRegister("expiring-soon", { actor: user, now }),
        db.user.groupBy({
          by: ["tenantStatus"],
          // The tenants this caller may see, not every tenant of the office.
          where: withScope(
            { role: UserRole.TENANT, deletedAt: null },
            tenantRecordScope(user),
          ),
          _count: { _all: true },
        }),
      ]);

      const totalUnits = occupancy.totalUnits;
      const occupiedUnits = occupancy.leasedUnits;

      const tenantStatusMap = tenantStatusBuckets.reduce<
        Record<string, number>
      >((acc, bucket) => {
        acc[bucket?.tenantStatus || "unknown"] = bucket?._count?._all ?? 0;
        return acc;
      }, {});

      const totalTenants = Object.values(tenantStatusMap).reduce(
        (sum, current) => sum + current,
        0,
      );
      const activeTenants = tenantStatusMap["active"] || 0;
      const pendingApplications =
        (tenantStatusMap["application_submitted"] || 0) +
        (tenantStatusMap["under_review"] || 0);

      // As the occupancy report rates it: out-of-service units are left out.
      const occupancyRate = occupancy.occupancyRate;

      // -----------------------------------------------------------------------
      // Maintenance metrics
      // -----------------------------------------------------------------------
      const maintenanceRows = await db.$queryRaw<
        Array<{
          total: number;
          open: number;
          inProgress: number;
          completed: number;
          urgent: number;
        }>
      >`
        SELECT
          count(*)::int AS total,
          (count(*) FILTER (
            WHERE status IN (${MaintenanceStatus.SUBMITTED}, ${MaintenanceStatus.ASSIGNED})
          ))::int AS open,
          (count(*) FILTER (
            WHERE status = ${MaintenanceStatus.IN_PROGRESS}
          ))::int AS "inProgress",
          (count(*) FILTER (
            WHERE status = ${MaintenanceStatus.COMPLETED}
          ))::int AS completed,
          (count(*) FILTER (
            WHERE priority = ${MaintenancePriority.EMERGENCY}
              AND status IN (
                ${MaintenanceStatus.SUBMITTED},
                ${MaintenanceStatus.ASSIGNED},
                ${MaintenanceStatus.IN_PROGRESS}
              )
          ))::int AS urgent
        FROM maintenance_requests
        WHERE "deletedAt" IS NULL
          AND ${maintenanceSql}
      `;

      const maintenanceStats = maintenanceRows[0] || {
        total: 0,
        open: 0,
        inProgress: 0,
        completed: 0,
        urgent: 0,
      };

      // -----------------------------------------------------------------------
      // Payment metrics (collection, overdue, trends)
      // -----------------------------------------------------------------------
      // Each figure is its report's own, over the days its card opens it on:
      //   overdue   — rent installments past their due date and unpaid, as at
      //               today (the overdue rent register);
      //   due       — rent installments falling due from today to the end of
      //               the month (the due rent register, from today), so the
      //               two never count the same installment;
      //   revenue   — money received from the first of the month to today
      //               (the payments-received register);
      //   expenses  — approved and paid expenses over the same days (the
      //               expenses-per-building report);
      //   collection rate — of the installments due this month, the share
      //               collected (the collection page, on this month).
      const [
        overdueTotals,
        dueTotals,
        monthPayments,
        yearRevenueRows,
        monthBilled,
        monthExpenseAgg,
      ] = await Promise.all([
        getReceivablesTotals({ actor: user, overdueOnly: true, now: todayEnd }),
        getReceivablesTotals({
          actor: user,
          overdueOnly: false,
          dueFrom: businessDayStart(todayIso),
          dueTo: businessDayEnd(monthEndIso),
          now: todayEnd,
        }),
        db.payment.findMany({
          where: collectionsWhere(
            { startDate: monthFrom, endDate: todayEnd },
            paymentScope(user),
          ),
          select: { amount: true, amountPaid: true },
        }),
        db.$queryRaw<Array<{ total: number }>>`
          SELECT ${RECEIVED} AS total
          FROM payments
          WHERE "deletedAt" IS NULL
            AND status IN (${PaymentStatus.PAID}, ${PaymentStatus.PARTIAL})
            AND "paidDate" >= ${businessDayStart(`${thisYear}-01-01`)}
            AND "paidDate" <= ${todayEnd}
            AND ${paymentSql}
        `,
        db.invoice.aggregate({
          where: collectionInvoicesWhere(
            { dueFrom: monthFrom, dueTo: businessDayEnd(monthEndIso) },
            invoiceScope(user),
          ),
          _sum: { totalAmount: true, amountPaid: true },
        }),
        // Every approved or paid expense the reader may see, the office's own
        // costs included — as the expense reports total them.
        db.expense.aggregate({
          where: buildingExpensesWhere(
            { startDate: monthFrom, endDate: todayEnd },
            expenseScope(user),
          ),
          _sum: { amount: true },
        }),
      ]);

      const monthlyRevenue = roundMoney(
        monthPayments.reduce((sum, payment) => sum + receivedAmount(payment), 0),
      );
      const yearlyRevenue = roundMoney(yearRevenueRows[0]?.total ?? 0);
      const monthlyExpenses = roundMoney(Number(monthExpenseAgg._sum.amount ?? 0));

      // Collected ÷ billed on this month's installments, as the collection
      // page works it out; nothing billed reads as 100%.
      const billedThisMonth = Number(monthBilled._sum.totalAmount ?? 0);
      const collectedThisMonth = Number(monthBilled._sum.amountPaid ?? 0);
      const collectionRate =
        billedThisMonth > 0
          ? Math.round((collectedThisMonth / billedThisMonth) * 1000) / 10
          : 100;

      const paymentSummary = {
        collected: monthlyRevenue,
        collectedCount: monthPayments.length,
        pending: dueTotals.balance,
        pendingCount: dueTotals.invoiceCount,
        overdue: overdueTotals.balance,
        overdueCount: overdueTotals.invoiceCount,
        totalDue: roundMoney(billedThisMonth),
      };

      const expenseSql = expenseClause(user);
      const [
        revenueByMonth,
        revenueByDay,
        revenueByMonthLastYear,
        expensesByMonth,
        expensesByDay,
        expensesByMonthLastYear,
        maintenanceCostsByMonth,
        maintenanceCostsByDay,
        maintenanceCostsByMonthLastYear,
        totalCompounds,
      ] = await Promise.all([
        revenueByMonthSeries(twelveMonthsAgo, todayEnd, paymentSql),
        revenueByDaySeries(thirtyDaysAgo, todayEnd, paymentSql),
        revenueByMonthSeries(startOfLastYear, endOfLastYear, paymentSql),
        expensesByMonthSeries(twelveMonthsAgo, todayEnd, expenseSql),
        expensesByDaySeries(thirtyDaysAgo, todayEnd, expenseSql),
        expensesByMonthSeries(startOfLastYear, endOfLastYear, expenseSql),
        // Only for the count of maintenance requests each point carries.
        maintenanceCostsByMonthSeries(twelveMonthsAgo, now, maintenanceSql),
        maintenanceCostsByDaySeries(thirtyDaysAgo, now, maintenanceSql),
        maintenanceCostsByMonthSeries(
          startOfLastYear,
          endOfLastYear,
          maintenanceSql,
        ),
        // How many compounds the reader's buildings are grouped into.
        db.compound.count({
          where: {
            deletedAt: null,
            properties: { some: { deletedAt: null, ...propertyWhere } },
          },
        }),
      ]);

      const revenueByMonthMap = new Map<string, number>();
      for (const bucket of revenueByMonth) {
        const key = buildMonthKey(bucket.year, bucket.month);
        revenueByMonthMap.set(key, bucket.total);
      }

      const revenueByDayMap = new Map<string, number>();
      for (const bucket of revenueByDay) {
        const key = buildDayKey(bucket.year, bucket.month, bucket.day);
        revenueByDayMap.set(key, bucket.total);
      }

      const revenueByMonthLastYearMap = new Map<string, number>();
      for (const bucket of revenueByMonthLastYear) {
        const key = buildMonthKey(bucket.year, bucket.month);
        revenueByMonthLastYearMap.set(key, bucket.total);
      }

      // A point's expenses are the expense ledger's; its count, the
      // maintenance requests raised in it.
      const expensePoints = (
        costs: Array<{ key: string; cost: number }>,
        counts: Array<{ key: string; count: number }>,
      ) => {
        const map = new Map<string, { cost: number; count: number }>();
        for (const { key, cost } of costs) {
          map.set(key, { cost, count: map.get(key)?.count ?? 0 });
        }
        for (const { key, count } of counts) {
          map.set(key, { cost: map.get(key)?.cost ?? 0, count });
        }
        return map;
      };
      const byMonth = (bucket: { year: number; month: number }) =>
        buildMonthKey(bucket.year, bucket.month);
      const byDay = (bucket: { year: number; month: number; day: number }) =>
        buildDayKey(bucket.year, bucket.month, bucket.day);

      const expenseByMonthMap = expensePoints(
        expensesByMonth.map((bucket) => ({ key: byMonth(bucket), cost: bucket.cost })),
        maintenanceCostsByMonth.map((bucket) => ({
          key: byMonth(bucket),
          count: bucket.count,
        })),
      );
      const expenseByDayMap = expensePoints(
        expensesByDay.map((bucket) => ({ key: byDay(bucket), cost: bucket.cost })),
        maintenanceCostsByDay.map((bucket) => ({
          key: byDay(bucket),
          count: bucket.count,
        })),
      );
      const expenseByMonthLastYearMap = expensePoints(
        expensesByMonthLastYear.map((bucket) => ({
          key: byMonth(bucket),
          cost: bucket.cost,
        })),
        maintenanceCostsByMonthLastYear.map((bucket) => ({
          key: byMonth(bucket),
          count: bucket.count,
        })),
      );

      const occupancyRounded = Math.round(occupancyRate * 10) / 10;
      const buildTrendPoint = (
        label: string,
        periodStart: Date,
        granularity: "day" | "month",
        totalRevenue: number,
        expenseEntry: { cost: number; count: number },
      ): DashboardOverviewResponse["trends"]["revenue"][number] => ({
        month: label,
        label,
        periodStart: periodStart.toISOString(),
        granularity,
        totalRevenue,
        totalExpenses: expenseEntry.cost,
        maintenance: expenseEntry.count,
        occupancy: occupancyRounded,
      });

      const trendData12Months: DashboardOverviewResponse["trends"]["revenue"] = [];
      for (let i = 0; i < 12; i += 1) {
        const monthDay = addBusinessMonths(month.from, -(11 - i));
        const key = monthDay.slice(0, 7);
        const revenue = revenueByMonthMap.get(key) || 0;
        const expenseEntry = expenseByMonthMap.get(key) || { cost: 0, count: 0 };

        trendData12Months.push(
          buildTrendPoint(
            MONTH_LABELS[Number(monthDay.slice(5, 7)) - 1],
            businessDayStart(monthDay),
            "month",
            revenue,
            expenseEntry,
          ),
        );
      }

      const trendDataLastYear: DashboardOverviewResponse["trends"]["revenue"] = [];
      for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
        const date = businessDayStart(
          `${lastYear}-${padNumber(monthIndex + 1)}-01`,
        );
        const key = buildMonthKey(lastYear, monthIndex + 1);
        const revenue = revenueByMonthLastYearMap.get(key) || 0;
        const expenseEntry = expenseByMonthLastYearMap.get(key) || {
          cost: 0,
          count: 0,
        };

        trendDataLastYear.push(
          buildTrendPoint(
            MONTH_LABELS[monthIndex],
            date,
            "month",
            revenue,
            expenseEntry,
          ),
        );
      }

      const trendData30Days: DashboardOverviewResponse["trends"]["revenue"] = [];
      for (let i = 0; i < 30; i += 1) {
        const day = addBusinessDays(thirtyDaysAgoDay, i);
        const key = day;
        const revenue = revenueByDayMap.get(key) || 0;
        const expenseEntry = expenseByDayMap.get(key) || { cost: 0, count: 0 };

        trendData30Days.push(
          buildTrendPoint(
            DAY_LABEL_FORMATTER.format(dateOnly(day)),
            businessDayStart(day),
            "day",
            revenue,
            expenseEntry,
          ),
        );
      }

      const trendData7Days = trendData30Days.slice(-7);

      // -----------------------------------------------------------------------
      // Recent activity feed (payments, maintenance, leases)
      // -----------------------------------------------------------------------
      const [recentPayments, recentMaintenance, recentLeases] =
        await Promise.all([
          db.payment.findMany({
            where: { deletedAt: null, ...paymentWhere },
            orderBy: { updatedAt: "desc" },
            take: 5,
            select: {
              id: true,
              amount: true,
              status: true,
              type: true,
              paidDate: true,
              dueDate: true,
              updatedAt: true,
              tenant: { select: { firstName: true, lastName: true } },
              property: { select: { name: true } },
            },
          }),
          db.maintenanceRequest.findMany({
            where: { deletedAt: null, ...maintenanceWhere },
            orderBy: { updatedAt: "desc" },
            take: 5,
            select: {
              id: true,
              title: true,
              priority: true,
              status: true,
              updatedAt: true,
              property: { select: { name: true } },
            },
          }),
          db.lease.findMany({
            where: { deletedAt: null, ...leaseWhere },
            orderBy: { updatedAt: "desc" },
            take: 5,
            select: {
              id: true,
              status: true,
              startDate: true,
              endDate: true,
              updatedAt: true,
              tenant: { select: { firstName: true, lastName: true } },
              property: { select: { name: true } },
            },
          }),
        ]);

      const formatName = (
        record?:
          | {
              firstName?: string | null;
              lastName?: string | null;
              email?: string | null;
              name?: string | null;
            }
          | string
          | null,
      ) => {
        if (!record) return "Unknown";
        if (typeof record === "string") return record;

        const first = record.firstName || record.name || "";
        const last = record.lastName || "";
        return `${first} ${last}`.trim() || record.email || "Unknown";
      };

      const activities: DashboardOverviewResponse["recentActivities"] = [
        ...recentPayments.map((payment) => {
          const tenantName = formatName(payment?.tenant);
          const propertyName = payment?.property?.name || "Portfolio";
          const description = `${tenantName} paid ${
            payment?.type || "rent"
          } for ${propertyName}`;
          const timestamp =
            payment?.paidDate?.toISOString?.() ||
            payment?.updatedAt?.toISOString?.() ||
            new Date().toISOString();

          const paymentId = payment?.id;

          return {
            id: paymentId ?? "unknown",
            type: "payment" as const,
            description,
            parts: {
              party: tenantName,
              kind: payment?.type || "rent",
              place: payment?.property?.name || undefined,
            },
            timestamp,
            status: payment?.status,
            amount: payment?.amount,
            href: paymentId ? `/dashboard/payments/${paymentId}` : undefined,
          };
        }),
        ...recentMaintenance.map((request) => {
          const propertyName = request?.property?.name || "Portfolio";
          const description = `${
            request?.title || "Maintenance request"
          } at ${propertyName}`;
          const timestamp =
            request?.updatedAt?.toISOString?.() || new Date().toISOString();

          const requestId = request?.id;

          return {
            id: requestId ?? "unknown",
            type: "maintenance" as const,
            description,
            parts: {
              title: request?.title || undefined,
              place: request?.property?.name || undefined,
            },
            timestamp,
            status: request?.status,
            priority: request?.priority,
            href: requestId
              ? `/dashboard/maintenance/${requestId}`
              : undefined,
          };
        }),
        ...recentLeases.map((lease) => {
          const tenantName = formatName(lease?.tenant);
          const propertyName = lease?.property?.name || "Portfolio";
          const description = `${tenantName} lease ${
            lease?.status?.replace(/_/g, " ") || "unknown"
          } at ${propertyName}`;
          const timestamp =
            lease?.updatedAt?.toISOString?.() || new Date().toISOString();

          const leaseId = lease?.id;

          return {
            id: leaseId ?? "unknown",
            type: "lease" as const,
            description,
            parts: {
              party: tenantName,
              kind: lease?.status || undefined,
              place: lease?.property?.name || undefined,
            },
            timestamp,
            status: lease?.status,
            href: leaseId ? `/dashboard/leases/${leaseId}` : undefined,
          };
        }),
      ]
        .sort(
          (a, b) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
        )
        .slice(0, 8);

      // -----------------------------------------------------------------------
      // Upcoming tasks (calendar events + expiring lease reminders + open maintenance)
      // -----------------------------------------------------------------------
      const [
        upcomingEvents,
        upcomingExpiringLeases,
        openHighPriorityMaintenance,
      ] = await Promise.all([
        db.event.findMany({
          where: {
            deletedAt: null,
            status: { in: [EventStatus.SCHEDULED, EventStatus.CONFIRMED] },
            startDate: { gte: now },
            // Calendar visibility is attendance, as on the calendar itself
            // (api/calendar/events): a tenant or an owner sees the events
            // they organise or attend. Staff see the office's calendar here
            // because that is what the calendar shows them.
            ...(user.isCompanyStaff
              ? {}
              : {
                  OR: [
                    { organizerId: user.id },
                    { attendeeIds: { has: user.id } },
                  ],
                }),
          },
          orderBy: { startDate: "asc" },
          take: 5,
          select: {
            id: true,
            title: true,
            startDate: true,
            priority: true,
            type: true,
          },
        }),
        // The contracts the "nearing expiry" card counts.
        db.lease.findMany({
          where: leaseReportWhere(
            "expiring-soon",
            { endOfToday: endOfBusinessDay(now) },
            leaseWhere,
          ),
          orderBy: { endDate: "asc" },
          take: 3,
          select: {
            id: true,
            endDate: true,
            tenant: { select: { firstName: true, lastName: true } },
            property: { select: { name: true } },
          },
        }),
        db.maintenanceRequest.findMany({
          where: {
            ...maintenanceWhere,
            deletedAt: null,
            status: {
              in: [MaintenanceStatus.SUBMITTED, MaintenanceStatus.ASSIGNED],
            },
            priority: {
              in: [MaintenancePriority.HIGH, MaintenancePriority.EMERGENCY],
            },
          },
          orderBy: { createdAt: "asc" },
          take: 3,
          select: {
            id: true,
            title: true,
            createdAt: true,
            priority: true,
            property: { select: { name: true } },
          },
        }),
      ]);

      const upcomingTasks: DashboardOverviewResponse["upcomingTasks"] = [];

      // Each task carries its parts as stored as well as an English title, so
      // the page can word it in the reader's language.
      for (const event of upcomingEvents) {
        upcomingTasks.push({
          id: event?.id ?? "unknown",
          title: event?.title ?? "Event",
          parts: { title: event?.title || undefined },
          dueDate: event?.startDate
            ? new Date(event.startDate).toISOString()
            : now.toISOString(),
          priority: (event?.priority ||
            EventPriority.MEDIUM) as DashboardOverviewResponse["upcomingTasks"][number]["priority"],
          type: event?.type || EventType.GENERAL,
        });
      }

      for (const lease of upcomingExpiringLeases) {
        const tenantName = formatName(lease?.tenant);
        const propertyName = lease?.property?.name || "Portfolio";
        upcomingTasks.push({
          id: `lease-${lease?.id ?? "unknown"}`,
          title: `Lease renewal - ${tenantName} (${propertyName})`,
          parts: {
            party: tenantName === "Unknown" ? undefined : tenantName,
            place: lease?.property?.name || undefined,
          },
          dueDate: lease?.endDate?.toISOString?.() || now.toISOString(),
          priority: "high",
          type: "lease_renewal",
        });
      }

      for (const request of openHighPriorityMaintenance) {
        const propertyName = request?.property?.name || "Portfolio";
        upcomingTasks.push({
          id: `maintenance-${request?.id ?? "unknown"}`,
          title: `${
            request?.title || "Maintenance follow-up"
          } (${propertyName})`,
          parts: {
            title: request?.title || undefined,
            place: request?.property?.name || undefined,
          },
          dueDate: request?.createdAt?.toISOString?.() || now.toISOString(),
          priority:
            request?.priority === MaintenancePriority.EMERGENCY
              ? "urgent"
              : "high",
          type: "maintenance",
        });
      }

      upcomingTasks.sort(
        (a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime(),
      );

      const trimmedTasks = upcomingTasks.slice(0, 8);

      // The overdue card's installments — by due date, not by a stored
      // status only a nightly job updates.
      const overdueInvoicesCount = overdueTotals.invoiceCount;

      // -----------------------------------------------------------------------
      // Alert summaries
      // -----------------------------------------------------------------------
      // Always show the main 3 alerts (payment, maintenance, lease)
      const mainAlerts: DashboardOverviewResponse["alerts"] = [
        {
          id: "overdue-payments",
          type: "payment",
          title: "Collections Due",
          message:
            overdueInvoicesCount > 0
              ? `${overdueInvoicesCount} invoices are overdue`
              : "No overdue invoices at this time",
          severity: overdueInvoicesCount > 0 ? "high" : "low",
          count: overdueInvoicesCount,
        },
        {
          id: "urgent-maintenance",
          type: "maintenance",
          title: "Urgent Maintenance",
          message:
            maintenanceStats.urgent > 0
              ? `${maintenanceStats.urgent} urgent maintenance requests require immediate attention`
              : "No urgent maintenance requests",
          severity:
            maintenanceStats.urgent >= 3
              ? "critical"
              : maintenanceStats.urgent > 0
                ? "high"
                : "low",
          count: maintenanceStats.urgent,
        },
        {
          id: "expiring-leases",
          type: "lease",
          title: "Expiring Leases",
          message:
            expiringLeasesCount > 0
              ? `${expiringLeasesCount} leases expiring within the next 30 days`
              : "No leases expiring soon",
          severity: expiringLeasesCount >= 5 ? "medium" : "low",
          count: expiringLeasesCount,
        },
      ];

      // Optional: Add pending applications alert only if there are any
      const alerts: DashboardOverviewResponse["alerts"] = [
        ...mainAlerts,
        ...(pendingApplications > 0
          ? [
              {
                id: "pending-applications",
                type: UserRole.TENANT as DashboardAlertType,
                title: "Pending Applications",
                message: `${pendingApplications} tenant applications awaiting review`,
                severity: "medium" as DashboardAlertSeverity,
                count: pendingApplications,
              },
            ]
          : []),
      ];

      // The slug travels with the English label: the page names the type in
      // the reader's language from the organization's categories.
      const propertyTypes = Object.entries(propertyTypeCounts).map(
        ([type, count], index) => ({
          type,
          name: type
            .split("_")
            .map(
              (segment) => segment.charAt(0).toUpperCase() + segment.slice(1),
            )
            .join(" "),
          value: count,
          color: ALERT_COLOR_MAP[index % ALERT_COLOR_MAP.length],
        }),
      );

      const response: DashboardOverviewResponse = {
        overview: {
          totalProperties,
          totalCompounds,
          // A building is a property here; the card says it in the client's
          // word and opens the buildings list.
          totalBuildings: totalProperties,
          totalUnits,
          occupiedUnits,
          vacantUnits: occupancy.vacantUnits,
          maintenanceUnits: occupancy.maintenanceUnits,
          occupancyRate,
          monthlyRevenue,
          yearlyRevenue,
          monthlyExpenses,
          monthlyNetIncome:
            Math.round((monthlyRevenue - monthlyExpenses) * 100) / 100,
          averageRent,
          collectionRate,
          totalTenants,
          activeTenants,
          pendingApplications,
          activeLeases: activeLeasesCount,
          expiringLeases: expiringLeasesCount,
          overdueTenants: overdueTotals.tenantCount,
          windows: {
            today: todayIso,
            monthStart: monthStartIso,
            monthEnd: monthEndIso,
          },
          maintenanceRequests: {
            total: maintenanceStats.total,
            open: maintenanceStats.open,
            inProgress: maintenanceStats.inProgress,
            completed: maintenanceStats.completed,
            urgent: maintenanceStats.urgent,
          },
          payments: {
            collected: paymentSummary.collected,
            collectedCount: paymentSummary.collectedCount,
            pending: paymentSummary.pending,
            pendingCount: paymentSummary.pendingCount,
            overdue: paymentSummary.overdue,
            overdueCount: paymentSummary.overdueCount,
            totalDue: paymentSummary.totalDue,
          },
        },
        alerts,
        trends: {
          revenue: trendData12Months,
          revenueByRange: {
            "7d": trendData7Days,
            "30d": trendData30Days,
            "12m": trendData12Months,
            lastYear: trendDataLastYear,
          },
        },
        propertyTypes,
        recentActivities: activities,
        upcomingTasks: trimmedTasks,
      };

      return createSuccessResponse(
        response,
        "Dashboard overview metrics retrieved successfully",
      );
    } catch (error) {
      return handleApiError(error, "Failed to load dashboard overview");
    }
  },
);
