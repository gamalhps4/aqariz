/**
 * PropertyPro - Property/Unit Prisma helpers
 *
 * Units moved from an embedded `property.units[]` array (MongoDB) to a real
 * `units` table (Postgres). The unit's boolean feature flags and the grouped
 * appliances/parking/utilities objects now live inside the `features` Json
 * column, while API payloads keep the historical flat shape. These helpers
 * translate between the two:
 *
 *   client body  --buildUnitFeatures/buildUnitScalarData-->  unit row
 *   unit row     --presentUnit-->                            legacy unit JSON
 *   property row --presentProperty-->                        legacy property JSON
 */

import { PropertyStatus } from "@/types";
import { calculatePropertyStatusFromUnits } from "@/utils/property-status-calculator";

/** Flat boolean feature flags stored inside the unit `features` Json column. */
export const UNIT_FEATURE_FLAGS = [
  "balcony",
  "patio",
  "garden",
  "dishwasher",
  "inUnitLaundry",
  "hardwoodFloors",
  "fireplace",
  "walkInClosets",
  "centralAir",
  "ceilingFans",
] as const;

type AnyRecord = Record<string, any>;

function asObject(value: unknown): AnyRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as AnyRecord)
    : {};
}

function toNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : undefined;
}

function toInt(value: unknown): number | undefined {
  const num = toNumber(value);
  return num === undefined ? undefined : Math.trunc(num);
}

function toDate(value: unknown): Date | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const date = value instanceof Date ? value : new Date(value as string);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * Mirror of the legacy parking handling: an explicit `parking` object wins,
 * else flat `parkingIncluded`/`parkingSpaces`/... form flags rebuild it, else
 * the fallback (existing value on update, `{ included: false }` on create).
 */
function buildParking(body: AnyRecord, existingParking?: AnyRecord): AnyRecord {
  if (body.parking) return body.parking;
  if (body.parkingIncluded !== undefined) {
    return {
      included: body.parkingIncluded || false,
      spaces: body.parkingSpaces || 0,
      type: body.parkingType || "open",
      gated: body.parkingGated || false,
      assigned: body.parkingAssigned || false,
    };
  }
  return existingParking ?? { included: false };
}

/**
 * Mirror of the legacy utilities handling: an explicit `utilities` object
 * wins, else it is rebuilt from the `*Included` form flags (cable/trash/sewer
 * carry over from the existing value, with the historical defaults).
 */
function buildUtilities(
  body: AnyRecord,
  existingUtilities?: AnyRecord,
): AnyRecord {
  if (body.utilities) return body.utilities;
  return {
    electricity: body.electricityIncluded ? "included" : "tenant",
    water: body.waterIncluded ? "included" : "tenant",
    gas: body.gasIncluded ? "included" : "tenant",
    internet: body.internetIncluded ? "included" : "tenant",
    heating: body.heatingIncluded ? "included" : "tenant",
    cooling: body.coolingIncluded ? "included" : "tenant",
    cable: existingUtilities?.cable || "tenant",
    trash: existingUtilities?.trash || "included",
    sewer: existingUtilities?.sewer || "included",
  };
}

/** Mirror of the legacy appliances handling. */
function buildAppliances(body: AnyRecord): AnyRecord {
  if (body.appliances) return body.appliances;
  return {
    refrigerator: body.refrigerator || false,
    stove: body.stove || false,
    oven: body.oven || false,
    microwave: body.microwave || false,
    dishwasher: body.dishwasher || false,
    washer: body.washer || false,
    dryer: body.dryer || false,
  };
}

/**
 * Assemble the `features` Json column for a unit from an API payload.
 * `existingFeatures` (the current column value) preserves flags a partial
 * update did not send — matching the old spread-existing-then-body merge.
 */
export function buildUnitFeatures(
  body: AnyRecord,
  existingFeatures?: unknown,
): AnyRecord {
  const existing = asObject(existingFeatures);
  const features: AnyRecord = {};

  for (const flag of UNIT_FEATURE_FLAGS) {
    features[flag] =
      body[flag] !== undefined
        ? Boolean(body[flag])
        : Boolean(existing[flag] ?? false);
  }

  features.appliances = buildAppliances(body);
  features.parking = buildParking(body, asObject(existing.parking));
  features.utilities = buildUtilities(body, asObject(existing.utilities));

  return features;
}

/**
 * Map the scalar unit columns from an API payload. Only fields present in the
 * body are included, so a partial update leaves the other columns untouched
 * (the old code merged body over the existing subdocument).
 */
export function buildUnitScalarData(body: AnyRecord): AnyRecord {
  const data: AnyRecord = {};

  if (body.unitNumber !== undefined) data.unitNumber = String(body.unitNumber);
  if (body.unitType !== undefined) data.unitType = String(body.unitType);

  const floor = toInt(body.floor);
  if (floor !== undefined) data.floor = floor;

  const numericFields = [
    "bedrooms",
    "bathrooms",
    "squareFootage",
    "rentAmount",
    "securityDeposit",
  ] as const;
  for (const field of numericFields) {
    const value = toNumber(body[field]);
    if (value !== undefined) data[field] = value;
  }

  if (body.status !== undefined) data.status = String(body.status);
  if (body.notes !== undefined) data.notes = body.notes ?? null;
  if (Array.isArray(body.images)) data.images = body.images.map(String);
  if (Array.isArray(body.attachments)) data.attachments = body.attachments;

  const availableFrom = toDate(body.availableFrom);
  if (availableFrom !== undefined) data.availableFrom = availableFrom;
  const lastRenovated = toDate(body.lastRenovated);
  if (lastRenovated !== undefined) data.lastRenovated = lastRenovated;

  return data;
}

/**
 * Convert a `units` table row back to the legacy embedded-unit JSON shape:
 * feature flags and appliances/parking/utilities flattened onto the unit
 * object, with the `_id` alias clients still read.
 */
export function presentUnit<T extends { id: string }>(unit: T): AnyRecord {
  const { features, ...rest } = unit as AnyRecord;
  return {
    ...rest,
    ...asObject(features),
    _id: unit.id,
  };
}

interface PresentPropertyOptions {
  /** Recompute display status from unit statuses (legacy GET behavior). */
  deriveStatus?: boolean;
}

/**
 * Convert a `properties` table row (optionally with included `units`,
 * `owner`, `manager` relations) back to the legacy JSON shape: nested
 * `address` object, populated `ownerId`/`managerId`, flattened units.
 */
export function presentProperty(
  property: AnyRecord,
  options: PresentPropertyOptions = {},
): AnyRecord {
  const { owner, manager, units, ...rest } = property;

  const presented: AnyRecord = {
    ...rest,
    address: {
      street: property.addressStreet,
      city: property.addressCity,
      district: property.addressDistrict,
      state: property.addressState,
      zipCode: property.addressZipCode,
      country: property.addressCountry,
    },
  };

  if (owner !== undefined) presented.ownerId = owner ?? rest.ownerId;
  if (manager !== undefined) presented.managerId = manager ?? rest.managerId;

  if (Array.isArray(units)) {
    presented.units = units.map((unit) => presentUnit(unit));

    if (options.deriveStatus && units.length > 0) {
      const unitStatuses = units
        .map((unit: AnyRecord) => unit?.status)
        .filter((status: any): status is PropertyStatus =>
          Object.values(PropertyStatus).includes(status),
        );
      if (unitStatuses.length > 0) {
        presented.status = calculatePropertyStatusFromUnits(unitStatuses);
      }
    }
  }

  return presented;
}
