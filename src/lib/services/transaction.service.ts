/**
 * PropertyPro - Unified Transaction Service
 * Aggregates data from the payments, invoices, and expenses tables with a
 * single UNION ALL query (the Postgres equivalent of the old $unionWith
 * aggregation pipeline).
 */

import { db } from "@/lib/db/prisma";
import {
  expenseScopeSql,
  invoiceScopeSql,
  paymentScopeSql,
  type ScopeActor,
} from "@/lib/db/scopes";
import { Prisma } from "@/generated/prisma/client";
import {
  PaymentStatus,
  PaymentType,
  InvoiceStatus,
  TransactionType,
  ExpenseStatus,
} from "@/types";
import type { IUnifiedTransaction, ITransactionSummary } from "@/types";
import { gatewayColumnsAvailable } from "@/lib/payments/gateway-columns";

export interface TransactionQueryParams {
  /**
   * Who is asking. Required: this listing used to be narrowed for a tenant
   * and for nobody else, so an owner — or an employee assigned a few
   * buildings — read the whole organization's payments and expenses, and
   * any one building's by naming it.
   */
  actor: ScopeActor;
  page: number;
  limit: number;
  search?: string;
  type?: TransactionType;
  category?: string;
  propertyId?: string;
  tenantId?: string;
  startDate?: Date;
  endDate?: Date;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  bankOnly?: boolean;
}

