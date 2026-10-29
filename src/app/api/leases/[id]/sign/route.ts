/**
 * PropertyPro - Lease Signing API Route
 * Handle lease signing process with e-signature support
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/prisma";
import { leaseScope, type ScopeActor } from "@/lib/db/scopes";
import { LeaseStatus } from "@/types";
import { validateSchema } from "@/lib/validations";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  withAccessAndDB,
  parseRequestBody,
  isValidObjectId,
} from "@/lib/api-utils";
import {
  LEASE_PATCH_ACCESS,
  canManageLeases,
  isLeaseTenantUser,
} from "@/lib/lease-access";
import { changeLeaseStatus } from "@/lib/services/lease-lifecycle.service";
import { AuditAction } from "@/lib/audit-domain";
import { extractIpAddress } from "@/lib/session-tracker";

function buildPropertyAddress(property: any) {
  return {
    street: property?.addressStreet,
    city: property?.addressCity,
    state: property?.addressState,
    zipCode: property?.addressZipCode,
    country: property?.addressCountry,
  };
}

const signLeaseSchema = z.object({
  signature: z.string().min(1, "Digital signature is required"),
  /**
   * Optional: the address recorded with a signature is the one this server
   * saw the request come from. The sign form has never known its own address
   * and sent an empty string, which the old "required" rule turned into a
   * refusal of every signature.
   */
  ipAddress: z.string().max(100).optional(),
});

/**
 * Scoped on purpose: every caller of this helper answers 404 when it returns
 * nothing, so narrowing the lookup is what keeps a lease in someone else's
 * buildings indistinguishable from one that does not exist.
 */
async function findLeaseWithRelations(
  id: string,
  actor: ScopeActor,
) {
  return db.lease.findFirst({
    where: { id, ...leaseScope(actor) },
    include: {
      tenant: true,
      property: {
        select: {
          id: true,
          name: true,
          type: true,
          addressStreet: true,
          addressCity: true,
          addressState: true,
          addressZipCode: true,
          addressCountry: true,
        },
      },
    },
  });
}

function mapSignedLease(lease: any) {
  const { tenant, property, ...rest } = lease;
  return {
    ...rest,
    tenantId: tenant
      ? { ...tenant, ssn: undefined }
      : rest.tenantId,
    propertyId: property
      ? { ...property, address: buildPropertyAddress(property) }
      : rest.propertyId,
  };
}

// ============================================================================
// POST /api/leases/[id]/sign - Sign a lease
// ============================================================================

export const POST = withAccessAndDB(LEASE_PATCH_ACCESS)(
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

      const { success, data: body } = await parseRequestBody(request);
      const signatureData = success ? body : {};

      // Find the lease
      const lease = await findLeaseWithRelations(id, user);

      if (!lease) {
        return createErrorResponse("Lease not found", 404);
      }

      // Check permissions
      const canSign = canManageLeases(user) || isLeaseTenantUser(user, lease);

      if (!canSign) {
        return createErrorResponse("Access denied", 403);
      }

      // Check if lease can be signed
      if (
        lease.status !== LeaseStatus.DRAFT &&
        lease.status !== LeaseStatus.PENDING_SIGNATURE
      ) {
        return createErrorResponse(
          "Lease cannot be signed in its current status",
          400
        );
      }

      // Validate signature data
      const validation = validateSchema(signLeaseSchema, signatureData);
      if (!validation.success) {
        return createErrorResponse(validation.errors.join(", "), 400);
      }
      const { signature } = validation.data;
      const ipAddress =
        extractIpAddress(request.headers) ||
        validation.data.ipAddress ||
        "unknown";

      // Sign the lease (draft/pending_signature -> active), as a status
      // change like any other: checked against the table and the other
      // contracts on the unit, which it then occupies. Signing is how a
      // renewal left as a draft comes into force, so the contract it renews
      // steps aside in the same write. The contract — now in force — is
      // billed; what could not be billed is reported, not dropped.
      const { lease: signed, invoiceGeneration } = await changeLeaseStatus({
        lease,
        to: LeaseStatus.ACTIVE,
        data: {
          signedDate: new Date(),
          signedById: user.id,
          signatureData: signature,
          signatureIpAddress: ipAddress,
        },
        audit: { action: AuditAction.SIGN },
      });

      const populated = await findLeaseWithRelations(id, user);
      const responseLease = mapSignedLease(populated ?? signed);

      return createSuccessResponse(
        { lease: responseLease, invoiceGeneration },
        "Lease signed successfully"
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);

// ============================================================================
// GET /api/leases/[id]/sign - Get lease signing status and requirements
// ============================================================================

export const GET = withAccessAndDB(LEASE_PATCH_ACCESS)(
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
      const lease = await findLeaseWithRelations(id, user);

      if (!lease) {
        return createErrorResponse("Lease not found", 404);
      }

      // Check permissions
      const canView = canManageLeases(user) || isLeaseTenantUser(user, lease);

      if (!canView) {
        return createErrorResponse("Access denied", 403);
      }

      const terms = lease.terms as any;

      // Prepare signing information
      const signingInfo = {
        leaseId: lease.id,
        status: lease.status,
        canSign: [
          LeaseStatus.DRAFT,
          LeaseStatus.PENDING_SIGNATURE,
        ].includes(lease.status as LeaseStatus),
        isSigned: !!lease.signedDate,
        signedDate: lease.signedDate,
        signedBy: lease.signedById,
        requirements: {
          digitalSignature: true,
          ipAddressTracking: true,
          tenantConsent: true,
        },
        tenant: {
          name: `${lease.tenant?.firstName ?? ""} ${
            lease.tenant?.lastName ?? ""
          }`.trim(),
          email: lease.tenant?.email,
        },
        property: {
          name: lease.property?.name,
          address: buildPropertyAddress(lease.property),
        },
        terms: {
          startDate: lease.startDate,
          endDate: lease.endDate,
          monthlyRent: terms?.rentAmount,
          securityDeposit: terms?.securityDeposit,
        },
      };

      return createSuccessResponse({ signingInfo });
    } catch (error) {
      return handleApiError(error);
    }
  }
);
