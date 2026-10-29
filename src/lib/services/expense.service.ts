/**
 * PropertyPro - Expense Service
 * CRUD and analytics for expense tracking
 */

import { db } from "@/lib/db/prisma";
import { Prisma } from "@/generated/prisma/client";
import { getOrgContext } from "@/lib/tenancy/context";
import { ExpenseStatus } from "@/types";
import { postAfterCommit } from "@/lib/accounting/hooks";
import {
  applyScope,
  expenseScope,
  withScope,
  type ScopeActor,
} from "@/lib/db/scopes";
import {
  accountingPhase0Available,
  expensePhase0Omit,
} from "@/lib/invoice/phase0-columns";
import { businessDayStart, businessMonthRange, businessToday } from "@/lib/dates/business-day";

/**
 * Why a caller may not put an expense on this building, or null.
 *
 * An employee limited to some buildings sees an expense only on one of them
 * (lib/db/scopes.ts: an expense with no building is the office's overhead and
 * outside every portfolio). So they may record or move one only onto a
 * building of theirs — anything else would be an expense they then could not
 * see, charged where they do not work.
 */
export function expenseBuildingRefusal(
  actor: ScopeActor,
  propertyId: string | null | undefined,
): string | null {
  if (actor.scopedPropertyIds === undefined) return null;
  if (!propertyId) {
    return "You are limited to some buildings, so an expense you record must be on one of them.";
  }
  return actor.scopedPropertyIds.includes(propertyId)
    ? null
    : "You can only record expenses on buildings you are assigned.";
}

/** Thrown for a building the caller may not charge; the route answers 403. */
export class ExpenseScopeError extends Error {
  readonly statusCode = 403;
}

