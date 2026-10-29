/**
 * PropertyPro - Payment vouchers (سند صرف)
 *
 * Money the office pays out. A voucher is made out to a supplier, drawn on one
 * of the office's bank or cash accounts, numbered in sequence (PV-000045) and
 * posted to the books the moment it is written (Dr suppliers' payable / Cr the
 * account). It can pay bills — its allocations — in part or in full, and
 * whatever it does not allocate stays on account with the supplier, to be set
 * against a bill later.
 *
 * A voucher is not edited: a wrong one is cancelled (the number stays, marked
 * cancelled; the bills it paid are released and the books reverse it) and a
 * right one is written. A voucher whose bank line has already been ticked off
 * against the bank's statement is not cancelled until it is un-ticked.
 *
 * Every write runs in one transaction under row locks on the bills it touches,
 * taken in a fixed order, so two vouchers paying the same bill at once are
 * taken one after the other and can never pay it twice.
 */

import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { db, runWithOrgTransaction, type OrgTransactionClient } from "@/lib/db/prisma";
import { requireOrgId } from "@/lib/tenancy/context";
import { AuditAction, recordActivity } from "@/lib/audit-service";
import { bankAccountLabel } from "../audit-snapshots";
import { postAfterCommit } from "../hooks";
import { ledgerError } from "../errors";
import { halalasToDecimal, toHalalas } from "../money";
import {
  checkAllocations,
  statusAfterPayment,
  type AllocatableBill,
  type AllocationInput,
} from "./bill-math";
import {
  dayOrThrow,
  dayText,
  money,
  nextNumber,
  nullable,
  parseBody,
  requireBooks,
  requirePurchases,
  userNames,
} from "./common";
import { formatBillNumber, formatVoucherNumber, parseVoucherNumber } from "./numbers";
import { allocateBodySchema, reasonBodySchema, voucherBodySchema } from "./schemas";
import { isVoucherStatus, type VoucherStatus, type VoucherView } from "./types";

interface Actor {
  id: string;
}

const VOUCHER_SELECT = {
  id: true,
  number: true,
  supplierId: true,
  supplier: { select: { id: true, name: true, vatNumber: true } },
  voucherDate: true,
  bankAccountId: true,
  bankAccount: {
    select: {
      id: true,
      name: true,
      kind: true,
      ledgerAccountId: true,
      ledgerAccount: { select: { code: true, nameAr: true, nameEn: true } },
    },
  },
  amount: true,
  currency: true,
  method: true,
  reference: true,
  notes: true,
  status: true,
  cancelledAt: true,
  cancelReason: true,
  createdById: true,
  createdAt: true,
  allocations: { select: { amount: true } },
} as const;

interface VoucherRow {
  id: string;
  number: number;
  supplierId: string;
  supplier: { id: string; name: string; vatNumber: string | null } | null;
  voucherDate: Date;
  bankAccountId: string;
  bankAccount: VoucherView["bankAccount"];
  amount: unknown;
  currency: string;
  method: string;
  reference: string | null;
  notes: string | null;
  status: string;
  cancelledAt: Date | null;
  cancelReason: string | null;
  createdById: string | null;
  createdAt: Date;
  allocations: Array<{ amount: unknown }>;
}

function toView(row: VoucherRow, names: Map<string, string>): VoucherView {
  const amount = money(row.amount);
  const status = (isVoucherStatus(row.status) ? row.status : "posted") as VoucherStatus;
  const allocated = row.allocations.reduce((sum, allocation) => sum + toHalalas(money(allocation.amount)), 0) / 100;
  return {
    id: row.id,
    number: row.number,
    displayNumber: formatVoucherNumber(row.number) ?? String(row.number),
    supplier: row.supplier,
    voucherDate: dayText(row.voucherDate),
    bankAccount: row.bankAccount,
    amount,
    currency: row.currency,
    method: row.method,
    reference: row.reference,
    notes: row.notes,
    status,
    allocated: status === "cancelled" ? 0 : allocated,
    onAccount: status === "cancelled" ? 0 : Math.max(0, toHalalas(amount) - toHalalas(allocated)) / 100,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    cancelReason: row.cancelReason,
    createdById: row.createdById,
    createdByName: row.createdById ? (names.get(row.createdById) ?? null) : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface VoucherListQuery {
  search?: string;
  status?: string;
  supplierId?: string;
  bankAccountId?: string;
  from?: Date | null;
  to?: Date | null;
  page: number;
  limit: number;
  sortBy?: "voucherDate" | "number" | "amount";
  sortOrder?: "asc" | "desc";
}

export function voucherWhere(query: VoucherListQuery): Prisma.PaymentVoucherWhereInput {
  const and: Prisma.PaymentVoucherWhereInput[] = [];
  if (query.status && query.status !== "all" && isVoucherStatus(query.status)) and.push({ status: query.status });
  if (query.supplierId) and.push({ supplierId: query.supplierId });
  if (query.bankAccountId) and.push({ bankAccountId: query.bankAccountId });
  if (query.from || query.to) {
    and.push({
      voucherDate: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) },
    });
  }
  const search = (query.search ?? "").trim();
  if (search) {
    const number = parseVoucherNumber(search);
    and.push({
      OR: [
        ...(number ? [{ number }] : []),
        { reference: { contains: search, mode: "insensitive" } },
        { supplier: { name: { contains: search, mode: "insensitive" } } },
        { notes: { contains: search, mode: "insensitive" } },
      ],
    });
  }
  return and.length ? { AND: and } : {};
}

