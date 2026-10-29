/**
 * Keeping an entry in step with its document, and the period lock.
 *
 * Posting the same document twice changes nothing; a changed document is
 * replaced in place while its period is open and reversed-and-reposted once
 * it is closed; and nothing is ever dated inside a closed period.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { decidePostingAction, numbersNeeded, type LiveEntry } from "./periods";
import { fingerprintPlan } from "./posting/fingerprint";
import { planInvoice, type InvoiceDoc } from "./posting/invoice";
import { firstOpenDay, isLockedDay, openDayFor, ledgerDay, parseDay } from "./dates";

const day = (text: string) => new Date(`${text}T00:00:00.000Z`);

function installment(overrides: Partial<InvoiceDoc> = {}): InvoiceDoc {
  return {
    id: "inv-1",
    number: "INV-1",
    date: day("2026-09-01"),
    category: "rent",
    total: 5_000,
    tax: 0,
    lines: [{ type: "rent", amount: 5_000 }],
    tenantId: "tenant-1",
    ownerId: "owner-1",
    propertyId: "prop-1",
    ownership: "owner",
    depositHolder: "owner",
    ...overrides,
  };
}

function desiredFor(doc: InvoiceDoc) {
  const plan = planInvoice(doc)!;
  return { date: plan.date, fingerprint: fingerprintPlan(plan) };
}

function liveFrom(doc: InvoiceDoc, entryDate?: Date): LiveEntry {
  const desired = desiredFor(doc);
  return { id: "je-1", number: 41, date: entryDate ?? desired.date, fingerprint: desired.fingerprint };
}

describe("reposting is idempotent", () => {
  test("the same document gives the same fingerprint", () => {
    assert.equal(desiredFor(installment()).fingerprint, desiredFor(installment()).fingerprint);
  });

  test("posting an unchanged document again does nothing", () => {
    const doc = installment();
    const action = decidePostingAction({
      live: liveFrom(doc),
      desired: desiredFor(doc),
      closedThrough: null,
    });
    assert.equal(action.kind, "noop");
    assert.equal(numbersNeeded(action), 0);
  });

  test("a change to the amount, the day or the owner is a change", () => {
    const before = desiredFor(installment()).fingerprint;
    assert.notEqual(desiredFor(installment({ total: 5_100, lines: [{ type: "rent", amount: 5_100 }] })).fingerprint, before);
    assert.notEqual(desiredFor(installment({ date: day("2026-09-02") })).fingerprint, before);
    assert.notEqual(desiredFor(installment({ ownerId: "owner-2" })).fingerprint, before);
  });

  test("a document first posted on the open day is not reposted on every run", () => {
    // Dated inside the closed period, posted on the first open day; the
    // fingerprint still carries the document's own day.
    const doc = installment({ date: day("2026-08-15") });
    const closedThrough = day("2026-08-31");
    const created = decidePostingAction({ live: null, desired: desiredFor(doc), closedThrough });
    assert.equal(created.kind, "create");
    assert.equal(created.kind === "create" && created.date.toISOString().slice(0, 10), "2026-09-01");
    const again = decidePostingAction({
      live: liveFrom(doc, day("2026-09-01")),
      desired: desiredFor(doc),
      closedThrough,
    });
    assert.equal(again.kind, "noop");
  });
});

describe("a changed document", () => {
  const original = installment();
  const changed = installment({ total: 6_000, lines: [{ type: "rent", amount: 6_000 }] });

  test("in an open period is replaced where it stands", () => {
    const action = decidePostingAction({
      live: liveFrom(original),
      desired: desiredFor(changed),
      closedThrough: day("2026-08-31"),
    });
    assert.equal(action.kind, "replace");
    if (action.kind === "replace") {
      assert.equal(action.entry.number, 41, "keeps its number");
      assert.equal(action.date.toISOString().slice(0, 10), "2026-09-01");
    }
    assert.equal(numbersNeeded(action), 0);
  });

  test("in a closed period is reversed and reposted on the first open day", () => {
    const action = decidePostingAction({
      live: liveFrom(original),
      desired: desiredFor(changed),
      closedThrough: day("2026-09-30"),
    });
    assert.equal(action.kind, "reverse_and_create");
    if (action.kind === "reverse_and_create") {
      assert.equal(action.reverseDate.toISOString().slice(0, 10), "2026-10-01");
      assert.equal(action.createDate.toISOString().slice(0, 10), "2026-10-01");
    }
    assert.equal(numbersNeeded(action), 2);
  });

  test("moved into a closed period from an open one is posted on the first open day", () => {
    const action = decidePostingAction({
      live: liveFrom(installment({ date: day("2026-10-05") })),
      desired: desiredFor(installment({ date: day("2026-09-10") })),
      closedThrough: day("2026-09-30"),
    });
    assert.equal(action.kind, "replace");
    if (action.kind === "replace") {
      assert.equal(action.date.toISOString().slice(0, 10), "2026-10-01");
    }
  });
});

describe("a document that no longer posts", () => {
  test("in an open period is reversed on its own day", () => {
    const action = decidePostingAction({
      live: liveFrom(installment()),
      desired: null,
      closedThrough: null,
    });
    assert.equal(action.kind, "reverse");
    if (action.kind === "reverse") {
      assert.equal(action.date.toISOString().slice(0, 10), "2026-09-01");
    }
  });

  test("in a closed period is reversed on the first open day", () => {
    const action = decidePostingAction({
      live: liveFrom(installment()),
      desired: null,
      closedThrough: day("2026-09-15"),
    });
    assert.equal(action.kind, "reverse");
    if (action.kind === "reverse") {
      assert.equal(action.date.toISOString().slice(0, 10), "2026-09-16");
    }
  });

  test("never posted and not wanted: nothing", () => {
    assert.equal(
      decidePostingAction({ live: null, desired: null, closedThrough: null }).kind,
      "noop",
    );
  });
});

describe("the calendar", () => {
  test("the lock covers the closing day and lifts the day after", () => {
    const closed = day("2026-09-30");
    assert.equal(isLockedDay(day("2026-09-30"), closed), true);
    assert.equal(isLockedDay(day("2026-10-01"), closed), false);
    assert.equal(isLockedDay(day("2020-01-01"), null), false);
    assert.equal(firstOpenDay(closed)?.toISOString().slice(0, 10), "2026-10-01");
    assert.equal(openDayFor(day("2026-09-05"), closed).toISOString().slice(0, 10), "2026-10-01");
    assert.equal(openDayFor(day("2026-10-05"), closed).toISOString().slice(0, 10), "2026-10-05");
  });

  test("an instant is read on the Riyadh calendar", () => {
    // 22:30 UTC on the 2nd is 01:30 on the 3rd in Riyadh.
    assert.equal(ledgerDay(new Date("2026-10-02T22:30:00.000Z")).toISOString().slice(0, 10), "2026-10-03");
    // A stored date-only value keeps its own day.
    assert.equal(ledgerDay(new Date("2026-10-02T00:00:00.000Z")).toISOString().slice(0, 10), "2026-10-02");
  });

  test("a day typed by hand is checked", () => {
    assert.equal(parseDay("2026-02-31"), null);
    assert.equal(parseDay("nonsense"), null);
    assert.equal(parseDay("2026-02-28")?.toISOString().slice(0, 10), "2026-02-28");
  });
});
