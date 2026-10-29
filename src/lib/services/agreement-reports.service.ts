/**
 * PropertyPro - Agreement reports
 *
 * The report the scope requires: for a chosen period, per agreement, the rent,
 * the management commission and what is left for the owner — settled as the
 * owner's statement settles it (lib/statements/settlement.ts), and with every
 * payment behind the figures listed on its own, with its date and note.
 *
 * Every figure is derived from the same payment and invoice rows the owner
 * statement and the collection view read, so an office cannot invoice a
 * commission the ledger does not support.
 *
 * An agreement is in the report when it was in force at any point of the
 * period — one that ended inside it is still owed its commission — and each
 * row carries what happened while that agreement held its buildings: the
 * figures its own statement prints.
 */

import { db } from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { applyScope, propertyScope, type ScopeActor } from "@/lib/db/scopes";
import { COMMISSION_TAX_RATE } from "@/lib/regional/region";
import { settle } from "@/lib/statements/settlement";
import {
  agreementGoverns,
  governedBy,
} from "@/lib/report-filters/agreement-reach";
import {
  DEDUCTED_EXPENSE_STATUSES,
  loadStatementPayments,
} from "@/lib/services/statement-rows.service";
import type { StatementPaymentRow } from "@/types/owner";
import {
  feeLabel,
  loadAgreements,
  partOn,
  runCommission,
  termWithin,
  type AgreementRow,
} from "@/lib/services/agreement.service";

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface AgreementReportRow {
  agreementId: string;
  agreementNumber: string | null;
  kind: string;
  ownerId: string;
  ownerName: string;
  /** "Whole portfolio", a compound name, or one property name. */
  scopeLabel: string;
  scopeType: "property" | "compound" | "portfolio";
  /**
   * The fee, for the agreement's own statement. The report's table does not
   * print it: the client wants the percentage in the details at the top of a
   * statement, never repeated row by row.
   */
  feeType: string;
  feeLabel: string;
  commissionBasis: string;
  status: string;
  startDate: string;
  endDate: string | null;
  currency: string;
  propertyCount: number;
  /** Rent the commission was charged on — before VAT, per the agreement's basis. */
  totalRent: number;
  /** إجمالي المحصل — everything received on the agreement's buildings. */
  rentCollected: number;
  rentBilled: number;
  commission: number;
  /**
   * The settlement, laid out as the statement the client reconciles against
   * and computed exactly as the owner's statement computes it.
   */
  commissionTax: number;
  commissionTaxRate: number;
  expenses: number;
  collectedByOwner: number;
  collectedByOperator: number;
  /**
   * An investment agreement's fixed rent for the period — what the office
   * owes the owner for the buildings it took on. Zero for management.
   */
  investmentRent: number;
  ownerShare: number;
  dueToOwner: number;
  dueToOperator: number;
}

/** A payment behind the report's figures, and the agreement it counted under. */
export interface AgreementReportPayment extends StatementPaymentRow {
  agreementId: string;
  agreementNumber: string | null;
}

export interface AgreementReport {
  rows: AgreementReportRow[];
  /**
   * Every payment received on an agreement's buildings in the period, one row
   * each, with its date, note and receipt — the client asked for exactly this
   * in place of a total. Notes are what explain a commission line an owner
   * queries: "paid via Ejar", "part payment, balance on the 5th".
   */
  payments: AgreementReportPayment[];
  summary: {
    agreementCount: number;
    ownerCount: number;
    propertyCount: number;
    totalRent: number;
    totalCollected: number;
    totalCommission: number;
    totalCommissionTax: number;
    totalExpenses: number;
    totalInvestmentRent: number;
    totalCollectedByOwner: number;
    totalCollectedByOperator: number;
    totalDueToOwner: number;
    totalDueToOperator: number;
    /**
     * Properties earning rent in the period that no agreement governs — the
     * office's own buildings, or owners never put under contract. Surfaced so
     * the report explains why its rent total is lower than the portfolio's.
     */
    unmanagedProperties: number;
    unmanagedRent: number;
  };
}

