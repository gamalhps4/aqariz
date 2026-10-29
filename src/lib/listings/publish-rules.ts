/**
 * PropertyPro - What a listing needs before it can go public
 *
 * Publishing puts an advertisement on a page anyone can read, so it is held to
 * the conditions an advertisement is held to, and every one is checked the
 * moment the office presses Publish — not discovered later by a reader:
 *
 *   - a title, in either language, and a price above zero;
 *   - the REGA advertising licence number and its expiry day, and the expiry
 *     day has not passed (the day itself is still good);
 *   - the unit is still vacant. An advertisement for a flat somebody now lives
 *     in is a promise the office cannot keep.
 *
 * A listing for a property not in the system has no unit to be vacant, and
 * nothing to read the facts of an advertisement from but itself, so in place
 * of the last rule it must say what the property is, which city it is in and
 * its area. (A unit always carries a type, and its building a city.)
 *
 * The database holds the first half of the licence rule too (a published row
 * must carry both), so a path that forgets this check still cannot publish a
 * listing with no licence at all.
 *
 * Pure: no database, no clock of its own — `today` is passed in.
 */

import { daysBetween } from "./dates";
import { normalizeLicenceNumber } from "./licence";
import {
  periodFitsType,
  type ListingType,
  type PricePeriod,
} from "./constants";

export type PublishProblem =
  | "title_missing"
  | "price_missing"
  | "period_mismatch"
  | "licence_missing"
  | "licence_expiry_missing"
  | "licence_expired"
  | "unit_unavailable"
  | "property_type_missing"
  | "city_missing"
  | "area_missing";

export interface PublishCandidate {
  titleAr?: string | null;
  titleEn?: string | null;
  price: unknown;
  type: ListingType;
  pricePeriod: PricePeriod;
  adLicenceNumber?: string | null;
  /** The expiry as a `YYYY-MM-DD` day, or null. */
  adLicenceExpiry?: string | null;
  unitStatus?: string | null;
  unitDeleted?: boolean;
  /** No unit: the details below stand in for it, and the unit rule is skipped. */
  standalone?: boolean;
  propertyType?: string | null;
  city?: string | null;
  areaSqm?: unknown;
}

/** Everything standing in the way, in a stable order; empty means "go ahead". */
export function publishProblems(
  candidate: PublishCandidate,
  today: string,
): PublishProblem[] {
  const problems: PublishProblem[] = [];

  const hasTitle = Boolean(
    candidate.titleAr?.trim() || candidate.titleEn?.trim(),
  );
  if (!hasTitle) problems.push("title_missing");

  const price = Number(candidate.price);
  if (!Number.isFinite(price) || price <= 0) problems.push("price_missing");

  if (!periodFitsType(candidate.type, candidate.pricePeriod)) {
    problems.push("period_mismatch");
  }

  const number = normalizeLicenceNumber(candidate.adLicenceNumber);
  const expiry = candidate.adLicenceExpiry ?? null;
  if (!number) problems.push("licence_missing");
  if (!expiry) {
    problems.push("licence_expiry_missing");
  } else if (daysBetween(today, expiry) < 0) {
    // Said whether or not the number is there: an office with neither should
    // be told about both, not fix one and then meet the other.
    problems.push("licence_expired");
  }

  if (candidate.standalone) {
    if (!candidate.propertyType?.trim()) problems.push("property_type_missing");
    if (!candidate.city?.trim()) problems.push("city_missing");
    const area = Number(candidate.areaSqm ?? 0);
    if (!Number.isFinite(area) || area <= 0) problems.push("area_missing");
  } else if (candidate.unitDeleted || candidate.unitStatus !== "available") {
    problems.push("unit_unavailable");
  }

  return problems;
}

export function canPublish(candidate: PublishCandidate, today: string): boolean {
  return publishProblems(candidate, today).length === 0;
}

/**
 * The sentence for each problem, in English, for the API's error. The screens
 * say it in the reader's language from the code (marketing.json,
 * `listings.publish.problem.*`).
 */
export const PUBLISH_PROBLEM_TEXT: Record<PublishProblem, string> = {
  title_missing: "Add a title in Arabic or English.",
  price_missing: "Enter a price above zero.",
  period_mismatch: "The price period does not fit the listing type.",
  licence_missing: "Enter the REGA advertising licence number.",
  licence_expiry_missing: "Enter the expiry date of the advertising licence.",
  licence_expired: "The advertising licence has expired. Enter the renewed one.",
  unit_unavailable: "The unit is no longer available, so it cannot be advertised.",
  property_type_missing: "Choose the property type.",
  city_missing: "Enter the city the property is in.",
  area_missing: "Enter the property's area in square metres.",
};
