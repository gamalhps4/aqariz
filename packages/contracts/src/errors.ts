/**
 * Machine-readable API error codes. Every error response from the PropertyPro
 * API carries one in its `code` field — clients branch on these, never on the
 * human-readable `error` text.
 */
export const API_ERROR_CODES = {
  400: "BAD_REQUEST",
  401: "UNAUTHORIZED",
  402: "PLAN_LIMIT",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  410: "GONE",
  413: "PAYLOAD_TOO_LARGE",
  422: "VALIDATION_ERROR",
  429: "RATE_LIMITED",
  500: "INTERNAL_ERROR",
  502: "UPSTREAM_ERROR",
  503: "SERVICE_UNAVAILABLE",
} as const satisfies Record<number, string>;

export type ApiErrorCode =
  | (typeof API_ERROR_CODES)[keyof typeof API_ERROR_CODES]
  | "DUPLICATE"
  | "INVALID_ID"
  | "INVALID_REFERENCE"
  | "ORG_CONTEXT_REQUIRED"
  | "UNSUPPORTED_FILE_TYPE"
  /** The signed-in account must confirm its email address before it can use
   * the API. Clients should route the user to the verification screen rather
   * than showing a generic permission error. */
  | "EMAIL_NOT_VERIFIED"
  /** The caller is a support operator viewing another account; the request
   * was a write, and impersonated sessions may only read. */
  | "IMPERSONATION_READ_ONLY"
  /** A permission group was given the name of a built-in role or one of its
   * aliases ("Administrator", "Landlord"…). Another name will be accepted. */
  | "ROLE_NAME_RESERVED"
  /** Another role in the organization already goes by that name. */
  | "ROLE_NAME_TAKEN"
  /** A person (tenant, owner) was saved without a name. */
  | "NAME_REQUIRED"
  /** The email address given for a person is not a valid address. It may
   * be left out altogether; it may not be malformed. */
  | "EMAIL_INVALID"
  /** Another account already uses that email address. Addresses are unique
   * across the whole platform, not only within the organization. */
  | "EMAIL_TAKEN"
  /** The tenant still holds an active contract, which has to end first. */
  | "TENANT_HAS_ACTIVE_LEASE"
  /** The owner still owns buildings, which have to be reassigned or archived
   * first. */
  | "OWNER_HAS_PROPERTIES"
  /** The owner's identity belongs to a member of staff, whose name and email
   * are their sign-in and are changed under Employees instead. */
  | "OWNER_IS_STAFF"
  /** The unit is let — it has a current tenant or contract — and cannot be
   * archived until that ends. */
  | "UNIT_OCCUPIED";

export function defaultErrorCode(statusCode: number): string {
  return (
    API_ERROR_CODES[statusCode as keyof typeof API_ERROR_CODES] ??
    (statusCode >= 500 ? "INTERNAL_ERROR" : "BAD_REQUEST")
  );
}
