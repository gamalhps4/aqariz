/**
 * PropertyPro - Payment-Invoice Linking Service
 *
 * Financial writes in this service are deliberately transactional. A payment,
 * its invoice allocations, and the affected invoice balances either all commit
 * or all roll back together (runWithOrgTransaction on Postgres).
 *
 * The Invoice domain rules that used to live in the Mongoose model now live
 * here:
 *   - `computeInvoiceDerivedState` — the pre-save recompute
 *     (subtotal/totalAmount/balanceRemaining/status).
 *   - `applyPaymentToInvoiceTx` — the idempotent `invoice.addPayment` method.
 */

import {
  db,
  runWithOrgTransaction,
  type OrgTransactionClient,
} from "@/lib/db/prisma";
import { Prisma } from "@/generated/prisma/client";
import type { InvoiceReadModel as InvoiceModel } from "@/lib/invoice/phase0-columns";
import type { MoneyAsNumber } from "@/lib/db/prisma";
import { isOnlinePayment } from "@/lib/payments/recorder";
import { gatewayColumnsOmit } from "@/lib/payments/gateway-columns";
// Money fields arrive as numbers via the money result extension.
type InvoiceRow = MoneyAsNumber<InvoiceModel>;
import {
  InvoiceStatus,
  PaymentMethod,
  PaymentStatus,
  PaymentType,
} from "@/types";
import {
  isValidPaymentStatusTransition,
  paymentConcurrencyConflictError,
} from "./payment.service";
import { computeEffectiveInvoiceStatus } from "@/lib/invoice/invoice-shared";
import { AuditAction, recordActivity } from "@/lib/audit-domain";
import { postAfterCommit } from "@/lib/accounting/hooks";
import { businessDay, businessToday, isPastDue } from "@/lib/dates/business-day";

export interface PaymentApplication {
  invoiceId: string;
  amountApplied: number;
  remainingBalance: number;
  fullyPaid: boolean;
}

export interface PaymentLinkingResult {
  success: boolean;
  paymentId: string;
  totalAmountApplied: number;
  applicationsApplied: PaymentApplication[];
  remainingPaymentAmount: number;
  errors: string[];
}

type PaymentAllocation = {
  invoiceId: string;
  amount: number;
};

const ALLOCATABLE_INVOICE_STATUSES = [
  InvoiceStatus.ISSUED,
  InvoiceStatus.PARTIAL,
  InvoiceStatus.OVERDUE,
];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeMoney(amount: number, allowZero: boolean): number {
  if (!Number.isFinite(amount) || amount < 0 || (!allowZero && amount === 0)) {
    throw new Error(
      allowZero
        ? "Money amount must be a non-negative finite number"
        : "Payment amount must be a positive finite number",
    );
  }

  const minorUnits = Math.round(amount * 100);
  if (Math.abs(amount * 100 - minorUnits) > 1e-7) {
    throw new Error("Payment amount cannot contain fractions smaller than one cent");
  }

  return minorUnits / 100;
}

function normalizeAmount(amount: number): number {
  return normalizeMoney(amount, false);
}

function normalizeNonNegativeAmount(amount: number): number {
  return normalizeMoney(amount, true);
}

function createFailure(
  paymentId: string,
  amount: number,
  error: unknown,
): PaymentLinkingResult {
  return {
    success: false,
    paymentId,
    totalAmountApplied: 0,
    applicationsApplied: [],
    remainingPaymentAmount: amount,
    errors: [errorMessage(error)],
  };
}

// ============================================================================
// Invoice domain rules (relocated from the Mongoose Invoice model)
// ============================================================================

export interface InvoiceDerivedState {
  subtotal: number;
  totalAmount: number;
  balanceRemaining: number;
  status: string;
}

/**
 * The Invoice pre-save recompute, relocated from the Mongoose model:
 *   subtotal = Σ lineItems.amount
 *   totalAmount = max(0, subtotal + taxAmount − discountAmount)
 *   balanceRemaining = totalAmount − amountPaid
 *   status: "cancelled" is terminal; balance<=0 && total>0 → "paid";
 *           now>dueDate && balance>0 → "overdue"; amountPaid>0 → "partial";
 *           now>=issueDate → "issued"; else the current status (scheduled).
 *
 * Run this on EVERY invoice mutation and persist the result alongside it.
 */
export function computeInvoiceDerivedState(
  invoice: {
    lineItems: unknown;
    taxAmount?: number | null;
    discountAmount?: number | null;
    amountPaid?: number | null;
    dueDate: Date | string;
    issueDate: Date | string;
    status: string;
  },
  now: Date = new Date(),
): InvoiceDerivedState {
  const lineItems = (invoice.lineItems as any[]) ?? [];
  const round = (value: number) => Math.round(value * 100) / 100;

  const subtotal = round(
    lineItems.reduce((sum, item) => sum + Number(item?.amount ?? 0), 0),
  );
  let totalAmount = round(
    subtotal + (invoice.taxAmount || 0) - (invoice.discountAmount || 0),
  );
  if (totalAmount < 0) totalAmount = 0;

  const amountPaid = invoice.amountPaid || 0;
  const balanceRemaining = round(totalAmount - amountPaid);

  let status = invoice.status;
  if (status !== InvoiceStatus.CANCELLED) {
    // Overdue only after the END of the due date: due dates are stored at
    // midnight, so `now > dueDate` marked the tenant overdue for the entire
    // day the rent was actually due. The day ends at midnight in Riyadh, and
    // an invoice is issued from the start of its issue day there.
    if (balanceRemaining <= 0 && totalAmount > 0) {
      status = InvoiceStatus.PAID;
    } else if (invoice.dueDate && isPastDue(invoice.dueDate, now)) {
      status = InvoiceStatus.OVERDUE;
    } else if (amountPaid > 0) {
      status = InvoiceStatus.PARTIAL;
    } else if (invoice.issueDate && businessDay(invoice.issueDate) <= businessToday(now)) {
      status = InvoiceStatus.ISSUED;
    }
  }

  return { subtotal, totalAmount, balanceRemaining, status };
}

/**
 * Idempotent `invoice.addPayment`, relocated from the Mongoose Invoice model.
 * MUST run inside runWithOrgTransaction: re-reads the invoice, skips when the
 * payment id is already in `paymentIds` (guards double-finalization by a
 * redirect capture and a webhook), otherwise pushes the id, adds the amount to
 * amountPaid, recomputes the derived state, and stamps lastPaymentDate.
 */
