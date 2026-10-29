/**
 * PropertyPro - The registers, read from the documents
 *
 * Sales & Receipts: the invoices and credit notes the office issued, the
 * receipts it gave tenants (a payment, under its voucher number) and what an
 * owner or a customer paid on their own invoice. Purchases & Payments: the
 * bills it entered and the vouchers it wrote. Both are lists of documents —
 * they read the documents, not the journal — so they work for an office that
 * has not set the books up, and every row opens the document it is.
 *
 * A page is the merge of each source's own page (registers.ts): every source
 * is read in the register's order up to the end of the page asked for, so a
 * deep page costs what its position costs. Totals are summed by the database
 * over everything the filters match, not over the page.
 *
 * What counts towards a total: invoices and credit notes that are not
 * cancelled; receipts that were not refunded; bills that are owed (approved,
 * part paid or paid; those still waiting for approval are shown apart);
 * vouchers that are posted. Everything else is listed with its status and
 * left out of the sums.
 */

import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db/prisma";
import { businessDayEnd, businessDayStart } from "@/lib/dates/business-day";
import { accountingPhase0Available } from "@/lib/invoice/phase0-columns";
import { paymentNumbersAvailable } from "@/lib/payments/payment-number";
import { parsePaymentNumber, receiptNumberFor } from "@/lib/payments/receipt-number";
import { today, formatDay, ledgerDay } from "./dates";
import { ledgerError } from "./errors";
import { toHalalas } from "./money";
import { billWhere } from "./purchases/bills.service";
import { dayText, money, requirePurchases } from "./purchases/common";
import { formatBillNumber, formatVoucherNumber } from "./purchases/numbers";
import { OWED_BILL_STATUSES, isBillStatus } from "./purchases/types";
import { voucherWhere } from "./purchases/vouchers.service";
import {
  mergeRegisterRows,
  type PurchaseRegister,
  type PurchaseRegisterQuery,
  type PurchaseRegisterRow,
  type RegisterOrder,
  type SalesRegister,
  type SalesRegisterQuery,
  type SalesRegisterRow,
} from "./registers";

/** How far down a register a page may be: past this, narrow the period instead. */
const MAX_WINDOW = 20_000;

function pageWindow(page: number, limit: number): { skip: number; take: number } {
  const skip = (Math.max(1, page) - 1) * limit;
  if (skip + limit > MAX_WINDOW) {
    throw ledgerError(
      "REGISTER_TOO_DEEP",
      "That page is too far down the list. Narrow the period or the filters.",
      400,
    );
  }
  return { skip, take: skip + limit };
}

const sum = (values: ReadonlyArray<number>) => values.reduce((total, value) => total + toHalalas(value), 0) / 100;

// ---------------------------------------------------------------------------
// Purchases & Payments
// ---------------------------------------------------------------------------

const PURCHASE_BILL_SELECT = {
  id: true,
  number: true,
  supplierId: true,
  supplier: { select: { name: true } },
  supplierInvoiceNumber: true,
  billDate: true,
  dueDate: true,
  status: true,
  totalAmount: true,
  vatAmount: true,
} as const;

const PURCHASE_VOUCHER_SELECT = {
  id: true,
  number: true,
  supplierId: true,
  supplier: { select: { name: true } },
  voucherDate: true,
  amount: true,
  status: true,
  method: true,
  reference: true,
  bankAccount: { select: { name: true, ledgerAccount: { select: { nameAr: true, nameEn: true } } } },
} as const;

interface BillSource {
  id: string;
  number: number;
  supplierId: string;
  supplier: { name: string } | null;
  supplierInvoiceNumber: string | null;
  billDate: Date;
  dueDate: Date;
  status: string;
  totalAmount: unknown;
  vatAmount: unknown;
}

interface VoucherSource {
  id: string;
  number: number;
  supplierId: string;
  supplier: { name: string } | null;
  voucherDate: Date;
  amount: unknown;
  status: string;
  method: string;
  reference: string | null;
  bankAccount: { name: string; ledgerAccount: { nameAr: string; nameEn: string } } | null;
}

