/**
 * PropertyPro - Saying why a tenant or owner was refused
 *
 * The tenant and owner routes answer with an English `error` for API clients
 * and a machine `code` (packages/contracts/src/errors.ts). Screens show the
 * code in the reader's language and fall back to the server's English only
 * for refusals that have no code. Shared, so the add, edit, quick-add and
 * delete screens say the same thing the same way.
 */

type Translate = (
  key: string,
  options?: { defaultValue?: string; values?: Record<string, string | number> },
) => string;

interface ErrorPayload {
  code?: unknown;
  error?: unknown;
  message?: unknown;
}

export function personErrorText(
  t: Translate,
  payload: unknown,
  fallback: string,
): string {
  const body = (payload ?? {}) as ErrorPayload;
  switch (body.code) {
    case "NAME_REQUIRED":
      return t("people.errors.nameRequired", {
        defaultValue: "A name is required.",
      });
    case "EMAIL_INVALID":
      return t("people.errors.emailInvalid", {
        defaultValue: "Enter a valid email address, or leave the email empty.",
      });
    case "EMAIL_TAKEN":
      return t("people.errors.emailTaken", {
        defaultValue: "Another account already uses this email address.",
      });
    case "TENANT_HAS_ACTIVE_LEASE":
      return t("tenants.delete.blockedActiveLease", {
        defaultValue:
          "This tenant has an active lease. Terminate the lease before deleting the tenant.",
      });
    case "OWNER_HAS_PROPERTIES":
      return t("clients.owners.delete.hasProperties", {
        defaultValue:
          "This owner still owns buildings. Reassign or archive them first.",
      });
    case "OWNER_IS_STAFF":
      return t("clients.owners.identity.isStaff", {
        defaultValue:
          "This owner is a member of staff. Change their name and email under Employees.",
      });
    default: {
      const text =
        (typeof body.error === "string" && body.error) ||
        (typeof body.message === "string" && body.message);
      return text || fallback;
    }
  }
}