export async function applyPaymentToInvoiceTx(
  tx: OrgTransactionClient,
  invoiceId: string,
  paymentId: string,
  amount: number,
): Promise<{ applied: boolean; invoice: InvoiceRow }> {
  const invoice = await tx.invoice.findFirst({
    where: { id: invoiceId, deletedAt: null },
  });
  if (!invoice) {
    throw new Error("Invoice not found");
  }

  if ((invoice.paymentIds ?? []).includes(paymentId)) {
    // Already applied — idempotent skip (still refresh derived status the way
    // the old addPayment fell through to updateStatus()).
    const derived = computeInvoiceDerivedState(invoice);
    const refreshed = await tx.invoice.update({
      where: { id: invoice.id },
      data: derived,
    });
    return { applied: false, invoice: refreshed };
  }

  const amountPaid = normalizeNonNegativeAmount(
    (invoice.amountPaid ?? 0) + amount,
  );
  const derived = computeInvoiceDerivedState({ ...invoice, amountPaid });
  // Version-claimed: two concurrent applications of DIFFERENT payments both
  // read amountPaid = X and both wrote X + own amount, silently erasing one
  // application (the paymentIds dedupe only guards the SAME payment twice).
  const claimed = await tx.invoice.updateMany({
    where: { id: invoice.id, version: invoice.version, deletedAt: null },
    data: {
      paymentIds: [...(invoice.paymentIds ?? []), paymentId],
      amountPaid,
      ...derived,
      lastPaymentDate: new Date(),
      version: { increment: 1 },
    },
  });
  if (claimed.count === 0) {
    throw new Error("Invoice was modified by another process");
  }

  const updated = await tx.invoice.findFirst({ where: { id: invoice.id } });
  return { applied: true, invoice: updated ?? invoice };
}

/** Convenience wrapper: run the idempotent apply in its own transaction. */
export async function applyPaymentToInvoice(
  invoiceId: string,
  paymentId: string,
  amount: number,
): Promise<{ applied: boolean; invoice: InvoiceRow }> {
  const result = await runWithOrgTransaction((tx) =>
    applyPaymentToInvoiceTx(tx, invoiceId, paymentId, amount),
  );
  if (result.applied) {
    postAfterCommit("payment", paymentId);
    postAfterCommit("invoice", invoiceId);
  }
  return result;
}

// ============================================================================
// Recording money against an installment — the one path staff use
// ============================================================================

/** A refusal the caller should show as-is, with the HTTP status it maps to. */
export class InstallmentPaymentError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "InstallmentPaymentError";
  }
}

/** One money event on a payment, kept in `paymentHistory`. */
export interface InstallmentPaymentEntry {
  event: "recorded" | "deleted" | "restored" | "refunded";
  amount: number;
  invoiceId?: string;
  paymentMethod?: string;
  paidDate?: string;
  /** Bank transfer number, cheque number, Ejari receipt — whatever proves it. */
  reference?: string;
  notes?: string;
  at: string;
  by?: string;
  /** On a deletion: what came back off each installment, so a restore can put it back. */
  reversed?: PaymentAllocation[];
  /** On a refund through a gateway: how the money went back (see GatewayRefundRecord). */
  gatewayRefund?: GatewayRefundRecord;
  /**
   * On a payment recorded at the desk over an online checkout it had opened:
   * the checkout, taken off the payment so it no longer reads as online, and
   * kept here so money the gateway takes on it later still finds the payment
   * (lib/payments/gateway-settle.ts) — and is held as the tenant's credit.
   */
  clearedAttempt?: { provider: string; id: string };
}

/**
 * How a refund went back through a gateway: part of it may have been refunded
 * earlier in the gateway's own dashboard, and only the rest now — 3,000
 * taken, 500 refunded there, 2,500 refunded from the app.
 */
export interface GatewayRefundRecord {
  gateway: string;
  /** The gateway's id for the refund made now; null when nothing was left to refund. */
  refundId: string | null;
  refundedNow: number;
  refundedEarlier: number;
}

export interface RecordInstallmentPaymentInput {
  invoiceId: string;
  amount: number;
  paymentMethod: string;
  paidDate: Date;
  reference?: string;
  notes?: string;
  /**
   * An open payment row with no money on it yet — typically one created from
   * the contract's old "create payment" button — to turn into this receipt
   * rather than leaving it beside a new one, still reading as unpaid.
   */
  convertPaymentId?: string;
  /**
   * The member of staff recording it. Required: this is the path staff use,
   * and the payments page shows who recorded each payment. Null only when a
   * payment gateway took the money and nobody recorded it — it has to be
   * said, so a staff path cannot leave the recorder out by accident.
   */
  recordedBy: string | null;
  /**
   * Send the tenant their receipt by SMS/WhatsApp, where the office sends
   * one. On unless said otherwise; the spreadsheet import turns it off, as
   * a file of last year's collections must not text every tenant in it.
   * Nothing else changes — the receipt itself, the books and the activity
   * entry are written either way.
   */
  notifyTenant?: boolean;
}

/** Statuses a payment row can be in while it still has no money against it. */
const CONVERTIBLE_PAYMENT_STATUSES: readonly string[] = [
  PaymentStatus.PENDING,
  PaymentStatus.OVERDUE,
  PaymentStatus.FAILED,
];

/**
 * A `dueDate` for a rent receipt that no live rent payment on this lease
 * already holds.
 *
 * `payments_rent_per_lease_due_unique` allows one live rent payment per lease
 * per due date — it exists so a replayed webhook or a generator run cannot
 * write the same charge twice. Receipts are payments too, so the second part
 * payment against an installment collided with the first and the insert
 * failed: "Allow partial payment of an installment" worked exactly once.
 *
 * The receipt keeps the installment's due date and steps forward a
 * millisecond at a time past any taken slot. Every screen shows the date, not
 * the milliseconds, so it still reads as the installment it paid, and the
 * index goes on doing its job for generated charges.
 */
async function freeRentDueSlot(
  tx: OrgTransactionClient,
  leaseId: string | null,
  type: string,
  dueDate: Date,
  excludePaymentId?: string,
): Promise<Date> {
  if (!leaseId || type !== PaymentType.RENT) return dueDate;
  const start = dueDate.getTime();
  const taken = await tx.payment.findMany({
    where: {
      leaseId,
      type,
      deletedAt: null,
      dueDate: { gte: new Date(start), lt: new Date(start + 60_000) },
      ...(excludePaymentId ? { id: { not: excludePaymentId } } : {}),
    },
    select: { dueDate: true },
  });
  const used = new Set(taken.map((row) => row.dueDate.getTime()));
  let slot = start;
  while (used.has(slot)) slot += 1;
  return new Date(slot);
}

/**
 * Put money on an installment, or take it back off.
 *
 * The same arithmetic the contract page has always used — paid plus amount,
 * balance from the stored total — rather than `computeInvoiceDerivedState`,
 * which rebuilds the total from line items. Version-claimed, so two people
 * settling the same installment at once cannot both write over the balance.
 */
