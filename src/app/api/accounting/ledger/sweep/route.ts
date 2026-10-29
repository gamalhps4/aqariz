/**
 * PropertyPro - Post the office's documents now
 *
 * POST — the same sweep the nightly cron runs, for this office only, within a
 * minute's budget; what is left is reported and posted by the next run.
 */

import { createSuccessResponse } from "@/lib/api-utils";
import { LEDGER_MANAGE_ACCESS, ledgerRoute } from "@/lib/accounting/api";
import { postUnpostedSince } from "@/lib/accounting/sweep.service";
import { sweepSnapshot } from "@/lib/accounting/audit-snapshots";
import { AuditAction, recordActivity } from "@/lib/audit-domain";
import { noteAuditEntry } from "@/lib/audit/scope";

export const dynamic = "force-dynamic";

export const POST = ledgerRoute(LEDGER_MANAGE_ACCESS, async (user) => {
  const result = await postUnpostedSince(null, { budgetMs: 60_000, userId: user.id });
  // One entry with the counts, for the run a person asked for (the nightly
  // run has no one to name). A run that found nothing to do records nothing,
  // and the wrapper is told not to write a basic entry in its place.
  const counts = sweepSnapshot(result);
  if (counts) {
    void recordActivity({
      action: AuditAction.BULK_UPDATE,
      recordType: "journal_entry",
      messageKey: "admin.audit.msg.ledger_sweep",
      after: counts,
    });
  } else {
    noteAuditEntry();
  }
  return createSuccessResponse(result, result.complete ? "The books are up to date" : "Partly posted; run again to finish");
});
