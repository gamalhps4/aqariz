/**
 * PropertyPro - Tenant Dashboard API
 * API endpoint for tenant dashboard data
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import {
  UserRole,
  LeaseStatus,
  PaymentStatus,
  MaintenanceStatus,
} from "@/types";
import {
  AuthenticatedAccessUser,
  createSuccessResponse as createApiSuccessResponse,
  createErrorResponse as createApiErrorResponse,
  withPermissionAndDB,
} from "@/lib/api-utils";

// Helper functions
function createSuccessResponse(
  data: any,
  message: string,
  status: number = 200
) {
  return createApiSuccessResponse(data, message);
}

function createErrorResponse(message: string, status: number = 400) {
  return createApiErrorResponse(message, status, message);
}

const ACTIVE_TENANT_LEASE_STATUSES = [
  LeaseStatus.ACTIVE,
  LeaseStatus.EXPIRED,
  LeaseStatus.PENDING,
  LeaseStatus.PENDING_SIGNATURE,
];

function isUpcomingLeaseStatus(status: LeaseStatus): boolean {
  return (
    status === LeaseStatus.PENDING || status === LeaseStatus.PENDING_SIGNATURE
  );
}

const propertyRefSelect = {
  id: true,
  name: true,
  type: true,
  addressStreet: true,
  addressCity: true,
  addressState: true,
  addressZipCode: true,
} as const;

/** Rebuild the populated `propertyId` shape ({ name, address, type }). */
function mapPropertyRef(property: {
  id: string;
  name: string;
  type: string;
  addressStreet: string;
  addressCity: string;
  addressState: string;
  addressZipCode: string;
}) {
  return {
    id: property.id,
    name: property.name,
    type: property.type,
    address: {
      street: property.addressStreet,
      city: property.addressCity,
      state: property.addressState,
      zipCode: property.addressZipCode,
    },
  };
}

// ============================================================================
// GET /api/tenant/dashboard - Get tenant dashboard data
// ============================================================================

export const GET = withPermissionAndDB("lease_view", {
  roles: [UserRole.TENANT],
})(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    context?: { tenantProfile?: any }
  ) => {
    try {
      const tenant = context?.tenantProfile;

      if (!tenant) {
        return createErrorResponse("Tenant profile unavailable", 500);
      }

      const allLeases = await db.lease.findMany({
        where: {
          tenantId: user.id,
          status: { in: ACTIVE_TENANT_LEASE_STATUSES },
        },
        include: { property: { select: propertyRefSelect } },
        orderBy: { startDate: "desc" },
      });

      // Calculate days until lease expiration for each lease
      const leasesWithExpiration = allLeases.map((lease) => {
        const today = new Date();
        const endDate = new Date(lease.endDate);
        const startDate = new Date(lease.startDate);
        const daysUntilExpiration = Math.ceil(
          (endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
        );
        const daysUntilStart = Math.ceil(
          (startDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
        );

        return {
          ...lease,
          propertyId: lease.property
            ? mapPropertyRef(lease.property)
            : lease.propertyId,
          property: undefined,
          daysUntilExpiration,
          daysUntilStart,
          isActive: lease.status === LeaseStatus.ACTIVE,
          isUpcoming: isUpcomingLeaseStatus(lease.status as LeaseStatus),
          isExpired: lease.status === LeaseStatus.EXPIRED,
        };
      });

      // Get the current active lease (primary lease for dashboard)
      const currentLease =
        leasesWithExpiration.find((lease) => lease.isActive) ||
        leasesWithExpiration[0] ||
        null;

      // Get recent payments (last 6 months)
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

      const recentPayments = await db.payment.findMany({
        where: {
          tenantId: user.id,
          createdAt: { gte: sixMonthsAgo },
        },
        orderBy: { dueDate: "desc" },
        take: 10,
      });

      // Get upcoming payments (next 3 months)
      const threeMonthsFromNow = new Date();
      threeMonthsFromNow.setMonth(threeMonthsFromNow.getMonth() + 3);

      const upcomingPayments = await db.payment.findMany({
        where: {
          tenantId: user.id,
          status: { in: [PaymentStatus.PENDING, PaymentStatus.OVERDUE] },
          dueDate: { lte: threeMonthsFromNow },
        },
        orderBy: { dueDate: "asc" },
        take: 5,
      });

      // Get maintenance requests (last 6 months)
      const maintenanceRequests = await db.maintenanceRequest.findMany({
        where: {
          tenantId: user.id,
          createdAt: { gte: sixMonthsAgo },
        },
        include: {
          assignedTo: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 10,
      });

      // Get notifications (mock data for now - in real implementation, this would come from a notifications system)
      const notifications = [
        {
          _id: "notif1",
          title: "Rent Reminder",
          message: "Your rent payment is due in 3 days",
          type: "payment",
          createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
          read: false,
        },
        {
          _id: "notif2",
          title: "Maintenance Update",
          message: "Your maintenance request has been assigned to a technician",
          type: "maintenance",
          createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
          read: true,
        },
      ];

      // Prepare dashboard data
      const dashboardData = {
        tenant: {
          id: tenant.id,
          userId: tenant.userId,
        },
        currentLease: currentLease,
        allLeases: leasesWithExpiration,
        hasMultipleLeases: leasesWithExpiration.length > 1,
        recentPayments: recentPayments.map((payment) => ({
          id: payment.id,
          amount: payment.amount,
          dueDate: payment.dueDate,
          paidDate: payment.paidDate,
          status: payment.status,
          type: payment.type,
        })),
        upcomingPayments: upcomingPayments.map((payment) => ({
          id: payment.id,
          amount: payment.amount,
          dueDate: payment.dueDate,
          type: payment.type,
          status: payment.status,
        })),
        maintenanceRequests: maintenanceRequests.map((request) => ({
          id: request.id,
          title: request.title,
          description: request.description,
          priority: request.priority,
          status: request.status,
          createdAt: request.createdAt,
          assignedTo: request.assignedTo,
        })),
        notifications,
        summary: {
          totalLeases: leasesWithExpiration.length,
          activeLeases: leasesWithExpiration.filter((l) => l.isActive).length,
          upcomingLeases: leasesWithExpiration.filter((l) => l.isUpcoming).length,
          expiredLeases: leasesWithExpiration.filter((l) => l.isExpired).length,
          totalPayments: recentPayments.length,
          paidPayments: recentPayments.filter(
            (p) => p.status === PaymentStatus.PAID
          ).length,
          overduePayments: recentPayments.filter(
            (p) => p.status === PaymentStatus.OVERDUE
          ).length,
          openMaintenanceRequests: maintenanceRequests.filter(
            (r) => r.status !== MaintenanceStatus.COMPLETED
          ).length,
          unreadNotifications: notifications.filter((n) => !n.read).length,
        },
      };

      return createSuccessResponse(
        dashboardData,
        "Dashboard data retrieved successfully"
      );
    } catch (error) {
      return createErrorResponse("Failed to fetch tenant dashboard data", 500);
    }
  }
);
