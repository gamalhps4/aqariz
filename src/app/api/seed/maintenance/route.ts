/**
 * PropertyPro - Maintenance Seed API
 * Creates sample maintenance requests for testing
 *
 * Off in production unless the deployment opts in — see
 * lib/demo-data-access.ts.
 */

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import { UserRole, MaintenancePriority, MaintenanceStatus } from "@/types";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  withPermissionAndDB,
} from "@/lib/api-utils";
import {
  demoDataReadRefusal,
  demoDataWriteRefusal,
} from "@/lib/demo-data-access";

export const POST = withPermissionAndDB("system_settings")(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      // These are made-up requests, filed under a real tenant's name.
      const refusal = demoDataWriteRefusal();
      if (refusal) {
        return createErrorResponse(refusal.message, refusal.status);
      }

      // First, let's check if we have any properties and tenant users
      const properties = await db.property.findMany({ take: 5 });
      const tenants = await db.user.findMany({
        where: { role: UserRole.TENANT },
        take: 5,
      });

      if (properties.length === 0 || tenants.length === 0) {
        return createErrorResponse(
          "Need at least one property and one tenant to create sample maintenance requests",
          400
        );
      }

      // Create sample maintenance requests
      const sampleRequests = [
        {
          propertyId: properties[0].id,
          tenantId: tenants[0].id,
          title: "Leaky Faucet in Kitchen",
          description:
            "The kitchen faucet has been dripping constantly for the past week. It's wasting water and making noise at night.",
          priority: MaintenancePriority.MEDIUM,
          status: MaintenanceStatus.SUBMITTED,
          category: "Plumbing",
          estimatedCost: 150,
        },
        {
          propertyId: properties[0].id,
          tenantId: tenants[0].id,
          title: "Broken Air Conditioning",
          description:
            "The AC unit stopped working yesterday. It's getting very hot in the apartment.",
          priority: MaintenancePriority.HIGH,
          status: MaintenanceStatus.SUBMITTED,
          category: "HVAC",
          estimatedCost: 300,
        },
      ];

      // Add more requests if we have more properties/tenants
      if (properties.length > 1 && tenants.length > 1) {
        sampleRequests.push({
          propertyId: properties[1].id,
          tenantId: tenants[1].id,
          title: "Electrical Outlet Not Working",
          description:
            "The outlet in the living room stopped working. Need an electrician to check it.",
          priority: MaintenancePriority.MEDIUM,
          status: MaintenanceStatus.ASSIGNED,
          category: "Electrical",
          estimatedCost: 100,
        });
      }

      // Create the maintenance requests
      const createdRequests = [];
      for (const requestData of sampleRequests) {
        const maintenanceRequest = await db.maintenanceRequest.create({
          data: {
            ...requestData,
            organizationId: user.organizationId!,
          },
        });
        createdRequests.push(maintenanceRequest);
      }

      return createSuccessResponse(
        {
          created: createdRequests.length,
          requests: createdRequests,
        },
        `Created ${createdRequests.length} sample maintenance requests`
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);

// GET endpoint to check existing data
export const GET = withPermissionAndDB("system_settings")(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      // The switch the seeders answer to, and org-wide totals only for a
      // caller who sees the whole organization — see demoDataReadRefusal.
      const readRefusal = demoDataReadRefusal(user);
      if (readRefusal) {
        return createErrorResponse(readRefusal.message, readRefusal.status);
      }

      const properties = await db.property.findMany({
        select: { id: true, name: true },
        take: 5,
      });
      const tenants = await db.user.findMany({
        where: { role: UserRole.TENANT },
        select: { id: true, firstName: true, lastName: true, email: true },
        take: 5,
      });
      const maintenanceRequests = await db.maintenanceRequest.findMany({
        include: {
          property: { select: { id: true, name: true } },
          tenant: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
        },
        take: 5,
      });

      return createSuccessResponse(
        {
          properties: properties.length,
          tenants: tenants.length,
          maintenanceRequests: maintenanceRequests.length,
          sampleData: {
            properties: properties.map((p) => ({ id: p.id, name: p.name })),
            tenants: tenants.map((t) => ({
              id: t.id,
              user: `${t.firstName} ${t.lastName}`,
            })),
            maintenanceRequests: maintenanceRequests.map((r) => ({
              id: r.id,
              title: r.title,
              property: r.property?.name || "No property",
              tenant: r.tenant
                ? `${r.tenant.firstName} ${r.tenant.lastName}`
                : "No tenant",
            })),
          },
        },
        "Database status retrieved"
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);
