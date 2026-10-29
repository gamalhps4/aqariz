/**
 * PropertyPro SaaS - Scheduled cleanup (MongoDB TTL replacement)
 *
 * Postgres has no TTL indexes, so the rows Mongo used to expire automatically
 * are purged here instead. Point an external scheduler (cron, GitHub Actions,
 * a platform scheduler) at this route once a day:
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/cleanup
 *
 * What it purges:
 *  - webhook_events: processed gateway events older than 30 days (kept only
 *    for idempotency de-duplication; gateways retry within days, not weeks).
 *  - invitation_tokens: expired tokens and used tokens older than 7 days.
 *  - audit_logs: rows past their per-row `retentionDate`.
 *  - error_logs: groups resolved more than 30 days ago (unresolved groups are
 *    kept regardless of age — an old bug nobody fixed is still a bug).
 */

import { NextResponse } from "next/server";
import { authDb } from "@/lib/db/prisma";
import { rejectUnauthorizedCron, withCronLock } from "@/lib/cron/request";
import { cleanupExpiredTokens } from "@/lib/invitation-utils";
import { auditService } from "@/lib/audit-service";
import { purgeResolvedErrors } from "@/lib/platform/error-store";

const WEBHOOK_EVENT_RETENTION_DAYS = 30;

export async function GET(req: Request) {
  const unauthorized = rejectUnauthorizedCron(req);
  if (unauthorized) return unauthorized;

  try {
    const lock = await withCronLock("cleanup", async () => {
      // webhook_events is a global infrastructure table (bypass-only RLS
      // policy), so the purge runs on the bypass client like the writes do.
      const webhookCutoff = new Date(
        Date.now() - WEBHOOK_EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000,
      );
      const webhookEvents = await authDb.webhookEvent.deleteMany({
        where: { processedAt: { lt: webhookCutoff } },
      });

      const invitationTokens = await cleanupExpiredTokens();

      const auditLogs = await auditService.cleanupExpiredLogs();

      const errorLogs = await purgeResolvedErrors();

      return {
        webhookEvents: webhookEvents.count,
        invitationTokens,
        auditLogs,
        errorLogs,
      };
    });

    if (lock.skipped) {
      return NextResponse.json({
        success: true,
        skipped: true,
        message: "Previous cleanup still running",
      });
    }

    return NextResponse.json({
      success: true,
      message: "Cleanup completed",
      data: lock.result,
    });
  } catch (error: any) {
    console.error("Error in cleanup cron:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 },
    );
  }
}
