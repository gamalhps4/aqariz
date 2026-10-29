/**
 * PropertyPro - Restore or destroy one archived record
 *
 * POST   → restore (open to anyone who can manage the records — and, for an
 *          agreement, may write it)
 * DELETE → permanently destroy (System Owner or Super Admin, AND holding
 *          the `permanent_delete` permission)
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  withPermissionAndDB,
  isValidObjectId,
} from "@/lib/api-utils";
import {
  isArchiveCategory,
  purgeArchived,
  restoreArchived,
  PurgeBlockedError,
  RestoreConflictError,
} from "@/lib/services/archive.service";
import {
  canPermanentlyDelete,
  PURGE_DENIED_MESSAGE,
} from "@/lib/archive-access";
import { db } from "@/lib/db/prisma";
import { agreementScope, withScope } from "@/lib/db/scopes";
import {
  AGREEMENT_WRITE_DENIED,
  mayWriteAgreement,
} from "@/lib/db/agreement-write";
import {
  auditService,
  AuditAction,
  AuditCategory,
  AuditSeverity,
} from "@/lib/audit-service";

type RouteParams = { params: Promise<{ category: string; id: string }> };

// Putting a record back destroys nothing, so it stays available to anyone who
// can manage the underlying records — `archive_restore` simply lets a custom
// role be given it without the whole management permission.
export const POST = withPermissionAndDB([
  "archive_restore",
  "property_management",
  "tenant_management",
])(async (user: AuthenticatedAccessUser, request: NextRequest, { params }: RouteParams) => {
  try {
    const { category, id } = await params;
    if (!isArchiveCategory(category)) {
      return createErrorResponse(`Unknown archive category "${category}"`, 400);
    }
    if (!isValidObjectId(id)) {
      return createErrorResponse("Invalid record ID", 400);
    }

    // Restoring an agreement puts its terms back in force over every building
    // it governs, so it asks what writing one asks (lib/db/agreement-write.ts)
    // — being able to read it in the archive is not the right to that. Only
    // an agreement the caller can read is checked here; one they cannot is
    // answered by the restore below as not found.
    if (
      category === "management_agreements" ||
      category === "investment_agreements"
    ) {
      const agreement = await db.agreement.findFirst({
        where: withScope({ id, deletedAt: { not: null } }, agreementScope(user)),
        select: { ownerId: true, propertyId: true, compoundId: true },
      });
      if (agreement && !(await mayWriteAgreement(user, agreement))) {
        return createErrorResponse(AGREEMENT_WRITE_DENIED, 403);
      }
    }

    const restored = await restoreArchived(category, id, user);
    if (!restored) {
      return createErrorResponse("Archived record not found", 404);
    }

    await auditService.logEvent(
      {
        category: AuditCategory.COMPLIANCE,
        action: AuditAction.UPDATE,
        severity: AuditSeverity.MEDIUM,
        description: `Restored archived ${category}: ${restored.label}`,
        resourceType: category,
        resourceId: id,
        resourceName: restored.label,
        tags: ["archive", "restore"],
      },
      auditService.extractContextFromRequest(request, user),
    );

    return createSuccessResponse(restored, "Record restored successfully");
  } catch (error) {
    if (error instanceof RestoreConflictError) {
      return createErrorResponse(error.detail, 409);
    }
    return handleApiError(error, "Failed to restore the record");
  }
});

export const DELETE = withPermissionAndDB([
  "permanent_delete",
  "property_management",
  "tenant_management",
])(async (user: AuthenticatedAccessUser, request: NextRequest, { params }: RouteParams) => {
  try {
    const { category, id } = await params;

    // The rule the archive exists to enforce. Checked before anything is
    // read, so a denied caller cannot even confirm the record exists.
    //
    // TWO gates, and both must hold. The role rule is the floor and is
    // deliberately not a permission — an organization admin can edit their own
    // roles, so a purely permission-based check would let them grant
    // themselves the one power the scope reserves. `permanent_delete` sits on
    // top of it and can only narrow: it is how an account owner withholds
    // irreversible deletion from an administrator who would otherwise qualify.
    // Both live in canPermanentlyDelete, which the archive screen's flag asks
    // too.
    if (!canPermanentlyDelete(user)) {
      return createErrorResponse(PURGE_DENIED_MESSAGE, 403);
    }

    if (!isArchiveCategory(category)) {
      return createErrorResponse(`Unknown archive category "${category}"`, 400);
    }
    if (!isValidObjectId(id)) {
      return createErrorResponse("Invalid record ID", 400);
    }

    const purged = await purgeArchived(category, id, user);
    if (!purged) {
      return createErrorResponse("Archived record not found", 404);
    }

    // Irreversible and role-restricted, so it is logged at high severity with
    // the actor attached — this is the audit trail the scope's data-control
    // term relies on.
    await auditService.logEvent(
      {
        category: AuditCategory.COMPLIANCE,
        action: AuditAction.DELETE,
        severity: AuditSeverity.HIGH,
        description: `Permanently deleted archived ${category}: ${purged.label}`,
        resourceType: category,
        resourceId: id,
        resourceName: purged.label,
        tags: ["archive", "permanent-delete", "high_priority"],
        complianceFlags: ["permanent_deletion"],
      },
      auditService.extractContextFromRequest(request, user),
    );

    return createSuccessResponse(purged, "Record permanently deleted");
  } catch (error) {
    if (error instanceof PurgeBlockedError) {
      return createErrorResponse(error.detail, 409);
    }
    return handleApiError(error, "Failed to delete the record");
  }
});
