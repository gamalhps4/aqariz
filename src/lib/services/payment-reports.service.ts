/**
 * PropertyPro - Payments module reports
 *
 * The five reports the payments section is required to produce:
 *   overdue · outstanding · collections in a date range ·
 *   collections by building · expenses by building
 *
 * They read the same invoice/payment/expense rows the rest of the app writes,
 * so a report can never disagree with the ledger it summarises. Aggregation is
 * pushed into Postgres (`groupBy`) wherever a report is a rollup, so a
 * portfolio with tens of thousands of payments does not stream through Node.
 */

import { db } from "@/lib/db/prisma";
import {
  expenseScope,
  invoiceScope,
  paymentScope,
  propertyScope,
  withScope,
  type ScopeActor,
} from "@/lib/db/scopes";
import {
  buildingExpensesWhere,
  buildingsWhere,
  collectionsWhere,
  paymentRegisterWhere,
  receivablesWhere,
  type PaymentRegisterFilters,
} from "@/lib/reports/report-where";
import {
  registerLines,
  registerPage,
  summarizeRegister,
  type RegisterSource,
} from "@/lib/payments/payment-register";
import { formatPaymentNumber } from "@/lib/payments/receipt-number";
import { paymentNumbersAvailable } from "@/lib/payments/payment-number";
import {
  gatewayColumnsAvailable,
  gatewayReferenceSelect,
} from "@/lib/payments/gateway-columns";
import { PaymentStatus } from "@/types";
import {
  isOnlinePayment,
  PAYMENT_RECORDER_SELECT,
  recorderName,
} from "@/lib/payments/recorder";
import {
  installmentAsAt,
  installmentPayments,
  REPORT_PAYMENT_SELECT,
  paymentReceiver,
  paymentReference,
  receivedAmount,
  reportMethod,
} from "@/lib/payments/report-lines";
import {
  CHARGE_GROUPS,
  DEFAULT_CHARGE_FILTER,
  chargeGroup,
  inChargeFilter,
  utilitiesOnInvoice,
  type ChargeFilter,
  type ChargeGroup,
} from "@/lib/payments/charge-category";
import type {
  CollectionRow,
  CollectionsReport,
  InstallmentPayment,
} from "@/types/payment-report";
import { businessDaysOverdue, startOfBusinessDay } from "@/lib/dates/business-day";

export type PaymentReportType =
  | "overdue-tenants"
  | "overdue"
  | "outstanding"
  | "collections"
  | "collections-by-building"
  | "expenses-by-building";

export const PAYMENT_REPORT_TYPES: readonly PaymentReportType[] = [
  "overdue-tenants",
  "overdue",
  "outstanding",
  "collections",
  "collections-by-building",
  "expenses-by-building",
] as const;

export function isPaymentReportType(
  value: unknown,
): value is PaymentReportType {
  return PAYMENT_REPORT_TYPES.includes(value as PaymentReportType);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

const INVOICE_INCLUDE = {
  tenant: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
    },
  },
  property: {
    select: { id: true, name: true, addressCity: true, ownerId: true },
  },
  // The reference report the scope supplies is keyed on the CONTRACT, not the
  // invoice: an owner chasing a late payment asks about contract 4412, not
  // about invoice INV-000871. The unit comes through the contract for the same
  // reason — the invoice only stores a unit id, not its number.
  lease: {
    select: {
      id: true,
      contractNumber: true,
      unit: { select: { unitNumber: true } },
    },
  },
} as const;

export interface ReceivableRow {
  invoiceId: string;
  invoiceNumber: string;
  /** The office's contract reference — what the owner actually asks about. */
  contractNumber: string;
  tenantId: string;
  tenantName: string;
  tenantEmail: string;
  tenantPhone: string;
  propertyId: string;
  propertyName: string;
  ownerId: string | null;
  unitId: string | null;
  unitNumber: string;
  /** The invoice's own category ("rent", "security_deposit"…). */
  category: string;
  /** Rent, deposit or another charge — see lib/payments/charge-category. */
  chargeGroup: ChargeGroup;
  /**
   * The electricity and water billed on this installment, before tax — the
   * utilities that come with the rent. Zero when it carries none.
   */
  utilitiesAmount: number;
  issueDate: string;
  dueDate: string;
  daysOverdue: number;
  /**
   * Due or overdue, read against the date the report was asked about. The
   * review asks for the two to be told apart "based on the due date", and a
   * stored invoice status cannot do that — it only changes when something
   * touches the row.
   */
  state: "due" | "overdue";
  totalAmount: number;
  amountPaid: number;
  /** The latest payment's own date; null when nothing has been paid. */
  lastPaymentDate: string | null;
  /**
   * The payments on this installment, oldest first. On a register of money
   * still owed, every one of them is a part payment — the client asked for
   * each to appear separately, with its date.
   */
  payments: InstallmentPayment[];
  /** Any reduction already applied to this installment. */
  discountAmount: number;
  balance: number;
  status: string;
}

