/**
 * A permission group gets exactly the permissions ticked for it.
 *
 * Three things used to break that, and each has tests here. A group's name
 * could resolve to a built-in role — "Administrator" was stored under a key
 * that is an alias of one — so its members got that role's rights and its
 * ticks were never read. Its tier was guessed from the ticks, so "Export
 * data" made it an administrator and a group holding nothing from a fixed
 * list was treated as a tenant. And the menu placed it by that guessed tier.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  canAccessNavItem,
  canManageTargetRole,
  canManageTargetUser,
  createAccessProfile,
  isWithinReach,
  isBuiltInRoleName,
  isReservedRoleName,
  matchesRequiredRoles,
  resolveSystemRole,
  type RoleLookup,
} from "@/lib/permissions-manager";
import { SYSTEM_PERMISSIONS } from "@/lib/permission-catalog";
import { UserRole } from "@/types";

/** The names the review found accepted for a group, as the keys they became. */
const ALIAS_NAMES = [
  "administrator",
  "property_manager",
  "maintenance_staff",
  "leasing_agent",
  "landlord",
  "renter",
];

/** A group is stored under the name and in force. */
const STORED: RoleLookup = { storedGroup: "active" };
/** A group is stored under the name, switched off or archived. */
const SWITCHED_OFF: RoleLookup = { storedGroup: "inactive" };
/** Nothing was ever stored under the name. */
const NOT_STORED: RoleLookup = { storedGroup: "none" };

describe("what a name resolves to", () => {
  test("a stored group is a group even when its name is an alias", () => {
    for (const name of ALIAS_NAMES) {
      const profile = createAccessProfile(name, ["lease_view"], null, STORED);

      assert.equal(profile.isCustomRole, true, name);
      assert.equal(profile.systemRole, null, name);
      assert.equal(profile.role, name);
      // Exactly what was ticked, plus what every signed-in user holds.
      assert.deepEqual(
        profile.permissions,
        ["profile_management", "lease_view"],
        name
      );
      assert.equal(profile.isAdmin, false, name);
      assert.equal(profile.isOwner, false, name);
      assert.equal(profile.isTenant, false, name);
    }
  });

  test("an alias with nothing stored under it is still its built-in role", () => {
    for (const lookup of [NOT_STORED, undefined]) {
      const profile = createAccessProfile("administrator", [], null, lookup);
      assert.equal(profile.systemRole, UserRole.ADMIN);
      assert.equal(profile.isAdmin, true);
      assert.ok(profile.permissions.includes("role_management"));
    }
  });

  test("the five built-in names are the system's, whatever is stored", () => {
    const profile = createAccessProfile("admin", ["lease_view"], null, STORED);
    assert.equal(profile.systemRole, UserRole.ADMIN);
    assert.equal(profile.isCustomRole, false);
    assert.ok(profile.permissions.includes("user_management"));
  });

  test("a name nobody has looked up is taken to be a group", () => {
    const profile = createAccessProfile("accounts", ["payment_view"]);
    assert.equal(profile.isCustomRole, true);
    assert.equal(profile.accessLevel, "manager");
    assert.deepEqual(profile.permissions, [
      "profile_management",
      "payment_view",
    ]);
  });

  test("a name that resolves to nothing gets the least access", () => {
    for (const lookup of [NOT_STORED, SWITCHED_OFF]) {
      const profile = createAccessProfile("accounts", [], null, lookup);
      assert.equal(profile.accessLevel, "tenant");
      assert.equal(profile.isCompanyStaff, false);
      assert.deepEqual(profile.permissions, ["profile_management"]);
    }
  });

  test("switching a group off does not hand its members the alias", () => {
    // The group still owns its name. Had the name fallen back to the alias
    // table, switching off a group stored as "administrator" would have made
    // administrators of everyone in it.
    for (const name of ALIAS_NAMES) {
      const profile = createAccessProfile(name, [], null, SWITCHED_OFF);

      assert.equal(profile.systemRole, null, name);
      assert.equal(profile.isAdmin, false, name);
      assert.equal(profile.isManager, false, name);
      assert.equal(profile.isOwner, false, name);
      assert.equal(profile.accessLevel, "tenant", name);
      assert.deepEqual(profile.permissions, ["profile_management"], name);
      assert.equal(
        matchesRequiredRoles(profile, [UserRole.ADMIN, UserRole.MANAGER]),
        false,
        name
      );
    }
  });

  test("a name every object has a property for is not a built-in role", () => {
    // Read straight off the alias table, "constructor" is a function.
    assert.equal(resolveSystemRole("constructor"), null);
    assert.equal(resolveSystemRole("__proto__"), null);

    const profile = createAccessProfile("constructor", ["lease_view"]);
    assert.equal(profile.isCustomRole, true);
    assert.equal(profile.role, "constructor");
    assert.ok(profile.permissions.includes("lease_view"));
  });

  test("a group is matched on its tier, never on its name", () => {
    const group = createAccessProfile("administrator", [], null, STORED);
    assert.equal(matchesRequiredRoles(group, [UserRole.ADMIN]), false);
    assert.equal(matchesRequiredRoles(group, [UserRole.MANAGER]), true);

    const legacy = createAccessProfile("administrator", [], null, NOT_STORED);
    assert.equal(matchesRequiredRoles(legacy, [UserRole.ADMIN]), true);
  });
});

