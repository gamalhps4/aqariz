/**
 * PropertyPro - Property financial insights
 *
 * The numbers behind a single property's Reports tab: what it earns, what it
 * costs, what the office keeps, and what is left for the owner.
 *
 * The money is the building's statement (entity-statement.service.ts): the
 * same payments, the same deducted expenses, the commission each agreement
 * charged for its own part of the period, and the settlement of
 * lib/statements/settlement.ts — so the VAT on the commission is taken off
 * the owner's share, and money a tenant paid the owner directly (cash to the
 * owner, a transfer to the owner, Ejar) is counted as the owner's when the
 * dues are worked out. This page and the building statement can never
 * disagree. A property under no agreement — the self-managing landlord's
 * case — simply shows no commission rather than a gap.
 */

import { db } from "@/lib/db/prisma";
import type { ScopeActor } from "@/lib/db/scopes";
import {
  InvoiceStatus,
  LeaseStatus,
  PropertyStatus,
} from "@/types";
import { getEntityStatement } from "@/lib/services/entity-statement.service";
import { leaseAnnualRent } from "@/lib/lease-installments";
import type { StatementAgreementRef } from "@/types/entity-statement";
import {
  addBusinessDays,
  businessDayEnd,
  businessMonth,
  businessToday,
  isPastDue,
  startOfBusinessDay,
} from "@/lib/dates/business-day";

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

const OPEN_INVOICE_STATUSES = [
  InvoiceStatus.SCHEDULED,
  InvoiceStatus.ISSUED,
  InvoiceStatus.PARTIAL,
  InvoiceStatus.OVERDUE,
];

export interface PropertyInsights {
  propertyId: string;
  propertyName: string;
  currency: string;
  period: { startDate: string; endDate: string };

  occupancy: {
    totalUnits: number;
    occupied: number;
    available: number;
    maintenance: number;
    rate: number;
  };

  leasing: {
    activeContracts: number;
    expiringWithin60Days: number;
    /** Rent per installment across active contracts. */
    contractedRent: number;
    /** The same contracts annualised by their own frequency. */
    annualisedRent: number;
  };

  /** The building statement's figures and settlement for the period. */
  money: {
    rentBilled: number;
    rentCollected: number;
    outstanding: number;
    overdue: number;
    collectionRate: number;
    /** Approved and paid expenses — what the statement deducts. */
    expenses: number;
    commission: number;
    /** VAT on the commission, taken off the owner's share. */
    commissionTax: number;
    investmentRent: number;
    /** Received straight into the owner's hands. */
    collectedByOwner: number;
    collectedByOperator: number;
    /** collected − expenses − commission − VAT + investment rent. */
    ownerShare: number;
    /** Exactly one of these two carries a figure. */
    dueToOwner: number;
    dueToOperator: number;
  };

  /** The one percentage charged, for the summary's commission label. */
  commissionPercentage: number | null;
  /** Every agreement that held the building in the period. */
  agreements: StatementAgreementRef[];

  expensesByCategory: Array<{ category: string; amount: number }>;
  monthly: Array<{ month: string; collected: number; expenses: number }>;
}

export interface PropertyInsightsOptions {
  /** Who is reading — the building statement is scoped to them. */
  actor: ScopeActor;
  startDate: Date;
  endDate: Date;
  now?: Date;
}

/**
 * Build one property's financial picture for a period.
 * Returns null when the property does not exist (or is out of scope).
 */
