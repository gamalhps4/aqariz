/**
 * PropertyPro - Validation Schemas
 * Zod schemas for form validation and API request validation
 */

import { z } from "zod";
import {
  PropertyStatus,
  UserRole,
  PaymentType,
  PaymentMethod,
  MaintenancePriority,
  TicketPriority,
  TicketCategory,
  InvoiceType,
  ExpenseStatus,
} from "@/types";
import { isValidPhoneNumber } from "@/lib/utils";
import {
  DEFAULT_COUNTRY,
  APP_CURRENCY,
  DEFAULT_LANGUAGE,
} from "@/lib/regional/region";
import {
  PLAN_LIMIT_KEYS,
  PLAN_LIMITS_ALLOWING_ZERO,
  isPlanFeatureKey,
} from "@/lib/billing/plan-constants";
import {
  CTA_CARD_ICON_KEYS,
  CUSTOM_SECTION_BACKGROUNDS,
  CUSTOM_SECTION_ID_PATTERN,
  CUSTOM_SECTION_IMAGE_POSITIONS,
  LANDING_SECTION_KEYS,
  MAX_CUSTOM_SECTIONS,
  isCustomSectionKey,
  type LandingSlotKey,
} from "@/lib/marketing/landing-types";
import { isSafeLandingHref } from "@/lib/marketing/landing-i18n";
import { PASSWORD_MIN_LENGTH } from "@/lib/password-policy";
import { MAX_UNIT_NUMBER_LENGTH } from "@/lib/units/bulk-names";
import {
  MANUAL_PAYMENT_METHOD_ERROR,
  isManualPaymentMethod,
} from "@/lib/payments/methods";

/**
 * The largest amount any money field accepts — a guard against a typo, not a
 * business rule. Rent on a lease is per installment, so an annual Saudi lease
 * carries the whole year's rent in one amount, and 100,000 (the old cap)
 * refused ordinary villas and shops. Well inside Decimal(14, 2).
 */

/**
 * A currency field: whatever code arrives, SAR is what is stored. The app
 * works in riyal only (lib/regional/region); refusing another code would
 * break an older screen still sending the one it was showing.
 */
const appCurrencyField = z
  .string()
  .trim()
  .max(8)
  .transform(() => APP_CURRENCY);

export const MAX_MONEY = 100_000_000;

// A 24-hex-char MongoDB ObjectId in string form.
export const objectIdSchema = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, "Invalid id format");

// Post-migration database id (cuid/uuid-ish). Mirrors api-utils isValidObjectId.
export const dbIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{8,64}$/, "Invalid ID format");

// ============================================================================
// PHONE NUMBER VALIDATION
// ============================================================================

// Custom phone number validation that accepts various formats
const phoneValidation = z
  .string()
  .refine((phone) => isValidPhoneNumber(phone), {
    message: "Invalid phone number format",
  });

// ============================================================================
// USER VALIDATIONS
// ============================================================================

// Emergency contact validation schema (all fields optional)
export const emergencyContactSchema = z.object({
  name: z.string().max(100, "Name too long").optional(),
  relationship: z.string().max(50, "Relationship too long").optional(),
  phone: z.string().optional(),
  email: z.string().email("Invalid email address").optional(),
});

// Employment info validation schema
export const employmentInfoSchema = z.object({
  employer: z
    .string()
    .min(1, "Employer is required")
    .max(200, "Employer name too long"),
  position: z
    .string()
    .min(1, "Position is required")
    .max(100, "Position too long"),
  income: z
    .number()
    .min(0, "Income cannot be negative")
    .max(10000000, "Income too high"),
  startDate: z.date(),
});

/**
 * An email address that may simply not exist.
 *
 * A person's record and a login account are not the same thing. An owner or a
 * tenant is a party to a contract, and this office records many of them with
 * a phone number and a national ID and nothing else; `User.email` is nullable
 * for exactly that reason. Accepts a blank string because that is what an
 * untouched form field sends, and normalises it away at the call site.
 *
 * NOT for staff: an employee account exists in order to sign in, and sign-in
 * resolves by email. Those paths keep `userSchema`.
 */
export const personEmail = (message = "Invalid email address") =>
  // Trim-then-refine rather than `.email()`, so that a blank field means
  // "absent" instead of "malformed": an untouched input sends "" and a
  // fat-fingered one sends " ", and both are the same statement — this
  // person has no email address. Deliberately not `z.preprocess`, whose
  // `unknown` input type breaks react-hook-form's inference on the forms
  // that share this schema. Mirrors `optionalEmail` further down this file.
  z
    .string()
    .trim()
    .max(200)
    .refine((v) => v === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), message)
    .optional();

export const personEmailSchema = personEmail();

export const userSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z
    .string()
    .min(
      PASSWORD_MIN_LENGTH,
      `Password must be at least ${PASSWORD_MIN_LENGTH} characters`
    ),
  firstName: z
    .string()
    .min(1, "First name is required")
    .max(50, "First name too long"),
  lastName: z
    .string()
    .min(1, "Last name is required")
    .max(50, "Last name too long"),
  phone: z.string().optional(),
  role: z.nativeEnum(UserRole),
  avatar: z.string().url("Invalid avatar URL").optional().or(z.literal("")),
  bio: z.string().max(500, "Bio too long").optional(),
  location: z.string().max(100, "Location too long").optional(),
  city: z.string().max(50, "City too long").optional(),
  website: z.string().url("Invalid website URL").optional().or(z.literal("")),
  address: z.string().max(200, "Address too long").optional(),
  // Tenant-specific fields (optional for all users, only used when role is 'tenant')
  tenantStatus: z
    .enum([
      "application_submitted",
      "under_review",
      "approved",
      "active",
      "inactive",
      "moved_out",
      "terminated",
    ])
    .optional(),
  dateOfBirth: z.date().optional(),
  ssn: z
    .string()
    .optional()
    .transform((val) => {
      if (!val || val.trim() === "") return undefined;
      return val.trim();
    })
    .refine(
      (val) => {
        if (!val) return true; // Allow empty/undefined values
        return /^\d{3}-?\d{2}-?\d{4}$/.test(val);
      },
      { message: "Invalid SSN format" }
    ),
  employmentInfo: employmentInfoSchema.optional(),
  emergencyContacts: z
    .array(emergencyContactSchema)
    .max(5, "Too many emergency contacts")
    .optional(),
  documents: z.array(z.string()).max(20, "Too many documents").optional(),
  creditScore: z
    .number()
    .min(300, "Credit score too low")
    .max(850, "Credit score too high")
    .optional(),
  backgroundCheckStatus: z.enum(["pending", "approved", "rejected"]).optional(),
  applicationDate: z.date().optional(),
  moveInDate: z.date().optional(),
  moveOutDate: z.date().optional(),
});

/**
 * What a signed-in person may change on their own user row through
 * `PUT /api/user/profile`: name, email, phone, picture, about, address and
 * place, website, birth date and emergency contacts. Nothing else.
 *
 * It used to be `userSchema.omit({ password }).partial()`, and every role
 * holds profile_management, so a tenant could send `{"role":"admin"}` and
 * become the office's administrator, or set their own tenant status, credit
 * score and documents. The fields keep `userSchema`'s rules; the list is what
 * changed. Strict: a key not named here is refused, never silently applied
 * or silently dropped.
 */
export const ownProfileUpdateSchema = userSchema
  .pick({
    firstName: true,
    lastName: true,
    email: true,
    phone: true,
    avatar: true,
    bio: true,
    location: true,
    city: true,
    website: true,
    address: true,
    emergencyContacts: true,
  })
  .extend({
    // A JSON body carries a date as text ("1990-05-01" or ISO); null clears it.
    dateOfBirth: z.union([
      z
        .string()
        .trim()
        .refine((value) => {
          const time = Date.parse(value);
          return (
            Number.isFinite(time) &&
            time <= Date.now() &&
            time >= Date.UTC(1900, 0, 1)
          );
        }, "Invalid birth date")
        .transform((value) => new Date(value)),
      z.null(),
    ]),
  })
  .partial()
  .strict();

/**
 * What a tenant may change on their own tenant record through
 * `PUT /api/tenants/[id]`. The rest of that form is the office's record of
 * them: the name and ID number on the contract, their status, documents,
 * email (changed through the confirmed change-email flow) and so on. The
 * route used to take all of it from a tenant too. Strict, like the profile.
 */
export const tenantSelfEditSchema = z
  .object({
    phone: z.string().trim().max(30, "Phone number too long"),
    emergencyContacts: z
      .array(emergencyContactSchema)
      .max(5, "Too many emergency contacts"),
  })
  .partial()
  .strict();

export const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

