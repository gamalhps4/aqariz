/**
 * PropertyPro - From the app's documents to what the books should hold
 *
 * Reads installments and invoices, payments, expenses and security deposits
 * and turns each into the entry it calls for today (or none), with the pure
 * rules in ./posting. Nothing here writes: posting.service.ts compares and
 * writes.
 *
 * What a document calls for depends on:
 *  - its date: nothing dated before the cut-over (the opening balances carry
 *    it) or after today (it has not happened yet) is posted;
 *  - its state: a cancelled installment, a deleted payment, a pending
 *    expense posts nothing — and an entry already posted for it is reversed;
 *  - whose building it is on its date: an owner's, the office's own (its
 *    owner of record is a member of staff, not an owner), or one held under
 *    an investment agreement (lib/agreement-math.ts decides which agreement
 *    governs a building on a day).
 */

import { db } from "@/lib/db/prisma";
import { InvoiceStatus, PaymentStatus } from "@/types";
import {
  resolveAgreementForProperty,
  type AgreementRow,
} from "@/lib/agreement-math";
import { isOnlinePayment } from "@/lib/payments/recorder";
import { isTenantCreditPayment } from "@/lib/payments/tenant-credit";
import { gatewayReferenceSelect } from "@/lib/payments/gateway-columns";
import { paymentNumbersAvailable } from "@/lib/payments/payment-number";
import { receiptNumberFor } from "@/lib/payments/receipt-number";
import { accountingPhase0Available } from "@/lib/invoice/phase0-columns";
import { ledgerDay, today } from "./dates";
import { toHalalas } from "./money";
import {
  invoicePostingDate,
  planInvoice,
  planInvoiceSettlement,
  planLinedInvoice,
  splitInvoice,
  chargeBeneficiary,
  chargeKind,
  type InvoiceReceivable,
  type InvoiceSplit,
} from "./posting/invoice";
import { planPaymentReceipt, planPaymentRefund } from "./posting/payment";
import { planExpense, POSTED_EXPENSE_STATUSES } from "./posting/expense";
import { planDepositReceipt, planDepositSettlement } from "./posting/deposit";
import { depositPostsOwnReceipt } from "./deposit-installment";
import { paidDepositLeaseIds } from "./deposit-installment.service";
import { paymentAllocations, paymentOwnerPortion, refundDateOf } from "./posting/allocations";
import { planPaymentVoucher, planPurchaseBill, POSTED_BILL_STATUSES } from "./posting/purchase";
import { purchasesAvailable } from "./purchases/availability";
import { formatBillNumber, formatVoucherNumber } from "./purchases/numbers";
import type { DocumentPlanItem } from "./posting.service";
import { isVatCode, type DepositHolder, type Ownership, type VatCode } from "./types";

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface PropertyFacts {
  id: string;
  ownerId: string;
  compoundId: string | null;
  ownerIsOffice: boolean;
}

export interface PostingContext {
  cutOver: Date;
  today: Date;
  depositHolder: DepositHolder;
  vatRegistered: boolean;
  properties: Map<string, PropertyFacts>;
  investment: AgreementRow[];
  /**
   * Whether the books take invoice settlements yet (migration
   * 20261004160000_ledger_invoice_settlements); until they do, none is
   * planned. Set by the readers that post invoices.
   */
  settlements?: boolean;
}

/** Roles that are a client of the office; any other owner of record is staff. */
const CLIENT_ROLES = new Set(["owner", "tenant"]);

/**
 * Pass `deletedAt: undefined` to read archived rows too: the soft-delete
 * filter in lib/db/prisma.ts steps aside when a query names the column, and
 * Prisma ignores an undefined condition. A document's building or owner may
 * be in the archive and its money still on the books.
 */
const WITH_ARCHIVED = { deletedAt: undefined } as const;

