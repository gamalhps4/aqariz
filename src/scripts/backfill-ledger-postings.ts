/**
 * PropertyPro - Post every office's documents since its cut-over
 *
 * Dry run (reads only):
 *   NODE_OPTIONS=--conditions=react-server node_modules/.bin/tsx \
 *     --env-file=.env.local --tsconfig tsconfig.json \
 *     src/scripts/backfill-ledger-postings.ts
 * Write: the same command with `--apply`. `--org=<id>` limits it to one
 * office.
 *
 * The posting backfill: for each office that has set accounting up, the
 * ledger sweep (lib/accounting/sweep.service.ts) from the office's own
 * cut-over date — installments and invoices, payments and refunds, what
 * owners and customers paid on their invoices, expenses, security deposits.
 * The dry run says what a run would post, replace and reverse; `--apply`
 * does it. An office without accounting set up is skipped (it has no books
 * to post to), so on a database where no office has set it up this reports
 * nothing to do.
 *
 * Safe to run again: posting is idempotent, so a second run straight after
 * the first finds nothing to do (a dry run then reports 0). Each run works to
 * a time budget per office and says what it left for the next run.
 */

import { db } from "@/lib/db/prisma";
import { bypassOrgScope, runWithOrgContext } from "@/lib/tenancy/context";
import { postUnpostedSince, type SweepResult } from "@/lib/accounting/sweep.service";
import { businessDay } from "@/lib/dates/business-day";

const APPLY = process.argv.includes("--apply");
const ONLY = process.argv.find((arg) => arg.startsWith("--org="))?.slice("--org=".length) ?? null;

/** Per office: long enough for a large office on a remote database. */
const BUDGET_MS = 20 * 60_000;

async function main(): Promise<void> {
  const offices = await bypassOrgScope(async () => {
    const settings = await db.accountingSettings.findMany({
      select: { organizationId: true, cutOverDate: true },
    });
    const names = await db.organization.findMany({
      where: { id: { in: settings.map((row) => row.organizationId) } },
      select: { id: true, name: true },
    });
    const name = new Map(names.map((row) => [row.id, row.name]));
    return settings
      .filter((row) => !ONLY || row.organizationId === ONLY)
      .map((row) => ({
        id: row.organizationId,
        name: name.get(row.organizationId) ?? row.organizationId,
        cutOver: row.cutOverDate ? businessDay(row.cutOverDate) : "—",
      }));
  });

  console.log(
    `${APPLY ? "APPLY" : "DRY RUN"}: ${offices.length} office(s) with accounting set up${ONLY ? ` (only ${ONLY})` : ""}`,
  );
  const total = { examined: 0, created: 0, replaced: 0, reversed: 0, unchanged: 0, failed: 0, remaining: 0 };
  for (const office of offices) {
    const result: SweepResult = await runWithOrgContext(
      { organizationId: office.id, isPlatformAdmin: false },
      () => postUnpostedSince(null, { dryRun: !APPLY, budgetMs: BUDGET_MS }),
    );
    for (const key of Object.keys(total) as Array<keyof typeof total>) total[key] += result[key];
    console.log(
      `  ${office.name} (${office.id}) from ${office.cutOver}: examined ${result.examined}, ` +
        `${APPLY ? "" : "would "}post ${result.created}, replace ${result.replaced}, reverse ${result.reversed}; ` +
        `unchanged ${result.unchanged}` +
        (result.failed ? `, FAILED ${result.failed}` : "") +
        (result.remaining ? `, left for the next run ${result.remaining}` : ""),
    );
    for (const error of result.errors) console.log(`    ! ${error}`);
  }
  const toDo = total.created + total.replaced + total.reversed;
  console.log(
    `Total: examined ${total.examined}, ${APPLY ? "posted" : "to post"} ${total.created}, ` +
      `${APPLY ? "replaced" : "to replace"} ${total.replaced}, ${APPLY ? "reversed" : "to reverse"} ${total.reversed}, ` +
      `unchanged ${total.unchanged}, failed ${total.failed}, left ${total.remaining}` +
      (APPLY ? "" : ` — ${toDo} change(s) to make`),
  );
  if (total.failed > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