async function moveInstallmentMoneyTx(
  tx: OrgTransactionClient,
  invoiceId: string,
  paymentId: string,
  amount: number,
  direction: "apply" | "reverse",
): Promise<InvoiceRow> {
  const invoice = await tx.invoice.findFirst({
    where: { id: invoiceId, deletedAt: null },
  });
  if (!invoice) {
    throw new InstallmentPaymentError("Installment not found", 404);
  }

  const paymentIds = invoice.paymentIds ?? [];
  const listed = paymentIds.includes(paymentId);
  if (direction === "apply" && listed) return invoice;
  if (direction === "reverse" && !listed) return invoice;

  const round = (value: number) => Math.round(value * 100) / 100;
  const amountPaid =
    direction === "apply"
      ? round(invoice.amountPaid + amount)
      : round(Math.max(0, invoice.amountPaid - amount));
  const balanceRemaining = round(invoice.totalAmount - amountPaid);
  const status = computeEffectiveInvoiceStatus({
    ...invoice,
    // A reversal can take a paid installment back below its total; "paid"
    // is terminal in the status rules, so it has to be let go of first.
    status:
      invoice.status === InvoiceStatus.PAID && balanceRemaining > 0
        ? InvoiceStatus.ISSUED
        : invoice.status,
    amountPaid,
    balanceRemaining,
  });

  const claimed = await tx.invoice.updateMany({
    where: { id: invoice.id, version: invoice.version, deletedAt: null },
    data: {
      paymentIds:
        direction === "apply"
          ? [...paymentIds, paymentId]
          : paymentIds.filter((id) => id !== paymentId),
      amountPaid,
      balanceRemaining,
      status,
      ...(direction === "apply" ? { lastPaymentDate: new Date() } : {}),
      version: { increment: 1 },
    },
  });
  if (claimed.count === 0) {
    throw new InstallmentPaymentError(
      "This installment was changed by someone else a moment ago. Refresh and try again.",
      409,
    );
  }

  return (await tx.invoice.findFirst({ where: { id: invoice.id } })) ?? invoice;
}

/**
 * Record a payment against one installment, in one transaction.
 *
 * Replaces an add-payment path that lost half of what the office typed: the
 * reference number and notes were stripped by validation and never stored,
 * the payment date was pushed forward to "now" (so a transfer that arrived
 * last week landed in this week's collections), no allocation was written
 * (so the payment could never be deleted and re-entered, the correction the
 * review prescribes), and the second part payment against an installment hit
 * a unique index. Each of those is handled here.
 */
export async function recordInstallmentPayment(
  input: RecordInstallmentPaymentInput,
): Promise<{ paymentId: string; invoice: InvoiceRow }> {
  let amount: number;
  try {
    amount = normalizeAmount(input.amount);
  } catch (error) {
    throw new InstallmentPaymentError(errorMessage(error), 400);
  }

  // The gateway columns, to read a converted row's open checkout.
  const gatewayOmit = input.convertPaymentId ? await gatewayColumnsOmit() : null;

  const recorded = await runWithOrgTransaction(async (tx) => {
    const invoice = await tx.invoice.findFirst({
      where: { id: input.invoiceId, deletedAt: null },
    });
    if (!invoice) {
      throw new InstallmentPaymentError("Installment not found", 404);
    }
    // An invoice to an owner or a customer has no tenant for a payment to
    // belong to: what they paid is kept on the invoice itself
    // (lib/invoice/custom-invoice.service.ts).
    const { tenantId, propertyId } = invoice;
    if (!tenantId || !propertyId) {
      throw new InstallmentPaymentError(
        "This invoice is not a tenant's: record what was received on the invoice itself.",
        409,
      );
    }
    if (invoice.status === InvoiceStatus.CANCELLED) {
      throw new InstallmentPaymentError(
        "This installment is cancelled and cannot take a payment.",
        409,
      );
    }
    if (invoice.balanceRemaining <= 0) {
      throw new InstallmentPaymentError(
        "This installment is already fully paid.",
        409,
      );
    }
    if (amount > invoice.balanceRemaining + 0.005) {
      throw new InstallmentPaymentError(
        `The amount is more than what is left on this installment (${invoice.balanceRemaining.toFixed(2)}).`,
        400,
      );
    }

    const reference = input.reference?.trim() || undefined;
    const notes = input.notes?.trim() || undefined;
    const entry: InstallmentPaymentEntry = {
      event: "recorded",
      amount,
      invoiceId: invoice.id,
      paymentMethod: input.paymentMethod,
      paidDate: input.paidDate.toISOString(),
      reference,
      notes,
      at: new Date().toISOString(),
      by: input.recordedBy ?? undefined,
    };
    const allocations: PaymentAllocation[] = [
      { invoiceId: invoice.id, amount },
    ];
    const lineItems = (invoice.lineItems as any[]) ?? [];
    const type: string = lineItems[0]?.type ?? PaymentType.RENT;

    let paymentId: string;
    if (input.convertPaymentId) {
      const existing = await tx.payment.findFirst({
        where: { id: input.convertPaymentId, deletedAt: null },
        ...(gatewayOmit ? { omit: gatewayOmit } : {}),
      });
      if (!existing) {
        throw new InstallmentPaymentError("Payment not found", 404);
      }
      if (
        existing.tenantId !== invoice.tenantId ||
        (existing.leaseId && existing.leaseId !== invoice.leaseId) ||
        (existing.invoiceId && existing.invoiceId !== invoice.id)
      ) {
        throw new InstallmentPaymentError(
          "That payment belongs to a different contract or installment.",
          409,
        );
      }
      if (
        Number(existing.amountPaid ?? 0) > 0 ||
        !CONVERTIBLE_PAYMENT_STATUSES.includes(existing.status)
      ) {
        throw new InstallmentPaymentError(
          "That payment already has money recorded against it.",
          409,
        );
      }

      // Listed on the installment while it carried no money — the demo seed
      // lists every scheduled row that way. `moveInstallmentMoneyTx` treats a
      // listed id as already applied, so the receipt read as paid while the
      // installment went on owing all of it. An empty row put nothing on the
      // installment, so taking it off the list first changes no balance.
      if ((invoice.paymentIds ?? []).includes(existing.id)) {
        const unlisted = await tx.invoice.updateMany({
          where: { id: invoice.id, version: invoice.version, deletedAt: null },
          data: {
            paymentIds: invoice.paymentIds.filter((id) => id !== existing.id),
            version: { increment: 1 },
          },
        });
        if (unlisted.count === 0) {
          throw new InstallmentPaymentError(
            "This installment was changed by someone else a moment ago. Refresh and try again.",
            409,
          );
        }
      }

      const dueDate = await freeRentDueSlot(
        tx,
        invoice.leaseId,
        type,
        invoice.dueDate,
        existing.id,
      );
      // Paid at the desk over a checkout it had opened online: the checkout
      // comes off (the money is the desk's, not the gateway's) and is kept in
      // the history entry, where a late online payment still finds it.
      const attempt =
        existing.gatewayProvider && existing.gatewayPaymentId
          ? { provider: existing.gatewayProvider, id: existing.gatewayPaymentId }
          : null;
      const converted = await tx.payment.updateMany({
        where: { id: existing.id, version: existing.version, deletedAt: null },
        data: {
          invoiceId: invoice.id,
          leaseId: invoice.leaseId ?? existing.leaseId,
          type,
          amount,
          amountPaid: amount,
          status: PaymentStatus.PAID,
          paymentMethod: input.paymentMethod,
          dueDate,
          paidDate: input.paidDate,
          recordedById: input.recordedBy,
          notes: notes ?? existing.notes,
          allocations: allocations as unknown as Prisma.InputJsonValue,
          paymentHistory: [
            ...((existing.paymentHistory as unknown[]) ?? []),
            attempt ? { ...entry, clearedAttempt: attempt } : entry,
          ] as unknown as Prisma.InputJsonValue,
          ...(attempt ? { gatewayProvider: null, gatewayPaymentId: null } : {}),
          version: { increment: 1 },
        },
      });
      if (converted.count === 0) {
        throw new InstallmentPaymentError(
          "This payment was changed by someone else a moment ago. Refresh and try again.",
          409,
        );
      }
      paymentId = existing.id;
    } else {
      const dueDate = await freeRentDueSlot(
        tx,
        invoice.leaseId,
        type,
        invoice.dueDate,
      );
      const created = await tx.payment.create({
        data: {
          organizationId: invoice.organizationId,
          tenantId,
          propertyId,
          leaseId: invoice.leaseId,
          invoiceId: invoice.id,
          type,
          amount,
          amountPaid: amount,
          status: PaymentStatus.PAID,
          paymentMethod: input.paymentMethod,
          dueDate,
          paidDate: input.paidDate,
          recordedById: input.recordedBy,
          description: `Payment for ${invoice.invoiceNumber}`,
          notes: notes ?? null,
          allocations: allocations as unknown as Prisma.InputJsonValue,
          paymentHistory: [entry] as unknown as Prisma.InputJsonValue,
        },
      });
      paymentId = created.id;
    }

    const updated = await moveInstallmentMoneyTx(
      tx,
      invoice.id,
      paymentId,
      amount,
      "apply",
    );
    return { paymentId, invoice: updated };
  });

  // Every path that records money against an installment comes through
  // here (the record dialog, "mark as paid", bulk, the tenant's card
  // payment), so the activity entry is written here, once.
  void recordActivity({
    action: AuditAction.PAYMENT_PROCESSED,
    recordType: "payment",
    recordId: recorded.paymentId,
    recordName: recorded.invoice.invoiceNumber,
    messageParams: { amount },
    before: { balanceRemaining: recorded.invoice.balanceRemaining + amount },
    after: {
      amount,
      paymentMethod: input.paymentMethod,
      paidDate: input.paidDate.toISOString(),
      reference: input.reference?.trim() || null,
      balanceRemaining: recorded.invoice.balanceRemaining,
    },
    details: {
      invoiceId: recorded.invoice.id,
      leaseId: recorded.invoice.leaseId ?? undefined,
      ...(input.convertPaymentId ? { convertedPayment: true } : {}),
    },
    organizationId: recorded.invoice.organizationId,
  });
  // The tenant's receipt by SMS/WhatsApp, where the office sends one
  // (Settings → Messaging). After the commit, and never in the way of it.
  if (input.notifyTenant !== false) {
    void import("@/lib/messaging/events").then(({ notifyPaymentReceived }) =>
      notifyPaymentReceived(recorded.paymentId),
    );
  }
  // The office's books, once the money is recorded (lib/accounting/hooks.ts).
  postAfterCommit("payment", recorded.paymentId, { userId: input.recordedBy });

  return recorded;
}