export async function loadPostingContext(
  settings: {
    cutOverDate: Date | null;
    depositHolder: string;
    vatRegistered: boolean;
  },
  propertyIds?: readonly string[],
): Promise<PostingContext> {
  const ids = propertyIds ? [...new Set(propertyIds.filter(Boolean))] : null;
  const [properties, agreements] = await Promise.all([
    ids && ids.length === 0
      ? Promise.resolve([])
      : db.property.findMany({
          where: { ...WITH_ARCHIVED, ...(ids ? { id: { in: ids } } : {}) },
          select: {
            id: true,
            ownerId: true,
            compoundId: true,
            owner: { select: { role: true } },
          },
        }),
    db.agreement.findMany({
      where: { kind: "investment" },
      select: {
        id: true,
        kind: true,
        agreementNumber: true,
        ownerId: true,
        propertyId: true,
        compoundId: true,
        feeType: true,
        feePercentage: true,
        feeAmount: true,
        feeFrequency: true,
        commissionBasis: true,
        currency: true,
        startDate: true,
        endDate: true,
        status: true,
        terminatedDate: true,
      },
    }),
  ]);

  return {
    cutOver: settings.cutOverDate ? ledgerDay(settings.cutOverDate) : today(),
    today: today(),
    depositHolder: settings.depositHolder === "office" ? "office" : "owner",
    vatRegistered: settings.vatRegistered,
    properties: new Map(
      properties.map((property) => [
        property.id,
        {
          id: property.id,
          ownerId: property.ownerId,
          compoundId: property.compoundId,
          ownerIsOffice: !CLIENT_ROLES.has(String(property.owner?.role ?? "owner")),
        },
      ]),
    ),
    investment: agreements as AgreementRow[],
  };
}

/** Whose building it is on a day. */
export function ownershipOn(
  context: PostingContext,
  propertyId: string | null | undefined,
  day: Date,
): { ownership: Ownership; ownerId: string | null } {
  const property = propertyId ? context.properties.get(propertyId) : undefined;
  if (!property) return { ownership: "office", ownerId: null };
  const investment = resolveAgreementForProperty(
    context.investment,
    property,
    // The agreement engine reads a day as the moment it begins; noon keeps
    // a whole-day term on the right side of either end.
    new Date(day.getTime() + 12 * 3_600_000),
    "investment",
  );
  if (investment) return { ownership: "investment", ownerId: property.ownerId };
  if (property.ownerIsOffice) return { ownership: "office", ownerId: property.ownerId };
  return { ownership: "owner", ownerId: property.ownerId };
}

function inRange(context: PostingContext, day: Date): boolean {
  return day.getTime() >= context.cutOver.getTime() && day.getTime() <= context.today.getTime();
}

// ---------------------------------------------------------------------------
// Installments
// ---------------------------------------------------------------------------

export const INVOICE_POSTING_SELECT = {
  id: true,
  invoiceNumber: true,
  tenantId: true,
  propertyId: true,
  leaseId: true,
  unitId: true,
  category: true,
  issueDate: true,
  dueDate: true,
  status: true,
  totalAmount: true,
  taxAmount: true,
  lineItems: true,
  metadata: true,
  deletedAt: true,
} as const;

/** Whom accounting phase 0's invoices are to (selected once it is applied). */
const INVOICE_PHASE0_SELECT = {
  documentType: true,
  customerType: true,
  customerUserId: true,
  customerName: true,
  customerVatNumber: true,
} as const;

/**
 * INVOICE_POSTING_SELECT plus whom the invoice is to, once the database has
 * accounting phase 0's columns.
 */
export async function invoicePostingSelect() {
  return (await accountingPhase0Available())
    ? { ...INVOICE_POSTING_SELECT, ...INVOICE_PHASE0_SELECT }
    : INVOICE_POSTING_SELECT;
}

/** One of an invoice's own lines (invoice_lines), as the posting reads it. */
export interface InvoiceLineFacts {
  category: string | null;
  netAmount: number;
  vatAmount: number;
  vatCategory: string;
}

export interface InvoiceRow {
  id: string;
  invoiceNumber: string;
  /** Null on an invoice to an owner or a customer. */
  tenantId: string | null;
  propertyId: string | null;
  leaseId: string | null;
  unitId: string | null;
  category: string;
  issueDate: Date;
  dueDate: Date;
  status: string;
  totalAmount: number;
  taxAmount: number;
  lineItems: unknown;
  metadata: unknown;
  deletedAt: Date | null;
  documentType?: string | null;
  customerType?: string | null;
  customerUserId?: string | null;
  customerName?: string | null;
  customerVatNumber?: string | null;
  /** Its own lines, when it was written line by line (see `withInvoiceLines`). */
  lines?: InvoiceLineFacts[];
}

/**
 * Attach each invoice's own lines — a custom invoice's or a credit note's —
 * read in one query. None before accounting phase 0 is applied.
 */