export interface TransactionListResult {
  transactions: IUnifiedTransaction[];
  summary: ITransactionSummary;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

function getPaymentDescription(payment: any): string {
  const typeLabels: Record<string, string> = {
    [PaymentType.RENT]: "Rent Payment",
    [PaymentType.SECURITY_DEPOSIT]: "Security Deposit",
    [PaymentType.LATE_FEE]: "Late Fee",
    [PaymentType.PET_DEPOSIT]: "Pet Deposit",
    [PaymentType.UTILITY]: "Utility Payment",
    [PaymentType.MAINTENANCE]: "Maintenance Payment",
    [PaymentType.INVOICE]: "Invoice Payment",
    [PaymentType.OTHER]: "Other Payment",
  };
  return typeLabels[payment.type] || "Payment";
}

/** Escape LIKE wildcards so user input matches literally (as regex search did). */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`);
}

interface TxRow {
  txDate: Date;
  txType: string;
  txCategory: string;
  txDescription: string;
  txReference: string;
  txAmount: number;
  txStatus: string;
  txSourceType: string;
  txSourceId: string;
  tenantId: string | null;
  tenantFirstName: string | null;
  tenantLastName: string | null;
  tenantEmail: string | null;
  propId: string | null;
  propName: string | null;
}

export class TransactionService {
  /**
   * Payments branch of the union (income rows sourced from payments)
   */
  private buildPaymentsBranch(
    params: TransactionQueryParams,
    // Whether payments.gatewayPaymentId exists yet (lib/payments/gateway-columns.ts).
    gatewayColumns = false,
  ): Prisma.Sql {
    const bankOnly = Boolean(params.bankOnly);
    const conditions: Prisma.Sql[] = [Prisma.sql`p."deletedAt" IS NULL`];
    if (params.propertyId) {
      conditions.push(Prisma.sql`p."propertyId" = ${params.propertyId}`);
    }
    if (params.tenantId) {
      conditions.push(Prisma.sql`p."tenantId" = ${params.tenantId}`);
    }
    if (bankOnly) {
      conditions.push(Prisma.sql`p.status = ${PaymentStatus.PAID}`);
    }
    // AND-ed after the caller's own `propertyId` and `tenantId`, which
    // narrow it and cannot replace it. The same in the two branches below.
    const scope = paymentScopeSql(params.actor, {
      tenantId: Prisma.sql`p."tenantId"`,
      propertyId: Prisma.sql`p."propertyId"`,
    });
    if (scope) conditions.push(scope);
    if (params.startDate || params.endDate) {
      const dateCol = bankOnly
        ? Prisma.raw('p."paidDate"')
        : Prisma.raw('p."createdAt"');
      if (params.startDate) {
        conditions.push(Prisma.sql`${dateCol} >= ${new Date(params.startDate)}`);
      }
      if (params.endDate) {
        conditions.push(Prisma.sql`${dateCol} <= ${new Date(params.endDate)}`);
      }
    }

    const txDate = bankOnly
      ? Prisma.sql`COALESCE(p."paidDate", p."createdAt")`
      : Prisma.sql`COALESCE(p."paidDate", p."dueDate", p."createdAt")`;

    return Prisma.sql`
      SELECT
        ${txDate} AS "txDate",
        'income' AS "txType",
        COALESCE(p.type, 'rent') AS "txCategory",
        COALESCE(p.type, 'Payment') AS "txDescription",
        COALESCE(${gatewayColumns ? Prisma.raw('p."gatewayPaymentId", ') : Prisma.empty}p."stripePaymentIntentId", 'PAY-' || substr(p.id, 19, 6)) AS "txReference",
        COALESCE(p.amount, 0)::float AS "txAmount",
        p.status AS "txStatus",
        'payment' AS "txSourceType",
        p.id AS "txSourceId",
        u.id AS "tenantId",
        u."firstName" AS "tenantFirstName",
        u."lastName" AS "tenantLastName",
        u.email AS "tenantEmail",
        pr.id AS "propId",
        pr.name AS "propName"
      FROM payments p
      LEFT JOIN users u ON u.id = p."tenantId"
      LEFT JOIN properties pr ON pr.id = p."propertyId"
      WHERE ${Prisma.join(conditions, " AND ")}
    `;
  }

  /**
   * Invoices branch of the union (income rows sourced from invoices)
   */
  private buildInvoicesBranch(params: TransactionQueryParams): Prisma.Sql {
    const conditions: Prisma.Sql[] = [Prisma.sql`i."deletedAt" IS NULL`];
    if (params.propertyId) {
      conditions.push(Prisma.sql`i."propertyId" = ${params.propertyId}`);
    }
    if (params.tenantId) {
      conditions.push(Prisma.sql`i."tenantId" = ${params.tenantId}`);
    }
    const scope = invoiceScopeSql(params.actor, {
      tenantId: Prisma.sql`i."tenantId"`,
      propertyId: Prisma.sql`i."propertyId"`,
    });
    if (scope) conditions.push(scope);
    if (params.startDate) {
      conditions.push(Prisma.sql`i."createdAt" >= ${new Date(params.startDate)}`);
    }
    if (params.endDate) {
      conditions.push(Prisma.sql`i."createdAt" <= ${new Date(params.endDate)}`);
    }

    return Prisma.sql`
      SELECT
        COALESCE(i."issueDate", i."createdAt") AS "txDate",
        'income' AS "txType",
        COALESCE(i."lineItems"->0->>'type', 'rent') AS "txCategory",
        'Invoice ' || COALESCE(i."invoiceNumber", 'INV-' || substr(i.id, 19, 6)) AS "txDescription",
        COALESCE(i."invoiceNumber", 'INV-' || substr(i.id, 19, 6)) AS "txReference",
        COALESCE(i."totalAmount", 0)::float AS "txAmount",
        i.status AS "txStatus",
        'invoice' AS "txSourceType",
        i.id AS "txSourceId",
        u.id AS "tenantId",
        u."firstName" AS "tenantFirstName",
        u."lastName" AS "tenantLastName",
        u.email AS "tenantEmail",
        pr.id AS "propId",
        pr.name AS "propName"
      FROM invoices i
      LEFT JOIN users u ON u.id = i."tenantId"
      LEFT JOIN properties pr ON pr.id = i."propertyId"
      WHERE ${Prisma.join(conditions, " AND ")}
    `;
  }

  /**
   * Expenses branch of the union (expense rows)
   */
  private buildExpensesBranch(params: TransactionQueryParams): Prisma.Sql {
    const conditions: Prisma.Sql[] = [Prisma.sql`e."deletedAt" IS NULL`];
    if (params.propertyId) {
      conditions.push(Prisma.sql`e."propertyId" = ${params.propertyId}`);
    }
    if (params.bankOnly) {
      conditions.push(Prisma.sql`e.status = ${ExpenseStatus.PAID}`);
    }
    // An expense with no building is the office's own, and so is nobody
    // else's: the rule keys on the building.
    const scope = expenseScopeSql(params.actor, {
      propertyId: Prisma.sql`e."propertyId"`,
    });
    if (scope) conditions.push(scope);
    if (params.startDate) {
      conditions.push(Prisma.sql`e."date" >= ${new Date(params.startDate)}`);
    }
    if (params.endDate) {
      conditions.push(Prisma.sql`e."date" <= ${new Date(params.endDate)}`);
    }

    return Prisma.sql`
      SELECT
        COALESCE(e."date", e."createdAt") AS "txDate",
        'expense' AS "txType",
        COALESCE(e.category, 'other') AS "txCategory",
        COALESCE(e.description, 'Expense') AS "txDescription",
        COALESCE(e."expenseNumber", 'EXP-' || substr(e.id, 19, 6)) AS "txReference",
        COALESCE(e.amount, 0)::float AS "txAmount",
        e.status AS "txStatus",
        'expense' AS "txSourceType",
        e.id AS "txSourceId",
        NULL::text AS "tenantId",
        NULL::text AS "tenantFirstName",
        NULL::text AS "tenantLastName",
        NULL::text AS "tenantEmail",
        pr.id AS "propId",
        pr.name AS "propName"
      FROM expenses e
      LEFT JOIN properties pr ON pr.id = e."propertyId"
      WHERE ${Prisma.join(conditions, " AND ")}
    `;
  }

  /**
   * Get unified transactions with one UNION ALL query per facet
   */
  async getUnifiedTransactions(
    params: TransactionQueryParams
  ): Promise<TransactionListResult> {
    const {
      page = 1,
      limit = 12,
      search,
      type,
      category,
      sortBy = "date",
      sortOrder = "desc",
      bankOnly = false,
    } = params;

    const isIncomeOnly = type === TransactionType.INCOME;
    const isExpenseOnly = type === TransactionType.EXPENSE;
    const skip = (page - 1) * limit;

    // Tenant-scoped views should never expose global property expenses.
    if (isExpenseOnly && params.tenantId) {
      return {
        transactions: [],
        summary: {
          totalIncome: 0,
          totalExpenses: 0,
          netAmount: 0,
          outstanding: 0,
          transactionCount: 0,
        },
        pagination: {
          page,
          limit,
          total: 0,
          totalPages: 0,
        },
      };
    }

    // Assemble the union branches (mirrors the old $unionWith pipeline)
    const branches: Prisma.Sql[] = [];
    if (isExpenseOnly) {
      branches.push(this.buildExpensesBranch(params));
    } else {
      branches.push(
        this.buildPaymentsBranch(params, await gatewayColumnsAvailable()),
      );
      if (!bankOnly) {
        branches.push(this.buildInvoicesBranch(params));
      }
      if (!isIncomeOnly && !params.tenantId) {
        branches.push(this.buildExpensesBranch(params));
      }
    }
    const unionSql = Prisma.join(branches, " UNION ALL ");

    // Post-union filters (search / category / type)
    const filterConditions: Prisma.Sql[] = [];
    if (search) {
      const pattern = `%${escapeLike(search)}%`;
      filterConditions.push(Prisma.sql`(
        "txDescription" ILIKE ${pattern}
        OR "txReference" ILIKE ${pattern}
        OR "txCategory" ILIKE ${pattern}
        OR "tenantFirstName" ILIKE ${pattern}
        OR "tenantLastName" ILIKE ${pattern}
        OR "propName" ILIKE ${pattern}
      )`);
    }
    if (category) {
      filterConditions.push(Prisma.sql`"txCategory" = ${category}`);
    }
    if (type) {
      filterConditions.push(Prisma.sql`"txType" = ${type}`);
    }
    const txWhere = filterConditions.length
      ? Prisma.sql`WHERE ${Prisma.join(filterConditions, " AND ")}`
      : Prisma.empty;

    const orderColumn =
      sortBy === "amount" ? Prisma.raw('"txAmount"') : Prisma.raw('"txDate"');
    const orderDirection =
      sortOrder === "asc" ? Prisma.raw("ASC") : Prisma.raw("DESC");

    // Summary conditions (identical to the old $facet accumulators)
    const incomeCondition = bankOnly
      ? Prisma.sql`"txSourceType" = 'payment'`
      : Prisma.sql`(
          ("txSourceType" = 'payment' AND "txStatus" = ${PaymentStatus.PAID})
          OR ("txSourceType" = 'invoice' AND "txStatus" = ${InvoiceStatus.PAID})
        )`;

    const expenseCondition = bankOnly
      ? Prisma.sql`"txSourceType" = 'expense'`
      : Prisma.sql`(
          "txSourceType" = 'expense' AND "txStatus" = ${ExpenseStatus.PAID}
        )`;

    const outstandingExpression = bankOnly
      ? Prisma.sql`0::float`
      : Prisma.sql`COALESCE(sum("txAmount") FILTER (WHERE
          ("txSourceType" = 'payment' AND "txStatus" IN (${PaymentStatus.PENDING}, ${PaymentStatus.OVERDUE}))
          OR ("txSourceType" = 'invoice' AND "txStatus" IN (${InvoiceStatus.ISSUED}, ${InvoiceStatus.OVERDUE}, ${InvoiceStatus.PARTIAL}))
          OR ("txSourceType" = 'expense' AND "txStatus" IN (${ExpenseStatus.PENDING}, ${ExpenseStatus.APPROVED}))
        ), 0)::float`;

    const [rows, summaryRows] = await Promise.all([
      db.$queryRaw<TxRow[]>`
        WITH tx AS (${unionSql})
        SELECT * FROM tx
        ${txWhere}
        ORDER BY ${orderColumn} ${orderDirection}
        LIMIT ${limit} OFFSET ${skip}
      `,
      db.$queryRaw<
        Array<{
          totalIncome: number;
          totalExpenses: number;
          outstanding: number;
          transactionCount: number;
        }>
      >`
        WITH tx AS (${unionSql})
        SELECT
          COALESCE(sum("txAmount") FILTER (WHERE ${incomeCondition}), 0)::float AS "totalIncome",
          COALESCE(sum("txAmount") FILTER (WHERE ${expenseCondition}), 0)::float AS "totalExpenses",
          ${outstandingExpression} AS "outstanding",
          count(*)::int AS "transactionCount"
        FROM tx
        ${txWhere}
      `,
    ]);

    const transactions: IUnifiedTransaction[] = rows.map((t) => ({
      id: t.txSourceId,
      date: t.txDate,
      type: t.txType as TransactionType,
      category: t.txCategory,
      description:
        t.txSourceType === "payment"
          ? getPaymentDescription({ type: t.txCategory })
          : t.txDescription,
      reference: t.txReference,
      amount: t.txAmount,
      status: t.txStatus,
      sourceType: t.txSourceType as IUnifiedTransaction["sourceType"],
      sourceId: t.txSourceId,
      tenantId: t.tenantId
        ? {
            _id: t.tenantId,
            firstName: t.tenantFirstName || "",
            lastName: t.tenantLastName || "",
            email: t.tenantEmail ?? undefined,
          }
        : undefined,
      propertyId: t.propId
        ? {
            _id: t.propId,
            name: t.propName || "",
          }
        : undefined,
    }));

    const summaryData = summaryRows[0];
    const total = summaryData?.transactionCount || 0;
    const summary: ITransactionSummary = {
      totalIncome: summaryData?.totalIncome || 0,
      totalExpenses: summaryData?.totalExpenses || 0,
      netAmount:
        (summaryData?.totalIncome || 0) - (summaryData?.totalExpenses || 0),
      outstanding: summaryData?.outstanding || 0,
      transactionCount: total,
    };

    return {
      transactions,
      summary,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get transactions for a specific tenant
   */
  async getTenantTransactions(
    tenantId: string,
    params: Omit<TransactionQueryParams, "tenantId">
  ): Promise<TransactionListResult> {
    return this.getUnifiedTransactions({
      ...params,
      tenantId,
    });
  }
}

// Export singleton instance
export const transactionService = new TransactionService();
