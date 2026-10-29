/**
 * PropertyPro SaaS - Cron request helpers
 *
 * Every /api/cron/* route is a public URL, so the only thing standing between
 * a scheduler and an attacker is CRON_SECRET. This centralises that check
 * (previously copy-pasted into each route) plus the per-organization sweep
 * pattern the tenant-scoped jobs need: a cron carries no request org context,
 * so it enumerates organizations under an explicit bypass and then runs the
 * per-tenant work inside that tenant's own context.
 */

import { createHash, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { basePrisma, db } from "@/lib/db/prisma";
import { bypassOrgScope, runWithOrgContext } from "@/lib/tenancy/context";

/** Constant-time string comparison — `!==` leaks length/prefix timing. */
function secretsMatch(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(providedBuffer, expectedBuffer);
}

/**
 * Returns a response to send back when the request is not an authorised cron
 * call, or null when the caller may proceed.
 */
export function rejectUnauthorizedCron(request: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { success: false, error: "Cron secret is not configured" },
      { status: 503 },
    );
  }
  const authorization = request.headers.get("authorization") ?? "";
  if (!secretsMatch(authorization, `Bearer ${secret}`)) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 },
    );
  }
  return null;
}

export interface CronLockResult<T> {
  /** True when another run already held this job's lock and we did nothing. */
  skipped: boolean;
  result?: T;
}

/** Stable 64-bit advisory-lock key from the job name. */
function advisoryKeyFor(jobName: string): bigint {
  const digest = createHash("sha256").update(`cron:${jobName}`).digest();
  // Signed 64-bit range for pg_try_advisory_xact_lock(bigint).
  return digest.readBigInt64BE(0);
}

/**
 * Serialize a cron job across instances with a Postgres advisory lock.
 *
 * Overlapping cron fires (a slow run still going when the next tick lands, or
 * two app instances both wired to the schedule) used to double-execute jobs
 * whose only guards were read-then-write checks. The transaction-scoped lock
 * (`pg_try_advisory_xact_lock`) is held for the duration of `job` and released
 * automatically on commit/rollback/disconnect — no unlock bookkeeping, no
 * leaked locks after a crash. The overlapping run skips instead of queueing:
 * a cron tick that finds the previous tick still running has nothing new to
 * do.
 *
 * The job runs INSIDE the lock-holding transaction callback but issues its
 * queries through the normal `db` client (its own connections) — the
 * transaction only carries the lock, so the generous timeout below bounds the
 * job's runtime, not a data transaction.
 */
export async function withCronLock<T>(
  jobName: string,
  job: () => Promise<T>,
  options?: { timeoutMs?: number },
): Promise<CronLockResult<T>> {
  const key = advisoryKeyFor(jobName);
  const timeout = options?.timeoutMs ?? 10 * 60_000;

  return basePrisma.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<Array<{ locked: boolean }>>`
        SELECT pg_try_advisory_xact_lock(${key}) AS locked
      `;
      if (!rows[0]?.locked) {
        console.warn(`Cron job "${jobName}" is already running — skipping.`);
        return { skipped: true } as CronLockResult<T>;
      }
      const result = await job();
      return { skipped: false, result };
    },
    { timeout, maxWait: 15_000 },
  );
}

export interface OrgSweepResult<T> {
  organizations: number;
  succeeded: number;
  failed: number;
  results: Array<{ organizationId: string; result?: T; error?: string }>;
}

/**
 * Run `job` once per active organization, each inside its own org context so
 * every query and write stays RLS-scoped to that tenant. One failing tenant
 * never aborts the sweep.
 */
export async function forEachOrganization<T>(
  job: (organizationId: string) => Promise<T>,
): Promise<OrgSweepResult<T>> {
  const organizations = await bypassOrgScope(() =>
    db.organization.findMany({
      where: { deletedAt: null, status: { not: "suspended" } },
      select: { id: true },
    }),
  );

  const sweep: OrgSweepResult<T> = {
    organizations: organizations.length,
    succeeded: 0,
    failed: 0,
    results: [],
  };

  for (const organization of organizations) {
    try {
      const result = await runWithOrgContext(
        { organizationId: organization.id, isPlatformAdmin: false },
        () => job(organization.id),
      );
      sweep.succeeded += 1;
      sweep.results.push({ organizationId: organization.id, result });
    } catch (error) {
      sweep.failed += 1;
      sweep.results.push({
        organizationId: organization.id,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      console.error(
        `Cron job failed for organization ${organization.id}:`,
        error,
      );
    }
  }

  return sweep;
}
