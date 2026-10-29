/**
 * Two promises a contract's lifecycle has to keep, and used not to.
 *
 * A contract in force has its installments billed. They were generated only
 * when a contract was *created* active with auto-generation switched on, so a
 * renewal — created as a draft, activated later — kept a schedule of "Not
 * billed yet" rows nobody could settle, and nothing on screen could bill them.
 *
 * A cancelled contract says when, by whom and why. Only the terminate form
 * recorded that; the contracts list, the contract card and the status changer
 * set the status alone, and those contracts reached the Cancelled register
 * with no date — then fell out of it the moment a date range was chosen.
 *
 * The rules are pure, so they are pinned here without a database: when
 * billing runs, that running it twice bills nothing twice, which transitions
 * set it off, and what a cancellation writes.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  LEASE_STATUS_TRANSITIONS,
  awaitsActivation,
  backfilledCancellationDate,
  billsOnArrival,
  canBillInstallments,
  cancellationRecord,
  holdsUnit,
  isLiveRenewal,
  isPastCalendarDay,
  isValidLeaseStatusTransition,
  leaseTransitionRefusal,
  releasesUnit,
  stepsAsideFor,
  unbilledInstallments,
  withdrawsRenewal,
} from "@/lib/lease-lifecycle";
import { planInstallments } from "@/lib/lease-installments";
import { renewalStatus } from "@/lib/lease-renewal";
import { LeaseStatus } from "@/types";

const ALL_STATUSES = Object.values(LeaseStatus);

/** Every [from, to] the transition table allows. */
const TRANSITIONS = ALL_STATUSES.flatMap((from) =>
  LEASE_STATUS_TRANSITIONS[from].map((to) => [from, to] as const),
);

/** A year of monthly rent: twelve installments, 1 Jan to 1 Dec. */
const YEAR = planInstallments({
  startDate: "2026-01-01",
  endDate: "2026-12-31",
  rentAmount: 1000,
  frequency: "monthly",
});