/**
 * Where a payment's money went, for undoing it.
 *
 * Its recorded allocations when it has them. Payments written by the older
 * add-payment path carry none — which is why they could never be deleted —
 * so for those the installment that lists the payment is the record.
 */
function allocationsToReverse(payment: {
  id: string;
  invoiceId: string | null;
  amountPaid: unknown;
  allocations: unknown;
}): PaymentAllocation[] {
  const recorded = ((payment.allocations as PaymentAllocation[]) ?? []).filter(
    (allocation) => allocation?.invoiceId && Number(allocation.amount) > 0,
  );
  if (recorded.length > 0) {
    return recorded.map((allocation) => ({
      invoiceId: String(allocation.invoiceId),
      amount: Number(allocation.amount),
    }));
  }
  const paid = Number(payment.amountPaid ?? 0);
  return payment.invoiceId && paid > 0
    ? [{ invoiceId: payment.invoiceId, amount: paid }]
    : [];
}

/**
 * Delete a payment the office recorded, taking its money back off the
 * installments it paid, and archive it.
 *
 * The review's correction path — "the payment should be deleted according to
 * the user's permission and a new payment should be recorded" — had no way
 * through: deleting a paid payment was refused with "refund it first", and a
 * refund changed the payment's status while the installment went on counting
 * the money. What was reversed is written into the payment's history, so
 * restoring it from the archive can put exactly that back.
 */
