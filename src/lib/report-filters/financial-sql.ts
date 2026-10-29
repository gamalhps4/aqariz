/**
 * PropertyPro - Which rows the financial report aggregates
 *
 * The income, expense and collections reports add up payments and expenses in
 * SQL, so the filters the review asks of every report — owner, compound,
 * building, unit, tenant, contract, status — are written here as conditions on
 * the two tables rather than as a Prisma `where`.
 *
 * They are conditions to AND with the rest and with the reader's scope
 * (`paymentScopeSql`, `expenseScopeSql`), never to replace either. Every value
 * is a bound parameter. Owner and compound are columns of the building, a
 * unit is a column of the contract a payment belongs to, so those three go
 * through a sub-select instead of a column on the row.
 *
 * No session here: the route passes the scope's own condition in.
 */

import { Prisma } from "@/generated/prisma/client";

/** The filters the financial report reads. Absent means "not filtered". */
export interface FinancialFilters {
  ownerId?: string;
  compoundId?: string;
  propertyId?: string;
  unitId?: string;
  tenantId?: string;
  leaseId?: string;
  /**
   * A payment status; read by the collections report only, which applies it
   * to installments (api/reports/financial installmentStatusCondition).
   */
  status?: string;
}

/** What `payments p` and `expenses e` call the columns the filters key on. */
export interface PaymentColumns {
  propertyId: Prisma.Sql;
  tenantId: Prisma.Sql;
  leaseId: Prisma.Sql;
  status: Prisma.Sql;
}

export interface ExpenseColumns {
  propertyId: Prisma.Sql;
}

/** The columns of `payments p`, as the financial report aliases it. */
export const PAYMENT_COLUMNS: PaymentColumns = {
  propertyId: Prisma.sql`p."propertyId"`,
  tenantId: Prisma.sql`p."tenantId"`,
  leaseId: Prisma.sql`p."leaseId"`,
  status: Prisma.sql`p.status`,
};

/** The columns of `expenses e`, as the financial report aliases it. */
/** Installment invoices, which the collections report weighs. */
export const INVOICE_COLUMNS: PaymentColumns = {
  propertyId: Prisma.sql`i."propertyId"`,
  tenantId: Prisma.sql`i."tenantId"`,
  leaseId: Prisma.sql`i."leaseId"`,
  status: Prisma.sql`i.status`,
};

export const EXPENSE_COLUMNS: ExpenseColumns = {
  propertyId: Prisma.sql`e."propertyId"`,
};

/**
 * "The row's building belongs to this owner and sits in this compound" — one
 * sub-select, so both have to hold of the same building.
 */
function buildingCondition(
  propertyColumn: Prisma.Sql,
  filters: Pick<FinancialFilters, "ownerId" | "compoundId">,
): Prisma.Sql | null {
  if (!filters.ownerId && !filters.compoundId) return null;
  const clauses: Prisma.Sql[] = [Prisma.sql`b.id = ${propertyColumn}`];
  if (filters.ownerId) clauses.push(Prisma.sql`b."ownerId" = ${filters.ownerId}`);
  if (filters.compoundId) {
    clauses.push(Prisma.sql`b."compoundId" = ${filters.compoundId}`);
  }
  return Prisma.sql`EXISTS (SELECT 1 FROM properties b WHERE ${Prisma.join(
    clauses,
    " AND ",
  )})`;
}

/**
 * The filters as conditions on `payments`.
 *
 * A payment has no unit of its own: it is the unit of the contract it was
 * charged under, so one with no contract matches no unit.
 */
export function paymentFilterConditions(
  filters: FinancialFilters,
  columns: PaymentColumns = PAYMENT_COLUMNS,
): Prisma.Sql[] {
  const conditions: Prisma.Sql[] = [];
  if (filters.propertyId) {
    conditions.push(Prisma.sql`${columns.propertyId} = ${filters.propertyId}`);
  }
  const building = buildingCondition(columns.propertyId, filters);
  if (building) conditions.push(building);
  if (filters.tenantId) {
    conditions.push(Prisma.sql`${columns.tenantId} = ${filters.tenantId}`);
  }
  if (filters.leaseId) {
    conditions.push(Prisma.sql`${columns.leaseId} = ${filters.leaseId}`);
  }
  if (filters.unitId) {
    conditions.push(
      Prisma.sql`EXISTS (SELECT 1 FROM leases l WHERE l.id = ${columns.leaseId} AND l."unitId" = ${filters.unitId})`,
    );
  }
  if (filters.status) {
    conditions.push(Prisma.sql`${columns.status} = ${filters.status}`);
  }
  return conditions;
}

/**
 * The filters as conditions on `expenses`.
 *
 * An expense belongs to a building at most — it names no tenant and no
 * contract — so only the building filters apply to it. One with no building
 * is office overhead and matches none of them.
 */
export function expenseFilterConditions(
  filters: FinancialFilters,
  columns: ExpenseColumns = EXPENSE_COLUMNS,
): Prisma.Sql[] {
  const conditions: Prisma.Sql[] = [];
  if (filters.propertyId) {
    conditions.push(Prisma.sql`${columns.propertyId} = ${filters.propertyId}`);
  }
  const building = buildingCondition(columns.propertyId, filters);
  if (building) conditions.push(building);
  return conditions;
}

/**
 * Conditions joined with AND — the reader's scope among them. Empty is every
 * row, written out so the clause is never `WHERE ` with nothing after it.
 */
export function allOf(conditions: readonly Prisma.Sql[]): Prisma.Sql {
  return conditions.length
    ? Prisma.join([...conditions], " AND ")
    : Prisma.sql`TRUE`;
}
