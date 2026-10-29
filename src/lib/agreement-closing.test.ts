/**
 * Closing an agreement records the day it closed.
 *
 * An agreement marked expired or terminated with neither an end date nor a
 * termination date earns nothing at all (`agreementTerm`) — not even for the
 * months it was in force. Only an edit to "terminated" recorded a date;
 * marking it expired, creating it closed and archiving it did not.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { agreementTerm } from "@/lib/agreement-math";
import { closingDate, isClosedAgreementStatus } from "@/lib/agreement-closing";

const NOW = new Date("2026-10-01T09:30:00.000Z");
const START = new Date("2026-01-01T00:00:00.000Z");

describe("closingDate", () => {
  test("an open agreement records nothing", () => {
    for (const status of ["active", "draft"]) {
      assert.equal(
        closingDate({ status, endDate: null, terminatedDate: null }, NOW),
        null,
      );
    }
    assert.equal(isClosedAgreementStatus("active"), false);
  });

  test("terminating records the day, unless one is on record", () => {
    assert.equal(
      closingDate({ status: "terminated", endDate: null, terminatedDate: null }, NOW),
      NOW,
    );
    assert.equal(
      closingDate(
        {
          status: "terminated",
          endDate: null,
          terminatedDate: new Date("2026-05-01T00:00:00.000Z"),
        },
        NOW,
      ),
      null,
    );
  });

  test("marking it expired with no end date records the day", () => {
    assert.equal(
      closingDate({ status: "expired", endDate: null, terminatedDate: null }, NOW),
      NOW,
    );
  });

  test("expired on or after its end date: the end date says when", () => {
    assert.equal(
      closingDate(
        {
          status: "expired",
          endDate: new Date("2026-06-30T00:00:00.000Z"),
          terminatedDate: null,
        },
        NOW,
      ),
      null,
    );
  });

  test("expired before its end date: closed early, on the day", () => {
    assert.equal(
      closingDate(
        {
          status: "expired",
          endDate: new Date("2027-06-30T00:00:00.000Z"),
          terminatedDate: null,
        },
        NOW,
      ),
      NOW,
    );
  });

  test("with the day recorded, the months it was in force still earn", () => {
    const closed = { status: "expired", startDate: START, endDate: null };
    // Without a date it was never in force at all …
    assert.equal(agreementTerm({ ...closed, terminatedDate: null }), null);
    // … with one, it was, to the end of the day it closed.
    const term = agreementTerm({
      ...closed,
      terminatedDate: closingDate({ ...closed, terminatedDate: null }, NOW),
    });
    assert.ok(term);
    assert.equal(term.startDate.toISOString(), "2026-01-01T00:00:00.000Z");
    assert.equal(term.endDate?.toISOString(), "2026-10-01T23:59:59.999Z");
  });
});