/** 0 means "not yet due"; the buckets only ever hold overdue money. */
export interface AgingBuckets {
  current: number;
  days1to30: number;
  days31to60: number;
  days61to90: number;
  days90plus: number;
}

/** What is owed in one group of charges, under the same filters. */
export interface ChargeGroupTotal {
  group: ChargeGroup;
  invoiceCount: number;
  balance: number;
  overdueBalance: number;
}

export interface ReceivablesReport {
  rows: ReceivableRow[];
  summary: {
    /** The charges the rows hold. */
    category: ChargeFilter;
    invoiceCount: number;
    tenantCount: number;
    totalBilled: number;
    totalPaid: number;
    totalBalance: number;
    overdueBalance: number;
    aging: AgingBuckets;
    /**
     * Every group under the same filters, the listed one included. A deposit
     * or a fee is reported beside the rent this way rather than mixed into
     * it — or silently dropped.
     */
    byCategory: ChargeGroupTotal[];
  };
}

interface ReceivablesOptions {
  /** Who is asking — see the note in buildReceivables. */
  actor: ScopeActor;
  propertyId?: string;
  /**
   * Restrict to one owner's portfolio. The office manages for several owners
   * at once, so "who is late" is almost always asked about one of them —
   * filtered through the property, because ownership lives there.
   */
  ownerId?: string;
  /** One tenant — "allow selecting a specific tenant", as the review puts it. */
  tenantId?: string;
  /** Only invoices due on or before this date (defaults to no ceiling). */
  asOf?: Date;
  /** Only invoices falling due in this window — the due-payments register. */
  dueFrom?: Date;
  dueTo?: Date;
  overdueOnly: boolean;
  /** Which charges the rows hold; rent unless asked otherwise. */
  category?: ChargeFilter;
  /**
   * The moment the register is read at — the end of the "as at" day. Before
   * this moment, it is a snapshot: see installmentAsAt. Defaults to now.
   */
  now?: Date;
}

function emptyAging(): AgingBuckets {
  return { current: 0, days1to30: 0, days31to60: 0, days61to90: 0, days90plus: 0 };
}

/**
 * Backing query for both the overdue and the outstanding reports — they differ
 * only in whether invoices that are not yet due are included, so keeping them
 * one function means the two can never drift in how a balance is computed.
 */