export interface VoucherListSummary {
  count: number;
  /** Posted vouchers only. */
  totalAmount: number;
}

export async function listVouchers(
  query: VoucherListQuery,
): Promise<{ rows: VoucherView[]; total: number; summary: VoucherListSummary }> {
  await requirePurchases();
  const where = voucherWhere(query);
  const order = query.sortOrder === "asc" ? "asc" : "desc";
  const primarySort = { [query.sortBy ?? "voucherDate"]: order } as Prisma.PaymentVoucherOrderByWithRelationInput;
  const [rows, count, posted] = await Promise.all([
    db.paymentVoucher.findMany({
      where,
      select: VOUCHER_SELECT,
      orderBy: [primarySort, { number: "desc" }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    db.paymentVoucher.count({ where }),
    db.paymentVoucher.aggregate({ where: { AND: [where, { status: "posted" }] }, _sum: { amount: true } }),
  ]);
  const names = await userNames(rows.map((row) => row.createdById));
  return {
    rows: (rows as unknown as VoucherRow[]).map((row) => toView(row, names)),
    total: count,
    summary: { count, totalAmount: money(posted._sum.amount) },
  };
}

export async function getVoucher(id: string): Promise<VoucherView | null> {
  await requirePurchases();
  const row = await db.paymentVoucher.findFirst({
    where: { id },
    select: {
      ...VOUCHER_SELECT,
      allocations: {
        select: {
          amount: true,
          bill: { select: { id: true, number: true, supplierInvoiceNumber: true } },
        },
      },
    },
  });
  if (!row) return null;
  const names = await userNames([row.createdById]);
  const view = toView(row as unknown as VoucherRow, names);
  return {
    ...view,
    allocations: row.allocations
      .filter((allocation) => allocation.bill)
      .map((allocation) => ({
        billId: allocation.bill.id,
        billNumber: allocation.bill.number,
        billDisplayNumber: formatBillNumber(allocation.bill.number) ?? String(allocation.bill.number),
        supplierInvoiceNumber: allocation.bill.supplierInvoiceNumber,
        amount: money(allocation.amount),
      }))
      .sort((a, b) => a.billNumber - b.billNumber),
  };
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/** Lock these bills, in a fixed order, and read them as the allocation check needs them. */
async function lockBills(tx: OrgTransactionClient, ids: readonly string[]): Promise<Array<AllocatableBill & { number: number }>> {
  const sorted = [...new Set(ids)].sort();
  if (sorted.length === 0) return [];
  await tx.$queryRaw`SELECT "id" FROM "purchase_bills" WHERE "id" IN (${Prisma.join(sorted)}) ORDER BY "id" FOR UPDATE`;
  const rows = await tx.purchaseBill.findMany({
    where: { id: { in: sorted } },
    select: { id: true, number: true, supplierId: true, status: true, totalAmount: true, amountPaid: true },
  });
  return rows.map((row) => ({
    id: row.id,
    number: row.number,
    supplierId: row.supplierId,
    status: row.status,
    totalAmount: money(row.totalAmount),
    amountPaid: money(row.amountPaid),
  }));
}

/** Move a bill's paid amount by `deltaHalalas` and put its status where the payments leave it. */
async function applyPaid(
  tx: OrgTransactionClient,
  bill: AllocatableBill,
  deltaHalalas: number,
): Promise<void> {
  const paid = toHalalas(bill.amountPaid) + deltaHalalas;
  const status = statusAfterPayment(bill.totalAmount, paid / 100);
  await tx.purchaseBill.update({
    where: { id: bill.id },
    data: { amountPaid: halalasToDecimal(paid), status, version: { increment: 1 } },
  });
}

function refuse(problem: { code: string; message: string }): never {
  throw ledgerError(problem.code, problem.message, 409);
}

export async function createVoucher(body: unknown, actor: Actor): Promise<VoucherView> {
  await requirePurchases();
  await requireBooks();
  const input = parseBody(voucherBodySchema, body);
  const date = dayOrThrow(input.voucherDate, "The voucher date");
  const organizationId = requireOrgId();

  const [supplier, bank] = await Promise.all([
    db.supplier.findFirst({ where: { id: input.supplierId }, select: { id: true, name: true } }),
    db.bankAccount.findFirst({
      where: { id: input.bankAccountId },
      select: {
        id: true,
        name: true,
        active: true,
        ledgerAccount: { select: { active: true, postable: true, nameAr: true, nameEn: true } },
      },
    }),
  ]);
  if (!supplier) throw ledgerError("PURCHASE_SUPPLIER_NOT_FOUND", "Supplier not found", 404);
  if (!bank) throw ledgerError("LEDGER_BANK_NOT_FOUND", "Bank account not found", 404);
  if (!bank.active) throw ledgerError("LEDGER_BANK_INACTIVE", "That account is inactive");
  if (!bank.ledgerAccount.active || !bank.ledgerAccount.postable) {
    throw ledgerError("LEDGER_ACCOUNT_INACTIVE", "The ledger account of that bank account is inactive");
  }

  const created = await runWithOrgTransaction(async (tx) => {
    const bills = await lockBills(tx, input.allocations.map((allocation) => allocation.billId));
    const problem = checkAllocations({
      voucherAmount: input.amount,
      supplierId: supplier.id,
      allocations: input.allocations,
      bills,
    });
    if (problem) refuse(problem);

    const number = await nextNumber(tx, "voucher");
    const voucher = await tx.paymentVoucher.create({
      data: {
        organizationId,
        number,
        supplierId: supplier.id,
        voucherDate: date,
        bankAccountId: bank.id,
        amount: halalasToDecimal(toHalalas(input.amount)),
        method: input.method,
        reference: nullable(input.reference),
        notes: nullable(input.notes),
        status: "posted",
        createdById: actor.id,
      },
      select: { id: true, number: true },
    });
    if (input.allocations.length) {
      await tx.paymentVoucherAllocation.createMany({
        data: input.allocations.map((allocation) => ({
          organizationId,
          voucherId: voucher.id,
          billId: allocation.billId,
          amount: halalasToDecimal(toHalalas(allocation.amount)),
        })),
      });
      const byId = new Map(bills.map((bill) => [bill.id, bill]));
      for (const allocation of input.allocations) {
        await applyPaid(tx, byId.get(allocation.billId)!, toHalalas(allocation.amount));
      }
    }
    return voucher;
  });

  postAfterCommit("payment_voucher", created.id, { userId: actor.id });
  void recordActivity({
    action: AuditAction.CREATE,
    recordType: "payment_voucher",
    recordId: created.id,
    recordName: formatVoucherNumber(created.number),
    after: {
      supplier: supplier.name,
      amount: input.amount,
      // A standard account starts unnamed: the screens show its ledger account's name.
      account: bankAccountLabel(bank),
      voucherDate: dayText(date),
      bills: input.allocations.length,
    },
  });
  return (await getVoucher(created.id))!;
}

/** Lock one voucher's row for the rest of the transaction and read it with its allocations. */
async function lockVoucher(tx: OrgTransactionClient, id: string) {
  await tx.$queryRaw`SELECT "id" FROM "payment_vouchers" WHERE "id" = ${id} FOR UPDATE`;
  const voucher = await tx.paymentVoucher.findFirst({
    where: { id },
    select: {
      id: true,
      number: true,
      supplierId: true,
      amount: true,
      status: true,
      allocations: { select: { billId: true, amount: true } },
    },
  });
  if (!voucher) throw ledgerError("PURCHASE_VOUCHER_NOT_FOUND", "Payment voucher not found", 404);
  return voucher;
}

export async function cancelVoucher(id: string, body: unknown, actor: Actor): Promise<VoucherView> {
  await requirePurchases();
  await requireBooks();
  const { reason } = parseBody(reasonBodySchema, body ?? {});

  const cancelled = await runWithOrgTransaction(async (tx) => {
    const voucher = await lockVoucher(tx, id);
    if (voucher.status !== "posted") {
      throw ledgerError("PURCHASE_VOUCHER_CANCELLED", "This voucher has already been cancelled", 409);
    }
    // The bank line it posted is already ticked off against the statement:
    // un-tick it first, so the reconciliation is never left standing on a
    // payment that no longer exists.
    const reconciled = await tx.bankReconciledLine.count({
      where: { journalLine: { entry: { sourceType: "payment_voucher", sourceId: id } } },
    });
    if (reconciled > 0) {
      throw ledgerError(
        "PURCHASE_VOUCHER_RECONCILED",
        "This payment has been reconciled with the bank statement. Un-reconcile it first.",
        409,
      );
    }
    const bills = await lockBills(tx, voucher.allocations.map((allocation) => allocation.billId));
    const byId = new Map(bills.map((bill) => [bill.id, bill]));
    for (const allocation of voucher.allocations) {
      const bill = byId.get(allocation.billId);
      if (bill) await applyPaid(tx, bill, -toHalalas(money(allocation.amount)));
    }
    await tx.paymentVoucher.update({
      where: { id },
      data: { status: "cancelled", cancelledById: actor.id, cancelledAt: new Date(), cancelReason: nullable(reason) },
    });
    return { number: voucher.number, amount: money(voucher.amount) };
  });

  // The books reverse what was posted.
  postAfterCommit("payment_voucher", id, { userId: actor.id });
  void recordActivity({
    action: AuditAction.STATUS_CHANGED,
    recordType: "payment_voucher",
    recordId: id,
    recordName: formatVoucherNumber(cancelled.number),
    // The sentence names both statuses, in the reader's words.
    messageParams: { from: "posted", to: "cancelled" },
    before: { status: "posted", amount: cancelled.amount },
    after: { status: "cancelled", reason: nullable(reason) },
  });
  return (await getVoucher(id))!;
}

/**
 * Set what a voucher left on account against more bills. Each payment is in
 * addition to what the voucher already paid on that bill.
 */
export async function allocateVoucher(id: string, body: unknown): Promise<VoucherView> {
  await requirePurchases();
  await requireBooks();
  const { allocations } = parseBody(allocateBodySchema, body);
  const organizationId = requireOrgId();

  const done = await runWithOrgTransaction(async (tx) => {
    const voucher = await lockVoucher(tx, id);
    if (voucher.status !== "posted") {
      throw ledgerError("PURCHASE_VOUCHER_CANCELLED", "A cancelled voucher pays nothing", 409);
    }
    const already = voucher.allocations.reduce((sum, allocation) => sum + toHalalas(money(allocation.amount)), 0);
    const bills = await lockBills(tx, allocations.map((allocation) => allocation.billId));
    const problem = checkAllocations({
      voucherAmount: (toHalalas(money(voucher.amount)) - already) / 100,
      supplierId: voucher.supplierId,
      allocations,
      bills,
    });
    if (problem) refuse(problem);

    const existing = new Map(voucher.allocations.map((allocation) => [allocation.billId, toHalalas(money(allocation.amount))]));
    const byId = new Map(bills.map((bill) => [bill.id, bill]));
    for (const allocation of allocations as AllocationInput[]) {
      const add = toHalalas(allocation.amount);
      if (existing.has(allocation.billId)) {
        await tx.paymentVoucherAllocation.update({
          where: { voucherId_billId: { voucherId: id, billId: allocation.billId } },
          data: { amount: halalasToDecimal(existing.get(allocation.billId)! + add) },
        });
      } else {
        await tx.paymentVoucherAllocation.create({
          data: { organizationId, voucherId: id, billId: allocation.billId, amount: halalasToDecimal(add) },
        });
      }
      await applyPaid(tx, byId.get(allocation.billId)!, add);
    }
    return { number: voucher.number, bills: allocations.length };
  });

  void recordActivity({
    action: AuditAction.UPDATE,
    recordType: "payment_voucher",
    recordId: id,
    recordName: formatVoucherNumber(done.number),
    after: { appliedToBills: done.bills },
  });
  return (await getVoucher(id))!;
}
