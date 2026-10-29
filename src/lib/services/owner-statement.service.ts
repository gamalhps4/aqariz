/**
 * PropertyPro - Owner Statement of Account
 *
 * What the owner's buildings earned in a period, what was spent on them, what
 * the office keeps, and who owes whom at the close.
 *
 * Two readings of the same statement, and both must work:
 *
 *  - A management office: commission is real money the office keeps, and the
 *    dues say what gets paid out, and to whom.
 *  - A landlord who manages their own buildings: there is no third party, so
 *    commission is zero and the statement reads as their own profit & loss.
 *
 * Commission is therefore computed from the owner's management agreements,
 * and NO agreement means NO commission — never an error, never a blocked
 * statement. `commissionSource` records which of the two happened, so a zero
 * is never mistaken for "calculated and came out at nothing".
 *
 * Each agreement charges for the part of the period it was in force, at its
 * own rate — so a period that takes in an agreement and its renewal carries
 * both commissions, and one that closes on an agreement's last day still
 * carries that agreement's. The same holds for an investment agreement: the
 * rows of the time it held a building are the office's, and the owner is
 * owed its rent for that time and no other.
 *
 * Laid out as the statement the client reconciles against (كشف حساب إتفاقيات
 * الإدارة): the summary of lib/statements/settlement.ts, then every payment
 * received — one row each, with its note and receipt — then every expense
 * deducted.
 */

import { db } from "@/lib/db/prisma";
import { propertyScope, type ScopeActor } from "@/lib/db/scopes";
import { InvoiceStatus } from "@/types";
import {
  commissionUnderAgreement,
  loadAgreements,
  resolveAgreementForProperty,
  runCommission,
  statementTime,
} from "@/lib/services/agreement.service";
import { COMMISSION_TAX_RATE, DEFAULT_CURRENCY } from "@/lib/regional/region";
import {
  leaseInstallmentPlan,
  summarizeInstallments,
} from "@/lib/lease-installments";
import { settle } from "@/lib/statements/settlement";
import { uniformCommissionPercentage } from "@/lib/statements/summary";
import {
  loadStatementExpenses,
  loadStatementPayments,
} from "@/lib/services/statement-rows.service";
import type {
  OwnerStatement,
  StatementContractRow,
} from "@/types/owner";

export type {
  OwnerStatement,
  OwnerStatementTotals,
  StatementContractRow,
  StatementExpenseRow,
  StatementPaymentRow,
} from "@/types/owner";

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface OwnerStatementOptions {
  /** Who is reading — see the property lookup below. */
  actor: ScopeActor;
  startDate: Date;
  endDate: Date;
  propertyId?: string;
  /**
   * Only these buildings. A management agreement's statement is this
   * statement read over the buildings that one agreement covers — the owner
   * may hold others under a different agreement, or none.
   */
  propertyIds?: readonly string[];
  /**
   * Only what this agreement governed — its own statement. The commission is
   * then that agreement's alone, on its own terms, and a payment or an
   * expense dated while another agreement held the building is left to that
   * agreement's statement.
   */
  agreementId?: string;
  currentUserId?: string;
}

/**
 * Build one owner's statement for a period.
 *
 * Returns null when the user does not exist. An owner with no properties is a
 * valid, empty statement rather than an error — a client can be onboarded
 * before their buildings are entered.
 */
