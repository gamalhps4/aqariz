/**
 * PropertyPro - The before and after of a change
 *
 * "For contract/payment edits and permission changes, record the value before
 * and after" — and only the values that changed: an edit form sends every
 * field, and an entry listing twenty unchanged fields hides the one that
 * moved. Dates are compared as instants and money as numbers, so a value read
 * back from the database and the same value typed into a form compare equal.
 *
 * Pure — the tests read it directly.
 */

export type Snapshot = Record<string, unknown>;

/** A value as an entry stores it: dates as ISO strings, decimals as numbers. */
export function snapshotValue(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === "bigint") return Number(value);
  if (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { toNumber?: unknown }).toNumber === "function" &&
    !Array.isArray(value)
  ) {
    // Prisma.Decimal and friends.
    return (value as { toNumber: () => number }).toNumber();
  }
  if (Array.isArray(value)) return value.map(snapshotValue);
  if (typeof value === "object") {
    const out: Snapshot = {};
    for (const [key, inner] of Object.entries(value as Snapshot)) {
      const stored = snapshotValue(inner);
      if (stored !== undefined) out[key] = stored;
    }
    return out;
  }
  return value;
}

/** The picked fields of a row, as an entry stores them. */
export function pickSnapshot(
  row: Snapshot | null | undefined,
  keys: readonly string[],
): Snapshot {
  const out: Snapshot = {};
  if (!row) return out;
  for (const key of keys) {
    if (key in row) {
      const value = snapshotValue(row[key]);
      if (value !== undefined) out[key] = value;
    }
  }
  return out;
}

function comparable(value: unknown): string {
  const stored = snapshotValue(value);
  if (stored === null || stored === undefined || stored === "") return "∅";
  if (Array.isArray(stored)) {
    // A list of plain values is a set here: permissions re-ordered are the
    // same permissions.
    if (stored.every((item) => typeof item !== "object" || item === null)) {
      return JSON.stringify([...stored].map(String).sort());
    }
    return JSON.stringify(stored);
  }
  if (typeof stored === "object") {
    const sorted = Object.keys(stored as Snapshot)
      .sort()
      .map((key) => [key, (stored as Snapshot)[key]]);
    return JSON.stringify(sorted);
  }
  // "1500.00" and 1500 are the same amount; "0555…" is a phone number, whose
  // leading zero is part of it.
  if (typeof stored === "string" && /^-?(0|[1-9]\d*)(\.\d+)?$/.test(stored.trim())) {
    return String(Number(stored));
  }
  return JSON.stringify(stored);
}

/** What a secret is stored as in an entry: that it is set, never its value. */
export const SECRET_MASK = "••••••";

/**
 * The before and after of a settings save. Fields in `secretKeys` (a password,
 * an API key, a webhook secret) are compared as they are but stored masked —
 * an activity entry is read by more people than the settings page is — and
 * named in `secretsChanged` so a key replaced by another still shows as moved.
 */
export function diffSettings(
  before: Snapshot | null | undefined,
  after: Snapshot | null | undefined,
  keys: readonly string[],
  secretKeys: readonly string[] = [],
): {
  before: Snapshot;
  after: Snapshot;
  changed: string[];
  secretsChanged: string[];
} {
  const secrets = new Set(secretKeys);
  const diff = diffSnapshot(before, after, [...keys, ...secretKeys]);
  const secretsChanged = diff.changed.filter((key) => secrets.has(key));
  for (const key of secretsChanged) {
    diff.before[key] = diff.before[key] ? SECRET_MASK : null;
    diff.after[key] = diff.after[key] ? SECRET_MASK : null;
  }
  return { ...diff, secretsChanged };
}

/**
 * Only what changed, on both sides. `keys` limits the comparison to those
 * fields; by default every field on either side is compared.
 */
export function diffSnapshot(
  before: Snapshot | null | undefined,
  after: Snapshot | null | undefined,
  keys?: readonly string[],
): { before: Snapshot; after: Snapshot; changed: string[] } {
  const fields =
    keys ??
    [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])];
  const changed: string[] = [];
  const out = { before: {} as Snapshot, after: {} as Snapshot };
  for (const key of fields) {
    const was = before?.[key];
    const now = after?.[key];
    if (now === undefined && keys === undefined && !(key in (after ?? {}))) {
      // Present only before: a field the change did not touch.
      continue;
    }
    if (comparable(was) === comparable(now)) continue;
    changed.push(key);
    out.before[key] = snapshotValue(was) ?? null;
    out.after[key] = snapshotValue(now) ?? null;
  }
  return { ...out, changed };
}
