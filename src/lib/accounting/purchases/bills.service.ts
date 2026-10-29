/**
 * PropertyPro - Purchase bills
 *
 * A supplier's invoice to the office, written line by line: what was bought,
 * the ledger account each line is charged to, its VAT category and rate, and
 * the building and unit it belongs to. Entered `pending`; someone holding the
 * approval right approves it, and from then on it is owed — the ledger posts
 * it (posting/purchase.ts) and a payment voucher can pay it. An approved bill
 * nobody has paid on can be sent back to be corrected, or cancelled; one with
 * money on it stays until its payments are cancelled.
 *
 * Every write runs in one transaction under a row lock, so two people acting
 * on the same bill are taken one after the other, never in each other's way.
 * The books follow after the response (postAfterCommit).
 */

import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { db, runWithOrgTransaction, type OrgTransactionClient } from "@/lib/db/prisma";
import { requireOrgId } from "@/lib/tenancy/context";
import { AuditAction, auditRecordChange, recordActivity } from "@/lib/audit-domain";
import { VatInputError } from "@/lib/invoice/vat";
import { postAfterCommit } from "../hooks";
import { loadChart } from "../settings.service";
import { today } from "../dates";
import { ledgerError } from "../errors";
import { toHalalas } from "../money";
import {
  canApproveBill,
  canCancelBill,
  canEditBill,
  canPayBill,
  canReopenBill,
  computeBill,
  dueDateFor,
  isOverdue,
  type ComputedBillLine,
} from "./bill-math";
import {
  dayOrThrow,
  dayText,
  isUniqueViolation,
  money,
  nextNumber,
  nullable,
  parseBody,
  requireBooks,
  requirePurchases,
  userNames,
} from "./common";
import { canChargePurchase } from "./cost-accounts";
import { formatBillNumber, formatVoucherNumber, parseBillNumber } from "./numbers";
import { billBodySchema, reasonBodySchema, type BillBody } from "./schemas";
import {
  PAYABLE_BILL_STATUSES,
  isBillStatus,
  isVoucherStatus,
  type BillLineView,
  type BillStatus,
  type BillView,
} from "./types";

