/**
 * PropertyPro - Property Status Synchronization Service
 * Centralized service for automatic property status synchronization based on
 * unit occupancy.
 *
 * Units are a real table now (`units`), and `property.status`, `totalUnits`,
 * and `isMultiUnit` are derived from unit rows. `syncPropertyDerivedState`
 * is the single place that recomputes and persists that derived state; the
 * `propertyStatusSynchronizer` methods the routes call are thin wrappers.
 */

import { db } from "@/lib/db/prisma";
import { PropertyStatus } from "@/types";
import { calculatePropertyStatusFromUnits } from "@/utils/property-status-calculator";
import {
  propertyAuditLogger,
  PropertyStatusTriggerSource,
} from "@/lib/services/property-audit-logger.service";

export interface PropertyStatusSyncResult {
  propertyId: string;
  oldStatus: PropertyStatus;
  newStatus: PropertyStatus;
  changed: boolean;
  unitCount: number;
  unitStatuses: Array<{
    unitId: string;
    unitNumber: string;
    status: PropertyStatus;
  }>;
  timestamp: Date;
  triggeredBy: string;
}

export interface PropertyStatusSyncOptions {
  triggeredBy?: string;
  skipValidation?: boolean;
  dryRun?: boolean;
  logChanges?: boolean;
}

/**
 * Recompute a property's derived state from its unit rows and persist it.
 *
 * Status rule: any available unit → "available"; all occupied → "occupied";
 * all unavailable → "unavailable"; any maintenance with none available →
 * "maintenance"; no units → "available".
 *
 * Also refreshes `totalUnits` (`units.length || 1`) and `isMultiUnit`
 * (`units.length > 1`), and writes an audit-log entry when the status
 * actually changed (unless `logChanges` is false or `dryRun` is set).
 */
export async function syncPropertyDerivedState(
  propertyId: string,
  options: PropertyStatusSyncOptions = {},
): Promise<PropertyStatusSyncResult> {
  const { triggeredBy = "system", dryRun = false, logChanges = true } = options;

  const property = await db.property.findFirst({
    where: { id: propertyId },
    select: { id: true, name: true, status: true },
  });
  if (!property) {
    throw new Error(`Property not found: ${propertyId}`);
  }

  const units = await db.unit.findMany({
    where: { propertyId },
    orderBy: [{ createdAt: "asc" }, { unitNumber: "asc" }],
    select: { id: true, unitNumber: true, status: true },
  });

  const oldStatus = property.status as PropertyStatus;
  const unitStatusValues = units.map((unit) => unit.status as PropertyStatus);
  const newStatus = calculatePropertyStatusFromUnits(unitStatusValues);

  const result: PropertyStatusSyncResult = {
    propertyId,
    oldStatus,
    newStatus,
    changed: oldStatus !== newStatus,
    unitCount: units.length,
    unitStatuses: units.map((unit) => ({
      unitId: unit.id,
      unitNumber: unit.unitNumber,
      status: unit.status as PropertyStatus,
    })),
    timestamp: new Date(),
    triggeredBy,
  };

  if (!dryRun) {
    await db.property.update({
      where: { id: propertyId },
      data: {
        status: newStatus,
        totalUnits: units.length || 1,
        isMultiUnit: units.length > 1,
      },
    });

    if (result.changed && logChanges) {
      // Log the status change to the audit trail; never fail the sync on it.
      try {
        await propertyAuditLogger.logStatusChange(
          propertyId,
          property.name,
          oldStatus,
          newStatus,
          triggeredBy,
          PropertyStatusTriggerSource.SYSTEM_SYNC,
          {
            metadata: {
              unitCount: result.unitCount,
              syncResult: result,
            },
          },
        );
      } catch {
        // Don't fail the sync if audit logging fails
      }
    }
  }

  return result;
}

export class PropertyStatusSynchronizer {
  private static instance: PropertyStatusSynchronizer;

  public static getInstance(): PropertyStatusSynchronizer {
    if (!PropertyStatusSynchronizer.instance) {
      PropertyStatusSynchronizer.instance = new PropertyStatusSynchronizer();
    }
    return PropertyStatusSynchronizer.instance;
  }

  /**
   * Synchronize property status based on unit statuses
   */
  async syncPropertyStatus(
    propertyId: string,
    options: PropertyStatusSyncOptions = {},
  ): Promise<PropertyStatusSyncResult> {
    return syncPropertyDerivedState(propertyId, options);
  }

  /**
   * Synchronize multiple properties
   */
  async syncMultipleProperties(
    propertyIds: string[],
    options: PropertyStatusSyncOptions = {},
  ): Promise<PropertyStatusSyncResult[]> {
    const results: PropertyStatusSyncResult[] = [];

    for (const propertyId of propertyIds) {
      try {
        const result = await this.syncPropertyStatus(propertyId, options);
        results.push(result);
      } catch {
        // Continue with other properties even if one fails
      }
    }

    return results;
  }

  /**
   * Synchronize all multi-unit properties
   */
  async syncAllMultiUnitProperties(
    options: PropertyStatusSyncOptions = {},
  ): Promise<PropertyStatusSyncResult[]> {
    const properties = await db.property.findMany({
      where: { isMultiUnit: true },
      select: { id: true },
    });

    const propertyIds = properties.map((property) => property.id);
    return await this.syncMultipleProperties(propertyIds, options);
  }

