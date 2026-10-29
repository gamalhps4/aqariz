/**
 * PropertyPro - What each report queries
 *
 * Every register takes filters from the query string — a building, a
 * compound, an owner, a tenant — and is read by someone who may hold only
 * part of the portfolio. The `where` each one runs is built here, from those
 * filters and the reader's scope, so the rule they share is written once and
 * pinned by tests:
 *
 *     a filter narrows what the reader may see; it never replaces it.
 *
 * The registers used to spread the scope and then the filter into one object
 * literal. Both name `propertyId` — or, for a building, `id` — so the filter
 * won, and an employee assigned one building, or an owner, could read any
 * other by naming it in the URL.
 *
 * No database and no session here. The services pass the scope in as the
 * fragment lib/db/scopes.ts already made of it.
 */

import type { Prisma } from "@/generated/prisma/client";
import { withScope } from "@/lib/db/scope-where";
import {
  addBusinessDays,
  businessDay,
  businessDayEnd,
  businessDayStart,
  businessToday,
} from "@/lib/dates/business-day";
import {
  chargeCategoryWhere,
  type ChargeFilter,
} from "@/lib/payments/charge-category";
import { OWNER_RECEIVED_METHODS } from "@/lib/payments/methods";
import {
  ExpenseStatus,
  InvoiceStatus,
  LeaseStatus,
  PaymentStatus,
} from "@/types";
import type { LeaseReportType } from "@/types/lease-report";

// ---------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------

/** The filters that pick buildings: one, a compound's, an owner's. */
export interface BuildingFilters {
  propertyId?: string;
  compoundId?: string;
  ownerId?: string;
}

/**
 * The buildings a report is read over — occupancy's units hang off them, and
 * the by-building collections report lists them.
 *
 * The building carries ownership and grouping, so every filter the review
 * asks for lands here rather than on the unit. It is also the one model whose
 * scope is keyed on the row's own id, which is what `propertyId` filters on.
 */
export function buildingsWhere(
  filters: BuildingFilters,
  scope: Prisma.PropertyWhereInput,
): Prisma.PropertyWhereInput {
  return withScope(
    {
      deletedAt: null,
      ...(filters.propertyId ? { id: filters.propertyId } : {}),
      ...(filters.compoundId ? { compoundId: filters.compoundId } : {}),
      ...(filters.ownerId ? { ownerId: filters.ownerId } : {}),
    },
    scope,
  );
}

// ---------------------------------------------------------------------------
// Maintenance register
// ---------------------------------------------------------------------------

export interface MaintenanceReportFilters extends BuildingFilters {
  startDate: Date;
  endDate: Date;
}

export function maintenanceReportWhere(
  filters: MaintenanceReportFilters,
  scope: Prisma.MaintenanceRequestWhereInput,
): Prisma.MaintenanceRequestWhereInput {
  // Owner and compound live on the building, so they filter through it.
  const propertyFilter: Prisma.PropertyWhereInput | undefined =
    filters.compoundId || filters.ownerId
      ? {
          ...(filters.compoundId ? { compoundId: filters.compoundId } : {}),
          ...(filters.ownerId ? { ownerId: filters.ownerId } : {}),
        }
      : undefined;

  return withScope(
    {
      deletedAt: null,
      // A request belongs to the period it was RAISED in. Filtering on
      // completion would drop everything still open, which is most of what a
      // maintenance report is read for.
      createdAt: { gte: filters.startDate, lte: filters.endDate },
      ...(filters.propertyId ? { propertyId: filters.propertyId } : {}),
      ...(propertyFilter ? { property: propertyFilter } : {}),
    },
    scope,
  );
}

// ---------------------------------------------------------------------------
// Leasing registers
// ---------------------------------------------------------------------------

/**
 * The two expiry registers' default windows, in days from today.
 *
 * The review lists "Contracts Approaching Expiry" and "Contracts Expiring
 * Soon" as two reports, three times over. They were one report with a window
 * selector, which read to the client as one of the two missing. They are two
 * registers now, over windows that do not overlap — the next thirty days, and
 * the sixty after that — so no contract appears on both. Either can be
 * widened with the date filter.
 */
