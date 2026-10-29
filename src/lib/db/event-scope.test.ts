/**
 * An employee limited to some buildings sees the calendar of those buildings,
 * and the events they organize or are invited to — not the whole office's.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { eventAllows, eventScope } from "@/lib/db/event-scope";

const staff = { id: "me", isTenant: false };
const narrowed = { ...staff, scopedPropertyIds: ["b1"] };

describe("the calendar of an employee limited to some buildings", () => {
  test("an employee who is not limited sees every event", () => {
    assert.deepEqual(eventScope(staff), {});
    assert.equal(eventAllows(staff, { propertyId: "b9" }), true);
  });

  test("a limited one sees events on their buildings", () => {
    assert.equal(eventAllows(narrowed, { propertyId: "b1" }), true);
    assert.equal(eventAllows(narrowed, { propertyId: "b2" }), false);
  });

  test("and the events they organize or are invited to, wherever they are", () => {
    assert.equal(
      eventAllows(narrowed, { propertyId: "b2", organizerId: "me" }),
      true,
    );
    assert.equal(
      eventAllows(narrowed, { propertyId: null, attendeeIds: ["me"] }),
      true,
    );
  });

  test("but not an office event of other people's", () => {
    assert.equal(
      eventAllows(narrowed, { propertyId: null, organizerId: "boss" }),
      false,
    );
  });

  test("assigned nothing, they see only their own events", () => {
    const none = { ...staff, scopedPropertyIds: [] };
    assert.equal(eventAllows(none, { propertyId: "b1" }), false);
    assert.deepEqual(eventScope(none), {
      OR: [
        { propertyId: { in: [] } },
        { organizerId: "me" },
        { attendeeIds: { has: "me" } },
      ],
    });
  });

  test("a tenant is left to the calendar route's own rule", () => {
    assert.deepEqual(eventScope({ id: "t", isTenant: true }), {});
  });
});
