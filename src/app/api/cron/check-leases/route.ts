import { NextResponse } from "next/server";
import { db } from "@/lib/db/prisma";
import { leaseExpirationService } from "@/lib/services/lease-expiration.service";
import { releaseUnitsOfLapsedRenewals } from "@/lib/services/lease-lifecycle.service";
import { bypassOrgScope, runWithOrgContext } from "@/lib/tenancy/context";
import { rejectUnauthorizedCron, withCronLock } from "@/lib/cron/request";

export async function GET(req: Request) {
  const unauthorized = rejectUnauthorizedCron(req);
  if (unauthorized) return unauthorized;

  try {
    // Cron runs with no request org context. Enumerate the organizations
    // under an explicit bypass, then run the expiration pass per org so every
    // query and write stays scoped to that tenant (the old bypassed global
    // pass covered all orgs at once).
    const lock = await withCronLock("check-leases", async () => {
    const organizations = await bypassOrgScope(() =>
      db.organization.findMany({ select: { id: true } }),
    );

    const result = {
      processed: 0,
      errors: 0,
      details: [] as any[],
    };

    for (const organization of organizations) {
      try {
        const orgResult = await runWithOrgContext(
          { organizationId: organization.id, isPlatformAdmin: false },
          async () => {
            const expired = await leaseExpirationService.checkAndExpireLeases();
            // Units still held by contracts renewed as drafts under the old
            // rule, whose term is over and whose renewal never came into
            // force — see releaseUnitsOfLapsedRenewals. Its failure is
            // logged apart, so the expiry results above are still counted.
            try {
              await releaseUnitsOfLapsedRenewals();
            } catch (sweepError) {
              console.error(
                `Releasing units of lapsed renewals failed for organization ${organization.id}:`,
                sweepError,
              );
            }
            return expired;
          },
        );
        result.processed += orgResult.processed;
        result.errors += orgResult.errors;
        result.details.push(...orgResult.details);
      } catch (orgError: any) {
        // One broken org must not block the rest of the sweep.
        console.error(
          `Lease expiration check failed for organization ${organization.id}:`,
          orgError,
        );
        result.errors += 1;
        result.details.push({
          organizationId: organization.id,
          status: "error",
          message: orgError?.message ?? "Lease expiration check failed",
        });
      }
    }

    return result;
    });

    if (lock.skipped) {
      return NextResponse.json({
        success: true,
        skipped: true,
        message: "Previous lease check still running",
      });
    }

    return NextResponse.json({
      success: true,
      message: "Lease expiration check completed",
      data: lock.result,
    });
  } catch (error: any) {
    console.error("Error in lease expiration cron:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
