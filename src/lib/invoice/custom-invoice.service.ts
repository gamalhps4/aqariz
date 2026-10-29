/**
 * PropertyPro - Writing a custom invoice or a credit note
 *
 * The manual invoice could only be raised to a tenant with a live contract,
 * took its tax as an amount typed by hand, took the discount after the tax,
 * and was numbered at random ("INV-202610-K3J9QZ") while installments were
 * numbered in sequence. Here it is raised to anyone the office bills — a
 * tenant (with or without a contract), an owner, or a customer who is neither
 * — line by line with each line's VAT, the discount before VAT, and the next
 * number of its own sequence: INV-000123 for invoices, CN-000045 for credit
 * notes, from the allocator installments already use.
 *
 * A credit note corrects one invoice: it is stored with negative amounts, and
 * what it credits comes off that invoice's balance in the same transaction.
 * The invoice stays issued — the two documents together are what was billed,
 * which every sum over invoices then reads net — and once nothing is left on
 * it, it is settled. One paid and then credited shows the excess as a refund
 * due (metadata); the office records the refund when it pays it
 * (`recordInvoiceRefund`), and the books take the money out of the bank and
 * clear the customer's credit.
 *
 * A credit note takes off no more than the invoice charged in each VAT
 * category (credit-note.ts `creditExceedsCategory`).
 */

import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { db, runWithOrgTransaction } from "@/lib/db/prisma";
import {
  invoiceScope,
  leaseScope,
  ownerRecordScope,
  propertyScope,
  withScope,
  type ScopeActor,
} from "@/lib/db/scopes";
import { findTenantInScope } from "@/lib/db/tenant-scope";
import { createWithInvoiceNumber } from "@/lib/services/invoice-number.service";
import { getOrgSystemSettings } from "@/lib/services/system-settings";
import { requireOrgId } from "@/lib/tenancy/context";
import { InvoiceStatus } from "@/types";
import {
  computeVatInvoice,
  isSaudiVatNumber,
  legacyInvoiceVat,
  negateVatInvoice,
  normalizeVatNumber,
  vatBreakdown,
  VatInputError,
  type ComputedVatInvoice,
  type ComputedVatLine,
  type VatCategory,
} from "@/lib/invoice/vat";
import type { CustomInvoiceBody, CustomerType } from "@/lib/invoice/custom-invoice-schema";
import {
  applyCredit,
  applyRefund,
  creditExceedsCategory,
  type VatCategoryAmount,
} from "@/lib/invoice/credit-note";
import { OWNER_BALANCE_METHOD } from "@/lib/accounting/posting/invoice";
import { isReceivedByOwner } from "@/lib/payments/methods";
import {
  accountingPhase0Available,
  PHASE0_MISSING_MESSAGE,
} from "@/lib/invoice/phase0-columns";
import { postAfterCommit } from "@/lib/accounting/hooks";
import { businessDay, businessToday } from "@/lib/dates/business-day";

export class CustomInvoiceError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export const INVOICE_PREFIX = "INV";
export const CREDIT_NOTE_PREFIX = "CN";

const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Who is billed
// ---------------------------------------------------------------------------

interface ResolvedCustomer {
  customerType: CustomerType;
  tenantId: string | null;
  propertyId: string | null;
  /**
   * The building an owner's or a customer's invoice is about, printed on it
   * but not filed under it (see `requireOfficeLevel`).
   */
  buildingRef: { id: string; name: string } | null;
  leaseId: string | null;
  unitId: string | null;
  customerUserId: string | null;
  customerName: string | null;
  customerVatNumber: string | null;
  customerAddress: string | null;
  gracePeriodDays: number;
  currency: string | null;
}

function joinAddress(parts: Array<string | null | undefined>): string | null {
  const text = parts.map((part) => part?.trim()).filter(Boolean).join(", ");
  return text || null;
}

