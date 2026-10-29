/**
 * PropertyPro - Unit Service
 * Service layer for unit management operations
 */

import { PropertyStatus } from "@/types";
import {
  transformFormDataToAPI,
  UnitFormData,
} from "@/lib/utils/unit-transformer";

export interface UnitCreateData {
  unitNumber: string;
  unitType: string;
  floor?: number;
  bedrooms: number;
  bathrooms: number;
  squareFootage: number;
  rentAmount: number;
  securityDeposit: number;
  status: PropertyStatus;

  // Unit features
  balcony?: boolean;
  patio?: boolean;
  garden?: boolean;

  // Parking (nested structure)
  parking?: {
    included: boolean;
    spaces?: number;
    type?: "garage" | "covered" | "open" | "street";
  };

  // Utilities (nested structure)
  utilities?: {
    electricity?: boolean;
    water?: boolean;
    gas?: boolean;
    internet?: boolean;
    heating?: boolean;
    cooling?: boolean;
  };

  availableFrom?: string;
  notes?: string;
}

export interface UnitResponse {
  _id: string;
  unitNumber: string;
  unitType: string;
  floor?: number;
  bedrooms: number;
  bathrooms: number;
  squareFootage: number;
  rentAmount: number;
  securityDeposit: number;
  status: PropertyStatus;

  // Unit features
  balcony?: boolean;
  patio?: boolean;
  garden?: boolean;
  dishwasher?: boolean;
  inUnitLaundry?: boolean;
  hardwoodFloors?: boolean;
  fireplace?: boolean;
  walkInClosets?: boolean;
  centralAir?: boolean;
  ceilingFans?: boolean;

  // Appliances
  appliances?: {
    refrigerator?: boolean;
    stove?: boolean;
    oven?: boolean;
    microwave?: boolean;
    dishwasher?: boolean;
    washer?: boolean;
    dryer?: boolean;
  };

  // Parking
  parking?: {
    included: boolean;
    spaces?: number;
    type?: "garage" | "covered" | "open" | "street";
    gated?: boolean;
    assigned?: boolean;
  };

  // Utilities
  utilities?: {
    electricity?: "included" | "tenant" | "shared";
    water?: "included" | "tenant" | "shared";
    gas?: "included" | "tenant" | "shared";
    internet?: "included" | "tenant" | "shared";
    cable?: "included" | "tenant" | "shared";
    heating?: "included" | "tenant" | "shared";
    cooling?: "included" | "tenant" | "shared";
    trash?: "included" | "tenant" | "shared";
    sewer?: "included" | "tenant" | "shared";
  };

  // Current tenant info
  currentTenantId?: string;
  currentLeaseId?: string;

  availableFrom?: string;
  lastRenovated?: string;
  notes?: string;
  images?: string[];
  attachments?: Array<{
    fileName: string;
    fileUrl: string;
    fileSize: number;
    fileType: string;
    uploadedAt?: string;
    uploadedBy?: string;
  }>;
}

/**
 * The refusal the API wrote. Its routes answer `{ error }` (createErrorResponse
 * and the unit routes alike); this used to read `message`, which those bodies
 * leave empty, so "Unit number already exists" and the plan's unit limit both
 * reached the office as a bare "Failed to create unit".
 */
async function errorText(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null);
  return body?.error || body?.message || fallback;
}

class UnitService {
  private baseUrl = "/api/properties";

  /**
   * Get all units for a property
   */
  async getUnits(propertyId: string): Promise<UnitResponse[]> {
    const response = await fetch(`${this.baseUrl}/${propertyId}/units`);

    if (!response.ok) {
      throw new Error(await errorText(response, "Failed to fetch units"));
    }

    const units = await response.json();

    // Filter out any invalid units and ensure required properties exist
    return units
      .filter(
        (unit: any) =>
          unit && typeof unit === "object" && unit.unitNumber && unit.unitType
      )
      .map((unit: any) => ({
        ...unit,
        bedrooms: unit.bedrooms || 0,
        bathrooms: unit.bathrooms || 0,
        squareFootage: unit.squareFootage || 0,
        rentAmount: unit.rentAmount || 0,
        securityDeposit: unit.securityDeposit || 0,
        status: unit.status || "available",
      }));
  }

  /**
   * Get a specific unit
   */
  async getUnit(propertyId: string, unitId: string): Promise<UnitResponse> {
    const response = await fetch(
      `${this.baseUrl}/${propertyId}/units/${unitId}`
    );

    if (!response.ok) {
      throw new Error(await errorText(response, "Failed to fetch unit"));
    }

    return response.json();
  }

  /**
   * Create a new unit
   */
  async createUnit(
    propertyId: string,
    unitData: UnitFormData
  ): Promise<UnitResponse> {
    // Transform form data to API format
    const apiData = transformFormDataToAPI(unitData);

    const response = await fetch(`${this.baseUrl}/${propertyId}/units`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(apiData),
    });

    if (!response.ok) {
      throw new Error(await errorText(response, "Failed to create unit"));
    }

