/**
 * PropertyPro - Unit Data Transformer
 * Handles data transformation between frontend forms and backend API
 */

import { IEmbeddedUnit } from "@/types";
import { businessDay } from "@/lib/dates/business-day";

// Frontend form data structure (what forms send)
export interface UnitFormData {
  unitNumber: string;
  unitType: string;
  floor?: number;
  bedrooms: number;
  bathrooms: number;
  squareFootage: number;
  /** Optional asking price — a reference only; each contract sets the rent. */
  rentAmount?: number;
  securityDeposit?: number;
  status: string;

  // Unit features (boolean flags)
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

  // Parking (flat structure from forms)
  parkingIncluded?: boolean;
  parkingSpaces?: number;
  parkingType?: "garage" | "covered" | "open" | "street";
  parkingGated?: boolean;
  parkingAssigned?: boolean;

  // Utilities (boolean flags from forms)
  electricityIncluded?: boolean;
  waterIncluded?: boolean;
  gasIncluded?: boolean;
  internetIncluded?: boolean;
  heatingIncluded?: boolean;
  coolingIncluded?: boolean;

  // Appliances (boolean flags)
  refrigerator?: boolean;
  stove?: boolean;
  oven?: boolean;
  microwave?: boolean;
  washer?: boolean;
  dryer?: boolean;

  // Additional fields
  notes?: string;
  images?: string[];
  attachments?: Array<{
    fileName: string;
    fileUrl: string;
    fileSize: number;
    fileType: string;
    uploadedAt?: string | Date;
    uploadedBy?: string;
  }>;
  availableFrom?: string;
  lastRenovated?: string;
  washerDryerHookups?: boolean;
}

/**
 * Transform frontend form data to backend API format
 */
export function transformFormDataToAPI(
  formData: UnitFormData
): Partial<IEmbeddedUnit> {
  return {
    unitNumber: formData?.unitNumber ?? "",
    unitType: formData?.unitType ?? "apartment",
    floor: formData?.floor,
    bedrooms: formData?.bedrooms ?? 0,
    bathrooms: formData?.bathrooms ?? 0,
    squareFootage: formData?.squareFootage ?? 0,
    rentAmount: formData?.rentAmount ?? 0,
    securityDeposit: formData?.securityDeposit ?? 0,
    status: formData?.status as any,

    // Unit features
    balcony: formData?.balcony || false,
    patio: formData?.patio || false,
    garden: formData?.garden || false,
    dishwasher: formData?.dishwasher || false,
    inUnitLaundry: formData?.inUnitLaundry || false,
    hardwoodFloors: formData?.hardwoodFloors || false,
    fireplace: formData?.fireplace || false,
    walkInClosets: formData?.walkInClosets || false,
    centralAir: formData?.centralAir || false,
    ceilingFans: formData?.ceilingFans || false,

    // Transform parking data
    parking: {
      included: formData?.parkingIncluded || false,
      spaces: formData?.parkingSpaces || 0,
      type: formData?.parkingType || "open",
      gated: formData?.parkingGated || false,
      assigned: formData?.parkingAssigned || false,
    },

    // Transform utilities data
    utilities: {
      electricity: formData?.electricityIncluded ? "included" : "tenant",
      water: formData?.waterIncluded ? "included" : "tenant",
      gas: formData?.gasIncluded ? "included" : "tenant",
      internet: formData?.internetIncluded ? "included" : "tenant",
      heating: formData?.heatingIncluded ? "included" : "tenant",
      cooling: formData?.coolingIncluded ? "included" : "tenant",
      cable: "tenant", // Default
      trash: "included", // Default
      sewer: "included", // Default
    },

    // Transform appliances data
    appliances: {
      refrigerator: formData?.refrigerator || false,
      stove: formData?.stove || false,
      oven: formData?.oven || false,
      microwave: formData?.microwave || false,
      dishwasher: formData?.dishwasher || false,
      washer: formData?.washer || false,
      dryer: formData?.dryer || false,
      washerDryerHookups: formData?.washerDryerHookups || false,
    },

    // Additional fields
    notes: formData?.notes || "",
    images: formData?.images || [],
    attachments: formData?.attachments?.map((att) => ({
      fileName: att.fileName,
      fileUrl: att.fileUrl,
      fileSize: att.fileSize,
      fileType: att.fileType,
      uploadedAt: att.uploadedAt ? new Date(att.uploadedAt) : new Date(),
      uploadedBy: att.uploadedBy as any,
    })),
    availableFrom: formData?.availableFrom
      ? new Date(formData.availableFrom)
      : undefined,
    lastRenovated: formData?.lastRenovated
      ? new Date(formData.lastRenovated)
      : undefined,
  };
}

