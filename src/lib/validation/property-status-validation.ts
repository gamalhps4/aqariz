/**
 * PropertyPro - Property Status Validation Utilities
 * Validation functions for property status synchronization
 */

import { PropertyStatus } from "@/types";

export interface PropertyStatusValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  recommendations: string[];
}

export interface UnitStatusTransition {
  unitId: string;
  unitNumber: string;
  oldStatus: PropertyStatus;
  newStatus: PropertyStatus;
  reason?: string;
}

export interface PropertyStatusTransition {
  propertyId: string;
  propertyName: string;
  oldStatus: PropertyStatus;
  newStatus: PropertyStatus;
  unitTransitions: UnitStatusTransition[];
  triggeredBy: string;
  timestamp: Date;
}

/**
 * Validate a single unit status transition
 */
export function validateUnitStatusTransition(
  transition: UnitStatusTransition
): PropertyStatusValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const recommendations: string[] = [];

  const { oldStatus, newStatus, unitNumber } = transition;

  // Define valid status transitions
  const validTransitions: Record<PropertyStatus, PropertyStatus[]> = {
    [PropertyStatus.AVAILABLE]: [
      PropertyStatus.OCCUPIED,
      PropertyStatus.MAINTENANCE,
      PropertyStatus.UNAVAILABLE,
    ],
    [PropertyStatus.OCCUPIED]: [
      PropertyStatus.AVAILABLE,
      PropertyStatus.MAINTENANCE,
      PropertyStatus.UNAVAILABLE,
    ],
    [PropertyStatus.MAINTENANCE]: [
      PropertyStatus.AVAILABLE,
      PropertyStatus.UNAVAILABLE,
    ],
    [PropertyStatus.UNAVAILABLE]: [
      PropertyStatus.AVAILABLE,
      PropertyStatus.MAINTENANCE,
    ],
  };

  // Check if transition is valid
  if (!validTransitions[oldStatus]?.includes(newStatus)) {
    errors.push(
      `Invalid status transition for unit ${unitNumber}: ${oldStatus} → ${newStatus}`
    );
  }

  // Add specific warnings for certain transitions
  if (
    oldStatus === PropertyStatus.OCCUPIED &&
    newStatus === PropertyStatus.AVAILABLE
  ) {
    warnings.push(
      `Unit ${unitNumber} transitioning from occupied to available - ensure lease is properly terminated`
    );
  }

  if (
    oldStatus === PropertyStatus.AVAILABLE &&
    newStatus === PropertyStatus.OCCUPIED
  ) {
    recommendations.push(
      `Unit ${unitNumber} transitioning to occupied - verify active lease exists`
    );
  }

  if (newStatus === PropertyStatus.MAINTENANCE) {
    recommendations.push(
      `Unit ${unitNumber} entering maintenance - consider creating maintenance request if not exists`
    );
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    recommendations,
  };
}

/**
 * Validate property status consistency with unit statuses
 */
export function validatePropertyStatusConsistency(
  propertyStatus: PropertyStatus,
  unitStatuses: PropertyStatus[]
): PropertyStatusValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const recommendations: string[] = [];

  if (unitStatuses.length === 0) {
    warnings.push("Property has no units - status validation skipped");
    return { isValid: true, errors, warnings, recommendations };
  }

  const totalUnits = unitStatuses.length;
  const statusCounts = {
    available: unitStatuses.filter((s) => s === PropertyStatus.AVAILABLE)
      .length,
    occupied: unitStatuses.filter((s) => s === PropertyStatus.OCCUPIED).length,
    maintenance: unitStatuses.filter((s) => s === PropertyStatus.MAINTENANCE)
      .length,
    unavailable: unitStatuses.filter((s) => s === PropertyStatus.UNAVAILABLE)
      .length,
  };

  // Calculate expected property status based on business rules
  let expectedStatus: PropertyStatus;

  if (statusCounts.occupied === totalUnits) {
    expectedStatus = PropertyStatus.OCCUPIED;
  } else if (statusCounts.unavailable === totalUnits) {
    expectedStatus = PropertyStatus.UNAVAILABLE;
  } else if (statusCounts.maintenance > 0 && statusCounts.available === 0) {
    expectedStatus = PropertyStatus.MAINTENANCE;
  } else {
    expectedStatus = PropertyStatus.AVAILABLE;
  }

  // Check consistency
  if (propertyStatus !== expectedStatus) {
    errors.push(
      `Property status (${propertyStatus}) inconsistent with unit statuses. Expected: ${expectedStatus}`
    );
    recommendations.push(
      `Update property status to ${expectedStatus} to match unit statuses`
    );
  }

  // Add informational warnings
  if (statusCounts.maintenance > 0) {
    warnings.push(
      `${statusCounts.maintenance} unit(s) in maintenance - monitor completion status`
    );
  }

  if (statusCounts.occupied > 0 && statusCounts.available > 0) {
    recommendations.push(
      `Mixed occupancy: ${statusCounts.occupied} occupied, ${statusCounts.available} available - consider marketing available units`
    );
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    recommendations,
  };
}