export async function deleteRecordedPayment(
  paymentId: string,
  deletedBy?: string,
): Promise<{ reversed: PaymentAllocation[] }> {
  // Read inside the transaction, recorded after it commits. Asserted rather
  // than inferred: an assignment inside the callback is invisible to the
  // narrowing that would otherwise pin this to `null`.
  let deletedRow = null as {
    organizationId: string;
    description: string | null;
    status: string;
    amount: number;
    amountPaid: number | null;
    paidDate: Date | null;
    paymentMethod: string | null;
    leaseId: string | null;
  } | null;
  // With any gateway's reference, once the database has it.
  const gatewayOmit = await gatewayColumnsOmit();
  const outcome = await runWithOrgTransaction(async (tx) => {
    const payment = await tx.payment.findFirst({
      where: { id: paymentId, deletedAt: null },
      omit: gatewayOmit,
    });
    if (!payment) {
      throw new InstallmentPaymentError("Payment not found", 404);
    }
    deletedRow = {
      organizationId: payment.organizationId,
      description: payment.description,
      status: payment.status,
      amount: Number(payment.amount),
      amountPaid: payment.amountPaid === null ? null : Number(payment.amountPaid),
      paidDate: payment.paidDate,
      paymentMethod: payment.paymentMethod,
      leaseId: payment.leaseId,
    };
    // Taken by a gateway — a reference and nobody at the desk recorded it. A
    // checkout opened and then paid in cash carries both: the person wins.
    if (!payment.recordedById && isOnlinePayment(payment)) {
      throw new InstallmentPaymentError(
        "This payment was collected online. Refund it instead of deleting it: the refund goes back through the same payment service.",
        409,
      );
    }

    const reversed: PaymentAllocation[] = [];
    // A refunded payment has already had its money taken back off.
    if (payment.status !== PaymentStatus.REFUNDED) {
      for (const allocation of allocationsToReverse(payment)) {
        const before = await tx.invoice.findFirst({
          where: { id: allocation.invoiceId, paymentIds: { has: payment.id } },
          select: { id: true },
        });
        if (!before) continue;
        await moveInstallmentMoneyTx(
          tx,
          allocation.invoiceId,
          payment.id,
          allocation.amount,
          "reverse",
        );
        reversed.push(allocation);
      }
    }

    const entry: InstallmentPaymentEntry = {
      event: "deleted",
      amount: Number(payment.amountPaid ?? 0),
      at: new Date().toISOString(),
      by: deletedBy,
      reversed,
    };
    const archived = await tx.payment.updateMany({
      where: { id: payment.id, version: payment.version, deletedAt: null },
      data: {
        deletedAt: new Date(),
        allocations: [] as unknown as Prisma.InputJsonValue,
        paymentHistory: [
          ...((payment.paymentHistory as unknown[]) ?? []),
          entry,
        ] as unknown as Prisma.InputJsonValue,
        version: { increment: 1 },
      },
    });
    if (archived.count === 0) {
      throw new InstallmentPaymentError(
        "This payment was changed by someone else a moment ago. Refresh and try again.",
        409,
      );
    }

    return { reversed };
  });

  const row = deletedRow;
  if (row) {
    void recordActivity({
      action: AuditAction.DELETE,
      recordType: "payment",
      recordId: paymentId,
      recordName: row.description,
      messageParams: { amount: row.amountPaid ?? row.amount },
      before: {
        status: row.status,
        amount: row.amount,
        amountPaid: row.amountPaid,
        paidDate: row.paidDate ? row.paidDate.toISOString() : null,
        paymentMethod: row.paymentMethod,
      },
      details: {
        reversed: outcome.reversed,
        leaseId: row.leaseId ?? undefined,
      },
      organizationId: row.organizationId,
    });
  }
  postAfterCommit("payment", paymentId, { userId: deletedBy ?? null });
  return outcome;
}

/**
 * Mark a payment refunded, taking its money back off the installments it paid.
 *
 * A refund used to change the payment's status and nothing else, so the
 * installment went on reading as paid with the money back in the tenant's
 * hands — and collections, the owner statement and the overdue list all
 * believed the installment.
 */
export async function refundRecordedPayment(
  paymentId: string,
  refundedBy?: string,
  gatewayRefund?: GatewayRefundRecord,
): Promise<{ reversed: PaymentAllocation[] }> {
  let refundedRow = null as {
    organizationId: string;
    description: string | null;
    status: string;
    amountPaid: number;
    leaseId: string | null;
  } | null;
  const outcome = await runWithOrgTransaction(async (tx) => {
    const payment = await tx.payment.findFirst({
      where: { id: paymentId, deletedAt: null },
    });
    if (!payment) {
      throw new InstallmentPaymentError("Payment not found", 404);
    }
    if (payment.status !== PaymentStatus.PAID) {
      throw new InstallmentPaymentError(
        "Only a completed payment can be refunded.",
        400,
      );
    }

    const reversed: PaymentAllocation[] = [];
    for (const allocation of allocationsToReverse(payment)) {
      const listed = await tx.invoice.findFirst({
        where: { id: allocation.invoiceId, paymentIds: { has: payment.id } },
        select: { id: true },
      });
      if (!listed) continue;
      await moveInstallmentMoneyTx(
        tx,
        allocation.invoiceId,
        payment.id,
        allocation.amount,
        "reverse",
      );
      reversed.push(allocation);
    }

    const entry: InstallmentPaymentEntry = {
      event: "refunded",
      amount: Number(payment.amountPaid ?? 0),
      at: new Date().toISOString(),
      by: refundedBy,
      reversed,
      ...(gatewayRefund ? { gatewayRefund } : {}),
    };
    refundedRow = {
      organizationId: payment.organizationId,
      description: payment.description,
      status: payment.status,
      amountPaid: Number(payment.amountPaid ?? 0),
      leaseId: payment.leaseId,
    };
    const updated = await tx.payment.updateMany({
      where: { id: payment.id, version: payment.version, deletedAt: null },
      data: {
        status: PaymentStatus.REFUNDED,
        allocations: [] as unknown as Prisma.InputJsonValue,
        paymentHistory: [
          ...((payment.paymentHistory as unknown[]) ?? []),
          entry,
        ] as unknown as Prisma.InputJsonValue,
        version: { increment: 1 },
      },
    });
    if (updated.count === 0) {
      throw new InstallmentPaymentError(
        "This payment was changed by someone else a moment ago. Refresh and try again.",
        409,
      );
    }
    return { reversed };
  });

  const row = refundedRow;
  if (row) {
    void recordActivity({
      action: AuditAction.PAYMENT_REFUNDED,
      recordType: "payment",
      recordId: paymentId,
      recordName: row.description,
      messageParams: { amount: row.amountPaid },
      before: { status: row.status, amountPaid: row.amountPaid },
      after: { status: PaymentStatus.REFUNDED },
      details: {
        reversed: outcome.reversed,
        leaseId: row.leaseId ?? undefined,
        ...(gatewayRefund
          ? {
              gateway: gatewayRefund.gateway,
              refundedThroughGateway: gatewayRefund.refundedNow,
              refundedEarlierAtGateway: gatewayRefund.refundedEarlier,
            }
          : {}),
      },
      organizationId: row.organizationId,
    });
  }
  postAfterCommit("payment", paymentId, { userId: refundedBy ?? null });
  return outcome;
}

/**
 * Bring a deleted payment back from the archive, re-applying what its
 * deletion took off the installments.
 *
 * Refused, rather than half-done, when an installment can no longer take the
 * money — most often because the office already recorded the corrected
 * payment. Restoring then would count the same rent twice.
 */