export const EXPIRING_SOON_DAYS = 30;
export const APPROACHING_EXPIRY_DAYS = 90;

export interface LeaseReportFilters {
  propertyId?: string;
  /** One owner's portfolio — filtered through the building. */
  ownerId?: string;
  /** Only for `expiring`; ignored by the other registers. */
  withinDays?: number;
  /**
   * The date filter, on the date each register is about. Not applied here
   * for `renewed`: its date is the renewal's, which lives on the contract
   * that took over (see lease-reports.service).
   */
  from?: Date;
  to?: Date;
  /**
   * The last instant of the day the register is read on. End dates are
   * stored at midnight, so a contract is only past its term once its final
   * day has fully elapsed.
   */
  endOfToday: Date;
}

/**
 * The office's day that an `endOfToday` closes: "2026-10-01".
 *
 * `endOfToday` is the last instant of a day, built by whichever clock the
 * caller has — Riyadh's, or the server's own. Twelve hours before the end of
 * any day is the middle of that same day, on every clock there is, so
 * reading the office's calendar there names the day it closes without
 * guessing which clock made it.
 */
function reportDayOf(endOfToday: Date): string {
  return businessDay(new Date(endOfToday.getTime() - 12 * 60 * 60 * 1000));
}

/**
 * The first instant of the day `endOfToday` closes — midnight in Riyadh.
 *
 * A contract's end date is its last day, stored at that day's midnight. The
 * registers compared it with the day's END, so on its last day a contract
 * was already "expired", no longer "active", and gone from "expiring soon" —
 * while it was still in force. It is past its term only once that day is
 * over: while the end date is not before the start of today.
 */
export function startOfReportDay(endOfToday: Date): Date {
  return businessDayStart(reportDayOf(endOfToday));
}

export function leaseReportWhere(
  type: LeaseReportType,
  filters: LeaseReportFilters,
  scope: Prisma.LeaseWhereInput,
): Prisma.LeaseWhereInput {
  const { endOfToday } = filters;
  const startOfToday = startOfReportDay(endOfToday);

  const base: Prisma.LeaseWhereInput = {
    deletedAt: null,
    ...(filters.propertyId ? { propertyId: filters.propertyId } : {}),
    ...(filters.ownerId ? { property: { ownerId: filters.ownerId } } : {}),
  };

  // The whole of the day `to` names, on the office's calendar.
  const toEnd = filters.to ? businessDayEnd(businessDay(filters.to)) : undefined;
  const inRange = (): Prisma.DateTimeFilter | undefined =>
    filters.from || toEnd
      ? {
          ...(filters.from ? { gte: filters.from } : {}),
          ...(toEnd ? { lte: toEnd } : {}),
        }
      : undefined;
  const daysAhead = (days: number) =>
    businessDayEnd(addBusinessDays(reportDayOf(endOfToday), days));

  let where: Prisma.LeaseWhereInput;
  switch (type) {
    case "active": {
      // Running *and* still within its term — its last day included; the
      // date filter is on when it began.
      const began = inRange();
      where = {
        ...base,
        status: LeaseStatus.ACTIVE,
        endDate: { gte: startOfToday },
        ...(began ? { startDate: began } : {}),
      };
      break;
    }
    case "expiring-soon":
    case "expiring": {
      // Still running, and reaching its end inside the window. Contracts that
      // have already lapsed belong in "expired" — an office renewing this
      // list is looking at what it can still act on.
      //
      // A contract on its last day is still running, so it stays on the
      // expiring-soon register until that day is over. The approaching-expiry
      // register is read exactly as before: its window, and how the date
      // filter moves it, are waiting on the client.
      const stillRunning = type === "expiring-soon" ? startOfToday : endOfToday;
      const legacyWindow =
        type === "expiring" && filters.withinDays
          ? { gte: endOfToday, lte: daysAhead(Math.max(1, filters.withinDays)) }
          : undefined;
      const defaults =
        type === "expiring-soon"
          ? { gte: startOfToday, lte: daysAhead(EXPIRING_SOON_DAYS) }
          : {
              gt: daysAhead(EXPIRING_SOON_DAYS),
              lte: daysAhead(APPROACHING_EXPIRY_DAYS),
            };
      where = {
        ...base,
        status: LeaseStatus.ACTIVE,
        AND: [
          { endDate: { gte: stillRunning } },
          { endDate: inRange() ?? legacyWindow ?? defaults },
        ],
      };
      break;
    }
    case "expired": {
      // Already swept, or lapsed and awaiting the sweep — lapsed meaning its
      // last day is over; the date filter is on when it ended.
      const ended = inRange();
      where = {
        ...base,
        OR: [
          { status: LeaseStatus.EXPIRED },
          { status: LeaseStatus.ACTIVE, endDate: { lt: startOfToday } },
        ],
        ...(ended ? { endDate: ended } : {}),
      };
      break;
    }
    case "renewed":
      // A contract marked renewed has a successor. It is kept as its own
      // register rather than folded into "expired" because the question an
      // office asks of it is different: expired is work outstanding, renewed
      // is work done.
      //
      // Its date filter is on the day the renewal was made. That day is the
      // successor's, which no relation reaches, so the service applies it
      // once it has read the successors. This used to filter on the old
      // contract's end date under a label saying "renewed".
      where = { ...base, status: LeaseStatus.RENEWED };
      break;
    case "terminated": {
      const cancelled = inRange();
      where = {
        ...base,
        status: LeaseStatus.TERMINATED,
        ...(cancelled ? { terminatedDate: cancelled } : {}),
      };
      break;
    }
  }

  // The reader's own entitlement, AND-ed on last — after the registers above
  // have written their own keys, one of which is an `AND` of its own.
  return withScope(where, scope);
}

