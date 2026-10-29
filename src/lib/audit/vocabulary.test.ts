/**
 * What a request names, for the entry the API wrapper writes when the route
 * wrote none — and the before and after of a change.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  AuditAction,
  categoryFor,
  describeApiRequest,
  isRecordId,
  pickRecordIdentity,
} from "@/lib/audit/vocabulary";
import { diffSnapshot, pickSnapshot, snapshotValue } from "@/lib/audit/diff";

const LEASE = "cmus8fbd500283o9ksjsargdg";
const INVOICE = "cmus8fbee002k3o9k19uzsw01";

describe("a request's record and action", () => {
  test("a contract action by its path segment", () => {
    const target = describeApiRequest("POST", `/api/leases/${LEASE}/terminate`);
    assert.equal(target?.action, AuditAction.TERMINATE);
    assert.equal(target?.recordType, "lease");
    assert.equal(target?.recordId, LEASE);
    assert.equal(target?.category, "lease_management");
    assert.equal(target?.route, "leases/:id/terminate");
  });

  test("an installment under its contract", () => {
    const target = describeApiRequest("PATCH", `/api/leases/${LEASE}/installments/${INVOICE}`);
    assert.equal(target?.recordType, "invoice");
    assert.equal(target?.recordId, INVOICE);
    assert.equal(target?.parentId, LEASE);
    assert.equal(target?.action, AuditAction.UPDATE);
  });

  test("a new record has no id in its path", () => {
    const target = describeApiRequest("POST", `/api/leases/${LEASE}/installments`);
    assert.equal(target?.action, AuditAction.CREATE);
    assert.equal(target?.recordType, "invoice");
    assert.equal(target?.recordId, null);
    assert.equal(target?.parentId, LEASE);
  });

  test("the archive names the record's collection after its own", () => {
    assert.equal(describeApiRequest("PATCH", `/api/archive/leases/${LEASE}`)?.action, AuditAction.RESTORE);
    const purge = describeApiRequest("DELETE", `/api/archive/tenants/${LEASE}`);
    assert.equal(purge?.action, AuditAction.PURGE);
    assert.equal(purge?.recordType, "tenant");
  });

  test("settings and one's own account are changed, never created", () => {
    assert.equal(describeApiRequest("PATCH", "/api/settings/display")?.action, AuditAction.SETTINGS_CHANGED);
    assert.equal(describeApiRequest("POST", "/api/user/avatar")?.action, AuditAction.UPDATE);
    const password = describeApiRequest("POST", "/api/user/change-password");
    assert.equal(password?.action, AuditAction.PASSWORD_CHANGED);
    assert.equal(password?.category, "authentication");
  });

  test("the permission page's saves are permission changes", () => {
    assert.equal(
      describeApiRequest("PUT", `/api/users/${LEASE}/permissions`)?.action,
      AuditAction.PERMISSION_GRANTED,
    );
    assert.equal(describeApiRequest("POST", "/api/users/assign-roles")?.action, AuditAction.ROLE_ASSIGNED);
    assert.equal(describeApiRequest("PUT", `/api/roles/${LEASE}`)?.recordType, "role");
  });

  test("the tenant portal and the console are read past their prefixes", () => {
    const pay = describeApiRequest("POST", `/api/tenant/payments/${INVOICE}/pay`);
    assert.equal(pay?.action, AuditAction.PAYMENT_PROCESSED);
    assert.equal(pay?.recordType, "payment");
    assert.equal(describeApiRequest("PATCH", `/api/admin/organizations/${LEASE}`)?.recordType, "organization");
  });

  test("traffic that is not an action is left out", () => {
    for (const path of [
      "/api/auth/sign-in/email",
      "/api/errors/log",
      "/api/push/subscribe",
      `/api/notifications/${LEASE}`,
      "/api/payments/webhook",
      "/api/cron/cleanup",
      "/api/upload/presign",
    ]) {
      assert.equal(describeApiRequest("POST", path), null, path);
    }
    assert.equal(describeApiRequest("POST", "/dashboard/leases"), null);
  });

  test("record ids are told apart from words", () => {
    assert.ok(isRecordId(LEASE));
    assert.ok(isRecordId("64b7f0c2a1b2c3d4e5f60718"));
    assert.ok(!isRecordId("installments"));
    assert.ok(!isRecordId("communications"));
  });

  test("a module follows the action where that decides, else the record", () => {
    assert.equal(categoryFor(AuditAction.LOGIN, "lease"), "authentication");
    assert.equal(categoryFor(AuditAction.UPDATE, "deposit"), "payment_management");
    assert.equal(categoryFor(AuditAction.UPDATE, "never_heard_of_it"), "system_configuration");
  });
});

describe("the record a write answered with", () => {
  test("by id and the name a reader knows it by", () => {
    assert.deepEqual(pickRecordIdentity({ id: "c1", contractNumber: "AGR-1", name: "x" }), {
      id: "c1",
      name: "AGR-1",
    });
    assert.deepEqual(pickRecordIdentity({ id: "t1", firstName: "Nora", lastName: "Saad" }), {
      id: "t1",
      name: "Nora Saad",
    });
  });

  test("one level down when the answer wraps it", () => {
    assert.deepEqual(
      pickRecordIdentity({ lease: { id: "l1", contractNumber: "AGR-9" }, invoiceGeneration: { ok: true } }, "lease"),
      { id: "l1", name: "AGR-9" },
    );
    assert.deepEqual(pickRecordIdentity({ role: { id: "r1", label: "Accountants" } }), {
      id: "r1",
      name: "Accountants",
    });
  });

  test("nothing from a list or a bare value", () => {
    assert.deepEqual(pickRecordIdentity([{ id: "a" }]), {});
    assert.deepEqual(pickRecordIdentity("ok"), {});
  });
});

describe("before and after", () => {
  test("only the fields that moved, on both sides", () => {
    const diff = diffSnapshot(
      { status: "active", rentAmount: 2500, notes: "x" },
      { status: "terminated", rentAmount: 2500, notes: "x" },
    );
    assert.deepEqual(diff.changed, ["status"]);
    assert.deepEqual(diff.before, { status: "active" });
    assert.deepEqual(diff.after, { status: "terminated" });
  });

  test("a date read back and the same date typed in are equal; so are 2500 and '2500.00'", () => {
    const diff = diffSnapshot(
      { endDate: new Date("2027-01-31T00:00:00.000Z"), rentAmount: 2500 },
      { endDate: "2027-01-31T00:00:00.000Z", rentAmount: "2500.00" },
    );
    assert.deepEqual(diff.changed, []);
  });

  test("permissions re-ordered are the same permissions", () => {
    assert.deepEqual(
      diffSnapshot({ permissions: ["a", "b"] }, { permissions: ["b", "a"] }).changed,
      [],
    );
    assert.deepEqual(
      diffSnapshot({ permissions: ["a"] }, { permissions: ["a", "c"] }).after,
      { permissions: ["a", "c"] },
    );
  });

  test("a field only on the old row was not touched; a named field is always compared", () => {
    assert.deepEqual(diffSnapshot({ a: 1, b: 2 }, { b: 3 }).changed, ["b"]);
    assert.deepEqual(diffSnapshot({ a: 1 }, {}, ["a"]).after, { a: null });
  });

  test("stored values are plain: dates as ISO strings, decimals as numbers", () => {
    assert.equal(snapshotValue(new Date("2026-10-03T00:00:00Z")), "2026-10-03T00:00:00.000Z");
    assert.equal(snapshotValue({ toNumber: () => 12.5 }), 12.5);
    assert.deepEqual(pickSnapshot({ a: 1, b: undefined, c: null }, ["a", "b", "c", "d"]), {
      a: 1,
      c: null,
    });
  });
});
