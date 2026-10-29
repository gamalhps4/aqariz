/**
 * PropertyPro - Find security deposits posted twice
 *
 * Reads only:
 *   NODE_OPTIONS=--conditions=react-server node_modules/.bin/tsx \
 *     --env-file=.env.local --tsconfig tsconfig.json \
 *     src/scripts/check-doubled-deposit-receipts.ts
 *
 * Until 2026-10-04 a deposit paid through its installment was posted twice:
 * once by the payment, and again from the deposit record ("deposit_receipt")
 * when staff pressed "Confirm collection", which linked no payment (see
 * lib/accounting/deposit-installment.ts). This lists, for each office that
 * has set accounting up, the deposit receipts still in its books that a
 * payment has also posted.
 *
 * The fix is the ledger sweep, which reverses what no document asks for any
 * more: `src/scripts/backfill-ledger-postings.ts` (dry run, then `--apply`),
 * after which this reports 0.
 */

import { db } from "@/lib/db/prisma";
import { bypassOrgScope, runWithOrgContext } from "@/lib/tenancy/context";
import { paidDepositLeaseIds } from "@/lib/accounting/deposit-installment.service";
import { depositPostsOwnReceipt } from "@/lib/accounting/deposit-installment";

async function main(): Promise<void> {
  const offices = await bypassOrgScope(async () => {
    const settings = await db.accountingSettings.findMany({
      select: { organizationId: true },
    });
    const names = await db.organization.findMany({
      where: { id: { in: settings.map((row) => row.organizationId) } },
      select: { id: true, name: true },
    });
    const name = new Map(names.map((row) => [row.id, row.name]));
    return settings.map((row) => ({
      id: row.organizationId,
      name: name.get(row.organizationId) ?? row.organizationId,
    }));
  });

  console.log(`${offices.length} office(s) with accounting set up`);
  let doubled = 0;
  for (const office of offices) {
    const found = await runWithOrgContext(
      { organizationId: office.id, isPlatformAdmin: false },
      async () => {
        const entries = await db.journalEntry.findMany({
          where: { sourceType: "deposit_receipt", status: "posted", reversesId: null },
          select: { id: true, number: true, sourceId: true, totalAmount: true },
        });
        const deposits = await db.securityDeposit.findMany({
          where: {
            id: { in: entries.map((entry) => entry.sourceId).filter((id): id is string => Boolean(id)) },
            deletedAt: undefined,
          },
          select: { id: true, leaseId: true, collectedPaymentId: true },
        });
        const paid = await paidDepositLeaseIds(deposits.map((deposit) => deposit.leaseId));
        const byId = new Map(deposits.map((deposit) => [deposit.id, deposit]));
        const twice = entries.filter((entry) => {
          const deposit = entry.sourceId ? byId.get(entry.sourceId) : undefined;
          return (
            deposit &&
            !depositPostsOwnReceipt({
              collectedPaymentId: deposit.collectedPaymentId,
              installmentPaid: paid.has(deposit.leaseId),
            })
          );
        });
        return { entries: entries.length, twice };
      },
    );
    doubled += found.twice.length;
    console.log(
      `  ${office.name} (${office.id}): ${found.entries} deposit receipt(s) in the books, ` +
        `${found.twice.length} also posted by a payment`,
    );
    for (const entry of found.twice) {
      console.log(`    JE ${entry.number} deposit ${entry.sourceId} ${entry.totalAmount}`);
    }
  }
  console.log(
    `Total posted twice: ${doubled}` +
      (doubled ? " — run src/scripts/backfill-ledger-postings.ts (dry run, then --apply)" : ""),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
