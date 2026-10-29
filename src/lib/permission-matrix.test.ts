/**
 * "Allow permissions to be defined separately for View, Add, Edit, Delete,
 * and Export."
 *
 * The table on the permission-group screen is only honest if ticking a cell
 * grants exactly that right and unticking one takes exactly that right away —
 * including when the module's umbrella was what granted it. The easy mistake
 * is unticking "Delete" on a row that holds `*_management` and leaving the
 * umbrella in place, so the group can still delete; the second test below is
 * that mistake.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  MATRIX_PERMISSIONS,
  PERMISSION_MODULES,
  isGranted,
  isModuleFull,
  toggleAction,
  toggleModule,
} from "@/lib/permission-matrix";
import { SYSTEM_PERMISSIONS } from "@/lib/permission-catalog";

const tenants = PERMISSION_MODULES.find((module) => module.id === "tenants")!;
const payments = PERMISSION_MODULES.find((module) => module.id === "payments")!;

describe("cells", () => {
  test("ticking one action grants that permission alone", () => {
    const next = toggleAction([], tenants, "delete", true);
    assert.deepEqual(next, ["tenant_delete"]);
    assert.equal(isGranted(next, tenants, "edit"), false);
  });

  test("unticking an action the umbrella covered takes only that action away", () => {
    const next = toggleAction(["tenant_management"], tenants, "delete", false);
    assert.equal(next.includes("tenant_management"), false, "umbrella must go");
    assert.equal(isGranted(next, tenants, "delete"), false);
    for (const action of ["view", "create", "edit", "export"] as const) {
      assert.equal(isGranted(next, tenants, action), true, action);
    }
  });

  test("the umbrella reads as every action granted", () => {
    for (const action of ["view", "create", "edit", "delete", "export"] as const) {
      assert.equal(isGranted(["tenant_management"], tenants, action), true);
    }
  });
});

describe("rows", () => {
  test("full access grants the five and the umbrella", () => {
    const next = toggleModule([], tenants, true);
    assert.equal(isModuleFull(next, tenants), true);
    assert.ok(next.includes("tenant_management"));
    assert.ok(next.includes("tenant_export"));
  });

  test("clearing a row leaves other modules alone", () => {
    const next = toggleModule(["tenant_view", "lease_view"], tenants, false);
    assert.deepEqual(next, ["lease_view"]);
  });

  test("a module without an umbrella is full when all five are held", () => {
    // Payments has no umbrella of its own: financial_management also covers
    // invoices and expenses, so it is never granted as "all of payments".
    assert.equal(payments.full, undefined);
    const next = toggleModule([], payments, true);
    assert.equal(isModuleFull(next, payments), true);
    assert.equal(next.includes("financial_management"), false);
  });
});

describe("catalogue", () => {
  test("every permission in the table exists", () => {
    const known = new Set<string>(SYSTEM_PERMISSIONS);
    for (const permission of MATRIX_PERMISSIONS) {
      assert.ok(known.has(permission), `${permission} is not in the catalogue`);
    }
  });

  test("every module offers all five actions", () => {
    // The ledger is a view over what the other modules recorded: there is
    // nothing in it to add, edit or delete.
    const readOnly = new Set(["accounting"]);
    for (const entry of PERMISSION_MODULES) {
      const actions = readOnly.has(entry.id)
        ? (["view", "export"] as const)
        : (["view", "create", "edit", "delete", "export"] as const);
      for (const action of actions) {
        assert.ok(entry.actions[action], `${entry.id} is missing ${action}`);
      }
    }
  });
});