// ---------------------------------------------------------------------------
// Occupancy
// ---------------------------------------------------------------------------

/** A day a register is read for: its first and last instants. */
export interface ReportDay {
  start: Date;
  end: Date;
}

export interface OccupancyDay extends ReportDay {
  /** The current day — the only one a unit's stored status describes. */
  today: boolean;
  /** Wholly before the current day. */
  past: boolean;
}

/**
 * The day occupancy is read for: a date the reader chose ("2026-09-30"), or
 * today — the office's today, not the server's. Its bounds are in UTC, as a
 * date-only contract date is stored. Null for a date that is not one.
 */
export function occupancyDay(
  asOf: string | null | undefined,
  now: Date = new Date(),
): OccupancyDay | null {
  const todayIso = businessToday(now);
  const iso = asOf || todayIso;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const start = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || start.toISOString().slice(0, 10) !== iso) {
    return null;
  }
  return {
    start,
    end: new Date(`${iso}T23:59:59.999Z`),
    today: iso === todayIso,
    past: iso < todayIso,
  };
}

/**
 * The contracts that had a tenant in their unit on a day.
 *
 * Its own dates decide it — begun by the end of the day, and its last day
 * that day or later, so a contract on its last day still holds its unit —
 * and its status says whether it ran at all:
 *
 *   - an active or a renewed contract ran, a renewed one to its own end;
 *   - an expired one ran its term, so it counts for any day already past. It
 *     is not counted for today: expired while its dates still cover today,
 *     it was ended early, and the unit is free;
 *   - a cancelled one ran until the day it was cancelled. One with no such
 *     date is left out: nothing says how long it ran;
 *   - a draft, or one awaiting signature, never put anyone in.
 *
 * Only active and renewed contracts used to count, so occupancy as at a
 * date last year left out every contract that has expired since.
 */
export function coveringLeaseWhere(
  day: ReportDay,
  options: { past: boolean },
): Prisma.LeaseWhereInput {
  return {
    deletedAt: null,
    startDate: { lte: day.end },
    endDate: { gte: day.start },
    OR: [
      { status: { in: [LeaseStatus.ACTIVE, LeaseStatus.RENEWED] } },
      ...(options.past ? [{ status: LeaseStatus.EXPIRED }] : []),
      { status: LeaseStatus.TERMINATED, terminatedDate: { gte: day.start } },
    ],
  };
}

