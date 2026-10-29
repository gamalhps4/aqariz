/**
 * PropertyPro - Phone numbers on a listing
 *
 * Three people type phone numbers into this module: the office (the number
 * the ad shows), the office again (its WhatsApp number) and a stranger on the
 * public page (the number the office will call back). All three write
 * "0501234567", "+966 50 123 4567", "00966501234567", "966501234567" or the
 * same in Arabic digits, and all three end up as one number the page can put
 * in a `tel:` link and a `wa.me` link.
 *
 * The market is Saudi Arabia, so a number with no country code is read as one
 * of its own; a number with a code — any code — is read as written.
 */

import { parsePhoneNumberFromString } from "libphonenumber-js";
import { toWesternDigits } from "./digits";

export const DEFAULT_PHONE_COUNTRY = "SA";

export { toWesternDigits };

export interface ParsedPhone {
  /** `+966501234567` — what is stored and what links are built from. */
  e164: string;
  /** `050 123 4567` — for the office's own screens. */
  national: string;
  /** `+966 50 123 4567`. */
  international: string;
}

/**
 * A phone number as typed, or null when it is not one. Never throws.
 */
export function parsePhone(raw: unknown): ParsedPhone | null {
  if (typeof raw !== "string") return null;
  let text = toWesternDigits(raw).replace(/[\s().-]+/g, "");
  if (!text) return null;

  // "00966…" is "+966…"; a bare "966…" with a Saudi mobile's length is too.
  if (text.startsWith("00")) text = `+${text.slice(2)}`;
  else if (!text.startsWith("+") && /^966\d{8,9}$/.test(text)) text = `+${text}`;

  const parsed = parsePhoneNumberFromString(text, DEFAULT_PHONE_COUNTRY);
  if (!parsed || !parsed.isValid()) return null;
  return {
    e164: parsed.number,
    national: parsed.formatNational(),
    international: parsed.formatInternational(),
  };
}

/** `https://wa.me/966501234567` — the number without its plus sign. */
export function whatsappUrl(e164: string, text?: string): string {
  const digits = e164.replace(/\D/g, "");
  const base = `https://wa.me/${digits}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}

/** `tel:+966501234567`. */
export function telUrl(e164: string): string {
  return `tel:${e164.startsWith("+") ? e164 : `+${e164.replace(/\D/g, "")}`}`;
}
