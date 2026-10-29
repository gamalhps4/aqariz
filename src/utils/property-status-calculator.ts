import { PropertyStatus } from "@/types";

export interface UnitStatusSummary {
  available: number;
  occupied: number;
  maintenance: number;
  unavailable: number;
  total: number;
}

export function calculatePropertyStatusFromUnits(
  unitStatuses: PropertyStatus[]
): PropertyStatus {
  if (!unitStatuses || unitStatuses.length === 0) {
    return PropertyStatus.AVAILABLE;
  }

  const totalUnits = unitStatuses.length;
  const statusCounts: UnitStatusSummary = {
    available: unitStatuses.filter((s) => s === PropertyStatus.AVAILABLE)
      .length,
    occupied: unitStatuses.filter((s) => s === PropertyStatus.OCCUPIED).length,
    maintenance: unitStatuses.filter((s) => s === PropertyStatus.MAINTENANCE)
      .length,
    unavailable: unitStatuses.filter((s) => s === PropertyStatus.UNAVAILABLE)
      .length,
    total: totalUnits,
  };

  // Apply business logic
  if (statusCounts.occupied === totalUnits) {
    return PropertyStatus.OCCUPIED;
  }

  if (statusCounts.unavailable === totalUnits) {
    return PropertyStatus.UNAVAILABLE;
  }

  if (statusCounts.maintenance > 0 && statusCounts.available === 0) {
    return PropertyStatus.MAINTENANCE;
  }

  if (statusCounts.available > 0) {
    return PropertyStatus.AVAILABLE;
  }

  // Default fallback
  return PropertyStatus.AVAILABLE;
}

/**
 * Get unit status summary for display purposes
 */
export function getUnitStatusSummary(
  unitStatuses: PropertyStatus[]
): UnitStatusSummary {
  if (!unitStatuses || unitStatuses.length === 0) {
    return {
      available: 0,
      occupied: 0,
      maintenance: 0,
      unavailable: 0,
      total: 0,
    };
  }

  return {
    available: unitStatuses.filter((s) => s === PropertyStatus.AVAILABLE)
      .length,
    occupied: unitStatuses.filter((s) => s === PropertyStatus.OCCUPIED).length,
    maintenance: unitStatuses.filter((s) => s === PropertyStatus.MAINTENANCE)
      .length,
    unavailable: unitStatuses.filter((s) => s === PropertyStatus.UNAVAILABLE)
      .length,
    total: unitStatuses.length,
  };
}

/**
 * Check if property status should be updated based on unit changes
 */
export function shouldUpdatePropertyStatus(
  currentPropertyStatus: PropertyStatus,
  unitStatuses: PropertyStatus[]
): boolean {
  const calculatedStatus = calculatePropertyStatusFromUnits(unitStatuses);
  return currentPropertyStatus !== calculatedStatus;
}

/**
 * Get occupancy rate as percentage
 */
export function getOccupancyRate(unitStatuses: PropertyStatus[]): number {
  if (!unitStatuses || unitStatuses.length === 0) {
    return 0;
  }

  const occupiedCount = unitStatuses.filter(
    (s) => s === PropertyStatus.OCCUPIED
  ).length;
  return Math.round((occupiedCount / unitStatuses.length) * 100);
}

/**
 * Get availability rate as percentage
 */
export function getAvailabilityRate(unitStatuses: PropertyStatus[]): number {
  if (!unitStatuses || unitStatuses.length === 0) {
    return 0;
  }

  const availableCount = unitStatuses.filter(
    (s) => s === PropertyStatus.AVAILABLE
  ).length;
  return Math.round((availableCount / unitStatuses.length) * 100);
}

/**
 * Test scenarios for property status calculation
 */
export const testScenarios = {
  allOccupied: [
    PropertyStatus.OCCUPIED,
    PropertyStatus.OCCUPIED,
    PropertyStatus.OCCUPIED,
  ],
  allAvailable: [
    PropertyStatus.AVAILABLE,
    PropertyStatus.AVAILABLE,
    PropertyStatus.AVAILABLE,
  ],
  mixed: [
    PropertyStatus.OCCUPIED,
    PropertyStatus.AVAILABLE,
    PropertyStatus.MAINTENANCE,
  ],
  allUnavailable: [PropertyStatus.UNAVAILABLE, PropertyStatus.UNAVAILABLE],
  maintenanceOnly: [PropertyStatus.MAINTENANCE, PropertyStatus.MAINTENANCE],
  singleOccupied: [PropertyStatus.OCCUPIED],
  singleAvailable: [PropertyStatus.AVAILABLE],
};

// Test the business logic
if (typeof window === "undefined") {
  // Only run tests in Node.js environment (server-side)
  // Tests removed for production
}