// ---------------------------------------------------------------------------
// Payment registers
// ---------------------------------------------------------------------------

/** Invoice states that still owe money. Paid and cancelled are excluded. */
export const OPEN_INVOICE_STATUSES = [
  InvoiceStatus.SCHEDULED,
  InvoiceStatus.ISSUED,
  InvoiceStatus.PARTIAL,
  InvoiceStatus.OVERDUE,
];

export interface ReceivablesFilters {
  propertyId?: string;
  /** One owner's portfolio — filtered through the building. */
  ownerId?: string;
  tenantId?: string;
  /** Only invoices due on or before this date (defaults to no ceiling). */
  asOf?: Date;
  /** Only invoices falling due in this window — the due-payments register. */
  dueFrom?: Date;
  dueTo?: Date;
  overdueOnly: boolean;
  /**
   * Midnight at the start of the day the register is read on. Due dates are
   * stored at midnight, so a bill is only late once its due day has passed.
   */
  overdueBefore: Date;
  /**
   * Read as at a moment already past: also the installments that were paid
   * off after it. What each still owed at that moment is worked out row by
   * row (installmentAsAt); one settled since has to be read to be weighed.
   */
  paidAfter?: Date;
  /** Which charges — see lib/payments/charge-category. Absent, every one. */
  category?: ChargeFilter;
}

/** The overdue and the due-rent registers: installments still owing. */
export function receivablesWhere(
  filters: ReceivablesFilters,
  scope: Prisma.InvoiceWhereInput,
): Prisma.InvoiceWhereInput {
  const owing: Prisma.InvoiceWhereInput = {
    status: { in: OPEN_INVOICE_STATUSES },
    balanceRemaining: { gt: 0 },
  };
  const standing: Prisma.InvoiceWhereInput = filters.paidAfter
    ? {
        OR: [
          owing,
          {
            status: { not: InvoiceStatus.CANCELLED },
            lastPaymentDate: { gt: filters.paidAfter },
          },
        ],
      }
    : owing;

  return withScope(
    {
      deletedAt: null,
      ...standing,
      ...chargeCategoryWhere(filters.category ?? "all"),
      ...(filters.propertyId ? { propertyId: filters.propertyId } : {}),
      ...(filters.ownerId ? { property: { ownerId: filters.ownerId } } : {}),
      ...(filters.tenantId ? { tenantId: filters.tenantId } : {}),
      ...(filters.overdueOnly
        ? { dueDate: { lt: filters.overdueBefore } }
        : {}),
      ...(filters.asOf && !filters.overdueOnly
        ? { dueDate: { lte: filters.asOf } }
        : {}),
      ...((filters.dueFrom || filters.dueTo) && !filters.overdueOnly
        ? {
            dueDate: {
              ...(filters.dueFrom ? { gte: filters.dueFrom } : {}),
              ...(filters.dueTo ? { lte: filters.dueTo } : {}),
            },
          }
        : {}),
    },
    scope,
  );
}

export interface CollectionsFilters {
  startDate: Date;
  endDate: Date;
  propertyId?: string;
  /** One owner's portfolio — filtered through the building. */
  ownerId?: string;
  tenantId?: string;
}

/**
 * Payments actually received in a window.
 *
 * Filtered on `paidDate`, not `createdAt`: a payment recorded today for a
 * transfer that landed last month belongs to last month's collections.
 */
export function collectionsWhere(
  filters: CollectionsFilters,
  scope: Prisma.PaymentWhereInput,
): Prisma.PaymentWhereInput {
  return withScope(
    {
      deletedAt: null,
      status: { in: [PaymentStatus.PAID, PaymentStatus.PARTIAL] },
      paidDate: { gte: filters.startDate, lte: filters.endDate },
      ...(filters.propertyId ? { propertyId: filters.propertyId } : {}),
      ...(filters.ownerId ? { property: { ownerId: filters.ownerId } } : {}),
      ...(filters.tenantId ? { tenantId: filters.tenantId } : {}),
    },
    scope,
  );
}

