/**
 * PropertyPro - Collection
 *
 * "How much of what we billed have we actually got in?" — answered per
 * contract and per tenant, which is how a collections clerk works: chase a
 * contract, or chase a person who holds several.
 *
 * Billed and collected both come from the invoice rows, not from the payment
 * rows, so a payment recorded but not yet applied to an invoice cannot make
 * the collection rate look better than the ledger does.
 */

import { db } from "@/lib/db/prisma";
import {
  invoiceScope,
  paymentScope,
  withScope,
  type ScopeActor,
} from "@/lib/db/scopes";
import { LeaseStatus } from "@/types";
import { collectionInvoicesWhere } from "@/lib/reports/report-where";
import {
  installmentPayments,
  REPORT_PAYMENT_SELECT,
} from "@/lib/payments/report-lines";
import { paymentNumbersAvailable } from "@/lib/payments/payment-number";
import { gatewayReferenceSelect } from "@/lib/payments/gateway-columns";
import type { CollectionPaymentLine } from "@/types/collection";
import { isPastDue } from "@/lib/dates/business-day";

export type CollectionScope = "by-contract" | "by-tenant";

export const COLLECTION_SCOPES: readonly CollectionScope[] = [
  "by-contract",
  "by-tenant",
] as const;

export function isCollectionScope(value: unknown): value is CollectionScope {
  return COLLECTION_SCOPES.includes(value as CollectionScope);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Collected ÷ billed, as a percentage. Nothing billed reads as 100%. */
function rate(collected: number, billed: number): number {
  if (billed <= 0) return 100;
  return Math.round((collected / billed) * 1000) / 10;
}

export interface CollectionRecord {
  /** Contract id, or tenant id when grouping by tenant. */
  id: string;
  label: string;
  sublabel: string;
  /** Present on contract rows so the clerk can open the contract. */
  leaseId: string | null;
  contractNumber: string | null;
  tenantId: string;
  tenantName: string;
  /** The tenant's mobile number; "" when none is on file. */
  tenantPhone: string;
  propertyName: string;
  /**
   * Every building and unit the row covers: one each on a contract's row,
   * every one the tenant rents in on a tenant's row.
   */
  buildings: string[];
  units: string[];
  status: string;
  invoiceCount: number;
  billed: number;
  collected: number;
  outstanding: number;
  overdue: number;
  overdueCount: number;
  collectionRate: number;
  /** Oldest unpaid due date — what a clerk sorts a chase list by. */
  oldestDueDate: string | null;
  currency: string;
  /**
   * The payments behind "collected", oldest first, each under the
   * installment it paid and with its own date — the totals alone could not
   * say when any of the money came in.
   */
  payments: CollectionPaymentLine[];
}

export interface CollectionSummary {
  recordCount: number;
  invoiceCount: number;
  totalBilled: number;
  totalCollected: number;
  totalOutstanding: number;
  totalOverdue: number;
  collectionRate: number;
  fullyCollected: number;
  withArrears: number;
}

export interface CollectionReport {
  scope: CollectionScope;
  records: CollectionRecord[];
  summary: CollectionSummary;
}

interface CollectionOptions {
  /**
   * Who is asking. Required, as on the other registers: this one was built
   * from the query string alone, so a reader narrowed to a few buildings got
   * every contract's arrears in the organization.
   */
  actor: ScopeActor;
  scope: CollectionScope;
  /** Only installments falling due in this window. */
  startDate?: Date;
  endDate?: Date;
  propertyId?: string;
  /** One owner's buildings, through the building. */
  ownerId?: string;
  /** One compound's buildings, through the building. */
  compoundId?: string;
  tenantId?: string;
  /** Only rows that still owe something — the chase list. */
  arrearsOnly?: boolean;
  now?: Date;
}

/**
 * Build the collection view.
 *
 * One invoice query drives everything; grouping happens in memory because a
 * row needs several derived figures (overdue split, oldest due date,
 * collection rate) that a single SQL `groupBy` cannot produce together.
 */
export async function getCollectionReport(
  options: CollectionOptions,
): Promise<CollectionReport> {
  const now = options.now ?? new Date();

  // The filters narrow what the reader may see; the scope is AND-ed on, so
  // no parameter can replace it. See lib/reports/report-where.ts.
  const invoices = await db.invoice.findMany({
    where: collectionInvoicesWhere(
      {
        propertyId: options.propertyId,
        ownerId: options.ownerId,
        compoundId: options.compoundId,
        tenantId: options.tenantId,
        dueFrom: options.startDate,
        dueTo: options.endDate,
      },
      invoiceScope(options.actor),
    ),
    select: {
      id: true,
      invoiceNumber: true,
      leaseId: true,
      tenantId: true,
      propertyId: true,
      dueDate: true,
      totalAmount: true,
      amountPaid: true,
      balanceRemaining: true,
      paymentIds: true,
      currency: true,
      tenant: {
        select: { firstName: true, lastName: true, email: true, phone: true },
      },
      property: { select: { name: true } },
    },
  });

  // Every installment's payments in one query, read through the
  // installment's own list of what was applied to it, as the arrears
  // registers read them — see lib/payments/report-lines.
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

  // Contract detail is only needed for rows that actually appear.
  const leaseIds = [
    ...new Set(
      invoices
        .map((invoice) => invoice.leaseId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const leases = leaseIds.length
    ? await db.lease.findMany({
        where: { id: { in: leaseIds } },
        select: {
          id: true,
          contractNumber: true,
          status: true,
          paymentFrequency: true,
          unit: { select: { unitNumber: true } },
        },
      })
    : [];
  const leaseById = new Map(leases.map((lease) => [lease.id, lease]));

  interface Bucket {
    key: string;
    leaseId: string | null;
    tenantId: string;
    tenantName: string;
    tenantPhone: string;
    propertyName: string;
    buildings: Set<string>;
    units: Set<string>;
    currency: string;
    invoiceCount: number;
    billed: number;
    collected: number;
    outstanding: number;
    overdue: number;
    overdueCount: number;
    oldestDue: Date | null;
    payments: CollectionPaymentLine[];
  }

  const buckets = new Map<string, Bucket>();

  for (const invoice of invoices) {
    // Collection is what tenants owe: an invoice to an owner or a customer
    // (no tenant) is not part of it.
    const tenantId = invoice.tenantId;
    if (!tenantId) continue;
    // An invoice with no lease still belongs to a tenant, so it counts in the
    // by-tenant view; it simply has no contract to group under.
    const key =
      options.scope === "by-contract"
        ? (invoice.leaseId ?? `tenant:${tenantId}`)
        : tenantId;

    const bucket = buckets.get(key) ?? {
      key,
      leaseId: options.scope === "by-contract" ? invoice.leaseId : null,
      tenantId,
      tenantName:
        `${invoice.tenant?.firstName ?? ""} ${invoice.tenant?.lastName ?? ""}`.trim(),
      tenantPhone: invoice.tenant?.phone ?? "",
      propertyName: invoice.property?.name ?? "",
      buildings: new Set<string>(),
      units: new Set<string>(),
      currency: invoice.currency,
      invoiceCount: 0,
      billed: 0,
      collected: 0,
      outstanding: 0,
      overdue: 0,
      overdueCount: 0,
      oldestDue: null,
      payments: [],
    };

    bucket.invoiceCount += 1;
    if (invoice.property?.name) bucket.buildings.add(invoice.property.name);
    const unitNumber = invoice.leaseId
      ? leaseById.get(invoice.leaseId)?.unit?.unitNumber
      : undefined;
    if (unitNumber) bucket.units.add(unitNumber);
    for (const line of installmentPayments(invoice, paymentsById)) {
      bucket.payments.push({
        ...line,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        installmentDueDate: invoice.dueDate.toISOString(),
      });
    }
    bucket.billed = round(bucket.billed + invoice.totalAmount);
    bucket.collected = round(bucket.collected + invoice.amountPaid);

    const balance = invoice.balanceRemaining;
    if (balance > 0) {
      bucket.outstanding = round(bucket.outstanding + balance);

      if (isPastDue(invoice.dueDate, now)) {
        bucket.overdue = round(bucket.overdue + balance);
        bucket.overdueCount += 1;
      }

      if (!bucket.oldestDue || invoice.dueDate < bucket.oldestDue) {
        bucket.oldestDue = invoice.dueDate;
      }
    }

    buckets.set(key, bucket);
  }

  let records: CollectionRecord[] = [...buckets.values()].map((bucket): CollectionRecord => {
    const lease = bucket.leaseId ? leaseById.get(bucket.leaseId) : undefined;
    const unit = lease?.unit?.unitNumber;

    const label =
      options.scope === "by-contract"
        ? (lease?.contractNumber ??
          (bucket.leaseId
            ? `${bucket.propertyName}${unit ? ` · ${unit}` : ""}`
            : bucket.tenantName))
        : bucket.tenantName || "—";

    // The building and the unit have columns of their own now, so the line
    // under a contract names its tenant, and a tenant needs none.
    const sublabel = options.scope === "by-contract" ? bucket.tenantName : "";

    return {
      id: bucket.key,
      label: label || "—",
      sublabel,
      leaseId: bucket.leaseId,
      contractNumber: lease?.contractNumber ?? null,
      tenantId: bucket.tenantId,
      tenantName: bucket.tenantName,
      tenantPhone: bucket.tenantPhone,
      propertyName: bucket.propertyName,
      buildings: [...bucket.buildings].sort((a, b) => a.localeCompare(b)),
      units: [...bucket.units].sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true }),
      ),
      status: lease?.status ?? LeaseStatus.ACTIVE,
      invoiceCount: bucket.invoiceCount,
      billed: bucket.billed,
      collected: bucket.collected,
      outstanding: bucket.outstanding,
      overdue: bucket.overdue,
      overdueCount: bucket.overdueCount,
      collectionRate: rate(bucket.collected, bucket.billed),
      oldestDueDate: bucket.oldestDue ? bucket.oldestDue.toISOString() : null,
      currency: bucket.currency,
      // ISO strings in one zone sort as dates.
      payments: bucket.payments.sort((a, b) =>
        a.paidDate < b.paidDate ? -1 : a.paidDate > b.paidDate ? 1 : 0,
      ),
    };
  });

  if (options.arrearsOnly) {
    records = records.filter((record) => record.outstanding > 0);
  }

  // Worst first: whoever owes most, and among equals whoever is latest.
  records.sort(
    (a, b) => b.outstanding - a.outstanding || b.overdue - a.overdue,
  );

  const summary = records.reduce<CollectionSummary>(
    (acc, record) => ({
      recordCount: acc.recordCount + 1,
      invoiceCount: acc.invoiceCount + record.invoiceCount,
      totalBilled: round(acc.totalBilled + record.billed),
      totalCollected: round(acc.totalCollected + record.collected),
      totalOutstanding: round(acc.totalOutstanding + record.outstanding),
      totalOverdue: round(acc.totalOverdue + record.overdue),
      collectionRate: 0,
      fullyCollected:
        acc.fullyCollected + (record.outstanding <= 0 ? 1 : 0),
      withArrears: acc.withArrears + (record.outstanding > 0 ? 1 : 0),
    }),
    {
      recordCount: 0,
      invoiceCount: 0,
      totalBilled: 0,
      totalCollected: 0,
      totalOutstanding: 0,
      totalOverdue: 0,
      collectionRate: 0,
      fullyCollected: 0,
      withArrears: 0,
    },
  );

  summary.collectionRate = rate(summary.totalCollected, summary.totalBilled);

  return { scope: options.scope, records, summary };
}
