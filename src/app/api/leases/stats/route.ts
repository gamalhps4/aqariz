/**
 * PropertyPro - Lease Statistics API Route
 * Get lease statistics and metrics
 */

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import { applyScope, leaseScope } from "@/lib/db/scopes";
import { Prisma } from "@/generated/prisma/client";
import { LeaseStatus } from "@/types";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  handleApiError,
  withAccessAndDB,
} from "@/lib/api-utils";
import { LEASE_READ_ACCESS } from "@/lib/lease-access";

// ============================================================================
// GET /api/leases/stats - Get lease statistics
// ============================================================================

export const GET = withAccessAndDB(LEASE_READ_ACCESS)(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      // Build base query based on user role
      const baseWhere: Prisma.LeaseWhereInput = {};

      // See lib/db/scopes.ts.
      applyScope(baseWhere, leaseScope(user));

      // Get total count by status
      const [
        total,
        active,
        draft,
        pending,
        expired,
        terminated,
        expiringThisMonth,
      ] = await Promise.all([
        db.lease.count({ where: baseWhere }),
        db.lease.count({ where: { ...baseWhere, status: LeaseStatus.ACTIVE } }),
        db.lease.count({ where: { ...baseWhere, status: LeaseStatus.DRAFT } }),
        db.lease.count({
          where: { ...baseWhere, status: LeaseStatus.PENDING },
        }),
        db.lease.count({
          where: { ...baseWhere, status: LeaseStatus.EXPIRED },
        }),
        db.lease.count({
          where: { ...baseWhere, status: LeaseStatus.TERMINATED },
        }),
        // Count leases expiring this month
        db.lease.count({
          where: {
            ...baseWhere,
            status: LeaseStatus.ACTIVE,
            endDate: {
              gte: new Date(),
              lte: new Date(
                new Date().getFullYear(),
                new Date().getMonth() + 1,
                0
              ),
            },
          },
        }),
      ]);

      const stats = {
        total,
        active,
        draft,
        pending,
        expired,
        terminated,
        expiringThisMonth,
      };

      return createSuccessResponse(
        stats,
        "Lease statistics retrieved successfully"
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);