describe("when a contract is billed", () => {
  test("coming into force bills it; no other status does", () => {
    for (const status of ALL_STATUSES) {
      assert.equal(
        billsOnArrival(status),
        status === LeaseStatus.ACTIVE,
        `arriving ${status}`,
      );
    }
  });

  test("every road into force is a billing transition", () => {
    // Draft, pending and awaiting signature can each become active, by a
    // signature or a status change. All three bill — not just the create form.
    const intoForce = TRANSITIONS.filter(([, to]) => billsOnArrival(to));
    assert.deepEqual(
      intoForce.map(([from]) => from).sort(),
      [
        LeaseStatus.DRAFT,
        LeaseStatus.PENDING,
        LeaseStatus.PENDING_SIGNATURE,
      ].sort(),
    );
  });

  test("expiring, cancelling and being renewed bill nothing", () => {
    for (const [from, to] of TRANSITIONS) {
      if (to === LeaseStatus.ACTIVE) continue;
      assert.equal(billsOnArrival(to), false, `${from} → ${to}`);
    }
  });

  test("a contract already in force is not billed again by a repeated request", () => {
    // "Activate" sent to an active contract changes nothing, so it arrives
    // nowhere. Automatic billing happens once, on arrival; a contract in
    // force with installments missing is for the deliberate action instead.
    assert.equal(billsOnArrival(LeaseStatus.ACTIVE, false), false);
    assert.equal(billsOnArrival(LeaseStatus.ACTIVE, true), true);
  });

  test("a renewal activated at once is billed at once", () => {
    // The reported case. The successor used to be a draft, always.
    assert.equal(renewalStatus(true), LeaseStatus.ACTIVE);
    assert.equal(billsOnArrival(renewalStatus(true)), true);
  });

  test("a renewal left as a draft is billed when it becomes active", () => {
    const draft = renewalStatus(false);
    assert.equal(draft, LeaseStatus.DRAFT);
    assert.equal(billsOnArrival(draft), false);
    assert.equal(canBillInstallments(draft), false);
    // …and it can still get there, at which point the rule above applies.
    assert.equal(isValidLeaseStatusTransition(draft, LeaseStatus.ACTIVE), true);
    assert.equal(awaitsActivation(draft), true);
  });

  test("the old contract steps aside for its successor", () => {
    // Active or lapsed, it may become RENEWED — and nothing else may.
    const renewable = ALL_STATUSES.filter((status) =>
      LEASE_STATUS_TRANSITIONS[status].includes(LeaseStatus.RENEWED),
    );
    assert.deepEqual(renewable.sort(), [
      LeaseStatus.ACTIVE,
      LeaseStatus.EXPIRED,
    ].sort());
    // A renewed contract is finished: it cannot come back and hold the unit.
    assert.deepEqual(LEASE_STATUS_TRANSITIONS[LeaseStatus.RENEWED], []);
  });

  test("a contract that ran can still be billed by hand; one that never did cannot", () => {
    // The schedule's "Generate installments" action. In force, lapsed or
    // renewed, the rent was owed. A draft is billed on activation instead,
    // and a cancelled contract's unbilled periods were cancelled with it.
    assert.deepEqual(
      ALL_STATUSES.filter((status) => canBillInstallments(status)).sort(),
      [LeaseStatus.ACTIVE, LeaseStatus.EXPIRED, LeaseStatus.RENEWED].sort(),
    );
    assert.equal(canBillInstallments(undefined), false);
  });

  test("whatever is billed on arrival is billable", () => {
    // The automatic rule must never ask the generator for something the
    // generator refuses.
    for (const status of ALL_STATUSES) {
      if (billsOnArrival(status)) {
        assert.equal(canBillInstallments(status), true, status);
      }
    }
  });

  test("only a contract not yet in force is waiting to be billed", () => {
    assert.deepEqual(
      ALL_STATUSES.filter((status) => awaitsActivation(status)).sort(),
      [
        LeaseStatus.DRAFT,
        LeaseStatus.PENDING,
        LeaseStatus.PENDING_SIGNATURE,
      ].sort(),
    );
    assert.equal(awaitsActivation(undefined), false);
  });
});

describe("what is left to bill", () => {
  test("nothing billed: the whole schedule", () => {
    assert.equal(YEAR.length, 12);
    assert.deepEqual(unbilledInstallments(YEAR, []), YEAR);
  });

  test("fully billed: nothing", () => {
    assert.deepEqual(
      unbilledInstallments(
        YEAR,
        YEAR.map((installment) => installment.periodStart),
      ),
      [],
    );
  });

  test("partly billed: only the missing periods, in schedule order", () => {
    const billed = [YEAR[0], YEAR[1], YEAR[5]].map(
      (installment) => installment.periodStart,
    );
    const left = unbilledInstallments(YEAR, billed);
    assert.deepEqual(
      left.map((installment) => installment.index),
      [3, 4, 5, 7, 8, 9, 10, 11, 12],
    );
  });

  test("running it twice bills nothing twice", () => {
    // The generator's loop, minus the database: bill what is returned,
    // remember it as billed, and ask again.
    const billed: Date[] = [];
    const run = () => {
      const todo = unbilledInstallments(YEAR, billed);
      billed.push(...todo.map((installment) => installment.periodStart));
      return todo.length;
    };

    assert.equal(run(), 12);
    assert.equal(run(), 0);
    assert.equal(run(), 0);
    assert.equal(billed.length, 12);
  });

  test("a run that stopped half-way is finished by the next, not repeated", () => {
    // Seven installments written, then a failure. The retry — the automatic
    // one or the "Generate installments" button — owes exactly the other five.
    const firstRun = YEAR.slice(0, 7).map((installment) => installment.periodStart);
    const retry = unbilledInstallments(YEAR, firstRun);
    assert.deepEqual(
      retry.map((installment) => installment.index),
      [8, 9, 10, 11, 12],
    );
  });

  test("an installment the office removed is not billed again", () => {
    // Removing an installment cancels its invoice; the invoice, and with it
    // the period, stays. The caller passes every invoice that is not deleted,
    // cancelled ones included — so March stays removed.
    const everyPeriod = YEAR.map((installment) => installment.periodStart);
    assert.deepEqual(unbilledInstallments(YEAR, everyPeriod), []);
  });

  test("periods match however the database hands the date back", () => {
    const asStrings = YEAR.map((installment) =>
      installment.periodStart.toISOString(),
    );
    assert.deepEqual(unbilledInstallments(YEAR, asStrings), []);
  });

  test("a one-off charge covers no period of the schedule", () => {
    // Manual installments carry no period; they must not pass for billing.
    assert.deepEqual(unbilledInstallments(YEAR, [null, undefined]), YEAR);
  });

  test("an invoice for a period the contract no longer has hides nothing", () => {
    // Left over when a contract's dates or cycle changed after billing.
    const stray = new Date("2025-06-15T00:00:00.000Z");
    assert.deepEqual(unbilledInstallments(YEAR, [stray]), YEAR);
  });

  test("a contract with no schedule has nothing to bill", () => {
    assert.deepEqual(unbilledInstallments([], []), []);
  });
});

