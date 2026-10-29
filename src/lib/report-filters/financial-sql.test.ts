/**
 * The financial report's SQL takes the same filters as every other report —
 * and each is a condition AND-ed with the reader's scope, never a replacement
 * for it.
 *
 * The conditions are read as text with their bound values, since there is no
 * database here: what matters is that every value is a parameter, that each
 * filter is its own condition, and that the scope's condition is still in the
 * statement beside them.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { Prisma } from "@/generated/prisma/client";
import {
  allOf,
  expenseFilterConditions,
  paymentFilterConditions,
} from "@/lib/report-filters/financial-sql";

/** The statement and the values it binds, as the driver would receive them. */
function render(conditions: Prisma.Sql[]) {
  const joined = allOf(conditions);
  return { text: joined.text, values: joined.values };
}

// The reader's own condition, in the shape lib/db/scopes.ts' paymentScopeSql
// makes it for an employee narrowed to two buildings (it cannot be imported
// here — see lib/db/scope-where.test.ts).
const holdsA = Prisma.sql`p."propertyId" IN (${Prisma.join(["a1", "a2"])})`;

describe("payments", () => {
  test("no filter, no condition", () => {
    assert.deepEqual(paymentFilterConditions({}), []);
  });

  test("a building, a tenant and a contract are columns of the payment", () => {
    const { text, values } = render(
      paymentFilterConditions({
        propertyId: "a1",
        tenantId: "t-1",
        leaseId: "c-1",
      }),
    );
    assert.equal(
      text,
      'p."propertyId" = $1 AND p."tenantId" = $2 AND p."leaseId" = $3',
    );
    assert.deepEqual(values, ["a1", "t-1", "c-1"]);
  });

  test("an owner and a compound are one condition on one building", () => {
    const conditions = paymentFilterConditions({
      ownerId: "owner-1",
      compoundId: "A",
    });
    assert.equal(conditions.length, 1);
    const { text, values } = render(conditions);
    assert.equal(
      text,
      'EXISTS (SELECT 1 FROM properties b WHERE b.id = p."propertyId" AND b."ownerId" = $1 AND b."compoundId" = $2)',
    );
    assert.deepEqual(values, ["owner-1", "A"]);
  });

  test("a unit is the unit of the contract the payment was charged under", () => {
    const { text, values } = render(paymentFilterConditions({ unitId: "u-1" }));
    assert.equal(
      text,
      'EXISTS (SELECT 1 FROM leases l WHERE l.id = p."leaseId" AND l."unitId" = $1)',
    );
    assert.deepEqual(values, ["u-1"]);
  });

  test("a status is the payment's own", () => {
    const { text, values } = render(paymentFilterConditions({ status: "paid" }));
    assert.equal(text, "p.status = $1");
    assert.deepEqual(values, ["paid"]);
  });

  test("every value is a bound parameter, never written into the statement", () => {
    const hostile = "x'; DROP TABLE payments; --";
    const { text, values } = render(
      paymentFilterConditions({
        ownerId: hostile,
        compoundId: hostile,
        propertyId: hostile,
        unitId: hostile,
        tenantId: hostile,
        leaseId: hostile,
        status: hostile,
      }),
    );
    assert.ok(!text.includes("DROP"));
    assert.ok(!text.includes(hostile));
    assert.equal(values.filter((value) => value === hostile).length, 7);
  });

  test("an empty value is no filter", () => {
    assert.deepEqual(
      paymentFilterConditions({ ownerId: "", unitId: "", status: "" }),
      [],
    );
  });
});

describe("expenses", () => {
  test("only the building filters apply to an expense", () => {
    const conditions = expenseFilterConditions({
      propertyId: "a1",
      ownerId: "owner-1",
      // None of these is a column of an expense.
      tenantId: "t-1",
      leaseId: "c-1",
      unitId: "u-1",
      status: "paid",
    });
    const { text, values } = render(conditions);
    assert.equal(
      text,
      'e."propertyId" = $1 AND EXISTS (SELECT 1 FROM properties b WHERE b.id = e."propertyId" AND b."ownerId" = $2)',
    );
    assert.deepEqual(values, ["a1", "owner-1"]);
  });

  test("no filter, no condition", () => {
    assert.deepEqual(expenseFilterConditions({}), []);
  });
});

describe("a filter never replaces the reader's scope", () => {
  test("both conditions are in the statement, joined by AND", () => {
    const { text, values } = render([
      ...paymentFilterConditions({ propertyId: "b1" }),
      holdsA,
    ]);
    // `propertyId = 'b1' AND propertyId IN ('a1','a2')` matches no row: the
    // building asked for is outside what the reader holds.
    assert.equal(text, 'p."propertyId" = $1 AND p."propertyId" IN ($2,$3)');
    assert.deepEqual(values, ["b1", "a1", "a2"]);
  });

  test("the scope survives every filter", () => {
    const { text } = render([
      ...paymentFilterConditions({
        ownerId: "owner-2",
        compoundId: "B",
        propertyId: "b1",
        unitId: "u-b1-1",
        tenantId: "t-3",
        leaseId: "c-4",
        status: "paid",
      }),
      holdsA,
    ]);
    // Seven values bind for the filters; the scope's follow.
    assert.ok(text.endsWith('AND p."propertyId" IN ($8,$9)'), text);
  });

  test("a scope of nothing is still a condition, not the absence of one", () => {
    const nothing = Prisma.sql`FALSE`;
    const { text } = render([...paymentFilterConditions({}), nothing]);
    assert.equal(text, "FALSE");
  });

  test("with no conditions at all the statement is every row", () => {
    assert.equal(render([]).text, "TRUE");
  });
});
