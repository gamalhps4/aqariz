/**
 * PropertyPro - Amend a contract whose installments are billed
 *
 * Reads what the amendment needs, asks lib/lease-amendment.ts what to keep,
 * cancel and bill again, and — once the operator has confirmed the preview
 * they were shown — writes it: the unpaid installments cancelled and their
 * periods released, the contract's terms changed, both in one transaction;
 * then the new installments billed by the same generator that bills every
 * contract, and the books brought in line.
 */

import { randomUUID } from "node:crypto";
import { db, runWithOrgTransaction } from "@/lib/db/prisma";
import { Prisma } from "@/generated/prisma/client";
import { InvoiceStatus, InvoiceType, LeaseStatus, PaymentStatus } from "@/types";
import type { ScopeActor } from "@/lib/db/scopes";
import { postAfterCommit } from "@/lib/accounting/hooks";
import { AuditAction, auditRecordChange } from "@/lib/audit-domain";
import { changedTerms } from "@/lib/lease-term-edits";
import {
  planAmendment,
  previewOf,
  type AmendableInstallment,
  type AmendmentPreview,
} from "@/lib/lease-amendment";
import {
  checkLeaseEdit,
  editPlacement,
  leaseUpdateData,
  type EditableLease,
  type LeaseEdit,
} from "@/lib/services/lease-edit.service";
import {
  billLeaseInstallments,
  moveLeasePlacementTx,
  resyncPropertyDerivedStatus,
} from "@/lib/services/lease-lifecycle.service";

/** A refusal the route answers with: the message, its status, the preview. */
export class LeaseAmendmentError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly preview?: AmendmentPreview,
  ) {
    super(message);
    this.name = "LeaseAmendmentError";
  }
}

export interface AmendableLease extends EditableLease {
  status: string;
  contractNumber: string | null;
}

export interface AmendmentResult {
  preview: AmendmentPreview;
  /** Present once the amendment is written. */
  applied?: {
    cancelled: number;
    billed: number;
    errors: string[];
  };
}

type Reader = Pick<typeof db, "invoice" | "securityDeposit" | "payment">;

/** The rent an installment bills: its rent lines, utilities and tax apart. */
function rentOf(lineItems: unknown, subtotal: number): number {
  if (!Array.isArray(lineItems)) return subtotal;
  const rent = lineItems
    .filter((line) => (line as { type?: unknown })?.type === InvoiceType.RENT)
    .reduce((total, line) => total + (Number((line as { amount?: unknown }).amount) || 0), 0);
  return Math.round(rent * 100) / 100;
}

function periodEndOf(lineItems: unknown): string | null {
  if (!Array.isArray(lineItems)) return null;
  const end = (lineItems[0] as { periodEnd?: unknown } | undefined)?.periodEnd;
  return typeof end === "string" || end instanceof Date ? new Date(end).toISOString() : null;
}

/** The contract's billed rent installments, and whether money is held on it. */
async function readFacts(client: Reader, leaseId: string) {
  const [rows, deposit, depositInvoice, payment] = await Promise.all([
    client.invoice.findMany({
      where: {
        leaseId,
        category: InvoiceType.RENT,
        periodStart: { not: null },
        deletedAt: null,
        status: { not: InvoiceStatus.CANCELLED },
      },
      select: {
        id: true,
        invoiceNumber: true,
        periodStart: true,
        dueDate: true,
        subtotal: true,
        totalAmount: true,
        amountPaid: true,
        lineItems: true,
      },
      orderBy: { periodStart: "asc" },
    }),
    client.securityDeposit.findFirst({
      where: { leaseId, deletedAt: null },
      select: { id: true },
    }),
    client.invoice.findFirst({
      where: {
        leaseId,
        category: InvoiceType.SECURITY_DEPOSIT,
        deletedAt: null,
        status: { not: InvoiceStatus.CANCELLED },
      },
      select: { id: true },
    }),
    client.payment.findFirst({
      where: {
        leaseId,
        deletedAt: null,
        OR: [
          { status: { in: [PaymentStatus.PAID, PaymentStatus.PARTIAL] } },
          { amountPaid: { gt: 0 } },
        ],
      },
      select: { id: true },
    }),
  ]);

  const installments: AmendableInstallment[] = rows.map((row) => ({
    id: row.id,
    invoiceNumber: row.invoiceNumber,
    periodStart: row.periodStart!,
    periodEnd: periodEndOf(row.lineItems),
    dueDate: row.dueDate,
    totalAmount: Number(row.totalAmount),
    amountPaid: Number(row.amountPaid),
    rentAmount: rentOf(row.lineItems, Number(row.subtotal)),
  }));

  return {
    installments,
    depositBilled: Boolean(deposit || depositInvoice),
    moneyHeld:
      Boolean(payment) || installments.some((row) => row.amountPaid > 0),
  };
}

/**
 * Which kind of amendment the contract allows now: a correction while no
 * money has come in on it, an amendment once some has. The edit form reads
 * it to know whether the building, unit and tenant may still change.
 */
export async function amendmentLevelOf(
  leaseId: string,
): Promise<AmendmentPreview["level"]> {
  const { moneyHeld } = await readFacts(db, leaseId);
  return moneyHeld ? "amendment" : "correction";
}

/**
 * Preview an amendment, or — with `apply` and the fingerprint of the preview
 * the operator confirmed — write it.
 */