async function buildReceivables(
  options: ReceivablesOptions,
): Promise<ReceivablesReport> {
  const clock = new Date();
  const now = options.now ?? clock;
  const category = options.category ?? DEFAULT_CHARGE_FILTER;
  // Read as at a moment already past, the register is what was owed THEN:
  // installments paid off since are read too, and every payment made after
  // the moment is taken back off (installmentAsAt). It used to be today's
  // arrears under an old date.
  const snapshotAt = now < clock ? now : null;

  // Due dates are stored at midnight, so a bill is only late once its due day
  // has fully passed — otherwise rent shows as overdue on the morning it is due.
  // The day turns over at midnight in Riyadh.
  const overdueBefore = startOfBusinessDay(now);

  // What this caller is entitled to, intersected with what they filtered
  // by. Built from the query parameters alone, these registers handed a
  // narrowed employee the whole organization's receivables — and with the
  // scope spread in ahead of those parameters, a `propertyId` or `tenantId`
  // in the URL still replaced it. See lib/reports/report-where.ts.
  //
  // Every charge is read, not only the ones listed, so the other groups can
  // be reported beside them (summary.byCategory).
  const invoices = await db.invoice.findMany({
    where: receivablesWhere(
      {
        ...options,
        category: "all",
        overdueBefore,
        paidAfter: snapshotAt ?? undefined,
      },
      invoiceScope(options.actor),
    ),
    include: INVOICE_INCLUDE,
    orderBy: { dueDate: "asc" },
  });

  // Every installment's payments in one query for the whole register, not
  // one per row. Read through `paymentIds`, the installment's own list of
  // what was applied to it — see installmentPayments.
  const paymentIds = [
    ...new Set(invoices.flatMap((invoice) => invoice.paymentIds ?? [])),
  ];
  const payments = paymentIds.length
    ? await db.payment.findMany({
        where: withScope(
          { id: { in: paymentIds }, deletedAt: null },
          paymentScope(options.actor),
        ),
        // With its number, and any gateway's reference, once the database
        // has them (payment-number.ts, gateway-columns.ts).
        select: {
          ...REPORT_PAYMENT_SELECT,
          number: await paymentNumbersAvailable(),
          ...(await gatewayReferenceSelect()),
        },
      })
    : [];
  const paymentsById = new Map(payments.map((payment) => [payment.id, payment]));

  // Every installment still owing at the moment read, whatever its charge.
  const owing: ReceivableRow[] = [];
  for (const invoice of invoices) {
    // What tenants owe: an invoice to an owner or a customer is not one.
    const { tenantId, propertyId } = invoice;
    if (!tenantId || !propertyId) continue;
    const standing = installmentAsAt(
      invoice,
      installmentPayments(invoice, paymentsById),
      snapshotAt,
    );
    // Paid off by then — read only because it was settled afterwards.
    if (standing.balance <= 0.005) continue;

    // Calendar days late: 1 on the day after the due day, whatever the hour.
    const daysOverdue = businessDaysOverdue(invoice.dueDate, now);

    owing.push({
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      contractNumber: invoice.lease?.contractNumber ?? "",
      tenantId,
      tenantName:
        `${invoice.tenant?.firstName ?? ""} ${invoice.tenant?.lastName ?? ""}`.trim(),
      tenantEmail: invoice.tenant?.email ?? "",
      tenantPhone: invoice.tenant?.phone ?? "",
      propertyId,
      propertyName: invoice.property?.name ?? "",
      ownerId: invoice.property?.ownerId ?? null,
      unitId: invoice.unitId,
      unitNumber: invoice.lease?.unit?.unitNumber ?? "",
      category: invoice.category,
      chargeGroup: chargeGroup(invoice.category),
      utilitiesAmount:
        chargeGroup(invoice.category) === "rent"
          ? utilitiesOnInvoice(invoice.lineItems)
          : 0,
      issueDate: invoice.issueDate.toISOString(),
      dueDate: invoice.dueDate.toISOString(),
      daysOverdue,
      state: daysOverdue > 0 ? "overdue" : "due",
      totalAmount: invoice.totalAmount,
      amountPaid: standing.amountPaid,
      lastPaymentDate: standing.lastPaymentDate,
      payments: standing.payments,
      discountAmount: invoice.discountAmount,
      balance: standing.balance,
      status: invoice.status,
    });
  }

  const byCategory: ChargeGroupTotal[] = CHARGE_GROUPS.map((group) => {
    const inGroup = owing.filter((row) => row.chargeGroup === group);
    return {
      group,
      invoiceCount: inGroup.length,
      balance: round(inGroup.reduce((sum, row) => sum + row.balance, 0)),
      overdueBalance: round(
        inGroup
          .filter((row) => row.daysOverdue > 0)
          .reduce((sum, row) => sum + row.balance, 0),
      ),
    };
  });

  const rows = owing.filter((row) => inChargeFilter(row.category, category));

  const aging = emptyAging();
  const tenants = new Set<string>();
  let totalBilled = 0;
  let totalPaid = 0;
  let totalBalance = 0;
  let overdueBalance = 0;

  for (const row of rows) {
    const { balance, daysOverdue } = row;
    tenants.add(row.tenantId);
    totalBilled = round(totalBilled + row.totalAmount);
    totalPaid = round(totalPaid + row.amountPaid);
    totalBalance = round(totalBalance + balance);

    if (daysOverdue <= 0) {
      aging.current = round(aging.current + balance);
    } else {
      overdueBalance = round(overdueBalance + balance);
      if (daysOverdue <= 30) aging.days1to30 = round(aging.days1to30 + balance);
      else if (daysOverdue <= 60)
        aging.days31to60 = round(aging.days31to60 + balance);
      else if (daysOverdue <= 90)
        aging.days61to90 = round(aging.days61to90 + balance);
      else aging.days90plus = round(aging.days90plus + balance);
    }
  }

  return {
    rows,
    summary: {
      category,
      invoiceCount: rows.length,
      tenantCount: tenants.size,
      totalBilled,
      totalPaid,
      totalBalance,
      overdueBalance,
      aging,
      byCategory,
    },
  };
}

