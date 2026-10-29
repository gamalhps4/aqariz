/**
 * PropertyPro - Ledger sweep cron
 *
 * Brings every office's books in step with its documents: posts the
 * installments, payments, expenses and deposits dated from its cut-over that
 * are not yet posted, replaces what changed, reverses what was cancelled or
 * deleted (src/lib/accounting/sweep.service.ts). Offices that have not set
 * accounting up are skipped. It is the safety net under the posting hooks of
 * the write paths, so it is idempotent and safe to run as often as wanted.
 *
 * NOT SCHEDULED YET: add it to the scheduler (daily, e.g. 02:30 Riyadh) once
 * the ledger migration is applied. Authorised by CRON_SECRET like every
 * /api/cron route.
 */

import { NextResponse } from "next/server";
import { forEachOrganization, rejectUnauthorizedCron, withCronLock } from "@/lib/cron/request";
import { db } from "@/lib/db/prisma";
import { postUnpostedSince } from "@/lib/accounting/sweep.service";

export const dynamic = "force-dynamic";

/** The whole run's budget; each office gets what is left of it. */
const RUN_BUDGET_MS = 8 * 60_000;

export async function GET(request: Request) {
  const unauthorized = rejectUnauthorizedCron(request);
  if (unauthorized) return unauthorized;

  try {
    const started = Date.now();
    const lock = await withCronLock(
      "ledger-sweep",
      () =>
        forEachOrganization(async () => {
          const settings = await db.accountingSettings.findFirst({ select: { id: true } });
          if (!settings) return { skipped: true };
          const left = RUN_BUDGET_MS - (Date.now() - started);
          if (left <= 5_000) return { skipped: true, reason: "out of time" };
          return postUnpostedSince(null, { budgetMs: left });
        }),
      { timeoutMs: RUN_BUDGET_MS + 60_000 },
    );

    if (lock.skipped || !lock.result) {
      return NextResponse.json({
        success: true,
        skipped: true,
        message: "Previous ledger sweep still running",
      });
    }
    return NextResponse.json({
      success: true,
      message: "Ledger sweep completed",
      data: {
        organizations: lock.result.organizations,
        succeeded: lock.result.succeeded,
        failed: lock.result.failed,
        results: lock.result.results,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Error in ledger-sweep cron:", error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
