/**
 * PropertyPro - Payables aging, read from the documents
 *
 * What the office owes each supplier at a day (default today), by how long it
 * has been due — see aging.ts for the columns. The things it is made of:
 *
 *  - approved bills, with what was still unpaid on them at the day: the bill's
 *    total less the allocations of vouchers dated on or before it. A bill paid
 *    off after the day is still owed at it, so it is read too;
 *  - expenses approved with a supplier but not yet paid, which the books also
 *    owe the supplier (posting/expense.ts), due on their own date;
 *  - what vouchers paid beyond the bills they were allocated to, which sits on
 *    account with the supplier.
 *
 * The books' own figure for the suppliers' payable account at the same day is
 * returned beside the total, with the difference: opening balances, journals
 * written by hand and documents dated before the cut-over are in one and not
 * the other, and the accountant should see by how much.
 *
 * Approximation, stated: whether a bill had been approved by the day, and
 * whether an expense had been paid by it, are read from their state now —
 * neither keeps the date it changed.
 */

import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db/prisma";
import { accountingPhase0Available } from "@/lib/invoice/phase0-columns";
import { formatDay } from "../dates";
import { toHalalas } from "../money";
import { buildAging, type AgingAdvance, type AgingItem, type PayablesAging } from "./aging";
import { money, requirePurchases } from "./common";
import { formatBillNumber, formatVoucherNumber } from "./numbers";
import { payablesAccountId } from "./suppliers.service";
import { PAYABLE_BILL_STATUSES } from "./types";

export type { PayablesAging };

export async function payablesAging(
  asOf: Date,
  options: { supplierId?: string | null } = {},
): Promise<PayablesAging> {
  await requirePurchases();
  const supplierId = options.supplierId || null;
  const phase0 = await accountingPhase0Available();
  const day = formatDay(asOf);

  const [bills, expenses, advanceRows, accountId] = await Promise.all([
    db.purchaseBill.findMany({
      where: {
        billDate: { lte: asOf },
        ...(supplierId ? { supplierId } : {}),
        OR: [
          { status: { in: [...PAYABLE_BILL_STATUSES] } },
          // Paid since: owed still at a day before its last payment.
          {
            status: "paid",
            allocations: { some: { voucher: { status: "posted", voucherDate: { gt: asOf } } } },
          },
        ],
      },
      select: {
        id: true,
        number: true,
        supplierId: true,
        supplier: { select: { name: true } },
        supplierInvoiceNumber: true,
        billDate: true,
        dueDate: true,
        totalAmount: true,
        allocations: {
          where: { voucher: { status: "posted", voucherDate: { lte: asOf } } },
          select: { amount: true },
        },
      },
    }),
    phase0
      ? db.expense.findMany({
          where: {
            status: "approved",
            supplierId: supplierId ?? { not: null },
            date: { lte: asOf },
          },
          select: {
            id: true,
            expenseNumber: true,
            supplierId: true,
            supplier: { select: { name: true } },
            supplierInvoiceNumber: true,
            date: true,
            amount: true,
          },
        })
      : Promise.resolve([]),
    // What a voucher paid beyond its allocations. An allocation counts from
    // the voucher's own date, as a bill's payment does above.
    db.$queryRaw<
      Array<{ id: string; number: number; supplierId: string; supplierName: string; voucherDate: Date; remainder: string }>
    >`
      SELECT v."id", v."number", v."supplierId", s."name" AS "supplierName", v."voucherDate",
             (v."amount" - COALESCE(a."allocated", 0))::text AS "remainder"
        FROM "payment_vouchers" v
        JOIN "suppliers" s ON s."id" = v."supplierId"
        LEFT JOIN (
          SELECT "voucherId", SUM("amount") AS "allocated"
            FROM "payment_voucher_allocations"
           GROUP BY "voucherId"
        ) a ON a."voucherId" = v."id"
       WHERE v."status" = 'posted'
         AND v."voucherDate" <= ${day}::timestamp
         AND v."amount" > COALESCE(a."allocated", 0)
         ${supplierId ? Prisma.sql`AND v."supplierId" = ${supplierId}` : Prisma.empty}`,
    payablesAccountId(),
  ]);

  const items: AgingItem[] = [
    ...bills.map((bill) => {
      const paid = bill.allocations.reduce((total, allocation) => total + toHalalas(money(allocation.amount)), 0);
      return {
        kind: "bill" as const,
        id: bill.id,
        number: formatBillNumber(bill.number) ?? String(bill.number),
        supplierId: bill.supplierId,
        supplierName: bill.supplier?.name ?? "—",
        reference: bill.supplierInvoiceNumber,
        date: bill.billDate,
        dueDate: bill.dueDate,
        total: money(bill.totalAmount),
        outstanding: (toHalalas(money(bill.totalAmount)) - paid) / 100,
      };
    }),
    ...expenses
      .filter((expense) => expense.supplierId)
      .map((expense) => ({
        kind: "expense" as const,
        id: expense.id,
        number: expense.expenseNumber ?? expense.id,
        supplierId: expense.supplierId as string,
        supplierName: expense.supplier?.name ?? "—",
        reference: expense.supplierInvoiceNumber ?? null,
        date: expense.date,
        dueDate: expense.date,
        total: money(expense.amount),
        outstanding: money(expense.amount),
      })),
  ];

  const advances: AgingAdvance[] = advanceRows.map((row) => ({
    supplierId: row.supplierId,
    supplierName: row.supplierName,
    voucherId: row.id,
    number: formatVoucherNumber(row.number) ?? String(row.number),
    date: new Date(row.voucherDate),
    amount: Number(row.remainder),
  }));

  const report = buildAging(items, advances, asOf);

  let ledger: PayablesAging["ledger"] = null;
  if (accountId) {
    const sums = await db.journalLine.aggregate({
      where: {
        accountId,
        date: { lte: asOf },
        ...(supplierId ? { partyType: "supplier", partyId: supplierId } : {}),
      },
      _sum: { debit: true, credit: true },
    });
    const balance =
      (toHalalas(money(sums._sum.credit)) - toHalalas(money(sums._sum.debit))) / 100 || 0;
    ledger = {
      balance,
      difference: (toHalalas(balance) - toHalalas(report.totals.net)) / 100 || 0,
    };
  }
  return { ...report, ledger };
}
