/**
 * PropertyPro - Individual Lease API Routes
 * CRUD operations for individual leases
 */

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import { leaseAllows, leaseScope } from "@/lib/db/scopes";
import { Prisma } from "@/generated/prisma/client";
import { LeaseStatus } from "@/types";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  withAccessAndDB,
  withPermissionAndDB,
  parseRequestBody,
  isValidObjectId,
} from "@/lib/api-utils";
import {
  leaseUpdateSchema,
  validateSchema,
} from "@/lib/validations";
import {
  LEASE_PATCH_ACCESS,
  LEASE_READ_ACCESS,
  canManageLeases,
} from "@/lib/lease-access";
import {
  changeLeaseStatus,
  unhookWithdrawnRenewals,
} from "@/lib/services/lease-lifecycle.service";
import {
  checkLeaseEdit,
  editPlacement,
  leaseUpdateData,
} from "@/lib/services/lease-edit.service";
import { amendmentLevelOf } from "@/lib/services/lease-amendment.service";
import { cancellationRecord } from "@/lib/lease-lifecycle";
import { changedTerms, lockedTermsMessage } from "@/lib/lease-term-edits";
import {
  EDIT_INSTALLMENT_PERMISSIONS,
  contractRights,
} from "@/lib/contract-rights";
import {
  AuditAction,
  auditRecordChange,
  pickSnapshot,
  recordActivity,
} from "@/lib/audit-domain";

const LEASE_TENANT_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  avatar: true,
  dateOfBirth: true,
  emergencyContacts: true,
  backgroundCheckStatus: true,
  // employmentInfo/creditScore live on the Tenant profile now (PII single
  // home); flattened back onto the tenant in the response mapping.
  tenantProfile: { select: { employmentInfo: true, creditScore: true } },
  moveInDate: true,
  moveOutDate: true,
  applicationDate: true,
} as const;

/** What the contract page shows of a renewal or of the contract it renewed. */
const RENEWAL_LINK_SELECT = {
  id: true,
  contractNumber: true,
  status: true,
  startDate: true,
  endDate: true,
} as const;

/**
 * Whether any of the contract's periods has been billed — the point after
 * which its terms are locked (see lib/lease-term-edits.ts). A charge added by
 * hand bills no period and locks nothing.
 */
async function hasBilledPeriods(leaseId: string): Promise<boolean> {
  const billed = await db.invoice.findFirst({
    where: { leaseId, periodStart: { not: null } },
    select: { id: true },
  });
  return Boolean(billed);
}

function buildPropertyAddress(property: any) {
  return {
    street: property?.addressStreet,
    city: property?.addressCity,
    state: property?.addressState,
    zipCode: property?.addressZipCode,
    country: property?.addressCountry,
  };
}

// ============================================================================
// GET /api/leases/[id] - Get a specific lease
// ============================================================================

export const GET = withAccessAndDB(LEASE_READ_ACCESS)(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    try {
      const { id } = await params;

      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid lease ID", 400);
      }

      // Find the lease
      const lease = await db.lease.findFirst({
        where: { id, ...leaseScope(user) },
        include: {
          property: {
            select: {
              id: true,
              name: true,
              addressStreet: true,
              addressCity: true,
              addressState: true,
              addressZipCode: true,
              addressCountry: true,
              type: true,
              ownerId: true,
              managerId: true,
              owner: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  email: true,
                },
              },
              manager: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  email: true,
                },
              },
            },
          },
          tenant: { select: LEASE_TENANT_SELECT },
          unit: true,
        },
      });

      if (!lease) {
        return createErrorResponse("Lease not found", 404);
      }

      // Same rule the lease list filters by — see lib/db/scopes.ts.
      if (!leaseAllows(user, lease)) {
        return createErrorResponse("You can only view your own leases", 403);
      }
      // Admin and manager can view all leases (single-company architecture)

      // The contract this one renewed, and the one renewing it — each read
      // under the same scope, so a link only appears to someone who may open
      // it. Whether its terms are locked is read alongside.
      const [successor, predecessor, termsLocked] = await Promise.all([
        lease.renewedLeaseId
          ? db.lease.findFirst({
              where: { id: lease.renewedLeaseId, ...leaseScope(user) },
              select: RENEWAL_LINK_SELECT,
            })
          : null,
        lease.parentLeaseId
          ? db.lease.findFirst({
              where: { id: lease.parentLeaseId, ...leaseScope(user) },
              select: RENEWAL_LINK_SELECT,
            })
          : null,
        hasBilledPeriods(lease.id),
      ]);

      // A billed contract is changed by amendment: the form needs to know
      // whether money has come in, which decides what may still change.
      const viewer = contractRights(user);
      const amendmentLevel =
        termsLocked && viewer.amendTerms
          ? await amendmentLevelOf(lease.id)
          : null;

      const { property, tenant, unit, ...rest } = lease as any;
      const responseLease = {
        ...rest,
        renewal: { successor, predecessor },
        termsLocked,
        amendmentLevel,
        // What this caller may do here, from their resolved permissions —
        // per-person grants and denials included, which the browser's own
        // copy of the role's permissions does not know about.
        viewer,
        propertyId: property
          ? {
              ...property,
              address: buildPropertyAddress(property),
              ownerId: property.owner ?? property.ownerId,
              managerId: property.manager ?? property.managerId,
              owner: undefined,
              manager: undefined,
            }
          : rest.propertyId,
        tenantId: tenant
          ? {
              ...tenant,
              employmentInfo: tenant.tenantProfile?.employmentInfo ?? null,
              creditScore: tenant.tenantProfile?.creditScore ?? null,
              tenantProfile: undefined,
            }
          : rest.tenantId,
        unit: unit ?? undefined,
      };

      return createSuccessResponse(responseLease, "Lease retrieved successfully");
    } catch (error) {
      return handleApiError(error);
    }
  }
);

