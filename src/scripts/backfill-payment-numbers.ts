/**
 * PropertyPro - Number the payments received before payment numbers existed
 *
 * Dry run (reads only):
 *   NODE_OPTIONS=--conditions=react-server node_modules/.bin/tsx \
 *     --env-file=.env.local --tsconfig tsconfig.json \
 *     src/scripts/backfill-payment-numbers.ts
 * Write: the same command with `--apply`. `--batch=500` sets how many
 * payments one transaction numbers (default 500).
 *
 * Run it right after migration 20261003100001_payment_numbers. That migration
 * gives every organization that existed then a counter marked "not ready":
 * its older payments have no number, and the payments it takes until this
 * script has run wait unnumbered too (they still work; their number column
 * reads "—" for now). For each organization this numbers every payment that
 * money was received on — paid, partly paid, refunded, or with money on it
 * whatever its status, archived ones included — in the order the money
 * arrived (paid date, else the date it was written; then id), carrying on
 * from the counter, and then marks the counter ready, after which the
 * database numbers every new payment as it is paid.
 *
 * Safe to run again, and resumable: only payments still without a number
 * are read, each batch is its own transaction, and an organization is marked
 * ready only by the batch that numbers its last payment. The counter row is
 * locked for each batch, so a payment settled meanwhile waits for it and is
 * numbered in its turn rather than skipped. Charges nobody has paid are left
 * alone; they are numbered when money is received on them.
 */

import { db, runWithOrgTransaction } from "@/lib/db/prisma";
import { bypassOrgScope } from "@/lib/tenancy/context";
import {
  recordPlatformAudit,
  SYSTEM_ACTOR,
  type PlatformAuditAction,
} from "@/lib/platform/audit";
import { formatPaymentNumber } from "@/lib/payments/receipt-number";
import { businessDay } from "@/lib/dates/business-day";

const APPLY = process.argv.includes("--apply");
const BATCH = (() => {
  const flag = process.argv.find((arg) => arg.startsWith("--batch="));
  const value = flag ? Number(flag.slice("--batch=".length)) : 500;
  return Number.isInteger(value) && value > 0 ? value : 500;
})();

/**
 * Money was received on the row: the trigger's own rule
 * (assign_payment_number), as SQL.
 */
const RECEIVED_SQL = `("status" IN ('paid', 'partial', 'refunded') OR COALESCE("amountPaid", 0) > 0)`;

interface OrgState {
  organizationId: string;
  name: string;
  unnumbered: number;
  highest: number;
  lastNumber: number | null;
  ready: boolean | null;
}

/** Every organization with payments to number, or a counter not yet ready. */
async function readStates(): Promise<OrgState[]> {
  const [organizations, pending, counters] = await Promise.all([
    db.organization.findMany({
      where: { deletedAt: undefined },
      select: { id: true, name: true },
    }),
    db.$queryRawUnsafe<
      Array<{ organizationId: string; unnumbered: bigint; highest: number | null }>
    >(
      `SELECT "organizationId",
              COUNT(*) FILTER (WHERE "number" IS NULL AND ${RECEIVED_SQL}) AS unnumbered,
              MAX("number") AS highest
         FROM "payments"
        GROUP BY "organizationId"`,
    ),
    db.$queryRawUnsafe<
      Array<{ organizationId: string; lastNumber: number; ready: boolean }>
    >(`SELECT "organizationId", "lastNumber", "ready" FROM "payment_number_counters"`),
  ]);

  const nameById = new Map(organizations.map((org) => [org.id, org.name]));
  const counterById = new Map(counters.map((row) => [row.organizationId, row]));
  const pendingById = new Map(pending.map((row) => [row.organizationId, row]));
  const ids = new Set([...pendingById.keys(), ...counterById.keys()]);

  return [...ids]
    .map((organizationId): OrgState => {
      const counts = pendingById.get(organizationId);
      const counter = counterById.get(organizationId);
      return {
        organizationId,
        name: nameById.get(organizationId) ?? organizationId,
        unnumbered: Number(counts?.unnumbered ?? 0),
        highest: Number(counts?.highest ?? 0),
        lastNumber: counter ? Number(counter.lastNumber) : null,
        ready: counter ? counter.ready : null,
      };
    })
    .filter((state) => state.unnumbered > 0 || state.ready === false);
}

/** The first payments an organization's numbering would reach, for the dry run. */
async function preview(organizationId: string, from: number) {
  const rows = await db.$queryRawUnsafe<
    Array<{
      id: string;
      status: string;
      paidDate: Date | null;
      createdAt: Date;
      amountPaid: string | number;
      deletedAt: Date | null;
    }>
  >(
    `SELECT "id", "status", "paidDate", "createdAt", "amountPaid", "deletedAt"
       FROM "payments"
      WHERE "organizationId" = $1 AND "number" IS NULL AND ${RECEIVED_SQL}
      ORDER BY COALESCE("paidDate", "createdAt"), "id"
      LIMIT 5`,
    organizationId,
  );
  return rows.map((row, index) => ({
    number: formatPaymentNumber(from + index + 1),
    payment: row.id,
    received: businessDay(row.paidDate ?? row.createdAt),
    status: row.status,
    amount: Number(row.amountPaid),
    archived: row.deletedAt ? "yes" : "",
  }));
}

