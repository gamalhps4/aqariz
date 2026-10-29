/**
 * A taken invoice number has to be told apart from a period already billed:
 * one means "try the next number", the other "skip, it exists".
 *
 * The generator read that from `meta.target`, which the query engine set and
 * a driver adapter does not. On this stack every unique violation therefore
 * looked unknown and was rethrown — a taken number was never retried, and a
 * period billed by a concurrent run surfaced as an error instead of a skip.
 *
 * The shapes below are the ones Prisma produces. The first is the old query
 * engine's. The second is @prisma/adapter-pg's when the role may read the
 * conflicting key: the column names arrive quoted exactly as Postgres prints
 * them. The third is what the real database gives: under row-level security
 * Postgres leaves the key out of its error, the adapter has nothing to pass
 * on, and only the database's original message still names the constraint.
 * A first fix read the second shape alone, and passed on a test database
 * whose role bypassed row-level security.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  uniqueViolationMessage,
  uniqueViolationTarget,
} from "@/lib/db/unique-violation";

function adapterError(constraint: unknown, message = "Unique constraint failed") {
  return {
    code: "P2002",
    message,
    meta: {
      modelName: "Invoice",
      driverAdapterError: {
        cause: { kind: "UniqueConstraintViolation", constraint },
      },
    },
  };
}

/**
 * The shape under row-level security, as the adapter builds it: no
 * `constraint`, Prisma's message reduced to "(not available)", and the
 * database's own message naming the constraint it hit.
 */
function rlsError(constraintName: string, frame = "") {
  return {
    code: "P2002",
    message: `${frame}Unique constraint failed on the (not available)`,
    meta: {
      modelName: "Invoice",
      driverAdapterError: {
        name: "DriverAdapterError",
        cause: {
          originalCode: "23505",
          originalMessage: `duplicate key value violates unique constraint "${constraintName}"`,
          kind: "UniqueConstraintViolation",
        },
      },
    },
  };
}

describe("which constraint a failed write hit", () => {
  test("the query engine's shape: meta.target", () => {
    const target = uniqueViolationTarget({
      code: "P2002",
      meta: { target: ["organizationId", "invoiceNumber"] },
    });
    assert.ok(target.includes("invoiceNumber"));
    assert.ok(!target.includes("period"));
  });

  test("a driver adapter's shape: the columns, as the database quotes them", () => {
    const number = uniqueViolationTarget(
      adapterError({ fields: ['"organizationId"', '"invoiceNumber"'] }),
    );
    assert.ok(number.includes("invoiceNumber"));
    assert.ok(!number.includes("period"));

    const period = uniqueViolationTarget(
      adapterError({ fields: ['"leaseId"', "category", '"periodStart"'] }),
    );
    assert.ok(period.includes("period"));
    assert.ok(!period.includes("invoiceNumber"));
  });

  test("a driver adapter naming the index instead", () => {
    const target = uniqueViolationTarget(
      adapterError({ index: "invoices_period_per_lease_unique" }),
    );
    assert.ok(target.includes("period"));
  });

  test("under row-level security: a taken invoice number is still recognised", () => {
    // The shape the real database produces. Without this the number was
    // never retried: the generator gave up on the first collision.
    const target = uniqueViolationTarget(
      rlsError("invoices_organizationId_invoiceNumber_key"),
    );
    assert.ok(target.includes("invoiceNumber"), target);
    assert.ok(!target.includes("period"), target);
  });

  test("under row-level security: a period already billed is still recognised", () => {
    // …and the period a concurrent run had just billed was an error rather
    // than the skip that makes generation safe to repeat.
    const target = uniqueViolationTarget(
      rlsError("invoices_period_per_lease_unique"),
    );
    assert.ok(target.includes("period"), target);
    assert.ok(!target.includes("invoiceNumber"), target);
  });

  test("the calling code quoted in a development message is never searched", () => {
    // In development Prisma's message opens with a frame of the code that
    // made the call. Its identifiers are not the constraint: a period
    // collision must not read as a taken number because the frame happens to
    // mention `invoiceNumber`.
    const frame =
      "\nInvalid `db.invoice.create()` invocation in\n/app/service.js:10:1\n\n" +
      "  8 invoiceNumber: `${prefix}-${seq}`,\n→ 9 return await db.invoice.create(\n";

    const named = uniqueViolationTarget(
      rlsError("invoices_period_per_lease_unique", frame),
    );
    assert.ok(named.includes("period"));
    assert.ok(!named.includes("invoiceNumber"), named);

    // Even with nothing structured to go on, only the error line is read.
    const bare = uniqueViolationTarget({
      code: "P2002",
      message: `${frame}Unique constraint failed on the fields: (\`leaseId\`,\`category\`,\`periodStart\`)`,
    });
    assert.ok(bare.includes("periodStart"));
    assert.ok(!bare.includes("invoiceNumber"), bare);
  });

  test("no structured detail at all: the error line still names the columns", () => {
    const target = uniqueViolationTarget(
      adapterError(
        undefined,
        "Unique constraint failed on the fields: (`organizationId`,`invoiceNumber`)",
      ),
    );
    assert.ok(target.includes("invoiceNumber"));
  });

  test("anything that is not a unique violation names nothing", () => {
    assert.equal(uniqueViolationTarget(new Error("connection reset")), "");
    assert.equal(
      uniqueViolationTarget({ code: "P2025", meta: { target: ["id"] } }),
      "",
    );
    assert.equal(uniqueViolationTarget(null), "");
    assert.equal(uniqueViolationTarget("P2002"), "");
  });
});

