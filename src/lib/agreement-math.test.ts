/**
 * What an agreement is worth, and to which building.
 *
 * Three things these pin. A flat amount — a fixed management fee, or the rent
 * an investment agreement pays the owner — is agreed once for everything the
 * agreement covers; it used to be charged again for every building, so a
 * compound-wide 3,000 a month over four buildings came to 12,000. The two
 * kinds of agreement never compete: a building the office has taken on under
 * investment does not also earn management commission. And an agreement earns
 * for its own term — every day of it, its last included, and no day outside
 * it: the statement that closed on an agreement's end date used to charge no
 * commission at all, and one signed or renewed inside a period was charged on
 * the whole period's rent.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  agreementKind,
  agreementTerm,
  commissionFor,
  commissionUnderAgreement,
  computeCommissionRun,
  governanceOf,
  governingSpans,
  heldUnder,
  investmentRentFor,
  isAgreementInForce,
  partOn,
  resolveAgreementForProperty,
  SEVERAL_FEES,
  shareOfAgreementAmount,
  statementTime,
  termWithin,
  type AgreementRow,
  type Period,
  type RentEntry,
} from "@/lib/agreement-math";
import { uniformCommissionPercentage } from "@/lib/statements/summary";

function agreement(overrides: Partial<AgreementRow>): AgreementRow {
  return {
    id: "a1",
    kind: "management",
    agreementNumber: null,
    ownerId: "owner",
    propertyId: null,
    compoundId: null,
    feeType: "fixed",
    feePercentage: 0,
    feeAmount: 0,
    feeFrequency: "monthly",
    commissionBasis: "collected",
    currency: "SAR",
    startDate: new Date("2026-01-01T00:00:00Z"),
    endDate: null,
    status: "active",
    terminatedDate: null,
    ...overrides,
  };
}

/** A statement period: whole days, the last one included to its final ms. */
function period(from: string, to: string) {
  return {
    startDate: new Date(`${from}T00:00:00Z`),
    endDate: new Date(`${to}T23:59:59.999Z`),
  };
}

