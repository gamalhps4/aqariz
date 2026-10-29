/**
 * PropertyPro - Compound, Property and Unit statements
 *
 * The review asks for four statements beside the owner's: one per compound,
 * one per building, one per unit, and the maintenance report. The first three
 * ask the same question of three different subjects — what did this thing
 * bill, collect, still owe and spend in a period, and who owes whom at the
 * close — so they are one service with three ways of resolving a subject to
 * the buildings that belong to it, not three near-copies of
 * `owner-statement.service.ts`.
 *
 *   compound  every building carrying this compound's id
 *   property  the one building
 *   unit      the one unit — its expenses point at it, its payments reach it
 *             through the contract written on it
 *
 * Each is laid out as the owner's statement is (كشف حساب): the summary of
 * lib/statements/settlement.ts, every payment received on its own row with
 * its date and note (lib/services/statement-rows.service.ts), and every
 * expense — and a compound adds its buildings, a building its units, each
 * settled on its own. How a building's figures are shared between its units,
 * and why a unit's statement is its row of its building's, is
 * lib/statements/subject-account.ts.
 *
 * Commission and investment rent come from the same commission run the
 * owner's statement makes — each agreement for its own part of the period —
 * and a payment, an expense or a bill belongs to the statement when it falls
 * in the owner's time (`statementTime`), not by whatever agreement held the
 * building at the close.
 */

import { db } from "@/lib/db/prisma";
import {
  compoundScope,
  propertyScope,
  withScope,
  type ScopeActor,
} from "@/lib/db/scopes";
import { InvoiceStatus } from "@/types";
import {
  runCommissionDetailed,
  type CommissionPart,
} from "@/lib/services/agreement.service";
import {
  loadStatementExpenses,
  loadStatementPayments,
} from "@/lib/services/statement-rows.service";
import { COMMISSION_TAX_RATE, DEFAULT_CURRENCY } from "@/lib/regional/region";
import { settle } from "@/lib/statements/settlement";
import { uniformCommissionPercentage } from "@/lib/statements/summary";
import {
  buildingRowKey,
  subjectAccount,
  type AccountFigures,
  type AccountRow,
} from "@/lib/statements/subject-account";
import {
  STATEMENT_SUBJECT_KINDS,
  type EntityStatement,
  type EntityStatementBreakdownRow,
  type StatementAgreementRef,
  type StatementSubject,
  type StatementSubjectKind,
} from "@/types/entity-statement";

export { STATEMENT_SUBJECT_KINDS };
export type {
  EntityStatement,
  EntityStatementBreakdownRow,
  EntityStatementTotals,
  StatementAgreementRef,
  StatementSubject,
  StatementSubjectKind,
} from "@/types/entity-statement";

export function isStatementSubjectKind(
  value: unknown,
): value is StatementSubjectKind {
  return STATEMENT_SUBJECT_KINDS.includes(value as StatementSubjectKind);
}

export interface EntityStatementOptions {
  /** Who is reading — every property lookup is narrowed to their scope. */
  actor: ScopeActor;
  startDate: Date;
  endDate: Date;
}

/** What a subject resolves to: the buildings it covers, and — for a unit — the unit. */
interface ResolvedSubject {
  subject: StatementSubject;
  propertyIds: string[];
  propertyNames: Map<string, string>;
  /** Set only for a unit statement. */
  unitId?: string;
  ownerId?: string;
}

function personName(
  person: { firstName: string | null; lastName: string | null } | null,
): string | null {
  if (!person) return null;
  return `${person.firstName ?? ""} ${person.lastName ?? ""}`.trim() || null;
}

function addressOf(parts: Array<string | null>): string | null {
  return parts.filter(Boolean).join(", ") || null;
}