/**
 * Transform backend API data to frontend form format
 */
export function transformAPIDataToForm(apiData: IEmbeddedUnit): UnitFormData {
  return {
    unitNumber: apiData?.unitNumber ?? "",
    unitType: apiData?.unitType ?? "apartment",
    floor: apiData?.floor,
    bedrooms: apiData?.bedrooms ?? 0,
    bathrooms: apiData?.bathrooms ?? 0,
    squareFootage: apiData?.squareFootage ?? 0,
    rentAmount: apiData?.rentAmount ?? 0,
    securityDeposit: apiData?.securityDeposit ?? 0,
    status: apiData?.status ?? "available",

    // Unit features
    balcony: apiData?.balcony || false,
    patio: apiData?.patio || false,
    garden: apiData?.garden || false,
    dishwasher: apiData?.dishwasher || false,
    inUnitLaundry: apiData?.inUnitLaundry || false,
    hardwoodFloors: apiData?.hardwoodFloors || false,
    fireplace: apiData?.fireplace || false,
    walkInClosets: apiData?.walkInClosets || false,
    centralAir: apiData?.centralAir || false,
    ceilingFans: apiData?.ceilingFans || false,

    // Transform parking data to flat structure
    parkingIncluded: apiData.parking?.included || false,
    parkingSpaces: apiData.parking?.spaces || 0,
    parkingType: apiData.parking?.type || "open",
    parkingGated: apiData.parking?.gated || false,
    parkingAssigned: apiData.parking?.assigned || false,

    // Transform utilities data to boolean flags
    electricityIncluded: apiData.utilities?.electricity === "included",
    waterIncluded: apiData.utilities?.water === "included",
    gasIncluded: apiData.utilities?.gas === "included",
    internetIncluded: apiData.utilities?.internet === "included",
    heatingIncluded: apiData.utilities?.heating === "included",
    coolingIncluded: apiData.utilities?.cooling === "included",

    // Transform appliances data
    refrigerator: apiData.appliances?.refrigerator || false,
    stove: apiData.appliances?.stove || false,
    oven: apiData.appliances?.oven || false,
    microwave: apiData.appliances?.microwave || false,
    washer: apiData.appliances?.washer || false,
    dryer: apiData.appliances?.dryer || false,
    washerDryerHookups: apiData.appliances?.washerDryerHookups || false,

    // Additional fields
    notes: apiData?.notes || "",
    images: apiData?.images || [],
    attachments:
      apiData?.attachments?.map((att) => ({
        fileName: att.fileName,
        fileUrl: att.fileUrl,
        fileSize: att.fileSize,
        fileType: att.fileType,
        uploadedAt:
          att.uploadedAt instanceof Date
            ? att.uploadedAt.toISOString()
            : att.uploadedAt,
        uploadedBy: att.uploadedBy?.toString(),
      })) || [],
    availableFrom: apiData?.availableFrom
      ? businessDay(apiData.availableFrom)
      : undefined,
    lastRenovated: apiData?.lastRenovated
      ? businessDay(apiData.lastRenovated)
      : undefined,
  };
}

/**
 * Validate unit data before transformation
 */
export function validateUnitData(data: UnitFormData): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!data.unitNumber?.trim()) {
    errors.push("Unit number is required");
  }

  if (!data.unitType) {
    errors.push("Unit type is required");
  }

  if (data.bedrooms < 0 || data.bedrooms > 20) {
    errors.push("Bedrooms must be between 0 and 20");
  }

  if (data.bathrooms < 0 || data.bathrooms > 20) {
    errors.push("Bathrooms must be between 0 and 20");
  }

  if (data.squareFootage < 50 || data.squareFootage > 50000) {
    errors.push("Square footage must be between 50 and 50,000");
  }

  const rentAmount = data.rentAmount ?? 0;
  const securityDeposit = data.securityDeposit ?? 0;

  if (rentAmount < 0 || rentAmount > 100000) {
    errors.push("Rent amount must be between 0 and 100,000");
  }

  if (securityDeposit < 0 || securityDeposit > 50000) {
    errors.push("Security deposit must be between 0 and 50,000");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * A price box's value as a number, or undefined while it is empty — so an
 * unpriced unit stays unpriced instead of turning into 0 or NaN as it is typed.
 */
export function optionalAmount(text: string): number | undefined {
  const amount = parseFloat(text);
  return Number.isFinite(amount) && amount >= 0 ? amount : undefined;
}
