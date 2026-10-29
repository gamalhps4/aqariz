/**
 * PropertyPro - Suppliers
 *
 * Who the office buys from: a name, a VAT number, a contact, the address and
 * the bank details to pay into, and the payment terms a bill's due date
 * follows. What the office owes a supplier is not stored: it is read from the
 * books — the supplier's lines on the suppliers' payable account — so the
 * list, the supplier's statement and the aging report cannot drift apart.
 *
 * A supplier is deactivated rather than deleted once anything has been
 * written against it; one never used can be removed.
 */

import "server-only";

import { db } from "@/lib/db/prisma";
import { requireOrgId } from "@/lib/tenancy/context";
import { AuditAction, auditRecordChange, recordActivity } from "@/lib/audit-domain";
import { SUPPLIER_AUDIT_KEYS, supplierSnapshot, withoutEmpty } from "../audit-snapshots";
import { supplierVatNumber } from "@/lib/invoice/expense-vat";
import { getAccountingSettings, loadChart, resolvedMap } from "../settings.service";
import { ledgerError } from "../errors";
import { toHalalas } from "../money";
import { nullable, parseBody, requirePurchases } from "./common";
import { supplierBodySchema, supplierPatchSchema, type SupplierBody } from "./schemas";
import type { SupplierView } from "./types";

const SUPPLIER_SELECT = {
  id: true,
  name: true,
  vatNumber: true,
  phone: true,
  isActive: true,
  createdAt: true,
  contactName: true,
  email: true,
  address: true,
  city: true,
  crNumber: true,
  bankName: true,
  iban: true,
  paymentTermsDays: true,
  notes: true,
} as const;

type SupplierRow = {
  id: string;
  name: string;
  vatNumber: string | null;
  phone: string | null;
  isActive: boolean;
  createdAt: Date;
  contactName: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  crNumber: string | null;
  bankName: string | null;
  iban: string | null;
  paymentTermsDays: number | null;
  notes: string | null;
};

const IBAN_PATTERN = /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/;

function cleanIban(value: string | null | undefined): string | null {
  const iban = (value ?? "").replace(/\s+/g, "").toUpperCase();
  if (!iban) return null;
  if (!IBAN_PATTERN.test(iban)) {
    throw ledgerError(
      "LEDGER_IBAN_INVALID",
      "The IBAN does not look right (SA followed by 22 digits for a Saudi account)",
    );
  }
  return iban;
}

function cleanVat(value: string | null | undefined): string | null {
  const checked = supplierVatNumber(value);
  if ("error" in checked) throw ledgerError("LEDGER_VAT_NUMBER_INVALID", checked.error);
  return checked.vatNumber;
}

/** The suppliers' payable account of this office, or null before accounting is set up. */
export async function payablesAccountId(): Promise<string | null> {
  const settings = await getAccountingSettings();
  if (!settings) return null;
  const chart = await loadChart();
  return resolvedMap(settings, chart).get("supplier_payables") ?? null;
}

/** What the office owes each of these suppliers, from the books, in riyals. */
export async function supplierBalances(ids: readonly string[]): Promise<Map<string, number> | null> {
  const accountId = await payablesAccountId();
  if (!accountId) return null;
  const out = new Map<string, number>();
  if (ids.length === 0) return out;
  const sums = await db.journalLine.groupBy({
    by: ["partyId"],
    where: { partyType: "supplier", partyId: { in: [...ids] }, accountId },
    _sum: { debit: true, credit: true },
  });
  for (const row of sums) {
    if (!row.partyId) continue;
    const net = toHalalas(row._sum.credit as unknown as number) - toHalalas(row._sum.debit as unknown as number);
    out.set(row.partyId, net / 100 || 0);
  }
  return out;
}

async function openBillCounts(ids: readonly string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (ids.length === 0) return out;
  const counts = await db.purchaseBill.groupBy({
    by: ["supplierId"],
    where: { supplierId: { in: [...ids] }, status: { in: ["approved", "partially_paid"] } },
    _count: { _all: true },
  });
  for (const row of counts) out.set(row.supplierId, row._count._all);
  return out;
}