export async function withInvoiceLines(invoices: InvoiceRow[]): Promise<InvoiceRow[]> {
  if (invoices.length === 0 || !(await accountingPhase0Available())) return invoices;
  const rows = await db.invoiceLine.findMany({
    where: { invoiceId: { in: invoices.map((invoice) => invoice.id) } },
    select: { invoiceId: true, category: true, netAmount: true, vatAmount: true, vatCategory: true },
    orderBy: [{ invoiceId: "asc" }, { position: "asc" }],
  });
  const byInvoice = new Map<string, InvoiceLineFacts[]>();
  for (const row of rows) {
    const list = byInvoice.get(row.invoiceId) ?? [];
    list.push({
      category: row.category,
      netAmount: Number(row.netAmount),
      vatAmount: Number(row.vatAmount),
      vatCategory: row.vatCategory,
    });
    byInvoice.set(row.invoiceId, list);
  }
  for (const invoice of invoices) invoice.lines = byInvoice.get(invoice.id) ?? [];
  return invoices;
}

let settlementsPresent = false;
let settlementsCheckedAt = 0;

/**
 * Whether the books take invoice settlements: the source type the ledger
 * migration's check allows (widened by 20261004160000). Remembered once it
 * is there; asked again every minute while it is not.
 */
export async function invoiceSettlementsPostable(): Promise<boolean> {
  if (settlementsPresent) return true;
  if (settlementsCheckedAt && Date.now() - settlementsCheckedAt < 60_000) return false;
  try {
    const rows = await db.$queryRaw<Array<{ present: boolean }>>`
      SELECT COALESCE(bool_or(pg_get_constraintdef(c.oid) LIKE '%invoice_settlement%'), FALSE) AS present
        FROM pg_constraint c
       WHERE c.conname = 'journal_entries_source_type_check'`;
    settlementsPresent = Boolean(rows[0]?.present);
  } catch {
    settlementsPresent = false;
  }
  settlementsCheckedAt = Date.now();
  return settlementsPresent;
}

function invoiceLines(lineItems: unknown): Array<{ type: string | null; amount: number }> {
  if (!Array.isArray(lineItems)) return [];
  return lineItems.map((item) => {
    const line = (item ?? {}) as Record<string, unknown>;
    return {
      type: typeof line.type === "string" ? line.type : null,
      amount: Number(line.amount ?? line.total ?? 0) || 0,
    };
  });
}

/**
 * The sub-ledger a customer who is neither a tenant nor an owner is kept in.
 * They have no record of their own, so they are known by their VAT number,
 * else by their name as printed — the same customer invoiced twice is one
 * account.
 */
