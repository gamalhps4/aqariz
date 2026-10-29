/**
 * PropertyPro - Creating a lease contract
 *
 * What POST /api/leases does with a body that has passed `leaseSchema`,
 * lifted out of the route unchanged so the spreadsheet import creates a
 * contract exactly as an office does on the form: the same building scope,
 * the same unit and tenant checks, the same overlap guard and contract-number
 * rule, the same plan limit, the rent worked out from a contract total the
 * same way, and the same occupancy and billing once the contract is active.
 * A second, hand-written path is how an imported contract ends up with no
 * installments, or with a unit that still reads as available.
 *
 * The route keeps what belongs to a request — parsing and validating the
 * body, the response's shape, the audit entry — and turns a
 * `LeaseCreationError` into the same status and message it always sent.
 */

import { db } from "@/lib/db/prisma";
import type { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { LeaseStatus } from "@/types";
import { enforcePlanLimit } from "@/lib/billing/entitlements";
import { countLeases } from "@/lib/billing/usage";
import { propertyScope, withScope, type ScopeActor } from "@/lib/db/scopes";
import { isLeaseTenantCandidate } from "@/lib/lease-access";
import {
  applyLeaseStatusSideEffects,
  findOverlappingLease,
} from "@/lib/services/lease-lifecycle.service";
import { contractInstallmentShare } from "@/lib/lease-installments";
import { cancellationRecord } from "@/lib/lease-lifecycle";
import type { leaseSchema } from "@/lib/validations";

/** A body `leaseSchema` has accepted — its dates already Dates. */
export type LeaseCreateInput = z.output<typeof leaseSchema>;

/** Who is creating it: the scope it is checked against, and its office. */
export interface LeaseCreator extends ScopeActor {
  organizationId?: string | null;
}

/**
 * A contract refused before anything was written, with the status the route
 * answers with. `code` names the refusal for callers that say it in the
 * reader's language (the import screen's `import.issue.<code>`).
 */
export class LeaseCreationError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(message: string, statusCode: number, code: string) {
    super(message);
    this.name = "LeaseCreationError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

/**
 * Every check the route makes before it writes, in the route's order, with
 * its messages. Read-only, so the import's check of a file can ask it of
 * every row without creating anything. The plan limit is not here: a single
 * contract asks it in `createLease`, a file asks it once for all its rows.
 */
export async function checkLeaseCreation(
  actor: LeaseCreator,
  leaseData: LeaseCreateInput,
): Promise<void> {
  // Verify property exists and unit is available
  // Scoped: a contract cannot be created against a building this
  // caller was not given.
  const property = await db.property.findFirst({
    where: withScope({ id: leaseData.propertyId }, propertyScope(actor)),
  });
  if (!property) {
    throw new LeaseCreationError("Property not found", 404, "propertyNotFound");
  }

  // Verify the specific unit exists and is available
  const unit = await db.unit.findFirst({
    where: { id: leaseData.unitId, propertyId: leaseData.propertyId },
  });

  if (!unit) {
    throw new LeaseCreationError(
      "Unit not found in this property",
      404,
      "unitNotFound",
    );
  }

  if (unit.status !== "available") {
    throw new LeaseCreationError(
      "Unit is not available for lease",
      400,
      "unitNotAvailable",
    );
  }

  // Verify tenant exists and is approved
  const tenant = await db.user.findFirst({
    where: { id: leaseData.tenantId },
    select: { id: true, tenantStatus: true, role: true },
  });
  if (!tenant || !(await isLeaseTenantCandidate(leaseData.tenantId))) {
    throw new LeaseCreationError("Tenant not found", 404, "tenantNotFound");
  }

  // Check tenant status - tenant must be approved or active to create a lease
  if (
    !tenant.tenantStatus ||
    !["approved", "active"].includes(tenant.tenantStatus)
  ) {
    throw new LeaseCreationError(
      "Tenant must be approved before creating a lease",
      400,
      "tenantNotApproved",
    );
  }

  // Check for overlapping leases for the specific unit
  const overlappingLease = await findOverlappingLease({
    propertyId: leaseData.propertyId,
    unitId: leaseData.unitId,
    startDate: leaseData.startDate,
    endDate: leaseData.endDate,
  });

  if (overlappingLease) {
    throw new LeaseCreationError(
      "Lease dates overlap with existing lease for this unit",
      409,
      "leaseOverlap",
    );
  }

  // The electronic contract number identifies one lease inside the
  // organization; a friendly 409 beats the unique-index 500.
  const contractNumber = leaseData.contractNumber?.trim() || null;
  if (contractNumber) {
    const clash = await db.lease.findFirst({
      where: { contractNumber, deletedAt: null },
      select: { id: true },
    });
    if (clash) {
      throw new LeaseCreationError(
        "Another contract already uses this contract number",
        409,
        "contractNumberTaken",
      );
    }
  }
}

/**
 * Check, then create the contract and — when it is created active — occupy
 * its unit and bill it. Returns the row as written and what billing did.
 * Throws `LeaseCreationError` for a refusal, and the plan limit's own error
 * (402) when the package is full.
 */
export async function createLease(actor: LeaseCreator, leaseData: LeaseCreateInput) {
  await checkLeaseCreation(actor, leaseData);

  // Create the lease
  const createTerms = (leaseData.terms ?? {}) as Record<string, unknown>;
  const contractNumber = leaseData.contractNumber?.trim() || null;

  await enforcePlanLimit(
    actor.organizationId!,
    "leases",
    await countLeases(),
  );

  const paymentFrequency = leaseData.paymentFrequency ?? "monthly";
  const contractAmount: number | null = leaseData.contractAmount ?? null;
  // A contract written as a total stores its regular installment as the
  // rent. Worked out here from the total, not taken from the form, so the
  // two columns can never describe different schedules.
  const rentAmount =
    contractAmount !== null
      ? contractInstallmentShare({
          startDate: leaseData.startDate,
          endDate: leaseData.endDate,
          frequency: paymentFrequency,
          contractAmount,
        })
      : Number(createTerms.rentAmount) || 0;

  const created = await db.lease.create({
    data: {
      organizationId: actor.organizationId!,
      propertyId: leaseData.propertyId,
      unitId: leaseData.unitId,
      tenantId: leaseData.tenantId,
      startDate: leaseData.startDate,
      endDate: leaseData.endDate,
      status: leaseData.status || LeaseStatus.DRAFT,
      // A contract entered already cancelled is a cancellation like any
      // other: it says when and by whom, or the Cancelled register —
      // which filters on that date — cannot place it.
      ...(leaseData.status === LeaseStatus.TERMINATED
        ? cancellationRecord({ previousStatus: null, userId: actor.id })
        : {}),
      contractNumber,
      paymentFrequency,
      contractAmount,
      electricityAmount: leaseData.electricityAmount ?? 0,
      waterAmount: leaseData.waterAmount ?? 0,
      taxEnabled: leaseData.taxEnabled ?? false,
      // A rate is meaningless while tax is off; storing 0 keeps the row
      // honest instead of leaving a stale percentage that would apply the
      // moment someone flips the toggle.
      taxRate: leaseData.taxEnabled ? (leaseData.taxRate ?? 0) : 0,
      // Money as real columns — authoritative and queryable; the terms
      // JSON keeps a mirror for legacy readers.
      rentAmount,
      securityDepositAmount: Number(createTerms.securityDeposit) || 0,
      terms: { ...createTerms, rentAmount } as Prisma.InputJsonValue,
      documents: leaseData.documents ?? [],
      renewalOptions: (leaseData.renewalOptions ?? {
        available: false,
      }) as Prisma.InputJsonValue,
      notes: leaseData.notes,
    },
  });

  // An active lease occupies its unit (the property's state is resynced
  // with it) and is billed at once: its installments, plus the deposit a
  // brand-new contract asks for. Billing no longer waits on the form's
  // auto-generate switch — a contract created with it off was active with
  // a schedule nobody could collect against — and whatever could not be
  // billed comes back in `invoiceGeneration.errors` instead of being
  // dropped here.
  let invoiceGeneration = null;
  if (created.status === LeaseStatus.ACTIVE) {
    const paymentConfig = (
      created.terms as {
        paymentConfig?: {
          lateFeeConfig?: { gracePeriodDays?: number };
          autoEmailInvoices?: boolean;
        };
      } | null
    )?.paymentConfig;
    // Created in force counts as arriving in force (the default), which
    // is what bills it; nothing in the unit sync depends on the flag.
    invoiceGeneration = await applyLeaseStatusSideEffects(created, {
      billing: {
        generateSecurityDeposit: true,
        gracePeriodDays: paymentConfig?.lateFeeConfig?.gracePeriodDays || 5,
        autoEmail: paymentConfig?.autoEmailInvoices || false,
      },
    });
  }

  return { lease: created, invoiceGeneration };
}
