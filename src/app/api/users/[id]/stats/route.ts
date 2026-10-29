/**
 * PropertyPro - User Statistics API Route
 * Aggregates real counts (properties, leases, payments, maintenance) for a user.
 * Stats are role-aware:
 *  - Tenants  -> their own leases / payments / maintenance
 *  - Staff    -> the portfolio of properties they own or manage
 */

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import {
  leaseScope,
  maintenanceScope,
  paymentScope,
  propertyScope,
  withScope,
} from "@/lib/db/scopes";
import { Prisma } from "@/generated/prisma/client";
import { UserRole, PaymentStatus } from "@/types";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  isValidObjectId,
  withPermissionAndDB,
} from "@/lib/api-utils";
import { resolveAccessProfile } from "@/lib/server-permissions";
import { canViewTargetUser } from "@/lib/permissions-manager";

// Number of properties to include in the inline preview list.
const PROPERTY_PREVIEW_LIMIT = 6;

// Property fields the preview needs.
const PROPERTY_PREVIEW_SELECT = {
  id: true,
  name: true,
  addressStreet: true,
  addressCity: true,
  addressState: true,
  status: true,
} as const;

type PropertyPreviewRow = {
  id: string;
  name: string | null;
  addressStreet: string | null;
  addressCity: string | null;
  addressState: string | null;
  status: string | null;
};

// ============================================================================
// GET /api/users/[id]/stats - Aggregate activity metrics for a user
// ============================================================================

export const GET = withPermissionAndDB(["user_view", "user_management"])(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    try {
      const { id } = await params;

      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid user ID", 400);
      }

      const targetUser = await db.user.findFirst({
        where: { id },
        select: { id: true, role: true },
      });
      if (!targetUser) {
        return createErrorResponse("User not found", 404);
      }

      // Respect the same visibility rules as the user detail endpoint.
      const targetAccess = await resolveAccessProfile(targetUser.role);
      if (
        !canViewTargetUser(user, targetAccess, {
          isSelf: targetUser.id === user.id,
        })
      ) {
        return createErrorResponse("Access denied", 403);
      }

      const isTenant = targetUser.role === UserRole.TENANT;

      // Every figure on this page is intersected with what the caller may
      // see, so a narrowed employee reading someone's stats gets totals for
      // their own buildings rather than the whole organization's.
      //
      // AND-ed onto each query, not spread into it. These scopes key on the
      // same columns the queries below filter by — `propertyId`, `tenantId`,
      // a building's `id` — and spread over them the scope replaced the
      // filter: a narrowed caller was shown their own portfolio's totals
      // under someone else's name.
      const leaseWhere = leaseScope(user);
      const paymentWhere = paymentScope(user);
      const propertyWhere = propertyScope(user);
      const maintenanceWhere = maintenanceScope(user);

      const sumPaidPayments = async (match: Prisma.PaymentWhereInput) => {
        const result = await db.payment.aggregate({
          where: withScope(
            { ...match, status: PaymentStatus.PAID, deletedAt: null },
            paymentWhere,
          ),
          _sum: { amount: true },
        });
        return result._sum.amount ?? 0;
      };

      let propertiesCount = 0;
      let leasesCount = 0;
      let totalPayments = 0;
      let maintenanceRequests = 0;
      let properties: Array<{
        id: string;
        name: string;
        address: string;
        status?: string;
      }> = [];

      if (isTenant) {
        // Tenant-centric metrics: their leases, payments and requests.
        const tenantLeases = await db.lease.findMany({
          where: withScope({ tenantId: id, deletedAt: null }, leaseWhere),
          select: { propertyId: true },
        });

        const propertyIds = [
          ...new Set(tenantLeases.map((l) => l.propertyId).filter(Boolean)),
        ];

        const [paid, maintenance, previewProps] = await Promise.all([
          sumPaidPayments({ tenantId: id }),
          db.maintenanceRequest.count({
            where: withScope(
              { tenantId: id, deletedAt: null },
              maintenanceWhere,
            ),
          }),
          db.property.findMany({
            where: withScope(
              { id: { in: propertyIds }, deletedAt: null },
              propertyWhere,
            ),
            select: PROPERTY_PREVIEW_SELECT,
            take: PROPERTY_PREVIEW_LIMIT,
          }),
        ]);

        propertiesCount = propertyIds.length;
        leasesCount = tenantLeases.length;
        totalPayments = paid;
        maintenanceRequests = maintenance;
        properties = previewProps.map(mapPropertyPreview);
      } else {
        // Staff-centric metrics: the portfolio they own or manage.
        const ownedProperties = await db.property.findMany({
          where: withScope(
            { OR: [{ ownerId: id }, { managerId: id }], deletedAt: null },
            propertyWhere,
          ),
          select: PROPERTY_PREVIEW_SELECT,
        });

        const propertyIds = ownedProperties.map((p) => p.id);

        const [leases, paid, maintenance] = await Promise.all([
          db.lease.count({
            where: withScope(
              { propertyId: { in: propertyIds }, deletedAt: null },
              leaseWhere,
            ),
          }),
          sumPaidPayments({ propertyId: { in: propertyIds } }),
          db.maintenanceRequest.count({
            where: withScope(
              { propertyId: { in: propertyIds }, deletedAt: null },
              maintenanceWhere,
            ),
          }),
        ]);

        propertiesCount = ownedProperties.length;
        leasesCount = leases;
        totalPayments = paid;
        maintenanceRequests = maintenance;
        properties = ownedProperties
          .slice(0, PROPERTY_PREVIEW_LIMIT)
          .map(mapPropertyPreview);
      }

      return createSuccessResponse({
        propertiesCount,
        leasesCount,
        totalPayments,
        maintenanceRequests,
        properties,
      });
    } catch (error) {
      return handleApiError(error);
    }
  }
);

// Shape a property row into the lightweight preview the UI renders.
function mapPropertyPreview(property: PropertyPreviewRow) {
  const address = [
    property.addressStreet,
    property.addressCity,
    property.addressState,
  ]
    .filter(Boolean)
    .join(", ");

  return {
    id: property.id,
    name: property.name ?? "Untitled property",
    address,
    status: property.status ?? undefined,
  };
}
