/**
 * PropertyPro - The office's own listing details
 *
 * Three things belong to the office rather than to any one advertisement: the
 * brokerage licence (FAL, رخصة فال) printed on every public page beside the
 * advertising licence, and the phone and WhatsApp numbers a new listing starts
 * with.
 *
 * They are kept in the organization's `settings` JSON under `listings`.
 * Not in the branding document, which the settings form validates field by
 * field and would drop a key it has not heard of the next time it saved; and
 * not in a table of its own for three strings. The organization row is written
 * under the platform bypass (organizations are platform-writable only), so the
 * route that does it is the only place that may, and it writes this one key
 * back into the document it read, leaving everything else as it found it.
 */

import { z } from "zod";
import { LISTING_LIMITS } from "./constants";
import { daysBetween, parseDay } from "./dates";
import { isPlausibleLicenceNumber, normalizeLicenceNumber } from "./licence";
import { parsePhone } from "./phone";

export interface OfficeListingSettings {
  falLicenceNumber: string | null;
  /** The day the brokerage licence runs out, `YYYY-MM-DD`, if the office says. */
  falLicenceExpiry: string | null;
  /** E.164. */
  contactPhone: string | null;
  /** E.164. */
  whatsappNumber: string | null;
}

export const EMPTY_OFFICE_SETTINGS: OfficeListingSettings = {
  falLicenceNumber: null,
  falLicenceExpiry: null,
  contactPhone: null,
  whatsappNumber: null,
};

const KEY = "listings";

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * The office's listing details from its settings document. Reads what is
 * there and nothing else, and never throws: a document that is not an object,
 * or a value that is not text, is simply "not set".
 */
export function readOfficeSettings(organizationSettings: unknown): OfficeListingSettings {
  const document =
    organizationSettings && typeof organizationSettings === "object"
      ? (organizationSettings as Record<string, unknown>)
      : {};
  const stored =
    document[KEY] && typeof document[KEY] === "object"
      ? (document[KEY] as Record<string, unknown>)
      : {};
  return {
    falLicenceNumber: normalizeLicenceNumber(text(stored.falLicenceNumber)),
    falLicenceExpiry: parseDay(stored.falLicenceExpiry),
    contactPhone: text(stored.contactPhone),
    whatsappNumber: text(stored.whatsappNumber),
  };
}

/**
 * The settings document with the listing details replaced, every other key as
 * it was.
 */
export function withOfficeSettings(
  organizationSettings: unknown,
  next: OfficeListingSettings,
): Record<string, unknown> {
  const document =
    organizationSettings && typeof organizationSettings === "object"
      ? { ...(organizationSettings as Record<string, unknown>) }
      : {};
  document[KEY] = { ...next };
  return document;
}

function cleaned(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return value.trim() === "" ? null : value.trim();
}

function phone() {
  return z
    .string()
    .nullish()
    .transform(cleaned)
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

/** What the settings form may send. A field left out keeps what is stored. */
export const officeSettingsSchema = z.object({
  falLicenceNumber: z
    .string()
    .nullish()
    .transform((value) =>
      value === undefined ? undefined : normalizeLicenceNumber(value),
    )
    .refine((value) => !value || isPlausibleLicenceNumber(value), {
      message: "Enter the licence number as it appears on the licence",
    })
    .refine((value) => !value || value.length <= LISTING_LIMITS.licenceNumber, {
      message: "The licence number is too long",
    }),
  falLicenceExpiry: z
    .string()
    .nullish()
    .transform(cleaned)
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
    }),
  contactPhone: phone(),
  whatsappNumber: phone(),
});

export type OfficeSettingsInput = z.infer<typeof officeSettingsSchema>;

/** The stored settings with the fields the form sent laid over them. */
export function mergeOfficeSettings(
  current: OfficeListingSettings,
  input: OfficeSettingsInput,
): OfficeListingSettings {
  return {
    falLicenceNumber:
      input.falLicenceNumber === undefined
        ? current.falLicenceNumber
        : input.falLicenceNumber,
    falLicenceExpiry:
      input.falLicenceExpiry === undefined
        ? current.falLicenceExpiry
        : input.falLicenceExpiry,
    contactPhone:
      input.contactPhone === undefined ? current.contactPhone : input.contactPhone,
    whatsappNumber:
      input.whatsappNumber === undefined
        ? current.whatsappNumber
        : input.whatsappNumber,
  };
}

/**
 * Whether the brokerage licence may be printed on the public page: there is a
 * number, and if the office gave an expiry day it has not passed. An expired
 * licence on a public page is a false statement; the office is told on its own
 * screen instead.
 */
export function falLicenceIsShowable(
  settings: Pick<OfficeListingSettings, "falLicenceNumber" | "falLicenceExpiry">,
  today: string,
): boolean {
  if (!settings.falLicenceNumber) return false;
  if (!settings.falLicenceExpiry) return true;
  return daysBetween(today, settings.falLicenceExpiry) >= 0;
}
