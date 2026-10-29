/**
 * The settlement has to come out exactly as the client's own statements do.
 *
 * Both fixtures are the client's samples (the "Payment Adjustments" review,
 * 2026-09): the figures they reconcile against, to the halala. The first has
 * the office holding most of the rent; in the second every riyal went to the
 * owner, so the owner ends the period owing the office its fee.
 *
 * They have to come out the same at the edges of the agreement's term. The
 * statement that closes on the agreement's last day is the normal end-of-term
 * settlement, and it used to charge no commission — so the owner's dues were
 * overstated by the fee and the VAT on it.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  commissionFor,
  commissionUnderAgreement,
  computeCommissionRun,
  statementTime,
  type AgreementRow,
  type RentEntry,
} from "@/lib/agreement-math";
import { settle } from "@/lib/statements/settlement";

const period = {
  startDate: new Date("2026-01-01T00:00:00Z"),
  endDate: new Date("2026-09-29T23:59:59Z"),
};

/** Rent received on a day of the period — all of it rent before VAT. */
function received(on: string, amount: number): RentEntry {
  return { propertyId: "p1", date: new Date(on), amount, base: amount };
}

function percentageAgreement(
  feePercentage: number,
  overrides: Partial<AgreementRow> = {},
): AgreementRow {
  return {
    id: "a1",
    kind: "management",
    agreementNumber: "AG-1",
    ownerId: "o1",
    propertyId: null,
    compoundId: null,
    feeType: "percentage",
    feePercentage,
    feeAmount: 0,
    feeFrequency: "monthly",
    commissionBasis: "collected",
    currency: "SAR",
    startDate: new Date("2025-01-01T00:00:00Z"),
    endDate: null,
    status: "active",
    terminatedDate: null,
    ...overrides,
  };
}

/**
 * One building's settlement, from the parts the owner-statement service
 * builds it from: the payments of the time the statement carries, and what
 * every agreement that held the building charged. Who received the money is
 * given, and there are no expenses. `only` reads it as that agreement's own
 * statement rather than the owner's.
 */
function statement(
  agreements: AgreementRow[],
  payments: RentEntry[],
  collectedByOwner: number,
  only?: string,
) {
  const building = { id: "p1", name: "Building", ownerId: "o1", compoundId: null };
  const whole = computeCommissionRun({
    properties: [building],
    portfolio: [building],
    agreements,
    period,
    received: payments,
    billed: [],
  });
  const run = only ? commissionUnderAgreement(whole, only) : whole;
  const charged = run.byProperty.flatMap((entry) => entry.parts);
  const carried = statementTime(whole.byProperty[0].parts, period, only);
  const total = (values: number[]) =>
    Math.round(values.reduce((sum, value) => sum + value, 0) * 100) / 100;

  return settle({
    collected: total(
      payments
        .filter((payment) =>
          carried.some(
            (span) => payment.date >= span.startDate && payment.date <= span.endDate,
          ),
        )
        .map((payment) => payment.amount),
    ),
    collectedByOwner,
    expenses: 0,
    commission: total(charged.map((part) => part.commission)),
    commissionTaxRate: 15,
    investmentRent: total(charged.map((part) => part.investmentRent)),
  });
}

describe("the client's samples", () => {
  test("sample 1: the office holds most of the rent and owes the owner", () => {
    const commission = commissionFor(
      percentageAgreement(2),
      [received("2026-08-11T00:00:00Z", 299_317)],
      period,
    );
    assert.equal(commission, 5_986.34);

    const result = settle({
      collected: 299_317,
      collectedByOwner: 222_117,
      expenses: 0,
      commission,
      commissionTaxRate: 15,
    });

    assert.deepEqual(
      {
        collected: result.collected,
        commission: result.commission,
        commissionTax: result.commissionTax,
        expenses: result.expenses,
        collectedByOwner: result.collectedByOwner,
        collectedByOperator: result.collectedByOperator,
        dueToOwner: result.dueToOwner,
        dueToOperator: result.dueToOperator,
      },
      {
        collected: 299_317,
        commission: 5_986.34,
        commissionTax: 897.95,
        expenses: 0,
        collectedByOwner: 222_117,
        collectedByOperator: 77_200,
        dueToOwner: 70_315.71,
        dueToOperator: 0,
      },
    );
  });

  test("sample 2: everything reached the owner, who owes the office its fee", () => {
    const commission = commissionFor(
      percentageAgreement(3),
      [received("2026-08-11T00:00:00Z", 94_000)],
      period,
    );
    assert.equal(commission, 2_820);

    const result = settle({
      collected: 94_000,
      collectedByOwner: 94_000,
      expenses: 0,
      commission,
      commissionTaxRate: 15,
    });

    assert.equal(result.commissionTax, 423);
    assert.equal(result.collectedByOperator, 0);
    assert.equal(result.dueToOwner, 0);
    assert.equal(result.dueToOperator, 3_243);
  });
});

