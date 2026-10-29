/**
 * PropertyPro - A list's stored values, worded as its screen words them
 *
 * A list export prints what the list shows, and the list shows words: a
 * contract is "Active" (فعّال), a unit "Occupied", an inspection "Move-In".
 * The rows hold codes — "pending_signature", "in_progress", "move_in" — and
 * an export that printed them as they are read "move_in" in the middle of an
 * Arabic page.
 *
 * Each domain already has its words in the catalogue, under the keys its
 * screen reads. These look a stored code up under those same keys, in the
 * reader's language, so a file and the screen it came from cannot word the
 * same thing two ways. An unknown code comes out as readable English rather
 * than as the code.
 *
 * No database and nothing server-only: the pages use it too.
 */

import { pdfLabel, type PdfLanguage } from "@/lib/invoice/pdf-i18n";
import { maintenanceKey } from "@/lib/maintenance-labels";
import type { LineTranslate } from "@/lib/statements/line-text";

/** A translator for a report's language, in the shape the wording helpers take. */
export function translatorFor(language: PdfLanguage): LineTranslate {
  return (key, english, values) => pdfLabel(language, key, english, values);
}

/** "in_progress" → "In progress": what a code nobody catalogued reads as. */
function readable(code: string): string {
  const words = code.replace(/_/g, " ").trim();
  return words ? `${words.charAt(0).toUpperCase()}${words.slice(1)}` : code;
}

function word(
  tr: LineTranslate,
  prefix: string,
  code: string | null | undefined,
  camel = false,
): string {
  if (!code) return "";
  return tr(`${prefix}.${camel ? maintenanceKey(code) : code}`, readable(code));
}

/** A ledger entry's type — income, expense, charge, credit — as the transactions screen has it. */
export const transactionTypeText = (type: string | null | undefined, tr: LineTranslate) =>
  word(tr, "transactions.types", type);

/** A contract's status. "pending_signature" has its own word, as on the screen. */
export const leaseStatusText = (status: string | null | undefined, tr: LineTranslate) =>
  word(tr, "leases.status", status);

/** A building's status. */
export const propertyStatusText = (status: string | null | undefined, tr: LineTranslate) =>
  word(tr, "properties.status", status);

/** A unit's status. */
export const unitStatusText = (status: string | null | undefined, tr: LineTranslate) =>
  word(tr, "units.status", status);

/** An inspection's type: "move_in" → Move-In. */
export const inspectionTypeText = (type: string | null | undefined, tr: LineTranslate) =>
  word(tr, "inspections.types", type, true);

/** An inspection's status: "in_progress" → In Progress. */
export const inspectionStatusText = (status: string | null | undefined, tr: LineTranslate) =>
  word(tr, "inspections.status", status, true);

/** An inspection's overall condition. */
export const inspectionConditionText = (
  condition: string | null | undefined,
  tr: LineTranslate,
) => word(tr, "inspections.conditions", condition, true);

/** How urgent an expiring contract is: 7 days or fewer, 30 or fewer, the rest. */
export type ExpiryUrgency = "critical" | "warning" | "upcoming";

export function expiryUrgency(daysLeft: number): ExpiryUrgency {
  if (daysLeft <= 7) return "critical";
  if (daysLeft <= 30) return "warning";
  return "upcoming";
}

export const expiryUrgencyText = (urgency: ExpiryUrgency, tr: LineTranslate) =>
  word(tr, "leases.expiring.urgency", urgency);

/**
 * How long an emergency has been open, as the emergency list words it:
 * normal (under 2 hours), overdue (over 2), critical (over 4).
 */
export const responseTimeText = (level: string, tr: LineTranslate) =>
  word(tr, "maintenance.emergency.list.filters", level);

/** Whether a request has someone assigned, in the words of the assignment filter. */
export const assignmentText = (assigned: boolean, tr: LineTranslate) =>
  assigned
    ? tr("maintenance.emergency.list.filters.assignedFilter", "Assigned")
    : tr("maintenance.labels.unassigned", "Unassigned");