export async function amendLease(input: {
  user: ScopeActor & { id: string };
  lease: AmendableLease;
  edit: LeaseEdit;
  apply: boolean;
  reason?: string;
  fingerprint?: string;
}): Promise<AmendmentResult> {
  const { user, lease, edit } = input;

  if (lease.status !== LeaseStatus.ACTIVE) {
    throw new LeaseAmendmentError(
      "Only a contract in force is amended. Edit a draft directly.",
      409,
      "NOT_AMENDABLE",
    );
  }

  const refusal = await checkLeaseEdit(user, lease, edit);
  if (refusal) {
    throw new LeaseAmendmentError(refusal.message, refusal.status, "INVALID_EDIT");
  }

  const changed = changedTerms(lease, edit);
  const data = leaseUpdateData(lease, edit);
  const amended = { ...lease, ...data } as EditableLease & Record<string, unknown>;

  const facts = await readFacts(db, lease.id);
  const plan = planAmendment({ amended, changed, ...facts });
  const preview = previewOf(plan);

  if (!input.apply) return { preview };

  if (plan.problems.length > 0) {
    throw new LeaseAmendmentError(
      "This amendment cannot be made as it stands.",
      409,
      "AMENDMENT_REFUSED",
      preview,
    );
  }
  if (input.fingerprint !== plan.fingerprint) {
    throw new LeaseAmendmentError(
      "The contract's installments changed since this preview. Review the amendment again.",
      409,
      "AMENDMENT_STALE",
      preview,
    );
  }

  const amendmentId = randomUUID();
  const record = {
    id: amendmentId,
    at: new Date().toISOString(),
    by: user.id,
    reason: input.reason ?? "",
    level: plan.level,
    changed: plan.changed,
    kept: plan.keep.length,
    cancelled: plan.cancel.length,
    billed: plan.create.length,
    before: plan.totals.before,
    after: plan.totals.after,
  };

  const currentTerms = ((data.terms ?? lease.terms) ?? {}) as Record<string, unknown>;
  const previous = (currentTerms.amendment ?? {}) as { history?: unknown };
  const history = Array.isArray(previous.history) ? previous.history : [];
  data.terms = {
    ...currentTerms,
    amendment: { kept: plan.kept, history: [...history, record] },
  } as Prisma.InputJsonValue;
  // A contract written as a total stores its regular installment; once paid
  // installments are kept, that is the share of what is left.
  if (plan.kept && plan.create.length > 0) {
    data.rentAmount = plan.create[0].rentAmount;
    data.terms = {
      ...(data.terms as Record<string, unknown>),
      rentAmount: plan.create[0].rentAmount,
    } as Prisma.InputJsonValue;
  }

  const cancelIds = plan.cancel.map((installment) => installment.id);
  const placement = editPlacement(lease, edit);

  const updated = await runWithOrgTransaction(async (tx) => {
    // Read again under the transaction: what is cancelled is exactly what
    // the operator was shown, or nothing is.
    const now = await readFacts(tx, lease.id);
    const again = planAmendment({ amended, changed, ...now });
    if (again.fingerprint !== plan.fingerprint) {
      throw new LeaseAmendmentError(
        "The contract's installments changed since this preview. Review the amendment again.",
        409,
        "AMENDMENT_STALE",
        previewOf(again),
      );
    }

    if (cancelIds.length > 0) {
      // One statement, so a long schedule cannot run the transaction out of
      // time. The period is released (the unique index on a contract's
      // periods would refuse the new installment) and kept in the metadata,
      // with the amendment that replaced it.
      const cancelled = await tx.$executeRaw`
        UPDATE invoices
        SET status = ${InvoiceStatus.CANCELLED},
            "balanceRemaining" = 0,
            metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
              'supersededByAmendment', ${amendmentId}::text,
              'supersededPeriodStart', "periodStart"
            ),
            "periodStart" = NULL,
            version = version + 1,
            "updatedAt" = NOW()
        WHERE id IN (${Prisma.join(cancelIds)})
          AND "amountPaid" = 0
          AND status <> ${InvoiceStatus.CANCELLED}
          AND "deletedAt" IS NULL
      `;
      if (cancelled !== cancelIds.length) {
        throw new LeaseAmendmentError(
          "The contract's installments changed since this preview. Review the amendment again.",
          409,
          "AMENDMENT_STALE",
        );
      }
    }

    const row = await tx.lease.update({ where: { id: lease.id }, data });
    if (placement.movesUnit || placement.movesTenant || placement.movesProperty) {
      await moveLeasePlacementTx(tx, lease, row);
    }
    return row;
  });

  postAfterCommit("invoice", cancelIds, { userId: user.id });

  // Billed by the generator every contract uses: the released periods are
  // unbilled again, and the amended terms price them.
  const generation = await billLeaseInstallments(updated);
  if (generation?.invoiceIds.length) {
    postAfterCommit("invoice", generation.invoiceIds, { userId: user.id });
  }

  if (placement.movesProperty || placement.movesUnit) {
    void resyncPropertyDerivedStatus(lease.propertyId);
    if (placement.movesProperty) void resyncPropertyDerivedStatus(placement.propertyId);
  }

  auditRecordChange({
    action: AuditAction.UPDATE,
    recordType: "lease",
    recordId: lease.id,
    recordName: updated.contractNumber ?? lease.contractNumber,
    before: lease as unknown as Record<string, unknown>,
    after: { ...lease, ...data } as Record<string, unknown>,
    keys: Object.keys(data).filter((key) => key !== "terms"),
    details: { amendment: record },
  });

  return {
    preview,
    applied: {
      cancelled: cancelIds.length,
      billed: generation?.invoicesGenerated ?? 0,
      errors: generation?.errors ?? [],
    },
  };
}