/**
 * Report 1 — everything past its due date and still unpaid, as at the end of
 * the day asked about (`now`).
 */
export function getOverdueReport(options: {
  propertyId?: string;
  ownerId?: string;
  tenantId?: string;
  /** Rent unless asked otherwise — see lib/payments/charge-category. */
  category?: ChargeFilter;
  now?: Date;
  /** Who is asking — see buildReceivables. */
  actor: ScopeActor;
}): Promise<ReceivablesReport> {
  return buildReceivables({ ...options, overdueOnly: true });
}

/**
 * Report 2 — rent falling due in a window and not yet paid.
 *
 * "Due Rent Payments (filter by date and allow selecting a specific tenant)":
 * the window is on the due date, and each row says whether it is merely due
 * or already overdue as of today — the distinction the review asks to be
 * made on the due date itself.
 */
export function getOutstandingReport(options: {
  propertyId?: string;
  ownerId?: string;
  tenantId?: string;
  /** Rent unless asked otherwise — see lib/payments/charge-category. */
  category?: ChargeFilter;
  asOf?: Date;
  dueFrom?: Date;
  dueTo?: Date;
  now?: Date;
  /** Who is asking — see buildReceivables. */
  actor: ScopeActor;
}): Promise<ReceivablesReport> {
  return buildReceivables({ ...options, overdueOnly: false });
}

export interface OverdueTenantRow {
  tenantId: string;
  tenantName: string;
  tenantPhone: string;
  tenantEmail: string;
  /** Every contract with an overdue installment, by the office's number. */
  contracts: string[];
  /** "Building · unit", for each place the tenant is late on. */
  units: string[];
  installmentCount: number;
  totalOverdue: number;
  oldestDueDate: string;
  maxDaysOverdue: number;
  /**
   * The overdue installments behind the totals, oldest first, each with its
   * payments — what the screen opens up and the export lists row by row.
   */
  installments: ReceivableRow[];
}

export interface OverdueTenantsReport {
  rows: OverdueTenantRow[];
  summary: {
    /** The charges the tenants are late on. */
    category: ChargeFilter;
    tenantCount: number;
    installmentCount: number;
    totalOverdue: number;
    over90: number;
    aging: AgingBuckets;
    /** Every group's overdue money under the same filters. */
    byCategory: ChargeGroupTotal[];
  };
}

/**
 * Report 0 — who is late, one row per tenant.
 *
 * The overdue register lists installments, so a tenant three months behind
 * appears three times and the office has to add them up. This is the same
 * query folded by tenant: how much, since when, on which contracts — and it
 * reads due dates against the date asked about, not a stored status that only
 * a nightly job updates.
 */
export async function getOverdueTenantsReport(options: {
  propertyId?: string;
  ownerId?: string;
  tenantId?: string;
  /**
   * Rent unless asked otherwise: a tenant whose only arrears are a deposit
   * is reported beside the rent, not counted as late on it.
   */
  category?: ChargeFilter;
  now?: Date;
  actor: ScopeActor;
}): Promise<OverdueTenantsReport> {
  const overdue = await buildReceivables({ ...options, overdueOnly: true });

  const byTenant = new Map<string, OverdueTenantRow>();
  let over90 = 0;
  for (const row of overdue.rows) {
    const key = row.tenantId;
    const entry =
      byTenant.get(key) ??
      ({
        tenantId: key,
        tenantName: row.tenantName,
        tenantPhone: row.tenantPhone,
        tenantEmail: row.tenantEmail,
        contracts: [],
        units: [],
        installmentCount: 0,
        totalOverdue: 0,
        oldestDueDate: row.dueDate,
        maxDaysOverdue: 0,
        installments: [],
      } satisfies OverdueTenantRow);

    entry.installments.push(row);
    entry.installmentCount += 1;
    entry.totalOverdue = round(entry.totalOverdue + row.balance);
    if (row.contractNumber && !entry.contracts.includes(row.contractNumber)) {
      entry.contracts.push(row.contractNumber);
    }
    const place = [row.propertyName, row.unitNumber].filter(Boolean).join(" · ");
    if (place && !entry.units.includes(place)) entry.units.push(place);
    if (new Date(row.dueDate) < new Date(entry.oldestDueDate)) {
      entry.oldestDueDate = row.dueDate;
    }
    entry.maxDaysOverdue = Math.max(entry.maxDaysOverdue, row.daysOverdue);
    if (row.daysOverdue > 90) over90 = round(over90 + row.balance);
    byTenant.set(key, entry);
  }

  const rows = [...byTenant.values()].sort(
    (a, b) => b.totalOverdue - a.totalOverdue,
  );

  return {
    rows,
    summary: {
      category: overdue.summary.category,
      tenantCount: rows.length,
      installmentCount: overdue.rows.length,
      totalOverdue: overdue.summary.overdueBalance,
      over90,
      aging: overdue.summary.aging,
      byCategory: overdue.summary.byCategory,
    },
  };
}