/** A date as the agreement form stores it: the midnight UTC that begins the day. */
function day(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

interface Building {
  id: string;
  name: string;
  ownerId: string;
  compoundId: string | null;
}

const building: Building = {
  id: "b1",
  name: "Building 1",
  ownerId: "owner",
  compoundId: null,
};

/** Rent received — or billed — on a day; all of it rent before VAT unless said. */
function rent(
  on: string,
  amount: number,
  overrides: Partial<RentEntry> = {},
): RentEntry {
  return {
    propertyId: "b1",
    date: on.includes("T") ? new Date(on) : day(on),
    amount,
    base: amount,
    ...overrides,
  };
}

/** The commission run over buildings that are the owner's whole portfolio. */
function run(
  agreements: AgreementRow[],
  window: Period,
  rows: { received?: RentEntry[]; billed?: RentEntry[] } = {},
  properties: Building[] = [building],
) {
  return computeCommissionRun({
    properties,
    portfolio: properties,
    agreements,
    period: window,
    received: rows.received ?? [],
    billed: rows.billed ?? [],
  });
}

const percentage = (rate: number, overrides: Partial<AgreementRow> = {}) =>
  agreement({
    feeType: "percentage",
    feePercentage: rate,
    startDate: day("2025-01-01"),
    ...overrides,
  });

describe("a flat amount shared between buildings", () => {
  test("adds back up to exactly what was agreed", () => {
    const governed = ["b1", "b2", "b3"];
    const shares = governed.map((id) => shareOfAgreementAmount(1000, governed, id));
    assert.deepEqual(shares, [333.34, 333.33, 333.33]);
    assert.equal(Math.round(shares.reduce((a, b) => a + b, 0) * 100) / 100, 1000);
  });

  test("a building on its own carries the whole amount", () => {
    assert.equal(shareOfAgreementAmount(3000, ["b1"], "b1"), 3000);
  });

  test("a fixed fee is charged once per agreement, not once per building", () => {
    const fee = commissionFor(
      agreement({ feeAmount: 3000, feeFrequency: "monthly" }),
      [],
      period("2026-01-01", "2026-01-31"),
    );
    assert.equal(fee, 3000);
    const governed = ["b1", "b2", "b3", "b4"];
    const total = governed
      .map((id) => shareOfAgreementAmount(fee, governed, id))
      .reduce((a, b) => a + b, 0);
    assert.equal(total, 3000);
  });
});

describe("an investment agreement's rent", () => {
  test("is the agreed amount per cycle over the period", () => {
    const monthly = agreement({
      kind: "investment",
      feeAmount: 10_000,
      feeFrequency: "monthly",
    });
    assert.equal(investmentRentFor(monthly, period("2026-01-01", "2026-03-31")), 30_000);
  });

  test("a year of an annual agreement is its annual rent", () => {
    const annual = agreement({
      kind: "investment",
      feeAmount: 120_000,
      feeFrequency: "annual",
    });
    assert.equal(investmentRentFor(annual, period("2026-01-01", "2026-12-31")), 120_000);
  });

  test("nothing is owed before the agreement starts or after it ends", () => {
    const ended = agreement({
      kind: "investment",
      feeAmount: 10_000,
      endDate: new Date("2025-12-31T00:00:00Z"),
      startDate: new Date("2025-01-01T00:00:00Z"),
    });
    assert.equal(investmentRentFor(ended, period("2026-01-01", "2026-03-31")), 0);
  });
});

describe("the two kinds of agreement", () => {
  const building = { id: "b1", ownerId: "owner", compoundId: null };
  const management = agreement({ id: "m1", kind: "management", feeType: "percentage", feePercentage: 5 });
  const investment = agreement({ id: "i1", kind: "investment", propertyId: "b1", feeAmount: 50_000 });
  const on = new Date("2026-06-01T00:00:00Z");

  test("resolve separately — neither is mistaken for the other", () => {
    const both = [management, investment];
    assert.equal(resolveAgreementForProperty(both, building, on)?.id, "m1");
    assert.equal(resolveAgreementForProperty(both, building, on, "investment")?.id, "i1");
    assert.equal(resolveAgreementForProperty([investment], building, on), null);
  });

  test("anything that is not an investment agreement is a management one", () => {
    assert.equal(agreementKind({ kind: "investment" }), "investment");
    assert.equal(agreementKind({ kind: "management" }), "management");
    assert.equal(agreementKind({ kind: "something-else" }), "management");
    assert.equal(agreementKind({}), "management");
  });
});

describe("when an agreement is in force", () => {
  const ending = percentage(2, { endDate: day("2026-12-31") });

  test("its end date is a whole day", () => {
    // Stored as the midnight that begins it; a statement closes as it ends.
    assert.equal(isAgreementInForce(ending, new Date("2026-12-31T23:59:59.999Z")), true);
    assert.equal(isAgreementInForce(ending, day("2027-01-01")), false);
    assert.deepEqual(termWithin(ending, period("2026-01-01", "2026-12-31")), period("2026-01-01", "2026-12-31"));
  });

  test("so is its start date, at whatever hour it was stored", () => {
    const seeded = percentage(2, { startDate: new Date("2026-03-01T03:00:00Z") });
    assert.equal(isAgreementInForce(seeded, day("2026-03-01")), true);
    assert.equal(isAgreementInForce(seeded, new Date("2026-02-28T23:59:59.999Z")), false);
  });

  test("the dates decide, whatever its status has become since", () => {
    const expired = percentage(2, { endDate: day("2026-06-30"), status: "expired" });
    assert.equal(isAgreementInForce(expired, day("2026-03-15")), true);
    assert.equal(isAgreementInForce(expired, day("2026-07-01")), false);

    const terminated = percentage(2, {
      endDate: day("2026-12-31"),
      status: "terminated",
      terminatedDate: new Date("2026-06-15T10:30:00Z"),
    });
    // Through the day it was terminated — and not to the end date it had.
    assert.equal(isAgreementInForce(terminated, new Date("2026-06-15T20:00:00Z")), true);
    assert.equal(isAgreementInForce(terminated, day("2026-06-16")), false);
  });

  test("an end date that came first outlasts no later termination", () => {
    // Marked terminated long after it had run out: it ended when it ended.
    const late = percentage(2, {
      endDate: day("2025-12-31"),
      status: "terminated",
      terminatedDate: day("2026-03-01"),
    });
    assert.equal(isAgreementInForce(late, day("2026-01-15")), false);
  });

  test("a draft never started", () => {
    const draft = percentage(2, { status: "draft", endDate: day("2026-12-31") });
    assert.equal(agreementTerm(draft), null);
    assert.equal(isAgreementInForce(draft, day("2026-06-01")), false);
  });

  test("one closed with no date on record has no term to charge for", () => {
    for (const status of ["expired", "terminated"]) {
      assert.equal(agreementTerm(percentage(2, { status })), null, status);
    }
    // Still running, with no end agreed, is a different thing.
    assert.deepEqual(agreementTerm(percentage(2)), {
      startDate: day("2025-01-01"),
      endDate: null,
    });
  });
});

describe("commission at the edges of an agreement's term", () => {
  test("a period that closes on the agreement's end date is charged in full", () => {
    // The end-of-term settlement: agreement to 31 December, statement for the year.
    const result = run(
      [percentage(2, { endDate: day("2026-12-31") })],
      period("2026-01-01", "2026-12-31"),
      {
        received: [
          rent("2026-03-10", 100_000),
          rent("2026-12-31", 40_000),
          // Received on the last evening, stamped with its time.
          rent("2026-12-31T20:45:00Z", 10_000),
        ],
      },
    );
    assert.equal(result.hasAgreements, true);
    assert.equal(result.totals.commission, 3_000);
    assert.equal(result.byProperty[0].commissionBase, 150_000);
  });

  test("a flat fee for a year that ends on the agreement's last day is twelve cycles", () => {
    const flat = agreement({
      feeAmount: 3_000,
      startDate: day("2025-01-01"),
      endDate: day("2026-12-31"),
    });
    assert.equal(commissionFor(flat, [], period("2026-01-01", "2026-12-31")), 36_000);
  });

  test("an agreement terminated inside the period earns up to its termination", () => {
    const terminated = percentage(5, {
      status: "terminated",
      terminatedDate: new Date("2026-06-15T10:30:00Z"),
    });
    const result = run([terminated], period("2026-01-01", "2026-12-31"), {
      received: [
        rent("2026-02-01", 10_000),
        // The day it was terminated still counts, to its end.
        rent("2026-06-15T18:00:00Z", 10_000),
        rent("2026-06-16", 10_000),
        rent("2026-11-01", 10_000),
      ],
    });
    const [entry] = result.byProperty;
    assert.equal(entry.commission, 1_000);
    assert.equal(entry.commissionBase, 20_000);
    // Everything received is still the owner's; only the charge stops.
    assert.equal(entry.rentCollected, 40_000);
    assert.deepEqual(
      entry.parts.map((part) => [part.startDate.toISOString(), part.endDate.toISOString()]),
      [["2026-01-01T00:00:00.000Z", "2026-06-15T23:59:59.999Z"]],
    );
  });

  test("a terminated flat fee is prorated to the day it stopped", () => {
    const terminated = agreement({
      feeAmount: 3_000,
      status: "terminated",
      terminatedDate: new Date("2026-06-15T10:30:00Z"),
    });
    // January to May, and 15 of June's 30 days.
    assert.equal(commissionFor(terminated, [], period("2026-01-01", "2026-12-31")), 16_500);
  });

  test("an agreement that starts inside the period earns from its start", () => {
    const result = run(
      [percentage(5, { startDate: day("2026-04-01") })],
      period("2026-01-01", "2026-06-30"),
      {
        received: [
          rent("2026-03-31", 10_000),
          rent("2026-04-01", 10_000),
          rent("2026-05-10", 4_000),
        ],
      },
    );
    const [entry] = result.byProperty;
    assert.equal(entry.commission, 700);
    assert.equal(entry.commissionBase, 14_000);
    assert.equal(entry.rentCollected, 24_000);
  });

  test("a percentage is charged on the rent of its own term, not the period's", () => {
    const sixMonths = percentage(5, {
      startDate: day("2026-04-01"),
      endDate: day("2026-09-30"),
    });
    const fee = commissionFor(
      sixMonths,
      [
        { date: day("2026-03-31"), amount: 10_000 },
        { date: day("2026-04-01"), amount: 10_000 },
        { date: new Date("2026-09-30T19:00:00Z"), amount: 10_000 },
        { date: day("2026-10-01"), amount: 10_000 },
      ],
      period("2026-01-01", "2026-12-31"),
    );
    assert.equal(fee, 1_000);
  });

  test("a renewal inside the period charges each rate on its own part", () => {
    const old = percentage(2, { id: "old", endDate: day("2025-12-31"), status: "expired" });
    const renewed = percentage(3, { id: "new", startDate: day("2026-01-01") });
    const result = run([old, renewed], period("2025-07-01", "2026-06-30"), {
      received: [rent("2025-12-31", 10_000), rent("2026-01-01", 10_000)],
    });
    const [entry] = result.byProperty;

    assert.deepEqual(
      entry.parts.map((part) => [part.agreementId, part.commissionBase, part.commission]),
      [
        ["old", 10_000, 200],
        ["new", 10_000, 300],
      ],
    );
    assert.equal(entry.commission, 500);
    assert.equal(result.totals.commission, 500);
    // The one that holds the building at the close names it; no single rate
    // is printed against a commission charged at two.
    assert.equal(entry.agreementId, "new");
    assert.equal(entry.fee, SEVERAL_FEES);
    assert.equal(entry.feeLabel, "2%, 3%");
    // Both were percentages, so the commission still follows each unit's rent.
    assert.equal(entry.feeType, "percentage");
  });

  test("a statement of several buildings names no rate when one was charged at two", () => {
    // One building renewed from 2% to 3%; its neighbour at one rate throughout
    // — whichever of the two that rate is.
    const old = percentage(2, { id: "old", propertyId: "b1", endDate: day("2025-12-31") });
    const renewed = percentage(3, { id: "new", propertyId: "b1", startDate: day("2026-01-01") });
    const neighbour: Building = { ...building, id: "b2", name: "Building 2" };
    for (const rate of [2, 3]) {
      const steady = percentage(rate, { id: "steady", propertyId: "b2" });
      const result = run(
        [old, renewed, steady],
        period("2025-07-01", "2026-06-30"),
        {
          received: [
            rent("2025-12-31", 10_000),
            rent("2026-01-01", 10_000),
            rent("2026-01-01", 10_000, { propertyId: "b2" }),
          ],
        },
        [building, neighbour],
      );
      // Read building by building, as the compound's statement reads it …
      assert.equal(uniformCommissionPercentage(result.byProperty), null, `${rate}%`);
      // … and part by part, as the owner's does.
      assert.equal(
        uniformCommissionPercentage(result.byProperty.flatMap((entry) => entry.parts)),
        null,
        `${rate}%`,
      );
    }
  });

  test("a renewal from a flat fee to a percentage is neither, read as one", () => {
    const flat = agreement({
      id: "old",
      feeAmount: 1_000,
      startDate: day("2025-01-01"),
      endDate: day("2025-12-31"),
    });
    const renewed = percentage(3, { id: "new", startDate: day("2026-01-01") });
    const [entry] = run([flat, renewed], period("2025-07-01", "2026-06-30"), {
      received: [rent("2026-01-01", 10_000)],
    }).byProperty;
    // Six months of the flat fee, then 3% of the rent.
    assert.equal(entry.commission, 6_300);
    assert.equal(entry.feeType, null);
    assert.equal(entry.fee, SEVERAL_FEES);
    assert.equal(entry.feeLabel, "1000 / monthly, 3%");
  });

  test("a renewal on the same terms still reads as one fee", () => {
    const old = percentage(2, { id: "old", endDate: day("2025-12-31"), status: "expired" });
    const renewed = percentage(2, { id: "new", startDate: day("2026-01-01") });
    const [entry] = run([old, renewed], period("2025-07-01", "2026-06-30"), {
      received: [rent("2025-12-31", 10_000), rent("2026-01-01", 10_000)],
    }).byProperty;
    assert.equal(entry.commission, 400);
    assert.equal(entry.fee?.percentage, 2);
  });

  test("an agreement that has since expired still earns for the months it ran", () => {
    const expired = percentage(5, { endDate: day("2026-03-31"), status: "expired" });
    const [entry] = run([expired], period("2026-01-01", "2026-12-31"), {
      received: [rent("2026-03-31", 8_000), rent("2026-04-01", 8_000)],
    }).byProperty;
    assert.equal(entry.commission, 400);
  });

  test("a draft earns nothing", () => {
    const result = run(
      [percentage(5, { status: "draft" })],
      period("2026-01-01", "2026-12-31"),
      { received: [rent("2026-03-31", 8_000)] },
    );
    assert.equal(result.hasAgreements, false);
    assert.equal(result.totals.commission, 0);
    assert.deepEqual(result.byProperty[0].parts, []);
  });

  test("a billed agreement is charged on the invoices that fell due in its part", () => {
    const billedBasis = percentage(10, {
      commissionBasis: "billed",
      startDate: day("2026-04-01"),
    });
    const [entry] = run([billedBasis], period("2026-01-01", "2026-06-30"), {
      received: [rent("2026-05-01", 99_000)],
      billed: [
        rent("2026-03-01", 11_500, { base: 10_000 }),
        rent("2026-04-01", 11_500, { base: 10_000 }),
      ],
    }).byProperty;
    assert.equal(entry.commissionBase, 10_000);
    assert.equal(entry.commission, 1_000);
  });

  test("the commission is charged on rent before VAT, not on everything received", () => {
    const [entry] = run([percentage(2)], period("2026-01-01", "2026-12-31"), {
      received: [
        rent("2026-02-01", 11_500, { base: 10_000 }),
        // A deposit: received, and none of it rent.
        rent("2026-02-01", 5_000, { base: 0 }),
      ],
    }).byProperty;
    assert.equal(entry.rentCollected, 16_500);
    assert.equal(entry.commissionBase, 10_000);
    assert.equal(entry.commission, 200);
  });
});

describe("who holds a building over time", () => {
  const year = period("2026-01-01", "2026-12-31");
  const ids = (spans: Array<{ agreement: AgreementRow; startDate: Date; endDate: Date }>) =>
    spans.map((span) => [
      span.agreement.id,
      span.startDate.toISOString().slice(0, 10),
      span.endDate.toISOString().slice(0, 10),
    ]);

  test("re-signing on new terms takes over without ending the old paper", () => {
    const old = percentage(2, { id: "old" });
    const resigned = percentage(3, { id: "new", startDate: day("2026-07-01") });
    assert.deepEqual(ids(governingSpans([old, resigned], building, year)), [
      ["old", "2026-01-01", "2026-06-30"],
      ["new", "2026-07-01", "2026-12-31"],
    ]);
  });

  test("a building's own agreement takes it from the blanket one, and gives it back", () => {
    const blanket = percentage(2, { id: "blanket" });
    const own = percentage(5, {
      id: "own",
      propertyId: "b1",
      startDate: day("2026-04-01"),
      endDate: day("2026-06-30"),
    });
    assert.deepEqual(ids(governingSpans([blanket, own], building, year)), [
      ["blanket", "2026-01-01", "2026-03-31"],
      ["own", "2026-04-01", "2026-06-30"],
      ["blanket", "2026-07-01", "2026-12-31"],
    ]);
  });

  test("time no agreement was in force is nobody's", () => {
    const first = percentage(2, { id: "first", endDate: day("2026-03-31") });
    const second = percentage(3, { id: "second", startDate: day("2026-10-01") });
    assert.deepEqual(ids(governingSpans([first, second], building, year)), [
      ["first", "2026-01-01", "2026-03-31"],
      ["second", "2026-10-01", "2026-12-31"],
    ]);
  });

  test("two that started the same day are settled the same way in any order", () => {
    const one = percentage(2, { id: "a-made-first" });
    const two = percentage(3, { id: "b-made-later" });
    const on = day("2026-06-01");
    assert.equal(resolveAgreementForProperty([one, two], building, on)?.id, "b-made-later");
    assert.equal(resolveAgreementForProperty([two, one], building, on)?.id, "b-made-later");

    // The hour a start date happened to be stored at is not a later start.
    const stamped = { ...one, startDate: new Date("2025-01-01T03:00:00Z") };
    assert.equal(resolveAgreementForProperty([stamped, two], building, on)?.id, "b-made-later");
  });

  test("investment holds the building wherever it is in force, management the rest", () => {
    const management = percentage(5, { id: "m1" });
    const investment = agreement({
      id: "i1",
      kind: "investment",
      feeAmount: 10_000,
      startDate: day("2026-04-01"),
      endDate: day("2026-09-30"),
    });
    assert.deepEqual(ids(governanceOf([management, investment], building, year)), [
      ["m1", "2026-01-01", "2026-03-31"],
      ["i1", "2026-04-01", "2026-09-30"],
      ["m1", "2026-10-01", "2026-12-31"],
    ]);
    // Investment alone, for the whole of a period it covers.
    assert.deepEqual(
      ids(governanceOf([management, investment], building, period("2026-05-01", "2026-08-31"))),
      [["i1", "2026-05-01", "2026-08-31"]],
    );
  });
});

describe("a building that passes between management and investment", () => {
  const year = period("2026-01-01", "2026-12-31");
  const received = [rent("2026-03-10", 60_000), rent("2026-09-10", 40_000)];
  const investment = (overrides: Partial<AgreementRow>) =>
    agreement({ id: "i1", kind: "investment", feeAmount: 10_000, ...overrides });

  test("management to the end of June, investment from July: each for its own half", () => {
    const managed = percentage(5, { id: "m1", endDate: day("2026-06-30") });
    const taken = investment({ startDate: day("2026-07-01") });
    const result = run([managed, taken], year, { received });
    const [entry] = result.byProperty;

    assert.deepEqual(
      entry.parts.map((part) => [part.agreementId, part.commission, part.investmentRent]),
      [
        // 5% of the 60,000 received in March.
        ["m1", 3_000, 0],
        // Six months of the fixed rent; September's tenants paid the office.
        ["i1", 0, 60_000],
      ],
    );
    // The owner's statement lists the rows of the managed half only.
    assert.deepEqual(statementTime(entry.parts, year), [period("2026-01-01", "2026-06-30")]);
  });

  test("investment to the end of June, a blanket management agreement all year", () => {
    const blanket = percentage(5, { id: "m1" });
    const taken = investment({ startDate: day("2025-01-01"), endDate: day("2026-06-30") });
    const [entry] = run([blanket, taken], year, { received }).byProperty;

    assert.deepEqual(
      entry.parts.map((part) => [part.agreementId, part.commission, part.investmentRent]),
      [
        ["i1", 0, 60_000],
        // Only September's rent: March's was the office's own.
        ["m1", 2_000, 0],
      ],
    );
    assert.deepEqual(statementTime(entry.parts, year), [period("2026-07-01", "2026-12-31")]);
  });

  test("an investment agreement renewed at a new rent owes each rent for its own part", () => {
    const old = investment({ id: "i1", startDate: day("2025-01-01"), endDate: day("2026-06-30") });
    const renewed = investment({ id: "i2", feeAmount: 12_000, startDate: day("2026-07-01") });
    const result = run([old, renewed], year, { received });

    assert.deepEqual(
      result.byProperty[0].parts.map((part) => [part.agreementId, part.investmentRent]),
      [
        ["i1", 60_000],
        ["i2", 72_000],
      ],
    );
    assert.equal(result.totals.investmentRent, 132_000);
    // Under investment throughout: none of the rows are the owner's.
    assert.deepEqual(statementTime(result.byProperty[0].parts, year), []);
  });

  test("read whole, the building is the office's only while investment holds it at the close", () => {
    // What the compound, building and unit statements take: one reading per
    // building, since they list its rows for the whole period or not at all.
    // The parts keep the exact account.
    const managed = percentage(5, { id: "m1", endDate: day("2026-06-30") });
    const taken = investment({ startDate: day("2026-07-01") });
    const underInvestment = run([managed, taken], year, { received });
    const [closedUnderInvestment] = underInvestment.byProperty;
    assert.equal(closedUnderInvestment.agreementKind, "investment");
    assert.equal(closedUnderInvestment.agreementId, "i1");
    assert.equal(closedUnderInvestment.commission, 0);
    assert.equal(closedUnderInvestment.investmentRent, 60_000);
    // The run's own flags and totals are of the buildings read whole.
    assert.equal(underInvestment.hasInvestment, true);
    assert.equal(underInvestment.hasAgreements, false);
    assert.equal(underInvestment.totals.commission, 0);

    const blanket = percentage(5, { id: "m1" });
    const ended = investment({ startDate: day("2025-01-01"), endDate: day("2026-06-30") });
    const [closedUnderManagement] = run([blanket, ended], year, { received }).byProperty;
    assert.equal(closedUnderManagement.agreementKind, "management");
    assert.equal(closedUnderManagement.agreementId, "m1");
    assert.equal(closedUnderManagement.commission, 2_000);
    assert.equal(closedUnderManagement.investmentRent, 0);
    assert.equal(closedUnderManagement.fee?.percentage, 5);
    assert.equal(closedUnderManagement.feeLabel, "5%");
  });

  test("read whole, a building whose investment agreement ended with nothing after is under none", () => {
    // Its rows for the period are listed by those statements, so it must not
    // be read as the office's — nor owed a rent they would add on top.
    const ended = investment({ startDate: day("2025-01-01"), endDate: day("2026-06-30") });
    const [entry] = run([ended], year, { received }).byProperty;
    assert.equal(entry.agreementKind, null);
    assert.equal(entry.agreementId, null);
    assert.equal(entry.commission, 0);
    assert.equal(entry.investmentRent, 0);
    assert.equal(entry.netToOwner, 100_000);
    // The exact account is still there for the statements built from it.
    assert.deepEqual(
      entry.parts.map((part) => [part.agreementId, part.investmentRent]),
      [["i1", 60_000]],
    );
  });

  test("read whole, a management agreement that ended inside the period still names its commission", () => {
    const ended = percentage(5, { id: "m1", endDate: day("2026-06-30") });
    const [entry] = run([ended], year, { received }).byProperty;
    assert.equal(entry.agreementKind, "management");
    assert.equal(entry.agreementId, "m1");
    // 5% of March's 60,000; September's came in after it had ended.
    assert.equal(entry.commission, 3_000);
  });

  test("a period that closes on an investment agreement's end date owes its rent in full", () => {
    const taken = investment({ startDate: day("2025-01-01"), endDate: day("2026-12-31") });
    const result = run([percentage(5, { id: "m1" }), taken], year, { received });
    assert.equal(result.totals.investmentRent, 120_000);
    assert.equal(result.totals.commission, 0);
    assert.equal(result.hasAgreements, false);
  });
});

describe("a flat fee agreed from the middle of a month", () => {
  const fromThe15th = agreement({ feeAmount: 3_000, startDate: day("2025-01-15") });

  test("charges the days before the 15th as well as the days after", () => {
    // January: 14 days of the cycle that ends on the 15th and 17 of the one
    // that starts there, both 31 days long — a whole fee.
    assert.equal(commissionFor(fromThe15th, [], period("2026-01-01", "2026-01-31")), 3_000);
    // February: 14 days of a 31-day cycle and 14 of a 28-day one. A calendar
    // month across two cycles of different lengths is not exactly one fee;
    // the year below still is twelve.
    assert.equal(commissionFor(fromThe15th, [], period("2026-02-01", "2026-02-28")), 2_854.84);
  });

  test("is twelve fees for a calendar year", () => {
    assert.equal(commissionFor(fromThe15th, [], period("2026-01-01", "2026-12-31")), 36_000);
  });

  test("charges the days of a window that sits inside one cycle", () => {
    // Three of the 31 days from 15 December to 15 January.
    assert.equal(commissionFor(fromThe15th, [], period("2026-01-10", "2026-01-12")), 290.32);
  });

  test("a longer cycle is found the same way", () => {
    const quarterly = agreement({
      feeAmount: 9_200,
      feeFrequency: "quarterly",
      startDate: day("2025-02-20"),
    });
    // Ten of the 92 days from 20 November to 20 February.
    assert.equal(commissionFor(quarterly, [], period("2026-02-10", "2026-02-19")), 1_000);
  });

  test("an investment agreement's year is its year's rent", () => {
    const annual = agreement({
      kind: "investment",
      feeAmount: 120_000,
      feeFrequency: "annual",
      startDate: day("2025-06-15"),
    });
    assert.equal(investmentRentFor(annual, period("2026-01-01", "2026-12-31")), 120_000);
  });

  test("still adds up when the buildings it covers change inside the period", () => {
    const b1: Building = { ...building, compoundId: "c1" };
    const b2: Building = { ...b1, id: "b2", name: "Building 2" };
    const compoundFee = agreement({
      id: "compound",
      compoundId: "c1",
      feeAmount: 3_000,
      startDate: day("2026-01-15"),
    });
    // The second building under an agreement of its own from April to June.
    const own = percentage(5, {
      id: "own",
      propertyId: "b2",
      startDate: day("2026-04-01"),
      endDate: day("2026-06-30"),
    });
    const result = run([compoundFee, own], period("2026-01-15", "2027-01-14"), {}, [b1, b2]);
    const flat = result.byProperty
      .flatMap((entry) => entry.parts)
      .filter((part) => part.agreementId === "compound")
      .reduce((sum, part) => sum + part.commission, 0);
    assert.equal(Math.round(flat * 100) / 100, 36_000);
  });
});

describe("a flat fee when what it covers changes inside the period", () => {
  const b1: Building = { ...building, compoundId: "c1" };
  const b2: Building = { ...b1, id: "b2", name: "Building 2" };
  const compoundFee = agreement({
    id: "compound",
    compoundId: "c1",
    feeAmount: 3_000,
    startDate: day("2026-01-01"),
  });

  test("is shared between the buildings it covered at the time", () => {
    // From July the second building has an agreement of its own.
    const own = percentage(5, {
      id: "own",
      propertyId: "b2",
      startDate: day("2026-07-01"),
    });
    const result = run(
      [compoundFee, own],
      period("2026-01-01", "2026-12-31"),
      { received: [rent("2026-08-01", 10_000, { propertyId: "b2" })] },
      [b1, b2],
    );
    const [first, second] = result.byProperty;

    // Half of six months, then all of the other six.
    assert.equal(first.commission, 27_000);
    // Half of six months, then 5% of its own rent.
    assert.deepEqual(
      second.parts.map((part) => [part.agreementId, part.commission]),
      [
        ["compound", 9_000],
        ["own", 500],
      ],
    );
    // The fee still adds up to the twelve months agreed.
    assert.equal(first.commission + second.parts[0].commission, 36_000);
  });

  test("one building's statement carries its part, not the whole", () => {
    const result = computeCommissionRun({
      properties: [b1],
      portfolio: [b1, b2],
      agreements: [compoundFee],
      period: period("2026-01-01", "2026-01-31"),
      received: [],
      billed: [],
    });
    assert.equal(result.totals.commission, 1_500);
  });
});

describe("an agreement's own statement", () => {
  const old = percentage(2, { id: "old", endDate: day("2025-12-31"), status: "expired" });
  const renewed = percentage(3, { id: "new", startDate: day("2026-01-01") });
  const both = run([old, renewed], period("2025-07-01", "2026-06-30"), {
    received: [rent("2025-12-31", 10_000), rent("2026-01-01", 10_000)],
  });

  test("carries that agreement's commission, on its own terms, and no other's", () => {
    const ended = commissionUnderAgreement(both, "old");
    assert.equal(ended.totals.commission, 200);
    assert.equal(ended.totals.rentCollected, 10_000);
    assert.equal(ended.byProperty[0].fee?.percentage, 2);

    const successor = commissionUnderAgreement(both, "new");
    assert.equal(successor.totals.commission, 300);
    assert.equal(successor.byProperty[0].fee?.percentage, 3);
  });

  test("an agreement that held nothing in the period charges nothing", () => {
    const none = commissionUnderAgreement(both, "another");
    assert.equal(none.hasAgreements, false);
    assert.equal(none.totals.commission, 0);
    assert.equal(none.totals.rentCollected, 0);
  });

  test("a payment falls to the agreement that held the building that day", () => {
    const { parts } = both.byProperty[0];
    assert.equal(partOn(parts, new Date("2025-12-31T22:00:00Z"))?.agreementId, "old");
    assert.equal(partOn(parts, day("2026-01-01"))?.agreementId, "new");
    assert.equal(partOn(parts, day("2025-06-30")), undefined);
  });

  test("lists the rows of the time it held the building, and no others", () => {
    const { parts } = both.byProperty[0];
    const window = period("2025-07-01", "2026-06-30");
    assert.deepEqual(statementTime(parts, window, "old"), [period("2025-07-01", "2025-12-31")]);
    assert.deepEqual(statementTime(parts, window, "new"), [period("2026-01-01", "2026-06-30")]);
    // The owner's statement lists the whole period: neither is investment.
    assert.deepEqual(statementTime(parts, window), [window]);
  });

  test("is read over the time the agreement held its buildings, and no further", () => {
    const window = period("2025-07-01", "2026-06-30");
    const agreements = [old, renewed];
    assert.deepEqual(
      heldUnder("old", agreements, [building], window).covered,
      period("2025-07-01", "2025-12-31"),
    );
    assert.deepEqual(
      heldUnder("new", agreements, [building], window).covered,
      period("2026-01-01", "2026-06-30"),
    );
    // A period its term does not touch, and a draft: nothing held.
    assert.equal(heldUnder("new", agreements, [building], period("2025-07-01", "2025-09-30")).covered, null);
    const draft = percentage(4, { id: "draft", status: "draft" });
    assert.deepEqual(heldUnder("draft", [draft], [building], window), { held: [], covered: null });
  });

  test("an old paper left running is read up to the day it was re-signed", () => {
    const left = percentage(2, { id: "left" });
    const resigned = percentage(3, { id: "resigned", startDate: day("2026-07-01") });
    const year = period("2026-01-01", "2026-12-31");
    assert.deepEqual(
      heldUnder("left", [left, resigned], [building], year).covered,
      period("2026-01-01", "2026-06-30"),
    );
  });

  test("says the same as the owner's statement whichever period it is read over", () => {
    // Superseded on 1 October; the building under investment from July to
    // November. Its own statement is read to the end of June — and over that
    // stretch the run charges exactly what it charged it over the year.
    const first = percentage(5, { id: "first" });
    const second = percentage(6, { id: "second", startDate: day("2026-10-01") });
    const taken = agreement({
      id: "taken",
      kind: "investment",
      feeAmount: 10_000,
      startDate: day("2026-07-01"),
      endDate: day("2026-11-30"),
    });
    const agreements = [first, second, taken];
    const year = period("2026-01-01", "2026-12-31");
    const received = [rent("2026-03-10", 60_000), rent("2026-09-10", 40_000), rent("2026-12-10", 10_000)];

    const { covered } = heldUnder("first", agreements, [building], year);
    assert.deepEqual(covered, period("2026-01-01", "2026-06-30"));

    const overTheYear = commissionUnderAgreement(run(agreements, year, { received }), "first");
    const overItsOwn = commissionUnderAgreement(run(agreements, covered!, { received }), "first");
    assert.equal(overTheYear.totals.commission, 3_000);
    assert.equal(overItsOwn.totals.commission, 3_000);
    assert.equal(overItsOwn.totals.rentCollected, overTheYear.totals.rentCollected);
  });
});