export const registerSchema = userSchema
  .extend({
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

// ============================================================================
// PROPERTY VALIDATIONS
// ============================================================================

/**
 * A property-category / unit-type key. These moved out of a compile-time enum
 * into the per-organization `property_categories` table, so validation here is
 * shape-only — the route confirms the slug exists and is active for the
 * organization (see src/lib/property-categories.ts).
 *
 * Letters are matched with the Unicode property escape rather than [a-z] so a
 * category added under an Arabic name keeps a meaningful slug.
 */
export const categorySlugSchema = z
  .string()
  .min(1, "Category is required")
  .max(60, "Category key too long")
  .regex(/^[\p{L}\p{N}_]+$/u, "Invalid category key");

/**
 * An agreement's fee cycle: monthly | quarterly | semi_annual | annual —
 * mirrored by agreements_fee_frequency_check.
 */
export const paymentFrequencySchema = z.enum([
  "monthly",
  "quarterly",
  "semi_annual",
  "annual",
]);

/**
 * A lease contract's installment cycle: the agreement cycles plus every four
 * months — mirrored by leases_payment_frequency_check.
 */
export const leasePaymentFrequencySchema = z.enum([
  "monthly",
  "quarterly",
  "four_monthly",
  "semi_annual",
  "annual",
]);

/**
 * A contract's rent for the whole term. Null clears it, returning the
 * contract to rent per installment; absent leaves it as it is.
 */
const contractAmountSchema = z
  .number()
  .positive("Contract amount must be greater than zero")
  .max(MAX_MONEY, "Contract amount too high")
  .nullable()
  .optional();

/**
 * Optional, not required, and deliberately so: the district is a tier the
 * market uses but not one every recorded address has, and refusing to save a
 * property until someone remembers its حي would block work over a field the
 * office can fill in later. Markets without the tier simply never send it
 * (see `RegionProfile.address` in lib/regional/region.ts).
 */
export const addressSchema = z.object({
  street: z
    .string()
    .min(1, "Street address is required")
    .max(200, "Street address too long"),
  city: z.string().min(1, "City is required").max(100, "City name too long"),
  district: z.string().max(100, "District name too long").optional(),
  state: z.string().min(1, "State is required").max(50, "State name too long"),
  zipCode: z
    .string()
    .min(1, "ZIP/Postal code is required")
    .max(20, "ZIP/Postal code is too long"),
  country: z
    .string()
    .min(1, "Country is required")
    .max(100, "Country name too long")
    .default(DEFAULT_COUNTRY),
});

export const amenitySchema = z.object({
  name: z
    .string()
    .min(1, "Amenity name is required")
    .max(100, "Amenity name too long"),
  description: z.string().max(500, "Description too long").optional(),
  category: z.enum([
    "Kitchen",
    "Bathroom",
    "Living",
    "Bedroom",
    "Outdoor",
    "Parking",
    "Security",
    "Utilities",
    "Recreation",
    "Laundry",
    "Climate",
    "Other",
  ]),
});

// Unit amenities schema
const unitAmenitiesSchema = z.object({
  parking: z
    .enum(["none", "street", "garage", "covered", "open"])
    .default("none"),
  laundry: z.enum(["none", "in-unit", "shared", "hookups"]).default("none"),
  airConditioning: z
    .enum(["none", "central", "window", "split"])
    .default("none"),
  heating: z
    .enum(["none", "central", "baseboard", "radiator", "fireplace"])
    .default("none"),
});

// Enhanced unit schema for comprehensive unit management
export const unitSchema = z.object({
  // Basic Information
  // The column's own limit, which "Add multiple units" and the single-unit
  // create already allow: at 20 here a building whose units were added that
  // way could no longer be saved.
  unitNumber: z.string().min(1).max(MAX_UNIT_NUMBER_LENGTH),
  // Unit types are organization-configurable rows in `property_categories`
  // now, so shape is all zod can check; the route verifies the slug exists
  // and is active via `assertUnitTypeSlugs`.
  unitType: categorySlugSchema,
  // Null is a unit with no floor recorded — every unit added in bulk or by
  // import. Refusing it made the whole building unsaveable.
  floor: z.number().min(0).max(200).nullable().optional(),
  bedrooms: z.number().min(0).max(20),
  bathrooms: z.number().min(0).max(20),
  // Square metres now; the 50 minimum was square feet and refused studios.
  // 0 is "not recorded", as units added in bulk or by import are stored.
  squareFootage: z.number().min(0).max(50000),
  // A unit's asking price is a reference only — the rent is agreed in each
  // contract — so a unit can be recorded without one.
  rentAmount: z.number().min(0).max(MAX_MONEY).optional(),
  securityDeposit: z.number().min(0).max(MAX_MONEY).optional(),
  status: z.nativeEnum(PropertyStatus).default(PropertyStatus.AVAILABLE),

  // Outdoor Features
  balcony: z.boolean().default(false),
  patio: z.boolean().default(false),
  garden: z.boolean().default(false),

  // Interior Features
  dishwasher: z.boolean().default(false),
  inUnitLaundry: z.boolean().default(false),
  hardwoodFloors: z.boolean().default(false),
  fireplace: z.boolean().default(false),
  walkInClosets: z.boolean().default(false),
  centralAir: z.boolean().default(false),
  ceilingFans: z.boolean().default(false),

  // Appliances
  appliances: z
    .object({
      refrigerator: z.boolean().default(false),
      stove: z.boolean().default(false),
      oven: z.boolean().default(false),
      microwave: z.boolean().default(false),
      dishwasher: z.boolean().default(false),
      washer: z.boolean().default(false),
      dryer: z.boolean().default(false),
      washerDryerHookups: z.boolean().default(false),
    })
    .default({}),

  // Parking Details
  parking: z
    .object({
      included: z.boolean().default(false),
      spaces: z.number().min(0).max(10).default(0),
      type: z.enum(["garage", "covered", "open", "street"]).default("open"),
      gated: z.boolean().default(false),
      assigned: z.boolean().default(false),
    })
    .default({}),

  // Utilities Included
  utilities: z
    .object({
      electricity: z.enum(["included", "tenant", "shared"]).default("tenant"),
      water: z.enum(["included", "tenant", "shared"]).default("tenant"),
      gas: z.enum(["included", "tenant", "shared"]).default("tenant"),
      internet: z.enum(["included", "tenant", "shared"]).default("tenant"),
      cable: z.enum(["included", "tenant", "shared"]).default("tenant"),
      heating: z.enum(["included", "tenant", "shared"]).default("tenant"),
      cooling: z.enum(["included", "tenant", "shared"]).default("tenant"),
      trash: z.enum(["included", "tenant", "shared"]).default("included"),
      sewer: z.enum(["included", "tenant", "shared"]).default("included"),
    })
    .default({}),

  // Additional Details
  notes: z.string().max(1000).optional(),
  images: z.array(z.string()).default([]),
  attachments: z
    .array(
      z.object({
        fileName: z.string().min(1),
        fileUrl: z.string().url(),
        fileSize: z.number().min(0),
        fileType: z.string().min(1),
      })
    )
    .max(20)
    .default([]),
  availableFrom: z.date().optional(),
  lastRenovated: z.date().optional(),
});

// Property attachment schema
const propertyAttachmentSchema = z.object({
  fileName: z.string().min(1),
  fileUrl: z.string().url(),
  fileSize: z.number().min(0),
  fileType: z.string().min(1),
});

// Export unit form data type
export type InlineUnitFormData = z.infer<typeof unitSchema>;

// Enhanced property validation schemas
export const propertyCreateSchema = z.object({
  // Basic Information
  name: z
    .string()
    .min(1, "Property name is required")
    .max(200, "Property name too long"),
  description: z.string().max(2000, "Description too long").optional(),
  // Property categories are organization-configurable (see
  // src/lib/property-categories.ts); the route validates the slug against the
  // organization's active list.
  type: categorySlugSchema,
  status: z.nativeEnum(PropertyStatus).default(PropertyStatus.AVAILABLE),

  // Address
  address: addressSchema,

  // Property Type Configuration
  isMultiUnit: z.boolean().default(false),
  totalUnits: z.number().min(1).max(1000).default(1),

  // Embedded Units array (unified approach)
  // Note: bedrooms, bathrooms, squareFootage, rentAmount, securityDeposit
  // are now stored only at the unit level in the units array
  // These fields have been removed from property-level validation

  // Year Built — optional; null clears it on an update.
  yearBuilt: z
    .number()
    .min(1800, "Year built cannot be before 1800")
    .max(
      new Date().getFullYear() + 5,
      "Year built cannot be more than 5 years in the future"
    )
    .nullable()
    .optional(),

  // Property Features
  features: z.array(z.string()).default([]),

  // Property Amenities
  amenities: z.array(amenitySchema).max(50, "Too many amenities").default([]),

  // Images and Attachments
  images: z.array(z.string()).max(20, "Too many images").default([]),
  attachments: z
    .array(propertyAttachmentSchema)
    .max(20, "Too many attachments")
    .default([]),

  // Parent compound / residential complex. Optional and detachable — a
  // property inside a compound stays independently manageable.
  compoundId: z.string().min(1).max(64).nullable().optional(),

  /**
   * Who owns the building. Required, and never inferred.
   *
   * This was optional, and the route filled it with the signed-in user when
   * it was missing. The create form did not ask, so every building a
   * management office added became the office's own: wrong owner statements,
   * empty owner portals, and agreements that disagreed with the building they
   * covered. A landlord who does own the building sends their own id — the
   * same answer, given rather than assumed.
   */
  ownerId: z
    .string({ required_error: "Select who owns this property" })
    .min(1, "Select who owns this property")
    .max(64),
  managerId: z.string().min(1, "Manager ID is required").optional(),

  // Unified Units Array (embedded units)
  units: z.array(unitSchema).max(1000, "Too many units").default([]),
});

export const propertyUpdateSchema = propertyCreateSchema
  .partial()
  .omit({ ownerId: true, managerId: true }); // Regular users can't change ownership or management

export const propertyQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(10),
  search: z.string().optional(),
  type: categorySlugSchema.optional(),
  status: z.nativeEnum(PropertyStatus).optional(),
  minRent: z.coerce.number().min(0).optional(),
  maxRent: z.coerce.number().min(0).optional(),
  bedrooms: z.coerce.number().min(0).optional(),
  bathrooms: z.coerce.number().min(0).optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  unitType: categorySlugSchema.optional(),
  compoundId: z.string().min(1).max(64).optional(),
  ownerId: z.string().min(1).max(64).optional(),
  sortBy: z
    .enum(["name", "rentAmount", "createdAt", "squareFootage"])
    .default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

// Legacy schema for backward compatibility
export const propertySchema = propertyCreateSchema;

/**
 * Ownership changes are split out of `propertyUpdateSchema` (which omits them
 * entirely) so the route can gate them behind an admin check rather than
 * letting any editor reassign a building's owner.
 */
export const propertyOwnershipUpdateSchema = z
  .object({
    ownerId: z.string().min(1).max(64).optional(),
    managerId: z.string().min(1).max(64).nullable().optional(),
  })
  .refine(
    (data) => data.ownerId !== undefined || data.managerId !== undefined,
    { message: "Provide an owner or a manager to assign" },
  );

// ============================================================================
// CATEGORY VALIDATIONS (property categories & unit types)
// ============================================================================

export const categoryKindSchema = z.enum(["property", "unit"]);

// No `.default()`/`.transform()` here: `validateSchema` is typed off a
// single-parameter `z.ZodSchema<T>`, so a schema whose input and output types
// differ loses its narrowing at the call site. The route applies the defaults.
export const propertyCategoryQuerySchema = z.object({
  kind: categoryKindSchema.optional(),
  /** Forms want only what is offerable; the management screen wants everything. */
  activeOnly: z.enum(["true", "false"]).optional(),
});

export const propertyCategoryCreateSchema = z.object({
  kind: categoryKindSchema,
  /** Derived from `nameEn` when omitted. */
  slug: categorySlugSchema.optional(),
  nameEn: z.string().min(1, "English name is required").max(80),
  nameAr: z.string().max(80).nullable().optional(),
  description: z.string().max(500).nullable().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

// `slug` is deliberately absent: it is the value already stored on every
// property/unit row, so renaming it would orphan them.
export const propertyCategoryUpdateSchema = z.object({
  nameEn: z.string().min(1).max(80).optional(),
  nameAr: z.string().max(80).nullable().optional(),
  description: z.string().max(500).nullable().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

// ============================================================================
// CLIENT COMMUNICATION VALIDATIONS
// ============================================================================

export const communicationChannelSchema = z.enum([
  "call",
  "email",
  "meeting",
  "whatsapp",
  "sms",
  "letter",
  "note",
]);

export const communicationDirectionSchema = z.enum([
  "inbound",
  "outbound",
  "internal",
]);

export const communicationCreateSchema = z.object({
  channel: communicationChannelSchema,
  direction: communicationDirectionSchema.optional(),
  subject: z.string().min(1, "A subject is required").max(200),
  body: z.string().max(5000).nullable().optional(),
  /** When it happened, not when it was typed up. */
  occurredAt: z.coerce.date().optional(),
  propertyId: z.string().min(1).max(64).nullable().optional(),
  leaseId: z.string().min(1).max(64).nullable().optional(),
  followUpAt: z.coerce.date().nullable().optional(),
});

export const communicationUpdateSchema = z.object({
  channel: communicationChannelSchema.optional(),
  direction: communicationDirectionSchema.optional(),
  subject: z.string().min(1).max(200).optional(),
  body: z.string().max(5000).nullable().optional(),
  occurredAt: z.coerce.date().optional(),
  propertyId: z.string().min(1).max(64).nullable().optional(),
  leaseId: z.string().min(1).max(64).nullable().optional(),
  followUpAt: z.coerce.date().nullable().optional(),
  followUpDone: z.boolean().optional(),
});

// ============================================================================
// AGREEMENT VALIDATIONS
// ============================================================================

export const agreementFeeTypeSchema = z.enum(["percentage", "fixed"]);
/**
 * "management" — the office runs the buildings for a commission.
 * "investment" — the office rents them from the owner for a fixed amount.
 * Any other value would be stored and silently treated as management.
 */
export const agreementKindSchema = z.enum(["management", "investment"]);
export const commissionBasisSchema = z.enum(["collected", "billed"]);
export const agreementStatusSchema = z.enum([
  "draft",
  "active",
  "expired",
  "terminated",
]);

/**
 * A management agreement is scoped to one property, one compound, or (with
 * neither) the owner's whole portfolio. Naming both a property and a compound
 * would make its precedence ambiguous, so it is refused here and by a CHECK
 * constraint in the database.
 */
export const agreementCreateSchema = z
  .object({
    kind: agreementKindSchema.optional(),
    agreementNumber: z.string().trim().max(60).nullable().optional(),
    ownerId: z.string().min(1, "Owner is required").max(64),
    propertyId: z.string().min(1).max(64).nullable().optional(),
    compoundId: z.string().min(1).max(64).nullable().optional(),
    feeType: agreementFeeTypeSchema,
    feePercentage: z
      .number()
      .min(0, "Fee cannot be negative")
      .max(100, "Fee cannot exceed 100%")
      .optional(),
    feeAmount: z.number().min(0, "Fee cannot be negative").max(10_000_000).optional(),
    feeFrequency: paymentFrequencySchema.optional(),
    commissionBasis: commissionBasisSchema.optional(),
    currency: appCurrencyField.optional(),
    startDate: z.coerce.date({ required_error: "Start date is required" }),
    endDate: z.coerce.date().nullable().optional(),
    status: agreementStatusSchema.optional(),
    notes: z.string().max(2000).nullable().optional(),
    documents: z.array(z.string()).max(20).optional(),
  })
  .refine((data) => !(data.propertyId && data.compoundId), {
    message: "An agreement covers a property or a compound, not both",
    path: ["compoundId"],
  })
  .refine((data) => !data.endDate || data.endDate > data.startDate, {
    message: "End date must be after the start date",
    path: ["endDate"],
  })
  .refine(
    (data) =>
      data.feeType !== "percentage" ||
      (data.feePercentage !== undefined && data.feePercentage > 0),
    { message: "A percentage fee needs a rate above zero", path: ["feePercentage"] },
  )
  .refine(
    (data) =>
      data.feeType !== "fixed" ||
      (data.feeAmount !== undefined && data.feeAmount > 0),
    { message: "A fixed fee needs an amount above zero", path: ["feeAmount"] },
  )
  .refine((data) => data.kind !== "investment" || data.feeType === "fixed", {
    message:
      "An investment agreement pays the owner a fixed amount, not a percentage",
    path: ["feeType"],
  });

/** Partial edit. The same cross-field rules are re-checked in the route. */
export const agreementUpdateSchema = z.object({
  agreementNumber: z.string().trim().max(60).nullable().optional(),
  propertyId: z.string().min(1).max(64).nullable().optional(),
  compoundId: z.string().min(1).max(64).nullable().optional(),
  feeType: agreementFeeTypeSchema.optional(),
  feePercentage: z.number().min(0).max(100).optional(),
  feeAmount: z.number().min(0).max(10_000_000).optional(),
  feeFrequency: paymentFrequencySchema.optional(),
  commissionBasis: commissionBasisSchema.optional(),
  currency: appCurrencyField.optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().nullable().optional(),
  status: agreementStatusSchema.optional(),
  notes: z.string().max(2000).nullable().optional(),
  documents: z.array(z.string()).max(20).optional(),
});

export const agreementTerminateSchema = z.object({
  terminationDate: z.coerce.date({
    required_error: "Termination date is required",
  }),
  reason: z.string().min(1, "A reason is required").max(1000),
});

// ============================================================================
// OWNER PROFILE VALIDATIONS
// ============================================================================

/**
 * An owner profile enriches a user who already owns property; it never
 * establishes ownership itself (that is `Property.ownerId`). Every field is
 * optional because a self-managing landlord needs no profile at all.
 */
export const ownerProfileCreateSchema = z.object({
  userId: z.string().min(1, "User is required").max(64),
  companyName: z.string().max(200).nullable().optional(),
  nationalId: z.string().max(60).nullable().optional(),
  taxNumber: z.string().max(60).nullable().optional(),
  addressStreet: z.string().max(200).nullable().optional(),
  addressCity: z.string().max(100).nullable().optional(),
  addressDistrict: z.string().max(100).nullable().optional(),
  addressCountry: z.string().max(100).nullable().optional(),
  payoutMethod: z.string().max(60).nullable().optional(),
  bankName: z.string().max(120).nullable().optional(),
  bankAccountName: z.string().max(160).nullable().optional(),
  bankIban: z.string().max(60).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  isActive: z.boolean().optional(),
});

export const ownerProfileUpdateSchema = ownerProfileCreateSchema.omit({
  userId: true,
});

/**
 * Adding an owner the office has never dealt with before: the person record
 * and their profile in one step.
 *
 * This is the half the owners page was missing. `ownerProfileCreateSchema`
 * can only enrich a user that already exists, so adding a new owner meant
 * first going to Administration → Users and knowing to pick the Owner role —
 * which is why the review reported that owners could not be added at all.
 */
export const ownerPersonCreateSchema = ownerProfileCreateSchema
  .omit({ userId: true })
  .extend({
    // One name field on the form, split losslessly (lib/full-name.ts): a
    // one-word name — a company, a person known by one name — leaves
    // `lastName` empty rather than being refused.
    firstName: z.string().trim().min(1, "A name is required.").max(160),
    lastName: z.string().trim().max(160).optional().default(""),
    // Optional: an owner is a client of the office, not a login. Many are
    // recorded with a phone number and a commercial registration number and
    // never sign in at all. See `optionalEmailSchema`.
    email: personEmailSchema,
    phone: z.string().trim().max(40).nullable().optional(),
  });

// ============================================================================
// COMPOUND / RESIDENTIAL COMPLEX VALIDATIONS
// ============================================================================

export const compoundCreateSchema = z.object({
  name: z
    .string()
    .min(1, "Compound name is required")
    .max(200, "Compound name too long"),
  code: z.string().max(40, "Code too long").nullable().optional(),
  description: z.string().max(2000, "Description too long").nullable().optional(),
  address: addressSchema,
  totalArea: z.number().min(0).max(100_000_000).nullable().optional(),
  yearBuilt: z
    .number()
    .int()
    .min(1800, "Year built cannot be before 1800")
    .max(
      new Date().getFullYear() + 5,
      "Year built cannot be more than 5 years in the future",
    )
    .nullable()
    .optional(),
  amenities: z.array(amenitySchema).max(50, "Too many amenities").default([]),
  images: z.array(z.string()).max(20, "Too many images").default([]),
  attachments: z
    .array(propertyAttachmentSchema)
    .max(20, "Too many attachments")
    .default([]),
  ownerId: z.string().min(1).max(64).nullable().optional(),
  managerId: z.string().min(1).max(64).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  /** Properties to attach on create; each stays independently manageable. */
  propertyIds: z.array(z.string().min(1).max(64)).max(500).optional(),
});

export const compoundUpdateSchema = compoundCreateSchema.partial();

export const compoundQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(10),
  search: z.string().optional(),
  city: z.string().optional(),
  ownerId: z.string().min(1).max(64).optional(),
  managerId: z.string().min(1).max(64).optional(),
  sortBy: z.enum(["name", "createdAt", "city"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

/** Attach/detach properties on an existing compound. */
export const compoundPropertiesSchema = z.object({
  attach: z.array(z.string().min(1).max(64)).max(500).optional(),
  detach: z.array(z.string().min(1).max(64)).max(500).optional(),
});

// ============================================================================
// TENANT VALIDATIONS
// ============================================================================

// Note: emergencyContactSchema and employmentInfoSchema are defined above in USER VALIDATIONS section

export const tenantSchema = z.object({
  userId: z.string().min(1, "User ID is required"),
  dateOfBirth: z
    .union([z.string(), z.date()])
    .optional()
    .transform((val) => {
      if (!val) return undefined;
      if (typeof val === "string") return new Date(val);
      return val;
    }),
  ssn: z
    .string()
    .optional()
    .transform((val) => {
      if (!val || val.trim() === "") return undefined;
      return val.trim();
    })
    .refine(
      (val) => {
        if (!val) return true; // Allow empty/undefined values
        return /^\d{3}-?\d{2}-?\d{4}$/.test(val);
      },
      { message: "Invalid SSN format" }
    )
    .transform((val) => {
      if (!val) return val;
      // Remove any existing dashes and add them in the correct format
      const cleaned = val.replace(/\D/g, "");
      if (cleaned.length === 9) {
        return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 5)}-${cleaned.slice(
          5
        )}`;
      }
      return val;
    }),
  employmentInfo: employmentInfoSchema.optional(),
  emergencyContacts: z
    .array(emergencyContactSchema)
    .max(5, "Too many emergency contacts")
    .default([]),
  creditScore: z
    .number()
    .min(300, "Credit score too low")
    .max(850, "Credit score too high")
    .optional(),
  backgroundCheckStatus: z
    .enum(["pending", "approved", "rejected"])
    .default("pending"),
  moveInDate: z
    .union([z.string(), z.date()])
    .optional()
    .transform((val) => {
      if (!val || (typeof val === "string" && val.trim() === ""))
        return undefined;
      if (typeof val === "string") {
        const date = new Date(val);
        if (isNaN(date.getTime())) return undefined;
        return date;
      }
      return val;
    })
    .refine(
      (val) => {
        if (!val) return true; // Allow empty/undefined values

        const moveDate = new Date(val);
        if (isNaN(moveDate.getTime())) return false;

        // Allow move-in dates from 5 years ago to 5 years in the future
        const fiveYearsAgo = new Date();
        fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5);

        const fiveYearsFromNow = new Date();
        fiveYearsFromNow.setFullYear(fiveYearsFromNow.getFullYear() + 5);

        return moveDate >= fiveYearsAgo && moveDate <= fiveYearsFromNow;
      },
      {
        message:
          "Move-in date must be within reasonable range (5 years ago to 5 years from now)",
      }
    ),
  applicationDate: z
    .union([z.string(), z.date()])
    .optional()
    .transform((val) => {
      if (!val) return new Date();
      if (typeof val === "string") return new Date(val);
      return val;
    }),
  documents: z.array(z.string()).default([]),
});

// ============================================================================
// LEASE VALIDATIONS
// ============================================================================

export const lateFeeConfigSchema = z.object({
  enabled: z.boolean().default(false),
  gracePeriodDays: z
    .number()
    .min(0, "Grace period cannot be negative")
    .max(30, "Grace period cannot exceed 30 days")
    .default(5),
  feeType: z.enum(["fixed", "percentage", "tiered", "daily"]).default("fixed"),
  feeAmount: z
    .number()
    .min(0, "Fee amount cannot be negative")
    .max(MAX_MONEY, "Fee amount too high"),
  maxFeeAmount: z
    .number()
    .min(0, "Maximum fee amount cannot be negative")
    .optional(),
  minFeeAmount: z
    .number()
    .min(0, "Minimum fee amount cannot be negative")
    .optional(),
  compoundDaily: z.boolean().default(false),
  notificationDays: z.array(z.number()).default([3, 7, 14]),
});

export const leasePaymentConfigSchema = z.object({
  rentDueDay: z
    .number()
    .min(1, "Rent due day must be between 1 and 31")
    .max(31, "Rent due day must be between 1 and 31")
    .default(1),
  // Late fees are no longer offered; only leases saved before that carry one.
  lateFeeConfig: lateFeeConfigSchema.optional(),
  autoGenerateInvoices: z.boolean().default(true),
  autoEmailInvoices: z.boolean().default(false),
  autoCreatePayments: z.boolean().default(true),
  prorationEnabled: z.boolean().default(true),
  advancePaymentMonths: z
    .number()
    .min(0, "Advance payment months cannot be negative")
    .max(12, "Advance payment months cannot exceed 12")
    .default(0),
});

export const leaseTermsSchema = z.object({
  rentAmount: z
    .number()
    .min(0, "Rent cannot be negative")
    .max(MAX_MONEY, "Rent too high"),
  securityDeposit: z
    .number()
    .min(0, "Security deposit cannot be negative")
    .max(MAX_MONEY, "Security deposit too high"),
  lateFee: z
    .number()
    .min(0, "Late fee cannot be negative")
    .max(MAX_MONEY, "Late fee too high")
    .optional(),
  petDeposit: z
    .number()
    .min(0, "Pet deposit cannot be negative")
    .max(5000, "Pet deposit too high")
    .optional(),
  utilities: z
    .array(
      z.enum([
        "electricity",
        "gas",
        "water",
        "sewer",
        "trash",
        "internet",
        "cable",
        "heating",
        "cooling",
        "landscaping",
      ])
    )
    .default([]),
  restrictions: z
    .array(z.string())
    .max(20, "Too many restrictions")
    .default([]),
  paymentConfig: leasePaymentConfigSchema.optional(),
});

/**
 * Contract-level fields introduced with the lease contract module: the
 * authority reference number, how often rent falls due, and whether this
 * particular contract carries tax.
 */
export const leaseContractFieldsSchema = z.object({
  contractNumber: z
    .string()
    .trim()
    .max(60, "Contract number too long")
    .nullable()
    .optional(),
  paymentFrequency: leasePaymentFrequencySchema.optional(),
  taxEnabled: z.boolean().optional(),
  taxRate: z
    .number()
    .min(0, "Tax rate cannot be negative")
    .max(100, "Tax rate cannot exceed 100%")
    .optional(),
});

export const leaseSchema = z
  .object({
    propertyId: z.string().min(1, "Property ID is required"),
    unitId: z.string().min(1, "Unit ID is required"),
    tenantId: z.string().min(1, "Tenant ID is required"),
    contractNumber: z
      .string()
      .trim()
      .max(60, "Contract number too long")
      .nullable()
      .optional(),
    paymentFrequency: leasePaymentFrequencySchema.optional(),
    contractAmount: contractAmountSchema,
    // Optional utility charges billed with each installment.
    electricityAmount: z
      .number()
      .min(0, "Electricity charge cannot be negative")
      .optional(),
    waterAmount: z
      .number()
      .min(0, "Water charge cannot be negative")
      .optional(),
    taxEnabled: z.boolean().optional(),
    taxRate: z
      .number()
      .min(0, "Tax rate cannot be negative")
      .max(100, "Tax rate cannot exceed 100%")
      .optional(),
    startDate: z
      .string()
      .min(1, "Start date is required")
      .transform((val) => {
        const date = new Date(val);
        if (isNaN(date.getTime())) {
          throw new Error("Invalid start date format");
        }
        return date;
      }),
    endDate: z
      .string()
      .min(1, "End date is required")
      .transform((val) => {
        const date = new Date(val);
        if (isNaN(date.getTime())) {
          throw new Error("Invalid end date format");
        }
        return date;
      }),
    status: z
      .enum(["draft", "pending", "active", "expired", "terminated"])
      .optional(),
    terms: leaseTermsSchema,
    documents: z.array(z.string().url("Invalid document URL")).optional(),
    renewalOptions: z
      .object({
        available: z.boolean().default(false),
        terms: z.string().max(1000, "Renewal terms too long").optional(),
      })
      .optional(),
    notes: z.string().max(2000, "Notes too long").optional(),
  })
  .refine((data) => data.endDate > data.startDate, {
    message: "End date must be after start date",
    path: ["endDate"],
  });

// Lease update schema (partial without refinement for updates)
export const leaseUpdateSchema = z.object({
  propertyId: z.string().min(1, "Property ID is required").optional(),
  unitId: z.string().min(1, "Unit ID is required").optional(),
  tenantId: z.string().min(1, "Tenant ID is required").optional(),
  contractNumber: z
    .string()
    .trim()
    .max(60, "Contract number too long")
    .nullable()
    .optional(),
  paymentFrequency: leasePaymentFrequencySchema.optional(),
  contractAmount: contractAmountSchema,
  // The edit form sends these; without them here `parse` stripped them and a
  // changed utility charge was silently dropped.
  electricityAmount: z
    .number()
    .min(0, "Electricity charge cannot be negative")
    .optional(),
  waterAmount: z
    .number()
    .min(0, "Water charge cannot be negative")
    .optional(),
  taxEnabled: z.boolean().optional(),
  taxRate: z
    .number()
    .min(0, "Tax rate cannot be negative")
    .max(100, "Tax rate cannot exceed 100%")
    .optional(),
  startDate: z
    .string()
    .min(1, "Start date is required")
    .transform((val) => {
      const date = new Date(val);
      if (isNaN(date.getTime())) {
        throw new Error("Invalid start date format");
      }
      return date;
    })
    .optional(),
  endDate: z
    .string()
    .min(1, "End date is required")
    .transform((val) => {
      const date = new Date(val);
      if (isNaN(date.getTime())) {
        throw new Error("Invalid end date format");
      }
      return date;
    })
    .optional(),
  status: z
    .enum(["draft", "pending", "active", "expired", "terminated"])
    .optional(),
  terms: leaseTermsSchema.partial().optional(),
  documents: z.array(z.string().url("Invalid document URL")).optional(),
  renewalOptions: z
    .object({
      available: z.boolean().default(false),
      terms: z.string().max(1000, "Renewal terms too long").optional(),
    })
    .optional(),
  notes: z.string().max(2000, "Notes too long").optional(),
});

// ============================================================================
// PAYMENT VALIDATIONS
// ============================================================================

/**
 * A method staff may record a payment with — one of MANUAL_PAYMENT_METHODS.
 *
 * Every route that records money uses this. An unknown value is refused, not
 * turned into cash: a guessed method puts the money on the wrong side of the
 * owner statement, because cash to the office and cash to the owner settle in
 * opposite directions.
 */
export const manualPaymentMethodSchema = z
  .string({ required_error: MANUAL_PAYMENT_METHOD_ERROR })
  .refine(isManualPaymentMethod, { message: MANUAL_PAYMENT_METHOD_ERROR });

export const paymentSchema = z.object({
  tenantId: z.string().min(1, "Tenant ID is required"),
  propertyId: z.string().min(1, "Property ID is required"),
  leaseId: z.string().optional(),
  amount: z
    .number()
    .min(0.01, "Amount must be more than zero")
    .max(MAX_MONEY, "Amount too high"),
  type: z.nativeEnum(PaymentType),
  paymentMethod: z.nativeEnum(PaymentMethod).optional(),
  // coerce: this validates JSON bodies, where a date is an ISO string. A plain
  // z.date() rejected every edit the payment form ever sent.
  dueDate: z.coerce.date(),
  description: z.string().max(500, "Description too long").optional(),
  notes: z.string().max(1000, "Notes too long").optional(),
});

/**
 * An optional link to another record. An untouched select sends "" (or null),
 * which means "none" — not an id to look up. Passed through, "" reached the
 * database as a foreign key and failed as "Related record does not exist".
 * Not `z.preprocess`, for the reason given at `personEmail`.
 */
const optionalRecordId = z
  .string()
  .trim()
  .nullish()
  .transform((value) => value || undefined);

export const paymentCreateSchema = z.object({
  tenantId: z.string().min(1, "Tenant is required"),
  propertyId: z.string().min(1, "Property is required"),
  leaseId: optionalRecordId,
  /** The installment this charge belongs to — only on the contract named above. */
  invoiceId: optionalRecordId,
  amount: z
    .number({ required_error: "Amount is required" })
    .min(0.01, "Amount must be more than zero")
    .max(MAX_MONEY, "Amount too high"),
  type: z.nativeEnum(PaymentType, {
    required_error: "Payment type is required",
  }),
  paymentMethod: manualPaymentMethodSchema.optional(),
  // coerce: API bodies arrive as JSON, where dates are ISO strings.
  dueDate: z.coerce.date({ required_error: "Due date is required" }),
  description: z.string().max(500, "Description too long").optional(),
  notes: z.string().max(1000, "Notes too long").optional(),
});

// ============================================================================
// INVOICE VALIDATIONS
// ============================================================================

export const invoiceLineItemSchema = z.object({
  description: z
    .string()
    .trim()
    .min(1, "Line item description is required")
    .max(200, "Description cannot exceed 200 characters"),
  amount: z
    .number({ required_error: "Line item amount is required" })
    .min(0, "Amount cannot be negative"),
  type: z.nativeEnum(InvoiceType, {
    required_error: "Line item type is required",
  }),
  quantity: z.number().min(0, "Quantity cannot be negative").optional(),
  unitPrice: z.number().min(0, "Unit price cannot be negative").optional(),
  dueDate: z.coerce.date().optional(),
});

export const invoiceCreateSchema = z
  .object({
    // Either a lease (tenant/property derived from it) or an explicit
    // tenant + property pair — the cross-field rule is refined below;
    // lease/tenant/property existence stays a database concern in the route.
    leaseId: objectIdSchema.optional(),
    tenantId: objectIdSchema.optional(),
    propertyId: objectIdSchema.optional(),
    category: z.nativeEnum(InvoiceType, {
      required_error: "Category is required",
    }),
    issueDate: z.coerce.date().optional(),
    dueDate: z.coerce.date({ required_error: "Due date is required" }),
    lineItems: z
      .array(invoiceLineItemSchema)
      .min(1, "At least one line item is required"),
    taxAmount: z.number().min(0, "Tax cannot be negative").optional(),
    discountAmount: z.number().min(0, "Discount cannot be negative").optional(),
    notes: z.string().max(2000, "Notes too long").optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .refine((data) => data.leaseId || (data.tenantId && data.propertyId), {
    message: "Either a lease or a tenant and property is required",
    path: ["leaseId"],
  });

export const paymentUpdateSchema = paymentCreateSchema.partial().extend({
  status: z
    .enum(["pending", "paid", "partial", "overdue", "cancelled", "refunded", "failed"])
    .optional(),
  paidDate: z.date().optional(),
});

// ============================================================================
// EXPENSE VALIDATIONS
// ============================================================================

export const expenseCreateSchema = z.object({
  expenseNumber: z.string().max(100).optional(),
  propertyId: z.string().min(1).optional(),
  unitId: z.string().min(1).optional(),
  category: z.string().min(1, "Category is required").max(100),
  description: z.string().min(1, "Description is required").max(1000),
  // coerce: API bodies may carry string amounts from the UI.
  amount: z.coerce
    .number({ invalid_type_error: "Valid amount is required" })
    .finite()
    .positive("Amount must be greater than 0"),
  date: z.coerce.date({
    required_error: "Date is required",
    invalid_type_error: "Invalid date",
  }),
  paymentMethod: z.string().max(100).optional(),
  referenceNumber: z.string().max(200).optional(),
  receiptUrl: z.string().max(2000).optional(),
  notes: z.string().max(2000).optional(),
  isRecurring: z.boolean().optional(),
  recurringConfig: z.record(z.unknown()).optional(),
  status: z.nativeEnum(ExpenseStatus).optional(),
  taxDeductible: z.boolean().optional(),
});

export const expenseUpdateSchema = expenseCreateSchema.partial();

// ============================================================================
// MAINTENANCE VALIDATIONS
// ============================================================================

export const maintenanceRequestSchema = z.object({
  propertyId: z.string().min(1, "Property ID is required"),
  unitId: z.string().optional(),
  tenantId: z.string().min(1, "Tenant ID is required"),
  assignedTo: z.string().optional(),
  title: z.string().min(1, "Title is required").max(200, "Title too long"),
  description: z
    .string()
    .min(1, "Description is required")
    .max(2000, "Description too long"),
  priority: z
    .nativeEnum(MaintenancePriority)
    .default(MaintenancePriority.MEDIUM),
  category: z.enum([
    "Plumbing",
    "Electrical",
    "HVAC",
    "Appliances",
    "Flooring",
    "Painting",
    "Roofing",
    "Windows",
    "Doors",
    "Landscaping",
    "Cleaning",
    "Pest Control",
    "Security",
    "General Repair",
    "Emergency",
    "Other",
  ]),
  images: z
    .array(z.string().url("Invalid image URL"))
    .max(10, "Too many images")
    .default([]),
  contactPhone: z
    .string()
    .trim()
    .min(7, "Contact phone must be at least 7 characters")
    .max(20, "Contact phone cannot exceed 20 characters")
    .optional(),
  estimatedCost: z
    .number()
    .min(0, "Cost cannot be negative")
    .max(MAX_MONEY, "Cost too high")
    .optional(),
  scheduledDate: z
    .union([z.string(), z.date()])
    .optional()
    .transform((val) => {
      if (!val) return undefined;
      if (typeof val === "string") {
        const date = new Date(val);
        if (isNaN(date.getTime())) {
          throw new Error("Invalid date format");
        }
        return date;
      }
      return val;
    }),
  notes: z.string().max(1000, "Notes too long").optional(),
});

// ============================================================================
// SUPPORT TICKET VALIDATIONS
// ============================================================================

export const ticketSchema = z.object({
  tenantId: z.string().min(1, "Tenant ID is required"),
  propertyId: z.string().optional(),
  unitId: z.string().optional(),
  assignedTo: z.string().optional(),
  createdBy: z.object({
    userId: z.string().min(1, "Creator user ID is required"),
    role: z.string().min(1, "Creator role is required"),
  }),
  title: z.string().min(1, "Title is required").max(200, "Title too long"),
  description: z
    .string()
    .min(1, "Description is required")
    .max(3000, "Description too long"),
  category: z.nativeEnum(TicketCategory),
  priority: z.nativeEnum(TicketPriority).default(TicketPriority.MEDIUM),
  attachments: z
    .array(z.string().url("Invalid attachment URL"))
    .max(10, "Too many attachments")
    .default([]),
});

export const ticketCommentSchema = z.object({
  message: z
    .string()
    .min(1, "Comment is required")
    .max(2000, "Comment too long"),
  attachments: z
    .array(z.string().url("Invalid attachment URL"))
    .max(5, "Too many attachments")
    .default([]),
  isInternal: z.boolean().default(false),
});

// ============================================================================
// SEARCH AND FILTER VALIDATIONS
// ============================================================================

export const paginationSchema = z.object({
  page: z.number().min(1, "Page must be at least 1").default(1),
  limit: z
    .number()
    .min(1, "Limit must be at least 1")
    .max(100, "Limit too high")
    .default(10),
  sortBy: z.string().optional(),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  search: z.string().optional(),
});

export const propertyFilterSchema = paginationSchema.extend({
  type: categorySlugSchema.optional(),
  status: z.nativeEnum(PropertyStatus).optional(),
  minRent: z.number().min(0).optional(),
  maxRent: z.number().min(0).optional(),
  bedrooms: z.number().min(0).optional(),
  bathrooms: z.number().min(0).optional(),
  city: z.string().optional(),
  state: z.string().optional(),
});

export const paymentFilterSchema = paginationSchema.extend({
  type: z.nativeEnum(PaymentType).optional(),
  status: z
    .enum(["pending", "paid", "partial", "overdue", "cancelled", "refunded", "failed"])
    .optional(),
  paymentMethod: z.nativeEnum(PaymentMethod).optional(),
  tenantId: z.string().optional(),
  propertyId: z.string().optional(),
  startDate: z.date().optional(),
  endDate: z.date().optional(),
});

// ============================================================================
// TENANT PAYMENT VALIDATIONS
// ============================================================================

export const tenantPaymentProcessSchema = z.object({
  paymentId: z.string().min(1, "Payment ID is required"),
  paymentMethod: z.string().min(1, "Payment method is required"),
  savePaymentMethod: z.boolean().optional().default(false),
  confirmAmount: z
    .number()
    .min(0.01, "Amount must be more than zero")
    .max(MAX_MONEY, "Amount too high")
    .optional(),
});

export const tenantPaymentFilterSchema = z.object({
  status: z.enum(["all", "paid", "pending", "overdue", "failed"]).optional(),
  type: z
    .enum(["all", "rent", "security_deposit", "late_fee", "utility", "other"])
    .optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  page: z.number().min(1).optional().default(1),
  limit: z.number().min(1).max(100).optional().default(10),
});

export const receiptRequestSchema = z.object({
  paymentId: z.string().min(1, "Payment ID is required"),
  format: z.enum(["pdf", "json"]).optional().default("pdf"),
});

// ============================================================================
// API RESPONSE VALIDATIONS
// ============================================================================

export const apiResponseSchema = z.object({
  success: z.boolean(),
  data: z.any().optional(),
  message: z.string().optional(),
  error: z.string().optional(),
  pagination: z
    .object({
      page: z.number(),
      limit: z.number(),
      total: z.number(),
      totalPages: z.number(),
    })
    .optional(),
});

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

export function validateSchema<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): { success: true; data: T } | { success: false; errors: string[] } {
  try {
    const validatedData = schema.parse(data);
    return { success: true, data: validatedData };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errors = error.errors.map(
        (err) => `${err.path.join(".")}: ${err.message}`
      );
      return { success: false, errors };
    }
    return { success: false, errors: ["Validation failed"] };
  }
}

export function createApiError(message: string, statusCode: number = 400) {
  const error = new Error(message) as unknown;
  (error as { statusCode: number }).statusCode = statusCode;
  return error;
}

// ============================================================================
// WORK ORDER VALIDATION SCHEMAS
// ============================================================================

export const workOrderSchema = z.object({
  maintenanceRequestId: z.string().min(1, "Maintenance request ID is required"),
  assignedTo: z.string().min(1, "Assigned user ID is required"),
  title: z.string().min(1, "Title is required").max(200, "Title too long"),
  description: z
    .string()
    .min(1, "Description is required")
    .max(2000, "Description too long"),
  status: z
    .enum(["pending", "assigned", "in_progress", "completed", "cancelled"])
    .optional(),
  priority: z.enum(["low", "medium", "high", "emergency"]).optional(),
  estimatedCost: z
    .number()
    .min(0, "Estimated cost must be non-negative")
    .optional(),
  actualCost: z.number().min(0, "Actual cost must be non-negative").optional(),
  scheduledDate: z.string().datetime().optional(),
  completedDate: z.string().datetime().optional(),
  notes: z.string().max(2000, "Notes too long").optional(),
  materials: z.array(z.string().max(200, "Material name too long")).optional(),
  laborHours: z.number().min(0, "Labor hours must be non-negative").optional(),
});

export const workOrderUpdateSchema = workOrderSchema.partial();

// ============================================================================
// APPLICATION VALIDATIONS
// ============================================================================

export const applicationFeeSchema = z.object({
  amount: z
    .number()
    .min(0, "Application fee cannot be negative")
    .max(1000, "Application fee too high"),
  status: z.enum(["pending", "paid", "refunded", "waived"]).default("pending"),
  paymentMethod: z.string().optional(),
  transactionId: z.string().optional(),
  paidAt: z.date().optional(),
});

export const applicationDocumentSchema = z.object({
  type: z.enum([
    "id_verification",
    "income_verification",
    "employment_letter",
    "bank_statement",
    "reference_letter",
    "previous_lease",
    "other",
  ]),
  fileName: z.string().min(1, "File name is required"),
  fileUrl: z.string().url("Invalid file URL"),
  uploadedAt: z.date().default(() => new Date()),
  verified: z.boolean().default(false),
});

export const previousAddressSchema = z.object({
  address: z
    .string()
    .min(1, "Address is required")
    .max(500, "Address too long"),
  landlordName: z.string().max(100, "Landlord name too long").optional(),
  landlordContact: z.string().max(100, "Landlord contact too long").optional(),
  moveInDate: z.date(),
  moveOutDate: z.date(),
  reasonForLeaving: z.string().max(500, "Reason too long").optional(),
});

export const applicationSchema = z.object({
  propertyId: z.string().min(1, "Property ID is required"),
  applicantId: z.string().min(1, "Applicant ID is required"),
  status: z
    .enum([
      "draft",
      "submitted",
      "under_review",
      "screening_in_progress",
      "approved",
      "rejected",
      "withdrawn",
    ])
    .default("draft"),
  applicationFee: applicationFeeSchema,
  personalInfo: z.object({
    firstName: z
      .string()
      .min(1, "First name is required")
      .max(50, "First name too long"),
    lastName: z
      .string()
      .min(1, "Last name is required")
      .max(50, "Last name too long"),
    email: z.string().email("Invalid email address"),
    phone: z.string().min(1, "Phone number is required"),
    dateOfBirth: z.date(),
    ssn: z
      .string()
      .regex(/^\d{3}-\d{2}-\d{4}$/, "SSN must be in format XXX-XX-XXXX")
      .optional(),
  }),
  employmentInfo: z
    .object({
      employer: z.string().max(200, "Employer name too long").optional(),
      position: z.string().max(100, "Position too long").optional(),
      income: z
        .number()
        .min(0, "Income cannot be negative")
        .max(10000000, "Income too high")
        .optional(),
      startDate: z.date().optional(),
      employerContact: z
        .string()
        .max(100, "Employer contact too long")
        .optional(),
    })
    .optional(),
  emergencyContacts: z
    .array(emergencyContactSchema)
    .max(5, "Too many emergency contacts")
    .default([]),
  previousAddresses: z
    .array(previousAddressSchema)
    .max(10, "Too many previous addresses")
    .default([]),
  documents: z
    .array(applicationDocumentSchema)
    .max(20, "Too many documents")
    .default([]),
  additionalInfo: z
    .object({
      pets: z.string().max(1000, "Pet information too long").optional(),
      vehicles: z.string().max(1000, "Vehicle information too long").optional(),
      reasonForMoving: z
        .string()
        .max(1000, "Reason for moving too long")
        .optional(),
      additionalNotes: z
        .string()
        .max(2000, "Additional notes too long")
        .optional(),
    })
    .optional(),
  submittedAt: z.date().optional(),
  reviewedAt: z.date().optional(),
  reviewedBy: z.string().optional(),
  reviewNotes: z.string().max(2000, "Review notes too long").optional(),
});

export const applicationUpdateSchema = applicationSchema.partial();

// ============================================================================
// SCREENING VALIDATIONS
// ============================================================================

export const creditReportSchema = z.object({
  score: z
    .number()
    .min(300, "Credit score too low")
    .max(850, "Credit score too high"),
  reportDate: z.date().default(() => new Date()),
  provider: z.enum(["TransUnion", "Experian", "Equifax", "Other"]),
  reportId: z.string().min(1, "Report ID is required"),
  details: z.any().optional(),
});

export const backgroundCheckSchema = z.object({
  status: z.enum(["clear", "flagged", "failed"]),
  reportDate: z.date().default(() => new Date()),
  provider: z.string().min(1, "Provider is required"),
  reportId: z.string().min(1, "Report ID is required"),
  findings: z.array(z.string()).max(50, "Too many findings").default([]),
  details: z.any().optional(),
});

export const evictionHistorySchema = z.object({
  hasEvictions: z.boolean().default(false),
  reportDate: z.date().default(() => new Date()),
  provider: z.string().min(1, "Provider is required"),
  reportId: z.string().min(1, "Report ID is required"),
  evictions: z
    .array(
      z.object({
        date: z.date(),
        location: z.string().max(200, "Location too long"),
        amount: z.number().min(0, "Amount cannot be negative").optional(),
        status: z.enum(["filed", "judgment", "dismissed", "settled"]),
      })
    )
    .max(20, "Too many eviction records")
    .default([]),
});

export const screeningReportSchema = z.object({
  applicationId: z.string().min(1, "Application ID is required"),
  applicantId: z.string().min(1, "Applicant ID is required"),
  status: z
    .enum(["pending", "in_progress", "completed", "failed"])
    .default("pending"),
  creditReport: creditReportSchema.optional(),
  backgroundCheck: backgroundCheckSchema.optional(),
  evictionHistory: evictionHistorySchema.optional(),
  overallScore: z
    .number()
    .min(0, "Score cannot be negative")
    .max(100, "Score cannot exceed 100")
    .optional(),
  recommendation: z.enum(["approve", "reject", "conditional"]).optional(),
  notes: z.string().max(2000, "Notes too long").optional(),
  completedAt: z.date().optional(),
});

// ============================================================================
// INSPECTION VALIDATIONS
// ============================================================================

export const inspectionItemSchema = z.object({
  room: z.string().min(1, "Room is required").max(100, "Room name too long"),
  item: z
    .string()
    .min(1, "Item is required")
    .max(200, "Item description too long"),
  condition: z.enum(["excellent", "good", "fair", "poor", "damaged"]),
  notes: z.string().max(1000, "Notes too long").optional(),
  photos: z
    .array(z.string().url("Invalid photo URL"))
    .max(10, "Too many photos per item")
    .default([]),
  requiresAttention: z.boolean().default(false),
});

export const inspectionSignatureSchema = z.object({
  signedAt: z.date().default(() => new Date()),
  signature: z.string().min(1, "Signature data is required"),
  ipAddress: z.string().optional(),
});

export const inspectionSchema = z.object({
  propertyId: z.string().min(1, "Property ID is required"),
  tenantId: z.string().optional(),
  leaseId: z.string().optional(),
  type: z.enum(["move_in", "move_out", "routine", "maintenance"]),
  status: z
    .enum(["scheduled", "in_progress", "completed", "cancelled"])
    .default("scheduled"),
  scheduledDate: z.date(),
  completedDate: z.date().optional(),
  inspectorId: z.string().min(1, "Inspector ID is required"),
  items: z
    .array(inspectionItemSchema)
    .max(200, "Too many inspection items")
    .default([]),
  overallCondition: z.enum(["excellent", "good", "fair", "poor"]).optional(),
  tenantSignature: inspectionSignatureSchema.optional(),
  inspectorSignature: inspectionSignatureSchema.optional(),
  photos: z
    .array(z.string().url("Invalid photo URL"))
    .max(50, "Too many photos")
    .default([]),
  notes: z.string().max(2000, "Notes too long").optional(),
});

export const inspectionUpdateSchema = inspectionSchema.partial();

// ============================================================================
// DOCUMENT VALIDATION SCHEMAS
// ============================================================================

export const documentSchema = z.object({
  title: z.string().min(1, "Title is required").max(200, "Title too long"),
  description: z.string().max(1000, "Description too long").optional(),
  type: z.enum([
    "lease",
    "application",
    "inspection",
    "maintenance",
    "financial",
    "photo",
    "other",
  ]),
  status: z
    .enum(["active", "pending_approval", "approved", "rejected", "archived"])
    .optional(),
  fileName: z.string().min(1, "File name is required"),
  fileUrl: z.string().url("Invalid file URL"),
  fileSize: z.number().min(0, "File size must be non-negative"),
  mimeType: z.string().min(1, "MIME type is required"),
  propertyId: z.string().optional(),
  tenantId: z.string().optional(),
  leaseId: z.string().optional(),
  uploadedBy: z.string().min(1, "Uploader ID is required"),
  isShared: z.boolean().optional(),
  tags: z.array(z.string().max(50, "Tag too long")).optional(),
  category: z
    .string()
    .min(1, "Category is required")
    .max(100, "Category too long"),
});

export const documentUpdateSchema = documentSchema.partial();

// ============================================================================
// SETTINGS VALIDATIONS
// ============================================================================

export const notificationSettingsSchema = z.object({
  email: z.object({
    enabled: z.boolean().default(true),
    paymentReminders: z.boolean().default(true),
    maintenanceUpdates: z.boolean().default(true),
    leaseReminders: z.boolean().default(true),
    propertyNews: z.boolean().default(false),
    systemAlerts: z.boolean().default(true),
    marketingEmails: z.boolean().default(false),
    weeklyReports: z.boolean().default(true),
    monthlyReports: z.boolean().default(true),
    tenantMessages: z.boolean().default(true),
    documentSharing: z.boolean().default(true),
    calendarReminders: z.boolean().default(true),
    frequency: z.enum(["immediate", "daily", "weekly"]).default("immediate"),
    quietHours: z.object({
      enabled: z.boolean().default(false),
      startTime: z.string().default("22:00"),
      endTime: z.string().default("08:00"),
    }),
  }),
  sms: z.object({
    enabled: z.boolean().default(false),
    emergencyOnly: z.boolean().default(true),
    paymentReminders: z.boolean().default(false),
    maintenanceUpdates: z.boolean().default(false),
    leaseReminders: z.boolean().default(false),
    systemAlerts: z.boolean().default(false),
    frequency: z.enum(["immediate", "daily"]).default("immediate"),
    quietHours: z.object({
      enabled: z.boolean().default(true),
      startTime: z.string().default("22:00"),
      endTime: z.string().default("08:00"),
    }),
  }),
  push: z.object({
    enabled: z.boolean().default(true),
    paymentReminders: z.boolean().default(true),
    maintenanceUpdates: z.boolean().default(true),
    leaseReminders: z.boolean().default(true),
    systemAlerts: z.boolean().default(true),
    tenantMessages: z.boolean().default(true),
    documentSharing: z.boolean().default(true),
    calendarReminders: z.boolean().default(true),
    quietHours: z.object({
      enabled: z.boolean().default(false),
      startTime: z.string().default("22:00"),
      endTime: z.string().default("08:00"),
    }),
  }),
  inApp: z.object({
    enabled: z.boolean().default(true),
    showDesktopNotifications: z.boolean().default(true),
    soundEnabled: z.boolean().default(true),
    badgeCount: z.boolean().default(true),
    autoMarkAsRead: z.boolean().default(false),
    groupSimilar: z.boolean().default(true),
  }),
});

export const securitySettingsSchema = z.object({
  twoFactorAuth: z.object({
    enabled: z.boolean().default(false),
    method: z.enum(["sms", "email", "authenticator"]).default("email"),
    backupCodes: z.array(z.string()).optional(),
  }),
  loginAlerts: z.boolean().default(true),
  sessionTimeout: z.number().min(15).max(480).default(60),
  passwordRequirements: z.object({
    minLength: z.number().min(6).max(32).default(8),
    requireUppercase: z.boolean().default(true),
    requireLowercase: z.boolean().default(true),
    requireNumbers: z.boolean().default(true),
    requireSpecialChars: z.boolean().default(false),
  }),
});

export const displaySettingsSchema = z.object({
  // Core theme settings
  theme: z.enum(["light", "dark", "system"]).default("system"),

  // Language settings (short language code: "ar" or "en") — the market's
  // own when a full update leaves it out.
  language: z.string().default(DEFAULT_LANGUAGE),

  // Currency settings — riyal whatever is sent (lib/regional/region). An
  // older client may still post another code; it is stored as SAR.
  currency: appCurrencyField.default(APP_CURRENCY),

  // Quick appearance preferences (Preferences drawer)
  contrast: z.boolean().default(false),
  compact: z.boolean().default(false),
  rtl: z.boolean().default(false),
  navColor: z.enum(["integrate", "apparent"]).default("integrate"),

  // Branding settings (simplified to only what's used in the UI)
  branding: z
    .object({
      logoLight: z.string().default("/images/logo-light.png"),
      logoDark: z.string().default("/images/logo-dark.png"),
      favicon: z.string().default("/favicon.ico"),
      primaryColor: z
        .string()
        .regex(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/)
        .default("#3B82F6"),
      secondaryColor: z
        .string()
        .regex(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/)
        .default("#64748B"),
      companyName: z.string().optional(),
      companyAddress: z.string().optional(),
      // Printed above exported statements — see lib/reports/letterhead.ts.
      commercialRegistration: z.string().max(60).optional(),
      taxNumber: z.string().max(60).optional(),
      // Optional R2 metadata saved with branding
      r2: z
        .object({
          logoLight: z
            .object({
              objectKey: z.string().optional(),
              format: z.string().optional(),
              width: z.number().optional(),
              height: z.number().optional(),
              bytes: z.number().optional(),
              optimizedUrls: z.record(z.string()).optional(),
            })
            .optional(),
          logoDark: z
            .object({
              objectKey: z.string().optional(),
              format: z.string().optional(),
              width: z.number().optional(),
              height: z.number().optional(),
              bytes: z.number().optional(),
              optimizedUrls: z.record(z.string()).optional(),
            })
            .optional(),
          favicon: z
            .object({
              objectKey: z.string().optional(),
              format: z.string().optional(),
              width: z.number().optional(),
              height: z.number().optional(),
              bytes: z.number().optional(),
              optimizedUrls: z.record(z.string()).optional(),
            })
            .optional(),
        })
        .optional(),
    })
    .optional(),
});

export const privacySettingsSchema = z.object({
  profileVisibility: z
    .enum(["public", "private", "contacts"])
    .default("private"),
  showOnlineStatus: z.boolean().default(true),
  allowDataCollection: z.boolean().default(true),
  allowMarketing: z.boolean().default(false),
  shareUsageData: z.boolean().default(true),
  showContactInfo: z.boolean().default(false),
  allowDirectMessages: z.boolean().default(true),
  showActivityStatus: z.boolean().default(true),
  allowSearchEngineIndexing: z.boolean().default(false),
  shareLocationData: z.boolean().default(false),
  allowThirdPartyIntegrations: z.boolean().default(true),
  dataRetentionPeriod: z.number().min(30).max(2555).default(365),
  cookiePreferences: z.object({
    essential: z.boolean().default(true),
    analytics: z.boolean().default(true),
    marketing: z.boolean().default(false),
    personalization: z.boolean().default(true),
  }),
});

export const profileSettingsSchema = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  bio: z.string().max(500, "Bio must be 500 characters or less").optional(),
  location: z.string().optional(),
  city: z.string().optional(),
  website: z.string().url("Invalid website URL").optional().or(z.literal("")),
  address: z.string().optional(),
  avatar: z.string().url("Invalid avatar URL").optional().or(z.literal("")),

  // Professional Information
  jobTitle: z.string().optional(),
  company: z.string().optional(),
  dateOfBirth: z
    .union([z.string(), z.date()])
    .optional()
    .transform((val) => {
      if (!val) return undefined;
      if (typeof val === "string") {
        if (val.trim() === "") return undefined;
        const date = new Date(val);
        if (isNaN(date.getTime())) {
          throw new Error("Invalid date format");
        }
        return date;
      }
      return val;
    }),
  gender: z
    .enum(["male", "female", "other", "prefer_not_to_say"])
    .default("prefer_not_to_say"),

  // Emergency Contact
  emergencyContact: z
    .object({
      name: z.string().optional(),
      phone: z.string().optional(),
      relationship: z.string().optional(),
    })
    .optional(),

  // Social Links
  socialLinks: z
    .object({
      linkedin: z
        .string()
        .url("Invalid LinkedIn URL")
        .optional()
        .or(z.literal("")),
      twitter: z
        .string()
        .url("Invalid Twitter URL")
        .optional()
        .or(z.literal("")),
      facebook: z
        .string()
        .url("Invalid Facebook URL")
        .optional()
        .or(z.literal("")),
      instagram: z
        .string()
        .url("Invalid Instagram URL")
        .optional()
        .or(z.literal("")),
    })
    .optional(),

  // User Preferences
  preferences: z
    .object({
      preferredContactMethod: z
        .enum(["email", "phone", "sms"])
        .default("email"),
      language: z.string().default("en"),
      timezone: z.string().default("America/New_York"),
      newsletter: z.boolean().default(false),
      marketingEmails: z.boolean().default(false),
    })
    .optional(),
});

// Profile settings schema for updates (with required validation)
export const profileUpdateSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email("Invalid email address"),
  phone: z.string().optional(),
  bio: z.string().max(500, "Bio must be 500 characters or less").optional(),
  location: z.string().optional(),
  city: z.string().optional(),
  website: z.string().url("Invalid website URL").optional().or(z.literal("")),
  address: z.string().optional(),
  avatar: z.string().optional(),
  jobTitle: z.string().optional(),
  company: z.string().optional(),
  dateOfBirth: z.string().optional(),
  gender: z.enum(["male", "female", "other", "prefer_not_to_say"]).optional(),
  emergencyContact: z
    .object({
      name: z.string().optional(),
      phone: z.string().optional(),
      relationship: z.string().optional(),
    })
    .optional(),
  socialLinks: z
    .object({
      linkedin: z.string().optional(),
      twitter: z.string().optional(),
      facebook: z.string().optional(),
      instagram: z.string().optional(),
    })
    .optional(),
  preferences: z
    .object({
      preferredContactMethod: z.enum(["email", "phone", "sms"]).optional(),
      language: z.string().optional(),
      timezone: z.string().optional(),
      newsletter: z.boolean().optional(),
      marketingEmails: z.boolean().optional(),
    })
    .optional(),
});

export const userSettingsSchema = z.object({
  profile: profileSettingsSchema.optional(),
  notifications: notificationSettingsSchema.optional(),
  security: securitySettingsSchema.optional(),
  display: displaySettingsSchema.optional(),
  privacy: privacySettingsSchema.optional(),
});

export const systemSettingSchema = z.object({
  category: z.enum([
    "general",
    "email",
    "payment",
    "maintenance",
    "security",
    "branding",
    "appearance",
    "localization",
    "notifications",
    "integrations",
  ]),
  key: z.string().min(1).max(100),
  value: z.any(),
  dataType: z.enum([
    "string",
    "number",
    "boolean",
    "object",
    "array",
    "file",
    "url",
    "color",
    "json",
  ]),
  description: z.string().max(500).optional(),
  isPublic: z.boolean().default(false),
  isEditable: z.boolean().default(true),
  validationRules: z
    .object({
      required: z.boolean().optional(),
      min: z.number().optional(),
      max: z.number().optional(),
      pattern: z.string().optional(),
      enum: z.array(z.string()).optional(),
      fileTypes: z.array(z.string()).optional(),
      maxFileSize: z.number().optional(),
      minLength: z.number().optional(),
      maxLength: z.number().optional(),
    })
    .optional(),
  metadata: z
    .object({
      group: z.string().optional(),
      order: z.number().default(0).optional(),
      helpText: z.string().optional(),
      icon: z.string().optional(),
      tags: z.array(z.string()).optional(),
      dependencies: z.array(z.string()).optional(),
    })
    .optional(),
});

export const systemSettingsQuerySchema = z.object({
  category: z
    .enum([
      "general",
      "email",
      "payment",
      "maintenance",
      "security",
      "branding",
      "appearance",
      "localization",
      "notifications",
      "integrations",
    ])
    .optional(),
  isPublic: z.boolean().optional(),
  isEditable: z.boolean().optional(),
  group: z.string().optional(),
  tags: z.array(z.string()).optional(),
  search: z.string().optional(),
  page: z.number().min(1).default(1),
  limit: z.number().min(1).max(100).default(20),
  sortBy: z.string().optional(),
  sortOrder: z.enum(["asc", "desc"]).default("asc"),
});

// ---------------------------------------------------------------------------
// Billing plan management (Platform Console /admin/plans)
// ---------------------------------------------------------------------------

// null means unlimited on every key. `storageMb` is megabytes, matching the
// column and what the billing screens render.
// Built from PLAN_LIMIT_KEYS so a limit added to the catalog cannot be
// accepted by the API without appearing here, or vice versa. Every key is
// required on write: making them optional-with-default meant a payload that
// omitted one silently reset that limit to unlimited.
const planLimitSchema = z.object(
  Object.fromEntries(
    PLAN_LIMIT_KEYS.map((key) => [
      key,
      (PLAN_LIMITS_ALLOWING_ZERO.has(key)
        ? z.number().int().nonnegative()
        : z.number().int().positive()
      ).nullable(),
    ]),
  ) as Record<
    (typeof PLAN_LIMIT_KEYS)[number],
    z.ZodNullable<z.ZodNumber>
  >,
);

/**
 * A plan card's Arabic text. Every field is optional and falls back to the
 * English one on the Arabic pages; the limits match the English fields'.
 * `highlights` goes by position, so an untranslated bullet is an empty string.
 */
const planTranslationsSchema = z.object({
  ar: z
    .object({
      name: z.string().trim().max(60, "Name too long").optional(),
      description: z.string().trim().max(240, "Description too long").optional(),
      highlights: z
        .array(z.string().trim().max(120))
        .max(12, "Too many highlights")
        .optional(),
      priceSuffix: z.string().trim().max(40).optional(),
      featuresHeader: z.string().trim().max(80).optional(),
      ctaLabel: z.string().trim().max(40).optional(),
    })
    .optional(),
});

const planBaseShape = {
  name: z.string().trim().min(1, "Name is required").max(60, "Name too long"),
  description: z.string().trim().max(240, "Description too long").default(""),
  monthlyPrice: z.number().min(0, "Price cannot be negative").default(0),
  isCustom: z.boolean().default(false),
  priceSuffix: z.string().trim().max(40).default("per month"),
  stripePriceId: z.string().trim().max(255).nullable().optional(),
  // An annual term is opt-in per plan. Switching `annualEnabled` on is enough:
  // the server derives the price from `monthlyPrice` less
  // `yearlyDiscountPercent`, and creates the matching Stripe price. The client
  // never dictates `yearlyPrice` — it is only read when the admin has
  // explicitly asked to override the calculation.
  stripePriceIdYearly: z.string().trim().max(255).nullable().optional(),
  annualEnabled: z.boolean().default(false),
  yearlyDiscountPercent: z
    .number()
    .min(0, "Discount cannot be negative")
    .max(99, "Discount cannot exceed 99% — an annual term must charge something")
    .default(0),
  yearlyPriceOverride: z.boolean().default(false),
  yearlyPrice: z.number().min(0).nullable().optional(),
  limits: planLimitSchema.default(
    Object.fromEntries(PLAN_LIMIT_KEYS.map((key) => [key, null])) as Record<
      (typeof PLAN_LIMIT_KEYS)[number],
      null
    >,
  ),
  features: z
    .array(
      z
        .string()
        .refine((f) => isPlanFeatureKey(f), "Unknown plan feature"),
    )
    .default([]),
  highlights: z
    .array(z.string().trim().min(1).max(120))
    .max(12, "Too many highlights")
    .default([]),
  featuresHeader: z.string().trim().max(80).nullable().optional(),
  // The card's Arabic for /ar and /ar/pricing. Optional with no default: a
  // PATCH that does not mention it leaves the stored Arabic alone.
  translations: planTranslationsSchema.nullable().optional(),
  ctaLabel: z.string().trim().min(1, "CTA label is required").max(40).default("Get started"),
  ctaHref: z.string().trim().min(1, "CTA link is required").max(200).default("/auth/signup"),
  popular: z.boolean().default(false),
  isPublic: z.boolean().default(true),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
};

export const planKeySchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, "Key must be at least 2 characters")
  .max(40, "Key too long")
  .regex(
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/,
    "Key may only contain lowercase letters, numbers, and hyphens",
  );

export const planCreateSchema = z.object({
  key: planKeySchema,
  ...planBaseShape,
});

export const planUpdateSchema = z.object(planBaseShape).partial();

export type PlanCreateInput = z.infer<typeof planCreateSchema>;
export type PlanUpdateInput = z.infer<typeof planUpdateSchema>;

// ---------------------------------------------------------------------------
// Landing page CMS (Platform Console -> public homepage)
// ---------------------------------------------------------------------------

const landingText = (max: number) => z.string().trim().max(max);
const landingLink = z.object({
  label: z.string().trim().max(80),
  href: z.string().trim().max(200),
});
const landingImage = z.string().trim().max(500);

/** Copy that may carry `**bold**` runs and hard line breaks — see
 * `@/lib/marketing/rich-text`. Stored verbatim; the renderer only ever
 * recognises those two markers, so this needs no markup escaping. */
const landingRichText = (max: number) => z.string().trim().max(max);

const landingHeaderSchema = z.object({
  navLinks: z.array(landingLink).max(6),
  signIn: landingLink,
  cta: landingLink,
});

const landingHeroSchema = z.object({
  eyebrow: landingText(80),
  headingTop: landingText(80),
  headingHighlight: landingText(80),
  headingBottom: landingText(80),
  subtext: landingText(300),
  primaryCta: landingLink,
  secondaryCta: landingLink,
  bullets: z.array(landingText(80)).max(6),
  image: landingImage,
  imageAlt: landingText(160),
});

const landingProductSchema = z.object({
  headingLine1: landingText(120),
  headingLine2: landingText(120),
  panelImage: landingImage,
  // Eight tabs ship in the design; the cap was 7, which silently rejected every
  // save of a full, unmodified document.
  tabs: z
    .array(
      z.object({
        label: landingText(40),
        image: landingImage.optional().default(""),
      }),
    )
    .max(8)
    .optional()
    .default([]),
});

const landingFeaturesSchema = z.object({
  eyebrow: landingText(80),
  heading: landingRichText(160),
  cards: z
    .array(
      z.object({
        title: landingText(80),
        description: landingText(240),
        image: landingImage.optional().default(""),
      }),
    )
    .max(5),
  moreCard: z.object({
    label: landingText(40),
    href: landingText(200),
    caption: landingRichText(200),
  }),
  integrations: z.object({
    text: landingRichText(240),
    image: landingImage,
    imageAlt: landingText(160),
  }),
});

const landingHowItWorksSchema = z.object({
  eyebrow: landingText(80),
  heading: landingText(120),
  steps: z
    .array(
      z.object({
        title: landingText(80),
        description: landingText(300),
        image: landingImage.optional().default(""),
      }),
    )
    .max(3),
  finalHeading: landingRichText(160),
  finalBody: landingRichText(400),
});

const landingTestimonialSchema = z.object({
  // Not trimmed: the quote is three strings set side by side, and the space
  // at the end of `quoteBefore` / the start of `quoteAfter` is the gap around
  // the highlight. Trimming them ran the words together on every save.
  quoteBefore: z.string().max(280),
  quoteHighlight: landingText(120),
  quoteAfter: z.string().max(160),
  slides: z
    .array(
      z.object({
        image: landingImage,
        imageAlt: landingText(160),
        cardQuote: landingText(400),
        authorName: landingText(80),
        authorTitle: landingText(120),
        rating: z.number().int().min(0).max(5),
      }),
    )
    .min(1, "Add at least one review")
    .max(12),
  // 0 = no autoplay. The floor keeps a slide on screen long enough to read.
  autoplaySeconds: z
    .number()
    .int()
    .min(0)
    .max(60)
    .refine((v) => v === 0 || v >= 3, "Use 0 to disable autoplay, or 3 seconds or more"),
});

const landingPricingSchema = z.object({
  eyebrow: landingText(80),
  headingLine1: landingText(120),
  headingLine2: landingText(120),
  subtext: landingText(280),
});

const landingCtaSchema = z.object({
  heading: landingText(120),
  subheading: landingText(160),
  cardEyebrow: landingText(80),
  cardTitle: landingText(120),
  cardCta: landingLink,
  priceLink: landingLink,
  panelImage: landingImage,
  dashboardImage: landingImage,
  dashboardImageAlt: landingText(160),
  learnMoreLabel: landingText(40),
  cards: z
    .array(
      z.object({
        title: landingText(60),
        icon: z.enum(CTA_CARD_ICON_KEYS),
        href: landingText(200),
      }),
    )
    .max(4),
});

/** A link the homepage writes into an `href` as typed: a path on this site,
 * a same-page anchor, or an http(s) address — never `javascript:` and the like. */
const landingSafeHref = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine(
      isSafeLandingHref,
      "Use a path on this site (like /pricing), an anchor (#features) or an http(s) address",
    );

/** A section the operator adds — see `CustomSection`. Content may be blank
 * while it is being written; a section with nothing in it is not drawn. */
const landingCustomSectionSchema = z.object({
  id: z.string().regex(CUSTOM_SECTION_ID_PATTERN, "Invalid custom section id"),
  heading: landingText(160),
  body: landingRichText(4000),
  image: landingSafeHref(500),
  imageAlt: landingText(160),
  imagePosition: z.enum(CUSTOM_SECTION_IMAGE_POSITIONS),
  ctaLabel: landingText(60),
  ctaHref: landingSafeHref(300),
  background: z.enum(CUSTOM_SECTION_BACKGROUNDS),
});

/** A built-in section's key, or `custom:<id>`. */
const landingSlotKey = z
  .string()
  .refine(
    (key): key is LandingSlotKey =>
      (LANDING_SECTION_KEYS as readonly string[]).includes(key) ||
      isCustomSectionKey(key),
    "Unknown landing section",
  );

/**
 * One node of the Arabic overlay: text, or a list or object of them. Checked
 * only for shape and size here — the route prunes it to the English blocks'
 * structure (`pruneLandingOverlay`), so nothing but words for fields that
 * exist is ever stored, and links and images can never be overridden.
 */
type LandingOverlayNode =
  | string
  | LandingOverlayNode[]
  | { [key: string]: LandingOverlayNode };
const landingOverlayNode: z.ZodType<LandingOverlayNode> = z.lazy(() =>
  z.union([
    z.string().max(4000),
    z.array(landingOverlayNode).max(50),
    z.record(z.string().max(60), landingOverlayNode),
  ]),
);

const landingFooterSchema = z.object({
  ctaLabel: landingText(40),
  ctaHref: landingText(200),
  tagline: landingText(240),
  columns: z
    .array(
      z.object({
        title: landingText(40),
        links: z.array(landingLink).max(12),
      }),
    )
    .max(3),
  copyright: landingText(160),
});

export const landingUpdateSchema = z.object({
  sections: z
    .array(
      z.object({
        key: landingSlotKey,
        enabled: z.boolean(),
        order: z.number().int().min(0).max(99),
      }),
    )
    .max(LANDING_SECTION_KEYS.length + MAX_CUSTOM_SECTIONS),
  header: landingHeaderSchema,
  hero: landingHeroSchema,
  product: landingProductSchema,
  features: landingFeaturesSchema,
  howItWorks: landingHowItWorksSchema,
  testimonial: landingTestimonialSchema,
  pricing: landingPricingSchema,
  cta: landingCtaSchema,
  footer: landingFooterSchema,
  seo: z.object({
    title: landingText(200),
    description: landingText(320),
  }),
  // Optional so a console from before custom sections and Arabic existed can
  // still save; a missing list is "none", a missing overlay "no Arabic".
  customSections: z
    .array(landingCustomSectionSchema)
    .max(MAX_CUSTOM_SECTIONS, `Add at most ${MAX_CUSTOM_SECTIONS} custom sections`)
    .refine(
      (sections) => new Set(sections.map((section) => section.id)).size === sections.length,
      "Two custom sections share an id",
    )
    .default([]),
  translations: z
    .object({
      ar: z.record(z.string().max(60), landingOverlayNode).optional(),
    })
    .default({}),
});

export type LandingUpdateInput = z.infer<typeof landingUpdateSchema>;

// ---------------------------------------------------------------------------
// Platform settings (super-admin console). Mirrors the platform-singleton
// pattern; the SMTP password is write-only (omitted/empty = keep existing).
// ---------------------------------------------------------------------------

/** Trimmed string that is either empty or a valid email address. */
const optionalEmail = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine(
      (v) => v === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
      "Enter a valid email address",
    );

export const platformSettingsUpdateSchema = z.object({
  general: z.object({
    platformName: z.string().trim().min(1, "Platform name is required").max(120),
    supportEmail: optionalEmail(200),
    logoLight: z.string().trim().max(500),
    logoDark: z.string().trim().max(500),
    favicon: z.string().trim().max(500),
    defaultCurrency: appCurrencyField,
    defaultTimezone: z.string().trim().min(1).max(64),
    defaultLanguage: z.string().trim().min(1).max(8),
  }),
  registration: z.object({
    allowSignups: z.boolean(),
    requireEmailVerification: z.boolean(),
    defaultTrialDays: z.number().int().min(0).max(365),
  }),
  maintenance: z.object({
    enabled: z.boolean(),
    message: z.string().trim().max(1000),
  }),
  email: z.object({
    fromName: z.string().trim().max(120),
    fromEmail: optionalEmail(200),
    smtpHost: z.string().trim().max(200),
    smtpPort: z.number().int().min(1).max(65535),
    smtpSecure: z.boolean(),
    smtpUser: z.string().trim().max(200),
    // Write-only: omitted/empty = keep the existing stored password.
    smtpPassword: z.string().max(500).optional(),
  }),
});

export type PlatformSettingsUpdateInput = z.infer<
  typeof platformSettingsUpdateSchema
>;
