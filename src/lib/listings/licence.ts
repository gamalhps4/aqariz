/**
 * PropertyPro - The advertising licence (رقم ترخيص الإعلان)
 *
 * A property advertisement in Saudi Arabia carries the number of the licence
 * the Real Estate General Authority (REGA) issued for that advertisement, and
 * the licence runs out. The product therefore refuses to publish a listing
 * without one, hides a published listing whose licence has run out, and shows
 * the number on the public page.
 *
 * The office's own brokerage licence (FAL, رخصة فال) is a separate number, kept
 * once for the office (see settings.ts) and printed beside it.
 *
 * The exact shape of a licence number is the Authority's to change, so this
 * checks only that something plausible was typed — digits and letters, no
 * markup — and never that it is a particular length of digits.
 */

import { LICENCE_EXPIRING_SOON_DAYS, LISTING_LIMITS } from "./constants";
import { daysBetween } from "./dates";
import { toWesternDigits } from "./digits";

const LICENCE_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}\-/ ]*$/u;

/** A licence number as stored: Western digits, single spaces, trimmed. */
export function normalizeLicenceNumber(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = toWesternDigits(raw).replace(/\s+/g, " ").trim();
  return text ? text : null;
}

export function isPlausibleLicenceNumber(value: string): boolean {
  return (
    value.length >= 4 &&
    value.length <= LISTING_LIMITS.licenceNumber &&
    LICENCE_PATTERN.test(value)
  );
}

/**
 * - `missing`: no number, or no expiry — the listing cannot be published.
 * - `expired`: the expiry day has passed — hidden from the public page.
 * - `expiring`: it lapses within the warning window — still shown.
 * - `valid`: good for longer than that.
 */
export type LicenceState = "missing" | "expired" | "expiring" | "valid";

export interface LicenceStatus {
  state: LicenceState;
  /** Days until the expiry day; negative once it has passed; null when missing. */
  daysLeft: number | null;
}

/**
 * Where a licence stands on a given day. The expiry day itself is still
 * valid: a licence "valid until the 3rd" is good all through the 3rd.
 */
export function licenceStatus(
  number: string | null | undefined,
  expiryDay: string | null | undefined,
  today: string,
): LicenceStatus {
  if (!number || !number.trim() || !expiryDay) {
    return { state: "missing", daysLeft: null };
  }
  const daysLeft = daysBetween(today, expiryDay);
  if (daysLeft < 0) return { state: "expired", daysLeft };
  if (daysLeft <= LICENCE_EXPIRING_SOON_DAYS) {
    return { state: "expiring", daysLeft };
  }
  return { state: "valid", daysLeft };
}

/** Whether a licence may be shown on a public page on this day. */
export function licenceIsCurrent(
  number: string | null | undefined,
  expiryDay: string | null | undefined,
  today: string,
): boolean {
  const { state } = licenceStatus(number, expiryDay, today);
  return state === "valid" || state === "expiring";
}
