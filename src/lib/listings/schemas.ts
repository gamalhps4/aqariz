/**
 * PropertyPro - Listing input, validated
 *
 * What the form and the API accept for one listing, field by field. A field
 * left out is "not given" (undefined); a field sent as null or "" is "clear
 * it". That difference is what lets the same schema serve a create and a
 * partial update without a save of the title wiping the licence.
 *
 * Rules that span fields — a sale is priced "total", a rent is not; a listing
 * about to be published needs a licence — need the stored row as well, so they
 * live in the service (and lib/listings/publish-rules.ts), not here.
 *
 * A new listing is one of two kinds. Made from a unit, it names the unit and
 * reads the property's type, area and rooms from it. For a property not in the
 * system (`standalone: true`) it names no unit and brings those details
 * itself — at least the type and the city, which its row and its address are
 * made from. Each kind refuses the other's fields, so a request cannot leave
 * the reader guessing which one it meant.
 *
 * Errors name the field and say what is wrong in English; the form maps the
 * field to its own message in the reader's language.
 */

import { z } from "zod";
import {
  INQUIRY_STATUSES,
  LISTING_LIMITS,
  LISTING_TYPES,
  PRICE_PERIODS,
} from "./constants";
import { parseDay } from "./dates";
import { isPlausibleLicenceNumber, normalizeLicenceNumber } from "./licence";
import { parsePhone } from "./phone";
import { isStorablePhotoUrl } from "./photos";
import { isValidSlug } from "./slug";

/** undefined stays undefined; null and blank become null; the rest is trimmed. */
function clean(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const text = value.trim();
  return text === "" ? null : text;
}

function optionalText(max: number) {
  return z
    .string()
    .nullish()
    .transform(clean)
    .refine((value) => !value || value.length <= max, {
      message: `Must be at most ${max} characters`,
    });
}

/** A title: never null in the table, so blank is the empty string. */
function title() {
  return z
    .string()
    .nullish()
    .transform((value) => (value === undefined ? undefined : (value ?? "").trim()))
    .refine((value) => value === undefined || value.length <= LISTING_LIMITS.title, {
      message: `Must be at most ${LISTING_LIMITS.title} characters`,
    });
}

function phoneField() {
  return z
    .string()
    .nullish()
    .transform(clean)
    .transform((value, context) => {
      if (value === undefined || value === null) return value;
      const parsed = parsePhone(value);
      if (!parsed) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Enter a valid phone number",
        });
        return z.NEVER;
      }
      return parsed.e164;
    });
}

const priceField = z
  .preprocess(
    (value) =>
      typeof value === "string" && value.trim() !== "" ? Number(value) : value,
    z
      .number({ invalid_type_error: "Enter a price" })
      .min(0, "The price cannot be negative")
      .max(LISTING_LIMITS.price, "The price is too high"),
  )
  .optional();

const photosField = z
  .array(z.string())
  .max(LISTING_LIMITS.photos, `At most ${LISTING_LIMITS.photos} photos`)
  .transform((list) => list.map((url) => url.trim()).filter(Boolean))
  .refine((list) => list.every(isStorablePhotoUrl), {
    message: "A photo address is not a web address",
  })
  .transform((list) => [...new Set(list)])
  .optional();

const amenitiesField = z
  .array(z.string())
  .max(LISTING_LIMITS.amenities, `At most ${LISTING_LIMITS.amenities} amenities`)
  .transform((list) =>
    [...new Set(list.map((item) => item.trim()).filter(Boolean))],
  )
  .refine((list) => list.every((item) => item.length <= LISTING_LIMITS.amenity), {
    message: `An amenity is at most ${LISTING_LIMITS.amenity} characters`,
  })
  .optional();

const licenceNumberField = z
  .string()
  .nullish()
  .transform((value) =>
    value === undefined ? undefined : normalizeLicenceNumber(value),
  )
  .refine((value) => !value || isPlausibleLicenceNumber(value), {
    message: "Enter the licence number as it appears on the licence",
  });

const dayField = z
  .string()
  .nullish()
  .transform(clean)
  .transform((value, context) => {
    if (value === undefined || value === null) return value;
    const day = parseDay(value);
    if (!day) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enter a valid date",
      });
      return z.NEVER;
    }
    return day;
  });

/**
 * A whole number or a decimal within bounds, for the details of a property
 * not in the system. Left out stays undefined; null or "" is "clear it".
 */
