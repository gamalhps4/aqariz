/**
 * PropertyPro - A maintenance request's category, priority and status in words
 *
 * They are stored as the forms wrote them — "in_progress", "emergency",
 * "General Repair", "HVAC" — and catalogued under camel-case keys
 * (`maintenance.status.inProgress`, `maintenance.categories.generalRepair`).
 * The maintenance report printed the stored value as it was: English on an
 * Arabic screen. One mapping, so the report screen and its export word them
 * alike. No database, nothing server-only.
 */

import type { LineTranslate } from "@/lib/statements/line-text";

/** "in_progress" → "inProgress", "General Repair" → "generalRepair", "HVAC" → "hvac". */
export function maintenanceKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_\s-]+([a-z0-9])/g, (_, next: string) => next.toUpperCase());
}

/** "in_progress" → "In progress": what an unknown code reads as in English. */
function readable(value: string): string {
  const words = value.replace(/_/g, " ").trim();
  return words ? `${words.charAt(0).toUpperCase()}${words.slice(1)}` : value;
}

export function maintenanceStatusText(status: string, tr: LineTranslate): string {
  return status ? tr(`maintenance.status.${maintenanceKey(status)}`, readable(status)) : "";
}

export function maintenancePriorityText(priority: string, tr: LineTranslate): string {
  return priority
    ? tr(`maintenance.priority.${maintenanceKey(priority)}`, readable(priority))
    : "";
}

export function maintenanceCategoryText(category: string, tr: LineTranslate): string {
  return category
    ? tr(`maintenance.categories.${maintenanceKey(category)}`, readable(category))
    : "";
}
