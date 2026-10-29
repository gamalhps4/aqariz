/**
 * PropertyPro - One name field, two columns
 *
 * The scope is explicit: a tenant's name is ONE field on the form and on the
 * contract. Splitting it into "first" and "last" is a Western convention that
 * does not survive the names this office actually types — "أحمد بن عبدالله
 * السيد" has no last name to put in a second box, and asking for one produces
 * a record that prints wrongly on every document.
 *
 * `User.firstName` / `User.lastName` stay as they are, because the whole
 * application reads them. The split below is chosen so that rejoining is
 * LOSSLESS: everything before the first space, then everything after it, and
 * `${firstName} ${lastName}` reproduces exactly what was typed. That is what
 * lets a single-field form sit on top of two columns without ever mangling a
 * name it round-trips.
 */

export interface SplitName {
  firstName: string;
  lastName: string;
}

/**
 * Split a full name for storage.
 *
 * A single-word name keeps `lastName` empty rather than duplicating the word:
 * joining then yields the original with a trailing space to trim, not a name
 * repeated twice.
 */
export function splitFullName(fullName: string): SplitName {
  const trimmed = fullName.trim().replace(/\s+/g, " ");
  if (!trimmed) return { firstName: "", lastName: "" };

  const boundary = trimmed.indexOf(" ");
  if (boundary === -1) return { firstName: trimmed, lastName: "" };

  return {
    firstName: trimmed.slice(0, boundary),
    lastName: trimmed.slice(boundary + 1),
  };
}

/** Rejoin the stored columns into the name as it was entered. */
export function joinFullName(
  parts: { firstName?: string | null; lastName?: string | null } | null,
): string {
  if (!parts) return "";
  return `${parts.firstName ?? ""} ${parts.lastName ?? ""}`.trim();
}

/** The two values the scope allows a tenant record to be. */
export const TENANT_ENTITY_TYPES = ["individual", "company"] as const;

export type TenantEntityType = (typeof TENANT_ENTITY_TYPES)[number];

export function isTenantEntityType(value: unknown): value is TenantEntityType {
  return TENANT_ENTITY_TYPES.includes(value as TenantEntityType);
}

export function normalizeEntityType(value: unknown): TenantEntityType {
  return isTenantEntityType(value) ? value : "individual";
}
