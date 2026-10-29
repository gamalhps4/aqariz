/**
 * Who may do what with listings.
 *
 * The Marketing section's rights: View / Add / Edit / Delete (archive) /
 * Export with the umbrella, publishing and the inbox as rights of their own.
 * The checks that matter are the ones a custom group meets: a group that may
 * write ads but not print them, one that reads the inbox and nothing else, and
 * the umbrella that covers all of it.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  LISTING_ACCESS,
  accessList,
  anyListingRight,
  can,
  listingAbilities,
} from "@/lib/listings/permissions";
import { createAccessProfile } from "@/lib/permissions-manager";
import {
  PERMISSION_METADATA,
  SYSTEM_PERMISSIONS,
} from "@/lib/permission-catalog";
import { PERMISSION_MODULES } from "@/lib/permission-matrix";
import {
  PAGE_PERMISSIONS,
  PERMISSION_DEPARTMENTS,
  departmentPermissions,
} from "@/lib/permission-departments";

const LISTING_RIGHTS = [
  "listing_management",
  "listing_view",
  "listing_create",
  "listing_edit",
  "listing_delete",
  "listing_export",
  "listing_publish",
  "listing_inquiries",
] as const;

/** A permission group the organization defined — not a built-in role. */
const group = (...permissions: string[]) =>
  createAccessProfile("marketing_team", permissions, null, {
    storedGroup: "active",
  }).permissions;

describe("the catalogue", () => {
  test("holds every listing right, described", () => {
    for (const right of LISTING_RIGHTS) {
      assert.ok(
        (SYSTEM_PERMISSIONS as readonly string[]).includes(right),
        `${right} is in the catalogue`,
      );
      const meta = PERMISSION_METADATA[right];
      assert.ok(meta.label && meta.description && meta.group, right);
    }
  });

  test("every right the access table names exists", () => {
    const known = new Set<string>(SYSTEM_PERMISSIONS);
    for (const list of Object.values(LISTING_ACCESS)) {
      for (const right of list) assert.ok(known.has(right), right);
    }
  });
});

describe("the built-in roles", () => {
  const admin = createAccessProfile("admin").permissions;
  const manager = createAccessProfile("manager").permissions;
  const owner = createAccessProfile("owner").permissions;
  const tenant = createAccessProfile("tenant").permissions;

  test("the administrator and the manager run the Marketing section", () => {
    for (const held of [admin, manager]) {
      for (const right of LISTING_RIGHTS) assert.ok(held.includes(right), right);
      const abilities = listingAbilities(held);
      assert.deepEqual(
        { ...abilities, export: undefined },
        {
          view: true,
          create: true,
          edit: true,
          publish: true,
          archive: true,
          inquiries: true,
          settings: true,
          export: undefined,
        },
      );
    }
  });

  test("a property owner and a tenant are clients of the office and hold none of it", () => {
    for (const held of [owner, tenant]) {
      for (const right of LISTING_RIGHTS) assert.equal(held.includes(right), false, right);
      assert.equal(anyListingRight(held), false);
    }
  });
});

describe("a permission group", () => {
  test("view alone reads the list and nothing else", () => {
    const held = group("listing_view");
    assert.equal(can(held, "view"), true);
    for (const other of ["create", "edit", "publish", "archive", "inquiries", "settings"] as const) {
      assert.equal(can(held, other), false, other);
    }
  });

  test("writing the ads is not the right to print them", () => {
    const held = group("listing_view", "listing_create", "listing_edit");
    assert.equal(can(held, "create"), true);
    assert.equal(can(held, "edit"), true);
    assert.equal(can(held, "publish"), false);
    assert.equal(can(held, "archive"), false);
  });

  test("publishing is a right of its own", () => {
    const held = group("listing_view", "listing_publish");
    assert.equal(can(held, "publish"), true);
    assert.equal(can(held, "edit"), false);
  });

  test("archiving is the Delete right", () => {
    assert.equal(can(group("listing_delete"), "archive"), true);
    assert.equal(can(group("listing_edit"), "archive"), false);
  });

  test("the inbox is its own right: strangers' phone numbers", () => {
    assert.equal(can(group("listing_inquiries"), "inquiries"), true);
    assert.equal(can(group("listing_view", "listing_edit", "listing_publish"), "inquiries"), false);
    assert.equal(can(group("listing_inquiries"), "view"), false);
  });

  test("the umbrella covers every ability, including ones added later", () => {
    const held = group("listing_management");
    for (const ability of Object.keys(LISTING_ACCESS) as Array<keyof typeof LISTING_ACCESS>) {
      assert.equal(can(held, ability), true, ability);
    }
  });

  test("the office's licence and contacts open to the umbrella or company settings", () => {
    assert.equal(can(group("company_settings"), "settings"), true);
    assert.equal(can(group("listing_management"), "settings"), true);
    assert.equal(can(group("listing_edit"), "settings"), false);
  });

  test("a group with no listing right has no ability at all", () => {
    const held = group("lease_view", "tenant_view");
    assert.equal(anyListingRight(held), false);
    assert.deepEqual(
      Object.values({ ...listingAbilities(held), export: false }).filter(Boolean),
      [],
    );
  });

  test("nothing and nobody are no ability, not an error", () => {
    assert.equal(can(null, "view"), false);
    assert.equal(can(undefined, "publish"), false);
    assert.equal(can([], "edit"), false);
  });

  test("an API wrapper gets a plain copy of the list", () => {
    const list = accessList("publish");
    assert.deepEqual(list, ["listing_publish", "listing_management"]);
    list.push("x");
    assert.deepEqual(LISTING_ACCESS.publish, ["listing_publish", "listing_management"]);
  });
});

describe("the permission page", () => {
  const marketing = PERMISSION_DEPARTMENTS.find((entry) => entry.id === "marketing")!;

  test("the Marketing & Sales box offers every listing right", () => {
    const offered = new Set<string>(departmentPermissions(marketing));
    for (const right of LISTING_RIGHTS) assert.ok(offered.has(right), right);
  });

  test("and the page as a whole can grant them", () => {
    const page = new Set<string>(PAGE_PERMISSIONS);
    for (const right of LISTING_RIGHTS) assert.ok(page.has(right), right);
  });

  test("listings are a module with View, Add, Edit, Delete and Export and an umbrella", () => {
    const listings = PERMISSION_MODULES.find((entry) => entry.id === "listings")!;
    assert.deepEqual(listings.actions, {
      view: "listing_view",
      create: "listing_create",
      edit: "listing_edit",
      delete: "listing_delete",
      export: "listing_export",
    });
    assert.equal(listings.full, "listing_management");
  });
});