// ============================================================================
// PUT /api/leases/[id] - Update a specific lease
// ============================================================================

// The contract page offers "Edit" on the same list (lib/contract-rights.ts).
export const PUT = withPermissionAndDB([...EDIT_INSTALLMENT_PERMISSIONS])(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    try {
      const { id } = await params;

      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid lease ID", 400);
      }

      const { success, data: body, error } = await parseRequestBody(request);
      if (!success) {
        return createErrorResponse(error!, 400);
      }

      // Find the lease
      const lease = await db.lease.findFirst({
        where: { id, ...leaseScope(user) },
      });
      if (!lease) {
        return createErrorResponse("Lease not found", 404);
      }

      // Validate update data
      const validation = validateSchema(leaseUpdateSchema as any, body);
      if (!validation.success) {
        return createErrorResponse(validation.errors.join(", "), 400);
      }

      const updateData = validation.data as any;

      const { movesProperty, movesUnit, movesTenant } = editPlacement(
        lease,
        updateData,
      );

      // A contract in force is the tenancy of one tenant in one unit, which
      // it occupies. Handing it to another building, unit or tenant is a new
      // contract: this one is terminated and that one created.
      if (
        lease.status === LeaseStatus.ACTIVE &&
        (movesProperty || movesUnit || movesTenant)
      ) {
        return createErrorResponse(
          "A contract in force cannot move to another building, unit or tenant. Terminate it and create a new contract.",
          409,
          undefined,
          "TERMS_LOCKED"
        );
      }

      // Once installments are billed, the terms they were billed from stay as
      // they are (owner's decision, 2026-10-01). The form sends every field,
      // so only a term whose value really changes is refused; a corrected
      // contract number or a note still saves, on a contract in force too.
      // Changing them goes through an amendment (POST .../amend), which
      // re-bills what nobody has paid yet.
      const termChanges = changedTerms(lease, updateData);
      if (termChanges.length > 0 && (await hasBilledPeriods(id))) {
        return createErrorResponse(
          lockedTermsMessage(termChanges),
          409,
          undefined,
          "TERMS_LOCKED"
        );
      }

      const refusal = await checkLeaseEdit(user, lease, updateData);
      if (refusal) {
        return createErrorResponse(refusal.message, refusal.status);
      }

      const data = leaseUpdateData(lease, updateData);

      // A status sent with an edit is a status change like any other: checked
      // against the transition table, with its side effects and its billing,
      // written in the same statement as the fields above. It used to be set
      // as a plain column, so an edit could reopen a cancelled contract.
      const newStatus =
        updateData.status && updateData.status !== lease.status
          ? (updateData.status as LeaseStatus)
          : null;

      let updated: { id: string };
      let invoiceGeneration = null;
      if (newStatus) {
        if (newStatus === LeaseStatus.TERMINATED) {
          // A cancellation is a record, not just a status: when and by whom.
          Object.assign(
            data,
            cancellationRecord({ previousStatus: lease.status, userId: user.id }),
          );
        }
        if (newStatus === LeaseStatus.ACTIVE && !lease.signedDate) {
          data.signedDate = new Date();
        }
        const changed = await changeLeaseStatus({ lease, to: newStatus, data });
        updated = changed.lease;
        invoiceGeneration = changed.invoiceGeneration;
      } else {
        updated = await db.lease.update({ where: { id }, data });
        // A status change records itself (changeLeaseStatus); an edit of the
        // terms is recorded here, with only the fields that moved.
        auditRecordChange({
          action: AuditAction.UPDATE,
          recordType: "lease",
          recordId: id,
          recordName:
            (updated as { contractNumber?: string | null }).contractNumber ??
            lease.contractNumber,
          before: lease as unknown as Record<string, unknown>,
          after: { ...lease, ...data } as Record<string, unknown>,
          keys: Object.keys(data),
        });
      }

      // Fetch property and tenant information for the response
      const populated = await db.lease.findFirst({
        where: { id, ...leaseScope(user) },
        include: {
          property: {
            select: {
              id: true,
              name: true,
              addressStreet: true,
              addressCity: true,
              addressState: true,
              addressZipCode: true,
              addressCountry: true,
              type: true,
            },
          },
          tenant: { select: LEASE_TENANT_SELECT },
          unit: true,
        },
      });

      const { property, tenant, unit, ...rest } = (populated ?? updated) as any;
      const responseLease = {
        ...rest,
        propertyId: property
          ? { ...property, address: buildPropertyAddress(property) }
          : rest.propertyId,
        tenantId: tenant ?? rest.tenantId,
        unit: unit ?? undefined,
        ...(invoiceGeneration ? { invoiceGeneration } : {}),
      };

      return createSuccessResponse(responseLease, "Lease updated successfully");
    } catch (error) {
      return handleApiError(error);
    }
  }
);

