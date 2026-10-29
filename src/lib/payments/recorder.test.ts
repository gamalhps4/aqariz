/**
 * The "Recorded by" cell: the employee who recorded the money, "Online" when
 * a gateway took it, and nothing when nobody is on record.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { isOnlinePayment, recordedByText } from "@/lib/payments/recorder";

describe("recorded by", () => {
  test("names the employee", () => {
    assert.equal(
      recordedByText({ recordedBy: { firstName: "سارة", lastName: "العتيبي" } }, "Online"),
      "سارة العتيبي",
    );
  });

  test("reads Online for a gateway payment", () => {
    assert.equal(recordedByText({ stripeCheckoutSessionId: "cs_1" }, "Online"), "Online");
    assert.equal(recordedByText({ paypalCaptureId: "cap_1" }, "Online"), "Online");
  });

  test("an employee wins over the gateway that first opened the checkout", () => {
    assert.equal(
      recordedByText(
        { recordedBy: { firstName: "Omar", lastName: "" }, stripeCheckoutSessionId: "cs_1" },
        "Online",
      ),
      "Omar",
    );
  });

  test("a row recorded at the desk is not online, whatever checkout it still names", () => {
    assert.equal(
      recordedByText({ recordedById: "staff-1", gatewayPaymentId: "inv-uuid-1" }, "Online"),
      null,
    );
    assert.equal(isOnlinePayment({ recordedById: "staff-1", gatewayPaymentId: "inv-uuid-1" }), false);
    assert.equal(isOnlinePayment({ recordedById: null, gatewayPaymentId: "inv-uuid-1" }), true);
  });

  test("is empty for an older row with nobody on record", () => {
    assert.equal(recordedByText({}, "Online"), null);
    assert.equal(recordedByText({ recordedBy: null }, "Online"), null);
    assert.equal(
      recordedByText({ recordedBy: { firstName: " ", lastName: "" } }, "Online"),
      null,
    );
  });
});