interface Actor {
  id: string;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

const BILL_SELECT = {
  id: true,
  number: true,
  supplierId: true,
  supplier: { select: { id: true, name: true, vatNumber: true, paymentTermsDays: true } },
  supplierInvoiceNumber: true,
  billDate: true,
  dueDate: true,
  status: true,
  currency: true,
  subtotal: true,
  discountAmount: true,
  vatAmount: true,
  totalAmount: true,
  amountPaid: true,
  notes: true,
  approvedById: true,
  approvedAt: true,
  cancelledAt: true,
  cancelReason: true,
  createdById: true,
  createdAt: true,
  version: true,
} as const;

interface BillRow {
  id: string;
  number: number;
  supplierId: string;
  supplier: { id: string; name: string; vatNumber: string | null; paymentTermsDays: number | null } | null;
  supplierInvoiceNumber: string | null;
  billDate: Date;
  dueDate: Date;
  status: string;
  currency: string;
  subtotal: unknown;
  discountAmount: unknown;
  vatAmount: unknown;
  totalAmount: unknown;
  amountPaid: unknown;
  notes: string | null;
  approvedById: string | null;
  approvedAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  createdById: string | null;
  createdAt: Date;
  version: number;
}

function toView(row: BillRow, now: Date, names: Map<string, string>): BillView {
  const total = money(row.totalAmount);
  const paid = money(row.amountPaid);
  const status = (isBillStatus(row.status) ? row.status : "pending") as BillStatus;
  return {
    id: row.id,
    number: row.number,
    displayNumber: formatBillNumber(row.number) ?? String(row.number),
    supplier: row.supplier,
    supplierInvoiceNumber: row.supplierInvoiceNumber,
    billDate: dayText(row.billDate),
    dueDate: dayText(row.dueDate),
    status,
    overdue: isOverdue({ status, dueDate: row.dueDate, totalAmount: total, amountPaid: paid }, now),
    currency: row.currency,
    subtotal: money(row.subtotal),
    discountAmount: money(row.discountAmount),
    vatAmount: money(row.vatAmount),
    totalAmount: total,
    amountPaid: paid,
    balance: status === "cancelled" ? 0 : Math.max(0, toHalalas(total) - toHalalas(paid)) / 100,
    notes: row.notes,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    approvedById: row.approvedById,
    approvedByName: row.approvedById ? (names.get(row.approvedById) ?? null) : null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    cancelReason: row.cancelReason,
    createdById: row.createdById,
    createdByName: row.createdById ? (names.get(row.createdById) ?? null) : null,
    createdAt: row.createdAt.toISOString(),
    version: row.version,
    can: {
      edit: canEditBill(status),
      approve: canApproveBill(status),
      reopen: canReopenBill(status, paid),
      cancel: canCancelBill(status, paid),
      pay: canPayBill(status),
    },
  };
}

export interface BillListQuery {
  search?: string;
  /** A status, `open` (owed and unpaid), `overdue`, or `all`. */
  status?: string;
  supplierId?: string;
  /** Bill date range, both days included. */
  from?: Date | null;
  to?: Date | null;
  dueFrom?: Date | null;
  dueTo?: Date | null;
  propertyId?: string;
  page: number;
  limit: number;
  sortBy?: "billDate" | "dueDate" | "number" | "totalAmount";
  sortOrder?: "asc" | "desc";
}

/** The `where` a list query means. */
export function billWhere(query: BillListQuery, now: Date): Prisma.PurchaseBillWhereInput {
  const and: Prisma.PurchaseBillWhereInput[] = [];
  const status = query.status && query.status !== "all" ? query.status : null;
  if (status === "open") and.push({ status: { in: [...PAYABLE_BILL_STATUSES] } });
  else if (status === "overdue") {
    and.push({ status: { in: [...PAYABLE_BILL_STATUSES] }, dueDate: { lt: now } });
  } else if (status && isBillStatus(status)) and.push({ status });

  if (query.supplierId) and.push({ supplierId: query.supplierId });
  if (query.from || query.to) {
    and.push({ billDate: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } });
  }
  if (query.dueFrom || query.dueTo) {
    and.push({
      dueDate: { ...(query.dueFrom ? { gte: query.dueFrom } : {}), ...(query.dueTo ? { lte: query.dueTo } : {}) },
    });
  }
  if (query.propertyId) and.push({ lines: { some: { propertyId: query.propertyId } } });

  const search = (query.search ?? "").trim();
  if (search) {
    const number = parseBillNumber(search);
    and.push({
      OR: [
        ...(number ? [{ number }] : []),
        { supplierInvoiceNumber: { contains: search, mode: "insensitive" } },
        { supplier: { name: { contains: search, mode: "insensitive" } } },
        { notes: { contains: search, mode: "insensitive" } },
      ],
    });
  }
  return and.length ? { AND: and } : {};
}

export interface BillListSummary {
  count: number;
  totalAmount: number;
  vatAmount: number;
  amountPaid: number;
  /** What is still to pay on the owed bills in the list. */
  outstanding: number;
  /** Of which past due. */
  overdue: number;
}