  /**
   * Trigger synchronization after unit status change
   */
  async syncAfterUnitStatusChange(
    propertyId: string,
    unitId: string,
    oldUnitStatus: PropertyStatus,
    newUnitStatus: PropertyStatus,
    options: PropertyStatusSyncOptions = {},
  ): Promise<PropertyStatusSyncResult> {
    const triggeredBy = options.triggeredBy || `unit-status-change:${unitId}`;

    return await this.syncPropertyStatus(propertyId, {
      ...options,
      triggeredBy,
    });
  }

  /**
   * Trigger synchronization after lease status change
   */
  async syncAfterLeaseStatusChange(
    propertyId: string,
    leaseId: string,
    unitId: string,
    oldLeaseStatus: string,
    newLeaseStatus: string,
    options: PropertyStatusSyncOptions = {},
  ): Promise<PropertyStatusSyncResult> {
    const triggeredBy = options.triggeredBy || `lease-status-change:${leaseId}`;

    return await this.syncPropertyStatus(propertyId, {
      ...options,
      triggeredBy,
    });
  }

  /**
   * Trigger synchronization after maintenance request status change
   */
  async syncAfterMaintenanceStatusChange(
    propertyId: string,
    maintenanceRequestId: string,
    unitId: string | null,
    oldStatus: string,
    newStatus: string,
    options: PropertyStatusSyncOptions = {},
  ): Promise<PropertyStatusSyncResult | null> {
    // Only sync if maintenance affects unit availability
    const affectsUnitStatus = this.maintenanceAffectsUnitStatus(
      oldStatus,
      newStatus,
    );

    if (!affectsUnitStatus || !unitId) {
      return null;
    }

    const triggeredBy =
      options.triggeredBy ||
      `maintenance-status-change:${maintenanceRequestId}`;

    return await this.syncPropertyStatus(propertyId, {
      ...options,
      triggeredBy,
    });
  }

  /**
   * Check if maintenance status change affects unit status
   */
  private maintenanceAffectsUnitStatus(
    oldStatus: string,
    newStatus: string,
  ): boolean {
    // Define maintenance statuses that affect unit availability
    const statusesThatMakeUnitUnavailable = ["IN_PROGRESS", "ASSIGNED"];
    const statusesThatMakeUnitAvailable = ["COMPLETED", "CANCELLED"];

    const oldAffectsAvailability =
      statusesThatMakeUnitUnavailable.includes(oldStatus);
    const newAffectsAvailability =
      statusesThatMakeUnitUnavailable.includes(newStatus);
    const newMakesAvailable = statusesThatMakeUnitAvailable.includes(newStatus);

    // Return true if there's a change in unit availability
    return (
      oldAffectsAvailability !== newAffectsAvailability || newMakesAvailable
    );
  }

  /**
   * Validate property status consistency
   */
  async validatePropertyStatusConsistency(propertyId: string): Promise<{
    isConsistent: boolean;
    currentStatus: PropertyStatus;
    calculatedStatus: PropertyStatus;
    recommendation: string;
  }> {
    const property = await db.property.findFirst({
      where: { id: propertyId },
      select: { id: true, status: true },
    });
    if (!property) {
      throw new Error(`Property not found: ${propertyId}`);
    }

    const units = await db.unit.findMany({
      where: { propertyId },
      select: { status: true },
    });

    const currentStatus = property.status as PropertyStatus;
    const unitStatuses = units.map((unit) => unit.status as PropertyStatus);
    const calculatedStatus = calculatePropertyStatusFromUnits(unitStatuses);

    const isConsistent = currentStatus === calculatedStatus;

    return {
      isConsistent,
      currentStatus,
      calculatedStatus,
      recommendation: isConsistent
        ? "Property status is consistent with unit statuses"
        : `Property status should be updated from ${currentStatus} to ${calculatedStatus}`,
    };
  }

  /**
   * Get synchronization statistics
   */
  async getSynchronizationStats(): Promise<{
    totalProperties: number;
    multiUnitProperties: number;
    inconsistentProperties: number;
    lastSyncTime: Date | null;
  }> {
    const [totalProperties, multiUnitProperties, properties] =
      await Promise.all([
        db.property.count(),
        db.property.count({ where: { isMultiUnit: true } }),
        db.property.findMany({
          where: { isMultiUnit: true },
          select: {
            id: true,
            status: true,
            // Relation reads skip the automatic soft-delete filter.
            units: { where: { deletedAt: null }, select: { status: true } },
          },
        }),
      ]);

    let inconsistentCount = 0;
    for (const property of properties) {
      const unitStatuses = property.units.map(
        (unit) => unit.status as PropertyStatus,
      );
      const calculatedStatus = calculatePropertyStatusFromUnits(unitStatuses);
      if (property.status !== calculatedStatus) {
        inconsistentCount++;
      }
    }

    return {
      totalProperties,
      multiUnitProperties,
      inconsistentProperties: inconsistentCount,
      lastSyncTime: new Date(), // In a real implementation, this would be stored
    };
  }
}

// Export singleton instance
export const propertyStatusSynchronizer =
  PropertyStatusSynchronizer.getInstance();