/**
 * Number one batch of an organization's payments, oldest first, under the
 * counter's lock. Marks the counter ready when the batch was the last.
 */
async function numberBatch(
  organizationId: string,
): Promise<{ numbered: number; first: number | null; last: number | null; done: boolean }> {
  return runWithOrgTransaction(
    async (tx) => {
      // The counter row, created "not ready" if the migration did not make
      // one, then locked: a payment settled while this runs waits here.
      await tx.$executeRawUnsafe(
        `INSERT INTO "payment_number_counters" ("organizationId", "lastNumber", "ready")
         VALUES ($1, 0, false)
         ON CONFLICT ("organizationId") DO NOTHING`,
        organizationId,
      );
      const [counter] = await tx.$queryRawUnsafe<Array<{ lastNumber: number }>>(
        `SELECT "lastNumber" FROM "payment_number_counters"
          WHERE "organizationId" = $1 FOR UPDATE`,
        organizationId,
      );
      const [highest] = await tx.$queryRawUnsafe<Array<{ highest: number | null }>>(
        `SELECT MAX("number") AS highest FROM "payments" WHERE "organizationId" = $1`,
        organizationId,
      );
      const from = Math.max(
        Number(counter?.lastNumber ?? 0),
        Number(highest?.highest ?? 0),
      );

      const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT "id" FROM "payments"
          WHERE "organizationId" = $1 AND "number" IS NULL AND ${RECEIVED_SQL}
          ORDER BY COALESCE("paidDate", "createdAt"), "id"
          LIMIT $2
          FOR UPDATE`,
        organizationId,
        BATCH,
      );

      if (rows.length > 0) {
        const ids = rows.map((row) => row.id);
        const numbers = rows.map((_, index) => from + index + 1);
        // The trigger takes a number set this way as given and keeps the
        // counter at or above it.
        await tx.$executeRawUnsafe(
          `UPDATE "payments" AS p
              SET "number" = v."number"
             FROM (SELECT UNNEST($1::text[]) AS "id", UNNEST($2::int[]) AS "number") AS v
            WHERE p."id" = v."id" AND p."number" IS NULL`,
          ids,
          numbers,
        );
      }

      const done = rows.length < BATCH;
      if (done) {
        await tx.$executeRawUnsafe(
          `UPDATE "payment_number_counters"
              SET "ready" = true,
                  "lastNumber" = GREATEST("lastNumber", $2),
                  "updatedAt" = CURRENT_TIMESTAMP
            WHERE "organizationId" = $1`,
          organizationId,
          from + rows.length,
        );
      }

      return {
        numbered: rows.length,
        first: rows.length ? from + 1 : null,
        last: rows.length ? from + rows.length : null,
        done,
      };
    },
    { bypass: true },
  );
}

async function main(): Promise<void> {
  await bypassOrgScope(async () => {
    const states = await readStates();
    if (states.length === 0) {
      console.log("Every payment that money was received on has its number. Nothing to do.");
      return;
    }

    console.log(`Organizations to number: ${states.length} (batch size ${BATCH})`);
    console.table(
      states.map((state) => ({
        organization: state.name,
        id: state.organizationId,
        unnumbered: state.unnumbered,
        counter: state.lastNumber ?? "—",
        ready: state.ready === null ? "no counter" : state.ready ? "yes" : "no",
        highestNumber: state.highest || "—",
      })),
    );

    if (!APPLY) {
      for (const state of states) {
        if (state.unnumbered === 0) continue;
        const from = Math.max(state.lastNumber ?? 0, state.highest);
        console.log(
          `${state.name}: would number ${state.unnumbered} payment(s), ` +
            `${formatPaymentNumber(from + 1)} to ${formatPaymentNumber(from + state.unnumbered)}. First ones:`,
        );
        console.table(await preview(state.organizationId, from));
        if (state.ready) {
          console.log(
            `  Note: ${state.name}'s counter is already ready, so these payments are numbered after the ones it has given out since — not in date order with them.`,
          );
        }
      }
      console.log("Dry run — nothing written. Re-run with --apply to write.");
      return;
    }

    for (const state of states) {
      let numbered = 0;
      let first: number | null = null;
      let last: number | null = null;
      for (;;) {
        const batch = await numberBatch(state.organizationId);
        numbered += batch.numbered;
        first ??= batch.first;
        last = batch.last ?? last;
        if (batch.done) break;
      }
      console.log(
        `${state.name}: numbered ${numbered} payment(s)` +
          (first && last
            ? ` (${formatPaymentNumber(first)} to ${formatPaymentNumber(last)})`
            : "") +
          "; new payments are numbered as they are paid.",
      );
      await recordPlatformAudit({
        actor: SYSTEM_ACTOR,
        // Typed loosely so the script does not need the action added to the
        // audit vocabulary to compile.
        action: "payment.numbers_backfilled" as unknown as PlatformAuditAction,
        targetType: "organization",
        targetId: state.organizationId,
        targetName: state.name,
        organizationId: state.organizationId,
        summary: `Numbered ${numbered} payment(s) received before payment numbers existed`,
        metadata: {
          script: "src/scripts/backfill-payment-numbers.ts",
          numbered,
          first: formatPaymentNumber(first),
          last: formatPaymentNumber(last),
        },
      });
    }
  });
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
