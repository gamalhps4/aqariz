/**
 * The contract page's buttons follow the routes behind them.
 *
 * "Record a payment" was offered to every member of staff and refused by the
 * server for anyone without a payment right. The rights are now the routes'
 * own permission lists, worked out from the caller's resolved permissions.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { contractRights } from "@/lib/contract-rights";

describe("what a viewer may do on a contract", () => {
  test("an agent who may only edit contracts records no payment", () => {
    const rights = contractRights({
      permissions: ["lease_view", "lease_edit"],
      isTenant: false,
    });
    assert.equal(rights.recordPayments, false);
    assert.equal(rights.deletePayments, false);
    assert.equal(rights.editInstallments, true);
    assert.equal(rights.editContract, true);
    assert.equal(rights.generateInstallments, true);
    assert.equal(rights.viewInvoices, false);
  });

  test("a collector granted `payment_create` alone may record, and nothing else", () => {
    // The permission an administrator can grant one person on top of a role.
    const rights = contractRights({
      permissions: ["lease_view", "payment_create"],
      isTenant: false,
    });
    assert.equal(rights.recordPayments, true);
    assert.equal(rights.editInstallments, false);
    assert.equal(rights.deletePayments, false);
    // Billing the unbilled is open to whoever records payments.
    assert.equal(rights.generateInstallments, true);
  });

  test("finance staff see the invoice register and may delete payments", () => {
    const rights = contractRights({
      permissions: ["financial_management"],
      isTenant: false,
    });
    assert.equal(rights.viewInvoices, true);
    assert.equal(rights.deletePayments, true);
    assert.equal(rights.recordPayments, true);
  });

  test("a tenant's contract is read-only, whatever they hold", () => {
    const rights = contractRights({
      permissions: ["payment_create", "lease_edit", "financial_management"],
      isTenant: true,
    });
    assert.ok(Object.values(rights).every((may) => may === false));
  });
});