/**
 * The overdue register's headline alone — how much is late, on how many
 * installments, owed by how many tenants — counted in the database for the
 * dashboard and the menu's badge.
 *
 * Read for today, where an installment's balance is what it holds now, so the
 * same `where` the register runs gives the same figures (the register's own
 * snapshot arithmetic only differs for a date already past).
 */
export async function getReceivablesTotals(options: {
  actor: ScopeActor;
  /** Overdue as at today, or due in a window. */
  overdueOnly: boolean;
  dueFrom?: Date;
  dueTo?: Date;
  category?: ChargeFilter;
  now?: Date;
}): Promise<{ invoiceCount: number; tenantCount: number; balance: number }> {
  const overdueBefore = startOfBusinessDay(options.now);

  const where = receivablesWhere(
    {
      overdueOnly: options.overdueOnly,
      overdueBefore,
      dueFrom: options.dueFrom,
      dueTo: options.dueTo,
      category: options.category ?? DEFAULT_CHARGE_FILTER,
    },
    invoiceScope(options.actor),
  );

  const [totals, tenants] = await Promise.all([
    db.invoice.aggregate({
      where,
      _count: { _all: true },
      _sum: { balanceRemaining: true },
    }),
    db.invoice.groupBy({ by: ["tenantId"], where }),
  ]);

  return {
    invoiceCount: totals._count._all,
    tenantCount: tenants.length,
    balance: round(Number(totals._sum.balanceRemaining ?? 0)),
  };
}

export type { CollectionRow, CollectionsReport };

/** The payment report's options: its period, its filters, the page. */
export interface CollectionsReportOptions extends PaymentRegisterFilters {
  startDate: Date;
  endDate: Date;
  /** From 1. With no page, every line — the exports read it that way. */
  page?: number;
  limit?: number;
  /** The totals and breakdowns alone, no rows — the analytics page. */
  summaryOnly?: boolean;
  /** Who is asking — see buildReceivables. */
  actor: ScopeActor;
}

/** What a line is placed and added up from: light, read for every line. */
const REGISTER_SOURCE_SELECT = {
  id: true,
  status: true,
  paidDate: true,
  createdAt: true,
  updatedAt: true,
  amount: true,
  amountPaid: true,
  paymentMethod: true,
  type: true,
  propertyId: true,
  tenantId: true,
  property: { select: { name: true } },
  tenant: { select: { firstName: true, lastName: true } },
} as const;

type RegisterSourceRow = {
  id: string;
  status: string;
  paidDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
  amount: number;
  amountPaid: number;
  paymentMethod: string | null;
  type: string;
  propertyId: string;
  tenantId: string;
  paymentHistory?: unknown;
  property: { name: string } | null;
  tenant: { firstName: string; lastName: string } | null;
};

function toRegisterSource(row: RegisterSourceRow): RegisterSource {
  return {
    ...row,
    propertyName: row.property?.name ?? null,
    tenantName:
      `${row.tenant?.firstName ?? ""} ${row.tenant?.lastName ?? ""}`.trim() || null,
  };
}

/**
 * Report 3 — the payment report: every payment received in the period, on
 * the day its money arrived, and every refund made in it as its own negative
 * line (see lib/payments/payment-register.ts).
 *
 * Filtered on the paid date, not `createdAt`: a payment recorded today for a
 * transfer that landed last month belongs to last month. The totals and the
 * breakdowns are over every line the filters match; the rows are the page
 * asked for, read in full only for that page.
 */