describe("reserved names", () => {
  test("a built-in role's name or alias is reserved, however it is written", () => {
    const reserved = [
      // As the review found them accepted.
      "Administrator",
      "Property Manager",
      "Maintenance Staff",
      "Leasing Agent",
      "Landlord",
      "Renter",
      // The five built-in names themselves.
      "admin",
      "manager",
      "owner",
      "tenant",
      "super_admin",
      "Super Admin",
      // Spacing, case and punctuation do not make a different name.
      "property-manager",
      "  PROPERTY   MANAGER ",
      "leasing.agent",
      "Administrator!",
      "property_owner",
      "Resident",
      // Nor do accents, or characters that take up no room on a screen.
      "Ádmin",
      "ADMİN",
      "Adm\u200Bin",
      "Land\u00ADlord",
    ];
    for (const name of reserved) {
      assert.equal(isReservedRoleName(name), true, name);
    }
  });

  test("any other name is free, in any language", () => {
    const free = [
      "Accountants",
      "المحاسبون",
      "مدير admin",
      "Admin & Co",
      "Sales & Marketing",
      "Front-desk",
    ];
    for (const name of free) {
      assert.equal(isReservedRoleName(name), false, name);
    }
    assert.equal(isReservedRoleName(""), false);
    assert.equal(isReservedRoleName(null), false);
  });

  test("only the five names themselves are built in", () => {
    for (const name of Object.values(UserRole)) {
      assert.equal(isBuiltInRoleName(name), true, name);
    }
    assert.equal(isBuiltInRoleName(" Admin "), true);
    assert.equal(isBuiltInRoleName("administrator"), false);
    assert.equal(isBuiltInRoleName("accounts"), false);
    assert.equal(isBuiltInRoleName(null), false);
  });
});