function optionalNumber(options: { min: number; max: number; integer?: boolean }) {
  return z
    .union([z.number(), z.string(), z.null()])
    .optional()
    .transform((value, context) => {
      if (value === undefined) return undefined;
      if (value === null) return null;
      const text = typeof value === "string" ? value.trim() : value;
      if (text === "") return null;
      const number = typeof text === "number" ? text : Number(text);
      if (!Number.isFinite(number)) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a number" });
        return z.NEVER;
      }
      if (options.integer && !Number.isInteger(number)) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a whole number" });
        return z.NEVER;
      }
      if (number < options.min || number > options.max) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Must be between ${options.min} and ${options.max}`,
        });
        return z.NEVER;
      }
      return number;
    });
}

/**
 * What a listing for a property not in the system says about the property, in
 * place of a unit and its building. The type is a unit category slug, the
 * same as a unit's (the service checks the office has it).
 */
export const standaloneDetailsShape = {
  propertyType: optionalText(LISTING_LIMITS.propertyType),
  addressLine: optionalText(LISTING_LIMITS.addressLine),
  areaSqm: optionalNumber({ min: 0, max: LISTING_LIMITS.areaSqm }),
  bedrooms: optionalNumber({ min: 0, max: LISTING_LIMITS.rooms, integer: true }),
  bathrooms: optionalNumber({ min: 0, max: LISTING_LIMITS.rooms, integer: true }),
  floor: optionalNumber({
    min: LISTING_LIMITS.floorMin,
    max: LISTING_LIMITS.floorMax,
    integer: true,
  }),
};

export const STANDALONE_DETAIL_KEYS = Object.keys(
  standaloneDetailsShape,
) as Array<keyof typeof standaloneDetailsShape>;

/** The fields of a listing a person edits. Everything is optional here. */
export const listingFieldsShape = {
  type: z.enum(LISTING_TYPES).optional(),
  slug: z
    .string()
    .nullish()
    .transform(clean)
    .refine((value) => !value || isValidSlug(value), {
      message:
        "Use lower-case English letters, digits and single dashes (3 to 60 characters)",
    }),
  titleAr: title(),
  titleEn: title(),
  descriptionAr: optionalText(LISTING_LIMITS.description),
  descriptionEn: optionalText(LISTING_LIMITS.description),
  price: priceField,
  pricePeriod: z.enum(PRICE_PERIODS).optional(),
  photos: photosField,
  amenities: amenitiesField,
  city: optionalText(LISTING_LIMITS.city),
  district: optionalText(LISTING_LIMITS.district),
  contactPhone: phoneField(),
  whatsappNumber: phoneField(),
  adLicenceNumber: licenceNumberField,
  adLicenceExpiry: dayField,
  ...standaloneDetailsShape,
};

export const listingCreateSchema = z
  .object({
    /** The vacant unit to advertise. Left out for a property not in the system. */
    unitId: z
      .string()
      .trim()
      .min(1, "Choose the unit to advertise")
      .max(64)
      .nullish(),
    /** A property the office has not added to the system: no unit, its own details. */
    standalone: z.boolean().optional(),
    ...listingFieldsShape,
  })
  .superRefine((value, context) => {
    const issue = (path: string, message: string) =>
      context.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });

    if (value.standalone) {
      if (value.unitId) {
        issue("unitId", "A listing for a property not in the system has no unit");
      }
      if (!value.propertyType) issue("propertyType", "Choose the property type");
      if (!value.city) issue("city", "Enter the city");
      return;
    }
    // A blank id has already been refused by the field itself.
    if (value.unitId === undefined || value.unitId === null) {
      issue("unitId", "Choose the unit to advertise");
    }
    if (!value.unitId) return;
    // A listing made from a unit reads these from the unit; a value sent for
    // one would be stored and never shown.
    for (const key of STANDALONE_DETAIL_KEYS) {
      if (value[key] !== undefined && value[key] !== null) {
        issue(key, "A listing made from a unit takes this from the unit");
      }
    }
  });

export const listingUpdateSchema = z.object(listingFieldsShape);

export type ListingCreateInput = z.infer<typeof listingCreateSchema>;
export type ListingUpdateInput = z.infer<typeof listingUpdateSchema>;

/** publish | unpublish | archive | restore */
export const LISTING_ACTIONS = [
  "publish",
  "unpublish",
  "archive",
  "restore",
] as const;
export type ListingAction = (typeof LISTING_ACTIONS)[number];

export const listingActionSchema = z.object({
  action: z.enum(LISTING_ACTIONS),
});

export const inquiryUpdateSchema = z
  .object({
    status: z.enum(INQUIRY_STATUSES).optional(),
    assigneeId: z.string().trim().max(64).nullish(),
    notes: z
      .string()
      .nullish()
      .transform(clean)
      .refine((value) => !value || value.length <= 2000, {
        message: "Notes are at most 2000 characters",
      }),
  })
  .refine(
    (value) =>
      value.status !== undefined ||
      value.assigneeId !== undefined ||
      value.notes !== undefined,
    { message: "Nothing to change" },
  );

export type InquiryUpdateInput = z.infer<typeof inquiryUpdateSchema>;

/** One line per problem: `field: message`. */
export function issueLines(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.join(".");
    return path ? `${path}: ${issue.message}` : issue.message;
  });
}