/** The payment states the payment report's filter offers. */
export const PAYMENT_REGISTER_STATUSES = [
  PaymentStatus.PAID,
  PaymentStatus.PARTIAL,
  PaymentStatus.REFUNDED,
] as const;
export type PaymentRegisterStatus = (typeof PAYMENT_REGISTER_STATUSES)[number];

export function isPaymentRegisterStatus(value: unknown): value is PaymentRegisterStatus {
  return (PAYMENT_REGISTER_STATUSES as readonly unknown[]).includes(value);
}

/** The payment report's filters, beside its period. */
export interface PaymentRegisterFilters {
  propertyId?: string;
  /** One owner's portfolio — filtered through the building. */
  ownerId?: string;
  /** One compound's buildings — filtered through the building. */
  compoundId?: string;
  /** One unit: a payment reaches its unit through its contract. */
  unitId?: string;
  /** One contract. */
  leaseId?: string;
  tenantId?: string;
  /** A stored method code; "unspecified" is a payment with none recorded. */
  method?: string;
  /** Who ended up holding the money — see OWNER_RECEIVED_METHODS. */
  receiver?: "office" | "owner";
  /** rent, security_deposit, late_fee… */
  paymentType?: string;
  /** An employee's user id, or "online" for money a gateway took. */
  recordedBy?: string;
  /** Paid, partly paid or refunded. Absent, all three. */
  status?: PaymentRegisterStatus;
}

/**
 * Any gateway reference: money a payment gateway took, not the desk. The
 * generic column joins once the database has it (lib/payments/
 * gateway-columns.ts) — the caller says so — and covers every gateway; the
 * old columns stay for rows from before it.
 */
const TAKEN_ONLINE: Prisma.PaymentWhereInput[] = [
  { stripePaymentIntentId: { not: null } },
  { stripeCheckoutSessionId: { not: null } },
  { paypalCaptureId: { not: null } },
  { razorpayPaymentId: { not: null } },
  { paystackReference: { not: null } },
];

/**
 * The payments the payment report reads: money received — paid, partly paid,
 * or refunded since — under its filters and the reader's scope.
 *
 * No dates: a receipt is placed by its paid date and a refund by the day the
 * money went back, so the service applies the period to each line (see
 * lib/payments/payment-register.ts). Filters that name the same column — a
 * method and who received it, both on `paymentMethod` — are AND-ed, never
 * written over each other.
 */
export function paymentRegisterWhere(
  filters: PaymentRegisterFilters,
  scope: Prisma.PaymentWhereInput,
  options: { gatewayColumns?: boolean } = {},
): Prisma.PaymentWhereInput {
  const conditions: Prisma.PaymentWhereInput[] = [];

  if (filters.method) {
    conditions.push({
      paymentMethod: filters.method === "unspecified" ? null : filters.method,
    });
  }
  if (filters.receiver === "owner") {
    conditions.push({ paymentMethod: { in: [...OWNER_RECEIVED_METHODS] } });
  } else if (filters.receiver === "office") {
    conditions.push({
      OR: [
        { paymentMethod: null },
        { paymentMethod: { notIn: [...OWNER_RECEIVED_METHODS] } },
      ],
    });
  }
  if (filters.recordedBy === "online") {
    conditions.push({
      recordedById: null,
      OR: options.gatewayColumns
        ? [{ gatewayPaymentId: { not: null } }, ...TAKEN_ONLINE]
        : TAKEN_ONLINE,
    });
  } else if (filters.recordedBy) {
    conditions.push({ recordedById: filters.recordedBy });
  }
  if (filters.unitId) {
    conditions.push({ lease: { unitId: filters.unitId } });
  }

  // Owner and compound live on the building, so they filter through it.
  const property: Prisma.PropertyWhereInput | undefined =
    filters.ownerId || filters.compoundId
      ? {
          ...(filters.ownerId ? { ownerId: filters.ownerId } : {}),
          ...(filters.compoundId ? { compoundId: filters.compoundId } : {}),
        }
      : undefined;

  return withScope(
    {
      deletedAt: null,
      status: filters.status ? filters.status : { in: [...PAYMENT_REGISTER_STATUSES] },
      ...(filters.propertyId ? { propertyId: filters.propertyId } : {}),
      ...(property ? { property } : {}),
      ...(filters.tenantId ? { tenantId: filters.tenantId } : {}),
      ...(filters.leaseId ? { leaseId: filters.leaseId } : {}),
      ...(filters.paymentType ? { type: filters.paymentType } : {}),
      ...(conditions.length > 0 ? { AND: conditions } : {}),
    },
    scope,
  );
}

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------