export async function purchaseRegister(query: PurchaseRegisterQuery): Promise<PurchaseRegister> {
  await requirePurchases();
  const kind = query.kind ?? "all";
  const order: RegisterOrder = query.order === "asc" ? "asc" : "desc";
  const { skip, take } = pageWindow(query.page, query.limit);

  const status = query.status && query.status !== "all" ? query.status : null;
  const billsWanted = kind !== "payments" && (status === null || isBillStatus(status));
  // A voucher belongs to no building: a building filter is a filter of bills.
  const vouchersWanted =
    kind !== "bills" && !query.propertyId && (status === null || status === "posted" || status === "cancelled");

  const common = { search: query.search, supplierId: query.supplierId, from: query.from, to: query.to, page: 1, limit: 1 };
  const bills = billWhere({ ...common, status: status ?? undefined, propertyId: query.propertyId }, today());
  const vouchers = voucherWhere({ ...common, status: status ?? undefined });

  const [billRows, billCount, owed, pending, voucherRows, voucherCount, paid] = await Promise.all([
    billsWanted
      ? db.purchaseBill.findMany({
          where: bills,
          select: PURCHASE_BILL_SELECT,
          orderBy: [{ billDate: order }, { id: order }],
          take,
        })
      : Promise.resolve([]),
    billsWanted ? db.purchaseBill.count({ where: bills }) : Promise.resolve(0),
    billsWanted
      ? db.purchaseBill.aggregate({
          where: { AND: [bills, { status: { in: [...OWED_BILL_STATUSES] } }] },
          _sum: { totalAmount: true, vatAmount: true },
        })
      : Promise.resolve(null),
    billsWanted
      ? db.purchaseBill.aggregate({
          where: { AND: [bills, { status: "pending" }] },
          _sum: { totalAmount: true },
        })
      : Promise.resolve(null),
    vouchersWanted
      ? db.paymentVoucher.findMany({
          where: vouchers,
          select: PURCHASE_VOUCHER_SELECT,
          orderBy: [{ voucherDate: order }, { id: order }],
          take,
        })
      : Promise.resolve([]),
    vouchersWanted ? db.paymentVoucher.count({ where: vouchers }) : Promise.resolve(0),
    vouchersWanted
      ? db.paymentVoucher.aggregate({
          where: { AND: [vouchers, { status: "posted" }] },
          _sum: { amount: true },
        })
      : Promise.resolve(null),
  ]);

  const fromBills: PurchaseRegisterRow[] = (billRows as unknown as BillSource[]).map((bill) => {
    const documentNumber = formatBillNumber(bill.number) ?? String(bill.number);
    return {
      kind: "bill",
      id: bill.id,
      key: `bill:${bill.id}`,
      at: bill.billDate.toISOString(),
      rank: 0,
      date: dayText(bill.billDate),
      documentNumber,
      supplierId: bill.supplierId,
      supplierName: bill.supplier?.name ?? "—",
      reference: bill.supplierInvoiceNumber,
      dueDate: dayText(bill.dueDate),
      billed: money(bill.totalAmount),
      vat: money(bill.vatAmount),
      paid: 0,
      status: bill.status,
      method: null,
      account: null,
      href: `/dashboard/accounting/purchases/bills/${bill.id}`,
    };
  });
  const fromVouchers: PurchaseRegisterRow[] = (voucherRows as unknown as VoucherSource[]).map((voucher) => {
    const documentNumber = formatVoucherNumber(voucher.number) ?? String(voucher.number);
    return {
      kind: "payment",
      id: voucher.id,
      key: `payment:${voucher.id}`,
      at: voucher.voucherDate.toISOString(),
      rank: 2,
      date: dayText(voucher.voucherDate),
      documentNumber,
      supplierId: voucher.supplierId,
      supplierName: voucher.supplier?.name ?? "—",
      reference: voucher.reference,
      dueDate: null,
      billed: 0,
      vat: 0,
      paid: money(voucher.amount),
      status: voucher.status,
      method: voucher.method,
      account: voucher.bankAccount,
      href: `/dashboard/accounting/purchases/vouchers/${voucher.id}`,
    };
  });

  return {
    rows: mergeRegisterRows([fromBills, fromVouchers], order, skip, query.limit),
    total: billCount + voucherCount,
    totals: {
      billed: money(owed?._sum.totalAmount),
      vat: money(owed?._sum.vatAmount),
      pending: money(pending?._sum.totalAmount),
      paid: money(paid?._sum.amount),
    },
  };
}