export interface ExpenseQueryParams {
  /**
   * Who is asking. An employee limited to some buildings reads only their
   * expenses; this list used to show every expense to anyone with finance
   * rights, the one money screen not narrowed by building.
   */
  actor: ScopeActor;
  page: number;
  limit: number;
  search?: string;
  category?: string;
  status?: string;
  propertyId?: string;
  startDate?: Date;
  endDate?: Date;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export interface ExpenseSummary {
  totalExpenses: number;
  totalPaid: number;
  totalPending: number;
  monthToDate: number;
  yearToDate: number;
  topCategory: string;
  count: number;
}

const propertySelect = {
  id: true,
  name: true,
  addressStreet: true,
  addressCity: true,
  addressState: true,
  addressZipCode: true,
  addressCountry: true,
} as const;

const creatorSelect = {
  id: true,
  firstName: true,
  lastName: true,
} as const;

const supplierSelect = { id: true, name: true, vatNumber: true } as const;

/**
 * The supplier, with the expense's VAT columns, once migration
 * 20261004121500_accounting_phase0 has added them (phase0-columns.ts): a
 * relation over a column the database lacks fails the whole read.
 */
async function phase0Read() {
  const available = await accountingPhase0Available();
  return {
    omit: await expensePhase0Omit(),
    supplier: available ? { supplier: { select: supplierSelect } } : {},
  };
}

/** Fields callers may set on an expense (old schema surface). */
const WRITABLE_FIELDS = [
  "expenseNumber",
  "propertyId",
  "unitId",
  "category",
  "description",
  "amount",
  "date",
  "paymentMethod",
  "referenceNumber",
  "receiptUrl",
  "notes",
  "isRecurring",
  "recurringConfig",
  "status",
  "taxDeductible",
  // Accounting phase 0: the VAT inside the amount and who it was bought from.
  "vatAmount",
  "vatCategory",
  "supplierId",
  "supplierInvoiceNumber",
] as const;

function pickWritable(data: any): Record<string, any> {
  const out: Record<string, any> = {};
  for (const key of WRITABLE_FIELDS) {
    if (data?.[key] !== undefined) out[key] = data[key];
  }
  if (out.date !== undefined) out.date = new Date(out.date);
  return out;
}

/**
 * Rebuild the shapes the old populate produced: `propertyId` as
 * `{ id, name, address: { ... } }` and `createdBy` as `{ id, firstName,
 * lastName }` (or the raw id when the creator was not fetched).
 */
function mapExpense(expense: any): any {
  if (!expense) return expense;
  const { property, createdBy, ...rest } = expense;
  return {
    ...rest,
    ...(rest.vatAmount !== undefined ? { vatAmount: Number(rest.vatAmount) } : {}),
    propertyId: property
      ? {
          id: property.id,
          name: property.name,
          address: {
            street: property.addressStreet,
            city: property.addressCity,
            state: property.addressState,
            zipCode: property.addressZipCode,
            country: property.addressCountry,
          },
        }
      : expense.propertyId,
    createdBy: createdBy ?? expense.createdById,
  };
}

export class ExpenseService {
  /**
   * List expenses with filters and pagination
   */
  async listExpenses(params: ExpenseQueryParams) {
    const {
      actor,
      page = 1,
      limit = 12,
      search,
      category,
      status,
      propertyId,
      startDate,
      endDate,
      sortBy = "date",
      sortOrder = "desc",
    } = params;

    const where: Prisma.ExpenseWhereInput = {};

    if (category && category !== "all") {
      where.category = category;
    }
    if (status && status !== "all") {
      where.status = status;
    }
    if (propertyId) {
      where.propertyId = propertyId;
    }
    if (startDate || endDate) {
      where.date = {
        ...(startDate ? { gte: new Date(startDate) } : {}),
        ...(endDate ? { lte: new Date(endDate) } : {}),
      };
    }
    if (search) {
      where.OR = [
        { description: { contains: search, mode: "insensitive" } },
        { expenseNumber: { contains: search, mode: "insensitive" } },
        { referenceNumber: { contains: search, mode: "insensitive" } },
        { notes: { contains: search, mode: "insensitive" } },
      ];
    }
    // AND-ed on, so a requested building narrows the scope and never
    // replaces it.
    applyScope(where, expenseScope(actor));

    const sortKey = sortBy === "date" ? "date" : sortBy;
    const skip = (page - 1) * limit;
    const phase0 = await phase0Read();

    const [expenses, total] = await Promise.all([
      db.expense.findMany({
        where,
        omit: phase0.omit,
        include: {
          property: { select: propertySelect },
          createdBy: { select: creatorSelect },
          ...phase0.supplier,
        },
        orderBy: { [sortKey]: sortOrder } as any,
        skip,
        take: limit,
      }),
      db.expense.count({ where }),
    ]);

    return {
      expenses: expenses.map(mapExpense),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get expense summary stats
   */
  async getExpenseSummary(
    actor: ScopeActor,
    propertyId?: string,
  ): Promise<ExpenseSummary> {
    const baseWhere: Prisma.ExpenseWhereInput = {};
    if (propertyId) {
      baseWhere.propertyId = propertyId;
    }
    applyScope(baseWhere, expenseScope(actor));

    // This month and this year start at Riyadh's midnight, not the server's.
    const today = businessToday();
    const startOfMonth = businessDayStart(businessMonthRange(today).from);
    const startOfYear = businessDayStart(`${today.slice(0, 4)}-01-01`);

    const [byStatus, mtdExpenses, ytdExpenses, categoryAgg] =
      await Promise.all([
        db.expense.groupBy({
          by: ["status"],
          _sum: { amount: true },
          _count: { _all: true },
          where: baseWhere,
        }),
        db.expense.aggregate({
          _sum: { amount: true },
          where: { ...baseWhere, date: { gte: startOfMonth } },
        }),
        db.expense.aggregate({
          _sum: { amount: true },
          where: { ...baseWhere, date: { gte: startOfYear } },
        }),
        db.expense.groupBy({
          by: ["category"],
          _sum: { amount: true },
          where: baseWhere,
          orderBy: { _sum: { amount: "desc" } },
          take: 1,
        }),
      ]);

    let totalExpenses = 0;
    let totalPaid = 0;
    let totalPending = 0;
    let count = 0;

    for (const group of byStatus) {
      const amount = group._sum.amount || 0;
      totalExpenses += amount;
      count += group._count._all || 0;
      if (group.status === ExpenseStatus.PAID) {
        totalPaid += amount;
      } else if (
        group.status === ExpenseStatus.PENDING ||
        group.status === ExpenseStatus.APPROVED
      ) {
        totalPending += amount;
      }
    }

    return {
      totalExpenses,
      totalPaid,
      totalPending,
      monthToDate: mtdExpenses._sum.amount || 0,
      yearToDate: ytdExpenses._sum.amount || 0,
      topCategory: categoryAgg[0]?.category || "none",
      count,
    };
  }

  /**
   * Create a new expense
   */
  async createExpense(data: any, actor?: ScopeActor) {
    if (actor) {
      const refusal = expenseBuildingRefusal(actor, data?.propertyId);
      if (refusal) throw new ExpenseScopeError(refusal);
    }

    const organizationId =
      data?.organizationId ?? getOrgContext()?.organizationId;
    if (!organizationId) {
      throw new Error("Organization context required to create an expense");
    }

    const createdById = data?.createdById ?? data?.createdBy;
    if (!createdById) {
      throw new Error("createdBy is required to create an expense");
    }

    const phase0 = await phase0Read();
    const expense = await db.expense.create({
      data: {
        ...(pickWritable(data) as any),
        organizationId,
        createdById,
      },
      omit: phase0.omit,
      include: { property: { select: propertySelect }, ...phase0.supplier },
    });
    postAfterCommit("expense", expense.id, { userId: createdById });

    return mapExpense(expense);
  }

  /**
   * Get a single expense by ID
   */
  async getExpense(actor: ScopeActor, id: string) {
    const phase0 = await phase0Read();
    const expense = await db.expense.findFirst({
      where: withScope({ id }, expenseScope(actor)),
      omit: phase0.omit,
      include: {
        property: { select: propertySelect },
        createdBy: { select: creatorSelect },
        ...phase0.supplier,
      },
    });
    return mapExpense(expense);
  }

  /**
   * Update an expense
   */
  async updateExpense(actor: ScopeActor, id: string, data: any) {
    const existing = await db.expense.findFirst({
      where: withScope({ id }, expenseScope(actor)),
      select: { id: true },
    });
    if (!existing) return null;

    // Moving it is recording it somewhere new: onto a building of theirs.
    if (data?.propertyId !== undefined) {
      const refusal = expenseBuildingRefusal(actor, data.propertyId);
      if (refusal) throw new ExpenseScopeError(refusal);
    }

    const phase0 = await phase0Read();
    const expense = await db.expense.update({
      where: { id },
      data: pickWritable(data) as any,
      omit: phase0.omit,
      include: { property: { select: propertySelect }, ...phase0.supplier },
    });
    // Approving, paying and cancelling all arrive here as a status.
    postAfterCommit("expense", id);
    return mapExpense(expense);
  }

  /**
   * Soft delete an expense
   */
  async deleteExpense(actor: ScopeActor, id: string) {
    const existing = await db.expense.findFirst({
      where: withScope({ id }, expenseScope(actor)),
      select: { id: true },
    });
    if (!existing) return null;

    const deleted = await db.expense.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        status: ExpenseStatus.CANCELLED,
      },
    });
    postAfterCommit("expense", id);
    return deleted;
  }