/** Invoice states that were really billed — cancelled ones never were. */
export const BILLED_INVOICE_STATUSES = [
  InvoiceStatus.SCHEDULED,
  InvoiceStatus.ISSUED,
  InvoiceStatus.PARTIAL,
  InvoiceStatus.OVERDUE,
  InvoiceStatus.PAID,
];

export interface CollectionInvoiceFilters {
  propertyId?: string;
  /** One owner's portfolio — filtered through the building. */
  ownerId?: string;
  /** One compound's buildings — filtered through the building. */
  compoundId?: string;
  tenantId?: string;
  /** Only installments falling due in this window. */
  dueFrom?: Date;
  dueTo?: Date;
}

/** The installments the collection page weighs billed against collected. */
export function collectionInvoicesWhere(
  filters: CollectionInvoiceFilters,
  scope: Prisma.InvoiceWhereInput,
): Prisma.InvoiceWhereInput {
  // Owner and compound live on the building, so they filter through it.
  const property: Prisma.PropertyWhereInput | undefined =
    filters.ownerId || filters.compoundId
      ? {
          ...(filters.ownerId ? { ownerId: filters.ownerId } : {}),
          ...(filters.compoundId ? { compoundId: filters.compoundId } : {}),
        }
      : undefined;

  return withScope(
    {
      deletedAt: null,
      status: { in: BILLED_INVOICE_STATUSES },
      ...(filters.propertyId ? { propertyId: filters.propertyId } : {}),
      ...(property ? { property } : {}),
      ...(filters.tenantId ? { tenantId: filters.tenantId } : {}),
      ...(filters.dueFrom || filters.dueTo
        ? {
            dueDate: {
              ...(filters.dueFrom ? { gte: filters.dueFrom } : {}),
              ...(filters.dueTo ? { lte: filters.dueTo } : {}),
            },
          }
        : {}),
    },
    scope,
  );
}

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

/**
 * The expense states that are a cost of their period: approved, or already
 * paid. A pending expense is a request nobody has agreed to yet.
 *
 * The by-building report used to count pending ones too, while the income
 * and expense report and the owner statements did not — so the dashboard's
 * expenses matched neither report it could open.
 */
export const COUNTED_EXPENSE_STATUSES = [
  ExpenseStatus.APPROVED,
  ExpenseStatus.PAID,
];

export interface BuildingExpensesFilters {
  startDate: Date;
  endDate: Date;
  propertyId?: string;
  /** One owner's buildings — filtered through the building. */
  ownerId?: string;
}

/**
 * Expenses in a window: the by-building report, and the dashboard's.
 *
 * An expense may carry no building — an office-level cost. A reader who is
 * not narrowed sees those summed apart; one who is does not see them at all,
 * because the scope keys on the building and a row without one matches none.
 * Nor does one filtered to an owner: the office's own costs are nobody's.
 */
export function buildingExpensesWhere(
  filters: BuildingExpensesFilters,
  scope: Prisma.ExpenseWhereInput,
): Prisma.ExpenseWhereInput {
  return withScope(
    {
      deletedAt: null,
      date: { gte: filters.startDate, lte: filters.endDate },
      status: { in: COUNTED_EXPENSE_STATUSES },
      ...(filters.propertyId ? { propertyId: filters.propertyId } : {}),
      ...(filters.ownerId ? { property: { ownerId: filters.ownerId } } : {}),
    },
    scope,
  );
}
