/**
 * PropertyPro - Property Service
 * Comprehensive API service for property CRUD operations
 */

import { PropertyType, PropertyStatus } from "@/types";

// ============================================================================
// TYPES
// ============================================================================

export interface PropertyFormData {
  name: string;
  description?: string;
  type: PropertyType;
  status: PropertyStatus;
  address: {
    street: string;
    city: string;
    state: string;
    zipCode: string;
    country: string;
  };
  bedrooms: number;
  bathrooms: number;
  squareFootage: number;
  rentAmount: number;
  securityDeposit: number;
  amenities: Array<{
    name: string;
    description?: string;
    category: string;
  }>;

  // Enhanced fields
  isMultiUnit: boolean;
  totalUnits: number;
  // Note: units are now managed separately via Unit collection
  // Note: features are now consolidated into amenities
  attachments: Array<{
    fileName: string;
    fileUrl: string;
    fileSize: number;
    fileType: string;
    uploadedAt: Date;
    uploadedBy?: string;
  }>;

  images: string[];
  ownerId?: string; // Optional, for property managers to specify owner
  managerId?: string; // Optional, for admins to assign manager
}

export interface PropertyQueryParams {
  page?: number;
  limit?: number;
  search?: string;
  type?: PropertyType;
  status?: PropertyStatus;
  minRent?: number;
  maxRent?: number;
  bedrooms?: number;
  bathrooms?: number;
  city?: string;
  state?: string;
  unitType?: string;
  // unitNumber and status order the units list (/api/units) only.
  sortBy?: "name" | "rentAmount" | "createdAt" | "squareFootage" | "unitNumber" | "status";
  sortOrder?: "asc" | "desc";
  // Admin-only flag to include soft-deleted properties in results
  includeDeleted?: boolean;
}

export interface PropertyResponse {
  _id: string;
  name: string;
  description?: string;
  type: PropertyType;
  status: PropertyStatus;
  address: {
    street: string;
    city: string;
    state: string;
    zipCode: string;
    country: string;
  };
  // Note: bedrooms, bathrooms, squareFootage, rentAmount, securityDeposit
  // are now stored only at the unit level in the units array

  // Enhanced fields for multi-unit support
  isMultiUnit: boolean;
  totalUnits: number;
  // Unified approach: units are embedded in the property document
  units: Array<{
    _id?: string;
    unitNumber: string;
    unitType: string;
    floor?: number;
    bedrooms: number;
    bathrooms: number;
    squareFootage: number;
    rentAmount: number;
    securityDeposit: number;
    status: string;
    // Enhanced unit features
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
    appliances?: {
      refrigerator?: boolean;
      stove?: boolean;
      oven?: boolean;
      microwave?: boolean;
      dishwasher?: boolean;
      washer?: boolean;
      dryer?: boolean;
      washerDryerHookups?: boolean;
    };
    parking?: {
      included?: boolean;
      spaces?: number;
      type?: "garage" | "covered" | "open" | "street";
      gated?: boolean;
      assigned?: boolean;
    };
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
    notes?: string;
    images?: string[];
    availableFrom?: Date;
    lastRenovated?: Date;
    currentTenantId?: string;
    currentLeaseId?: string;
  }>;
  // Note: features are now consolidated into amenities
  basicAmenities?: {
    parking: string;
    laundry: string;
    airConditioning: string;
    heating: string;
    internet: boolean;
    cable: boolean;
    furnished: boolean;
    petsAllowed: boolean;
    smokingAllowed: boolean;
  };