describe("what a cancellation records", () => {
  const NOW = new Date("2026-09-30T10:00:00.000Z");

  test("the terminate form: the day, the person and the reason", () => {
    const day = new Date("2026-10-15T00:00:00.000Z");
    assert.deepEqual(
      cancellationRecord({
        previousStatus: LeaseStatus.ACTIVE,
        userId: "user_1",
        date: day,
        reason: "Tenant relocated",
        now: NOW,
      }),
      {
        terminatedDate: day,
        terminatedById: "user_1",
        terminationReason: "Tenant relocated",
      },
    );
  });

  test("a bare status change still records when and by whom", () => {
    // The contracts list, the contract card and the status changer used to
    // leave both empty.
    assert.deepEqual(
      cancellationRecord({
        previousStatus: LeaseStatus.ACTIVE,
        userId: "user_1",
        now: NOW,
      }),
      { terminatedDate: NOW, terminatedById: "user_1" },
    );
  });

  test("no reason is recorded as no reason, not as an empty one", () => {
    for (const reason of [undefined, null, "", "   ", 42, {}]) {
      const record = cancellationRecord({
        previousStatus: LeaseStatus.ACTIVE,
        userId: "user_1",
        reason,
        now: NOW,
      });
      assert.ok(record);
      assert.equal("terminationReason" in record, false, String(reason));
    }
  });

  test("the reason is trimmed and kept to the form's limit", () => {
    const record = cancellationRecord({
      previousStatus: LeaseStatus.ACTIVE,
      userId: "user_1",
      reason: `  ${"x".repeat(1500)}  `,
      now: NOW,
    });
    assert.equal(record?.terminationReason?.length, 1000);
  });

  test("a date that is not a date falls back to the moment of cancelling", () => {
    const record = cancellationRecord({
      previousStatus: LeaseStatus.ACTIVE,
      userId: "user_1",
      date: new Date("not a date"),
      now: NOW,
    });
    assert.equal(record?.terminatedDate, NOW);
  });

  test("a contract already cancelled keeps its record", () => {
    // Asking twice must not move the date of the first cancellation, nor put
    // a second person's name on it.
    assert.equal(
      cancellationRecord({
        previousStatus: LeaseStatus.TERMINATED,
        userId: "user_2",
        reason: "Again",
        now: NOW,
      }),
      null,
    );
  });

  test("every status a contract can be cancelled from produces a record", () => {
    const cancellable = TRANSITIONS.filter(
      ([, to]) => to === LeaseStatus.TERMINATED,
    ).map(([from]) => from);
    assert.ok(cancellable.includes(LeaseStatus.ACTIVE));

    for (const from of cancellable) {
      const record = cancellationRecord({
        previousStatus: from,
        userId: "user_1",
        now: NOW,
      });
      assert.ok(record, from);
      assert.equal(record.terminatedDate, NOW);
      assert.equal(record.terminatedById, "user_1");
    }
  });
});

