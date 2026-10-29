import { NextResponse } from "next/server";
import { z } from "zod";
import { db, runWithOrgTransaction } from "@/lib/db/prisma";
import { leaseScope } from "@/lib/db/scopes";
import { Prisma } from "@/generated/prisma/client";
import { LeaseStatus } from "@/types";
import {
  withPermissionAndDB,
  type AuthenticatedAccessUser,
} from "@/lib/api-utils";
import { MAX_MONEY, validateSchema } from "@/lib/validations";
import {
  LEASE_OVERLAP_ERROR,
  applyLeaseStatusSideEffectsTx,
  billLeaseInstallments,
  findOverlappingLease,
  resyncPropertyDerivedStatus,
} from "@/lib/services/lease-lifecycle.service";
import { LEASE_STATUS_TRANSITIONS, isLiveRenewal } from "@/lib/lease-lifecycle";
import { renewalContract, renewalStatus } from "@/lib/lease-renewal";
import { AuditAction, pickSnapshot, recordActivity } from "@/lib/audit-domain";

// Money keys are validated when present; other term keys pass through so the
// merge with the old lease's terms behaves exactly as before for valid input.
const renewTermsSchema = z
  .object({
    rentAmount: z.coerce.number().finite().min(0).optional(),
    securityDeposit: z.coerce.number().finite().min(0).optional(),
    lateFee: z.coerce.number().finite().min(0).optional(),
    petDeposit: z.coerce.number().finite().min(0).optional(),
  })
  .passthrough();

const renewLeaseSchema = z.object({
  newStartDate: z.coerce.date().optional(),
  newEndDate: z.coerce.date({
    required_error: "New end date is required",
    invalid_type_error: "Invalid new end date",
  }),
  newTerms: renewTermsSchema.optional(),
  /**
   * The rent for the whole new term. Null prices the renewal per installment
   * (`newTerms.rentAmount`, or the old rent); absent keeps the old contract's
   * basis.
   */
  newContractAmount: z.number().positive().max(MAX_MONEY).nullable().optional(),
  notes: z.string().max(2000).optional(),
  renewalType: z.string().max(100).optional(),
  /**
   * Put the new contract into force at once: it takes the unit over and its
   * installments are billed. False saves it as a draft, which is billed when
   * it is signed or activated; until then the contract being renewed stays
   * as it is and keeps the unit. On unless the caller says otherwise — a
   * renewal nobody remembers to activate is a contract nobody can collect on.
   */
  activate: z.boolean().default(true),
});

/** The lease changed status between being read and being claimed. */
class LeaseNoLongerRenewable extends Error {}

