/**
 * PropertyPro - One tenant row of an import file
 *
 * The same rules as the tenant form (lib/person-fields.ts), so a spreadsheet
 * is held to exactly what the screen would accept: a name is required and may
 * be a single word, from one `fullName` column or from `firstName` and
 * `lastName`; an email may be left out, and is refused only when it is there
 * and malformed. The importer used to require all three, so a file of
 * tenants recorded — like most of this office's — without an email imported
 * nothing.
 *
 * No database, so it can be tested; lib/import/importers.ts does the rest.
 */

import { readOptionalEmail, readPersonName } from "@/lib/person-fields";

export interface TenantRowIssue {
  message: string;
  /** Said on the import screen as `import.issue.<code>`. */
  code: string;
  values?: Record<string, string | number>;
}

export interface TenantRowFields {
  fullName: string;
  firstName: string;
  lastName: string;
  email: string;
}

export type TenantRowResult =
  | {
      ok: true;
      value: { firstName: string; lastName: string; email: string | null };
    }
  | { ok: false; issue: TenantRowIssue };

export function readTenantRow(fields: TenantRowFields): TenantRowResult {
  const name = readPersonName(fields);
  if (!name.ok) {
    return {
      ok: false,
      issue: { message: "Missing required name", code: "nameMissing" },
    };
  }

  const email = readOptionalEmail(fields.email);
  if (!email.ok) {
    return {
      ok: false,
      issue: {
        message: `"${fields.email.trim()}" is not a valid email address`,
        code: "emailInvalid",
        values: { email: fields.email.trim() },
      },
    };
  }

  return {
    ok: true,
    value: { ...name.value, email: email.value },
  };
}