describe("the termination date", () => {
  // A date input's value parses to UTC midnight.
  const day = (iso: string) => new Date(iso);

  test("today is not in the past — at any hour", () => {
    // The terminate form opens on today. Compared as an instant, midnight
    // today was already behind the clock, so the form's own default was
    // refused: "Termination date cannot be in the past".
    for (const clock of [
      "2026-09-30T00:00:00.000Z",
      "2026-09-30T00:00:01.000Z",
      "2026-09-30T14:07:26.000Z",
      "2026-09-30T23:59:59.999Z",
    ]) {
      assert.equal(
        isPastCalendarDay(day("2026-09-30"), new Date(clock)),
        false,
        clock,
      );
    }
  });

  test("yesterday is", () => {
    assert.equal(
      isPastCalendarDay(day("2026-09-29"), new Date("2026-09-30T00:00:00.000Z")),
      true,
    );
  });

  test("a later day is not", () => {
    assert.equal(
      isPastCalendarDay(day("2026-10-01"), new Date("2026-09-30T23:59:59.999Z")),
      false,
    );
  });

  test("an office ahead of UTC can always cancel on its own today", () => {
    // Riyadh, 01:00 on 1 October: still 30 September in UTC. The form sends
    // the office's date, which is never behind the UTC one.
    assert.equal(
      isPastCalendarDay(day("2026-10-01"), new Date("2026-09-30T22:00:00.000Z")),
      false,
    );
  });
});

describe("dating a contract cancelled without a record", () => {
  const updatedAt = new Date("2026-08-20T09:00:00.000Z");

  test("the audit trail's moment, when it recorded the change", () => {
    const auditedAt = new Date("2026-08-01T12:30:00.000Z");
    assert.deepEqual(backfilledCancellationDate({ auditedAt, updatedAt }), {
      date: auditedAt,
      source: "audit",
    });
  });

  test("otherwise the row's last change", () => {
    for (const auditedAt of [undefined, null]) {
      assert.deepEqual(backfilledCancellationDate({ auditedAt, updatedAt }), {
        date: updatedAt,
        source: "updatedAt",
      });
    }
  });
});

describe("every status change goes through the table", () => {
  test("a change the table allows is not refused", () => {
    for (const [from, to] of TRANSITIONS) {
      assert.equal(leaseTransitionRefusal(from, to), null, `${from} -> ${to}`);
    }
  });

  test("activating, expiring or cancelling from the wrong state is refused", () => {
    // The actions that used to skip the table: activate, expire, terminate.
    assert.match(
      leaseTransitionRefusal(LeaseStatus.TERMINATED, LeaseStatus.ACTIVE) ?? "",
      /Invalid status transition/,
    );
    assert.ok(leaseTransitionRefusal(LeaseStatus.DRAFT, LeaseStatus.EXPIRED));
    assert.ok(leaseTransitionRefusal(LeaseStatus.RENEWED, LeaseStatus.TERMINATED));
    assert.ok(leaseTransitionRefusal(LeaseStatus.EXPIRED, LeaseStatus.ACTIVE));
  });

  test("repeating the current status is not a transition", () => {
    for (const status of ALL_STATUSES) {
      assert.equal(leaseTransitionRefusal(status, status), null);
    }
  });

  test("a status the system does not know is refused", () => {
    assert.match(
      leaseTransitionRefusal(LeaseStatus.ACTIVE, "delinquent") ?? "",
      /Unknown contract status/,
    );
  });
});