function view(row: SupplierRow, balance: number | null, openBills: number): SupplierView {
  return {
    id: row.id,
    name: row.name,
    vatNumber: row.vatNumber,
    phone: row.phone,
    isActive: row.isActive,
    contactName: row.contactName,
    email: row.email,
    address: row.address,
    city: row.city,
    crNumber: row.crNumber,
    bankName: row.bankName,
    iban: row.iban,
    paymentTermsDays: row.paymentTermsDays,
    notes: row.notes,
    balance,
    openBills,
    createdAt: row.createdAt.toISOString(),
  };
}

async function withTotals(rows: SupplierRow[]): Promise<SupplierView[]> {
  const ids = rows.map((row) => row.id);
  const [balances, open] = await Promise.all([supplierBalances(ids), openBillCounts(ids)]);
  return rows.map((row) => view(row, balances ? (balances.get(row.id) ?? 0) : null, open.get(row.id) ?? 0));
}

export interface SupplierListQuery {
  search?: string;
  status?: "active" | "inactive" | "all";
  page: number;
  limit: number;
}

export async function listSuppliers(query: SupplierListQuery): Promise<{ rows: SupplierView[]; total: number }> {
  await requirePurchases();
  const search = (query.search ?? "").trim();
  const where = {
    ...(query.status === "inactive" ? { isActive: false } : query.status === "all" ? {} : { isActive: true }),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" as const } },
            { vatNumber: { contains: search } },
            { phone: { contains: search } },
            { email: { contains: search, mode: "insensitive" as const } },
            { contactName: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    db.supplier.findMany({
      where,
      select: SUPPLIER_SELECT,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    db.supplier.count({ where }),
  ]);
  return { rows: await withTotals(rows as SupplierRow[]), total };
}

export async function getSupplier(id: string): Promise<SupplierView | null> {
  await requirePurchases();
  const row = await db.supplier.findFirst({ where: { id }, select: SUPPLIER_SELECT });
  if (!row) return null;
  return (await withTotals([row as SupplierRow]))[0];
}

/** A supplier's name, for the line a file names its filters with. */
export async function supplierName(id: string): Promise<string | null> {
  const row = await db.supplier.findFirst({ where: { id, deletedAt: undefined }, select: { name: true } });
  return row?.name ?? null;
}

/** How many suppliers a picker lists unless it asks for fewer, and the most it can ask for. */
export const SUPPLIER_OPTIONS_LIMIT = 1000;
export const SUPPLIER_OPTIONS_MAX = 2000;

/** A light list for the pickers: who can be billed or paid. */
export async function supplierOptions(options: {
  search?: string;
  includeInactive?: boolean;
  limit?: number;
}): Promise<Array<{ id: string; name: string; vatNumber: string | null; paymentTermsDays: number | null; isActive: boolean }>> {
  await requirePurchases();
  const search = (options.search ?? "").trim();
  const rows = await db.supplier.findMany({
    where: {
      ...(options.includeInactive ? {} : { isActive: true }),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" as const } },
              { vatNumber: { contains: search } },
            ],
          }
        : {}),
    },
    select: { id: true, name: true, vatNumber: true, paymentTermsDays: true, isActive: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: Math.min(Math.max(options.limit ?? SUPPLIER_OPTIONS_LIMIT, 1), SUPPLIER_OPTIONS_MAX),
  });
  return rows;
}

