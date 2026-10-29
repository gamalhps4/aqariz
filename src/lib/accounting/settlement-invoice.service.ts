/**
 * PropertyPro - Issuing, linking and releasing a settlement's tax invoice
 *
 * The rules are ./settlement-invoice.ts; this is the database side, run
 * inside the settlement's own ledger transaction (owners.service.ts) so the
 * settlement, its invoice and the link between them commit together.
 *
 * The link is kept on the invoice: `metadata.ownerSettlementId`, and the
 * deduction from the owner's balance is one of its settlements
 * (`paymentMethod: "owner_balance"`, posted by documents.service.ts as
 * Dr owners' payable / Cr the owner's receivable). Cancelling the settlement
 * adds the same deduction back as a negative settlement, so every entry the
 * invoice has posted stays where it is.
 */

import { Prisma } from "@/generated/prisma/client";
import { db, type OrgTransactionClient } from "@/lib/db/prisma";
import { InvoiceStatus } from "@/types";
import { accountingPhase0Available } from "@/lib/invoice/phase0-columns";
import { isSaudiVatNumber, normalizeVatNumber } from "@/lib/invoice/vat";
import { recipientLocale } from "@/lib/i18n/recipient-locale";
import { translateFor } from "@/lib/i18n/translate";
import { invoiceSettlementsPostable } from "./documents.service";
import { formatDay } from "./dates";
import { ledgerError } from "./errors";
import { fromHalalas, toHalalas } from "./money";
import { OWNER_BALANCE_METHOD } from "./posting/invoice";
import {
  feeInvoiceMatches,
  settlementFeeLines,
  settlementFeeTotal,
  type SettlementFeeFigures,
} from "./settlement-invoice";

/** The prefix of the office's own invoices (custom-invoice.service.ts). */
const INVOICE_PREFIX = "INV";

export { INVOICE_PREFIX as SETTLEMENT_INVOICE_PREFIX };

/** The phase-0 columns these reads need. */
const WITH_PHASE0 = {
  documentType: false,
  creditedAmount: false,
  customerType: false,
  customerUserId: false,
} as const;

/** Whether a settlement can carry a tax invoice: phase 0 and invoice settlements in the books. */
export async function settlementInvoicesAvailable(): Promise<boolean> {
  return (await accountingPhase0Available()) && (await invoiceSettlementsPostable());
}

export interface OpenFeeInvoice {
  id: string;
  invoiceNumber: string;
  issueDate: string;
  balanceRemaining: number;
}

/**
 * An owner's invoices that could be a settlement's tax invoice: issued to
 * them, still owed in part or in full, and not tied to another settlement.
 */
export async function openOwnerFeeInvoices(ownerId: string): Promise<OpenFeeInvoice[]> {
  if (!(await accountingPhase0Available())) return [];
  const rows = await db.invoice.findMany({
    where: {
      customerType: "owner",
      customerUserId: ownerId,
      documentType: "invoice",
      deletedAt: null,
      status: { not: InvoiceStatus.CANCELLED },
      balanceRemaining: { gt: 0 },
    },
    select: { id: true, invoiceNumber: true, issueDate: true, balanceRemaining: true, metadata: true },
    orderBy: { issueDate: "desc" },
    take: 50,
  });
  return rows
    .filter((row) => !(row.metadata as { ownerSettlementId?: unknown } | null)?.ownerSettlementId)
    .map((row) => ({
      id: row.id,
      invoiceNumber: row.invoiceNumber,
      issueDate: formatDay(row.issueDate),
      balanceRemaining: Number(row.balanceRemaining),
    }));
}

interface FeeInvoiceContext {
  organizationId: string;
  ownerId: string;
  settlementId: string;
  /** The settlement's posting day: the invoice's date and the deduction's. */
  day: Date;
  periodStart: string;
  periodEnd: string;
  currency: string;
  figures: SettlementFeeFigures;
  vatRate: number;
  userId: string | null;
}