describe("tier", () => {
  test("no permission makes a group an administrator", () => {
    // Each of these alone used to: they were the "admin-only" list.
    const onceAdminOnly = [
      "data_export",
      "advanced_analytics",
      "audit_logs",
      "user_management",
      "role_management",
      "system_settings",
      "backup_restore",
      "permanent_delete",
    ];
    for (const permission of onceAdminOnly) {
      const profile = createAccessProfile("auditors", [permission]);
      assert.equal(profile.isAdmin, false, permission);
      assert.equal(profile.accessLevel, "manager", permission);
      assert.ok(profile.permissions.includes(permission), permission);
    }
  });

  test("nor does every permission at once", () => {
    const profile = createAccessProfile("everything", SYSTEM_PERMISSIONS);
    assert.equal(profile.isAdmin, false);
    assert.equal(profile.isPlatform, false);
    for (const permission of SYSTEM_PERMISSIONS) {
      assert.ok(profile.permissions.includes(permission), permission);
    }
  });

  test("a group with no manager-level permission is staff, not a tenant", () => {
    // Neither of these was on the list that made a group "manager".
    const ownerDesk = createAccessProfile("owner_desk", [
      "owner_view",
      "agreement_view",
    ]);
    const empty = createAccessProfile("new_group", []);

    for (const profile of [ownerDesk, empty]) {
      assert.equal(profile.isTenant, false);
      assert.equal(profile.isOwner, false);
      assert.equal(profile.isCompanyStaff, true);
      assert.equal(profile.accessLevel, "manager");
    }
  });

  test("a permission granted to one person does not move their tier", () => {
    const granted = createAccessProfile("accounts", ["payment_view"], {
      grants: ["audit_logs"],
    });
    assert.ok(granted.permissions.includes("audit_logs"));
    assert.equal(granted.isAdmin, false);

    const manager = createAccessProfile(UserRole.MANAGER, [], {
      grants: ["data_export"],
    });
    assert.equal(manager.accessLevel, "manager");
  });

  test("the built-in roles keep the tiers they had", () => {
    const tiers: Array<[UserRole, string]> = [
      [UserRole.SUPER_ADMIN, "platform"],
      [UserRole.ADMIN, "admin"],
      [UserRole.MANAGER, "manager"],
      [UserRole.OWNER, "owner"],
      [UserRole.TENANT, "tenant"],
    ];
    for (const [role, tier] of tiers) {
      assert.equal(createAccessProfile(role).accessLevel, tier, role);
    }
    assert.equal(createAccessProfile(UserRole.ADMIN).isAdmin, true);
    assert.equal(createAccessProfile(UserRole.SUPER_ADMIN).isAdmin, true);
    assert.equal(createAccessProfile(UserRole.MANAGER).isAdmin, false);
  });

  test("a group holding the staff permissions still administers no staff", () => {
    const admin = createAccessProfile(UserRole.ADMIN);
    const office = createAccessProfile("office", [
      "user_management",
      "role_management",
    ]);
    const otherGroup = createAccessProfile("accounts", ["payment_view"]);

    // The Administrator keeps the whole organization below the platform.
    assert.equal(canManageTargetRole(admin, otherGroup), true);
    assert.equal(canManageTargetUser(admin, office), true);

    // The group reaches the office's clients and nobody on its own tier or
    // above it: it cannot make, change or hand out another group.
    assert.equal(canManageTargetRole(office, otherGroup), false);
    assert.equal(canManageTargetRole(office, admin), false);
    assert.equal(
      canManageTargetRole(office, createAccessProfile(UserRole.TENANT)),
      true
    );
    assert.equal(canManageTargetUser(office, otherGroup), false);
    assert.equal(
      canManageTargetUser(office, createAccessProfile(UserRole.MANAGER)),
      false
    );
    assert.equal(canManageTargetUser(office, admin), false);
    assert.equal(
      canManageTargetUser(office, createAccessProfile(UserRole.OWNER)),
      true
    );
  });
});

describe("the menu", () => {
  const admin = createAccessProfile(UserRole.ADMIN);
  const manager = createAccessProfile(UserRole.MANAGER);
  // The employee list, as the sidebar declares it.
  const employees = {
    roles: [UserRole.ADMIN],
    requiredPermissions: ["user_management", "user_view"],
  };

  test("a group reaches an Administrator's entry by the permission it names", () => {
    const personnel = createAccessProfile("personnel", ["user_view"]);
    const accounts = createAccessProfile("accounts", ["payment_view"]);

    assert.equal(canAccessNavItem(personnel, employees), true);
    assert.equal(canAccessNavItem(accounts, employees), false);
    // Built-in roles are placed by role, as they always were: the Manager
    // holds user_view and still does not get the entry.
    assert.equal(canAccessNavItem(admin, employees), true);
    assert.equal(canAccessNavItem(manager, employees), false);
  });

  test("an entry naming no permission stays with the roles it lists", () => {
    const everything = createAccessProfile("everything", SYSTEM_PERMISSIONS);

    assert.equal(
      canAccessNavItem(everything, { roles: [UserRole.ADMIN] }),
      false
    );
    assert.equal(
      canAccessNavItem(everything, {
        roles: [UserRole.ADMIN, UserRole.MANAGER, UserRole.TENANT],
      }),
      true
    );
  });

  test("staff entries open to a group that was once placed as a tenant", () => {
    const ownerDesk = createAccessProfile("owner_desk", ["owner_view"]);

    assert.equal(
      canAccessNavItem(ownerDesk, {
        roles: [UserRole.ADMIN, UserRole.MANAGER],
        requiredPermissions: ["owner_view", "owner_management"],
      }),
      true
    );
  });

  test("a tenant's or an owner's entry is never a group's", () => {
    const group = createAccessProfile("front_desk", [
      "payment_portal",
      "property_view",
      "reports_own",
    ]);

    assert.equal(
      canAccessNavItem(group, {
        roles: [UserRole.TENANT],
        requiredPermissions: ["payment_portal"],
      }),
      false
    );
    assert.equal(
      canAccessNavItem(group, {
        roles: [UserRole.OWNER],
        requiredPermissions: ["reports_own", "property_view"],
      }),
      false
    );
    assert.equal(canAccessNavItem(group, { roles: [UserRole.TENANT] }), false);
  });

  test("a built-in role is placed by role, whatever the entry's permissions", () => {
    // The Manager does not hold data_export, and sees the entry regardless.
    assert.equal(
      canAccessNavItem(manager, {
        roles: [UserRole.ADMIN, UserRole.MANAGER],
        requiredPermissions: ["data_export"],
      }),
      true
    );
  });

  test("a name that resolves to nothing sees no staff entry", () => {
    const unknown = createAccessProfile("accounts", [], null, NOT_STORED);

    assert.equal(
      canAccessNavItem(unknown, { roles: [UserRole.ADMIN, UserRole.MANAGER] }),
      false
    );
    assert.equal(
      canAccessNavItem(unknown, {
        roles: [UserRole.ADMIN, UserRole.MANAGER],
        requiredPermissions: ["profile_management"],
      }),
      false
    );
  });
});