async function renewLease(
  user: AuthenticatedAccessUser,
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();

    const validation = validateSchema(renewLeaseSchema, body);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.errors.join(", ") },
        { status: 400 }
      );
    }

    const {
      newStartDate,
      newEndDate,
      newTerms,
      newContractAmount,
      notes,
      activate,
    } = validation.data;

    // 1. Find the existing lease
    // Scoped: a lease outside this caller's buildings does not resolve, so
    // the 404 below answers — the same reply an id that never existed gets.
    const oldLease = await db.lease.findFirst({
      where: { id, ...leaseScope(user) },
    });

    if (!oldLease) {
      return NextResponse.json(
        { success: false, error: "Lease not found" },
        { status: 404 }
      );
    }

    // Only a contract that may become RENEWED is renewed: one in force, or
    // one whose term has lapsed. A draft, a cancelled contract or one already
    // renewed would otherwise gain a (second) successor on the same unit.
    if (
      !LEASE_STATUS_TRANSITIONS[oldLease.status as LeaseStatus]?.includes(
        LeaseStatus.RENEWED
      )
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "Only an active or expired lease can be renewed",
        },
        { status: 409 }
      );
    }

    // One renewal at a time. A contract whose renewal is waiting as a draft
    // is still active, so the check above lets it through; renewing it again
    // would give it a second successor on the same unit. A renewal that was
    // withdrawn — cancelled or deleted as a draft — no longer counts.
    if (oldLease.renewedLeaseId) {
      const existing = await db.lease.findFirst({
        where: { id: oldLease.renewedLeaseId },
        select: { id: true, status: true, deletedAt: true },
      });
      if (isLiveRenewal(existing)) {
        return NextResponse.json(
          {
            success: false,
            error:
              "This contract already has a renewal. Open it to activate or cancel it.",
            code: "RENEWAL_EXISTS",
          },
          { status: 409 }
        );
      }
    }

    // 2. Create the new lease object
    // Default start date is day after old end date
    const defaultStartDate = new Date(oldLease.endDate);
    defaultStartDate.setDate(defaultStartDate.getDate() + 1);

    const startDate = newStartDate ? new Date(newStartDate) : defaultStartDate;
    const endDate = new Date(newEndDate);

    // A term that ends before it starts has no installments to divide a
    // total over, and would be a nonsense contract anyway.
    if (endDate <= startDate) {
      return NextResponse.json(
        { success: false, error: "End date must be after start date" },
        { status: 400 }
      );
    }

    // Overlap guard (was the Lease pre-save hook): no other active/pending
    // lease on the same unit may intersect the renewal period.
    const overlappingLease = await findOverlappingLease({
      propertyId: oldLease.propertyId,
      unitId: oldLease.unitId,
      startDate,
      endDate,
    });

    if (overlappingLease) {
      return NextResponse.json(
        { success: false, error: LEASE_OVERLAP_ERROR },
        { status: 400 }
      );
    }

    // 3. What the new lease carries over
    // Frequency, tax, utilities and the rent (or total) carry over unless the
    // renewal dialog changed them.
    const contract = renewalContract(
      oldLease,
      { startDate, endDate },
      {
        contractAmount: newContractAmount,
        rentAmount: newTerms?.rentAmount,
        securityDeposit: newTerms?.securityDeposit,
      },
    );

    // In force at once, or a draft for review/signing — the dialog's choice.
    // (`validateSchema` types a defaulted field by its input, hence the `??`.)
    const status = renewalStatus(activate ?? true);

    // The database allows one active lease per unit. The lease being renewed
    // steps aside in the same write (below), so only ANOTHER active lease on
    // the unit can stand in the way of activating its successor.
    if (status === LeaseStatus.ACTIVE) {
      const holder = await db.lease.findFirst({
        where: {
          unitId: oldLease.unitId,
          status: LeaseStatus.ACTIVE,
          id: { not: oldLease.id },
        },
        select: { id: true },
      });
      if (holder) {
        return NextResponse.json(
          {
            success: false,
            error:
              "Another active lease already holds this unit. Renew without activating, or end that lease first.",
          },
          { status: 409 }
        );
      }
    }

    // 4. Hand over, atomically. Activated at once, the old lease becomes
    // RENEWED, its successor is created, and the unit passes to it. Saved as
    // a draft, the successor is created and the old lease only points at it:
    // it stays in force and keeps the unit until the draft is signed or
    // activated, which is when it steps aside (see changeLeaseStatus). It
    // used to become RENEWED at once either way, and a draft that was never
    // activated left the unit occupied by a contract no longer in force.
    const { updatedOldLease, newLease } = await runWithOrgTransaction(
      async (tx) => {
        // Activating: the old lease steps aside FIRST, since
        // leases_one_active_per_unit would refuse an active successor while
        // its predecessor is still active. Either way it is claimed by the
        // state it was read in. Two renewals of one lease — a double submit —
        // both pass the checks above, and the second must find nothing left
        // to claim rather than give the lease a second successor.
        if (status === LeaseStatus.ACTIVE) {
          const claimed = await tx.lease.updateMany({
            where: {
              id: oldLease.id,
              status: oldLease.status,
              renewedLeaseId: oldLease.renewedLeaseId,
              deletedAt: null,
            },
            data: { status: LeaseStatus.RENEWED },
          });
          if (claimed.count === 0) {
            throw new LeaseNoLongerRenewable();
          }
        }

        const created = await tx.lease.create({
          data: {
            organizationId: oldLease.organizationId,
            propertyId: oldLease.propertyId,
            unitId: oldLease.unitId,
            tenantId: oldLease.tenantId,
            startDate,
            endDate,
            status,
            // Activated by the office rather than signed by the tenant: the
            // same stamp the status changer gives an unsigned contract.
            ...(status === LeaseStatus.ACTIVE
              ? { signedDate: new Date() }
              : {}),
            ...contract,
            terms: {
              ...((oldLease.terms as any) ?? {}),
              // Override with new terms if provided
              ...(newTerms || {}),
              // The JSON mirror follows the columns, as on every write path.
              rentAmount: contract.rentAmount,
              securityDeposit: contract.securityDepositAmount,
            } as Prisma.InputJsonValue,
            parentLeaseId: oldLease.id,
            paymentStatus: "pending",
            documents: [], // Don't copy signed docs
            renewalOptions: {
              available: true,
            } as Prisma.InputJsonValue,
            notes: notes || `Renewed from lease ${oldLease.id}`,
          },
        });

        // The old lease names its successor. For a draft this write is the
        // claim: it only lands if the lease is as it was read.
        const linked = await tx.lease.updateMany({
          where: {
            id: oldLease.id,
            renewedLeaseId:
              status === LeaseStatus.ACTIVE ? undefined : oldLease.renewedLeaseId,
            status:
              status === LeaseStatus.ACTIVE
                ? LeaseStatus.RENEWED
                : oldLease.status,
            deletedAt: null,
          },
          data: { renewedLeaseId: created.id },
        });
        if (linked.count === 0) {
          throw new LeaseNoLongerRenewable();
        }
        const renewed = await tx.lease.findFirst({ where: { id: oldLease.id } });

        // An active successor occupies the unit in its own name. A draft
        // holds no unit, like any draft: the unit stays with the contract it
        // renews and passes to the successor when that is signed or activated.
        await applyLeaseStatusSideEffectsTx(tx, created, {
          statusChanged: true,
        });

        return { updatedOldLease: renewed, newLease: created };
      }
    );

    if (newLease.status === LeaseStatus.ACTIVE) {
      // Property derived status is recomputable — refreshed best-effort.
      await resyncPropertyDerivedStatus(oldLease.propertyId);
    }

    // A successor in force is billed like any contract that comes into
    // force; a draft comes back null and is billed when it becomes active.
    // The renewal itself has committed by now, so a billing failure is
    // reported in `invoiceGeneration.errors`, not thrown.
    const invoiceGeneration = await billLeaseInstallments(newLease);

    // One entry for the renewal, on the contract that was renewed, naming the
    // contract that follows it and the terms it carries.
    void recordActivity({
      action: AuditAction.RENEW,
      recordType: "lease",
      recordId: oldLease.id,
      recordName: oldLease.contractNumber,
      before: pickSnapshot(oldLease as unknown as Record<string, unknown>, [
        "status",
        "startDate",
        "endDate",
        "rentAmount",
        "contractAmount",
      ]),
      after: pickSnapshot(newLease as unknown as Record<string, unknown>, [
        "status",
        "startDate",
        "endDate",
        "rentAmount",
        "contractAmount",
      ]),
      details: {
        renewalLeaseId: newLease.id,
        renewalContractNumber: newLease.contractNumber ?? undefined,
        installmentsGenerated: invoiceGeneration?.invoicesGenerated,
      },
    });

    return NextResponse.json({
      success: true,
      message: "Lease renewed successfully",
      data: {
        oldLease: updatedOldLease,
        newLease,
        invoiceGeneration,
      },
    });
  } catch (error: any) {
    if (error instanceof LeaseNoLongerRenewable) {
      return NextResponse.json(
        {
          success: false,
          error: "This lease has just been changed. Reload it and try again.",
        },
        { status: 409 }
      );
    }
    console.error("Error renewing lease:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

export const POST = withPermissionAndDB([
  "lease_management",
  "lease_edit",
])(
  async (user: AuthenticatedAccessUser, request: Request, context: any) =>
    renewLease(user, request, context),
);
