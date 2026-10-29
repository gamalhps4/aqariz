/**
 * Who may destroy a record for good.
 *
 * Two gates, and both must hold: the account owner or a platform super admin
 * (a role rule, so an administrator cannot grant it to themselves), holding
 * the `permanent_delete` permission (so the owner can withhold it). The purge
 * asked both; the flag that tells the archive screen whether to offer the
 * delete button asked only the first, so a caller without the permission saw
 * a button that answered 403.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { canPermanentlyDelete, canPurgeArchive } from "@/lib/archive-access";
import { createAccessProfile } from "@/lib/permissions-manager";

const admin = createAccessProfile("admin").permissions;
const adminWithoutPermanentDelete = createAccessProfile("admin", [], {
  denials: ["permanent_delete"],
}).permissions;
const manager = createAccessProfile("manager").permissions;

const owner = { isOrganizationOwner: true, isPlatformAdmin: false };
const platformAdmin = { isOrganizationOwner: false, isPlatformAdmin: true };
const employee = { isOrganizationOwner: false, isPlatformAdmin: false };

describe("the role rule", () => {
  test("is the account owner or a platform super admin", () => {
    assert.equal(canPurgeArchive(owner), true);
    assert.equal(canPurgeArchive(platformAdmin), true);
    assert.equal(canPurgeArchive(employee), false);
    assert.equal(canPurgeArchive({ isPlatformAdmin: false }), false);
  });
});

describe("permanent deletion", () => {
  test("the administrator role carries the permission, the manager role does not", () => {
    assert.equal(admin.includes("permanent_delete"), true);
    assert.equal(manager.includes("permanent_delete"), false);
  });

  test("is allowed to the owner and the platform admin who hold the permission", () => {
    assert.equal(canPermanentlyDelete({ ...owner, permissions: admin }), true);
    assert.equal(
      canPermanentlyDelete({ ...platformAdmin, permissions: admin }),
      true,
    );
  });

  test("is refused to an owner the permission was withheld from", () => {
    const withheld = { ...owner, permissions: adminWithoutPermanentDelete };
    assert.equal(canPurgeArchive(withheld), true, "the role rule alone says yes");
    assert.equal(canPermanentlyDelete(withheld), false);
    assert.equal(canPermanentlyDelete({ ...owner, permissions: manager }), false);
  });

  test("is refused to an administrator who is not the owner, whatever they hold", () => {
    assert.equal(canPermanentlyDelete({ ...employee, permissions: admin }), false);
    assert.equal(
      canPermanentlyDelete({
        ...employee,
        permissions: [...manager, "permanent_delete"],
      }),
      false,
    );
  });
});