export async function restoreRecordedPayment(paymentId: string): Promise<void> {
  await runWithOrgTransaction(async (tx) => {
    const payment = await tx.payment.findFirst({
      where: { id: paymentId, deletedAt: { not: null } },
    });
    if (!payment) {
      throw new InstallmentPaymentError("Payment not found in the archive", 404);
    }

    const history = ((payment.paymentHistory as unknown as InstallmentPaymentEntry[]) ??
      []) as InstallmentPaymentEntry[];
    const deletion = [...history].reverse().find((item) => item?.event === "deleted");
    const toReapply = deletion?.reversed ?? [];

    for (const allocation of toReapply) {
      const invoice = await tx.invoice.findFirst({
        where: { id: allocation.invoiceId, deletedAt: null },
      });
      if (
        !invoice ||
        invoice.status === InvoiceStatus.CANCELLED ||
        invoice.balanceRemaining + 0.005 < allocation.amount
      ) {
        throw new InstallmentPaymentError(
          "The installment this payment paid has since been settled or removed. Restoring it would count the money twice.",
          409,
        );
      }
      await moveInstallmentMoneyTx(
        tx,
        allocation.invoiceId,
        payment.id,
        allocation.amount,
        "apply",
      );
    }

    const dueDate = await freeRentDueSlot(
      tx,
      payment.leaseId,
      payment.type,
      payment.dueDate,
      payment.id,
    );
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        deletedAt: null,
        dueDate,
        allocations: toReapply as unknown as Prisma.InputJsonValue,
        paymentHistory: [
          ...history,
          {
            event: "restored",
            amount: Number(payment.amountPaid ?? 0),
            at: new Date().toISOString(),
          } satisfies InstallmentPaymentEntry,
        ] as unknown as Prisma.InputJsonValue,
        version: { increment: 1 },
      },
    });
  });
  postAfterCommit("payment", paymentId);
}

/** Post a payment whose allocation changed, and the installments it touched. */
function postLinkedDocuments(result: PaymentLinkingResult, userId?: string | null): void {
  if (!result.success || !result.paymentId) return;
  postAfterCommit("payment", result.paymentId, { userId: userId ?? null });
  postAfterCommit(
    "invoice",
    result.applicationsApplied.map((application) => application.invoiceId),
  );
}

export class PaymentInvoiceLinkingService {
  private async runTransaction<T>(
    work: (session: OrgTransactionClient) => Promise<T>,
  ): Promise<T> {
    return runWithOrgTransaction(async (tx) => {
      const result = await work(tx);
      if (result === undefined) {
        throw new Error("Financial transaction completed without a result");
      }
      return result;
    });
  }

  /** Apply an existing payment to outstanding invoices, oldest first. */
  async applyPaymentToInvoices(
    paymentId: string,
    tenantId: string,
    paymentAmount: number,
    leaseId?: string,
  ): Promise<PaymentLinkingResult> {
    try {
      const normalizedAmount = normalizeAmount(paymentAmount);
      const result = await this.runTransaction((session) =>
        this.applyPaymentToInvoicesInSession(
          paymentId,
          tenantId,
          normalizedAmount,
          leaseId,
          session,
        ),
      );
      postLinkedDocuments(result);
      return result;
    } catch (error) {
      return createFailure(paymentId, paymentAmount, error);
    }
  }

  private async applyPaymentToInvoicesInSession(
    paymentId: string,
    tenantId: string,
    paymentAmount: number,
    leaseId: string | undefined,
    session: OrgTransactionClient,
  ): Promise<PaymentLinkingResult> {
    const payment = await session.payment.findFirst({
      where: {
        id: paymentId,
        tenantId,
        deletedAt: null,
        status: {
          notIn: [
            PaymentStatus.REFUNDED,
            PaymentStatus.CANCELLED,
            PaymentStatus.FAILED,
          ],
        },
      },
    });

    if (!payment) {
      throw new Error("Payment not found for this tenant");
    }

    const existingAllocations = ((payment.allocations as any[]) ?? []) as Array<{
      amount?: number;
    }>;
    const alreadyAllocated = existingAllocations.reduce(
      (total, allocation) => total + Number(allocation.amount ?? 0),
      0,
    );
    const collectibleAmount = Number(payment.amountPaid ?? payment.amount);
    const availableAmount = Math.max(0, collectibleAmount - alreadyAllocated);
    if (paymentAmount > availableAmount + 1e-7) {
      throw new Error("Requested allocation exceeds the payment's unallocated amount");
    }

    const filter: Record<string, unknown> = {
      tenantId,
      balanceRemaining: { gt: 0 },
      status: { in: ALLOCATABLE_INVOICE_STATUSES },
      deletedAt: null,
    };
    if (leaseId) filter.leaseId = leaseId;

    const outstandingInvoices = await session.invoice.findMany({
      where: filter as any,
      orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    });

    if (outstandingInvoices.length === 0) {
      throw new Error("No outstanding invoices found for this tenant");
    }

    let remainingAmount = paymentAmount;
    const applications: PaymentApplication[] = [];
    for (const invoice of outstandingInvoices) {
      if (remainingAmount <= 0) break;
      const amountToApply = normalizeAmount(
        Math.min(remainingAmount, invoice.balanceRemaining),
      );
      const application = await this.applyPaymentToSingleInvoiceInSession(
        paymentId,
        invoice.id,
        tenantId,
        amountToApply,
        session,
      );
      applications.push(application);
      remainingAmount = normalizeNonNegativeAmount(
        Math.max(0, remainingAmount - amountToApply),
      );
    }

    if (applications.length === 0) {
      throw new Error("The payment could not be allocated to an invoice");
    }

    await this.updatePaymentRecord(paymentId, applications, session);
    const totalAmountApplied = applications.reduce(
      (total, application) => total + application.amountApplied,
      0,
    );

    return {
      success: true,
      paymentId,
      totalAmountApplied,
      applicationsApplied: applications,
      remainingPaymentAmount: remainingAmount,
      errors: [],
    };
  }

  /** Apply an existing payment to one invoice atomically. */
  async applyPaymentToSingleInvoice(
    paymentId: string,
    invoiceId: string,
    amount: number,
  ): Promise<PaymentApplication> {
    const normalizedAmount = normalizeAmount(amount);
    const application = await this.runTransaction(async (session) => {
      const payment = await session.payment.findFirst({
        where: { id: paymentId, deletedAt: null },
      });
      if (!payment) throw new Error("Payment not found");

      const application = await this.applyPaymentToSingleInvoiceInSession(
        paymentId,
        invoiceId,
        payment.tenantId,
        normalizedAmount,
        session,
      );
      await this.updatePaymentRecord(paymentId, [application], session);
      return application;
    });
    postAfterCommit("payment", paymentId);
    postAfterCommit("invoice", invoiceId);
    return application;
  }

