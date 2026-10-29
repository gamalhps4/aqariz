/**
 * What one activity entry holds.
 *
 * The client asked to "clearly identify the specific employee responsible for
 * each operation": the entry has to carry the person's name, email and role as
 * they were — a user row can be renamed or deleted afterwards — and say on
 * whose behalf a support operator acted. An actor with no organization (a
 * platform operator, an address with no account) used to be dropped; they go
 * to the platform's own log.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { resolveActivity, platformActionName } from "@/lib/audit/entry";
import { scopeForRequest } from "@/lib/audit/scope";
import { AuditAction } from "@/lib/audit/vocabulary";

const request = (method: string, path: string) => ({
  method,
  url: `http://localhost:3000${path}`,
  headers: new Headers({ "x-forwarded-for": "203.0.113.9", "user-agent": "UA" }),
});

const accountant = scopeForRequest(
  {
    id: "user_7",
    email: "sara@office.sa",
    firstName: "Sara",
    lastName: "Hassan",
    role: "group_2",
    isCustomRole: true,
    isPlatformAdmin: false,
    organizationId: "org_1",
    sessionId: "s_1",
    impersonatedBy: null,
  },
  request("PATCH", "/api/payments/p1"),
);

describe("an organization entry", () => {
  test("copies the actor from the request: id, name, email, role", () => {
    const resolved = resolveActivity(
      {
        action: AuditAction.PAYMENT_PROCESSED,
        recordType: "payment",
        recordId: "p1",
        recordName: "RENT-000003",
        messageParams: { amount: 5000 },
      },
      accountant,
    );
    assert.equal(resolved.kind, "org");
    if (resolved.kind !== "org") return;
    const row = resolved.row;
    assert.equal(row.organizationId, "org_1");
    assert.equal(row.userId, "user_7");
    assert.equal(row.userName, "Sara Hassan");
    assert.equal(row.userEmail, "sara@office.sa");
    assert.equal(row.userRole, "group_2");
    assert.equal(row.ipAddress, "203.0.113.9");
    assert.equal(row.userAgent, "UA");
    assert.equal(row.sessionId, "s_1");
    // A permission group's key says nothing; the writer adds its name.
    assert.equal(row.details?.actorRoleIsGroup, true);
    assert.equal(row.category, "payment_management");
  });

  test("keys the sentence by the action, and writes its English for the fallback", () => {
    const resolved = resolveActivity(
      {
        action: AuditAction.STATUS_CHANGED,
        recordType: "lease",
        recordId: "l1",
        recordName: "AGR-2023-002",
        messageParams: { from: "active", to: "terminated" },
      },
      accountant,
    );
    assert.equal(resolved.kind, "org");
    if (resolved.kind !== "org") return;
    assert.equal(resolved.row.messageKey, "admin.audit.msg.status_changed");
    assert.deepEqual(resolved.row.messageParams, { from: "active", to: "terminated" });
    assert.equal(resolved.row.description, "Changed the status from Active to Terminated");
    // The contract by its number, not its id.
    assert.equal(resolved.row.resourceName, "AGR-2023-002");
  });

  test("keeps a description the caller wrote, and an explicit key", () => {
    const resolved = resolveActivity(
      {
        action: AuditAction.UPDATE,
        recordType: "user",
        messageKey: "admin.audit.msg.permissions_changed",
        description: "Updated permission overrides for Sara Hassan",
      },
      accountant,
    );
    if (resolved.kind !== "org") throw new Error("expected an org entry");
    assert.equal(resolved.row.messageKey, "admin.audit.msg.permissions_changed");
    assert.equal(resolved.row.description, "Updated permission overrides for Sara Hassan");
  });

  test("names the support operator viewing as the actor", () => {
    const viewing = { ...accountant, impersonator: { id: "op_1", email: "ops@propertypro.sa" } };
    const resolved = resolveActivity(
      { action: AuditAction.BULK_EXPORT, recordType: "report", recordName: "Payments Report" },
      viewing,
    );
    if (resolved.kind !== "org") throw new Error("expected an org entry");
    assert.equal(resolved.row.impersonatedBy, "op_1");
    assert.deepEqual(resolved.row.details?.impersonator, { id: "op_1", email: "ops@propertypro.sa" });
  });

  test("a scheduled job or webhook is the system's, in the organization it names", () => {
    const resolved = resolveActivity({
      action: AuditAction.PAYMENT_PROCESSED,
      recordType: "payment",
      recordId: "p9",
      organizationId: "org_2",
    });
    if (resolved.kind !== "org") throw new Error("expected an org entry");
    assert.equal(resolved.row.organizationId, "org_2");
    assert.equal(resolved.row.userId, null);
    assert.equal(resolved.row.source, "system");
  });

  test("deleting is marked important; reading the record is not", () => {
    const purge = resolveActivity({ action: AuditAction.PURGE, recordType: "tenant" }, accountant);
    if (purge.kind !== "org") throw new Error("expected an org entry");
    assert.equal(purge.row.severity, "high");
    assert.ok(purge.row.tags.includes("high_priority"));
    const created = resolveActivity({ action: AuditAction.CREATE, recordType: "unit" }, accountant);
    if (created.kind !== "org") throw new Error("expected an org entry");
    assert.equal(created.row.severity, "low");
  });
});

describe("an actor with no organization", () => {
  const operator = scopeForRequest(
    {
      id: "op_1",
      email: "ops@propertypro.sa",
      firstName: "Platform",
      lastName: "Owner",
      role: "super_admin",
      isPlatformAdmin: true,
      organizationId: null,
    },
    request("POST", "/api/admin/settings"),
  );

  test("goes to the platform log instead of being dropped", () => {
    const resolved = resolveActivity({ action: AuditAction.LOGIN }, operator);
    assert.equal(resolved.kind, "platform");
    if (resolved.kind !== "platform") return;
    assert.equal(resolved.row.action, "auth.login");
    assert.equal(resolved.row.actorId, "op_1");
    assert.equal(resolved.row.actorName, "Platform Owner");
    assert.equal(resolved.row.actorEmail, "ops@propertypro.sa");
    assert.equal(resolved.row.targetType, "auth");
    assert.equal(resolved.row.ipAddress, "203.0.113.9");
  });

  test("a sign-in attempt on an unknown address is filed under the address", () => {
    const resolved = resolveActivity({
      action: AuditAction.LOGIN_FAILED,
      organizationId: null,
      actor: { id: "", name: null, email: "nobody@example.com", role: null, isPlatformAdmin: false },
      messageParams: { email: "nobody@example.com" },
    });
    if (resolved.kind !== "platform") throw new Error("expected a platform entry");
    assert.equal(resolved.row.actorId, "anonymous");
    assert.equal(resolved.row.actorEmail, "nobody@example.com");
    assert.equal(resolved.row.action, "auth.login_failed");
  });

  test("a console change keeps its before and after", () => {
    const resolved = resolveActivity(
      {
        action: AuditAction.UPDATE,
        recordType: "organization",
        recordId: "org_3",
        recordName: "Demo Realty",
        before: { status: "active" },
        after: { status: "suspended" },
      },
      operator,
    );
    if (resolved.kind !== "platform") throw new Error("expected a platform entry");
    assert.equal(resolved.row.action, "organization.updated");
    assert.equal(resolved.row.organizationId, "org_3");
    assert.deepEqual(resolved.row.metadata.previous, { status: "active" });
    assert.deepEqual(resolved.row.metadata.current, { status: "suspended" });
  });

  test("names the platform log's actions in its own style", () => {
    assert.equal(platformActionName("bulk_export", "report"), "data.exported");
    assert.equal(platformActionName("create", "plan"), "plan.created");
    assert.equal(platformActionName("settings_changed", "settings"), "settings.updated");
    assert.equal(platformActionName("password_changed"), "auth.password_changed");
  });
});
