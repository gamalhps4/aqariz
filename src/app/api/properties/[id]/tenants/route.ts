/**
 * PropertyPro - Property Tenants API
 * Get tenants associated with a specific property through active leases
 */

import { NextRequest } from "next/server";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  withPermissionAndDB,
  isValidObjectId,
} from "@/lib/api-utils";
import { db } from "@/lib/db/prisma";
import { applyScope, leaseScope } from "@/lib/db/scopes";
import { Prisma } from "@/generated/prisma/client";

export const GET = withPermissionAndDB("property_view")(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    try {
      const { id: propertyId } = await params;

      // Validate property ID
      if (!isValidObjectId(propertyId)) {
        return createErrorResponse("Invalid property ID", 400);
      }

      // Get query parameters
      const { searchParams } = new URL(request.url);
      const status = searchParams.get("status") || "active";
      const unitId = searchParams.get("unitId"); // Optional unit filter

      // Build query for leases on this property
      const where: Prisma.LeaseWhereInput = { propertyId };
      if (unitId) where.unitId = unitId;
      if (status === "active") {
        where.status = "active";
        where.endDate = { gte: new Date() };
      } else if (status === "expired") {
        where.endDate = { lt: new Date() };
      } else if (status !== "all") {
        where.status = status;
      }

      // AND-ed on: the building id comes from the URL, so without this a
      // narrowed employee could read the tenant roster of any building by
      // typing its id.
      applyScope(where, leaseScope(user));

      const leases = await db.lease.findMany({
        where,
        orderBy: { startDate: "desc" },
        include: {
          tenant: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
              avatar: true,
            },
          },
          unit: { select: { id: true, unitNumber: true, unitType: true } },
        },
      });

      // Extract unique tenants from leases
      const tenantMap = new Map<string, unknown>();

      for (const lease of leases) {
        const tenant = lease.tenant;
        if (!tenant || tenantMap.has(tenant.id)) continue;

        tenantMap.set(tenant.id, {
          id: tenant.id,
          userId: tenant.id,
          firstName: tenant.firstName ?? "",
          lastName: tenant.lastName ?? "",
          email: tenant.email ?? "",
          phone: tenant.phone ?? "",
          avatar: tenant.avatar,
          unit: lease.unit
            ? {
                id: lease.unit.id,
                unitNumber: lease.unit.unitNumber ?? "",
                type: lease.unit.unitType ?? "apartment",
              }
            : null,
          lease: {
            id: lease.id,
            startDate: lease.startDate,
            endDate: lease.endDate,
            status: lease.status,
            monthlyRent: (lease.terms as { rentAmount?: number } | null)?.rentAmount || 0,
          },
          emergencyContact: null,
          moveInDate: null,
          moveOutDate: null,
          status: "active", // Derived from lease status
        });
      }

      const tenants = Array.from(tenantMap.values());

      return createSuccessResponse({
        tenants,
        total: tenants.length,
        status,
      });
    } catch (error) {
      return createErrorResponse("Failed to fetch property tenants", 500);
    }
  }
);