  private async applyPaymentToSingleInvoiceInSession(
    paymentId: string,
    invoiceId: string,
    tenantId: string,
    amount: number,
    session: OrgTransactionClient,
  ): Promise<PaymentApplication> {
    const invoice = await session.invoice.findFirst({
      where: {
        id: invoiceId,
        tenantId,
        NOT: { paymentIds: { has: paymentId } },
        balanceRemaining: { gte: amount },
        status: { in: ALLOCATABLE_INVOICE_STATUSES },
        deletedAt: null,
      },
    });

    if (!invoice) {
      const alreadyApplied = await session.invoice.findFirst({
        where: { id: invoiceId, paymentIds: { has: paymentId } },
        select: { id: true },
      });
      if (alreadyApplied) {
        throw new Error("This payment is already allocated to the invoice");
      }
      throw new Error("Invoice is unavailable or has insufficient balance");
    }

    // Idempotent apply + derived-state recompute (was invoice.addPayment)
    const amountPaid = normalizeAmount(invoice.amountPaid + amount);
    const derived = computeInvoiceDerivedState({ ...invoice, amountPaid });
    const balanceRemaining = normalizeNonNegativeAmount(
      Math.max(0, derived.balanceRemaining),
    );

    // Version-claimed against concurrent balance writers (see
    // applyPaymentToInvoiceTx).
    const claimed = await session.invoice.updateMany({
      where: { id: invoice.id, version: invoice.version, deletedAt: null },
      data: {
        paymentIds: [...(invoice.paymentIds ?? []), paymentId],
        amountPaid,
        subtotal: derived.subtotal,
        totalAmount: derived.totalAmount,
        balanceRemaining,
        status: derived.status,
        lastPaymentDate: new Date(),
        version: { increment: 1 },
      },
    });
    if (claimed.count === 0) {
      throw new Error("Invoice was modified by another process");
    }

    return {
      invoiceId,
      amountApplied: amount,
      remainingBalance: balanceRemaining,
      fullyPaid: balanceRemaining === 0,
    };
  }

  private async updatePaymentRecord(
    paymentId: string,
    applications: PaymentApplication[],
    session: OrgTransactionClient,
  ): Promise<void> {
    const allocations: PaymentAllocation[] = applications.map((application) => ({
      invoiceId: application.invoiceId,
      amount: application.amountApplied,
    }));
    const amountApplied = applications.reduce(
      (total, application) => total + application.amountApplied,
      0,
    );

    const payment = await session.payment.findFirst({
      where: { id: paymentId, deletedAt: null },
    });
    if (!payment) throw new Error("Payment disappeared during allocation");

    // $addToSet semantics: only append allocations not already recorded
    const existingAllocations = ((payment.allocations as any[]) ?? []) as PaymentAllocation[];
    const mergedAllocations = [...existingAllocations];
    for (const allocation of allocations) {
      const exists = mergedAllocations.some(
        (existing) =>
          String(existing.invoiceId) === allocation.invoiceId &&
          Number(existing.amount) === allocation.amount,
      );
      if (!exists) mergedAllocations.push(allocation);
    }

    const paymentHistory = [
      ...((payment.paymentHistory as any[]) ?? []),
      {
        amount: amountApplied,
        paymentMethod: PaymentMethod.OTHER,
        paidDate: new Date(),
        notes: `Applied to ${applications.length} invoice(s)`,
      },
    ];

    // Status is DERIVED from what was actually captured — this used to write
    // PAID unconditionally, silently promoting an underpaid PARTIAL
    // settlement to fully paid and hiding the shortfall from follow-up.
    const capturedCents = Math.round(Number(payment.amountPaid ?? 0) * 100);
    const dueCents = Math.round(Number(payment.amount) * 100);
    const derivedStatus =
      capturedCents > 0 && capturedCents < dueCents
        ? PaymentStatus.PARTIAL
        : PaymentStatus.PAID;

    const updated = await session.payment.updateMany({
      where: { id: paymentId, version: payment.version, deletedAt: null },
      data: {
        // Keep an already-linked invoice id; only fill it when absent.
        invoiceId: payment.invoiceId ?? allocations[0]?.invoiceId,
        status: derivedStatus,
        paidDate: payment.paidDate ?? new Date(),
        allocations: mergedAllocations as unknown as Prisma.InputJsonValue,
        paymentHistory: paymentHistory as unknown as Prisma.InputJsonValue,
        version: { increment: 1 },
      },
    });
    if (updated.count === 0) {
      throw new Error("Payment was modified during allocation");
    }
  }

  async getPaymentAllocation(
    tenantId: string,
    leaseId?: string,
  ): Promise<{
    totalOutstanding: number;
    invoices: Array<{
      invoiceId: string;
      invoiceNumber: string;
      dueDate: Date;
      totalAmount: number;
      amountPaid: number;
      balanceRemaining: number;
      status: string;
      daysOverdue: number;
    }>;
  }> {
    const filter: Record<string, unknown> = {
      tenantId,
      balanceRemaining: { gt: 0 },
      deletedAt: null,
    };
    if (leaseId) filter.leaseId = leaseId;

    const invoices = await db.invoice.findMany({
      where: filter as any,
      orderBy: [{ dueDate: "asc" }, { id: "asc" }],
    });
    const now = new Date();
    const processedInvoices = invoices.map((invoice) => ({
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      dueDate: invoice.dueDate,
      totalAmount: invoice.totalAmount,
      amountPaid: invoice.amountPaid,
      balanceRemaining: invoice.balanceRemaining,
      status: invoice.status,
      daysOverdue:
        invoice.dueDate < now
          ? Math.ceil(
              (now.getTime() - invoice.dueDate.getTime()) /
                (24 * 60 * 60 * 1000),
            )
          : 0,
    }));

    return {
      totalOutstanding: processedInvoices.reduce(
        (total, invoice) => total + invoice.balanceRemaining,
        0,
      ),
      invoices: processedInvoices,
    };
  }