export interface LinkedFeeInvoice {
  id: string;
  invoiceNumber: string;
  amount: number;
}

function deduction(context: FeeInvoiceContext, amount: number) {
  return {
    amount,
    paidDate: context.day.toISOString(),
    paymentMethod: OWNER_BALANCE_METHOD,
    ownerSettlementId: context.settlementId,
    reference: null,
    notes: null,
    recordedById: context.userId,
    recordedAt: new Date().toISOString(),
  };
}

/** "2026/09/30": slashes, which an Arabic PDF prints in the right order. */
const slashDay = (day: string) => day.replaceAll("-", "/");

/** Issue the office's tax invoice for the settlement, paid from the owner's balance. */
export async function issueSettlementInvoice(
  tx: OrgTransactionClient,
  invoiceNumber: string,
  context: FeeInvoiceContext,
): Promise<LinkedFeeInvoice> {
  const owner = await tx.user.findFirst({
    where: { id: context.ownerId, deletedAt: undefined },
    select: {
      firstName: true,
      lastName: true,
      email: true,
      ownerProfile: {
        select: {
          companyName: true,
          taxNumber: true,
          addressStreet: true,
          addressDistrict: true,
          addressCity: true,
          addressCountry: true,
        },
      },
    },
  });
  if (!owner) throw ledgerError("LEDGER_OWNER_NOT_FOUND", "Owner not found", 404);
  const profile = owner.ownerProfile;
  const vatNumber = normalizeVatNumber(profile?.taxNumber);
  const name =
    profile?.companyName?.trim() ||
    `${owner.firstName ?? ""} ${owner.lastName ?? ""}`.trim() ||
    owner.email ||
    null;
  const address =
    [profile?.addressStreet, profile?.addressDistrict, profile?.addressCity, profile?.addressCountry]
      .map((part) => part?.trim())
      .filter(Boolean)
      .join(", ") || null;

  const locale = await recipientLocale({ organizationId: context.organizationId });
  const period = { from: slashDay(context.periodStart), to: slashDay(context.periodEnd) };
  const lines = settlementFeeLines(context.figures, context.vatRate).map((line, position) => ({
    ...line,
    position,
    description: translateFor(
      locale,
      line.category === "management_fee"
        ? "ledger.settlementInvoice.feeLine"
        : "ledger.settlementInvoice.commissionLine",
      period,
    ),
  }));
  const net = fromHalalas(lines.reduce((sum, line) => sum + toHalalas(line.net), 0));
  const vat = fromHalalas(lines.reduce((sum, line) => sum + toHalalas(line.vat), 0));
  const total = settlementFeeTotal(context.figures);

  const invoice = await tx.invoice.create({
    data: {
      organizationId: context.organizationId,
      invoiceNumber,
      tenantId: null,
      propertyId: null,
      leaseId: null,
      unitId: null,
      category: "management_fee",
      issueDate: context.day,
      dueDate: context.day,
      status: InvoiceStatus.PAID,
      currency: context.currency,
      subtotal: net,
      discountAmount: 0,
      taxAmount: vat,
      totalAmount: total,
      amountPaid: total,
      balanceRemaining: 0,
      lastPaymentDate: context.day,
      gracePeriodEnd: context.day,
      lineItems: lines.map((line) => ({
        description: line.description,
        type: line.category,
        quantity: 1,
        unitPrice: line.net,
        amount: line.net,
        discountAmount: 0,
        netAmount: line.net,
        vatCategory: line.vatCategory,
        vatRate: line.vatRate,
        vatAmount: line.vat,
        totalAmount: fromHalalas(toHalalas(line.net) + toHalalas(line.vat)),
      })) as unknown as Prisma.InputJsonValue,
      metadata: {
        source: "owner_settlement",
        ownerSettlementId: context.settlementId,
        period: { start: context.periodStart, end: context.periodEnd },
        createdByUserId: context.userId,
        settlements: [deduction(context, total)],
      } as Prisma.InputJsonValue,
      documentType: "invoice",
      customerType: "owner",
      customerUserId: context.ownerId,
      customerName: name,
      customerVatNumber: vatNumber && isSaudiVatNumber(vatNumber) ? vatNumber : null,
      customerAddress: address,
    },
    select: { id: true, invoiceNumber: true },
  });
  await tx.invoiceLine.createMany({
    data: lines.map((line) => ({
      organizationId: context.organizationId,
      invoiceId: invoice.id,
      position: line.position,
      description: line.description,
      category: line.category,
      quantity: 1,
      unitPrice: line.net,
      discountAmount: 0,
      netAmount: line.net,
      vatCategory: line.vatCategory,
      vatRate: line.vatRate,
      vatAmount: line.vat,
      totalAmount: fromHalalas(toHalalas(line.net) + toHalalas(line.vat)),
    })),
  });
  return { id: invoice.id, invoiceNumber: invoice.invoiceNumber, amount: total };
}