/**
 * A group ticked Manage users / Manage roles manages staff and groups within
 * its own rights — the owner's decision of 2026-10-01. Nobody takes charge of
 * more than they hold: every permission the target ends up with, and every
 * building they see, the actor must hold and see too.
 */
describe("managing staff within one's own rights", () => {
  const supervisor = createAccessProfile("supervisors", [
    "user_view",
    "user_edit",
    "role_management",
    "tenant_view",
    "tenant_edit",
    "lease_view",
  ]);
  const clerk = createAccessProfile("clerks", ["tenant_view", "lease_view"]);
  const accountant = createAccessProfile("accounts", ["payment_view"]);
  const admin = createAccessProfile(UserRole.ADMIN);
  const within = { withinOwnRights: true };

  test("a group manages a colleague whose rights are all its own", () => {
    assert.equal(canManageTargetUser(supervisor, clerk, within), true);
  });

  test("but not one holding a right it lacks", () => {
    assert.equal(canManageTargetUser(supervisor, accountant, within), false);
  });

  test("a per-person grant on the target counts", () => {
    const widened = createAccessProfile("clerks", ["tenant_view"], {
      grants: ["payment_delete"],
    });
    assert.equal(canManageTargetUser(supervisor, widened, within), false);
  });

  test("the Administrator is never within a group's reach", () => {
    const everything = createAccessProfile("everything", [
      ...SYSTEM_PERMISSIONS,
    ]);
    assert.equal(canManageTargetUser(everything, admin, within), false);
  });

  test("without the option, staff stay with the Administrator", () => {
    assert.equal(canManageTargetUser(supervisor, clerk), false);
    assert.equal(canManageTargetUser(admin, clerk), true);
  });

  test("a narrowed actor reaches only colleagues inside its buildings", () => {
    const narrowed = { ...supervisor, scopedPropertyIds: ["b1", "b2"] };
    assert.equal(
      canManageTargetUser(
        narrowed,
        { ...clerk, scopedPropertyIds: ["b1"] },
        within,
      ),
      true,
    );
    assert.equal(
      canManageTargetUser(
        narrowed,
        { ...clerk, scopedPropertyIds: ["b1", "b3"] },
        within,
      ),
      false,
    );
    // Not narrowed at all is more than two buildings.
    assert.equal(canManageTargetUser(narrowed, clerk, within), false);
  });

  test("an actor who sees everything reaches a narrowed colleague", () => {
    assert.equal(
      canManageTargetUser(
        supervisor,
        { ...clerk, scopedPropertyIds: [] },
        within,
      ),
      true,
    );
  });

  test("a group makes and hands out only groups within its rights", () => {
    assert.equal(canManageTargetRole(supervisor, clerk), true);
    assert.equal(canManageTargetRole(supervisor, accountant), false);
    assert.equal(
      canManageTargetRole(supervisor, createAccessProfile(UserRole.MANAGER)),
      false,
    );
    assert.equal(canManageTargetRole(supervisor, admin), false);
  });

  test("without Manage roles it hands out nothing", () => {
    const noRoles = createAccessProfile("editors", [
      "user_edit",
      "tenant_view",
      "lease_view",
    ]);
    assert.equal(canManageTargetRole(noRoles, clerk), false);
  });

  test("reach compares buildings as sets", () => {
    assert.equal(
      isWithinReach(
        { permissions: ["a"], scopedPropertyIds: ["x"] },
        { permissions: ["a"], scopedPropertyIds: [] },
      ),
      true,
    );
    assert.equal(
      isWithinReach(
        { permissions: ["a"], scopedPropertyIds: [] },
        { permissions: ["a"], scopedPropertyIds: ["x"] },
      ),
      false,
    );
  });
});
