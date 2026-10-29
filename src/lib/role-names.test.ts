/**
 * "Names in Arabic, or with & - ., are rejected."
 *
 * The screen turned what was typed into the key a group is stored under, and
 * the server held that key to a-z, 0-9 and underscores, so an office could
 * not call a group المحاسبون or "Sales & Marketing" at all. The label is now
 * free and the key is made for it; these tests are what "made for it" has to
 * mean — always storable, never a built-in role's name, never one already in
 * use — and that a group is then found by exactly that key.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  ROLE_LABEL_ERRORS,
  roleLabelProblem,
  roleListFilter,
  roleNameFromLabel,
  uniqueRoleName,
} from "@/lib/role-names";
import {
  isBuiltInRoleName,
  isReservedRoleName,
} from "@/lib/permissions-manager";

/** What the role table has always held a name to. */
const STORABLE = /^[a-z0-9_]{1,50}$/;

describe("the stored name", () => {
  test("Latin letters and digits carry over", () => {
    assert.equal(roleNameFromLabel("Accounts Team"), "accounts_team");
    assert.equal(roleNameFromLabel("Sales & Marketing"), "sales_marketing");
    assert.equal(roleNameFromLabel("Team-A.1"), "team_a_1");
    assert.equal(roleNameFromLabel("  Front   Desk  "), "front_desk");
    assert.equal(roleNameFromLabel("Gérance"), "gerance");
  });

  test("an Arabic label is keyed without its letters", () => {
    assert.equal(roleNameFromLabel("المحاسبون"), "group");
    assert.equal(roleNameFromLabel("إدارة العقود"), "group");
    // Whatever Latin it carries is kept.
    assert.equal(roleNameFromLabel("مدير IT"), "it");
  });

  test("it is always storable, whatever was typed", () => {
    const labels = [
      "المحاسبون",
      "مشرف & صيانة",
      "Sales & Marketing",
      "—",
      "🏢",
      "Team-A.1",
      "x".repeat(200),
      "A very long name for a group that somebody typed out in full ".repeat(3),
    ];
    for (const label of labels) {
      assert.match(roleNameFromLabel(label), STORABLE, label);
    }
  });

  test("it is never a built-in role's name or alias", () => {
    // None of these labels is reserved itself; each reduces to a name that is.
    const labels = ["مدير admin", "المالك landlord", "Administrator ✓ مساعد"];
    for (const label of labels) {
      assert.equal(isReservedRoleName(label), false, label);

      const name = roleNameFromLabel(label);
      assert.equal(isReservedRoleName(name), false, name);
      assert.equal(isBuiltInRoleName(name), false, name);
      assert.match(name, STORABLE);
    }
    assert.equal(roleNameFromLabel("مدير admin"), "group_admin");
  });

  test("a name in use is not given out again", () => {
    assert.equal(uniqueRoleName("accounts", new Set()), "accounts");
    assert.equal(uniqueRoleName("accounts", new Set(["accounts"])), "accounts_2");
    assert.equal(
      uniqueRoleName("accounts", new Set(["accounts", "accounts_2"])),
      "accounts_3"
    );
  });

  test("two Arabic groups get two names", () => {
    const first = uniqueRoleName(roleNameFromLabel("المحاسبون"), new Set());
    const second = uniqueRoleName(
      roleNameFromLabel("خدمة العملاء"),
      new Set([first])
    );
    assert.equal(first, "group");
    assert.equal(second, "group_2");
  });

  test("the longest name still fits with its counter", () => {
    const base = roleNameFromLabel(`admin ${"x".repeat(200)}`);
    const taken = new Set([base]);
    for (let counter = 2; counter < 1000; counter += 1) {
      taken.add(`${base}_${counter}`);
    }
    assert.match(uniqueRoleName(base, taken), STORABLE);
  });
});