/**
 * Take an invoice the office already issued to the owner as the settlement's
 * tax invoice: what is left on it must be the commission and its VAT, and it
 * is paid from the owner's balance.
 */
export async function linkSettlementInvoice(
  tx: OrgTransactionClient,
  invoiceId: string,
  context: FeeInvoiceContext,
): Promise<LinkedFeeInvoice> {
  const invoice = await tx.invoice.findFirst({
    where: { id: invoiceId, deletedAt: null },
    omit: WITH_PHASE0,
  });
  if (
    !invoice ||
    invoice.customerType !== "owner" ||
    invoice.customerUserId !== context.ownerId ||
    invoice.documentType !== "invoice"
  ) {
    throw ledgerError("LEDGER_SETTLEMENT_INVOICE_NOT_FOUND", "That invoice is not one of this owner's", 404);
  }
  const metadata = (invoice.metadata ?? {}) as Record<string, unknown>;
  if (metadata.ownerSettlementId) {
    throw ledgerError(
      "LEDGER_SETTLEMENT_INVOICE_TAKEN",
      `${invoice.invoiceNumber} is already the tax invoice of another settlement`,
      409,
    );
  }
  if (invoice.status === InvoiceStatus.CANCELLED) {
    throw ledgerError("LEDGER_SETTLEMENT_INVOICE_CANCELLED", `${invoice.invoiceNumber} is cancelled`, 409);
  }
  const balance = Number(invoice.balanceRemaining);
  if (!(balance > 0) || !feeInvoiceMatches(balance, context.figures)) {
    throw ledgerError(
      "LEDGER_SETTLEMENT_INVOICE_MISMATCH",
      `${invoice.invoiceNumber} has ${balance.toFixed(2)} left to pay; this settlement's commission and VAT come to ${settlementFeeTotal(context.figures).toFixed(2)}. Credit it and issue a new one, or settle with a new invoice.`,
      409,
    );
  }
  const settlements = Array.isArray(metadata.settlements) ? metadata.settlements : [];
  const lastPaid = invoice.lastPaymentDate;
  const updated = await tx.invoice.updateMany({
    where: { id: invoice.id, version: invoice.version },
    data: {
      amountPaid: fromHalalas(toHalalas(Number(invoice.amountPaid)) + toHalalas(balance)),
      balanceRemaining: 0,
      status: InvoiceStatus.PAID,
      lastPaymentDate: lastPaid && lastPaid.getTime() > context.day.getTime() ? lastPaid : context.day,
      metadata: {
        ...metadata,
        ownerSettlementId: context.settlementId,
        settlements: [...settlements, deduction(context, balance)],
      } as Prisma.InputJsonValue,
      version: { increment: 1 },
    },
  });
  if (updated.count === 0) {
    throw ledgerError(
      "LEDGER_SETTLEMENT_INVOICE_CHANGED",
      `${invoice.invoiceNumber} was changed by someone else a moment ago. Try again.`,
      409,
    );
  }
  return { id: invoice.id, invoiceNumber: invoice.invoiceNumber, amount: balance };
}