// ============================================================================
// DELETE /api/leases/[id] - Delete a specific lease
// ============================================================================

// Deleting a contract is its own right — it used to follow from being able to
// edit one.
export const DELETE = withPermissionAndDB(["lease_delete", "lease_management"])(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    try {
      const { id } = await params;

      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid lease ID", 400);
      }

      // Find the lease
      const lease = await db.lease.findFirst({
        where: { id, ...leaseScope(user) },
      });
      if (!lease) {
        return createErrorResponse("Lease not found", 404);
      }

      // Only draft leases can be deleted. Anything that has progressed beyond
      // draft (active/pending/terminated/expired) has or may have financial
      // records, so it must be terminated and/or archived instead of deleted.
      if (lease.status !== LeaseStatus.DRAFT) {
        return createErrorResponse(
          lease.status === LeaseStatus.ACTIVE
            ? "Cannot delete an active lease. Terminate it first, then archive."
            : "Only draft leases can be deleted. Archive this lease instead to keep its financial records.",
          409
        );
      }

      // Perform soft delete
      await db.lease.update({
        where: { id },
        data: { deletedAt: new Date() },
      });

      // A draft renewal deleted before it came into force renews nothing:
      // the contract it was for stops pointing at it.
      if (lease.parentLeaseId) {
        await unhookWithdrawnRenewals([id]);
      }

      void recordActivity({
        action: AuditAction.DELETE,
        recordType: "lease",
        recordId: id,
        recordName: lease.contractNumber,
        before: pickSnapshot(lease as unknown as Record<string, unknown>, [
          "status",
          "contractNumber",
          "startDate",
          "endDate",
          "rentAmount",
          "contractAmount",
          "tenantId",
          "unitId",
        ]),
      });

      return createSuccessResponse(
        { id: lease.id },
        "Lease deleted successfully"
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);

// ============================================================================
// PATCH /api/leases/[id] - Partial update (status change, etc.)
// ============================================================================

export const PATCH = withAccessAndDB(LEASE_PATCH_ACCESS)(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    try {
      const { id } = await params;

      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid lease ID", 400);
      }

      const { success, data: body, error } = await parseRequestBody(request);
      if (!success) {
        return createErrorResponse(error!, 400);
      }

      // Find the lease
      const lease = await db.lease.findFirst({
        where: { id, ...leaseScope(user) },
      });
      if (!lease) {
        return createErrorResponse("Lease not found", 404);
      }

      // See lib/db/scopes.ts.
      if (!leaseAllows(user, lease)) {
        return createErrorResponse("You can only modify your own leases", 403);
      }

      // Handle specific patch operations
      const { action, ...data } = body;

      const update: Prisma.LeaseUncheckedUpdateManyInput = {};
      // The status this action moves the contract to. Every one of them goes
      // through changeLeaseStatus and so through the transition table — only
      // "changeStatus" used to, and "activate" could bring a cancelled
      // contract back into force.
      let targetStatus: LeaseStatus | null = null;

      // A cancellation through this route — the `terminate` action, or a
      // status change to TERMINATED — used to set the status and nothing
      // else, so the contract reached the Cancelled register with no date and
      // fell out of it once a date range was chosen. It now records when and
      // by whom, and why if the caller says. The terminate route remains the
      // full version: a chosen date, a required reason, the outstanding-rent
      // warning. Null for a contract already cancelled, whose record stands.
      const recordCancellation = () =>
        Object.assign(
          update,
          cancellationRecord({
            previousStatus: lease.status,
            userId: user.id,
            reason: data.reason,
          }),
        );

      switch (action) {
        case "activate":
          if (!canManageLeases(user)) {
            return createErrorResponse("Tenants cannot activate leases", 403);
          }
          targetStatus = LeaseStatus.ACTIVE;
          if (!lease.signedDate) {
            update.signedDate = new Date();
          }
          break;

        case "sign":
          update.signedDate = new Date();
          if (lease.status === LeaseStatus.PENDING) {
            targetStatus = LeaseStatus.ACTIVE;
          }
          break;

        case "terminate":
          if (!canManageLeases(user)) {
            return createErrorResponse("Tenants cannot terminate leases", 403);
          }
          targetStatus = LeaseStatus.TERMINATED;
          recordCancellation();
          break;

        case "expire":
          if (!canManageLeases(user)) {
            return createErrorResponse("Tenants cannot expire leases", 403);
          }
          targetStatus = LeaseStatus.EXPIRED;
          break;

        case "changeStatus":
          if (!canManageLeases(user)) {
            return createErrorResponse(
              "Tenants cannot change lease status",
              403
            );
          }

          if (
            !data.status ||
            !Object.values(LeaseStatus).includes(data.status)
          ) {
            return createErrorResponse("Valid status is required", 400);
          }

          targetStatus = data.status as LeaseStatus;

          if (
            data.status === LeaseStatus.ACTIVE &&
            lease.status !== LeaseStatus.ACTIVE &&
            !lease.signedDate
          ) {
            update.signedDate = new Date();
          }
          if (data.status === LeaseStatus.TERMINATED) {
            recordCancellation();
          }
          break;

        case "addDocument":
          if (!data.document) {
            return createErrorResponse("Document URL is required", 400);
          }
          update.documents = [...lease.documents, data.document];
          break;

        case "removeDocument":
          if (!data.document) {
            return createErrorResponse("Document URL is required", 400);
          }
          update.documents = lease.documents.filter(
            (doc) => doc !== data.document
          );
          break;

        case "updateRenewalOptions":
          if (!canManageLeases(user)) {
            return createErrorResponse(
              "Tenants cannot update renewal options",
              403
            );
          }
          if (!data.renewalOptions) {
            return createErrorResponse("Renewal options are required", 400);
          }
          update.renewalOptions = data.renewalOptions as Prisma.InputJsonValue;
          break;

        case "requestRenewal":
          // Tenant can request renewal
          if (!(lease.renewalOptions as any)?.available) {
            return createErrorResponse(
              "Renewal is not available for this lease",
              400
            );
          }
          // This would typically create a renewal request record
          // For now, we'll just add a note
          break;

        case "archive":
          if (!canManageLeases(user)) {
            return createErrorResponse("Tenants cannot archive leases", 403);
          }
          // Only ended leases can be archived; finished records are preserved
          if (
            lease.status !== LeaseStatus.TERMINATED &&
            lease.status !== LeaseStatus.EXPIRED
          ) {
            return createErrorResponse(
              "Only terminated or expired leases can be archived",
              409
            );
          }
          update.archivedAt = new Date();
          break;

        case "unarchive":
          if (!canManageLeases(user)) {
            return createErrorResponse("Tenants cannot restore leases", 403);
          }
          update.archivedAt = null;
          break;

        default:
          return createErrorResponse("Invalid action", 400);
      }

      // A status change — activate, sign, terminate, expire, changeStatus —
      // is checked against the table, re-runs the overlap guard on arriving
      // in force, hands the unit over from a renewed contract, and bills a
      // contract that comes into force. Billing runs after the change has
      // committed, so a failure cannot undo it: the contract is active, and
      // `invoiceGeneration.errors` tells the caller its installments are not
      // all there yet. The field is present only when billing ran.
      let updatedLease = lease;
      let invoiceGeneration = null;
      if (targetStatus) {
        const changed = await changeLeaseStatus({
          lease,
          to: targetStatus,
          data: update,
          // Signing reads as signing even when it leaves the status alone.
          audit:
            action === "sign"
              ? { action: AuditAction.SIGN }
              : action === "terminate"
                ? { action: AuditAction.TERMINATE }
                : undefined,
        });
        updatedLease = changed.lease;
        invoiceGeneration = changed.invoiceGeneration;
      } else if (Object.keys(update).length > 0) {
        updatedLease = await db.lease.update({ where: { id }, data: update });
        auditRecordChange({
          action:
            action === "archive"
              ? AuditAction.ARCHIVE
              : action === "unarchive"
                ? AuditAction.RESTORE
                : action === "sign"
                  ? AuditAction.SIGN
                  : AuditAction.UPDATE,
          recordType: "lease",
          recordId: id,
          recordName: lease.contractNumber,
          before: lease as unknown as Record<string, unknown>,
          after: { ...lease, ...update } as Record<string, unknown>,
          keys: Object.keys(update),
          details: { patch: action },
        });
      }

      return createSuccessResponse(
        invoiceGeneration
          ? { ...updatedLease, invoiceGeneration }
          : updatedLease,
        `Lease ${action} completed successfully`
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);