async function assertVatFree(vatNumber: string | null, exceptId?: string): Promise<void> {
  if (!vatNumber) return;
  const clash = await db.supplier.findFirst({
    where: { vatNumber, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (clash) {
    throw ledgerError("PURCHASE_SUPPLIER_VAT_TAKEN", "Another supplier already has this VAT number", 409);
  }
}

export async function createSupplier(body: unknown): Promise<SupplierView> {
  await requirePurchases();
  const input = parseBody(supplierBodySchema, body) as SupplierBody;
  const vatNumber = cleanVat(input.vatNumber);
  const iban = cleanIban(input.iban);
  await assertVatFree(vatNumber);

  const created = await db.supplier.create({
    data: {
      organizationId: requireOrgId(),
      name: input.name,
      vatNumber,
      phone: nullable(input.phone),
      contactName: nullable(input.contactName),
      email: nullable(input.email),
      address: nullable(input.address),
      city: nullable(input.city),
      crNumber: nullable(input.crNumber),
      bankName: nullable(input.bankName),
      iban,
      paymentTermsDays: input.paymentTermsDays ?? null,
      notes: nullable(input.notes),
    },
    select: SUPPLIER_SELECT,
  });
  void recordActivity({
    action: AuditAction.CREATE,
    recordType: "supplier",
    recordId: created.id,
    recordName: created.name,
    after: withoutEmpty(supplierSnapshot(created)),
  });
  return (await withTotals([created as SupplierRow]))[0];
}

export async function updateSupplier(id: string, body: unknown): Promise<SupplierView> {
  await requirePurchases();
  const patch = parseBody(supplierPatchSchema, body);
  const existing = await db.supplier.findFirst({ where: { id }, select: SUPPLIER_SELECT });
  if (!existing) throw ledgerError("PURCHASE_SUPPLIER_NOT_FOUND", "Supplier not found", 404);

  const data: Record<string, unknown> = {};
  if (patch.name !== undefined) data.name = patch.name;
  if (patch.vatNumber !== undefined) {
    const vatNumber = cleanVat(patch.vatNumber);
    await assertVatFree(vatNumber, id);
    data.vatNumber = vatNumber;
  }
  if (patch.iban !== undefined) data.iban = cleanIban(patch.iban);
  for (const key of ["phone", "contactName", "email", "address", "city", "crNumber", "bankName", "notes"] as const) {
    if (patch[key] !== undefined) data[key] = nullable(patch[key]);
  }
  if (patch.paymentTermsDays !== undefined) data.paymentTermsDays = patch.paymentTermsDays ?? null;
  if (patch.isActive !== undefined) data.isActive = patch.isActive;

  const updated =
    Object.keys(data).length === 0
      ? existing
      : await db.supplier.update({ where: { id }, data, select: SUPPLIER_SELECT });

  // Only what moved; switching a supplier on or off is the move a reader looks for.
  const switched = existing.isActive !== updated.isActive;
  auditRecordChange({
    action: switched ? AuditAction.STATUS_CHANGED : AuditAction.UPDATE,
    recordType: "supplier",
    recordId: id,
    recordName: updated.name,
    before: supplierSnapshot(existing),
    after: supplierSnapshot(updated),
    keys: SUPPLIER_AUDIT_KEYS,
    ...(switched
      ? {
          messageKey: updated.isActive
            ? "admin.audit.msg.record_activated"
            : "admin.audit.msg.record_deactivated",
        }
      : {}),
  });
  return (await withTotals([updated as SupplierRow]))[0];
}

/** Remove a supplier nothing has been written against. */
export async function deleteSupplier(id: string): Promise<void> {
  await requirePurchases();
  const existing = await db.supplier.findFirst({ where: { id }, select: SUPPLIER_SELECT });
  if (!existing) throw ledgerError("PURCHASE_SUPPLIER_NOT_FOUND", "Supplier not found", 404);
  const [bills, vouchers, expenses, lines] = await Promise.all([
    db.purchaseBill.count({ where: { supplierId: id } }),
    db.paymentVoucher.count({ where: { supplierId: id } }),
    db.expense.count({ where: { supplierId: id, deletedAt: undefined } }),
    db.journalLine.count({ where: { partyType: "supplier", partyId: id } }),
  ]);
  if (bills + vouchers + expenses + lines > 0) {
    throw ledgerError(
      "PURCHASE_SUPPLIER_IN_USE",
      "This supplier has bills, payments or expenses. Deactivate it instead of deleting it.",
      409,
    );
  }
  await db.supplier.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
  void recordActivity({
    action: AuditAction.DELETE,
    recordType: "supplier",
    recordId: id,
    recordName: existing.name,
    before: withoutEmpty(supplierSnapshot(existing)),
  });
}
