/**
 * PropertyPro - A person's name and email, as the office types them
 *
 * Tenants and owners are parties to a contract, not logins. The office records
 * plenty of them with a phone number and an ID and nothing else, so an email
 * address may simply not exist; and a name is one field, which may well be a
 * single word — a company, or a person known by one name. See lib/full-name.ts
 * for why the one field is split the way it is.
 *
 * Every route that writes a tenant or an owner reads the two fields through
 * here, so they all accept the same things and refuse the rest with the same
 * machine code, which the screens turn into the reader's language. Before
 * this, a one-word name came back from the tenant routes as
 * "lastName: Last name is required" — in English, whatever the screen spoke.
 *
 * No database here: the uniqueness of an address is lib/person-email.ts.
 */

import { splitFullName, type SplitName } from "@/lib/full-name";

/** The machine codes a person's fields are refused with. */
export type PersonFieldError = "NAME_REQUIRED" | "EMAIL_INVALID";

/**
 * The English an API client is told, beside the code. Screens show their own
 * translation of the code instead.
 */
export const PERSON_FIELD_MESSAGES: Record<PersonFieldError, string> = {
  NAME_REQUIRED: "A name is required.",
  EMAIL_INVALID: "Enter a valid email address, or leave the email empty.",
};

/**
 * The same pattern as `personEmail` in lib/validations.ts, which the forms
 * validate with — so the server never refuses an address a form accepted.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ReadResult<T> = { ok: true; value: T } | { ok: false; error: PersonFieldError };

/**
 * An email that may be absent.
 *
 * Blank — "", spaces, null, undefined — is an answer: this person has no
 * address, stored as NULL so that two such people never collide on the unique
 * column. Anything else must look like an address, and is stored lowercased,
 * as sign-in compares it.
 */
export function readOptionalEmail(value: unknown): ReadResult<string | null> {
  if (value === null || value === undefined) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false, error: "EMAIL_INVALID" };
  const trimmed = value.trim();
  if (trimmed === "") return { ok: true, value: null };
  if (trimmed.length > 200 || !EMAIL_PATTERN.test(trimmed)) {
    return { ok: false, error: "EMAIL_INVALID" };
  }
  return { ok: true, value: trimmed.toLowerCase() };
}

/**
 * A name, from whichever shape the request carries it in.
 *
 * The forms send one `fullName`; older callers and the import send
 * `firstName` and `lastName`. Either way the result is the two stored columns,
 * with `lastName` empty for a one-word name rather than an error.
 */
export function readPersonName(input: {
  fullName?: unknown;
  firstName?: unknown;
  lastName?: unknown;
}): ReadResult<SplitName> {
  const text = (value: unknown) =>
    typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";

  const full = text(input.fullName);
  const joined = full || [text(input.firstName), text(input.lastName)].filter(Boolean).join(" ");
  if (!joined) return { ok: false, error: "NAME_REQUIRED" };

  // Two separate fields are kept as the person typed them when both were
  // given: "Abdullah" / "Al Saud" must not become "Abdullah Al" / "Saud".
  if (!full && text(input.firstName) && text(input.lastName)) {
    return {
      ok: true,
      value: { firstName: text(input.firstName), lastName: text(input.lastName) },
    };
  }
  return { ok: true, value: splitFullName(joined) };
}