async function resolveCompound(
  id: string,
  options: EntityStatementOptions,
): Promise<ResolvedSubject | null> {
  // Scoped like the compound routes: reachable when one of its buildings is.
  // Read by id alone, a compound outside the reader's assignment still came
  // back as a statement of zeros under its real name, owner and address.
  const compound = await db.compound.findFirst({
    where: withScope({ id, deletedAt: null }, compoundScope(options.actor)),
    select: {
      id: true,
      name: true,
      code: true,
      addressCity: true,
      addressDistrict: true,
      addressStreet: true,
      owner: { select: { firstName: true, lastName: true } },
    },
  });
  if (!compound) return null;

  const properties = await db.property.findMany({
    where: {
      compoundId: id,
      deletedAt: null,
      ...propertyScope(options.actor),
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return {
    subject: {
      kind: "compound",
      id: compound.id,
      name: compound.name,
      code: compound.code,
      parentName: null,
      ownerName: personName(compound.owner),
      address: addressOf([
        compound.addressStreet,
        compound.addressDistrict,
        compound.addressCity,
      ]),
    },
    propertyIds: properties.map((property) => property.id),
    propertyNames: new Map(
      properties.map((property) => [property.id, property.name]),
    ),
  };
}

async function resolveProperty(
  id: string,
  options: EntityStatementOptions,
): Promise<ResolvedSubject | null> {
  const property = await db.property.findFirst({
    where: withScope({ id, deletedAt: null }, propertyScope(options.actor)),
    select: {
      id: true,
      name: true,
      ownerId: true,
      addressStreet: true,
      addressCity: true,
      addressDistrict: true,
      compound: { select: { name: true } },
      owner: { select: { firstName: true, lastName: true } },
    },
  });
  if (!property) return null;

  return {
    subject: {
      kind: "property",
      id: property.id,
      name: property.name,
      code: null,
      parentName: property.compound?.name ?? null,
      ownerName: personName(property.owner),
      address: addressOf([
        property.addressStreet,
        property.addressDistrict,
        property.addressCity,
      ]),
    },
    propertyIds: [property.id],
    propertyNames: new Map([[property.id, property.name]]),
    ownerId: property.ownerId,
  };
}

async function resolveUnit(
  id: string,
  options: EntityStatementOptions,
): Promise<ResolvedSubject | null> {
  const unit = await db.unit.findFirst({
    where: {
      id,
      deletedAt: null,
      // A unit is reachable only through a building the reader may see.
      property: { deletedAt: null, ...propertyScope(options.actor) },
    },
    select: {
      id: true,
      unitNumber: true,
      propertyId: true,
      property: {
        select: {
          name: true,
          ownerId: true,
          addressStreet: true,
          addressCity: true,
          addressDistrict: true,
          owner: { select: { firstName: true, lastName: true } },
        },
      },
    },
  });
  if (!unit) return null;

  return {
    subject: {
      kind: "unit",
      id: unit.id,
      name: unit.unitNumber,
      code: null,
      parentName: unit.property.name,
      ownerName: personName(unit.property.owner),
      address: addressOf([
        unit.property.addressStreet,
        unit.property.addressDistrict,
        unit.property.addressCity,
      ]),
    },
    // A unit's statement is read over its whole building: its share of the
    // building's commission depends on what every unit brought in.
    propertyIds: [unit.propertyId],
    propertyNames: new Map([[unit.propertyId, unit.property.name]]),
    unitId: unit.id,
    ownerId: unit.property.ownerId,
  };
}

async function resolveSubject(
  kind: StatementSubjectKind,
  id: string,
  options: EntityStatementOptions,
): Promise<ResolvedSubject | null> {
  if (kind === "compound") return resolveCompound(id, options);
  if (kind === "property") return resolveProperty(id, options);
  return resolveUnit(id, options);
}

const OPEN_INVOICE_STATUSES = [
  InvoiceStatus.SCHEDULED,
  InvoiceStatus.ISSUED,
  InvoiceStatus.PARTIAL,
  InvoiceStatus.OVERDUE,
];

function noFigures(): AccountFigures {
  return {
    rentBilled: 0,
    rentCollected: 0,
    collectedByOwner: 0,
    expenses: 0,
    commissionBase: 0,
    commission: 0,
    investmentRent: 0,
  };
}

/** Unit numbers in the order a person counts them: 2 before 10. */
const unitOrder = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

/**
 * Build a compound, building or unit statement for a period.
 *
 * Returns null when the subject does not exist *or* the reader may not see it
 * — the two are one answer on purpose, so a statement URL cannot be used to
 * probe for buildings outside an employee's assignment.
 */
export async function getEntityStatement(
  kind: StatementSubjectKind,
  id: string,
  options: EntityStatementOptions,
): Promise<EntityStatement | null> {
  const resolved = await resolveSubject(kind, id, options);
  if (!resolved) return null;

  const { propertyIds, propertyNames, unitId } = resolved;
  const period = { startDate: options.startDate, endDate: options.endDate };
  const rowsScope = { propertyIds, ...period, ...(unitId ? { unitId } : {}) };
  const hasProperties = propertyIds.length > 0;

  // One round of reads — every round trip to the database costs the reader
  // most of a second, and none of these waits on another.
  const [detail, paymentRows, expenseRows, units, openByBuilding] =
    await Promise.all([
      // The same commission run the owner's statement makes, with the rows it
      // was charged from.
      runCommissionDetailed({
        propertyIds,
        ownerId: resolved.ownerId,
        ...period,
      }),
      loadStatementPayments(rowsScope),
      loadStatementExpenses(rowsScope),
      hasProperties
        ? db.unit.findMany({
            where: { propertyId: { in: propertyIds }, deletedAt: null },
            select: { id: true, unitNumber: true, propertyId: true, status: true },
            // A fixed order: who takes the odd cent of a shared flat fee.
            orderBy: { id: "asc" },
          })
        : Promise.resolve([]),
      hasProperties
        ? db.invoice.groupBy({
            by: ["propertyId"],
            where: {
              propertyId: { in: propertyIds },
              ...(unitId ? { unitId } : {}),
              deletedAt: null,
              status: { in: OPEN_INVOICE_STATUSES },
              dueDate: { lte: options.endDate },
            },
            _sum: { balanceRemaining: true },
          })
        : Promise.resolve([]),
    ]);

  const { run } = detail;
  const partsOf = new Map(
    run.byProperty.map((entry) => [entry.propertyId, entry.parts]),
  );
  const unitsOf = new Map<string, string[]>();
  for (const unit of units) {
    unitsOf.set(unit.propertyId, [...(unitsOf.get(unit.propertyId) ?? []), unit.id]);
  }
  const basis = new Map(
    detail.agreements.map((agreement) => [agreement.id, agreement.commissionBasis]),
  );

  const account = subjectAccount({
    period,
    buildings: propertyIds.map((propertyId) => ({
      id: propertyId,
      parts: partsOf.get(propertyId) ?? [],
      unitIds: unitsOf.get(propertyId) ?? [],
    })),
    payments: paymentRows,
    expenses: expenseRows,
    received: detail.received,
    billed: detail.billed,
    basisOf: (agreementId) => basis.get(agreementId),
    commissionTaxRate: COMMISSION_TAX_RATE,
    breakdown: kind === "compound" ? "property" : "unit",
  });

  // A unit's statement is its row of its building's account.
  const unitRow = unitId
    ? account.rows.find((row) => row.unitId === unitId)
    : undefined;
  const figures = unitId ? (unitRow ?? noFigures()) : account.totals;
  const settlement = unitId
    ? (unitRow?.settlement ??
      settle({
        collected: 0,
        collectedByOwner: 0,
        expenses: 0,
        commission: 0,
        commissionTaxRate: COMMISSION_TAX_RATE,
      }))
    : account.settlement;

  // What is still owed is a moment, not a stretch: it is the owner's where
  // no investment agreement holds the building at the close.
  const ownedAtClose = new Set(
    run.byProperty
      .filter((entry) => entry.agreementKind !== "investment")
      .map((entry) => entry.propertyId),
  );
  const outstanding = openByBuilding.reduce(
    (sum, group) =>
      group.propertyId !== null && ownedAtClose.has(group.propertyId)
        ? Math.round((sum + Number(group._sum.balanceRemaining ?? 0)) * 100) / 100
        : sum,
    0,
  );

  const parts: CommissionPart[] = run.byProperty.flatMap((entry) => entry.parts);
  const agreements = new Map<string, StatementAgreementRef>();
  for (const part of parts) {
    if (agreements.has(part.agreementId)) continue;
    agreements.set(part.agreementId, {
      id: part.agreementId,
      number: part.agreementNumber,
      kind: part.agreementKind,
      fee: part.fee,
      commissionBasis: basis.get(part.agreementId) ?? "collected",
    });
  }

  // A unit shares a flat fee, or an investment rent, with every unit of its
  // building; its statement says with how many.
  const sharesFlatAmount = parts.some((part) =>
    part.agreementKind === "investment"
      ? part.investmentRent > 0
      : part.feeType === "fixed" && part.commission > 0,
  );

  const counted = unitId ? units.filter((unit) => unit.id === unitId) : units;
  const occupiedUnits = counted.filter(
    (unit) => String(unit.status).toLowerCase() === "occupied",
  ).length;

  const unitOf = new Map(units.map((unit) => [unit.id, unit]));
  const breakdownRow = (row: AccountRow): EntityStatementBreakdownRow => {
    const unit = row.unitId ? unitOf.get(row.unitId) : undefined;
    return {
      id: row.key,
      level:
        kind === "compound"
          ? "property"
          : row.key === buildingRowKey(row.propertyId)
            ? "building"
            : "unit",
      label: unit?.unitNumber ?? propertyNames.get(row.propertyId) ?? "—",
      status: unit ? String(unit.status).toLowerCase() : null,
      rentBilled: row.rentBilled,
      rentCollected: row.rentCollected,
      collectedByOwner: row.collectedByOwner,
      expenses: row.expenses,
      commission: row.settlement.commission,
      commissionTax: row.settlement.commissionTax,
      investmentRent: row.investmentRent,
      ownerShare: row.settlement.ownerShare,
    };
  };
  const breakdown =
    kind === "unit"
      ? []
      : account.rows
          .map(breakdownRow)
          .sort((a, b) =>
            kind === "compound"
              ? unitOrder.compare(a.label, b.label)
              : // A building's own row closes its units.
                Number(a.level === "building") - Number(b.level === "building") ||
                unitOrder.compare(a.label, b.label),
          );

  const listed = account.payments;
  const currency =
    [...listed].reverse().find((payment) => payment.currency)?.currency ??
    DEFAULT_CURRENCY;

  return {
    subject: resolved.subject,
    period: {
      startDate: options.startDate.toISOString(),
      endDate: options.endDate.toISOString(),
    },
    currency,
    propertyCount: propertyIds.length,
    unitCount: counted.length,
    occupiedUnits,
    vacantUnits: counted.length - occupiedUnits,
    commissionSource: parts.some((part) => part.agreementKind === "management")
      ? "agreements"
      : "none",
    // Read from every part charged: a building renewed on new terms inside
    // the period was charged at two rates.
    commissionPercentage: uniformCommissionPercentage(parts),
    agreements: [...agreements.values()],
    sharedBetweenUnits:
      unitId && sharesFlatAmount ? (unitsOf.get(propertyIds[0]) ?? []).length : null,
    totals: {
      rentCollected: settlement.collected,
      rentBilled: figures.rentBilled,
      outstanding,
      expenses: settlement.expenses,
      commissionBase: figures.commissionBase,
      commission: settlement.commission,
    },
    settlement,
    payments: listed,
    expenses: account.expenses,
    breakdownKind:
      kind === "compound" ? "property" : kind === "property" ? "unit" : "none",
    breakdown,
  };
}