describe("a renewal hands the unit over", () => {
  const renewed = {
    status: LeaseStatus.ACTIVE,
    renewedLeaseId: "next",
    deletedAt: null,
  };

  test("the contract it renews steps aside only when the renewal comes into force", () => {
    assert.equal(stepsAsideFor(renewed, "next"), true);
    assert.equal(
      stepsAsideFor({ ...renewed, status: LeaseStatus.EXPIRED }, "next"),
      true,
    );
    // Not a contract that names another successor, nor one already ended.
    assert.equal(stepsAsideFor(renewed, "someone-else"), false);
    assert.equal(
      stepsAsideFor({ ...renewed, status: LeaseStatus.TERMINATED }, "next"),
      false,
    );
    assert.equal(
      stepsAsideFor({ ...renewed, status: LeaseStatus.RENEWED }, "next"),
      false,
    );
    assert.equal(stepsAsideFor(null, "next"), false);
  });

  test("a withdrawn renewal no longer stands", () => {
    assert.equal(isLiveRenewal({ status: LeaseStatus.DRAFT }), true);
    assert.equal(isLiveRenewal({ status: LeaseStatus.ACTIVE }), true);
    assert.equal(isLiveRenewal({ status: LeaseStatus.TERMINATED }), false);
    assert.equal(
      isLiveRenewal({ status: LeaseStatus.DRAFT, deletedAt: new Date() }),
      false,
    );
    assert.equal(isLiveRenewal(null), false);
  });

  test("cancelling a renewal before it came into force withdraws it", () => {
    for (const from of [
      LeaseStatus.DRAFT,
      LeaseStatus.PENDING,
      LeaseStatus.PENDING_SIGNATURE,
    ]) {
      assert.equal(
        withdrawsRenewal({ from, to: LeaseStatus.TERMINATED, parentLeaseId: "old" }),
        true,
      );
    }
    assert.equal(
      withdrawsRenewal({
        from: LeaseStatus.ACTIVE,
        to: LeaseStatus.TERMINATED,
        parentLeaseId: "old",
      }),
      false,
    );
    assert.equal(
      withdrawsRenewal({ from: LeaseStatus.DRAFT, to: LeaseStatus.TERMINATED }),
      false,
    );
  });
});

describe("a unit is freed only when nobody else holds it", () => {
  const NOW = new Date("2026-06-15T10:00:00Z");

  test("ending the contract the unit belongs to frees it", () => {
    assert.equal(
      releasesUnit({
        leaseId: "a",
        otherActive: false,
        pointedAt: { id: "a", status: LeaseStatus.TERMINATED, endDate: "2026-12-31" },
        now: NOW,
      }),
      true,
    );
  });

  test("cancelling a draft on a unit another contract is living in does not", () => {
    // The renewal withdrawn before it was activated: its predecessor is in
    // force, and its tenant's unit used to be marked available.
    assert.equal(
      releasesUnit({ leaseId: "draft", otherActive: true, now: NOW }),
      false,
    );
    assert.equal(
      releasesUnit({
        leaseId: "draft",
        otherActive: false,
        pointedAt: { id: "old", status: LeaseStatus.ACTIVE, endDate: "2026-12-31" },
        now: NOW,
      }),
      false,
    );
  });

  test("a renewed contract within its term still holds the unit it points at", () => {
    const renewed = { id: "old", status: LeaseStatus.RENEWED, endDate: "2026-06-15" };
    assert.equal(holdsUnit(renewed, NOW), true);
    assert.equal(
      releasesUnit({ leaseId: "draft", otherActive: false, pointedAt: renewed, now: NOW }),
      false,
    );
    // Its last day over, it holds nothing.
    assert.equal(holdsUnit({ ...renewed, endDate: "2026-06-14" }, NOW), false);
  });

  test("a stale pointer at an ended contract does not keep the unit", () => {
    assert.equal(
      releasesUnit({
        leaseId: "draft",
        otherActive: false,
        pointedAt: { id: "gone", status: LeaseStatus.EXPIRED, endDate: "2025-12-31" },
        now: NOW,
      }),
      true,
    );
  });
});