  /** Create and allocate a manual payment in one transaction. */
  async recordManualPayment(data: {
    tenantId: string;
    leaseId?: string;
    amount: number;
    paymentMethod: string;
    paymentDate: Date;
    notes?: string;
    specificInvoiceId?: string;
    /** The member of staff recording it. */
    recordedBy: string;
  }): Promise<PaymentLinkingResult> {
    let paymentId = "";
    try {
      const amount = normalizeAmount(data.amount);
      const result = await this.runTransaction(async (session) => {
        const tenantId = data.tenantId;
        let propertyId: string | undefined;
        let leaseId: string | undefined;
        let organizationId: string | undefined;

        if (data.leaseId) {
          leaseId = data.leaseId;
          const lease = await session.lease.findFirst({
            where: { id: data.leaseId, deletedAt: null },
            select: {
              propertyId: true,
              organizationId: true,
              tenantId: true,
              startDate: true,
              endDate: true,
              status: true,
            },
          });
          propertyId = lease?.propertyId;
          organizationId = lease?.organizationId;

          // Guards relocated from the Mongoose Payment pre-save hook
          if (lease) {
            if (lease.tenantId !== tenantId) {
              throw new Error("Lease does not belong to the specified tenant");
            }
            if (
              data.paymentDate < new Date(lease.startDate) ||
              data.paymentDate > new Date(lease.endDate)
            ) {
              throw new Error("Payment due date must be within lease period");
            }
            if (!["active", "pending"].includes(String(lease.status))) {
              throw new Error("Cannot create payments for inactive leases");
            }
          }
        } else if (data.specificInvoiceId) {
          const invoice = await session.invoice.findFirst({
            where: {
              id: data.specificInvoiceId,
              tenantId,
              deletedAt: null,
            },
            select: { propertyId: true, leaseId: true, organizationId: true },
          });
          propertyId = invoice?.propertyId ?? undefined;
          leaseId = invoice?.leaseId ?? undefined;
          organizationId = invoice?.organizationId;
        }
        if (!propertyId || !organizationId) {
          throw new Error(
            "propertyId could not be resolved. Provide a valid lease or invoice.",
          );
        }

        const payment = await session.payment.create({
          data: {
            organizationId,
            tenantId,
            propertyId,
            leaseId: leaseId ?? null,
            amount,
            amountPaid: amount,
            type: PaymentType.RENT,
            status: PaymentStatus.PAID,
            paymentMethod: data.paymentMethod,
            dueDate: data.paymentDate,
            paidDate: data.paymentDate,
            recordedById: data.recordedBy,
            notes: data.notes ?? null,
          },
        });
        paymentId = payment.id;

        if (data.specificInvoiceId) {
          const application = await this.applyPaymentToSingleInvoiceInSession(
            payment.id,
            data.specificInvoiceId,
            tenantId,
            amount,
            session,
          );
          await this.updatePaymentRecord(payment.id, [application], session);
          return {
            success: true,
            paymentId,
            totalAmountApplied: amount,
            applicationsApplied: [application],
            remainingPaymentAmount: 0,
            errors: [],
          };
        }

        return this.applyPaymentToInvoicesInSession(
          paymentId,
          data.tenantId,
          amount,
          data.leaseId,
          session,
        );
      });
      postLinkedDocuments(result, data.recordedBy);
      return result;
    } catch (error) {
      return createFailure(paymentId, data.amount, error);
    }
  }

  /** Reverse all allocations for a payment in one transaction. */
  async reversePaymentApplication(paymentId: string): Promise<{
    success: boolean;
    reversedAmount: number;
    affectedInvoices: string[];
    errors: string[];
  }> {
    try {
      const result = await this.runTransaction(async (session) => {
        const payment = await session.payment.findFirst({
          where: { id: paymentId, deletedAt: null },
        });
        if (!payment) throw new Error("Payment not found");
        if (payment.status === PaymentStatus.REFUNDED) {
          throw new Error("Payment has already been reversed");
        }

        const allocationMap = new Map<string, number>();
        for (const allocation of ((payment.allocations as any[]) ?? []) as Array<{
          invoiceId: string;
          amount: number;
        }>) {
          const key = String(allocation.invoiceId);
          const amount = normalizeAmount(Number(allocation.amount));
          const existing = allocationMap.get(key);
          if (existing !== undefined && existing !== amount) {
            throw new Error(`Conflicting allocations exist for invoice ${key}`);
          }
          allocationMap.set(key, amount);
        }
        if (allocationMap.size === 0) {
          throw new Error("Payment has no recorded allocations to reverse safely");
        }

        const affectedInvoices: string[] = [];
        let reversedAmount = 0;
        for (const [invoiceId, amount] of allocationMap) {
          const invoice = await session.invoice.findFirst({
            where: {
              id: invoiceId,
              paymentIds: { has: payment.id },
              deletedAt: null,
            },
          });
          if (!invoice) throw new Error(`Allocated invoice ${invoiceId} was not found`);

          const paymentIds = (invoice.paymentIds ?? []).filter(
            (id) => id !== paymentId,
          );
          const amountPaid = normalizeNonNegativeAmount(
            Math.max(0, invoice.amountPaid - amount),
          );
          // Full derived-state recompute on the mutation (was pre-save hook)
          const derived = computeInvoiceDerivedState({ ...invoice, amountPaid });

          // Version-claimed against concurrent balance writers (see
          // applyPaymentToInvoiceTx).
          const reversedClaim = await session.invoice.updateMany({
            where: { id: invoice.id, version: invoice.version, deletedAt: null },
            data: {
              paymentIds,
              amountPaid,
              subtotal: derived.subtotal,
              totalAmount: derived.totalAmount,
              balanceRemaining: normalizeNonNegativeAmount(
                Math.max(0, derived.balanceRemaining),
              ),
              status: derived.status,
              version: { increment: 1 },
            },
          });
          if (reversedClaim.count === 0) {
            throw new Error("Invoice was modified by another process");
          }
          affectedInvoices.push(invoiceId);
          reversedAmount = normalizeAmount(reversedAmount + amount);
        }

        // Status transition guard (was enforced by the Mongoose pre-save hook)
        if (
          !isValidPaymentStatusTransition(
            payment.status as PaymentStatus,
            PaymentStatus.REFUNDED,
          )
        ) {
          throw new Error(
            `Invalid status transition from ${payment.status} to ${PaymentStatus.REFUNDED}`,
          );
        }

        // Optimistic concurrency on the status change. The refund is dated
        // in the payment's history, as refundRecordedPayment dates it: the
        // ledger posts the refund on that day (posting/allocations.ts).
        const history = ((payment.paymentHistory as unknown as InstallmentPaymentEntry[]) ??
          []) as InstallmentPaymentEntry[];
        const updated = await session.payment.updateMany({
          where: { id: payment.id, version: payment.version, deletedAt: null },
          data: {
            status: PaymentStatus.REFUNDED,
            notes: `${payment.notes || ""} [REVERSED]`.trim(),
            syncStatus: "pending",
            lastSyncedAt: new Date(),
            paymentHistory: [
              ...history,
              {
                event: "refunded",
                amount: reversedAmount,
                at: new Date().toISOString(),
                reversed: [...allocationMap].map(([invoiceId, amount]) => ({ invoiceId, amount })),
              } satisfies InstallmentPaymentEntry,
            ] as unknown as Prisma.InputJsonValue,
            version: { increment: 1 },
          },
        });
        if (updated.count === 0) {
          throw paymentConcurrencyConflictError();
        }

        return {
          success: true,
          reversedAmount,
          affectedInvoices,
          errors: [],
        };
      });
      postAfterCommit("payment", paymentId);
      postAfterCommit("invoice", result.affectedInvoices);
      return result;
    } catch (error) {
      return {
        success: false,
        reversedAmount: 0,
        affectedInvoices: [],
        errors: [errorMessage(error)],
      };
    }
  }
}

export const paymentInvoiceLinkingService = new PaymentInvoiceLinkingService();