describe("the samples at the edges of the agreement's term", () => {
  // Sample 1's rent, the last of it received on the statement's closing day.
  const sampleOne = [
    received("2026-02-03T00:00:00Z", 120_000),
    received("2026-06-20T00:00:00Z", 102_117),
    received("2026-09-29T09:30:00Z", 77_200),
  ];
  const lastDay = new Date("2026-09-29T00:00:00Z");

  test("sample 1 settles in full when the statement closes on the agreement's end date", () => {
    const result = statement(
      [percentageAgreement(2, { endDate: lastDay })],
      sampleOne,
      222_117,
    );
    assert.deepEqual(
      {
        collected: result.collected,
        commission: result.commission,
        commissionTax: result.commissionTax,
        collectedByOwner: result.collectedByOwner,
        collectedByOperator: result.collectedByOperator,
        dueToOwner: result.dueToOwner,
        dueToOperator: result.dueToOperator,
      },
      {
        collected: 299_317,
        commission: 5_986.34,
        commissionTax: 897.95,
        collectedByOwner: 222_117,
        collectedByOperator: 77_200,
        dueToOwner: 70_315.71,
        dueToOperator: 0,
      },
    );
  });

  test("sample 2 settles in full when the statement closes on the agreement's end date", () => {
    const result = statement(
      [percentageAgreement(3, { endDate: lastDay })],
      [
        received("2026-03-01T00:00:00Z", 50_000),
        received("2026-09-29T00:00:00Z", 44_000),
      ],
      94_000,
    );
    assert.equal(result.commission, 2_820);
    assert.equal(result.commissionTax, 423);
    assert.equal(result.collectedByOperator, 0);
    assert.equal(result.dueToOwner, 0);
    assert.equal(result.dueToOperator, 3_243);
  });

  test("an agreement marked expired since still settles its term", () => {
    const result = statement(
      [percentageAgreement(2, { endDate: lastDay, status: "expired" })],
      sampleOne,
      222_117,
    );
    assert.equal(result.commission, 5_986.34);
    assert.equal(result.dueToOwner, 70_315.71);
  });

  test("terminated inside the period, the owner keeps the fee on what came in after", () => {
    // Terminated on 30 June: the 77,200 of September is no longer charged.
    const result = statement(
      [
        percentageAgreement(2, {
          status: "terminated",
          terminatedDate: new Date("2026-06-30T14:00:00Z"),
        }),
      ],
      sampleOne,
      222_117,
    );
    // 2% of 222,117, and the VAT on it.
    assert.equal(result.commission, 4_442.34);
    assert.equal(result.commissionTax, 666.35);
    assert.equal(result.collected, 299_317);
    // 299,317 − 4,442.34 − 666.35 − 222,117
    assert.equal(result.dueToOwner, 72_091.31);
  });

  test("started inside the period, only rent received from its start is charged", () => {
    const result = statement(
      [percentageAgreement(2, { startDate: new Date("2026-06-01T00:00:00Z") })],
      sampleOne,
      222_117,
    );
    // 2% of 102,117 + 77,200.
    assert.equal(result.commission, 3_586.34);
    assert.equal(result.commissionTax, 537.95);
  });

  test("renewed inside the period, each agreement charges its own rate on its own part", () => {
    const old = percentageAgreement(2, {
      id: "old",
      endDate: new Date("2026-06-30T00:00:00Z"),
      status: "expired",
    });
    const renewed = percentageAgreement(3, {
      id: "new",
      startDate: new Date("2026-07-01T00:00:00Z"),
    });

    // The owner's statement carries both: 2% of 222,117 and 3% of 77,200.
    const owner = statement([old, renewed], sampleOne, 222_117);
    assert.equal(owner.commission, 6_758.34);
    assert.equal(owner.commissionTax, 1_013.75);

    // Each agreement's own statement carries its own, against its own rent.
    const first = statement([old, renewed], sampleOne, 222_117, "old");
    assert.equal(first.collected, 222_117);
    assert.equal(first.commission, 4_442.34);
    const second = statement([old, renewed], sampleOne, 0, "new");
    assert.equal(second.collected, 77_200);
    assert.equal(second.commission, 2_316);
    assert.equal(first.commission + second.commission, owner.commission);
  });
});

