/**
 * Clearing an organization through the demo-data tool is one unit of work.
 *
 * The deletes used to run one statement at a time. The tables they leave
 * alone — notifications, documents, inspections, settings — point at the
 * users and buildings they end with, so on any real organization the last
 * statements were refused after the first ones had already destroyed the
 * payments, invoices and leases.
 *
 * It cannot be run against a database to see, so a stand-in transaction
 * records what it is asked to do.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  DEMO_DATA_PURGE_REFUSED_MESSAGE,
  isForeignKeyRefusal,
  purgeOrganizationData,
} from "@/lib/demo-data-purge";
import type { OrgTransactionClient } from "@/lib/db/prisma";

interface Statement {
  model: string;
  args: unknown;
}

/** A transaction client that deletes nothing and remembers being asked. */
function fakeTransaction(options: { failOn?: string } = {}) {
  const statements: Statement[] = [];
  const tx = new Proxy(
    {},
    {
      get: (_target, model: string) => ({
        deleteMany: async (args: unknown) => {
          if (model === options.failOn) {
            throw new Error(`foreign key refused the delete on ${model}`);
          }
          statements.push({ model, args });
          return { count: statements.length };
        },
      }),
    },
  ) as unknown as OrgTransactionClient;
  return { tx, statements };
}

/** [child, parent]: the child table holds a foreign key to the parent. */
const REFERENCES: ReadonlyArray<readonly [string, string]> = [
  ["message", "conversation"],
  ["message", "user"],
  ["eventReminder", "event"],
  ["eventInvitation", "event"],
  ["event", "user"],
  ["workOrder", "maintenanceRequest"],
  ["maintenanceRequest", "property"],
  ["maintenanceRequest", "user"],
  ["paymentReceipt", "payment"],
  ["payment", "invoice"],
  ["payment", "lease"],
  ["invoice", "lease"],
  ["recurringPayment", "lease"],
  ["securityDeposit", "lease"],
  ["lease", "unit"],
  ["lease", "property"],
  ["lease", "user"],
  ["application", "property"],
  ["application", "user"],
  ["tenant", "user"],
  ["unit", "property"],
  ["property", "user"],
];

describe("clearing an organization", () => {
  test("names the organization on every statement, and nothing else", async () => {
    const { tx, statements } = fakeTransaction();
    await purgeOrganizationData(tx, "org_1");

    assert.equal(statements.length, 19);
    for (const statement of statements) {
      // No `deletedAt` filter: archived rows go too.
      assert.deepEqual(
        statement.args,
        { where: { organizationId: "org_1" } },
        statement.model,
      );
    }
  });

  test("deletes each table once, children before the rows they point at", async () => {
    const { tx, statements } = fakeTransaction();
    await purgeOrganizationData(tx, "org_1");

    const order = statements.map((statement) => statement.model);
    assert.equal(new Set(order).size, order.length, "a table was deleted twice");
    for (const [child, parent] of REFERENCES) {
      assert.ok(order.includes(child), `${child} is not deleted`);
      assert.ok(order.includes(parent), `${parent} is not deleted`);
      assert.ok(
        order.indexOf(child) < order.indexOf(parent),
        `${child} must go before ${parent}`,
      );
    }
    assert.equal(order.at(-1), "user");
  });

  test("reports how many rows went from each table", async () => {
    const { tx } = fakeTransaction();
    const deleted = await purgeOrganizationData(tx, "org_1");

    // The stand-in answers 1, 2, 3, … in the order it is called.
    assert.equal(deleted.messages, 1);
    assert.equal(deleted.payments, 10);
    assert.equal(deleted.invoices, 11);
    assert.equal(deleted.users, 19);
    assert.equal(Object.keys(deleted).length, 19);
  });

  test("stops at a refused statement, so the transaction undoes the rest", async () => {
    const { tx, statements } = fakeTransaction({ failOn: "property" });

    await assert.rejects(
      purgeOrganizationData(tx, "org_1"),
      /foreign key refused the delete on property/,
    );
    const order = statements.map((statement) => statement.model);
    assert.equal(order.includes("user"), false, "carried on past the failure");
    assert.equal(order.at(-1), "unit");
  });

  test("refuses to run without an organization", async () => {
    const { tx, statements } = fakeTransaction();

    await assert.rejects(purgeOrganizationData(tx, ""), /organization is required/);
    assert.equal(statements.length, 0);
  });
});

describe("a clear the database refuses", () => {
  test("is recognised by the foreign-key code, and by nothing else", () => {
    // What Prisma raises when PostgreSQL answers 23503.
    const refused = Object.assign(new Error("Foreign key constraint violated"), {
      code: "P2003",
    });
    assert.equal(isForeignKeyRefusal(refused), true);

    const timedOut = Object.assign(new Error("Transaction already closed"), {
      code: "P2028",
    });
    assert.equal(isForeignKeyRefusal(timedOut), false);
    assert.equal(isForeignKeyRefusal(new Error("connection reset")), false);
    assert.equal(isForeignKeyRefusal("P2003"), false);
    assert.equal(isForeignKeyRefusal(null), false);
  });

  test("tells the caller that nothing went", () => {
    assert.match(DEMO_DATA_PURGE_REFUSED_MESSAGE, /^Nothing was deleted\./);
  });
});