export async function getCollectionsReport(
  options: CollectionsReportOptions,
): Promise<CollectionsReport> {
  const scope = paymentScope(options.actor);
  const filters: PaymentRegisterFilters = {
    propertyId: options.propertyId,
    ownerId: options.ownerId,
    compoundId: options.compoundId,
    unitId: options.unitId,
    leaseId: options.leaseId,
    tenantId: options.tenantId,
    method: options.method,
    receiver: options.receiver,
    paymentType: options.paymentType,
    recordedBy: options.recordedBy,
    status: options.status,
  };
  // The same filters as the receivables builder: AND-ed with the scope.
  const where = paymentRegisterWhere(filters, scope, {
    gatewayColumns: await gatewayColumnsAvailable(),
  });
  const window = { start: options.startDate, end: options.endDate };
  // A refund can only be on a refunded payment.
  const readRefunds = !filters.status || filters.status === PaymentStatus.REFUNDED;

  const [receipts, refunds, withNumber] = await Promise.all([
    db.payment.findMany({
      where: { AND: [where, { paidDate: { gte: window.start, lte: window.end } }] },
      select: REGISTER_SOURCE_SELECT,
    }),
    readRefunds
      ? db.payment.findMany({
          where: { AND: [where, { status: PaymentStatus.REFUNDED }] },
          select: { ...REGISTER_SOURCE_SELECT, paymentHistory: true },
        })
      : Promise.resolve([]),
    paymentNumbersAvailable(),
  ]);

  const sources = new Map<string, RegisterSource>();
  for (const row of [...receipts, ...refunds] as RegisterSourceRow[]) {
    const known = sources.get(row.id);
    // The refund read carries the history; keep it.
    if (!known || row.paymentHistory !== undefined) {
      sources.set(row.id, toRegisterSource(row));
    }
  }
  const lines = registerLines(
    (receipts as RegisterSourceRow[]).map(toRegisterSource),
    (refunds as RegisterSourceRow[]).map(toRegisterSource),
    window,
  );
  const summary = summarizeRegister(lines, sources);

  const paged = options.page
    ? registerPage(lines, options.page, options.limit ?? 25)
    : {
        lines,
        page: 1,
        limit: lines.length,
        total: lines.length,
        totalPages: 1,
      };

  // The page in full: who, where, which contract and installment, how it
  // was paid, the reference, who recorded it, and its number.
  const pageIds = options.summaryOnly
    ? []
    : [...new Set(paged.lines.map((line) => line.paymentId))];
  const details = pageIds.length
    ? await db.payment.findMany({
        where: withScope({ id: { in: pageIds } }, scope),
        select: {
          id: true,
          number: withNumber,
          propertyId: true,
          tenantId: true,
          type: true,
          status: true,
          paymentMethod: true,
          notes: true,
          paymentHistory: true,
          ...(await gatewayReferenceSelect()),
          stripePaymentIntentId: true,
          stripeCheckoutSessionId: true,
          paypalCaptureId: true,
          razorpayPaymentId: true,
          paystackReference: true,
          tenant: { select: { firstName: true, lastName: true, phone: true } },
          property: { select: { name: true } },
          // The contract, and the unit through it, as on the receivables.
          lease: {
            select: {
              contractNumber: true,
              unit: { select: { unitNumber: true } },
            },
          },
          // The installment the payment paid.
          invoice: { select: { id: true, invoiceNumber: true, dueDate: true } },
          recordedBy: { select: PAYMENT_RECORDER_SELECT },
        },
      })
    : [];
  const detailById = new Map(details.map((detail) => [detail.id, detail]));

  const rows: CollectionRow[] = [];
  for (const line of paged.lines) {
    const payment = detailById.get(line.paymentId);
    if (!payment) continue;
    rows.push({
      paymentId: payment.id,
      lineType: line.type,
      paymentNumber: formatPaymentNumber(
        (payment as { number?: number | null }).number,
      ),
      paidDate: line.date.toISOString(),
      tenantId: payment.tenantId,
      tenantName:
        `${payment.tenant?.firstName ?? ""} ${payment.tenant?.lastName ?? ""}`.trim(),
      tenantPhone: payment.tenant?.phone ?? "",
      propertyId: payment.propertyId,
      propertyName: payment.property?.name ?? "",
      unitNumber: payment.lease?.unit?.unitNumber ?? "",
      contractNumber: payment.lease?.contractNumber ?? "",
      invoiceId: payment.invoice?.id ?? null,
      invoiceNumber: payment.invoice?.invoiceNumber ?? "",
      installmentDueDate: payment.invoice?.dueDate.toISOString() ?? null,
      method: reportMethod(payment.paymentMethod),
      receiver: paymentReceiver(payment.paymentMethod),
      reference: paymentReference(payment),
      recordedBy: recorderName(payment),
      online: isOnlinePayment(payment),
      type: payment.type,
      status: payment.status,
      amount: line.amount,
      notes: payment.notes,
    });
  }

  return {
    rows,
    summary,
    pagination: {
      page: paged.page,
      limit: paged.limit,
      total: paged.total,
      totalPages: paged.totalPages,
    },
  };
}

