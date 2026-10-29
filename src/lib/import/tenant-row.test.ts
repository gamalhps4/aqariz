/**
 * One tenant row of an import file is held to the tenant form's rules.
 *
 * The importer required a first name, a last name and an email, so a file of
 * tenants recorded — like most of this office's — with a phone number and no
 * email imported nothing, and a one-word name was a "missing lastName".
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { readTenantRow } from "@/lib/import/tenant-row";

const row = (fields: Partial<Parameters<typeof readTenantRow>[0]>) =>
  readTenantRow({ fullName: "", firstName: "", lastName: "", email: "", ...fields });

describe("an import row", () => {
  test("without an email is imported without one", () => {
    assert.deepEqual(row({ fullName: "Mohammed Al Otaibi" }), {
      ok: true,
      value: { firstName: "Mohammed", lastName: "Al Otaibi", email: null },
    });
  });

  test("with a one-word name is imported", () => {
    assert.deepEqual(row({ firstName: "Noura" }), {
      ok: true,
      value: { firstName: "Noura", lastName: "", email: null },
    });
  });

  test("in the older two-column shape keeps both columns", () => {
    assert.deepEqual(
      row({ firstName: "Jordan", lastName: "Ellis", email: "Jordan@Example.com" }),
      {
        ok: true,
        value: { firstName: "Jordan", lastName: "Ellis", email: "jordan@example.com" },
      },
    );
  });

  test("with no name is refused with a code the screen translates", () => {
    const result = row({ email: "someone@example.com" });
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.issue.code, "nameMissing");
  });

  test("with a malformed email is refused, naming the address", () => {
    const result = row({ fullName: "Sara", email: " sara@ " });
    assert.equal(result.ok, false);
    assert.deepEqual(!result.ok && result.issue.values, { email: "sara@" });
    assert.equal(!result.ok && result.issue.code, "emailInvalid");
  });
});
