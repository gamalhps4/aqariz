/**
 * PropertyPro - A management agreement as an activity entry holds it
 *
 * Named by its agreement number. The entry keeps what the office is asked
 * about — who the owner is, what the agreement covers (a building, a compound
 * or the owner's whole portfolio), the commission terms, the period and where
 * the agreement stands — with the building and compound as names, and the
 * attached documents as a count (their addresses are not for a log).
 *
 * Pure: no database, nothing server-only.
 */

import {
  clip,
  dateOf,
  numberOf,
  personName,
  type Row,
} from "./shared";

/** The fields compared when an agreement is edited. */
export const AGREEMENT_CHANGE_KEYS = [
  "agreementNumber",
  "kind",
  "ownerName",
  "propertyName",
  "compoundName",
  "feeType",
  "feePercentage",
  "feeAmount",
  "feeFrequency",
  "commissionBasis",
  "currency",
  "startDate",
  "endDate",
  "status",
  "terminatedDate",
  "documentsCount",
  "notes",
] as const;

function textOf(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nameOf(relation: unknown): string | null {
  if (relation && typeof relation === "object") {
    return textOf((relation as { name?: unknown }).name);
  }
  return null;
}

/**
 * The agreement as an entry stores it. The row is read with its owner,
 * building and compound (AGREEMENT_INCLUDE); every field is always present so
 * a before and an after built the same way compare field for field.
 */
export function agreementSnapshot(row: Row | null | undefined): Row {
  if (!row) return {};
  return {
    agreementNumber: textOf(row.agreementNumber),
    kind: textOf(row.kind),
    ownerName: personName(row.owner),
    propertyName: nameOf(row.property),
    compoundName: nameOf(row.compound),
    feeType: textOf(row.feeType),
    feePercentage: numberOf(row.feePercentage),
    feeAmount: numberOf(row.feeAmount),
    feeFrequency: textOf(row.feeFrequency),
    commissionBasis: textOf(row.commissionBasis),
    currency: textOf(row.currency),
    startDate: dateOf(row.startDate),
    endDate: dateOf(row.endDate),
    status: textOf(row.status),
    terminatedDate: dateOf(row.terminatedDate),
    documentsCount: Array.isArray(row.documents) ? row.documents.length : null,
    notes: clip(row.notes, 300),
  };
}

/** What a reader knows an agreement by: its number. */
export function agreementName(row: Row | null | undefined): string | null {
  return row ? textOf(row.agreementNumber) : null;
}