export function customerPartyId(name: string | null | undefined, vatNumber: string | null | undefined): string | null {
  const vat = (vatNumber ?? "").replace(/\s+/g, "");
  if (vat) return `vat:${vat}`;
  const text = (name ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  return text ? `name:${text}` : null;
}

/** Whose receivable an invoice is: a tenant's, an owner's or a customer's. */
export function invoiceReceivable(invoice: InvoiceRow): InvoiceReceivable | null {
  if (invoice.customerType === "owner" && invoice.customerUserId) {
    return { account: "customer_receivables", partyType: "owner", partyId: invoice.customerUserId };
  }
  if (invoice.customerType === "customer") {
    const partyId = customerPartyId(invoice.customerName, invoice.customerVatNumber);
    return partyId ? { account: "customer_receivables", partyType: "customer", partyId } : null;
  }
  return invoice.tenantId
    ? { account: "tenant_receivables", partyType: "tenant", partyId: invoice.tenantId }
    : null;
}

/** Written line by line: a custom invoice or a credit note. */
function isLined(invoice: InvoiceRow): boolean {
  return (invoice.lines?.length ?? 0) > 0;
}

/**
 * The day an invoice posts on: an installment on its due day (the day it is
 * owed, as the owner statement counts it); a custom invoice or a credit note
 * on the day it was issued, its tax point.
 */
export function invoicePostingDay(invoice: InvoiceRow): Date {
  return ledgerDay(invoicePostingDate(invoice, isLined(invoice)));
}

/** An invoice split by whose money each part is, on its own due day. */
export function invoiceSplitFor(context: PostingContext, invoice: InvoiceRow): InvoiceSplit {
  const day = invoicePostingDay(invoice);
  const { ownership } = ownershipOn(context, invoice.propertyId, day);
  if (isLined(invoice)) {
    // The lines say what each part is; the split weighs them by what they bill.
    return splitInvoice({
      total: Number(invoice.totalAmount),
      tax: Number(invoice.taxAmount),
      lines: invoice.lines!.map((line) => ({
        type: line.category ?? invoice.category,
        amount: Math.abs(line.netAmount),
      })),
      category: invoice.category,
      ownership,
      depositHolder: context.depositHolder,
    });
  }
  return splitInvoice({
    total: Number(invoice.totalAmount),
    tax: Number(invoice.taxAmount),
    lines: invoiceLines(invoice.lineItems),
    category: invoice.category,
    ownership,
    depositHolder: context.depositHolder,
  });
}

/** What was received on an invoice to an owner or a customer (metadata). */
function invoiceSettlements(metadata: unknown): Array<{ amount: number; paidDate: Date; method: string | null }> {
  const list = (metadata as { settlements?: unknown } | null)?.settlements;
  if (!Array.isArray(list)) return [];
  return list.map((entry) => {
    const item = (entry ?? {}) as Record<string, unknown>;
    const paid = new Date(String(item.paidDate ?? ""));
    return {
      amount: Number(item.amount) || 0,
      paidDate: Number.isNaN(paid.getTime()) ? new Date(0) : paid,
      method: typeof item.paymentMethod === "string" ? item.paymentMethod : null,
    };
  });
}

export function invoiceItems(context: PostingContext, invoice: InvoiceRow): DocumentPlanItem[] {
  const day = invoicePostingDay(invoice);
  const postable =
    !invoice.deletedAt &&
    invoice.status !== InvoiceStatus.CANCELLED &&
    inRange(context, day);
  const { ownership, ownerId } = ownershipOn(context, invoice.propertyId, day);
  const receivable = invoiceReceivable(invoice);

  let plan = null;
  if (postable && receivable) {
    plan = isLined(invoice)
      ? planLinedInvoice({
          id: invoice.id,
          number: invoice.invoiceNumber,
          date: day,
          lines: invoice.lines!.map((line) => ({
            category: line.category ?? invoice.category,
            net: line.netAmount,
            vat: line.vatAmount,
            vatCategory: (isVatCode(line.vatCategory) ? line.vatCategory : "S") as VatCode,
          })),
          receivable,
          ownerId,
          propertyId: invoice.propertyId,
          unitId: invoice.unitId,
          leaseId: invoice.leaseId,
          ownership,
          depositHolder: context.depositHolder,
        })
      : invoice.tenantId
        ? planInvoice({
            id: invoice.id,
            number: invoice.invoiceNumber,
            date: day,
            category: invoice.category,
            total: Number(invoice.totalAmount),
            tax: Number(invoice.taxAmount),
            lines: invoiceLines(invoice.lineItems),
            tenantId: invoice.tenantId,
            ownerId,
            propertyId: invoice.propertyId,
            unitId: invoice.unitId,
            leaseId: invoice.leaseId,
            ownership,
            depositHolder: context.depositHolder,
          })
        : null;
  }
  const items: DocumentPlanItem[] = [{ sourceType: "invoice", sourceId: invoice.id, plan }];

  // An owner's or a customer's invoice keeps what they paid on itself; each
  // payment is an entry of its own, dated the day the money came. A refund
  // paid back on any invoice a credit note left overpaid — a tenant's too —
  // is kept there as well, as a negative amount.
  if (context.settlements) {
    invoiceSettlements(invoice.metadata).forEach((settlement, index) => {
      const settledDay = ledgerDay(settlement.paidDate);
      items.push({
        sourceType: "invoice_settlement",
        sourceId: `${invoice.id}:${index + 1}`,
        plan:
          !invoice.deletedAt && receivable && inRange(context, settledDay)
            ? planInvoiceSettlement({
                id: `${invoice.id}:${index + 1}`,
                number: invoice.invoiceNumber,
                date: settledDay,
                amount: settlement.amount,
                method: settlement.method,
                receivable,
              })
            : null,
      });
    });
  }
  return items;
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

export const PAYMENT_POSTING_SELECT = {
  id: true,
  tenantId: true,
  propertyId: true,
  leaseId: true,
  invoiceId: true,
  amount: true,
  amountPaid: true,
  type: true,
  status: true,
  paymentMethod: true,
  paidDate: true,
  createdAt: true,
  updatedAt: true,
  allocations: true,
  paymentHistory: true,
  deletedAt: true,
  recordedById: true,
  stripePaymentIntentId: true,
  stripeCheckoutSessionId: true,
  paypalCaptureId: true,
  razorpayPaymentId: true,
  paystackReference: true,
  receipt: { select: { receiptNumber: true } },
  lease: { select: { unitId: true, taxEnabled: true, taxRate: true } },
} as const;

/**
 * PAYMENT_POSTING_SELECT plus any gateway's reference once the database has
 * the column (lib/payments/gateway-columns.ts): a Moyasar, PayPal or Tap
 * receipt lands in gateway clearing, not the POS account.
 */
export async function paymentPostingSelect() {
  return {
    ...PAYMENT_POSTING_SELECT,
    ...(await gatewayReferenceSelect()),
    // The payment number (RCP-000123) the entry is referenced by, once the
    // database hands it out (lib/payments/payment-number.ts).
    ...((await paymentNumbersAvailable()) ? { number: true } : {}),
  };
}

export interface PaymentRow {
  id: string;
  tenantId: string;
  propertyId: string;
  leaseId: string | null;
  invoiceId: string | null;
  amount: number;
  amountPaid: number;
  type: string;
  status: string;
  paymentMethod: string | null;
  paidDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
  allocations: unknown;
  paymentHistory: unknown;
  deletedAt: Date | null;
  /**
   * The member of staff who recorded it: a person wins over a checkout the
   * row still names (lib/payments/recorder.ts `isOnlinePayment`).
   */
  recordedById?: string | null;
  /** Any gateway's reference, where the read asked for it (see paymentPostingSelect). */
  gatewayPaymentId?: string | null;
  stripePaymentIntentId: string | null;
  stripeCheckoutSessionId: string | null;
  paypalCaptureId: string | null;
  razorpayPaymentId: string | null;
  paystackReference: string | null;
  receipt: { receiptNumber: string } | null;
  /** The payment number, where the read asked for it (see paymentPostingSelect). */
  number?: number | null;
  lease: { unitId: string; taxEnabled: boolean; taxRate: number } | null;
}

/** Statuses that mean money was received on a payment at some point. */
const RECEIVED_STATUSES: readonly string[] = [
  PaymentStatus.PAID,
  PaymentStatus.PARTIAL,
  PaymentStatus.REFUNDED,
];

/** What was received: `amountPaid`, or `amount` on an older row without it. */
export function collectedOf(payment: Pick<PaymentRow, "amount" | "amountPaid">): number {
  return Number(payment.amountPaid) || Number(payment.amount) || 0;
}

/** The invoices a payment's allocations name — to load before planning it. */
export function allocatedInvoiceIds(payment: PaymentRow): string[] {
  return paymentAllocations({
    allocations: payment.allocations,
    invoiceId: payment.invoiceId,
    collected: collectedOf(payment),
    paymentHistory: payment.paymentHistory,
  }).map((allocation) => allocation.invoiceId);
}

/**
 * A payment's receipt — and, once refunded, its refund. `splits` holds the
 * installments it paid (see `allocatedInvoiceIds`).
 */
export function paymentItems(
  context: PostingContext,
  payment: PaymentRow,
  splits: ReadonlyMap<string, InvoiceSplit>,
): DocumentPlanItem[] {
  const received =
    !payment.deletedAt &&
    RECEIVED_STATUSES.includes(payment.status) &&
    collectedOf(payment) > 0;
  const day = ledgerDay(payment.paidDate ?? payment.createdAt);
  const { ownership, ownerId } = ownershipOn(context, payment.propertyId, day);
  const collected = collectedOf(payment);
  const kind = chargeKind(payment.type);

  const allocations = paymentAllocations({
    allocations: payment.allocations,
    invoiceId: payment.invoiceId,
    collected,
    paymentHistory: payment.paymentHistory,
  });
  const ownerPortion = paymentOwnerPortion({
    collected: toHalalas(collected),
    allocations,
    splits,
    unappliedBeneficiary: chargeBeneficiary(kind, ownership, context.depositHolder),
  });

  // Built whether or not it is in range: a refund after the cut-over of a
  // receipt from before it still has to post, and mirrors this.
  const receipt = received
    ? planPaymentReceipt({
        id: payment.id,
        // Its receipt voucher number: the payment number, as every screen
        // and document prints it.
        number: receiptNumberFor(payment.id, payment.receipt?.receiptNumber, payment.number),
        date: day,
        amount: collected,
        method: payment.paymentMethod,
        online: isOnlinePayment(payment),
        credit: isTenantCreditPayment(payment.paymentHistory),
        tenantId: payment.tenantId,
        ownerId,
        propertyId: payment.propertyId,
        unitId: payment.lease?.unitId ?? null,
        leaseId: payment.leaseId,
        ownership,
        ownerPortion,
        unbilled:
          ownerPortion === null
            ? {
                kind,
                depositHolder: context.depositHolder,
                vatRate: payment.lease?.taxEnabled ? Number(payment.lease.taxRate) || 0 : 0,
              }
            : undefined,
      })
    : null;

  const items: DocumentPlanItem[] = [
    {
      sourceType: "payment",
      sourceId: payment.id,
      plan: receipt && inRange(context, day) ? receipt : null,
    },
  ];

  const refundDay = ledgerDay(refundDateOf(payment.paymentHistory, payment.updatedAt));
  const refunded = received && payment.status === PaymentStatus.REFUNDED && receipt;
  items.push({
    sourceType: "payment_refund",
    sourceId: payment.id,
    plan:
      refunded && inRange(context, refundDay)
        ? planPaymentRefund(receipt, { date: refundDay })
        : null,
  });
  return items;
}

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

export const EXPENSE_POSTING_SELECT = {
  id: true,
  expenseNumber: true,
  propertyId: true,
  unitId: true,
  category: true,
  amount: true,
  date: true,
  paymentMethod: true,
  status: true,
  deletedAt: true,
} as const;

/**
 * EXPENSE_POSTING_SELECT plus the VAT and the supplier the expense records,
 * once the database has accounting phase 0's columns.
 */
export async function expensePostingSelect() {
  return (await accountingPhase0Available())
    ? { ...EXPENSE_POSTING_SELECT, vatAmount: true, vatCategory: true, supplierId: true }
    : EXPENSE_POSTING_SELECT;
}

export interface ExpenseRow {
  id: string;
  expenseNumber: string | null;
  propertyId: string | null;
  unitId: string | null;
  category: string;
  amount: number;
  date: Date;
  paymentMethod: string | null;
  status: string;
  deletedAt: Date | null;
  /** The VAT inside the amount, its category and the supplier (phase 0). */
  vatAmount?: number | null;
  vatCategory?: string | null;
  supplierId?: string | null;
}

export function expenseItems(context: PostingContext, expense: ExpenseRow): DocumentPlanItem[] {
  const day = ledgerDay(expense.date);
  const postable =
    !expense.deletedAt &&
    POSTED_EXPENSE_STATUSES.includes(expense.status) &&
    inRange(context, day);
  const building = expense.propertyId ? ownershipOn(context, expense.propertyId, day) : null;
  const plan = postable
    ? planExpense({
        id: expense.id,
        number: expense.expenseNumber,
        date: day,
        amount: Number(expense.amount),
        vatAmount: Number(expense.vatAmount ?? 0) || 0,
        vatRecoverable: context.vatRegistered,
        vatCategory: isVatCode(expense.vatCategory) ? expense.vatCategory : null,
        category: expense.category,
        status: expense.status,
        method: expense.paymentMethod,
        supplierId: expense.supplierId ?? null,
        propertyId: expense.propertyId,
        unitId: expense.unitId,
        ownerId: building?.ownerId ?? null,
        ownership: building?.ownership ?? null,
      })
    : null;
  return [{ sourceType: "expense", sourceId: expense.id, plan }];
}

// ---------------------------------------------------------------------------
// Security deposits
// ---------------------------------------------------------------------------

export const DEPOSIT_POSTING_SELECT = {
  id: true,
  leaseId: true,
  tenantId: true,
  propertyId: true,
  unitId: true,
  amount: true,
  status: true,
  collectedDate: true,
  collectedPaymentId: true,
  refundAmount: true,
  refundDate: true,
  refundMethod: true,
  deletedAt: true,
} as const;

export interface DepositRow {
  id: string;
  leaseId: string;
  tenantId: string;
  propertyId: string;
  unitId: string;
  amount: number;
  status: string;
  collectedDate: Date | null;
  collectedPaymentId: string | null;
  refundAmount: number | null;
  refundDate: Date | null;
  refundMethod: string | null;
  deletedAt: Date | null;
  /**
   * A payment paid the contract's deposit installment (not a column: the
   * loaders read it, see ./deposit-installment.service.ts).
   */
  installmentPaid?: boolean;
}

const COLLECTED_DEPOSIT_STATUSES = new Set([
  "collected",
  "partially_refunded",
  "fully_refunded",
  "forfeited",
]);
const SETTLED_DEPOSIT_STATUSES = new Set(["partially_refunded", "fully_refunded", "forfeited"]);

export function depositItems(context: PostingContext, deposit: DepositRow): DocumentPlanItem[] {
  const facts = (day: Date) => {
    const { ownership, ownerId } = ownershipOn(context, deposit.propertyId, day);
    return {
      id: deposit.id,
      date: day,
      tenantId: deposit.tenantId,
      ownerId,
      propertyId: deposit.propertyId,
      unitId: deposit.unitId,
      leaseId: deposit.leaseId,
      ownership,
      depositHolder: context.depositHolder,
    };
  };

  // Collected through a payment — the one it was collected with, or one that
  // paid its installment — the payment posted it; only a deposit marked
  // collected with no payment behind it is posted from here.
  const receiptDay = deposit.collectedDate ? ledgerDay(deposit.collectedDate) : null;
  const receipt =
    !deposit.deletedAt &&
    depositPostsOwnReceipt(deposit) &&
    COLLECTED_DEPOSIT_STATUSES.has(deposit.status) &&
    receiptDay &&
    inRange(context, receiptDay)
      ? planDepositReceipt({ ...facts(receiptDay), amount: Number(deposit.amount), method: null })
      : null;

  const settledDay = deposit.refundDate ? ledgerDay(deposit.refundDate) : null;
  const settlement =
    !deposit.deletedAt &&
    SETTLED_DEPOSIT_STATUSES.has(deposit.status) &&
    settledDay &&
    inRange(context, settledDay)
      ? planDepositSettlement({
          ...facts(settledDay),
          amount: Number(deposit.amount),
          refundAmount: Number(deposit.refundAmount ?? 0),
          refundMethod: deposit.refundMethod,
        })
      : null;

  return [
    { sourceType: "deposit_receipt", sourceId: deposit.id, plan: receipt },
    { sourceType: "deposit_settlement", sourceId: deposit.id, plan: settlement },
  ];
}

// ---------------------------------------------------------------------------
// Purchase bills and payment vouchers
// ---------------------------------------------------------------------------

export const BILL_POSTING_SELECT = {
  id: true,
  number: true,
  supplierId: true,
  billDate: true,
  status: true,
  lines: {
    orderBy: { position: "asc" },
    select: {
      accountId: true,
      description: true,
      netAmount: true,
      vatAmount: true,
      vatCategory: true,
      propertyId: true,
      unitId: true,
    },
  },
} as const;

export interface BillRow {
  id: string;
  number: number;
  supplierId: string;
  billDate: Date;
  status: string;
  lines: Array<{
    accountId: string;
    description: string;
    netAmount: unknown;
    vatAmount: unknown;
    vatCategory: string;
    propertyId: string | null;
    unitId: string | null;
  }>;
}

/**
 * A bill's entry: once it is approved it is owed, on its date. A bill is the
 * office's own purchase whatever building its lines are on (posting/purchase.ts),
 * so nothing here depends on whose building that is.
 */
export function billItems(context: PostingContext, bill: BillRow): DocumentPlanItem[] {
  const day = ledgerDay(bill.billDate);
  const postable = POSTED_BILL_STATUSES.includes(bill.status) && inRange(context, day);
  const plan = postable
    ? planPurchaseBill({
        id: bill.id,
        number: formatBillNumber(bill.number),
        date: day,
        status: bill.status,
        supplierId: bill.supplierId,
        vatRecoverable: context.vatRegistered,
        lines: bill.lines.map((line) => ({
          accountId: line.accountId,
          net: Number(line.netAmount),
          vat: Number(line.vatAmount),
          vatCategory: (isVatCode(line.vatCategory) ? line.vatCategory : "S") as VatCode,
          propertyId: line.propertyId,
          unitId: line.unitId,
          description: line.description,
        })),
      })
    : null;
  return [{ sourceType: "purchase_bill", sourceId: bill.id, plan }];
}

export const VOUCHER_POSTING_SELECT = {
  id: true,
  number: true,
  supplierId: true,
  voucherDate: true,
  amount: true,
  status: true,
  reference: true,
  bankAccount: { select: { ledgerAccountId: true } },
} as const;

export interface VoucherRow {
  id: string;
  number: number;
  supplierId: string;
  voucherDate: Date;
  amount: unknown;
  status: string;
  reference: string | null;
  bankAccount: { ledgerAccountId: string } | null;
}

/** A voucher's entry: money paid out, on its date, from the account it was drawn on. */
export function voucherItems(context: PostingContext, voucher: VoucherRow): DocumentPlanItem[] {
  const day = ledgerDay(voucher.voucherDate);
  const plan =
    voucher.bankAccount && inRange(context, day)
      ? planPaymentVoucher({
          id: voucher.id,
          number: formatVoucherNumber(voucher.number),
          date: day,
          status: voucher.status,
          supplierId: voucher.supplierId,
          amount: Number(voucher.amount),
          bankLedgerAccountId: voucher.bankAccount.ledgerAccountId,
          reference: voucher.reference,
        })
      : null;
  return [{ sourceType: "payment_voucher", sourceId: voucher.id, plan }];
}

// ---------------------------------------------------------------------------
// One document, read fresh
// ---------------------------------------------------------------------------

// Which document an entry follows (pure, shared with the sweep).
export { documentKindOf, type DocumentKind } from "./document-sources";
import { documentIdOf, type DocumentKind } from "./document-sources";

/** Every entry one document calls for, read from the database now. */
export async function itemsForDocument(
  settings: { cutOverDate: Date | null; depositHolder: string; vatRegistered: boolean },
  kind: DocumentKind,
  id: string,
): Promise<DocumentPlanItem[]> {
  switch (kind) {
    case "invoice": {
      // A settlement's id is its invoice's, numbered.
      const invoiceId = documentIdOf("invoice_settlement", id);
      const invoice = (await db.invoice.findFirst({
        where: { id: invoiceId, ...WITH_ARCHIVED },
        select: await invoicePostingSelect(),
      })) as InvoiceRow | null;
      if (!invoice) return [{ sourceType: "invoice", sourceId: invoiceId, plan: null }];
      const [context, settlements] = await Promise.all([
        loadPostingContext(settings, invoice.propertyId ? [invoice.propertyId] : []),
        invoiceSettlementsPostable(),
        withInvoiceLines([invoice]),
      ]);
      return invoiceItems({ ...context, settlements }, invoice);
    }
    case "payment": {
      const payment = (await db.payment.findFirst({
        where: { id, ...WITH_ARCHIVED },
        select: await paymentPostingSelect(),
      })) as PaymentRow | null;
      if (!payment) {
        return [
          { sourceType: "payment", sourceId: id, plan: null },
          { sourceType: "payment_refund", sourceId: id, plan: null },
        ];
      }
      const invoiceIds = allocatedInvoiceIds(payment);
      const invoices = invoiceIds.length
        ? await withInvoiceLines(
            (await db.invoice.findMany({
              where: { id: { in: invoiceIds }, ...WITH_ARCHIVED },
              select: await invoicePostingSelect(),
            })) as InvoiceRow[],
          )
        : [];
      const context = await loadPostingContext(settings, [
        payment.propertyId,
        ...invoices.map((invoice) => invoice.propertyId).filter((id): id is string => Boolean(id)),
      ]);
      const splits = new Map(invoices.map((invoice) => [invoice.id, invoiceSplitFor(context, invoice)]));
      return paymentItems(context, payment, splits);
    }
    case "expense": {
      const expense = (await db.expense.findFirst({
        where: { id, ...WITH_ARCHIVED },
        select: await expensePostingSelect(),
      })) as ExpenseRow | null;
      if (!expense) return [{ sourceType: "expense", sourceId: id, plan: null }];
      const context = await loadPostingContext(
        settings,
        expense.propertyId ? [expense.propertyId] : [],
      );
      return expenseItems(context, expense);
    }
    case "security_deposit": {
      const deposit = (await db.securityDeposit.findFirst({
        where: { id, ...WITH_ARCHIVED },
        select: DEPOSIT_POSTING_SELECT,
      })) as DepositRow | null;
      if (!deposit) {
        return [
          { sourceType: "deposit_receipt", sourceId: id, plan: null },
          { sourceType: "deposit_settlement", sourceId: id, plan: null },
        ];
      }
      const [context, paid] = await Promise.all([
        loadPostingContext(settings, [deposit.propertyId]),
        paidDepositLeaseIds([deposit.leaseId]),
      ]);
      return depositItems(context, { ...deposit, installmentPaid: paid.has(deposit.leaseId) });
    }
    case "purchase_bill": {
      // Without the purchases migration there are no bills, and nothing held.
      if (!(await purchasesAvailable())) return [{ sourceType: "purchase_bill", sourceId: id, plan: null }];
      const bill = (await db.purchaseBill.findFirst({
        where: { id },
        select: BILL_POSTING_SELECT,
      })) as BillRow | null;
      if (!bill) return [{ sourceType: "purchase_bill", sourceId: id, plan: null }];
      const context = await loadPostingContext(settings, []);
      return billItems(context, bill);
    }
    case "payment_voucher": {
      if (!(await purchasesAvailable())) return [{ sourceType: "payment_voucher", sourceId: id, plan: null }];
      const voucher = (await db.paymentVoucher.findFirst({
        where: { id },
        select: VOUCHER_POSTING_SELECT,
      })) as VoucherRow | null;
      if (!voucher) return [{ sourceType: "payment_voucher", sourceId: id, plan: null }];
      const context = await loadPostingContext(settings, []);
      return voucherItems(context, voucher);
    }
  }
}

export { WITH_ARCHIVED };