export interface BuildingCollectionRow {
  propertyId: string;
  propertyName: string;
  city: string;
  paymentCount: number;
  collected: number;
  /** Still owed on this building as at the report's end date. */
  outstanding: number;
}

export interface BuildingCollectionsReport {
  rows: BuildingCollectionRow[];
  summary: {
    buildingCount: number;
    totalCollected: number;
    totalOutstanding: number;
  };
}

/**
 * Report 4 — collections rolled up per building for a window.
 *
 * One property lookup, one read of the window's payments and one of what is
 * owed, rather than a query per building: a management office with hundreds
 * of buildings would otherwise make hundreds of round trips to render one
 * page.
 */
export async function getCollectionsByBuildingReport(options: {
  startDate: Date;
  endDate: Date;
  propertyId?: string;
  /**
   * One owner's buildings — see ReceivablesOptions.ownerId. The page offered
   * the filter and this report used to ignore it.
   */
  ownerId?: string;
  /** Who is asking — see buildReceivables. */
  actor: ScopeActor;
}): Promise<BuildingCollectionsReport> {
  // The buildings this reader holds, or the one of them that was asked for.
  // This report took the actor and never read it: every building in the
  // organization was listed, with its collections, for whoever could open
  // the page.
  const properties = await db.property.findMany({
    where: buildingsWhere(
      { propertyId: options.propertyId, ownerId: options.ownerId },
      propertyScope(options.actor),
    ),
    select: { id: true, name: true, addressCity: true },
    orderBy: { name: "asc" },
  });

  if (properties.length === 0) {
    return {
      rows: [],
      summary: { buildingCount: 0, totalCollected: 0, totalOutstanding: 0 },
    };
  }

  // Collected: the payments-received register's own payments, added up its
  // way (receivedAmount), so this report's total is that register's total.
  // Outstanding: what the arrears registers say was owed at the end of the
  // window — every charge, and for a window already past, as it stood then.
  // Both scoped as well as filtered: for anyone scoped by something other
  // than the building, the building list alone would total everyone's money
  // in it.
  const [payments, owed] = await Promise.all([
    db.payment.findMany({
      where: collectionsWhere(
        {
          startDate: options.startDate,
          endDate: options.endDate,
          propertyId: options.propertyId,
          ownerId: options.ownerId,
        },
        paymentScope(options.actor),
      ),
      select: { propertyId: true, amount: true, amountPaid: true },
    }),
    buildReceivables({
      actor: options.actor,
      propertyId: options.propertyId,
      ownerId: options.ownerId,
      dueTo: options.endDate,
      overdueOnly: false,
      category: "all",
      now: options.endDate,
    }),
  ]);

  const collectedBy = new Map<string, { count: number; amount: number }>();
  for (const payment of payments) {
    const bucket = collectedBy.get(payment.propertyId) ?? { count: 0, amount: 0 };
    bucket.count += 1;
    bucket.amount = round(bucket.amount + receivedAmount(payment));
    collectedBy.set(payment.propertyId, bucket);
  }
  const outstandingBy = new Map<string, number>();
  for (const row of owed.rows) {
    outstandingBy.set(
      row.propertyId,
      round((outstandingBy.get(row.propertyId) ?? 0) + row.balance),
    );
  }

  let totalCollected = 0;
  let totalOutstanding = 0;

  const rows: BuildingCollectionRow[] = properties.map((property) => {
    const paid = collectedBy.get(property.id);
    const due = outstandingBy.get(property.id) ?? 0;
    totalCollected = round(totalCollected + (paid?.amount ?? 0));
    totalOutstanding = round(totalOutstanding + due);

    return {
      propertyId: property.id,
      propertyName: property.name,
      city: property.addressCity,
      paymentCount: paid?.count ?? 0,
      collected: round(paid?.amount ?? 0),
      outstanding: round(due),
    };
  });

  return {
    rows,
    summary: {
      buildingCount: rows.length,
      totalCollected,
      totalOutstanding,
    },
  };
}

