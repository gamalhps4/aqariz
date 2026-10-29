/**
 * PropertyPro - What every record's activity snapshot is made of
 *
 * A route records the before and after of a change as a small flat object:
 * a name where the row holds an id (the building, the tenant, the person it is
 * assigned to), money as a number, dates as ISO strings, a long text cut short.
 * These are the pieces the per-record builders (expense, agreement, deposit,
 * maintenance, document, listing) share.
 *
 * Pure: no database, nothing server-only. The tests read it directly.
 */

import { snapshotValue } from "@/lib/audit/diff";
import { fullName } from "@/lib/audit/scope";

export type Row = Record<string, unknown>;

/** A person as a reader knows them: "Ahmed Ali", else their name column, else their address. */
export function personName(person: unknown): string | null {
  if (!person || typeof person !== "object") return null;
  const row = person as {
    firstName?: unknown;
    lastName?: unknown;
    name?: unknown;
    email?: unknown;
  };
  const named = fullName(
    typeof row.firstName === "string" ? row.firstName : null,
    typeof row.lastName === "string" ? row.lastName : null,
  );
  if (named) return named;
  if (typeof row.name === "string" && row.name.trim()) return row.name.trim();
  if (typeof row.email === "string" && row.email.trim()) return row.email.trim();
  return null;
}

/** The text, cut to `max` characters — a long description is not a field to compare in full. */
export function clip(value: unknown, max = 200): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** A Decimal, a numeric string or a number, as a number; null when it is not one. */
export function numberOf(value: unknown): number | null {
  const stored = snapshotValue(value);
  if (stored === null || stored === undefined || stored === "") return null;
  const number = Number(stored);
  return Number.isFinite(number) ? number : null;
}

/** A date as an ISO string; null when empty or invalid. */
export function dateOf(value: unknown): string | null {
  const stored = snapshotValue(value);
  return typeof stored === "string" && stored ? stored : null;
}

/** A calendar day ("2026-10-04") from a Date or an ISO string; null when empty. */
export function dayOf(value: unknown): string | null {
  const iso = dateOf(value);
  return iso ? iso.slice(0, 10) : null;
}

/** A file's size in kilobytes to one decimal; null when it is not known (0 stands for unknown). */
export function kilobytes(bytes: unknown): number | null {
  const size = numberOf(bytes);
  if (size === null || size <= 0) return null;
  return Math.round((size / 1024) * 10) / 10;
}

/** Only the fields that hold something — for a record that was just made or just removed. */
export function compact(snapshot: Row): Row {
  const out: Row = {};
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === null || value === undefined || value === "") continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[key] = value;
  }
  return out;
}

/** What a status moved from and to, or null when it did not move. */
export function statusMove(
  before: Row | null | undefined,
  after: Row | null | undefined,
): { from: string; to: string } | null {
  const from = before?.status;
  const to = after?.status;
  if (typeof from !== "string" || typeof to !== "string" || from === to) {
    return null;
  }
  return { from, to };
}

/** The titles of the first `max` records, for the entry of a bulk change. */
export function firstOf<T>(rows: readonly T[], pick: (row: T) => unknown, max = 20): string[] {
  const out: string[] = [];
  for (const row of rows) {
    const text = clip(pick(row), 80);
    if (text) out.push(text);
    if (out.length >= max) break;
  }
  return out;
}
