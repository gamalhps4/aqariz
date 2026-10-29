/**
 * PropertyPro - Names for units added in bulk
 *
 * "Add multiple units" builds a list from a base name, a starting number and
 * a count ("Driver Room 1" … "Driver Room 12"), lets the office edit or drop
 * rows, and saves the rest in one go. The dialog shows the problems this
 * finds before saving, and the API refuses the same problems, so the two can
 * never disagree about what is acceptable.
 *
 * Pure: the dialog, the route and the tests all import it.
 */

/** The most units one save may create. */
export const MAX_BULK_UNITS = 200;

/** The unit number column's own limit (api/properties/[id]/units). */
export const MAX_UNIT_NUMBER_LENGTH = 50;

export interface BulkNameInput {
  baseName: string;
  start: number;
  count: number;
  /** Off: every row starts as the base name, to be edited one by one. */
  autoNumber: boolean;
}

export function generateUnitNames({
  baseName,
  start,
  count,
  autoNumber,
}: BulkNameInput): string[] {
  const base = baseName.trim();
  const total = Math.max(0, Math.min(Math.floor(count) || 0, MAX_BULK_UNITS));
  const first = Number.isFinite(start) ? Math.floor(start) : 1;
  return Array.from({ length: total }, (_, index) =>
    autoNumber ? [base, String(first + index)].filter(Boolean).join(" ") : base,
  );
}

export type NameProblem = "empty" | "too_long" | "duplicate" | "exists";

/**
 * What is wrong with each row, by index; rows with nothing wrong are absent.
 * Unit numbers compare after trimming and ignoring case: "Room 1" and
 * "room 1 " are the same room to anyone reading the list.
 */
export function findNameProblems(
  names: readonly string[],
  existing: readonly string[],
): Map<number, NameProblem> {
  const key = (name: string) => name.trim().toLowerCase();
  const taken = new Set(existing.map(key));
  const seen = new Map<string, number>();
  for (const name of names) seen.set(key(name), (seen.get(key(name)) ?? 0) + 1);

  const problems = new Map<number, NameProblem>();
  names.forEach((name, index) => {
    const trimmed = name.trim();
    if (!trimmed) problems.set(index, "empty");
    else if (trimmed.length > MAX_UNIT_NUMBER_LENGTH) problems.set(index, "too_long");
    else if (taken.has(key(name))) problems.set(index, "exists");
    else if ((seen.get(key(name)) ?? 0) > 1) problems.set(index, "duplicate");
  });
  return problems;
}