    return response.json();
  }

  /**
   * Update an existing unit
   */
  async updateUnit(
    propertyId: string,
    unitId: string,
    unitData: Partial<UnitFormData>
  ): Promise<UnitResponse> {
    // Transform form data to API format
    const apiData = transformFormDataToAPI(unitData as UnitFormData);

    const response = await fetch(
      `${this.baseUrl}/${propertyId}/units/${unitId}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(apiData),
      }
    );

    if (!response.ok) {
      throw new Error(await errorText(response, "Failed to update unit"));
    }

    return response.json();
  }

  /**
   * Update unit attachments
   */
  async updateUnitAttachments(
    propertyId: string,
    unitId: string,
    attachments: Array<{
      fileName: string;
      fileUrl: string;
      fileSize: number;
      fileType: string;
      uploadedAt?: string | Date;
      uploadedBy?: string;
    }>
  ): Promise<UnitResponse> {
    const response = await fetch(
      `${this.baseUrl}/${propertyId}/units/${unitId}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ attachments }),
      }
    );

    if (!response.ok) {
      throw new Error(await errorText(response, "Failed to update unit attachments"));
    }

    return response.json();
  }

  /**
   * Delete a unit
   */
  async deleteUnit(propertyId: string, unitId: string): Promise<void> {
    const response = await fetch(
      `${this.baseUrl}/${propertyId}/units/${unitId}`,
      {
        method: "DELETE",
      }
    );

    if (!response.ok) {
      throw new Error(await errorText(response, "Failed to delete unit"));
    }
  }

  /**
   * Get available units for a property
   */
  async getAvailableUnits(propertyId: string): Promise<UnitResponse[]> {
    const units = await this.getUnits(propertyId);
    return units.filter(
      (unit) => unit.status?.toLowerCase() === PropertyStatus.AVAILABLE
    );
  }

  /**
   * Get occupied units for a property
   */
  async getOccupiedUnits(propertyId: string): Promise<UnitResponse[]> {
    const units = await this.getUnits(propertyId);
    return units.filter(
      (unit) => unit.status?.toLowerCase() === PropertyStatus.OCCUPIED
    );
  }

  /**
   * Get units by floor
   */
  async getUnitsByFloor(
    propertyId: string,
    floor: number
  ): Promise<UnitResponse[]> {
    const units = await this.getUnits(propertyId);
    return units.filter((unit) => unit.floor === floor);
  }

  /**
   * Search units by criteria
   */
  async searchUnits(
    propertyId: string,
    criteria: {
      minRent?: number;
      maxRent?: number;
      bedrooms?: number;
      bathrooms?: number;
      status?: PropertyStatus;
      unitType?: string;
      hasParking?: boolean;
      hasBalcony?: boolean;
    }
  ): Promise<UnitResponse[]> {
    const units = await this.getUnits(propertyId);

    return units.filter((unit) => {
      if (criteria.minRent && unit.rentAmount < criteria.minRent) return false;
      if (criteria.maxRent && unit.rentAmount > criteria.maxRent) return false;
      if (criteria.bedrooms && unit.bedrooms !== criteria.bedrooms)
        return false;
      if (criteria.bathrooms && unit.bathrooms !== criteria.bathrooms)
        return false;
      if (
        criteria.status &&
        unit.status?.toLowerCase() !== criteria.status.toLowerCase()
      )
        return false;
      if (criteria.unitType && unit.unitType !== criteria.unitType)
        return false;
      if (criteria.hasParking && !unit.parking?.included) return false;
      if (criteria.hasBalcony && !unit.balcony) return false;

      return true;
    });
  }

  /**
   * Get unit statistics for a property
   */
  async getUnitStatistics(propertyId: string): Promise<{
    total: number;
    available: number;
    occupied: number;
    maintenance: number;
    unavailable: number;
    averageRent: number;
    totalRentPotential: number;
    occupancyRate: number;
  }> {
    const units = await this.getUnits(propertyId);

    const stats = {
      total: units.length,
      available: 0,
      occupied: 0,
      maintenance: 0,
      unavailable: 0,
      averageRent: 0,
      totalRentPotential: 0,
      occupancyRate: 0,
    };

    if (units.length === 0) return stats;

    units.forEach((unit) => {
      switch (unit.status) {
        case PropertyStatus.AVAILABLE:
          stats.available++;
          break;
        case PropertyStatus.OCCUPIED:
          stats.occupied++;
          break;
        case PropertyStatus.MAINTENANCE:
          stats.maintenance++;
          break;
        case PropertyStatus.UNAVAILABLE:
          stats.unavailable++;
          break;
      }

      stats.totalRentPotential += unit.rentAmount;
    });

    stats.averageRent = stats.totalRentPotential / units.length;
    stats.occupancyRate = (stats.occupied / units.length) * 100;

    return stats;
  }

  /**
   * Bulk update unit status
   */
  async bulkUpdateStatus(
    propertyId: string,
    unitIds: string[],
    status: PropertyStatus
  ): Promise<UnitResponse[]> {
    const updatePromises = unitIds.map((unitId) =>
      this.updateUnit(propertyId, unitId, { status })
    );

    return Promise.all(updatePromises);
  }
}

export const unitService = new UnitService();