export async function getOwnerStatement(
  userId: string,
  options: OwnerStatementOptions,
): Promise<OwnerStatement | null> {
  const user = await db.user.findFirst({
    where: { id: userId },
    select: { id: true, firstName: true, lastName: true, email: true },
  });
  if (!user) return null;

  const profile = await db.owner.findFirst({
    where: { userId },
    select: { companyName: true },
  });

  const properties = await db.property.findMany({
    where: {
      ownerId: userId,
      deletedAt: null,
      // The owner's portfolio, narrowed to what the *reader* may see. The two
      // differ whenever an employee assigned a few buildings opens a
      // statement for an owner who holds more than those.
      ...propertyScope(options.actor),
      ...(options.propertyId || options.propertyIds
        ? {
            AND: [
              ...(options.propertyId ? [{ id: options.propertyId }] : []),
              ...(options.propertyIds
                ? [{ id: { in: [...options.propertyIds] } }]
                : []),
            ],
          }
        : {}),
    },
    select: { id: true, name: true, ownerId: true, compoundId: true },
  });
  const propertyIds = properties.map((property) => property.id);
  const propertyName = new Map(
    properties.map((property) => [property.id, property.name]),
  );

  // While an investment agreement holds a building it is not the owner's to
  // report on: the tenants' rent, the running costs and the contracts of that
  // time are the office's. What the owner is owed for it is the agreement's
  // fixed rent, which comes in with the commission run below — along with the
  // time each agreement held each building. What is still owed at the close
  // is a moment rather than a stretch, so it is read over the buildings that
  // are the owner's at that moment.
  const agreements = properties.length
    ? await loadAgreements({ ownerId: userId })
    : [];
  const ownedAtClose = properties
    .filter(
      (property) =>
        !resolveAgreementForProperty(
          agreements,
          property,
          options.endDate,
          "investment",
        ),
    )
    .map((property) => property.id);

  const period = { startDate: options.startDate, endDate: options.endDate };
  const scope = { propertyIds, ...period };
  const openInvoice = {
    in: [
      InvoiceStatus.SCHEDULED,
      InvoiceStatus.ISSUED,
      InvoiceStatus.PARTIAL,
      InvoiceStatus.OVERDUE,
    ],
  };

  // One round of reads: none of these waits on another, and every round trip
  // to the database costs the reader most of a second.
  const [receivedRows, expenseRows, fullRun, billed, outstandingAgg, leaseRows, dueByLease] =
    await Promise.all([
      loadStatementPayments(scope),
      loadStatementExpenses(scope),
      // Commission comes from the owner's management agreements. No agreement
      // means no commission — the normal case for a landlord managing their
      // own buildings, and never an error.
      runCommission({ propertyIds, ownerId: userId, ...period }),
      ownedAtClose.length
        ? db.invoice.aggregate({
            where: {
              propertyId: { in: ownedAtClose },
              deletedAt: null,
              status: { not: InvoiceStatus.CANCELLED },
              // Billed rent belongs to the period the rent COVERS, not the one
              // its invoice happened to be printed in. Invoices are issued a
              // week before they fall due, so filtering on issueDate pushed a
              // January quarter into the previous year's statement and made
              // the figure depend on the issue lead time, not the contract.
              dueDate: { gte: options.startDate, lte: options.endDate },
            },
            _sum: { totalAmount: true },
          })
        : Promise.resolve({ _sum: { totalAmount: null } }),
      ownedAtClose.length
        ? db.invoice.aggregate({
            where: {
              propertyId: { in: ownedAtClose },
              deletedAt: null,
              status: openInvoice,
              dueDate: { lte: options.endDate },
            },
            _sum: { balanceRemaining: true },
          })
        : Promise.resolve({ _sum: { balanceRemaining: null } }),
      // The rent roll: every contract on the owner's buildings that was
      // running at any point in the period. Overlap rather than containment:
      // a contract signed last year and still running is exactly what the
      // owner wants to see, and a `startDate within period` filter would
      // hide it. `endDate` is required on a lease, so there is no open end.
      propertyIds.length
        ? db.lease.findMany({
            where: {
              propertyId: { in: propertyIds },
              deletedAt: null,
              startDate: { lte: options.endDate },
              endDate: { gte: options.startDate },
            },
            select: {
              id: true,
              propertyId: true,
              contractNumber: true,
              startDate: true,
              endDate: true,
              rentAmount: true,
              // A contract written as a total is valued at that total.
              contractAmount: true,
              electricityAmount: true,
              waterAmount: true,
              paymentFrequency: true,
              taxEnabled: true,
              taxRate: true,
              terms: true,
              notes: true,
              property: { select: { name: true } },
              unit: { select: { unitNumber: true } },
              tenant: { select: { firstName: true, lastName: true } },
            },
            orderBy: { startDate: "asc" },
          })
        : Promise.resolve([]),
      // Owed per contract, grouped over the same buildings so it need not
      // wait for the contracts above.
      ownedAtClose.length
        ? db.invoice.groupBy({
            by: ["leaseId"],
            where: {
              propertyId: { in: ownedAtClose },
              leaseId: { not: null },
              deletedAt: null,
              status: openInvoice,
              dueDate: { lte: options.endDate },
            },
            _sum: { balanceRemaining: true },
          })
        : Promise.resolve([]),
    ]);

  // An agreement's own statement carries that agreement's commission alone.
  // A building can pass from one agreement to another inside a period — a
  // renewal on new terms, a building given an agreement of its own — and the
  // other's share of the period is the other's to state.
  const run = options.agreementId
    ? commissionUnderAgreement(fullRun, options.agreementId)
    : fullRun;
  const chargedTo = new Map(
    run.byProperty.map((entry) => [entry.propertyId, entry.parts]),
  );
  const charged = run.byProperty.flatMap((entry) => entry.parts);

  // And it carries the rows of the same time: a payment, an expense or a
  // contract belongs to the statement when it falls in the time the statement
  // covers for its building (see `statementTime`).
  const carried = new Map(
    fullRun.byProperty.map((entry) => [
      entry.propertyId,
      statementTime(entry.parts, period, options.agreementId),
    ]),
  );
  const carries = (propertyId: string | null, from: Date, to: Date = from) =>
    propertyId !== null &&
    (carried.get(propertyId) ?? []).some(
      (span) => from <= span.endDate && to >= span.startDate,
    );
  const payments = receivedRows.filter((row) =>
    carries(row.propertyId, new Date(row.date)),
  );
  const expenses = expenseRows.filter((row) =>
    carries(row.propertyId, new Date(row.date)),
  );
  const leases = leaseRows.filter((lease) =>
    carries(lease.propertyId, lease.startDate, lease.endDate),
  );

  // --- The settlement -------------------------------------------------------
  const perProperty = new Map<
    string,
    { rentCollected: number; collectedByOwner: number; expenses: number }
  >();
  for (const id of propertyIds) {
    perProperty.set(id, { rentCollected: 0, collectedByOwner: 0, expenses: 0 });
  }

  let rentCollected = 0;
  let collectedByOwner = 0;
  let currency = DEFAULT_CURRENCY;
  for (const payment of payments) {
    rentCollected = round(rentCollected + payment.amount);
    currency = payment.currency || currency;
    // Cash to the owner, a transfer to the owner, Ejar: real collections that
    // never pass through the office, so the office holds nothing to remit
    // for them — which is what flips the dues from "the office owes the
    // owner" to "the owner owes the office its fee".
    const toOwner = payment.receivedBy === "owner";
    if (toOwner) collectedByOwner = round(collectedByOwner + payment.amount);
    const bucket = perProperty.get(payment.propertyId);
    if (bucket) {
      bucket.rentCollected = round(bucket.rentCollected + payment.amount);
      if (toOwner) {
        bucket.collectedByOwner = round(bucket.collectedByOwner + payment.amount);
      }
    }
  }

  let expenseTotal = 0;
  for (const expense of expenses) {
    expenseTotal = round(expenseTotal + expense.amount);
    const bucket = expense.propertyId
      ? perProperty.get(expense.propertyId)
      : undefined;
    if (bucket) bucket.expenses = round(bucket.expenses + expense.amount);
  }

  const commissionSource: OwnerStatement["commissionSource"] = charged.some(
    (part) => part.agreementKind === "management",
  )
    ? "agreements"
    : "none";
  // From the parts, not the buildings read whole: a building that passed
  // between management and investment inside the period carries both.
  const total = (
    parts: typeof charged,
    key: "commission" | "investmentRent" | "commissionBase",
  ) => round(parts.reduce((sum, part) => sum + part[key], 0));
  const commissionBase = total(charged, "commissionBase");
  const settlement = settle({
    collected: rentCollected,
    collectedByOwner,
    expenses: expenseTotal,
    commission: total(charged, "commission"),
    commissionTaxRate: COMMISSION_TAX_RATE,
    investmentRent: total(charged, "investmentRent"),
  });

  // --- The rent roll --------------------------------------------------------
  const dueMap = new Map(
    dueByLease.map((group) => [
      group.leaseId,
      round(Number(group._sum.balanceRemaining ?? 0)),
    ]),
  );
  // Received per contract: the payments the statement lists for it, so the
  // two cannot disagree.
  const paidMap = new Map<string | null, number>();
  for (const payment of payments) {
    paidMap.set(
      payment.leaseId,
      round((paidMap.get(payment.leaseId) ?? 0) + payment.amount),
    );
  }

  const contracts: StatementContractRow[] = leases.map((lease) => {
    // The contract's whole-term value, from the same planner that bills it —
    // so this column and the installment schedule can never disagree.
    const plan = leaseInstallmentPlan(lease);
    const contractTotal = summarizeInstallments(plan).totalAmount;

    const months = lease.endDate
      ? Math.max(
          Math.round(
            (new Date(lease.endDate).getTime() -
              new Date(lease.startDate).getTime()) /
              (86_400_000 * 30.436875),
          ),
          0,
        )
      : 0;

    return {
      leaseId: lease.id,
      date: lease.startDate.toISOString(),
      contractNumber: lease.contractNumber,
      tenantName:
        `${lease.tenant?.firstName ?? ""} ${lease.tenant?.lastName ?? ""}`.trim() ||
        "—",
      propertyName: lease.property?.name ?? "",
      unitNumber: lease.unit?.unitNumber ?? "",
      durationMonths: months,
      contractTotal,
      due: dueMap.get(lease.id) ?? 0,
      paid: paidMap.get(lease.id) ?? 0,
      item: "rent",
      notes: (lease.notes ?? "").slice(0, 200),
    };
  });

  return {
    owner: {
      userId,
      name: `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || "—",
      email: user.email,
      companyName: profile?.companyName ?? null,
      isSelf: userId === options.currentUserId,
    },
    period: {
      startDate: options.startDate.toISOString(),
      endDate: options.endDate.toISOString(),
    },
    currency,
    propertyCount: properties.length,
    commissionSource,
    // Read from every part charged, not one figure per building: a building
    // renewed on new terms inside the period was charged at two rates.
    commissionPercentage: uniformCommissionPercentage(charged),
    totals: {
      rentCollected: settlement.collected,
      rentBilled: round(Number(billed._sum.totalAmount ?? 0)),
      outstanding: round(Number(outstandingAgg._sum.balanceRemaining ?? 0)),
      expenses: settlement.expenses,
      commissionBase,
      commission: settlement.commission,
      commissionTax: settlement.commissionTax,
      commissionTaxRate: settlement.commissionTaxRate,
      investmentRent: settlement.investmentRent,
      collectedByOwner: settlement.collectedByOwner,
      collectedByOperator: settlement.collectedByOperator,
      ownerShare: settlement.ownerShare,
      dueToOwner: settlement.dueToOwner,
      dueToOperator: settlement.dueToOperator,
    },
    payments,
    expenses,
    contracts,
    byProperty: [...perProperty.entries()]
      .map(([propertyId, bucket]) => {
        const parts = chargedTo.get(propertyId) ?? [];
        const building = settle({
          collected: bucket.rentCollected,
          collectedByOwner: bucket.collectedByOwner,
          expenses: bucket.expenses,
          commission: total(parts, "commission"),
          commissionTaxRate: COMMISSION_TAX_RATE,
          investmentRent: total(parts, "investmentRent"),
        });
        return {
          propertyId,
          propertyName: propertyName.get(propertyId) ?? "",
          rentCollected: building.collected,
          collectedByOwner: building.collectedByOwner,
          expenses: building.expenses,
          commission: building.commission,
          commissionTax: building.commissionTax,
          investmentRent: building.investmentRent,
          ownerShare: building.ownerShare,
        };
      })
      .sort((a, b) => b.rentCollected - a.rentCollected),
  };
}
