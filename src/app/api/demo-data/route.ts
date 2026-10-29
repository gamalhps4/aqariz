/**
 * PropertyPro - Demo Data API
 * API endpoints for installing and managing demo data
 *
 * Off in production unless the deployment opts in, and clearing is held to
 * the archive purge's rule — see lib/demo-data-access.ts.
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  withPermissionAndDB,
  parseRequestBody,
} from "@/lib/api-utils";
import {
  demoDataService,
  DemoDataOptions,
} from "@/lib/services/demo-data.service";
import {
  demoDataPurgeRefusal,
  demoDataReadRefusal,
  demoDataWriteRefusal,
} from "@/lib/demo-data-access";
import {
  auditService,
  AuditAction,
  AuditCategory,
  AuditSeverity,
} from "@/lib/audit-service";
import { db } from "@/lib/db/prisma";
import { z } from "zod";

// ============================================================================
// VALIDATION SCHEMAS
// ============================================================================

const installDemoDataSchema = z.object({
  includeUsers: z.boolean().default(true),
  includeProperties: z.boolean().default(true),
  includeTenants: z.boolean().default(true),
  includeLeases: z.boolean().default(true),
  includePayments: z.boolean().default(true),
  includeMaintenance: z.boolean().default(true),
  includeMessages: z.boolean().default(true),
  includeEvents: z.boolean().default(true),
  includeAnnouncements: z.boolean().default(true),
  propertyCount: z.number().min(1).max(20).default(5),
  tenantCount: z.number().min(1).max(50).default(15),
  organizationName: z
    .string()
    .min(1)
    .max(100)
    .default("Demo Property Management"),
  adminEmail: z.string().email().default("admin@demo.com"),
  adminPassword: z.string().min(8).default("Demo123!"),
});

// ============================================================================
// POST /api/demo-data - Install demo data
// ============================================================================
export const POST = withPermissionAndDB("system_settings")(
  async (_user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const refusal = demoDataWriteRefusal();
      if (refusal) {
        return createErrorResponse(refusal.message, refusal.status);
      }

      const { success, data: body, error } = await parseRequestBody(request);
      if (!success) {
        return createErrorResponse(error!, 400);
      }

      // Validate request body
      const validation = installDemoDataSchema.safeParse(body);
      if (!validation.success) {
        return createErrorResponse(
          `Validation failed: ${validation.error.errors
            .map((e) => e.message)
            .join(", ")}`,
          400
        );
      }

      const options: DemoDataOptions = validation.data;

      // Install demo data
      const result = await demoDataService.installDemoData(options);

      if (result.success) {
        return createSuccessResponse(
          {
            installed: result.data,
            adminCredentials: result.adminCredentials,
            message: result.message,
          },
          "Demo data installed successfully"
        );
      } else {
        return createErrorResponse(result.message, 400);
      }
    } catch (error) {
      return handleApiError(error);
    }
  }
);

// ============================================================================
// DELETE /api/demo-data - Clear demo data
// ============================================================================
export const DELETE = withPermissionAndDB("system_settings")(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      // Asked before anything is read: this destroys every record the
      // organization holds, archived ones included, so it is held to the rule
      // the archive keeps for destroying one of them — and is off in
      // production altogether unless the deployment says otherwise.
      const refusal = demoDataPurgeRefusal(user);
      if (refusal) {
        return createErrorResponse(refusal.message, refusal.status);
      }

      const result = await demoDataService.clearDemoData();

      if (result.success) {
        // Irreversible and role-restricted, so it is logged at high severity,
        // as the archive purge is. The actor is named by email, role and
        // address but not by id: their own user row went with the rest, and
        // audit_logs.userId is a foreign key — an id that no longer exists
        // would fail the insert, and a failed audit write is swallowed.
        const { userId: _deletedActor, ...context } =
          auditService.extractContextFromRequest(request, user);
        await auditService.logEvent(
          {
            category: AuditCategory.COMPLIANCE,
            action: AuditAction.BULK_DELETE,
            severity: AuditSeverity.HIGH,
            description:
              "Permanently deleted the organization's records through the demo-data API",
            resourceType: "organization",
            resourceId: user.organizationId ?? undefined,
            details: { deleted: result.deleted, actorId: user.id },
            tags: ["demo-data", "permanent-delete", "high_priority"],
            complianceFlags: ["permanent_deletion"],
          },
          context,
        );

        return createSuccessResponse(
          { message: result.message },
          "Demo data cleared successfully"
        );
      } else {
        // A foreign key refusing the clear is an answer, not a fault: the
        // transaction undid everything, and the caller is told so.
        return createErrorResponse(result.message, result.refused ? 409 : 500);
      }
    } catch (error) {
      return handleApiError(error);
    }
  }
);

// ============================================================================
// GET /api/demo-data - Check demo data status
// ============================================================================
export const GET = withPermissionAndDB("system_settings")(
  async (user: AuthenticatedAccessUser, _request: NextRequest) => {
    try {
      const refusal = demoDataReadRefusal(user);
      if (refusal) {
        return createErrorResponse(refusal.message, refusal.status);
      }

      // Check if demo data exists
      const [
        userCount,
        propertyCount,
        tenantCount,
        leaseCount,
        paymentCount,
        maintenanceCount,
        messageCount,
        eventCount,
        announcementCount,
      ] = await Promise.all([
        db.user.count(),
        db.property.count(),
        db.tenant.count(),
        db.lease.count(),
        db.payment.count(),
        db.maintenanceRequest.count(),
        db.message.count(),
        db.event.count(),
        db.announcement.count(),
      ]);

      const totalRecords =
        userCount +
        propertyCount +
        tenantCount +
        leaseCount +
        paymentCount +
        maintenanceCount +
        messageCount +
        eventCount +
        announcementCount;

      const hasDemoData = totalRecords > 0;

      // Get sample data for preview
      let sampleData = null;
      if (hasDemoData) {
        const [sampleUsers, sampleProperties, sampleTenants] =
          await Promise.all([
            db.user.findMany({
              select: {
                id: true,
                firstName: true,
                lastName: true,
                role: true,
              },
              take: 3,
            }),
            db.property.findMany({
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
              take: 3,
            }),
            // A name to recognise the sample by, and nothing else: the whole
            // row was sent, national id and date of birth included.
            db.tenant.findMany({
              select: {
                id: true,
                userId: true,
                user: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                  },
                },
              },
              take: 3,
            }),
          ]);

        sampleData = {
          users: sampleUsers,
          // Keep the old populated shapes (nested address / populated userId)
          properties: sampleProperties.map((p) => ({
            id: p.id,
            name: p.name,
            type: p.type,
            address: {
              street: p.addressStreet,
              city: p.addressCity,
              state: p.addressState,
              zipCode: p.addressZipCode,
              country: p.addressCountry,
            },
          })),
          tenants: sampleTenants.map((t) => ({
            ...t,
            userId: t.user ?? t.userId,
            user: undefined,
          })),
        };
      }

      return createSuccessResponse(
        {
          hasDemoData,
          counts: {
            users: userCount,
            properties: propertyCount,
            tenants: tenantCount,
            leases: leaseCount,
            payments: paymentCount,
            maintenanceRequests: maintenanceCount,
            messages: messageCount,
            events: eventCount,
            announcements: announcementCount,
            total: totalRecords,
          },
          sampleData,
        },
        "Demo data status retrieved successfully"
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);

// ============================================================================
// Helper functions for demo data management
// ============================================================================

export async function checkDemoDataExists(): Promise<boolean> {
  try {
    const userCount = await db.user.count();
    return userCount > 0;
  } catch (error) {
    console.error("Error checking demo data:", error);
    return false;
  }
}

export async function installQuickDemo(): Promise<{
  success: boolean;
  message: string;
  adminCredentials?: { email: string; password: string };
}> {
  try {
    const options: DemoDataOptions = {
      includeUsers: true,
      includeProperties: true,
      includeTenants: true,
      includeLeases: true,
      includePayments: true,
      includeMaintenance: true,
      includeMessages: true,
      includeEvents: true,
      includeAnnouncements: true,
      propertyCount: 3,
      tenantCount: 8,
      organizationName: "Quick Demo Properties",
      adminEmail: "admin@quickdemo.com",
      adminPassword: "QuickDemo123!",
    };

    const result = await demoDataService.installDemoData(options);

    return {
      success: result.success,
      message: result.message,
      adminCredentials: result.adminCredentials,
    };
  } catch (error) {
    console.error("Error installing quick demo:", error);
    return {
      success: false,
      message: "Failed to install quick demo data",
    };
  }
}

export async function getDemoDataSummary(): Promise<{
  success: boolean;
  summary?: {
    totalRecords: number;
    breakdown: Record<string, number>;
    lastUpdated: Date;
  };
}> {
  try {
    const [
      userCount,
      propertyCount,
      tenantCount,
      leaseCount,
      paymentCount,
      maintenanceCount,
      messageCount,
      eventCount,
      announcementCount,
    ] = await Promise.all([
      db.user.count(),
      db.property.count(),
      db.tenant.count(),
      db.lease.count(),
      db.payment.count(),
      db.maintenanceRequest.count(),
      db.message.count(),
      db.event.count(),
      db.announcement.count(),
    ]);

    const breakdown = {
      users: userCount,
      properties: propertyCount,
      tenants: tenantCount,
      leases: leaseCount,
      payments: paymentCount,
      maintenanceRequests: maintenanceCount,
      messages: messageCount,
      events: eventCount,
      announcements: announcementCount,
    };

    const totalRecords = Object.values(breakdown).reduce(
      (sum, count) => sum + count,
      0
    );

    // Get the most recent record to determine last updated
    const latestUser = await db.user.findFirst({
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    const lastUpdated = latestUser?.createdAt || new Date();

    return {
      success: true,
      summary: {
        totalRecords,
        breakdown,
        lastUpdated,
      },
    };
  } catch (error) {
    console.error("Error getting demo data summary:", error);
    return {
      success: false,
    };
  }
}
