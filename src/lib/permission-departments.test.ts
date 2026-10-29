/**
 * The permission-group page as the client drew it: a box per department, a
 * tick per box, Select All over the lot.
 *
 * What has to hold for the page to be honest: every right in the catalogue
 * can be granted from it (or is left off for a stated reason), no right sits
 * in two boxes where unticking one would leave it granted by the other, and
 * the whole-box and whole-page ticks move exactly the rights they show —
 * never one the page does not display, which a stored group may still hold.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  PAGE_PERMISSIONS,
  PERMISSIONS_NOT_ON_THE_PAGE,
  PERMISSION_DEPARTMENTS,
  departmentPermissions,
  departmentState,
  moduleState,
  pageState,
  toggleDepartment,
  togglePage,
} from "@/lib/permission-departments";
import { PERMISSION_MODULES } from "@/lib/permission-matrix";
import { SYSTEM_PERMISSIONS } from "@/lib/permission-catalog";

const department = (id: string) =>
  PERMISSION_DEPARTMENTS.find((entry) => entry.id === id)!;
const moduleById = (id: string) =>
  PERMISSION_MODULES.find((entry) => entry.id === id)!;

describe("the layout", () => {
  test("the client's seven departments come first, in their order", () => {
    assert.deepEqual(
      PERMISSION_DEPARTMENTS.slice(0, 7).map((entry) => entry.id),
      [
        "dashboard",
        "finance",
        "collections",
        "marketing",
        "operations",
        "customers",
        "employees",
      ],
    );
  });

  test("every permission is in a box or left off for a reason", () => {
    const onPage = new Set<string>(PAGE_PERMISSIONS);
    const leftOff = new Set(Object.keys(PERMISSIONS_NOT_ON_THE_PAGE));
    for (const permission of SYSTEM_PERMISSIONS) {
      assert.ok(
        onPage.has(permission) !== leftOff.has(permission),
        `${permission} must be in exactly one of: a box, the left-off list`,
      );
    }
  });

  test("no permission sits in two boxes", () => {
    const seen = new Map<string, string>();
    for (const entry of PERMISSION_DEPARTMENTS) {
      for (const permission of departmentPermissions(entry)) {
        assert.equal(
          seen.get(permission),
          undefined,
          `${permission} is in ${seen.get(permission)} and ${entry.id}`,
        );
        seen.set(permission, entry.id);
      }
    }
  });

  test("finance and employees have the five actions", () => {
    for (const id of ["employees", "invoices", "expenses"]) {
      const actions = moduleById(id).actions;
      for (const action of ["view", "create", "edit", "delete", "export"] as const) {
        assert.ok(actions[action], `${id} ${action}`);
      }
    }
    assert.ok(moduleById("accounting").actions.view);
    assert.ok(moduleById("accounting").actions.export);
  });
});

describe("a box's tick", () => {
  test("ticks exactly the box's rights", () => {
    const next = toggleDepartment([], department("customers"), true);
    assert.deepEqual(
      new Set(next),
      new Set(departmentPermissions(department("customers"))),
    );
    assert.equal(departmentState(next, department("customers")), "all");
    assert.equal(departmentState(next, department("finance")), "none");
  });

  test("unticking it leaves the other boxes alone", () => {
    const everything = togglePage([], true);
    const next = toggleDepartment(everything, department("customers"), false);
    assert.equal(departmentState(next, department("customers")), "none");
    assert.equal(departmentState(next, department("operations")), "all");
  });

  test("one action ticked reads as part of the box", () => {
    const next = ["tenant_view"];
    assert.equal(moduleState(next, moduleById("tenants")), "some");
    assert.equal(departmentState(next, department("customers")), "some");
  });

  test("the module's umbrella reads as all of it", () => {
    assert.equal(moduleState(["owner_management"], moduleById("owners")), "all");
  });

  test("full finance access covers invoices, expenses, the ledger and payments", () => {
    for (const id of ["invoices", "expenses", "accounting", "payments"]) {
      assert.equal(moduleState(["financial_management"], moduleById(id)), "all", id);
    }
  });
});

describe("Select All", () => {
  test("grants every right the page shows", () => {
    const next = togglePage([], true);
    assert.deepEqual(new Set(next), new Set(PAGE_PERMISSIONS));
    assert.equal(pageState(next), "all");
  });

  test("clearing everything keeps the rights the page does not show", () => {
    const stored = ["reports_all", "tenant_view", "payment_create"];
    const next = togglePage(stored, false);
    assert.deepEqual(next, ["reports_all"]);
    assert.equal(pageState(next), "none");
  });

  test("selecting everything keeps them too", () => {
    const next = togglePage(["reports_all"], true);
    assert.ok(next.includes("reports_all"));
  });

  test("a partly ticked page reads as partly ticked", () => {
    assert.equal(pageState(["lease_view"]), "some");
    assert.equal(pageState([]), "none");
  });
});