  amenities: Array<{
    name: string;
    description?: string;
    category: string;
  }>;
  images: string[];
  ownerId: {
    _id: string;
    firstName: string;
    lastName: string;
    email: string;
  };
  managerId?: {
    _id: string;
    firstName: string;
    lastName: string;
    email: string;
  };
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface PaginatedPropertiesResponse {
  data: PropertyResponse[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

// Available Unit Response (flattened structure from aggregation)
export interface AvailableUnitResponse {
  _id: string;
  name: string;
  description?: string;
  type: PropertyType;
  status: PropertyStatus;
  address: {
    street: string;
    city: string;
    state: string;
    zipCode: string;
    country: string;
  };
  images: string[];
  amenities: Array<{
    name: string;
    category: string;
    description?: string;
  }>;
  yearBuilt?: number;
  isMultiUnit: boolean;
  totalUnits: number;
  owner?: {
    firstName: string;
    lastName: string;
    email: string;
  };
  manager?: {
    firstName: string;
    lastName: string;
    email: string;
  };
  createdAt: string;
  updatedAt: string;

  // Unit-specific data (flattened from units array)
  unitId: string;
  unitNumber: string;
  unitType: string;
  floor?: number;
  bedrooms: number;
  bathrooms: number;
  squareFootage: number;
  rentAmount: number;
  securityDeposit: number;
  unitStatus: string;
  unitFeatures?: {
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
  };
  unitAppliances?: {
    refrigerator?: boolean;
    stove?: boolean;
    oven?: boolean;
    microwave?: boolean;
    dishwasher?: boolean;
    washer?: boolean;
    dryer?: boolean;
    washerDryerHookups?: boolean;
  };
  unitParking?: {
    included?: boolean;
    spaces?: number;
    type?: "garage" | "covered" | "open" | "street";
    gated?: boolean;
    assigned?: boolean;
  };
  unitUtilities?: {
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
  unitNotes?: string;
  unitImages?: string[];
  availableFrom?: string;
  lastRenovated?: string;
  currentTenantId?: string;
  currentLeaseId?: string;
}

export interface PaginatedAvailableUnitsResponse {
  data: AvailableUnitResponse[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalProperties?: number;
    totalPages?: number;
    pages: number;
    hasNext: boolean;
    hasPrev: boolean;
    statusCounts?: {
      available: number;
      occupied: number;
      maintenance: number;
      unavailable: number;
    };
  };
}

// ============================================================================
// API SERVICE
// ============================================================================

class PropertyService {
  private baseUrl = "/api/properties";

  /**
   * Get all properties with pagination and filtering
   */
  async getProperties(
    params?: PropertyQueryParams
  ): Promise<PaginatedPropertiesResponse> {
    const searchParams = new URLSearchParams();

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "") {
          searchParams.append(key, value.toString());
        }
      });
    }

    const url = `${this.baseUrl}${
      searchParams.toString() ? `?${searchParams.toString()}` : ""
    }`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include", // Include cookies for authentication
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(
        error.error || error.message || "Failed to fetch properties"
      );
    }

