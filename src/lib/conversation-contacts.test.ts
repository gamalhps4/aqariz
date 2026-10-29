/**
 * Who a caller may list as a conversation contact.
 *
 * `GET /api/conversations/contacts?roles=tenant,owner` let a tenant read the
 * name and email of every tenant and owner in the office. The roles asked for
 * are now cut down to what the caller may see, and a building-limited
 * employee's tenants are those of their buildings.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  contactRoleWhere,
  roleList,
  visibleContactRoles,
} from "./conversation-contacts";

const tenant = { isTenant: true, isOwner: false };
const owner = { isTenant: false, isOwner: true };
const staff = { isTenant: false, isOwner: false };
const NOTHING = { id: { in: [] } };

function where(
  caller: { isTenant: boolean; isOwner?: boolean },
  roles: string | null,
  options: { exclude?: string | null; tenantScope?: object } = {},
) {
  return contactRoleWhere({
    visible: visibleContactRoles(caller),
    requested: roleList(roles),
    excluded: roleList(options.exclude ?? null),
    tenantScope: options.tenantScope ?? {},
  });
}

describe("contactRoleWhere", () => {
  test("a tenant asking for tenants and owners gets no one", () => {
    assert.deepEqual(where(tenant, "tenant,owner"), NOTHING);
    assert.deepEqual(where(tenant, "super_admin"), NOTHING);
  });

  test("a tenant asking for more than staff gets the staff only", () => {
    assert.deepEqual(where(tenant, "admin,tenant,owner"), { role: { in: ["admin"] } });
  });

  test("by default a tenant or an owner sees the office's staff", () => {
    assert.deepEqual(where(tenant, null), { role: { in: ["admin", "manager"] } });
    // An owner had no default at all, and so saw everyone.
    assert.deepEqual(where(owner, null), { role: { in: ["admin", "manager"] } });
    assert.deepEqual(where(owner, "tenant"), NOTHING);
  });

  test("staff see staff and tenants, and may narrow it", () => {
    assert.deepEqual(where(staff, null), { role: { in: ["admin", "manager", "tenant"] } });
    assert.deepEqual(where(staff, "tenant"), { role: { in: ["tenant"] } });
    assert.deepEqual(where(staff, null, { exclude: "tenant" }), {
      role: { in: ["admin", "manager"] },
    });
    assert.deepEqual(where(staff, "owner"), NOTHING);
  });

  test("a building-limited employee's tenants are those of their buildings", () => {
    const tenantScope = {
      leasesAsTenant: { some: { propertyId: { in: ["building-1"] }, deletedAt: null } },
    };
    assert.deepEqual(where(staff, null, { tenantScope }), {
      OR: [
        { role: { in: ["admin", "manager"] } },
        { AND: [{ role: "tenant" }, tenantScope] },
      ],
    });
    assert.deepEqual(where(staff, "tenant", { tenantScope }), {
      OR: [{ AND: [{ role: "tenant" }, tenantScope] }],
    });
    // Asking for staff only, the scope has nothing to narrow.
    assert.deepEqual(where(staff, "admin", { tenantScope }), { role: { in: ["admin"] } });
  });

  test("blank and repeated roles in the parameter", () => {
    assert.deepEqual(roleList(" admin, ,admin "), ["admin", "admin"]);
    assert.deepEqual(where(staff, " admin, ,admin "), { role: { in: ["admin"] } });
    // An empty parameter is no parameter, as before.
    assert.deepEqual(roleList(" , "), null);
    assert.deepEqual(where(tenant, ""), { role: { in: ["admin", "manager"] } });
  });
});
