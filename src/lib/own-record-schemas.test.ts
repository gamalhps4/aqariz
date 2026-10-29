/**
 * What a signed-in person may change on their own row.
 *
 * `PUT /api/user/profile` validated with `userSchema.omit({ password })
 * .partial()`, and every role holds profile_management, so a tenant sent
 * `{"role":"admin"}` and became the office's administrator. A tenant could
 * also rewrite their own status, contract name and documents through
 * `PUT /api/tenants/[id]`. Both are whitelists now, and strict: a key they
 * do not name is refused, not applied and not silently dropped.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { ownProfileUpdateSchema, tenantSelfEditSchema } from "./validations";

function refused(result: { success: boolean }) {
  assert.equal(result.success, false, "expected the body to be refused");
}

describe("ownProfileUpdateSchema (PUT /api/user/profile)", () => {
  test("a role, any role, is refused", () => {
    refused(ownProfileUpdateSchema.safeParse({ role: "admin" }));
    refused(ownProfileUpdateSchema.safeParse({ role: "super_admin" }));
    refused(ownProfileUpdateSchema.safeParse({ firstName: "Sara", role: "manager" }));
  });

  test("office-controlled columns are refused, not dropped", () => {
    for (const body of [
      { tenantStatus: "active" },
      { creditScore: 850 },
      { documents: ["https://example.com/x.pdf"] },
      { backgroundCheckStatus: "approved" },
      { organizationId: "org-2" },
      { isActive: true },
      { permissionGrants: ["system_settings"] },
      { scopeRestricted: false },
      { emailVerified: new Date().toISOString() },
      { password: "Secret123$" },
      { ssn: "123-45-6789" },
    ]) {
      refused(ownProfileUpdateSchema.safeParse(body));
    }
  });

  test("the profile's own fields pass, with userSchema's rules", () => {
    const parsed = ownProfileUpdateSchema.safeParse({
      firstName: "سارة",
      lastName: "العتيبي",
      email: "sara@example.com",
      phone: "0501234567",
      avatar: "",
      bio: "About me",
      location: "Riyadh",
      city: "Riyadh",
      website: "https://example.com",
      address: "King Fahd Road",
      emergencyContacts: [{ name: "Ali", relationship: "brother", phone: "0500000000" }],
      dateOfBirth: "1990-05-01",
    });
    assert.equal(parsed.success, true);
    assert.ok(parsed.success && parsed.data.dateOfBirth instanceof Date);

    refused(ownProfileUpdateSchema.safeParse({ email: "not-an-email" }));
    refused(ownProfileUpdateSchema.safeParse({ firstName: "" }));
    refused(ownProfileUpdateSchema.safeParse({ dateOfBirth: "next tuesday" }));
    refused(ownProfileUpdateSchema.safeParse({ dateOfBirth: "2999-01-01" }));
  });

  test("a birth date can be cleared, and an empty body changes nothing", () => {
    const cleared = ownProfileUpdateSchema.safeParse({ dateOfBirth: null });
    assert.equal(cleared.success, true);
    assert.deepEqual(ownProfileUpdateSchema.safeParse({}).success, true);
  });
});

describe("tenantSelfEditSchema (a tenant on PUT /api/tenants/[id])", () => {
  test("phone and emergency contacts only", () => {
    assert.equal(
      tenantSelfEditSchema.safeParse({
        phone: "0501234567",
        emergencyContacts: [{ name: "Ali", relationship: "brother", phone: "0500000000" }],
      }).success,
      true,
    );
  });

  test("the office's record of the tenant is refused", () => {
    for (const body of [
      { tenantStatus: "approved" },
      { fullName: "Someone Else" },
      { idNumber: "1000000000" },
      { entityType: "company" },
      { email: "new@example.com" },
      { documents: [] },
      { applicationDate: "2020-01-01" },
      { creditScore: 850 },
      { avatar: "https://example.com/a.png" },
      { phone: "0501234567", tenantStatus: "active" },
    ]) {
      refused(tenantSelfEditSchema.safeParse(body));
    }
  });
});