export async function listBills(
  query: BillListQuery,
): Promise<{ rows: BillView[]; total: number; summary: BillListSummary }> {
  await requirePurchases();
  const now = today();
  const where = billWhere(query, now);
  const order = query.sortOrder === "asc" ? "asc" : "desc";
  const primarySort = { [query.sortBy ?? "billDate"]: order } as Prisma.PurchaseBillOrderByWithRelationInput;
  const payableWhere: Prisma.PurchaseBillWhereInput = {
    AND: [where, { status: { in: [...PAYABLE_BILL_STATUSES] } }],
  };
  const overdueWhere: Prisma.PurchaseBillWhereInput = {
    AND: [payableWhere, { dueDate: { lt: now } }],
  };

  const [rows, totals, outstanding, overdue] = await Promise.all([
    db.purchaseBill.findMany({
      where,
      select: BILL_SELECT,
      orderBy: [primarySort, { number: "desc" }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    db.purchaseBill.aggregate({
      where,
      _count: { _all: true },
      _sum: { totalAmount: true, vatAmount: true, amountPaid: true },
    }),
    db.purchaseBill.aggregate({ where: payableWhere, _sum: { totalAmount: true, amountPaid: true } }),
    db.purchaseBill.aggregate({ where: overdueWhere, _sum: { totalAmount: true, amountPaid: true } }),
  ]);

  const names = await userNames(rows.flatMap((row) => [row.approvedById, row.createdById]));
  const left = (sum: { totalAmount: unknown; amountPaid: unknown } | null) =>
    sum ? (toHalalas(money(sum.totalAmount)) - toHalalas(money(sum.amountPaid))) / 100 : 0;
  return {
    rows: (rows as unknown as BillRow[]).map((row) => toView(row, now, names)),
    total: totals._count._all,
    summary: {
      count: totals._count._all,
      totalAmount: money(totals._sum.totalAmount),
      vatAmount: money(totals._sum.vatAmount),
      amountPaid: money(totals._sum.amountPaid),
      outstanding: left(outstanding._sum),
      overdue: left(overdue._sum),
    },
  };
}

/** One bill with its lines and what has been paid on it. */
export async function getBill(id: string): Promise<BillView | null> {
  await requirePurchases();
  const row = await db.purchaseBill.findFirst({
    where: { id },
    select: {
      ...BILL_SELECT,
      lines: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          position: true,
          description: true,
          accountId: true,
          quantity: true,
          unitPrice: true,
          discountAmount: true,
          netAmount: true,
          vatCategory: true,
          vatRate: true,
          vatAmount: true,
          totalAmount: true,
          propertyId: true,
          unitId: true,
        },
      },
      allocations: {
        select: {
          amount: true,
          voucher: { select: { id: true, number: true, voucherDate: true, status: true } },
        },
      },
    },
  });
  if (!row) return null;

  const accountIds = [...new Set(row.lines.map((line) => line.accountId))];
  const propertyIds = [...new Set(row.lines.map((line) => line.propertyId).filter((v): v is string => Boolean(v)))];
  const unitIds = [...new Set(row.lines.map((line) => line.unitId).filter((v): v is string => Boolean(v)))];
  const [accounts, properties, units, names] = await Promise.all([
    db.ledgerAccount.findMany({
      where: { id: { in: accountIds } },
      select: { id: true, code: true, nameAr: true, nameEn: true },
    }),
    propertyIds.length
      ? db.property.findMany({ where: { id: { in: propertyIds }, deletedAt: undefined }, select: { id: true, name: true } })
      : Promise.resolve([]),
    unitIds.length
      ? db.unit.findMany({ where: { id: { in: unitIds }, deletedAt: undefined }, select: { id: true, unitNumber: true } })
      : Promise.resolve([]),
    userNames([row.approvedById, row.createdById]),
  ]);
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const propertyName = new Map(properties.map((property) => [property.id, property.name]));
  const unitName = new Map(units.map((unit) => [unit.id, unit.unitNumber]));

  const lines: BillLineView[] = row.lines.map((line) => ({
    id: line.id,
    position: line.position,
    description: line.description,
    accountId: line.accountId,
    account: accountById.get(line.accountId) ?? null,
    quantity: money(line.quantity),
    unitPrice: money(line.unitPrice),
    discountAmount: money(line.discountAmount),
    netAmount: money(line.netAmount),
    vatCategory: line.vatCategory as BillLineView["vatCategory"],
    vatRate: money(line.vatRate),
    vatAmount: money(line.vatAmount),
    totalAmount: money(line.totalAmount),
    propertyId: line.propertyId,
    propertyName: line.propertyId ? (propertyName.get(line.propertyId) ?? null) : null,
    unitId: line.unitId,
    unitName: line.unitId ? (unitName.get(line.unitId) ?? null) : null,
  }));

  const view = toView(row as unknown as BillRow, today(), names);
  return {
    ...view,
    lines,
    payments: row.allocations
      .filter((allocation) => allocation.voucher)
      .map((allocation) => ({
        voucherId: allocation.voucher.id,
        voucherNumber: allocation.voucher.number,
        voucherDisplayNumber: formatVoucherNumber(allocation.voucher.number) ?? String(allocation.voucher.number),
        voucherDate: dayText(allocation.voucher.voucherDate),
        amount: money(allocation.amount),
        status: isVoucherStatus(allocation.voucher.status) ? allocation.voucher.status : "posted",
      }))
      .sort((a, b) => a.voucherDate.localeCompare(b.voucherDate) || a.voucherNumber - b.voucherNumber),
  };
}

// ---------------------------------------------------------------------------
// Checking what a bill is made of
// ---------------------------------------------------------------------------

type LineToCheck = { accountId: string; propertyId: string | null; unitId: string | null };

async function assertLinesUsable(lines: LineToCheck[]): Promise<void> {
  const [chart, banks] = await Promise.all([
    loadChart(),
    db.bankAccount.findMany({ select: { ledgerAccountId: true } }),
  ]);
  const byId = new Map(chart.map((account) => [account.id, account]));
  const bankLedgerIds = new Set(banks.map((bank) => bank.ledgerAccountId));
  for (const line of lines) {
    const account = byId.get(line.accountId);
    if (!account) throw ledgerError("LEDGER_ACCOUNT_NOT_FOUND", "An account on this bill does not exist", 400);
    if (!account.postable) {
      throw ledgerError("LEDGER_ACCOUNT_NOT_POSTABLE", `Account ${account.code} is a heading and takes no postings`);
    }
    if (!account.active) throw ledgerError("LEDGER_ACCOUNT_INACTIVE", `Account ${account.code} is inactive`);
    if (!canChargePurchase({ ...account, bankLinked: bankLedgerIds.has(account.id) })) {
      throw ledgerError(
        "PURCHASE_LINE_ACCOUNT_INVALID",
        `Account ${account.code} cannot be charged with a purchase. Choose an expense account.`,
      );
    }
  }

  const unitIds = [...new Set(lines.map((line) => line.unitId).filter((v): v is string => Boolean(v)))];
  const units = unitIds.length
    ? await db.unit.findMany({ where: { id: { in: unitIds } }, select: { id: true, propertyId: true } })
    : [];
  const unitProperty = new Map(units.map((unit) => [unit.id, unit.propertyId]));
  for (const line of lines) {
    if (line.unitId) {
      const owner = unitProperty.get(line.unitId);
      if (!owner) throw ledgerError("PURCHASE_LINE_BUILDING_INVALID", "A unit on this bill does not exist");
      if (line.propertyId && line.propertyId !== owner) {
        throw ledgerError("PURCHASE_LINE_BUILDING_INVALID", "A unit on this bill is not in the building chosen for its line");
      }
      line.propertyId = owner;
    }
  }
  const propertyIds = [...new Set(lines.map((line) => line.propertyId).filter((v): v is string => Boolean(v)))];
  if (propertyIds.length) {
    const found = await db.property.findMany({ where: { id: { in: propertyIds } }, select: { id: true } });
    if (found.length !== propertyIds.length) {
      throw ledgerError("PURCHASE_LINE_BUILDING_INVALID", "A building on this bill does not exist");
    }
  }
}

function compute(input: BillBody): ReturnType<typeof computeBill> {
  try {
    const computed = computeBill(
      input.lines.map((line) => ({
        description: line.description,
        accountId: line.accountId,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        vatCategory: line.vatCategory,
        vatRate: line.vatRate ?? null,
        propertyId: line.propertyId ?? null,
        unitId: line.unitId ?? null,
      })),
      input.discountAmount,
    );
    if (toHalalas(computed.totals.totalAmount) <= 0) {
      throw ledgerError("PURCHASE_BILL_EMPTY", "A bill must come to more than zero");
    }
    return computed;
  } catch (error) {
    if (error instanceof VatInputError) throw ledgerError("PURCHASE_INVALID", error.message, 400);
    throw error;
  }
}

async function loadSupplierForBill(supplierId: string, options: { mustBeActive: boolean }) {
  const supplier = await db.supplier.findFirst({
    where: { id: supplierId },
    select: { id: true, name: true, isActive: true, paymentTermsDays: true },
  });
  if (!supplier) throw ledgerError("PURCHASE_SUPPLIER_NOT_FOUND", "Supplier not found", 404);
  if (options.mustBeActive && !supplier.isActive) {
    throw ledgerError("PURCHASE_SUPPLIER_INACTIVE", "This supplier is inactive. Reactivate it to enter a bill.", 409);
  }
  return supplier;
}

function resolveDueDate(input: BillBody, billDate: Date, termsDays: number | null): Date {
  const dueDate = input.dueDate ? dayOrThrow(input.dueDate, "The due date") : dueDateFor(billDate, termsDays);
  if (dueDate.getTime() < billDate.getTime()) {
    throw ledgerError("PURCHASE_DUE_BEFORE_BILL", "The due date cannot be before the bill's date");
  }
  return dueDate;
}

function lineData(organizationId: string, billId: string, computed: ComputedBillLine[]) {
  return computed.map((line, index) => ({
    organizationId,
    billId,
    position: index,
    description: line.description,
    accountId: line.accountId,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    discountAmount: line.discountAmount,
    netAmount: line.netAmount,
    vatCategory: line.vatCategory,
    vatRate: line.vatRate,
    vatAmount: line.vatAmount,
    totalAmount: line.totalAmount,
    propertyId: line.propertyId,
    unitId: line.unitId,
  }));
}

function duplicateRefusal(error: unknown): never {
  if (isUniqueViolation(error, "purchase_bills_supplier_invoice_unique")) {
    throw ledgerError(
      "PURCHASE_BILL_DUPLICATE",
      "This supplier's invoice number has already been entered",
      409,
    );
  }
  throw error;
}

function summaryOf(bill: { number: number; supplierId: string; totalAmount: unknown; status: string }) {
  return {
    number: formatBillNumber(bill.number),
    supplierId: bill.supplierId,
    totalAmount: money(bill.totalAmount),
    status: bill.status,
  };
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export async function createBill(body: unknown, actor: Actor): Promise<BillView> {
  await requirePurchases();
  await requireBooks();
  const input = parseBody(billBodySchema, body);
  const billDate = dayOrThrow(input.billDate, "The bill date");
  const supplier = await loadSupplierForBill(input.supplierId, { mustBeActive: true });
  const dueDate = resolveDueDate(input, billDate, supplier.paymentTermsDays);
  const computed = compute(input);
  await assertLinesUsable(computed.lines);
  const organizationId = requireOrgId();

  let created: { id: string; number: number };
  try {
    created = await runWithOrgTransaction(async (tx) => {
      const number = await nextNumber(tx, "bill");
      const bill = await tx.purchaseBill.create({
        data: {
          organizationId,
          number,
          supplierId: supplier.id,
          supplierInvoiceNumber: nullable(input.supplierInvoiceNumber),
          billDate,
          dueDate,
          status: "pending",
          subtotal: computed.totals.subtotal,
          discountAmount: computed.totals.discountAmount,
          vatAmount: computed.totals.taxAmount,
          totalAmount: computed.totals.totalAmount,
          notes: nullable(input.notes),
          createdById: actor.id,
        },
        select: { id: true, number: true },
      });
      await tx.purchaseBillLine.createMany({ data: lineData(organizationId, bill.id, computed.lines) });
      return bill;
    });
  } catch (error) {
    duplicateRefusal(error);
  }

  void recordActivity({
    action: AuditAction.CREATE,
    recordType: "purchase_bill",
    recordId: created.id,
    recordName: formatBillNumber(created.number),
    after: {
      supplier: supplier.name,
      supplierInvoiceNumber: nullable(input.supplierInvoiceNumber),
      billDate: dayText(billDate),
      dueDate: dayText(dueDate),
      totalAmount: computed.totals.totalAmount,
      vatAmount: computed.totals.taxAmount,
      lines: computed.lines.length,
    },
  });
  return (await getBill(created.id))!;
}

/** Lock one bill's row for the rest of the transaction and read it. */
async function lockBill(tx: OrgTransactionClient, id: string) {
  await tx.$queryRaw`SELECT "id" FROM "purchase_bills" WHERE "id" = ${id} FOR UPDATE`;
  const bill = await tx.purchaseBill.findFirst({
    where: { id },
    select: {
      id: true,
      number: true,
      supplierId: true,
      status: true,
      version: true,
      totalAmount: true,
      amountPaid: true,
      billDate: true,
      dueDate: true,
      vatAmount: true,
      supplierInvoiceNumber: true,
    },
  });
  if (!bill) throw ledgerError("PURCHASE_BILL_NOT_FOUND", "Bill not found", 404);
  return bill;
}

function assertVersion(bill: { version: number }, version: unknown): void {
  if (typeof version === "number" && version !== bill.version) {
    throw ledgerError(
      "PURCHASE_BILL_CHANGED",
      "This bill was changed by someone else a moment ago. Refresh and try again.",
      409,
    );
  }
}

export async function updateBill(id: string, body: unknown): Promise<BillView> {
  await requirePurchases();
  await requireBooks();
  const record = (body ?? {}) as Record<string, unknown>;
  const input = parseBody(billBodySchema, body);
  const billDate = dayOrThrow(input.billDate, "The bill date");
  const supplier = await loadSupplierForBill(input.supplierId, { mustBeActive: true });
  const dueDate = resolveDueDate(input, billDate, supplier.paymentTermsDays);
  const computed = compute(input);
  await assertLinesUsable(computed.lines);
  const organizationId = requireOrgId();

  let before: ReturnType<typeof summaryOf> & {
    billDate: Date;
    dueDate: Date;
    vatAmount: unknown;
    supplierInvoiceNumber: string | null;
  };
  try {
    before = await runWithOrgTransaction(async (tx) => {
      const bill = await lockBill(tx, id);
      assertVersion(bill, record.version);
      if (!canEditBill(bill.status)) {
        throw ledgerError(
          "PURCHASE_BILL_NOT_EDITABLE",
          "Only a bill waiting for approval can be changed. Send it back first.",
          409,
        );
      }
      await tx.purchaseBill.update({
        where: { id },
        data: {
          supplierId: supplier.id,
          supplierInvoiceNumber: nullable(input.supplierInvoiceNumber),
          billDate,
          dueDate,
          subtotal: computed.totals.subtotal,
          discountAmount: computed.totals.discountAmount,
          vatAmount: computed.totals.taxAmount,
          totalAmount: computed.totals.totalAmount,
          notes: nullable(input.notes),
          version: { increment: 1 },
        },
      });
      await tx.purchaseBillLine.deleteMany({ where: { billId: id } });
      await tx.purchaseBillLine.createMany({ data: lineData(organizationId, id, computed.lines) });
      return {
        ...summaryOf(bill),
        billDate: bill.billDate,
        dueDate: bill.dueDate,
        vatAmount: bill.vatAmount,
        supplierInvoiceNumber: bill.supplierInvoiceNumber,
      };
    });
  } catch (error) {
    duplicateRefusal(error);
  }

  // The supplier's name, not its id; the old supplier is read only when the
  // bill moved to another one.
  const movedSupplier = before.supplierId !== supplier.id;
  const previousSupplier = movedSupplier ? await supplierNameForAudit(before.supplierId) : supplier.name;
  auditRecordChange({
    action: AuditAction.UPDATE,
    recordType: "purchase_bill",
    recordId: id,
    recordName: before.number,
    before: {
      supplier: previousSupplier,
      supplierInvoiceNumber: before.supplierInvoiceNumber,
      billDate: dayText(before.billDate),
      dueDate: dayText(before.dueDate),
      totalAmount: before.totalAmount,
      vatAmount: money(before.vatAmount),
    },
    after: {
      supplier: supplier.name,
      supplierInvoiceNumber: nullable(input.supplierInvoiceNumber),
      billDate: dayText(billDate),
      dueDate: dayText(dueDate),
      totalAmount: computed.totals.totalAmount,
      vatAmount: computed.totals.taxAmount,
    },
    keys: ["supplier", "supplierInvoiceNumber", "billDate", "dueDate", "totalAmount", "vatAmount"],
  });
  return (await getBill(id))!;
}

/** A supplier's name for an entry, read after the write has committed: a failed read costs the name, not the answer. */
async function supplierNameForAudit(supplierId: string): Promise<string | null> {
  try {
    const row = await db.supplier.findFirst({ where: { id: supplierId, deletedAt: undefined }, select: { name: true } });
    return row?.name ?? null;
  } catch {
    return null;
  }
}

type Transition = "approve" | "reopen" | "cancel";

async function transition(
  id: string,
  kind: Transition,
  actor: Actor,
  extra: { reason?: string | null; version?: unknown } = {},
): Promise<BillView> {
  await requirePurchases();
  await requireBooks();

  // Approving puts the bill on the books, so its accounts must still be ones
  // the books can take.
  if (kind === "approve") {
    const lines = await db.purchaseBillLine.findMany({
      where: { billId: id },
      select: { accountId: true, propertyId: true, unitId: true },
    });
    await assertLinesUsable(lines.map((line) => ({ ...line })));
  }

  const before = await runWithOrgTransaction(async (tx) => {
    const bill = await lockBill(tx, id);
    assertVersion(bill, extra.version);
    const paid = money(bill.amountPaid);
    const now = new Date();
    if (kind === "approve") {
      if (!canApproveBill(bill.status)) {
        throw ledgerError("PURCHASE_BILL_NOT_PENDING", "Only a bill waiting for approval can be approved", 409);
      }
      await tx.purchaseBill.update({
        where: { id },
        data: { status: "approved", approvedById: actor.id, approvedAt: now, version: { increment: 1 } },
      });
    } else if (kind === "reopen") {
      if (!canReopenBill(bill.status, paid)) {
        throw ledgerError(
          "PURCHASE_BILL_NOT_REOPENABLE",
          "Only an approved bill with nothing paid on it can be sent back",
          409,
        );
      }
      await tx.purchaseBill.update({
        where: { id },
        data: { status: "pending", approvedById: null, approvedAt: null, version: { increment: 1 } },
      });
    } else {
      if (!canCancelBill(bill.status, paid)) {
        throw ledgerError(
          "PURCHASE_BILL_NOT_CANCELLABLE",
          "A bill with payments on it cannot be cancelled. Cancel its payments first.",
          409,
        );
      }
      await tx.purchaseBill.update({
        where: { id },
        data: {
          status: "cancelled",
          cancelledById: actor.id,
          cancelledAt: now,
          cancelReason: nullable(extra.reason),
          version: { increment: 1 },
        },
      });
    }
    return { ...summaryOf(bill), from: bill.status };
  });

  // The books follow: approving posts it, sending it back or cancelling
  // reverses what was posted.
  postAfterCommit("purchase_bill", id, { userId: actor.id });

  const to = kind === "approve" ? "approved" : kind === "reopen" ? "pending" : "cancelled";
  void recordActivity({
    action: AuditAction.STATUS_CHANGED,
    recordType: "purchase_bill",
    recordId: id,
    recordName: before.number,
    // The sentence names both statuses, in the reader's words.
    messageParams: { from: before.from, to },
    before: { status: before.from },
    after: {
      status: to,
      ...(kind === "cancel" ? { reason: nullable(extra.reason) } : {}),
    },
  });
  return (await getBill(id))!;
}

export function approveBill(id: string, actor: Actor, version?: unknown): Promise<BillView> {
  return transition(id, "approve", actor, { version });
}

export function reopenBill(id: string, actor: Actor, version?: unknown): Promise<BillView> {
  return transition(id, "reopen", actor, { version });
}

export function cancelBill(id: string, body: unknown, actor: Actor): Promise<BillView> {
  const { reason } = parseBody(reasonBodySchema, body ?? {});
  return transition(id, "cancel", actor, { reason, version: (body as { version?: unknown } | null)?.version });
}