export interface BuildingExpenseRow {
  propertyId: string;
  propertyName: string;
  city: string;
  expenseCount: number;
  total: number;
  /** Largest category for this building, so the row explains itself. */
  topCategory: string;
  byCategory: Array<{ category: string; amount: number }>;
}

export interface BuildingExpensesReport {
  rows: BuildingExpenseRow[];
  summary: {
    buildingCount: number;
    expenseCount: number;
    totalExpenses: number;
    unassignedTotal: number;
    byCategory: Array<{ category: string; amount: number }>;
  };
}

/**
 * Report 5 — expenses per building for a window.
 *
 * Expenses may carry no property (an office-level cost), so those are summed
 * separately rather than silently dropped or misattributed to a building.
 */
export async function getExpensesByBuildingReport(options: {
  startDate: Date;
  endDate: Date;
  propertyId?: string;
  /** One owner's buildings; the office's own costs belong to no owner. */
  ownerId?: string;
  /** Who is asking — see buildReceivables. */
  actor: ScopeActor;
}): Promise<BuildingExpensesReport> {
  // Narrowed to the buildings this reader holds, like the collections report
  // above — this one also took the actor and never read it. An office-level
  // expense carries no building, so a narrowed reader does not see those.
  // Approved and paid expenses only, as everywhere a cost is reported — see
  // COUNTED_EXPENSE_STATUSES.
  const grouped = await db.expense.groupBy({
    by: ["propertyId", "category"],
    where: buildingExpensesWhere(options, expenseScope(options.actor)),
    _count: { _all: true },
    _sum: { amount: true },
  });

  const propertyIds = [
    ...new Set(
      grouped
        .map((group) => group.propertyId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const properties = propertyIds.length
    ? await db.property.findMany({
        where: { id: { in: propertyIds } },
        select: { id: true, name: true, addressCity: true },
      })
    : [];
  const propertyById = new Map(properties.map((p) => [p.id, p]));

  const perProperty = new Map<
    string,
    { count: number; total: number; byCategory: Map<string, number> }
  >();
  const overallByCategory = new Map<string, number>();

  let totalExpenses = 0;
  let expenseCount = 0;
  let unassignedTotal = 0;

  for (const group of grouped) {
    const amount = round(Number(group._sum.amount ?? 0));
    const count = group._count._all;
    totalExpenses = round(totalExpenses + amount);
    expenseCount += count;

    overallByCategory.set(
      group.category,
      round((overallByCategory.get(group.category) ?? 0) + amount),
    );

    if (!group.propertyId) {
      unassignedTotal = round(unassignedTotal + amount);
      continue;
    }

    const bucket = perProperty.get(group.propertyId) ?? {
      count: 0,
      total: 0,
      byCategory: new Map<string, number>(),
    };
    bucket.count += count;
    bucket.total = round(bucket.total + amount);
    bucket.byCategory.set(
      group.category,
      round((bucket.byCategory.get(group.category) ?? 0) + amount),
    );
    perProperty.set(group.propertyId, bucket);
  }

  const rows: BuildingExpenseRow[] = [...perProperty.entries()]
    .map(([propertyId, bucket]) => {
      const byCategory = [...bucket.byCategory.entries()]
        .map(([category, amount]) => ({ category, amount }))
        .sort((a, b) => b.amount - a.amount);

      const property = propertyById.get(propertyId);
      return {
        propertyId,
        propertyName: property?.name ?? propertyId,
        city: property?.addressCity ?? "",
        expenseCount: bucket.count,
        total: bucket.total,
        topCategory: byCategory[0]?.category ?? "",
        byCategory,
      };
    })
    .sort((a, b) => b.total - a.total);

  return {
    rows,
    summary: {
      buildingCount: rows.length,
      expenseCount,
      totalExpenses,
      unassignedTotal,
      byCategory: [...overallByCategory.entries()]
        .map(([category, amount]) => ({ category, amount }))
        .sort((a, b) => b.amount - a.amount),
    },
  };
}
