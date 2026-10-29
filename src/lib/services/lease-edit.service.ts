/**
 * PropertyPro - What an edit of a contract writes, and what it must pass
 *
 * Shared by the contract's edit (PUT /api/leases/[id]) and its amendment
 * (POST /api/leases/[id]/amend), so a contract amended after billing is
 * checked and written exactly as one edited before it.
 */

import { db } from "@/lib/db/prisma";
import { propertyScope, withScope } from "@/lib/db/scopes";
import type { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { leaseUpdateSchema } from "@/lib/validations";
import { isLeaseTenantCandidate } from "@/lib/lease-access";
import {
  LEASE_OVERLAP_ERROR,
  findOverlappingLease,
} from "@/lib/services/lease-lifecycle.service";
import {
  contractInstallmentShare,
  normalizeFrequency,
} from "@/lib/lease-installments";
import { leaseContractAmount } from "@/lib/lease-money";
import type { ScopeActor } from "@/lib/db/scopes";

/** The contract as stored — what an edit is checked and merged against. */
export interface EditableLease {
  id: string;
  propertyId: string;
  unitId: string;
  tenantId: string;
  startDate: Date;
  endDate: Date;
  paymentFrequency: string | null;
  taxEnabled: boolean;
  contractAmount?: unknown;
  terms: unknown;
}

/** A validated edit (leaseUpdateSchema's output); absent means "not sent". */
export type LeaseEdit = z.infer<typeof leaseUpdateSchema>;

export interface LeaseEditRefusal {
  message: string;
  status: number;
}

/** Where the contract is after the edit, and what moved. */
export function editPlacement(lease: EditableLease, edit: LeaseEdit) {
  const propertyId: string = edit.propertyId || lease.propertyId;
  const unitId: string = edit.unitId || lease.unitId;
  const tenantId: string = edit.tenantId || lease.tenantId;
  return {
    propertyId,
    unitId,
    tenantId,
    startDate: (edit.startDate as Date | undefined) || lease.startDate,
    endDate: (edit.endDate as Date | undefined) || lease.endDate,
    movesProperty: propertyId !== lease.propertyId,
    movesUnit: unitId !== lease.unitId,
    movesTenant: tenantId !== lease.tenantId,
  };
}

/**
 * The checks an edit has to pass whatever the contract's state: its dates
 * make a term, the building, unit and tenant it names exist and are the
 * caller's to use, the unit is free for those dates, and the contract
 * number is not another contract's. Null when the edit may go ahead.
 */
export async function checkLeaseEdit(
  user: ScopeActor,
  lease: EditableLease,
  edit: LeaseEdit,
): Promise<LeaseEditRefusal | null> {
  if (edit.startDate && edit.endDate && edit.endDate <= edit.startDate) {
    return { message: "End date must be after start date", status: 400 };
  }

  const placement = editPlacement(lease, edit);

  // The building, unit and tenant come from the request, so each is
  // checked the way creating a contract checks them. The building went
  // unchecked here: any building's id moved the contract there, including
  // one this caller was never given.
  if (placement.movesProperty) {
    const property = await db.property.findFirst({
      where: withScope({ id: placement.propertyId }, propertyScope(user)),
      select: { id: true },
    });
    if (!property) return { message: "Property not found", status: 404 };
  }
  if (placement.movesProperty || placement.movesUnit) {
    const unit = await db.unit.findFirst({
      where: { id: placement.unitId, propertyId: placement.propertyId },
      select: { id: true },
    });
    if (!unit) {
      return { message: "Unit not found in this property", status: 404 };
    }
  }
  if (
    placement.movesTenant &&
    !(await isLeaseTenantCandidate(placement.tenantId))
  ) {
    return { message: "Tenant not found", status: 404 };
  }

  // Unit-level overlap guard (was the Lease pre-save hook): applies when
  // dates, property, or unit change. (A property-wide overlap check used
  // to run here first — with no unitId filter it collided with OTHER
  // units' leases, making any date edit in an occupied multi-unit
  // property impossible. The unit-level check below is the correct one.)
  if (
    edit.startDate ||
    edit.endDate ||
    placement.movesProperty ||
    placement.movesUnit
  ) {
    const unitOverlap = await findOverlappingLease({
      propertyId: placement.propertyId,
      unitId: placement.unitId,
      startDate: placement.startDate,
      endDate: placement.endDate,
      excludeLeaseId: lease.id,
    });
    if (unitOverlap) return { message: LEASE_OVERLAP_ERROR, status: 400 };
  }

  // The contract number is unique per organization when set.
  if (edit.contractNumber) {
    const clash = await db.lease.findFirst({
      where: {
        contractNumber: edit.contractNumber.trim(),
        deletedAt: null,
        id: { not: lease.id },
      },
      select: { id: true },
    });
    if (clash) {
      return {
        message: "Another contract already uses this contract number",
        status: 409,
      };
    }
  }

  return null;
}

/**
 * The columns an edit writes. Plain columns, foreign keys included, so the
 * same payload can go through a status change in one statement.
 */
export function leaseUpdateData(
  lease: EditableLease,
  edit: LeaseEdit,
): Prisma.LeaseUncheckedUpdateManyInput {
  const placement = editPlacement(lease, edit);
  const data: Prisma.LeaseUncheckedUpdateManyInput = {};
  if (edit.contractNumber !== undefined) {
    data.contractNumber = edit.contractNumber?.trim() || null;
  }
  if (edit.paymentFrequency !== undefined) {
    data.paymentFrequency = edit.paymentFrequency;
  }
  if (edit.electricityAmount !== undefined) {
    data.electricityAmount = edit.electricityAmount;
  }
  if (edit.waterAmount !== undefined) {
    data.waterAmount = edit.waterAmount;
  }
  if (edit.taxEnabled !== undefined) {
    data.taxEnabled = edit.taxEnabled;
    // Turning tax off clears the rate so it cannot silently reapply later.
    if (!edit.taxEnabled) data.taxRate = 0;
  }
  if (edit.taxRate !== undefined) {
    const taxOn = edit.taxEnabled ?? lease.taxEnabled;
    data.taxRate = taxOn ? edit.taxRate : 0;
  }
  if (placement.movesProperty) data.propertyId = placement.propertyId;
  if (placement.movesUnit) data.unitId = placement.unitId;
  if (placement.movesTenant) data.tenantId = placement.tenantId;
  if (edit.startDate) data.startDate = edit.startDate;
  if (edit.endDate) data.endDate = edit.endDate;
  if (edit.documents !== undefined) data.documents = edit.documents;
  if (edit.notes !== undefined) data.notes = edit.notes;
  if (edit.renewalOptions !== undefined) {
    data.renewalOptions = edit.renewalOptions as Prisma.InputJsonValue;
  }
  if (edit.terms !== undefined) {
    const mergedTerms: Record<string, unknown> = {
      ...((lease.terms as Record<string, unknown>) ?? {}),
      ...edit.terms,
    };
    data.terms = mergedTerms as Prisma.InputJsonValue;
    // Keep the authoritative money columns in step with the JSON mirror.
    if (mergedTerms.rentAmount !== undefined) {
      data.rentAmount = Number(mergedTerms.rentAmount) || 0;
    }
    if (mergedTerms.securityDeposit !== undefined) {
      data.securityDepositAmount = Number(mergedTerms.securityDeposit) || 0;
    }
  }

  // A contract written as a total: null switches it back to rent per
  // installment (taken from `terms` above), a number sets a new total.
  if (edit.contractAmount !== undefined) {
    data.contractAmount = edit.contractAmount;
  }
  const contractAmount =
    edit.contractAmount !== undefined
      ? edit.contractAmount
      : leaseContractAmount(lease);
  if (contractAmount !== null) {
    // The stored rent is the regular share of the total over the term as
    // it now stands, so it follows a change of total, dates or cycle.
    const rentAmount = contractInstallmentShare({
      startDate: placement.startDate,
      endDate: placement.endDate,
      frequency: normalizeFrequency(
        edit.paymentFrequency ?? lease.paymentFrequency,
      ),
      contractAmount,
    });
    data.rentAmount = rentAmount;
    data.terms = {
      ...((data.terms ?? lease.terms) as Record<string, unknown>),
      rentAmount,
    } as Prisma.InputJsonValue;
  }

  return data;
}