export async function getPropertyInsights(
  propertyId: string,
  options: PropertyInsightsOptions,
): Promise<PropertyInsights | null> {
  const now = options.now ?? new Date();

  // A contract ends on its last day, stored at that day's midnight, and it
  // is in force until the day is over: "expiring soon" runs from the start of
  // today to the end of the 60th day on, on Riyadh's calendar.
  const startOfToday = startOfBusinessDay(now);
  const soon = businessDayEnd(addBusinessDays(businessToday(now), 60));

  const [statement, unitGroups, leases, openInvoices] = await Promise.all([
    getEntityStatement("property", propertyId, {
      actor: options.actor,
      startDate: options.startDate,
      endDate: options.endDate,
    }),
    db.unit.groupBy({
      by: ["status"],
      where: { propertyId, deletedAt: null },
      _count: { _all: true },
    }),
    db.lease.findMany({
      where: { propertyId, status: LeaseStatus.ACTIVE, deletedAt: null },
      select: {
        id: true,
        startDate: true,
        endDate: true,
        rentAmount: true,
        contractAmount: true,
        paymentFrequency: true,
        currency: true,
      },
    }),
    db.invoice.findMany({
      where: {
        propertyId,
        deletedAt: null,
        status: { in: OPEN_INVOICE_STATUSES },
        dueDate: { lte: options.endDate },
      },
      select: { dueDate: true, balanceRemaining: true },
    }),
  ]);
  if (!statement) return null;

  // ---- occupancy ----
  let totalUnits = 0;
  let occupied = 0;
  let available = 0;
  let maintenance = 0;
  for (const group of unitGroups) {
    const count = group._count._all;
    totalUnits += count;
    if (group.status === PropertyStatus.OCCUPIED) occupied += count;
    else if (group.status === PropertyStatus.AVAILABLE) available += count;
    else if (group.status === PropertyStatus.MAINTENANCE) maintenance += count;
  }

  // ---- leasing ----
  let contractedRent = 0;
  let annualisedRent = 0;
  let expiringSoon = 0;
  for (const lease of leases) {
    contractedRent = round(contractedRent + lease.rentAmount);
    annualisedRent = round(annualisedRent + leaseAnnualRent(lease));
    if (lease.endDate <= soon && lease.endDate >= startOfToday) expiringSoon += 1;
  }

  // ---- money owed by tenants ----
  let outstanding = 0;
  let overdue = 0;
  for (const invoice of openInvoices) {
    const balance = invoice.balanceRemaining;
    if (balance <= 0) continue;
    outstanding = round(outstanding + balance);

    if (isPastDue(invoice.dueDate, now)) overdue = round(overdue + balance);
  }

  // ---- month by month, and what was spent on what: the statement's rows ----
  const monthlyMap = new Map<string, { collected: number; expenses: number }>();
  // The month a row falls in on the office's calendar: a payment taken at
  // 01:30 on the 1st belongs to the new month, not the one the server's clock
  // is still in.
  const bucketFor = (iso: string) => {
    const key = businessMonth(iso);
    const bucket = monthlyMap.get(key) ?? { collected: 0, expenses: 0 };
    monthlyMap.set(key, bucket);
    return bucket;
  };
  for (const payment of statement.payments) {
    const bucket = bucketFor(payment.date);
    bucket.collected = round(bucket.collected + payment.amount);
  }
  const byCategory = new Map<string, number>();
  for (const expense of statement.expenses) {
    byCategory.set(
      expense.category,
      round((byCategory.get(expense.category) ?? 0) + expense.amount),
    );
    const bucket = bucketFor(expense.date);
    bucket.expenses = round(bucket.expenses + expense.amount);
  }

  const { settlement, totals } = statement;
  const rentBilled = totals.rentBilled;

  return {
    propertyId,
    propertyName: statement.subject.name,
    currency: statement.payments.length
      ? statement.currency
      : (leases.find((lease) => lease.currency)?.currency ?? statement.currency),
    period: statement.period,
    occupancy: {
      totalUnits,
      occupied,
      available,
      maintenance,
      rate:
        totalUnits > 0 ? Math.round((occupied / totalUnits) * 1000) / 10 : 0,
    },
    leasing: {
      activeContracts: leases.length,
      expiringWithin60Days: expiringSoon,
      contractedRent,
      annualisedRent,
    },
    money: {
      rentBilled,
      rentCollected: settlement.collected,
      outstanding,
      overdue,
      // Nothing billed reads as fully collected rather than as a 0% failure.
      collectionRate:
        rentBilled > 0
          ? Math.round((settlement.collected / rentBilled) * 1000) / 10
          : 100,
      expenses: settlement.expenses,
      commission: settlement.commission,
      commissionTax: settlement.commissionTax,
      investmentRent: settlement.investmentRent,
      collectedByOwner: settlement.collectedByOwner,
      collectedByOperator: settlement.collectedByOperator,
      ownerShare: settlement.ownerShare,
      dueToOwner: settlement.dueToOwner,
      dueToOperator: settlement.dueToOperator,
    },
    commissionPercentage: statement.commissionPercentage,
    agreements: statement.agreements,
    expensesByCategory: [...byCategory.entries()]
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount),
    monthly: [...monthlyMap.entries()]
      .map(([month, value]) => ({ month, ...value }))
      .sort((a, b) => a.month.localeCompare(b.month)),
  };
}