describe("what a duplicate tells the person who saved it", () => {
  // The API's error handler read `meta.target`, which this stack never sets,
  // so every duplicate — a second active contract on a unit, a contract
  // number already used — reached the screen as "record already exists".

  test("under row-level security, from the constraint's name", () => {
    assert.equal(
      uniqueViolationMessage(rlsError("leases_one_active_per_unit")),
      "Another active contract already holds this unit",
    );
    assert.equal(
      uniqueViolationMessage(rlsError("leases_org_contract_number_active_unique")),
      "Another contract already uses this contract number",
    );
    assert.equal(
      uniqueViolationMessage(rlsError("units_property_unit_number_active_unique")),
      "This building already has a unit with this number",
    );
    assert.equal(
      uniqueViolationMessage(rlsError("users_email_key")),
      "This email address is already in use",
    );
  });

  test("from the columns, in both of the shapes that carry them", () => {
    assert.equal(
      uniqueViolationMessage(
        adapterError({ fields: ['"organizationId"', '"contractNumber"'] }),
      ),
      "Another contract already uses this contract number",
    );
    assert.equal(
      uniqueViolationMessage({ code: "P2002", meta: { target: ["email"] } }),
      "This email address is already in use",
    );
  });

  test("a billed period is not mistaken for a taken invoice number", () => {
    assert.equal(
      uniqueViolationMessage(rlsError("invoices_period_per_lease_unique")),
      "This period of the contract is already billed",
    );
    assert.equal(
      uniqueViolationMessage(rlsError("invoices_organizationId_invoiceNumber_key")),
      "This invoice number is already in use",
    );
  });

  test("an unknown constraint gets a sentence, never its index name", () => {
    const message = uniqueViolationMessage(rlsError("some_internal_index_key"));
    assert.equal(message, "This record already exists");
    assert.equal(
      uniqueViolationMessage({ code: "P2002", message: "" }),
      "This record already exists",
    );
  });

  test("anything that is not a unique violation has no message here", () => {
    assert.equal(uniqueViolationMessage(new Error("connection reset")), null);
    assert.equal(uniqueViolationMessage({ code: "P2025" }), null);
    assert.equal(uniqueViolationMessage(null), null);
  });
});