// ---------------------------------------------------------------------------
// Sales & Receipts
// ---------------------------------------------------------------------------

interface UserNames {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
}

function userName(user: UserNames | null | undefined): string {
  if (!user) return "—";
  return `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || user.email || "—";
}

/** The instants an office day begins and ends at, for a column that holds instants. */
function instantRange(from: Date | null | undefined, to: Date | null | undefined) {
  return {
    ...(from ? { gte: businessDayStart(formatDay(from)) } : {}),
    ...(to ? { lte: businessDayEnd(formatDay(to)) } : {}),
  };
}

const hasRange = (range: object) => Object.keys(range).length > 0;

const NAME_FIELDS = { firstName: true, lastName: true, email: true } as const;

function nameSearch(text: string) {
  return {
    OR: [
      { firstName: { contains: text, mode: "insensitive" as const } },
      { lastName: { contains: text, mode: "insensitive" as const } },
      { email: { contains: text, mode: "insensitive" as const } },
    ],
  };
}

const INVOICE_STATUSES = ["scheduled", "issued", "paid", "partial", "overdue", "cancelled"];
const RECEIPT_STATUSES = ["paid", "partial", "refunded"];

interface InvoiceSource {
  id: string;
  invoiceNumber: string;
  issueDate: Date;
  status: string;
  category: string;
  totalAmount: unknown;
  taxAmount: unknown;
  tenantId: string | null;
  tenant: UserNames | null;
  property: { name: string } | null;
  documentType?: string | null;
  customerType?: string | null;
  customerUserId?: string | null;
  customerName?: string | null;
  customerUser?: UserNames | null;
}

interface PaymentSource {
  id: string;
  createdAt: Date;
  paidDate: Date | null;
  amount: unknown;
  amountPaid: unknown;
  paymentMethod: string | null;
  status: string;
  type: string;
  tenant: UserNames | null;
  property: { name: string } | null;
  invoice: { invoiceNumber: string } | null;
  receipt: { receiptNumber: string } | null;
  number?: number | null;
}

interface SettlementSource {
  id: string;
  invoiceNumber: string;
  customerType: string | null;
  customerUserId: string | null;
  customerName: string | null;
  customerUser: UserNames | null;
  metadata: unknown;
}

function invoiceWhereOf(
  query: SalesRegisterQuery,
  options: { phase0: boolean; documentType?: "invoice" | "credit_note"; status: string | null },
): Prisma.InvoiceWhereInput {
  const and: Prisma.InvoiceWhereInput[] = [];
  const range = instantRange(query.from, query.to);
  if (hasRange(range)) and.push({ issueDate: range });
  // A scheduled installment is not yet an invoice anyone has been sent.
  and.push(options.status ? { status: options.status } : { status: { not: "scheduled" } });
  if (options.phase0 && options.documentType) and.push({ documentType: options.documentType });
  if (query.tenantId) and.push({ tenantId: query.tenantId });
  if (options.phase0 && query.ownerId) and.push({ customerUserId: query.ownerId });
  if (query.propertyId) and.push({ propertyId: query.propertyId });
  const text = (query.search ?? "").trim();
  if (text) {
    and.push({
      OR: [
        { invoiceNumber: { contains: text, mode: "insensitive" } },
        { tenant: nameSearch(text) },
        ...(options.phase0
          ? [{ customerName: { contains: text, mode: "insensitive" as const } }, { customerUser: nameSearch(text) }]
          : []),
      ],
    });
  }
  return { AND: and };
}

function paymentWhereOf(
  query: SalesRegisterQuery,
  options: { status: string | null; numbers: boolean },
): Prisma.PaymentWhereInput {
  const and: Prisma.PaymentWhereInput[] = [
    { status: options.status ? options.status : { in: RECEIPT_STATUSES } },
    // The date of a receipt is the day the money came; a payment with none has no receipt yet.
    { paidDate: { not: null } },
  ];
  const range = instantRange(query.from, query.to);
  if (hasRange(range)) and.push({ paidDate: range });
  if (query.tenantId) and.push({ tenantId: query.tenantId });
  if (query.propertyId) and.push({ propertyId: query.propertyId });
  const text = (query.search ?? "").trim();
  if (text) {
    const number = options.numbers ? parsePaymentNumber(text) : null;
    and.push({
      OR: [
        ...(number ? [{ number }] : []),
        { tenant: nameSearch(text) },
        { receipt: { receiptNumber: { contains: text, mode: "insensitive" as const } } },
        { invoice: { invoiceNumber: { contains: text, mode: "insensitive" as const } } },
      ],
    });
  }
  return { AND: and };
}

/** What an owner or a customer paid on their own invoice: the settlements kept on it. */
function settlementRows(
  sources: SettlementSource[],
  query: SalesRegisterQuery,
  companies: Map<string, string>,
): SalesRegisterRow[] {
  const from = query.from ? formatDay(query.from) : null;
  const to = query.to ? formatDay(query.to) : null;
  const text = (query.search ?? "").trim().toLowerCase();
  const rows: SalesRegisterRow[] = [];
  for (const source of sources) {
    const list = (source.metadata as { settlements?: unknown } | null)?.settlements;
    if (!Array.isArray(list)) continue;
    const customerType = source.customerType === "owner" ? "owner" : "customer";
    const customerName =
      customerType === "owner"
        ? (source.customerUserId ? companies.get(source.customerUserId) : null) || userName(source.customerUser)
        : (source.customerName ?? "—");
    list.forEach((entry, index) => {
      const item = (entry ?? {}) as Record<string, unknown>;
      const paidDate = new Date(String(item.paidDate ?? ""));
      const amount = Number(item.amount) || 0;
      if (Number.isNaN(paidDate.getTime()) || amount <= 0) return;
      const day = formatDay(ledgerDay(paidDate));
      if ((from && day < from) || (to && day > to)) return;
      const reference = typeof item.reference === "string" && item.reference.trim() ? item.reference.trim() : null;
      if (
        text &&
        !`${customerName} ${source.invoiceNumber} ${reference ?? ""}`.toLowerCase().includes(text)
      ) {
        return;
      }
      rows.push({
        kind: "receipt",
        id: source.id,
        key: `settlement:${source.id}:${String(index + 1).padStart(4, "0")}`,
        at: paidDate.toISOString(),
        rank: 2,
        date: day,
        documentNumber: "",
        customerType,
        customerName,
        reference: source.invoiceNumber,
        building: null,
        invoiced: 0,
        vat: 0,
        received: amount,
        status: "paid",
        method: typeof item.paymentMethod === "string" ? item.paymentMethod : null,
        href: `/dashboard/accounting/invoices/${source.id}`,
      });
    });
  }
  return rows;
}

export async function salesRegister(query: SalesRegisterQuery): Promise<SalesRegister> {
  const [phase0, numbers] = await Promise.all([accountingPhase0Available(), paymentNumbersAvailable()]);
  const kind = query.kind ?? "all";
  const order: RegisterOrder = query.order === "asc" ? "asc" : "desc";
  const { skip, take } = pageWindow(query.page, query.limit);
  const status = query.status && query.status !== "all" ? query.status : null;

  // What each source can answer for these filters.
  const documentType = !phase0 ? undefined : kind === "invoices" ? "invoice" : kind === "credit_notes" ? "credit_note" : undefined;
  const invoicesWanted =
    (kind === "all" || kind === "invoices" || (kind === "credit_notes" && phase0)) &&
    (status === null || INVOICE_STATUSES.includes(status)) &&
    // An owner is billed through the phase 0 invoice columns.
    !(query.ownerId && !phase0);
  const receiptsWanted =
    (kind === "all" || kind === "receipts") && (status === null || RECEIPT_STATUSES.includes(status)) && !query.ownerId;
  const settlementsWanted =
    phase0 &&
    (kind === "all" || kind === "receipts") &&
    (status === null || status === "paid") &&
    !query.tenantId &&
    !query.propertyId;

  const invoices = invoiceWhereOf(query, { phase0, documentType, status });
  const payments = paymentWhereOf(query, { status, numbers });

  // Plain objects, so the client infers the select: a `Prisma.InvoiceSelect`
  // annotation makes the compiler compare two instantiations of the extended
  // client's types and give up ("excessive stack depth").
  const invoiceSelect = {
    id: true,
    invoiceNumber: true,
    issueDate: true,
    status: true,
    category: true,
    totalAmount: true,
    taxAmount: true,
    tenantId: true,
    tenant: { select: NAME_FIELDS },
    property: { select: { name: true } },
  } as const;
  const invoicePhase0Select = {
    documentType: true,
    customerType: true,
    customerUserId: true,
    customerName: true,
    customerUser: { select: NAME_FIELDS },
  } as const;
  const paymentSelect = {
    id: true,
    createdAt: true,
    paidDate: true,
    amount: true,
    amountPaid: true,
    paymentMethod: true,
    status: true,
    type: true,
    tenant: { select: NAME_FIELDS },
    property: { select: { name: true } },
    invoice: { select: { invoiceNumber: true } },
    receipt: { select: { receiptNumber: true } },
  } as const;

  const billed = { AND: [invoices, { status: { not: "cancelled" } }] } satisfies Prisma.InvoiceWhereInput;
  const collected = { AND: [payments, { status: { in: ["paid", "partial"] } }] } satisfies Prisma.PaymentWhereInput;

  const [
    invoiceRows,
    invoiceCount,
    invoiceTotals,
    paymentRows,
    paymentCount,
    paidByAmountPaid,
    paidByAmount,
    settlementSources,
  ] = await Promise.all([
    invoicesWanted
      ? db.invoice.findMany({
          where: invoices,
          select: phase0 ? { ...invoiceSelect, ...invoicePhase0Select } : invoiceSelect,
          orderBy: [{ issueDate: order }, { id: order }],
          take,
        })
      : Promise.resolve([]),
    invoicesWanted ? db.invoice.count({ where: invoices }) : Promise.resolve(0),
    invoicesWanted
      ? phase0
        ? db.invoice.groupBy({
            by: ["documentType"],
            where: billed,
            _sum: { totalAmount: true, taxAmount: true },
          })
        : db.invoice
            .aggregate({ where: billed, _sum: { totalAmount: true, taxAmount: true } })
            .then((total) => [{ documentType: "invoice", _sum: total._sum }])
      : Promise.resolve([]),
    receiptsWanted
      ? db.payment.findMany({
          where: payments,
          select: numbers ? { ...paymentSelect, number: true } : paymentSelect,
          orderBy: [{ paidDate: order }, { id: order }],
          take,
        })
      : Promise.resolve([]),
    receiptsWanted ? db.payment.count({ where: payments }) : Promise.resolve(0),
    // What a payment collected is its amount paid, or its amount on an older
    // row that never recorded one (the ledger reads it the same way).
    receiptsWanted
      ? db.payment.aggregate({
          where: { AND: [collected, { amountPaid: { gt: 0 } }] },
          _sum: { amountPaid: true },
        })
      : Promise.resolve(null),
    receiptsWanted
      ? db.payment.aggregate({
          where: { AND: [collected, { amountPaid: { lte: 0 } }] },
          _sum: { amount: true },
        })
      : Promise.resolve(null),
    settlementsWanted
      ? db.invoice.findMany({
          where: {
            tenantId: null,
            customerType: { in: ["owner", "customer"] },
            status: { not: "cancelled" },
            amountPaid: { gt: 0 },
            ...(query.ownerId ? { customerUserId: query.ownerId } : {}),
          },
          select: {
            id: true,
            invoiceNumber: true,
            customerType: true,
            customerUserId: true,
            customerName: true,
            customerUser: { select: NAME_FIELDS },
            metadata: true,
          },
          orderBy: { id: "desc" },
          take: 5000,
        })
      : Promise.resolve([]),
  ]);

  const invoiceSources = invoiceRows as unknown as InvoiceSource[];
  const ownerIds = [
    ...new Set(
      [...invoiceSources, ...(settlementSources as unknown as SettlementSource[])]
        .filter((source) => source.customerType === "owner" && source.customerUserId)
        .map((source) => source.customerUserId as string),
    ),
  ];
  const companies = new Map<string, string>();
  if (ownerIds.length) {
    for (const owner of await db.owner.findMany({
      where: { userId: { in: ownerIds }, deletedAt: undefined },
      select: { userId: true, companyName: true },
    })) {
      if (owner.companyName?.trim()) companies.set(owner.userId, owner.companyName.trim());
    }
  }

  const fromInvoices: SalesRegisterRow[] = invoiceSources.map((invoice) => {
    const creditNote = invoice.documentType === "credit_note";
    const customerType =
      invoice.customerType === "owner" ? "owner" : invoice.customerType === "customer" ? "customer" : "tenant";
    const customerName =
      customerType === "owner"
        ? (invoice.customerUserId ? companies.get(invoice.customerUserId) : null) || userName(invoice.customerUser)
        : customerType === "customer"
          ? (invoice.customerName ?? "—")
          : userName(invoice.tenant);
    return {
      kind: creditNote ? "credit_note" : "invoice",
      id: invoice.id,
      key: `${creditNote ? "credit_note" : "invoice"}:${invoice.id}`,
      at: invoice.issueDate.toISOString(),
      rank: creditNote ? 1 : 0,
      date: formatDay(ledgerDay(invoice.issueDate)),
      documentNumber: invoice.invoiceNumber,
      customerType,
      customerName,
      reference: invoice.category,
      building: invoice.property?.name ?? null,
      invoiced: money(invoice.totalAmount),
      vat: money(invoice.taxAmount),
      received: 0,
      status: invoice.status,
      method: null,
      href: `/dashboard/accounting/invoices/${invoice.id}`,
    };
  });

  const fromPayments: SalesRegisterRow[] = (paymentRows as unknown as PaymentSource[])
    .filter((payment) => payment.paidDate)
    .map((payment) => {
      const documentNumber = receiptNumberFor(payment.id, payment.receipt?.receiptNumber, payment.number);
      return {
        kind: "receipt",
        id: payment.id,
        key: `receipt:${payment.id}`,
        at: payment.paidDate!.toISOString(),
        rank: 2,
        date: formatDay(ledgerDay(payment.paidDate!)),
        documentNumber,
        customerType: "tenant",
        customerName: userName(payment.tenant),
        reference: payment.invoice?.invoiceNumber ?? payment.type,
        building: payment.property?.name ?? null,
        invoiced: 0,
        vat: 0,
        received: Number(payment.amountPaid) || Number(payment.amount) || 0,
        status: payment.status,
        method: payment.paymentMethod,
        href: `/dashboard/payments/${payment.id}`,
      };
    });

  const fromSettlements = settlementRows(settlementSources as unknown as SettlementSource[], query, companies);

  // Each source holds its first `take` rows in the register's order; the
  // settlements, kept on their invoices, are all there already.
  const merged = mergeRegisterRows([fromInvoices, fromPayments, fromSettlements], order, skip, query.limit);

  const totalOf = (type: string, field: "totalAmount" | "taxAmount") =>
    sum(
      (invoiceTotals as Array<{ documentType: string; _sum: Record<string, unknown> }>)
        .filter((row) => (row.documentType ?? "invoice") === type)
        .map((row) => money(row._sum[field])),
    );
  const invoiced = totalOf("invoice", "totalAmount");
  const creditNotes = totalOf("credit_note", "totalAmount");
  const received = sum([
    money(paidByAmountPaid?._sum.amountPaid),
    money(paidByAmount?._sum.amount),
    ...fromSettlements.map((row) => row.received),
  ]);

  return {
    rows: merged,
    total: invoiceCount + paymentCount + fromSettlements.length,
    totals: {
      invoiced,
      creditNotes,
      netInvoiced: sum([invoiced, creditNotes]),
      vat: sum([totalOf("invoice", "taxAmount"), totalOf("credit_note", "taxAmount")]),
      received,
    },
  };
}