export interface AgreementReportOptions {
  /**
   * Who is asking. Required so a new caller cannot omit it: this report was
   * built from its query parameters alone, which handed a caller narrowed to
   * a few buildings every agreement the office holds.
   */
  actor: ScopeActor;
  startDate: Date;
  endDate: Date;
  ownerId?: string;
  propertyId?: string;
  /** One compound's buildings. */
  compoundId?: string;
  /**
   * One agreement. The figures, the payments and the rent outside any
   * agreement are then those of the buildings it governs, and no others.
   */
  agreementId?: string;
  /** Only agreements with this status — draft, active, expired, terminated. */
  status?: string;
  /**
   * Also list the agreements that were not in force at any point of the
   * period: drafts, ones that ended before it, ones that start after it.
   */
  includeInactive?: boolean;
}

function scopeOf(agreement: AgreementRow): {
  scopeType: AgreementReportRow["scopeType"];
} {
  if (agreement.propertyId) return { scopeType: "property" };
  if (agreement.compoundId) return { scopeType: "compound" };
  return { scopeType: "portfolio" };
}

/**
 * Build the agreement report for a period.
 *
 * Properties are attributed to agreements with the same precedence the
 * commission engine uses, and by the same dates, so what a report attributes
 * and what an owner statement charges are the same allocation.
 */