function personName(user: { firstName?: string | null; lastName?: string | null; email?: string | null }) {
  return `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || user.email || null;
}

function vatNumberOrRefuse(value: string | null | undefined): string | null {
  const number = normalizeVatNumber(value);
  if (!number) return null;
  if (!isSaudiVatNumber(number)) {
    throw new CustomInvoiceError(
      "A VAT number is 15 digits that begin and end with 3",
    );
  }
  return number;
}

function graceDays(terms: unknown): number {
  const days = (terms as { paymentConfig?: { lateFeeConfig?: { gracePeriodDays?: unknown } } } | null)
    ?.paymentConfig?.lateFeeConfig?.gracePeriodDays;
  return typeof days === "number" && days >= 0 ? days : 5;
}

const propertyAddressSelect = {
  id: true,
  name: true,
  ownerId: true,
  addressStreet: true,
  addressCity: true,
  addressCountry: true,
} as const;

async function propertyInScope(actor: ScopeActor, propertyId: string) {
  const property = await db.property.findFirst({
    where: withScope({ id: propertyId }, propertyScope(actor)),
    select: propertyAddressSelect,
  });
  if (!property) throw new CustomInvoiceError("Property not found", 404);
  return property;
}

/**
 * An invoice to an owner or a customer is the office's own document, filed
 * under no building: every report that reads a building's invoices — the
 * owner statement, the commission base, collections — reads them as rent
 * billed to its tenants, which this is not. A building it concerns is
 * printed on it instead (metadata). Like an expense with no building, it is
 * outside the reach of an employee limited to some buildings, so they cannot
 * raise one.
 */
function requireOfficeLevel(actor: ScopeActor) {
  if (actor.scopedPropertyIds !== undefined) {
    throw new CustomInvoiceError(
      "You are limited to some buildings, so you can invoice their tenants only.",
      403,
    );
  }
}

const leaseSelect = {
  id: true,
  tenantId: true,
  propertyId: true,
  unitId: true,
  terms: true,
  currency: true,
} as const;

async function resolveCustomer(
  actor: ScopeActor,
  body: CustomInvoiceBody,
): Promise<ResolvedCustomer> {
  const buyerVat = vatNumberOrRefuse(body.buyerVatNumber);

  if (body.customerType === "tenant") {
    let lease: Prisma.LeaseGetPayload<{ select: typeof leaseSelect }> | null = null;
    if (body.leaseId) {
      // Scoped: the contract id arrives in the body, and this is what stops
      // an invoice being raised against someone else's lease.
      lease = await db.lease.findFirst({
        where: withScope({ id: body.leaseId }, leaseScope(actor)),
        select: leaseSelect,
      });
      if (!lease) throw new CustomInvoiceError("Lease not found", 404);
      if (body.tenantId && body.tenantId !== lease.tenantId) {
        throw new CustomInvoiceError("Selected tenant does not match the lease tenant");
      }
      if (body.propertyId && body.propertyId !== lease.propertyId) {
        throw new CustomInvoiceError("Selected property does not match the lease property");
      }
    }
    const tenantId = lease?.tenantId ?? body.tenantId!;
    const tenant = await findTenantInScope(actor, tenantId);
    if (!tenant) throw new CustomInvoiceError("Tenant not found", 404);

    // A tenant's invoice is on a building — the one named, else the one of
    // their live contract — because what they pay on it is a payment, and a
    // payment belongs to a building. A contract is linked when there is one;
    // it is no longer required.
    if (!lease) {
      lease = await db.lease.findFirst({
        where: withScope(
          {
            tenantId,
            ...(body.propertyId ? { propertyId: body.propertyId } : {}),
            status: { in: ["active", "pending"] },
          },
          leaseScope(actor),
        ),
        select: leaseSelect,
        orderBy: { startDate: "desc" },
      });
    }
    const propertyId = body.propertyId ?? lease?.propertyId ?? null;
    if (!propertyId) {
      throw new CustomInvoiceError(
        "This tenant has no contract, so choose the building the invoice is for",
      );
    }
    const property = await propertyInScope(actor, propertyId);
    return {
      customerType: "tenant",
      tenantId,
      propertyId,
      buildingRef: null,
      leaseId: lease?.id ?? null,
      unitId: lease?.unitId ?? null,
      customerUserId: null,
      customerName: personName(tenant),
      customerVatNumber: buyerVat,
      customerAddress:
        body.customerAddress?.trim() ||
        joinAddress([property.addressStreet, property.addressCity, property.addressCountry]),
      gracePeriodDays: graceDays(lease?.terms),
      currency: lease?.currency ?? null,
    };
  }

  if (body.customerType === "owner") {
    const owner = await db.user.findFirst({
      where: withScope({ id: body.ownerId! }, ownerRecordScope(actor)),
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        role: true,
        ownerProfile: {
          select: {
            companyName: true,
            taxNumber: true,
            addressStreet: true,
            addressCity: true,
            addressDistrict: true,
            addressCountry: true,
          },
        },
        _count: { select: { propertiesOwned: true } },
      },
    });
    if (!owner || (owner.role !== "owner" && owner._count.propertiesOwned === 0)) {
      throw new CustomInvoiceError("Owner not found", 404);
    }
    requireOfficeLevel(actor);
    let buildingRef: ResolvedCustomer["buildingRef"] = null;
    if (body.propertyId) {
      const property = await propertyInScope(actor, body.propertyId);
      if (property.ownerId !== owner.id) {
        throw new CustomInvoiceError("That building is not this owner's");
      }
      buildingRef = { id: property.id, name: property.name };
    }
    const profile = owner.ownerProfile;
    return {
      customerType: "owner",
      tenantId: null,
      propertyId: null,
      buildingRef,
      leaseId: null,
      unitId: null,
      customerUserId: owner.id,
      customerName: profile?.companyName?.trim() || personName(owner),
      customerVatNumber: buyerVat ?? vatNumberOrRefuse(profile?.taxNumber),
      customerAddress:
        body.customerAddress?.trim() ||
        joinAddress([
          profile?.addressStreet,
          profile?.addressDistrict,
          profile?.addressCity,
          profile?.addressCountry,
        ]),
      gracePeriodDays: 5,
      currency: null,
    };
  }

  const customer = body.customer!;
  requireOfficeLevel(actor);
  let buildingRef: ResolvedCustomer["buildingRef"] = null;
  if (body.propertyId) {
    const property = await propertyInScope(actor, body.propertyId);
    buildingRef = { id: property.id, name: property.name };
  }
  return {
    customerType: "customer",
    tenantId: null,
    propertyId: null,
    buildingRef,
    leaseId: null,
    unitId: null,
    customerUserId: null,
    customerName: customer.name.trim(),
    customerVatNumber: vatNumberOrRefuse(customer.vatNumber) ?? buyerVat,
    customerAddress: customer.address?.trim() || body.customerAddress?.trim() || null,
    gracePeriodDays: 5,
    currency: null,
  };
}

// ---------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------

function computeLines(body: CustomInvoiceBody): ComputedVatInvoice {
  try {
    return computeVatInvoice(
      body.lines.map((line) => ({
        description: line.description,
        category: line.category ?? null,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        vatCategory: line.vatCategory,
        vatRate: line.vatRate,
      })),
      body.discountAmount,
    );
  } catch (error) {
    if (error instanceof VatInputError) throw new CustomInvoiceError(error.message);
    throw error;
  }
}

/** The JSON copy of the lines older screens and the PDFs read. */
function lineItemsJson(lines: readonly ComputedVatLine[], fallbackCategory: string) {
  return lines.map((line) => ({
    description: line.description,
    type: line.category ?? fallbackCategory,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    // What the line is worth before the discount: the lines add up to the
    // invoice's subtotal, as on every other invoice.
    amount: line.grossAmount,
    discountAmount: line.discountAmount,
    netAmount: line.netAmount,
    vatCategory: line.vatCategory,
    vatRate: line.vatRate,
    vatAmount: line.vatAmount,
    totalAmount: line.totalAmount,
  }));
}

function lineRows(
  organizationId: string,
  invoiceId: string,
  lines: readonly ComputedVatLine[],
): Prisma.InvoiceLineCreateManyInput[] {
  return lines.map((line) => ({
    organizationId,
    invoiceId,
    position: line.position,
    description: line.description,
    category: line.category,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    discountAmount: line.discountAmount,
    netAmount: line.netAmount,
    vatCategory: line.vatCategory,
    vatRate: line.vatRate,
    vatAmount: line.vatAmount,
    totalAmount: line.totalAmount,
  }));
}

async function orgCurrency(): Promise<string> {
  try {
    const settings = await getOrgSystemSettings();
    return settings?.payment?.currency || "SAR";
  } catch {
    return "SAR";
  }
}

async function requirePhase0(): Promise<void> {
  if (!(await accountingPhase0Available())) {
    throw new CustomInvoiceError(PHASE0_MISSING_MESSAGE, 503);
  }
}

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

export interface WrittenInvoice {
  id: string;
  invoiceNumber: string;
  totalAmount: number;
}

export async function createCustomInvoice(
  actor: ScopeActor & { id: string },
  body: CustomInvoiceBody,
): Promise<WrittenInvoice> {
  await requirePhase0();
  const organizationId = requireOrgId();
  const customer = await resolveCustomer(actor, body);
  const computed = computeLines(body);
  if (computed.totals.totalAmount <= 0) {
    throw new CustomInvoiceError("An invoice must be for more than zero");
  }

  const issueDate = body.issueDate ? new Date(body.issueDate) : new Date();
  const dueDate = body.dueDate ? new Date(body.dueDate) : issueDate;
  if (businessDay(dueDate) < businessDay(issueDate)) {
    throw new CustomInvoiceError("The due date cannot be before the invoice date");
  }
  const category =
    body.category ?? computed.lines.find((line) => line.category)?.category ?? "other";
  const currency = customer.currency ?? (await orgCurrency());
  const status =
    businessDay(issueDate) <= businessToday()
      ? InvoiceStatus.ISSUED
      : InvoiceStatus.SCHEDULED;

  const written = await createWithInvoiceNumber(organizationId, INVOICE_PREFIX, (invoiceNumber) =>
    runWithOrgTransaction(async (tx) => {
      const invoice = await tx.invoice.create({
        data: {
          organizationId,
          invoiceNumber,
          tenantId: customer.tenantId,
          propertyId: customer.propertyId,
          leaseId: customer.leaseId,
          unitId: customer.unitId,
          category,
          issueDate,
          dueDate,
          status,
          currency,
          subtotal: computed.totals.subtotal,
          discountAmount: computed.totals.discountAmount,
          taxAmount: computed.totals.taxAmount,
          totalAmount: computed.totals.totalAmount,
          amountPaid: 0,
          balanceRemaining: computed.totals.totalAmount,
          lineItems: lineItemsJson(computed.lines, category) as unknown as Prisma.InputJsonValue,
          gracePeriodEnd: new Date(dueDate.getTime() + customer.gracePeriodDays * DAY_MS),
          notes: body.notes,
          metadata: {
            ...(body.metadata ?? {}),
            source: "custom",
            createdByUserId: actor.id,
            ...(customer.buildingRef ? { building: customer.buildingRef } : {}),
          } as Prisma.InputJsonValue,
          documentType: "invoice",
          customerType: customer.customerType,
          customerUserId: customer.customerUserId,
          customerName: customer.customerName,
          customerVatNumber: customer.customerVatNumber,
          customerAddress: customer.customerAddress,
        },
        select: { id: true, invoiceNumber: true, totalAmount: true },
      });
      await tx.invoiceLine.createMany({
        data: lineRows(organizationId, invoice.id, computed.lines),
      });
      return {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        totalAmount: Number(invoice.totalAmount),
      };
    }),
  );
  postAfterCommit("invoice", written.id, { userId: actor.id });
  return written;
}

// ---------------------------------------------------------------------------
// Credit notes
// ---------------------------------------------------------------------------

export interface WrittenCreditNote extends WrittenInvoice {
  originalInvoiceId: string;
  originalInvoiceNumber: string;
  /** What the customer had paid beyond the invoice's new total. */
  refundDue: number;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

export async function createCreditNote(
  actor: ScopeActor & { id: string },
  body: CustomInvoiceBody,
): Promise<WrittenCreditNote> {
  await requirePhase0();

  // Scoped: an invoice outside the caller's buildings is not found.
  const original = await db.invoice.findFirst({
    where: withScope({ id: body.originalInvoiceId! }, invoiceScope(actor)),
    select: { id: true },
  });
  if (!original) throw new CustomInvoiceError("Invoice not found", 404);

  return writeCreditNote(actor, original.id, computeLines(body), {
    issueDate: body.issueDate ? new Date(body.issueDate) : new Date(),
    notes: body.notes,
    reason: body.reason ?? null,
  });
}

/**
 * A credit note for everything left on an invoice, line for line as it was
 * charged — how an invoice the app issued itself is withdrawn (a cancelled
 * owner settlement's tax invoice, lib/accounting/owners.service.ts).
 */
export async function creditWholeInvoice(
  actor: ScopeActor & { id: string },
  invoiceId: string,
  reason: string,
): Promise<WrittenCreditNote> {
  await requirePhase0();
  const invoice = await db.invoice.findFirst({
    where: { id: invoiceId, deletedAt: null },
    omit: { creditedAmount: false },
  });
  if (!invoice) throw new CustomInvoiceError("Invoice not found", 404);
  if (Number(invoice.creditedAmount ?? 0) > 0) {
    throw new CustomInvoiceError("Part of this invoice is credited already: credit the rest by hand", 409);
  }
  const lines = (await readInvoiceLines([invoice.id])).get(invoice.id) ?? [];
  if (lines.length === 0) {
    throw new CustomInvoiceError("This invoice has no lines to credit", 409);
  }
  const computedLines: ComputedVatLine[] = lines.map((line, position) => ({
    position,
    description: line.description,
    category: line.category,
    quantity: 1,
    unitPrice: line.netAmount,
    grossAmount: line.netAmount,
    discountAmount: 0,
    netAmount: line.netAmount,
    vatCategory: line.vatCategory,
    vatRate: line.vatRate,
    vatAmount: line.vatAmount,
    totalAmount: line.totalAmount,
  }));
  const sum = (pick: (line: ComputedVatLine) => number) =>
    Math.round(computedLines.reduce((acc, line) => acc + Math.round(pick(line) * 100), 0)) / 100;
  const computed: ComputedVatInvoice = {
    lines: computedLines,
    totals: {
      subtotal: sum((line) => line.netAmount),
      discountAmount: 0,
      netAmount: sum((line) => line.netAmount),
      taxAmount: sum((line) => line.vatAmount),
      totalAmount: sum((line) => line.totalAmount),
    },
    breakdown: vatBreakdown(computedLines),
  };
  return writeCreditNote(actor, invoice.id, computed, {
    issueDate: new Date(),
    notes: undefined,
    reason,
  });
}

async function writeCreditNote(
  actor: ScopeActor & { id: string },
  originalId: string,
  computed: ComputedVatInvoice,
  options: { issueDate: Date; notes: string | undefined; reason: string | null },
): Promise<WrittenCreditNote> {
  const organizationId = requireOrgId();
  const original = { id: originalId };
  const credit = computed.totals.totalAmount;
  if (credit <= 0) {
    throw new CustomInvoiceError("A credit note must be for more than zero");
  }
  const stored = negateVatInvoice(computed);
  const issueDate = options.issueDate;

  const written = await createWithInvoiceNumber(organizationId, CREDIT_NOTE_PREFIX, (invoiceNumber) =>
    runWithOrgTransaction(async (tx) => {
      // Read inside the transaction, so two credit notes written at once
      // cannot both take the same balance (the version check below).
      const invoice = await tx.invoice.findFirst({
        where: { id: original.id, deletedAt: null },
        omit: {
          documentType: false,
          creditedAmount: false,
          customerType: false,
          customerUserId: false,
          customerName: false,
          customerVatNumber: false,
          customerAddress: false,
        },
      });
      if (!invoice) throw new CustomInvoiceError("Invoice not found", 404);
      if (invoice.documentType === "credit_note") {
        throw new CustomInvoiceError("A credit note cannot itself be credited");
      }
      if (invoice.status === InvoiceStatus.CANCELLED) {
        throw new CustomInvoiceError("This invoice is cancelled");
      }
      const creditable = round2(
        Number(invoice.totalAmount) - Number(invoice.creditedAmount ?? 0),
      );
      if (credit > creditable + 0.005) {
        throw new CustomInvoiceError(
          `The credit is more than what is left to credit on this invoice (${creditable.toFixed(2)}).`,
        );
      }
      // And no more than what each VAT category charged, less what earlier
      // credit notes took off it.
      const [originalLines, earlierNotes] = await Promise.all([
        tx.invoiceLine.findMany({
          where: { invoiceId: invoice.id },
          select: { vatCategory: true, netAmount: true, vatAmount: true },
        }),
        tx.invoice.findMany({
          where: {
            originalInvoiceId: invoice.id,
            documentType: "credit_note",
            deletedAt: null,
            status: { not: InvoiceStatus.CANCELLED },
          },
          select: { id: true },
        }),
      ]);
      const earlierLines = earlierNotes.length
        ? await tx.invoiceLine.findMany({
            where: { invoiceId: { in: earlierNotes.map((note) => note.id) } },
            select: { vatCategory: true, netAmount: true, vatAmount: true },
          })
        : [];
      const asAmounts = (rows: Array<{ vatCategory: string; netAmount: unknown; vatAmount: unknown }>) =>
        rows.map((row): VatCategoryAmount => ({
          vatCategory: row.vatCategory,
          net: Number(row.netAmount),
          vat: Number(row.vatAmount),
        }));
      const charged: VatCategoryAmount[] =
        originalLines.length > 0
          ? asAmounts(originalLines)
          : [
              (() => {
                // An installment or an older invoice: its one treatment.
                const treatment = legacyInvoiceVat({
                  category: invoice.category,
                  subtotal: Number(invoice.subtotal),
                  discountAmount: Number(invoice.discountAmount),
                  taxAmount: Number(invoice.taxAmount),
                });
                return {
                  vatCategory: treatment.vatCategory,
                  net: treatment.netAmount,
                  vat: treatment.vatAmount,
                };
              })(),
            ];
      const refused = creditExceedsCategory(
        charged,
        asAmounts(earlierLines),
        computed.lines.map((line) => ({
          vatCategory: line.vatCategory,
          net: line.netAmount,
          vat: line.vatAmount,
        })),
      );
      if (refused) throw new CustomInvoiceError(refused);
      const effect = applyCredit(
        {
          totalAmount: Number(invoice.totalAmount),
          amountPaid: Number(invoice.amountPaid),
          creditedAmount: Number(invoice.creditedAmount ?? 0),
          status: invoice.status,
        },
        credit,
      );

      const note = await tx.invoice.create({
        data: {
          organizationId,
          invoiceNumber,
          tenantId: invoice.tenantId,
          propertyId: invoice.propertyId,
          leaseId: invoice.leaseId,
          unitId: invoice.unitId,
          category: invoice.category,
          issueDate,
          dueDate: issueDate,
          status: InvoiceStatus.ISSUED,
          currency: invoice.currency,
          subtotal: stored.totals.subtotal,
          discountAmount: stored.totals.discountAmount,
          taxAmount: stored.totals.taxAmount,
          totalAmount: stored.totals.totalAmount,
          amountPaid: 0,
          // Nothing is owed on a credit note: it is what the office owes back.
          balanceRemaining: 0,
          lineItems: lineItemsJson(stored.lines, invoice.category) as unknown as Prisma.InputJsonValue,
          notes: options.notes,
          metadata: {
            source: "credit_note",
            createdByUserId: actor.id,
            reason: options.reason,
            originalInvoiceNumber: invoice.invoiceNumber,
          } as Prisma.InputJsonValue,
          documentType: "credit_note",
          originalInvoiceId: invoice.id,
          customerType: invoice.customerType,
          customerUserId: invoice.customerUserId,
          customerName: invoice.customerName,
          customerVatNumber: invoice.customerVatNumber,
          customerAddress: invoice.customerAddress,
        },
        select: { id: true, invoiceNumber: true, totalAmount: true },
      });
      await tx.invoiceLine.createMany({
        data: lineRows(organizationId, note.id, stored.lines),
      });

      const metadata = (invoice.metadata ?? {}) as Record<string, unknown>;
      const updated = await tx.invoice.updateMany({
        where: { id: invoice.id, version: invoice.version },
        data: {
          creditedAmount: effect.creditedAmount,
          balanceRemaining: effect.balanceRemaining,
          ...(effect.status ? { status: effect.status } : {}),
          metadata: {
            ...metadata,
            ...(effect.refundDue > 0 ? { refundDue: effect.refundDue } : {}),
          } as Prisma.InputJsonValue,
          version: { increment: 1 },
        },
      });
      if (updated.count === 0) {
        throw new CustomInvoiceError(
          "This invoice was changed by someone else a moment ago. Refresh and try again.",
          409,
        );
      }

      return {
        id: note.id,
        invoiceNumber: note.invoiceNumber,
        totalAmount: Number(note.totalAmount),
        originalInvoiceId: invoice.id,
        originalInvoiceNumber: invoice.invoiceNumber,
        refundDue: effect.refundDue,
      };
    }),
  );
  postAfterCommit("invoice", [written.id, written.originalInvoiceId], { userId: actor.id });
  return written;
}

// ---------------------------------------------------------------------------
// Reading lines
// ---------------------------------------------------------------------------

export interface InvoiceLineRow {
  id: string;
  invoiceId: string;
  position: number;
  description: string;
  category: string | null;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  netAmount: number;
  vatCategory: VatCategory;
  vatRate: number;
  vatAmount: number;
  totalAmount: number;
}

/** The lines of these invoices, by invoice; none before the migration. */
export async function readInvoiceLines(
  invoiceIds: readonly string[],
): Promise<Map<string, InvoiceLineRow[]>> {
  const out = new Map<string, InvoiceLineRow[]>();
  const ids = [...new Set(invoiceIds.filter(Boolean))];
  if (ids.length === 0 || !(await accountingPhase0Available())) return out;
  const rows = await db.invoiceLine.findMany({
    where: { invoiceId: { in: ids } },
    orderBy: [{ invoiceId: "asc" }, { position: "asc" }],
  });
  for (const row of rows) {
    const line: InvoiceLineRow = {
      id: row.id,
      invoiceId: row.invoiceId,
      position: row.position,
      description: row.description,
      category: row.category,
      quantity: Number(row.quantity),
      unitPrice: Number(row.unitPrice),
      discountAmount: Number(row.discountAmount),
      netAmount: Number(row.netAmount),
      vatCategory: row.vatCategory as VatCategory,
      vatRate: Number(row.vatRate),
      vatAmount: Number(row.vatAmount),
      totalAmount: Number(row.totalAmount),
    };
    const list = out.get(row.invoiceId) ?? [];
    list.push(line);
    out.set(row.invoiceId, list);
  }
  return out;
}

// ---------------------------------------------------------------------------
// What an owner or a customer paid
// ---------------------------------------------------------------------------

export interface CustomerSettlementInput {
  amount: number;
  paidDate: Date;
  paymentMethod: string;
  reference?: string;
  notes?: string;
}

/**
 * Money received on an invoice to an owner or a customer.
 *
 * A tenant's payment is a payment row with its receipt voucher number; an
 * owner or a customer has no tenant record for one to hang on, so what they
 * paid is kept on the invoice itself — amount, date, method, reference and
 * who recorded it — and each one is posted to the books as a receipt of its
 * own (lib/accounting/documents.service.ts, `invoice_settlement`).
 */
export async function recordCustomerSettlement(
  actor: ScopeActor & { id: string },
  invoiceId: string,
  input: CustomerSettlementInput,
) {
  await requirePhase0();
  const amount = round2(Number(input.amount));
  if (!(amount > 0)) throw new CustomInvoiceError("Valid payment amount is required");

  const settled = await runWithOrgTransaction(async (tx) => {
    const invoice = await tx.invoice.findFirst({
      where: withScope({ id: invoiceId, deletedAt: null }, invoiceScope(actor)),
      omit: { documentType: false, customerType: false },
    });
    if (!invoice) throw new CustomInvoiceError("Invoice not found", 404);
    if (invoice.tenantId) {
      throw new CustomInvoiceError(
        "This is a tenant's invoice: record the payment as a payment.",
        409,
      );
    }
    if (invoice.documentType === "credit_note") {
      throw new CustomInvoiceError("A credit note takes no payment.", 409);
    }
    if (invoice.status === InvoiceStatus.CANCELLED) {
      throw new CustomInvoiceError("This invoice is cancelled and cannot take a payment.", 409);
    }
    const balance = Number(invoice.balanceRemaining);
    if (balance <= 0) throw new CustomInvoiceError("This invoice is already fully paid.", 409);
    if (amount > balance + 0.005) {
      throw new CustomInvoiceError(
        `The amount is more than what is left on this invoice (${balance.toFixed(2)}).`,
      );
    }
    const amountPaid = round2(Number(invoice.amountPaid) + amount);
    const balanceRemaining = Math.max(0, round2(balance - amount));
    const metadata = (invoice.metadata ?? {}) as Record<string, unknown>;
    const settlements = Array.isArray(metadata.settlements) ? metadata.settlements : [];
    const updated = await tx.invoice.updateMany({
      where: { id: invoice.id, version: invoice.version },
      data: {
        amountPaid,
        balanceRemaining,
        status: balanceRemaining === 0 ? InvoiceStatus.PAID : InvoiceStatus.PARTIAL,
        // The latest day money came, not the day of the latest entry: a
        // back-dated receipt must not move it back (the ledger sweep reads it).
        lastPaymentDate:
          invoice.lastPaymentDate && invoice.lastPaymentDate.getTime() > input.paidDate.getTime()
            ? invoice.lastPaymentDate
            : input.paidDate,
        metadata: {
          ...metadata,
          settlements: [
            ...settlements,
            {
              amount,
              paidDate: input.paidDate.toISOString(),
              paymentMethod: input.paymentMethod,
              reference: input.reference?.trim() || null,
              notes: input.notes?.trim() || null,
              recordedById: actor.id,
              recordedAt: new Date().toISOString(),
            },
          ],
        } as Prisma.InputJsonValue,
        version: { increment: 1 },
      },
    });
    if (updated.count === 0) {
      throw new CustomInvoiceError(
        "This invoice was changed by someone else a moment ago. Refresh and try again.",
        409,
      );
    }
    return tx.invoice.findFirst({ where: { id: invoice.id } });
  });
  // What was received posts as the invoice's settlement (the ledger's
  // customer receipts — documents.service.ts).
  postAfterCommit("invoice", invoiceId, { userId: actor.id });
  return settled;
}

// ---------------------------------------------------------------------------
// A refund paid back on an overpaid invoice
// ---------------------------------------------------------------------------

export interface InvoiceRefundInput {
  amount: number;
  paidDate: Date;
  /** How it went back; for an owner, `owner_balance` puts it back on what the office holds for them. */
  paymentMethod: string;
  reference?: string;
  notes?: string;
}

/**
 * The office paid back what a credit note left an owner or a customer
 * overpaid (`metadata.refundDue`).
 *
 * Kept on the invoice beside what they paid, as a negative settlement, and
 * posted as one (lib/accounting/documents.service.ts): the money leaves the
 * account it was paid from, or goes back onto the owner's balance, and the
 * customer's credit in the receivables is cleared. What was paid on the
 * invoice comes down by it, so a later credit note works its refund out from
 * what was really kept.
 *
 * A tenant's invoice is paid by payments, not settlements; what a credit
 * note leaves them overpaid stays on their account as a credit.
 */
export async function recordInvoiceRefund(
  actor: ScopeActor & { id: string },
  invoiceId: string,
  input: InvoiceRefundInput,
) {
  await requirePhase0();
  const amount = round2(Number(input.amount));
  if (!(amount > 0)) throw new CustomInvoiceError("Valid refund amount is required");

  const refunded = await runWithOrgTransaction(async (tx) => {
    const invoice = await tx.invoice.findFirst({
      where: withScope({ id: invoiceId, deletedAt: null }, invoiceScope(actor)),
      omit: { documentType: false, customerType: false },
    });
    if (!invoice) throw new CustomInvoiceError("Invoice not found", 404);
    if (invoice.tenantId) {
      throw new CustomInvoiceError(
        "A tenant's overpayment stays on their account as a credit: refund it from their payments.",
        409,
      );
    }
    if (invoice.documentType === "credit_note") {
      throw new CustomInvoiceError("Record the refund on the invoice the credit note corrected.", 409);
    }
    if (input.paymentMethod === OWNER_BALANCE_METHOD && invoice.customerType !== "owner") {
      throw new CustomInvoiceError("Only an owner's refund can go back on their balance.", 400);
    }
    if (isReceivedByOwner(input.paymentMethod)) {
      throw new CustomInvoiceError("A refund is paid by the office: choose how the office paid it.", 400);
    }
    const metadata = (invoice.metadata ?? {}) as Record<string, unknown>;
    const due = round2(Number(metadata.refundDue ?? 0));
    if (!(due > 0)) throw new CustomInvoiceError("Nothing is due back on this invoice.", 409);
    if (amount > due + 0.005) {
      throw new CustomInvoiceError(
        `The refund is more than what is due back on this invoice (${due.toFixed(2)}).`,
      );
    }
    const after = applyRefund({ amountPaid: Number(invoice.amountPaid), refundDue: due }, amount);
    const settlements = Array.isArray(metadata.settlements) ? metadata.settlements : [];
    const rest = { ...metadata };
    delete rest.refundDue;
    const updated = await tx.invoice.updateMany({
      where: { id: invoice.id, version: invoice.version },
      data: {
        amountPaid: after.amountPaid,
        metadata: {
          ...rest,
          ...(after.refundDue > 0 ? { refundDue: after.refundDue } : {}),
          settlements: [
            ...settlements,
            {
              amount: -amount,
              paidDate: input.paidDate.toISOString(),
              paymentMethod: input.paymentMethod,
              kind: "refund",
              reference: input.reference?.trim() || null,
              notes: input.notes?.trim() || null,
              recordedById: actor.id,
              recordedAt: new Date().toISOString(),
            },
          ],
        } as Prisma.InputJsonValue,
        version: { increment: 1 },
      },
    });
    if (updated.count === 0) {
      throw new CustomInvoiceError(
        "This invoice was changed by someone else a moment ago. Refresh and try again.",
        409,
      );
    }
    return { invoiceNumber: invoice.invoiceNumber, refundDue: after.refundDue, amount };
  });
  // The refund posts as the invoice's settlement, turned around.
  postAfterCommit("invoice", invoiceId, { userId: actor.id });
  return refunded;
}