    return response.json();
  }

  /**
   * Get available units with pagination and filtering
   * Uses the main properties endpoint with hasAvailableUnits filter
   */
  async getAvailableProperties(
    params?: PropertyQueryParams
  ): Promise<PaginatedAvailableUnitsResponse> {
    const searchParams = new URLSearchParams();

    // Add the hasAvailableUnits filter to get only properties with available units
    searchParams.append("hasAvailableUnits", "true");

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "") {
          searchParams.append(key, value.toString());
        }
      });
    }

    const url = `${this.baseUrl}${
      searchParams.toString() ? `?${searchParams.toString()}` : ""
    }`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include", // Include cookies for authentication
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(
        error.error || error.message || "Failed to fetch available units"
      );
    }

    const data = await response.json();

    // Transform the response to extract available units from properties
    const availableUnits: AvailableUnitResponse[] = [];

    if (Array.isArray(data?.data)) {
      data.data.forEach((property: any) => {
        if (Array.isArray(property?.units)) {
          property.units.forEach((unit: any) => {
            if (unit.status === "available") {
              availableUnits.push({
                _id: property._id,
                name: property.name,
                type: property.type,
                address: property.address,
                images: property.images || [],
                unitId: unit._id,
                unitNumber: unit.unitNumber,
                unitType: unit.unitType || "apartment",
                bedrooms: unit.bedrooms,
                bathrooms: unit.bathrooms,
                squareFootage: unit.squareFootage,
                rentAmount: unit.rentAmount,
                securityDeposit: unit.securityDeposit || 0,
                floor: unit.floor,
                description: unit.description || property.description,
                unitStatus: unit.status,
                amenities: property.amenities || [],
                yearBuilt: property.yearBuilt,
                isMultiUnit: property.isMultiUnit,
                totalUnits: property.totalUnits || 1,
                createdAt: property.createdAt,
                updatedAt: property.updatedAt,
              } as AvailableUnitResponse);
            }
          });
        }
      });
    }

    return {
      data: availableUnits,
      pagination: data.pagination || {
        page: 1,
        limit: params?.limit || 12,
        total: availableUnits.length,
        pages: 1,
        hasNext: false,
        hasPrev: false,
      },
    };
  }

  /**
   * Get a single property by ID
   */
  async getProperty(id: string): Promise<PropertyResponse> {
    const response = await fetch(`${this.baseUrl}/${id}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(
        error.error || error.message || "Failed to fetch property"
      );
    }

    const result = await response.json();
    return result.data;
  }

  /**
   * Create a new property
   */
  async createProperty(data: PropertyFormData): Promise<PropertyResponse> {
    const response = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const error = await response.json();

      // Provide user-friendly error messages
      const errorMessage =
        error.error || error.message || "Failed to create property";
      let userMessage = errorMessage;

      if (errorMessage?.includes("Invalid owner role")) {
        userMessage =
          "You need to specify a valid property owner. Property managers cannot be owners.";
      } else if (errorMessage?.includes("must specify an owner")) {
        userMessage = "Please select a property owner from the dropdown.";
      } else if (errorMessage?.includes("permission")) {
        userMessage =
          "You don't have permission to create properties. Please contact your administrator.";
      } else if (errorMessage?.includes("validation")) {
        userMessage = "Please check all required fields and try again.";
      }

      throw new Error(userMessage);
    }

    const result = await response.json();
    return result.data;
  }

  /**
   * Update an existing property
   */
  async updateProperty(
    id: string,
    data: Partial<PropertyFormData>
  ): Promise<PropertyResponse> {
    const response = await fetch(`${this.baseUrl}/${id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(
        error.error || error.message || "Failed to update property"
      );
    }

    const result = await response.json();
    return result.data;
  }

  /**
   * Delete a property (soft delete)
   */
  async deleteProperty(id: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/${id}`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
    });

    if (!response.ok) {
      const error = await response.json();

      // Handle specific error cases
      let errorMessage =
        error.error || error.message || "Failed to delete property";

      if (response.status === 410) {
        errorMessage = "This property has already been deleted";
      } else if (response.status === 409) {
        errorMessage =
          "Cannot delete property with active leases. Please terminate all leases first.";
      } else if (response.status === 404) {
        errorMessage = "Property not found";
      }

      throw new Error(errorMessage);
    }
  }

  /**
   * Update property status
   */
  async updatePropertyStatus(
    id: string,
    status: PropertyStatus
  ): Promise<PropertyResponse> {
    const response = await fetch(`${this.baseUrl}/${id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify({ status }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(
        error.error || error.message || "Failed to update property status"
      );
    }

    const result = await response.json();
    return result.data;
  }

  /**
   * Bulk update properties (admin only)
   */
  async bulkUpdateProperties(
    propertyIds: string[],
    updates: Partial<PropertyFormData>
  ): Promise<{ matchedCount: number; modifiedCount: number }> {
    const response = await fetch(this.baseUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify({ propertyIds, updates }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(
        error.error || error.message || "Failed to bulk update properties"
      );
    }

    const result = await response.json();
    return result.data;
  }

  /**
   * Bulk delete properties (admin only)
   */
  async bulkDeleteProperties(
    propertyIds: string[]
  ): Promise<{ matchedCount: number; modifiedCount: number }> {
    const response = await fetch(
      `${this.baseUrl}?ids=${propertyIds.join(",")}`,
      {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
      }
    );

    if (!response.ok) {
      const error = await response.json();

      // Handle specific error cases
      let errorMessage =
        error.error || error.message || "Failed to bulk delete properties";

      if (response.status === 400 && errorMessage.includes("already deleted")) {
        errorMessage =
          "Some or all of the selected properties have already been deleted";
      }

      throw new Error(errorMessage);
    }

    const result = await response.json();
    return result.data;
  }

  /**
   * Add images to property
   */
  async addPropertyImages(
    id: string,
    images: string[]
  ): Promise<PropertyResponse> {
    const response = await fetch(`${this.baseUrl}/${id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify({
        action: "addImages",
        images,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || error.message || "Failed to add images");
    }

    const result = await response.json();

    // Safe access to result data with validation
    if (!result || !result.data) {
      throw new Error("Invalid response format from server");
    }

    return result.data;
  }

  /**
   * Remove images from property
   */
  async removePropertyImages(
    id: string,
    images: string[]
  ): Promise<PropertyResponse> {
    const response = await fetch(`${this.baseUrl}/${id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify({
        action: "removeImages",
        images,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(
        error.error || error.message || "Failed to remove images"
      );
    }

    const result = await response.json();

    // Safe access to result data with validation
    if (!result || !result.data) {
      throw new Error("Invalid response format from server");
    }

    return result.data;
  }

  /**
   * Add amenities to property
   */
  async addPropertyAmenities(
    id: string,
    amenities: Array<{ name: string; description?: string; category: string }>
  ): Promise<PropertyResponse> {
    const response = await fetch(`${this.baseUrl}/${id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify({
        action: "addAmenities",
        amenities,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(
        error.error || error.message || "Failed to add amenities"
      );
    }

    const result = await response.json();
    return result.data;
  }

  /**
   * Remove amenities from property
   */
  async removePropertyAmenities(
    id: string,
    amenityNames: string[]
  ): Promise<PropertyResponse> {
    const response = await fetch(`${this.baseUrl}/${id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify({
        action: "removeAmenities",
        amenityNames,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(
        error.error || error.message || "Failed to remove amenities"
      );
    }

    const result = await response.json();
    return result.data;
  }

  /**
   * Upload property attachments
   */
  async uploadAttachments(files: File[]): Promise<
    Array<{
      fileName: string;
      fileUrl: string;
      fileSize: number;
      fileType: string;
      uploadedAt: Date;
      uploadedBy?: string;
    }>
  > {
    const formData = new FormData();
    files.forEach((file) => formData.append("files", file));

    const response = await fetch("/api/upload/attachments", {
      method: "POST",
      credentials: "include",
      body: formData,
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || errorData.message || "Failed to upload attachments");
    }

    const result = await response.json();
    return result.data.attachments;
  }

  /**
   * Get property statistics
   */
  async getPropertyStats(): Promise<{
    total: number;
    available: number;
    occupied: number;
    maintenance: number;
    totalRevenue: number;
    averageRent: number;
  }> {
    const response = await fetch(`${this.baseUrl}/stats`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || errorData.message || "Failed to get property statistics");
    }

    const result = await response.json();
    return result.data;
  }

  /**
   * Enhanced bulk operations
   */
  async enhancedBulkOperation(
    action: string,
    propertyIds: string[],
    data?: any
  ): Promise<{ modifiedCount: number; matchedCount: number }> {
    const response = await fetch(`${this.baseUrl}/bulk`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify({ action, propertyIds, data }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || errorData.message || "Failed to perform bulk operation");
    }

    const result = await response.json();
    return result.data;
  }

  async getAllUnits(
    params?: PropertyQueryParams
  ): Promise<PaginatedAvailableUnitsResponse> {
    const searchParams = new URLSearchParams();

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "") {
          searchParams.append(key, value.toString());
        }
      });
    }

    const url = `/api/units${
      searchParams.toString() ? `?${searchParams.toString()}` : ""
    }`;

    const response = await fetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || error.message || "Failed to fetch units");
    }

    const result = await response.json();

    return {
      data: (result.data || []) as AvailableUnitResponse[],
      pagination: result.pagination || {
        page: params?.page || 1,
        limit: params?.limit || 12,
        total: (result.data || []).length,
        pages: 1,
        hasNext: false,
        hasPrev: false,
      },
    };
  }
}

// Export singleton instance
export const propertyService = new PropertyService();
export default propertyService;