export interface ReleasedFeeInvoice {
  id: string;
  invoiceNumber: string;
  /** Issued by the settlement itself (not one the office linked). */
  issuedBySettlement: boolean;
}

/**
 * A settlement is cancelled: what it deducted from the owner's balance for
 * its tax invoice is put back (a negative settlement on the invoice, dated
 * `day`), and the invoice is free to be linked again.
 */
export async function releaseSettlementInvoice(
  tx: OrgTransactionClient,
  settlementId: string,
  day: Date,
  userId: string | null,
): Promise<ReleasedFeeInvoice | null> {
  if (!(await accountingPhase0Available())) return null;
  const invoice = await tx.invoice.findFirst({
    where: { metadata: { path: ["ownerSettlementId"], equals: settlementId } },
    omit: WITH_PHASE0,
  });
  if (!invoice) return null;
  const metadata = (invoice.metadata ?? {}) as Record<string, unknown>;
  const settlements = Array.isArray(metadata.settlements)
    ? (metadata.settlements as Array<Record<string, unknown>>)
    : [];
  const deducted = settlements
    .filter((entry) => entry?.ownerSettlementId === settlementId)
    .reduce((sum, entry) => sum + toHalalas(Number(entry.amount) || 0), 0);
  const amountPaid = Math.max(0, toHalalas(Number(invoice.amountPaid)) - deducted);
  const owed =
    toHalalas(Number(invoice.totalAmount)) - toHalalas(Number(invoice.creditedAmount ?? 0)) - amountPaid;
  const balance = Math.max(0, owed);
  const rest = { ...metadata };
  delete rest.ownerSettlementId;
  const updated = await tx.invoice.updateMany({
    where: { id: invoice.id, version: invoice.version },
    data: {
      amountPaid: fromHalalas(amountPaid),
      balanceRemaining: fromHalalas(balance),
      status:
        balance === 0
          ? InvoiceStatus.PAID
          : amountPaid > 0
            ? InvoiceStatus.PARTIAL
            : InvoiceStatus.ISSUED,
      metadata: {
        ...rest,
        settlements: [
          ...settlements,
          ...(deducted !== 0
            ? [
                {
                  amount: -fromHalalas(deducted),
                  paidDate: day.toISOString(),
                  paymentMethod: OWNER_BALANCE_METHOD,
                  ownerSettlementId: settlementId,
                  kind: "settlement_cancelled",
                  reference: null,
                  notes: null,
                  recordedById: userId,
                  recordedAt: new Date().toISOString(),
                },
              ]
            : []),
        ],
      } as Prisma.InputJsonValue,
      version: { increment: 1 },
    },
  });
  if (updated.count === 0) {
    throw ledgerError(
      "LEDGER_SETTLEMENT_INVOICE_CHANGED",
      `${invoice.invoiceNumber} was changed by someone else a moment ago. Try again.`,
      409,
    );
  }
  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    issuedBySettlement: metadata.source === "owner_settlement",
  };
}

/** The tax invoice number of each settlement that has one. */
export async function settlementInvoiceNumbers(settlementIds: readonly string[]): Promise<Map<string, { id: string; invoiceNumber: string }>> {
  const out = new Map<string, { id: string; invoiceNumber: string }>();
  const ids = [...new Set(settlementIds.filter(Boolean))];
  if (ids.length === 0 || !(await accountingPhase0Available())) return out;
  const rows = await db.invoice.findMany({
    where: {
      OR: ids.map((id) => ({ metadata: { path: ["ownerSettlementId"], equals: id } })),
    },
    select: { id: true, invoiceNumber: true, metadata: true },
  });
  for (const row of rows) {
    const settlementId = (row.metadata as { ownerSettlementId?: unknown } | null)?.ownerSettlementId;
    if (typeof settlementId === "string") out.set(settlementId, { id: row.id, invoiceNumber: row.invoiceNumber });
  }
  return out;
}
