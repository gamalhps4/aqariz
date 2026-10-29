/**
 * PropertyPro - Property Synchronization Debug API
 * Debug endpoint to diagnose property status synchronization issues
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import { propertyScope, withScope } from "@/lib/db/scopes";
import { PropertyStatus } from "@/types";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  withPermissionAndDB,
  isValidObjectId,
} from "@/lib/api-utils";
import { propertyStatusSynchronizer } from "@/lib/services/property-status-sync.service";
import { calculatePropertyStatusFromUnits } from "@/utils/property-status-calculator";

interface SyncDebugDataIssue {
  type: string;
  message: string;
  units: string[];
}

// ============================================================================
// GET /api/properties/[id]/sync-debug - Debug property synchronization
// ============================================================================

export const GET = withPermissionAndDB("system_settings")(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    try {
      const { id } = await params;

      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid property ID", 400);
      }

      // Find the property with all details
      // Scoped: a building this caller does not hold does not resolve, and
      // the 404 below answers.
      const property = await db.property.findFirst({
        where: withScope({ id }, propertyScope(user)),
      });
      if (!property) {
        return createErrorResponse("Property not found", 404);
      }

      const units = await db.unit.findMany({
        where: { propertyId: id },
        orderBy: [{ createdAt: "asc" }, { unitNumber: "asc" }],
      });

      // Get current unit statuses
      const unitStatuses = units.map((unit) => ({
        unitId: unit.id,
        unitNumber: unit.unitNumber,
        status: unit.status,
        currentTenantId: unit.currentTenantId,
        currentLeaseId: unit.currentLeaseId,
      }));

      // Calculate what the property status should be
      const unitStatusValues = unitStatuses.map(
        (u) => u.status as PropertyStatus,
      );
      const calculatedStatus =
        calculatePropertyStatusFromUnits(unitStatusValues);

      // Check for inconsistency
      const isConsistent = property.status === calculatedStatus;

      // Get status counts
      const statusCounts = {
        available: unitStatusValues.filter((s) => s === "available").length,
        occupied: unitStatusValues.filter((s) => s === "occupied").length,
        maintenance: unitStatusValues.filter((s) => s === "maintenance").length,
        unavailable: unitStatusValues.filter((s) => s === "unavailable").length,
      };

      // Validate property status consistency
      const validation =
        await propertyStatusSynchronizer.validatePropertyStatusConsistency(id);

      const recommendations: string[] = [];

      const debugInfo = {
        property: {
          id: property.id,
          name: property.name,
          currentStatus: property.status,
          isMultiUnit: property.isMultiUnit,
          totalUnits: property.totalUnits,
          lastUpdated: property.updatedAt,
        },
        units: {
          count: unitStatuses.length,
          statuses: unitStatuses,
          statusCounts,
        },
        synchronization: {
          calculatedStatus,
          isConsistent,
          shouldUpdate: !isConsistent,
          validation,
        },
        businessRules: {
          allOccupied: statusCounts.occupied === unitStatuses.length,
          allAvailable: statusCounts.available === unitStatuses.length,
          hasAvailable: statusCounts.available > 0,
          hasOccupied: statusCounts.occupied > 0,
          hasMaintenance: statusCounts.maintenance > 0,
          hasUnavailable: statusCounts.unavailable > 0,
        },
        recommendations,
        dataIssues: [] as SyncDebugDataIssue[],
      };

      // Add specific recommendations
      if (!isConsistent) {
        recommendations.push(
          `Property status should be updated from "${property.status}" to "${calculatedStatus}"`
        );
      }

      if (
        statusCounts.occupied === unitStatuses.length &&
        property.status !== "occupied"
      ) {
        recommendations.push(
          "All units are occupied - property should be marked as 'occupied'"
        );
      }

      if (statusCounts.available > 0 && property.status === "occupied") {
        recommendations.push(
          `${statusCounts.available} unit(s) are available - property should not be marked as 'occupied'`
        );
      }

      // Check for potential data issues
      const dataIssues: SyncDebugDataIssue[] = [];

      // Check for units with occupied status but no lease/tenant
      const occupiedWithoutLease = unitStatuses.filter(
        (u) =>
          u.status === "occupied" && (!u.currentLeaseId || !u.currentTenantId)
      );

      if (occupiedWithoutLease.length > 0) {
        dataIssues.push({
          type: "occupied_without_lease",
          message: `${occupiedWithoutLease.length} unit(s) marked as occupied but missing lease/tenant data`,
          units: occupiedWithoutLease.map((u) => u.unitNumber),
        });
      }

      // Check for units with available status but have lease/tenant
      const availableWithLease = unitStatuses.filter(
        (u) =>
          u.status === "available" && (u.currentLeaseId || u.currentTenantId)
      );

      if (availableWithLease.length > 0) {
        dataIssues.push({
          type: "available_with_lease",
          message: `${availableWithLease.length} unit(s) marked as available but have lease/tenant data`,
          units: availableWithLease.map((u) => u.unitNumber),
        });
      }

      debugInfo.dataIssues = dataIssues;

      return createSuccessResponse(
        debugInfo,
        isConsistent
          ? "Property status is consistent"
          : "Property status inconsistency detected"
      );
    } catch (error) {
      return createErrorResponse("Internal server error", 500);
    }
  }
);

// ============================================================================
// POST /api/properties/[id]/sync-debug - Force synchronization
// ============================================================================

export const POST = withPermissionAndDB("system_settings")(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    try {
      const { id } = await params;

      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid property ID", 400);
      }

      // Scoped like the GET above: the synchronizer rewrites the status of
      // whichever building it is handed, so the id has to be one this caller
      // holds before it gets that far.
      const inScope = await db.property.count({
        where: withScope({ id }, propertyScope(user)),
      });
      if (!inScope) {
        return createErrorResponse("Property not found", 404);
      }

      const body = await request.json();
      const { dryRun = false, force = false } = body;

      // Force synchronization
      const result = await propertyStatusSynchronizer.syncPropertyStatus(id, {
        triggeredBy: `manual-debug-sync:${user.id}`,
        dryRun,
        logChanges: true,
        skipValidation: force,
      });

      return createSuccessResponse(
        { synchronization: result },
        dryRun
          ? "Dry run synchronization completed"
          : "Property status synchronized successfully"
      );
    } catch (error) {
      return createErrorResponse("Internal server error", 500);
    }
  }
);