  /**
   * Get expenses grouped by category (for charts)
   */
  async getExpensesByCategory(
    startDate?: Date,
    endDate?: Date,
    propertyId?: string,
  ) {
    const where: Prisma.ExpenseWhereInput = {};
    if (propertyId) where.propertyId = propertyId;
    if (startDate || endDate) {
      where.date = {
        ...(startDate ? { gte: startDate } : {}),
        ...(endDate ? { lte: endDate } : {}),
      };
    }

    const result = await db.expense.groupBy({
      by: ["category"],
      _sum: { amount: true },
      _count: { _all: true },
      where,
      orderBy: { _sum: { amount: "desc" } },
    });

    // Preserve the old aggregation output shape: [{ _id, total, count }]
    return result.map((r) => ({
      _id: r.category,
      total: r._sum.amount || 0,
      count: r._count._all,
    }));
  }

  /**
   * Get monthly expense trends
   */
  async getMonthlyTrends(months: number = 12, propertyId?: string) {
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - months);

    const conditions: Prisma.Sql[] = [
      Prisma.sql`"deletedAt" IS NULL`,
      Prisma.sql`"date" >= ${startDate}`,
    ];
    if (propertyId) conditions.push(Prisma.sql`"propertyId" = ${propertyId}`);
    const where = Prisma.join(conditions, " AND ");

    const rows = await db.$queryRaw<
      Array<{ year: number; month: number; total: number; count: number }>
    >`
      SELECT
        EXTRACT(YEAR FROM "date")::int AS "year",
        EXTRACT(MONTH FROM "date")::int AS "month",
        COALESCE(sum(amount), 0)::float AS "total",
        count(*)::int AS "count"
      FROM expenses
      WHERE ${where}
      GROUP BY 1, 2
      ORDER BY 1, 2
    `;

    // Preserve the old aggregation output shape: [{ _id: { year, month }, total, count }]
    return rows.map((r) => ({
      _id: { year: r.year, month: r.month },
      total: r.total,
      count: r.count,
    }));
  }
}

export const expenseService = new ExpenseService();
