/**
 * A gateway webhook event is claimed per office.
 *
 * The claim was (gateway, eventId) across every office, and PayTabs and Tap
 * event ids are built from guessable transaction ids, so one office could
 * claim another's event first and have its real webhook ignored.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { webhookClaimKey } from "./webhook-claim-key";

// Run from the repository root, like the rest of the suite.
const ROOT = process.cwd();

describe("webhookClaimKey", () => {
  const event = { gateway: "tap", eventId: "chg_123:CAPTURED" };

  test("two offices claiming the same event id are two claims", () => {
    const a = webhookClaimKey({ ...event, organizationId: "org-a" }, true);
    const b = webhookClaimKey({ ...event, organizationId: "org-b" }, true);
    assert.deepEqual(a, { gateway: "tap", organizationId: "org-a", eventId: "chg_123:CAPTURED" });
    assert.notDeepEqual(a, b);
  });

  test("before the migration the claim is the old global one", () => {
    assert.deepEqual(webhookClaimKey({ ...event, organizationId: "org-a" }, false), event);
  });

  test("the database's unique index is the per-office one, platform events included", () => {
    const schema = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8");
    const model = schema.slice(schema.indexOf("model WebhookEvent {"));
    const block = model.slice(0, model.indexOf("\n}"));
    assert.match(block, /@@unique\(\[gateway, organizationId, eventId\]\)/);
    assert.doesNotMatch(block, /@@unique\(\[gateway, eventId\]\)/);

    const migration = readFileSync(
      path.join(
        ROOT,
        "prisma/migrations/20261004220000_webhook_events_by_organization/migration.sql",
      ),
      "utf8",
    );
    assert.match(
      migration,
      /\("gateway", "organizationId", "eventId"\) NULLS NOT DISTINCT/,
    );
    assert.match(migration, /DROP INDEX IF EXISTS "webhook_events_gateway_eventId_key"/);
  });
});
