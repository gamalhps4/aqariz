/**
 * A menu link is gated by the same module as the screen it opens.
 *
 * The reports are one page each with the report named in the query, and the
 * query used to be dropped before the match, so every report on a page shared
 * one gate. Each report with its own menu entry is its own module now; the
 * query still never sends a path to another page's module, and segment
 * boundaries still hold.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  planFeatureLabel,
  resolveApiFeature,
  resolveAppFeature,
} from "@/lib/billing/plan-constants";

describe("the module a path belongs to", () => {
  test("a report link is gated as its own report", () => {
    assert.equal(
      resolveAppFeature("/dashboard/payments/reports?type=overdue"),
      "collections.overdue",
    );
    assert.equal(
      resolveAppFeature("/dashboard/leases/reports?type=renewed"),
      "leasing.reports.renewed",
    );
    assert.equal(
      resolveAppFeature("/dashboard/leases/reports"),
      "leasing.reports.registers",
    );
    assert.equal(
      resolveApiFeature("/api/payments/reports?type=overdue"),
      "collections.overdue",
    );
  });

  test("other query terms and the fragment never change the answer", () => {
    assert.equal(resolveAppFeature("/dashboard/payments?status=paid"), "collections.payments");
    assert.equal(resolveAppFeature("/dashboard/payments#recent"), "collections.payments");
    assert.equal(
      resolveAppFeature("/dashboard/agreements?sort=name"),
      resolveAppFeature("/dashboard/agreements"),
    );
  });

  test("a report's page and its API name the same module", () => {
    assert.equal(
      resolveAppFeature("/dashboard/properties/reports?type=unit-statement"),
      resolveApiFeature("/api/properties/reports?type=unit-statement"),
    );
  });

  test("segment boundaries still hold after the query is dropped", () => {
    assert.equal(resolveAppFeature("/dashboard/paymentsx?type=a"), null);
    assert.equal(resolveAppFeature("/dashboard/settings?tab=billing"), null);
    assert.equal(resolveApiFeature("/api/tenantsx"), null);
  });

  test("labels read for module keys and old flat keys alike", () => {
    assert.equal(planFeatureLabel("collections.payment_report"), "Payment report");
    assert.equal(planFeatureLabel("advanced_analytics"), "Advanced analytics");
    assert.equal(planFeatureLabel("no_such_key"), "no such key");
  });
});