describe("a building under investment for part of the period", () => {
  // Sample 1's rent again. From April to June the office has the building
  // under an investment agreement at 10,000 a month; the rest of the period
  // it manages it at 2%.
  const payments = [
    received("2026-02-03T00:00:00Z", 120_000),
    received("2026-06-20T00:00:00Z", 102_117),
    received("2026-09-29T09:30:00Z", 77_200),
  ];
  const managed = percentageAgreement(2, { id: "managed" });
  const taken: AgreementRow = {
    ...percentageAgreement(0, {
      id: "taken",
      startDate: new Date("2026-04-01T00:00:00Z"),
      endDate: new Date("2026-06-30T00:00:00Z"),
    }),
    kind: "investment",
    feeType: "fixed",
    feeAmount: 10_000,
  };

  test("the owner keeps the managed months' rent and is owed the fixed rent of the others", () => {
    const result = statement([managed, taken], payments, 0);
    // June's 102,117 was the office's own; February's and September's are
    // the owner's, less 2% and the VAT on it, plus three months at 10,000.
    assert.equal(result.collected, 197_200);
    assert.equal(result.commission, 3_944);
    assert.equal(result.commissionTax, 591.6);
    assert.equal(result.investmentRent, 30_000);
    assert.equal(result.dueToOwner, 222_664.4);
  });

  test("the two agreements' own statements add up to the owner's", () => {
    const owner = statement([managed, taken], payments, 0);
    const management = statement([managed, taken], payments, 0, "managed");
    const investment = statement([managed, taken], payments, 0, "taken");

    assert.equal(management.collected, 197_200);
    assert.equal(management.commission, 3_944);
    assert.equal(management.investmentRent, 0);
    // Under investment the tenants' rent is not the owner's to list.
    assert.equal(investment.collected, 0);
    assert.equal(investment.commission, 0);
    assert.equal(investment.investmentRent, 30_000);
    assert.equal(management.ownerShare + investment.ownerShare, owner.ownerShare);
  });
});

describe("the settlement", () => {
  test("only one side of the dues ever carries a figure", () => {
    for (const collectedByOwner of [0, 500, 9_000, 10_000]) {
      const result = settle({
        collected: 10_000,
        collectedByOwner,
        expenses: 300,
        commission: 500,
        commissionTaxRate: 15,
      });
      assert.ok(
        result.dueToOwner === 0 || result.dueToOperator === 0,
        `both dues set at ${collectedByOwner}`,
      );
    }
  });

  test("expenses come off the owner's share", () => {
    const result = settle({
      collected: 10_000,
      collectedByOwner: 0,
      expenses: 1_250.5,
      commission: 500,
      commissionTaxRate: 15,
    });
    // 10,000 − 1,250.50 − 500 − 75
    assert.equal(result.ownerShare, 8_174.5);
    assert.equal(result.dueToOwner, 8_174.5);
  });

  test("a fixed fee with nothing collected leaves the owner owing it, with its VAT", () => {
    const result = settle({
      collected: 0,
      collectedByOwner: 0,
      expenses: 0,
      commission: 3_000,
      commissionTaxRate: 15,
    });
    assert.equal(result.dueToOwner, 0);
    assert.equal(result.dueToOperator, 3_450);
  });

  test("investment rent is added to what a managed portfolio leaves the owner", () => {
    const result = settle({
      collected: 50_000,
      collectedByOwner: 0,
      expenses: 500,
      commission: 1_000,
      commissionTaxRate: 15,
      investmentRent: 5_000,
    });
    // 50,000 − 500 − 1,000 − 150 + 5,000
    assert.equal(result.ownerShare, 53_350);
    assert.equal(result.dueToOwner, 53_350);
  });

  test("under an investment agreement the owner is owed the fixed rent alone", () => {
    const result = settle({
      kind: "investment",
      // The tenants' rent and the running costs are the office's.
      collected: 12_000,
      collectedByOwner: 2_000,
      expenses: 400,
      commission: 0,
      commissionTaxRate: 15,
      investmentRent: 10_000,
    });
    assert.equal(result.ownerShare, 10_000);
    // A tenant who paid the owner directly has already paid part of it.
    assert.equal(result.dueToOwner, 8_000);
    assert.equal(result.collectedByOperator, 10_000);
  });

  test("a VAT rate of 0 charges no VAT", () => {
    const result = settle({
      collected: 1_000,
      collectedByOwner: 0,
      expenses: 0,
      commission: 50,
      commissionTaxRate: 0,
    });
    assert.equal(result.commissionTax, 0);
    assert.equal(result.dueToOwner, 950);
  });
});