export async function getAgreementReport(
  options: AgreementReportOptions,
): Promise<AgreementReport> {
  const period = { startDate: options.startDate, endDate: options.endDate };

  // The caller's buildings, narrowed by the filters — the scope ANDed on
  // rather than spread beside them. Both key on `id`, so a building filter
  // written after the scope replaced it, and an employee assigned a few
  // buildings could read any building's figures by naming it.
  const scope = propertyScope(options.actor);
  const where: Prisma.PropertyWhereInput = {
    deletedAt: null,
    ...(options.ownerId ? { ownerId: options.ownerId } : {}),
    ...(options.propertyId ? { id: options.propertyId } : {}),
    ...(options.compoundId ? { compoundId: options.compoundId } : {}),
  };
  applyScope(where, scope);

  const [agreements, candidates] = await Promise.all([
    loadAgreements({ ownerId: options.ownerId }),
    db.property.findMany({
      where,
      select: { id: true, name: true, ownerId: true, compoundId: true },
    }),
  ]);

  // One agreement asked for narrows the buildings to the ones it governs —
  // among those the reader holds, which the query above already limited — so
  // the figures, the payments and the rent outside any agreement all describe
  // the same set. An agreement that is not among them leaves nothing.
  const chosen = options.agreementId
    ? agreements.find((agreement) => agreement.id === options.agreementId)
    : undefined;
  const properties = options.agreementId
    ? chosen
      ? governedBy(chosen, candidates)
      : []
    : candidates;
  const propertyIds = properties.map((property) => property.id);

  // A narrowed caller — an employee assigned a few buildings, or anyone
  // filtering to a building or a compound — is shown the agreements written
  // for those buildings, not every agreement the office holds.
  const narrowed =
    Object.keys(scope).length > 0 ||
    Boolean(options.propertyId) ||
    Boolean(options.compoundId);
  const reaches = (agreement: AgreementRow) =>
    properties.some((property) => agreementGoverns(agreement, property));
  const relevant = agreements.filter(
    (agreement) =>
      (!options.agreementId || agreement.id === options.agreementId) &&
      (!options.status || agreement.status === options.status) &&
      (options.includeInactive || termWithin(agreement, period) !== null) &&
      (!narrowed || reaches(agreement)),
  );

  const ownerIds = [...new Set(relevant.map((a) => a.ownerId))];
  const compoundIds = [
    ...new Set(
      relevant
        .map((agreement) => agreement.compoundId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  // One commission run over every property in scope; the rows below just
  // regroup its output, so report and statement cannot diverge.
  const [run, payments, spent, owners, compounds] = await Promise.all([
    runCommission({
      propertyIds,
      ownerId: options.ownerId,
      startDate: options.startDate,
      endDate: options.endDate,
    }),
    // Every payment behind the figures, with who received it: cash to the
    // owner, a transfer to the owner and Ejar reached the owner directly.
    loadStatementPayments({
      propertyIds,
      startDate: options.startDate,
      endDate: options.endDate,
    }),
    // One row each, with its date: an expense falls to the agreement that
    // held the building on the day it was spent.
    propertyIds.length
      ? db.expense.findMany({
          where: {
            deletedAt: null,
            status: { in: [...DEDUCTED_EXPENSE_STATUSES] },
            date: { gte: options.startDate, lte: options.endDate },
            propertyId: { in: propertyIds },
          },
          select: { propertyId: true, date: true, amount: true },
        })
      : Promise.resolve([]),
    ownerIds.length
      ? db.user.findMany({
          where: { id: { in: ownerIds } },
          select: { id: true, firstName: true, lastName: true },
        })
      : Promise.resolve([]),
    compoundIds.length
      ? db.compound.findMany({
          where: { id: { in: compoundIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);

  const ownerName = new Map(
    owners.map((owner) => [
      owner.id,
      `${owner.firstName ?? ""} ${owner.lastName ?? ""}`.trim(),
    ]),
  );
  const compoundName = new Map(compounds.map((c) => [c.id, c.name]));
  const propertyName = new Map(properties.map((p) => [p.id, p.name]));

  // What each agreement is answerable for: the parts of the period it held
  // each building, as the commission run found them.
  interface Tally {
    properties: Set<string>;
    rentCollected: number;
    rentBilled: number;
    commission: number;
    base: number;
    expenses: number;
    collectedByOwner: number;
    investmentRent: number;
  }
  const tallies = new Map<string, Tally>();
  const tallyOf = (agreementId: string): Tally => {
    let tally = tallies.get(agreementId);
    if (!tally) {
      tally = {
        properties: new Set(),
        rentCollected: 0,
        rentBilled: 0,
        commission: 0,
        base: 0,
        expenses: 0,
        collectedByOwner: 0,
        investmentRent: 0,
      };
      tallies.set(agreementId, tally);
    }
    return tally;
  };

  const partsOf = new Map(
    run.byProperty.map((entry) => [entry.propertyId, entry.parts]),
  );
  for (const entry of run.byProperty) {
    for (const part of entry.parts) {
      const tally = tallyOf(part.agreementId);
      tally.properties.add(entry.propertyId);
      tally.rentBilled = round(tally.rentBilled + part.rentBilled);
      tally.commission = round(tally.commission + part.commission);
      tally.base = round(tally.base + part.commissionBase);
      tally.investmentRent = round(tally.investmentRent + part.investmentRent);
    }
  }

  // A payment belongs to the agreement that held its building on the day it
  // was received; rent outside every agreement is stated apart.
  const listed = new Set(relevant.map((agreement) => agreement.id));
  const reportPayments: AgreementReportPayment[] = [];
  const unmanagedProperties = new Set<string>();
  let unmanagedRent = 0;
  for (const payment of payments) {
    const part = partOn(
      partsOf.get(payment.propertyId) ?? [],
      new Date(payment.date),
    );
    if (!part) {
      unmanagedProperties.add(payment.propertyId);
      unmanagedRent = round(unmanagedRent + payment.amount);
      continue;
    }
    const tally = tallyOf(part.agreementId);
    tally.rentCollected = round(tally.rentCollected + payment.amount);
    if (payment.receivedBy === "owner") {
      tally.collectedByOwner = round(tally.collectedByOwner + payment.amount);
    }
    if (listed.has(part.agreementId)) {
      reportPayments.push({
        ...payment,
        agreementId: part.agreementId,
        agreementNumber: part.agreementNumber,
      });
    }
  }
  for (const expense of spent) {
    if (!expense.propertyId) continue;
    const part = partOn(partsOf.get(expense.propertyId) ?? [], expense.date);
    if (!part) continue;
    const tally = tallyOf(part.agreementId);
    tally.expenses = round(tally.expenses + (Number(expense.amount) || 0));
  }

  const rows: AgreementReportRow[] = relevant
    .map((agreement) => {
      const tally = tallyOf(agreement.id);

      // The owner statement's settlement, over what this agreement held.
      // Under an investment agreement the tenants' rent and the running costs
      // are the office's; the owner is owed the fixed rent and nothing else.
      const settlement = settle({
        kind: agreement.kind === "investment" ? "investment" : "management",
        collected: tally.rentCollected,
        collectedByOwner: tally.collectedByOwner,
        expenses: tally.expenses,
        commission: tally.commission,
        commissionTaxRate: COMMISSION_TAX_RATE,
        investmentRent: tally.investmentRent,
      });

      const { scopeType } = scopeOf(agreement);
      const scopeLabel =
        scopeType === "property"
          ? (propertyName.get(agreement.propertyId!) ?? "Property")
          : scopeType === "compound"
            ? (compoundName.get(agreement.compoundId!) ?? "Compound")
            : "Whole portfolio";

      return {
        agreementId: agreement.id,
        agreementNumber: agreement.agreementNumber,
        kind: agreement.kind,
        ownerId: agreement.ownerId,
        ownerName: ownerName.get(agreement.ownerId) ?? "—",
        scopeLabel,
        scopeType,
        feeType: agreement.feeType,
        feeLabel: feeLabel(agreement),
        commissionBasis: agreement.commissionBasis,
        status: agreement.status,
        startDate: agreement.startDate.toISOString(),
        endDate: agreement.endDate ? agreement.endDate.toISOString() : null,
        currency: agreement.currency,
        propertyCount: tally.properties.size,
        totalRent: tally.base,
        rentCollected: settlement.collected,
        rentBilled: tally.rentBilled,
        commission: settlement.commission,
        commissionTax: settlement.commissionTax,
        commissionTaxRate: settlement.commissionTaxRate,
        expenses: settlement.expenses,
        collectedByOwner: settlement.collectedByOwner,
        collectedByOperator: settlement.collectedByOperator,
        investmentRent: settlement.investmentRent,
        ownerShare: settlement.ownerShare,
        // Exactly one of these is non-zero, as on the owner's statement.
        dueToOwner: settlement.dueToOwner,
        dueToOperator: settlement.dueToOperator,
      };
    })
    .sort((a, b) => b.commission - a.commission);

  // A building renewed inside the period sits under two agreements, and is
  // still one building.
  const coveredProperties = new Set(
    relevant.flatMap((agreement) => [...tallyOf(agreement.id).properties]),
  );

  const summary = rows.reduce(
    (acc, row) => ({
      ...acc,
      totalRent: round(acc.totalRent + row.totalRent),
      totalCollected: round(acc.totalCollected + row.rentCollected),
      totalCommission: round(acc.totalCommission + row.commission),
      totalCommissionTax: round(acc.totalCommissionTax + row.commissionTax),
      totalExpenses: round(acc.totalExpenses + row.expenses),
      totalInvestmentRent: round(acc.totalInvestmentRent + row.investmentRent),
      totalCollectedByOwner: round(acc.totalCollectedByOwner + row.collectedByOwner),
      totalCollectedByOperator: round(
        acc.totalCollectedByOperator + row.collectedByOperator,
      ),
      totalDueToOwner: round(acc.totalDueToOwner + row.dueToOwner),
      totalDueToOperator: round(acc.totalDueToOperator + row.dueToOperator),
    }),
    {
      agreementCount: rows.length,
      ownerCount: new Set(rows.map((row) => row.ownerId)).size,
      propertyCount: coveredProperties.size,
      totalRent: 0,
      totalCollected: 0,
      totalCommission: 0,
      totalCommissionTax: 0,
      totalExpenses: 0,
      totalInvestmentRent: 0,
      totalCollectedByOwner: 0,
      totalCollectedByOperator: 0,
      totalDueToOwner: 0,
      totalDueToOperator: 0,
      unmanagedProperties: unmanagedProperties.size,
      unmanagedRent,
    },
  );

  return { rows, payments: reportPayments, summary };
}