describe("the label", () => {
  test("any label is accepted, Arabic included", () => {
    for (const label of ["المحاسبون", "Sales & Marketing", "Team-A.1"]) {
      assert.equal(roleLabelProblem(label, []), null, label);
    }
  });

  test("a built-in role's name or alias is refused", () => {
    const reserved = [
      "Administrator",
      "Property Manager",
      "Maintenance Staff",
      "Leasing Agent",
      "Landlord",
      "Renter",
      "property-manager",
    ];
    for (const label of reserved) {
      assert.equal(roleLabelProblem(label, []), "reserved", label);
    }
  });

  test("a label another role already goes by is refused", () => {
    const others = [{ label: "المحاسبون" }, { label: "Accounts Team" }];

    assert.equal(roleLabelProblem("المحاسبون", others), "taken");
    assert.equal(roleLabelProblem("  المحاسبون ", others), "taken");
    assert.equal(roleLabelProblem("accounts  team", others), "taken");
    // A zero-width joiner changes nothing a reader can see.
    assert.equal(roleLabelProblem("المحاسبون\u200D", others), "taken");
    assert.equal(roleLabelProblem("المحاسبون الجدد", others), null);
  });

  test("the Arabic name is held to both names of every other group", () => {
    const others = [
      { label: "Accountants", labelAr: "المحاسبون" },
      { label: "مشرفو المباني", labelAr: null },
    ];

    // Another group's Arabic name, typed as a label or as an Arabic name.
    assert.equal(roleLabelProblem("المحاسبون", others), "taken");
    assert.equal(
      roleLabelProblem({ label: "Accounts", labelAr: "المحاسبون" }, others),
      "taken",
    );
    // Another group's label, typed as an Arabic name.
    assert.equal(
      roleLabelProblem({ label: "Supervisors", labelAr: "مشرفو المباني" }, others),
      "taken",
    );
    assert.equal(
      roleLabelProblem({ label: "Collectors", labelAr: "المحصلون" }, others),
      null,
    );
    // A group may be called the same in both languages.
    assert.equal(
      roleLabelProblem({ label: "المحصلون", labelAr: "المحصلون" }, []),
      null,
    );
  });

  test("an Arabic name that spells a built-in role is refused", () => {
    assert.equal(
      roleLabelProblem({ label: "Office", labelAr: "Administrator" }, []),
      "reserved",
    );
  });

  test("each refusal has a code the screen can translate", () => {
    assert.equal(ROLE_LABEL_ERRORS.reserved.code, "ROLE_NAME_RESERVED");
    assert.equal(ROLE_LABEL_ERRORS.taken.code, "ROLE_NAME_TAKEN");
  });
});

describe("finding a group by name", () => {
  const roleManager = { canManageRoles: true, roleName: "admin" };
  const member = { canManageRoles: false, roleName: "accounts" };

  test("a lookup is equality on the stored name", () => {
    assert.deepEqual(roleListFilter(roleManager, { name: "accounts" }), {
      isActive: true,
      deletedAt: null,
      isSystem: false,
      name: "accounts",
    });
  });

  test("a lookup is never widened into a search", () => {
    // `search=accounts` matches "accounts_senior", and any group whose
    // description mentions accounts; with a name given it must not be used.
    const where = roleListFilter(roleManager, {
      name: " Accounts ",
      search: "accounts",
    });
    assert.equal(where?.name, "accounts");
    assert.equal(where?.OR, undefined);
  });

  test("the role screen's search is still a search", () => {
    const where = roleListFilter(roleManager, { search: "acc" });
    assert.equal(where?.name, undefined);
    assert.deepEqual(where?.OR, [
      { label: { contains: "acc", mode: "insensitive" } },
      { labelAr: { contains: "acc", mode: "insensitive" } },
      { description: { contains: "acc", mode: "insensitive" } },
      { name: { contains: "acc", mode: "insensitive" } },
    ]);
  });

  test("without role_management a caller reads their own group only", () => {
    const own = {
      isActive: true,
      deletedAt: null,
      isSystem: false,
      name: "accounts",
    };
    assert.deepEqual(roleListFilter(member, { name: "accounts" }), own);
    // The older way of asking still answers the same one row.
    assert.deepEqual(roleListFilter(member, { search: "Accounts" }), own);

    assert.equal(roleListFilter(member, { name: "accounts_senior" }), null);
    assert.equal(roleListFilter(member, { search: "acc" }), null);
    assert.equal(roleListFilter(member, {}), null);
    assert.equal(
      roleListFilter(
        { canManageRoles: false, roleName: null },
        { name: "accounts" }
      ),
      null
    );
  });

  test("their own group is all a member gets, whatever else is asked", () => {
    const where = roleListFilter(member, {
      name: "accounts",
      includeSystem: true,
    });
    assert.equal(where?.name, "accounts");
    assert.equal(where?.isSystem, false);
  });

  test("a member can learn that their group was switched off or archived", () => {
    // What the permission hook asks: it has to tell a group that is no
    // longer in force from a name nothing was ever stored under.
    assert.deepEqual(
      roleListFilter(member, { name: "accounts", includeInactive: true }),
      { name: "accounts", isSystem: false }
    );
  });

  test("the listing switches behave as before", () => {
    assert.deepEqual(
      roleListFilter(roleManager, { includeSystem: true, includeInactive: true }),
      {}
    );
    assert.deepEqual(roleListFilter(roleManager, {}), {
      isActive: true,
      deletedAt: null,
      isSystem: false,
    });
  });
});