/**
 * Validate a complete property status transition
 */
export function validatePropertyStatusTransition(
  transition: PropertyStatusTransition
): PropertyStatusValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const recommendations: string[] = [];

  // Validate each unit transition
  for (const unitTransition of transition.unitTransitions) {
    const unitValidation = validateUnitStatusTransition(unitTransition);
    errors.push(...unitValidation.errors);
    warnings.push(...unitValidation.warnings);
    recommendations.push(...unitValidation.recommendations);
  }

  // Validate overall property status consistency
  const newUnitStatuses = transition.unitTransitions.map((t) => t.newStatus);
  const propertyValidation = validatePropertyStatusConsistency(
    transition.newStatus,
    newUnitStatuses
  );
  errors.push(...propertyValidation.errors);
  warnings.push(...propertyValidation.warnings);
  recommendations.push(...propertyValidation.recommendations);

  // Add transition-specific validations
  if (transition.oldStatus === transition.newStatus) {
    warnings.push(
      "Property status unchanged - synchronization may be unnecessary"
    );
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    recommendations,
  };
}

/**
 * Validate business rules for property status synchronization
 */
export function validateSynchronizationBusinessRules(
  propertyId: string,
  unitStatuses: PropertyStatus[],
  currentPropertyStatus: PropertyStatus
): PropertyStatusValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const recommendations: string[] = [];

  // Rule 1: All occupied units should have active leases
  const occupiedCount = unitStatuses.filter(
    (s) => s === PropertyStatus.OCCUPIED
  ).length;
  if (occupiedCount > 0) {
    recommendations.push(
      `Verify ${occupiedCount} occupied unit(s) have active leases`
    );
  }

  // Rule 2: Available units should not have active leases
  const availableCount = unitStatuses.filter(
    (s) => s === PropertyStatus.AVAILABLE
  ).length;
  if (availableCount > 0) {
    recommendations.push(
      `Verify ${availableCount} available unit(s) do not have active leases`
    );
  }

  // Rule 3: Maintenance units should have maintenance requests
  const maintenanceCount = unitStatuses.filter(
    (s) => s === PropertyStatus.MAINTENANCE
  ).length;
  if (maintenanceCount > 0) {
    recommendations.push(
      `Verify ${maintenanceCount} maintenance unit(s) have active maintenance requests`
    );
  }

  // Rule 4: Property should not be marked as occupied if any units are available
  if (currentPropertyStatus === PropertyStatus.OCCUPIED && availableCount > 0) {
    errors.push(
      "Property marked as occupied but has available units - status should be 'available'"
    );
  }

  // Rule 5: Property should not be marked as available if all units are occupied
  if (
    currentPropertyStatus === PropertyStatus.AVAILABLE &&
    occupiedCount === unitStatuses.length
  ) {
    errors.push(
      "Property marked as available but all units are occupied - status should be 'occupied'"
    );
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    recommendations,
  };
}

/**
 * Generate a comprehensive validation report
 */
export function generateValidationReport(
  propertyId: string,
  propertyName: string,
  currentStatus: PropertyStatus,
  unitStatuses: PropertyStatus[]
): {
  summary: string;
  isValid: boolean;
  totalErrors: number;
  totalWarnings: number;
  totalRecommendations: number;
  details: PropertyStatusValidationResult;
} {
  const consistencyValidation = validatePropertyStatusConsistency(
    currentStatus,
    unitStatuses
  );
  const businessRulesValidation = validateSynchronizationBusinessRules(
    propertyId,
    unitStatuses,
    currentStatus
  );

  const allErrors = [
    ...consistencyValidation.errors,
    ...businessRulesValidation.errors,
  ];
  const allWarnings = [
    ...consistencyValidation.warnings,
    ...businessRulesValidation.warnings,
  ];
  const allRecommendations = [
    ...consistencyValidation.recommendations,
    ...businessRulesValidation.recommendations,
  ];

  const isValid = allErrors.length === 0;
  const summary = isValid
    ? `Property ${propertyName} status is consistent and valid`
    : `Property ${propertyName} has ${allErrors.length} validation error(s)`;

  return {
    summary,
    isValid,
    totalErrors: allErrors.length,
    totalWarnings: allWarnings.length,
    totalRecommendations: allRecommendations.length,
    details: {
      isValid,
      errors: allErrors,
      warnings: allWarnings,
      recommendations: allRecommendations,
    },
  };
}
