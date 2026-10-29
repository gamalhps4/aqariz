import "server-only";

/**
 * PropertyPro SaaS - Error persistence
 *
 * Reported errors used to reach `console.error` and stop there, which meant
 * the admin error dashboard reported on nothing and a production incident
 * left no trail once the process recycled.
 *
 * Errors are **grouped by fingerprint** rather than appended: a render loop
 * throwing on every frame would otherwise write thousands of near-identical
 * rows. One row per distinct problem, with a counter and first/last-seen
 * timestamps, is what an operator actually needs.
 *
 * The table is bypass-only under RLS (see the error_log migration) because a
 * report can arrive before sign-in, when there is no organization to scope to.
 */

import { createHash } from "crypto";
import { authDb } from "@/lib/db/prisma";
import { bypassOrgScope } from "@/lib/tenancy/context";
import type { Prisma } from "@/generated/prisma/client";

export interface ReportedError {
  message: string;
  stack?: string;
  category?: string;
  severity?: string;
  digest?: string;
  path?: string;
  method?: string;
  userAgent?: string;
  userId?: string;
  userEmail?: string;
  organizationId?: string | null;
  metadata?: Record<string, unknown>;
}

const MAX_MESSAGE_LENGTH = 2_000;
const MAX_STACK_LENGTH = 20_000;

/**
 * Group key. Built from the shape of the failure, not the instance of it:
 * the same bug on the same route is one entry however many users hit it.
 * The first stack frame is included because one generic message ("Failed to
 * fetch") can come from several unrelated places.
 */
function fingerprint(error: ReportedError): string {
  const firstFrame =
    error.stack
      ?.split("\n")
      .map((line) => line.trim())
      .find((line) => line.startsWith("at ")) ?? "";

  return createHash("sha256")
    .update(
      [
        error.category ?? "unknown",
        error.message.slice(0, 300),
        error.path ?? "",
        firstFrame,
      ].join("|"),
    )
    .digest("hex")
    .slice(0, 32);
}

/** Record one error, merging it into its existing group when there is one. */
export async function recordError(error: ReportedError): Promise<void> {
  if (!error.message) return;

  const key = fingerprint(error);
  const now = new Date();

  await bypassOrgScope(async () => {
    const existing = await authDb.errorLog.findUnique({
      where: { fingerprint: key },
      select: { id: true },
    });

    if (existing) {
      await authDb.errorLog.update({
        where: { fingerprint: key },
        data: {
          occurrences: { increment: 1 },
          lastSeenAt: now,
          // A recurrence reopens the group: whatever was fixed, this isn't it.
          resolvedAt: null,
        },
      });
      return;
    }

    await authDb.errorLog.create({
      data: {
        fingerprint: key,
        message: error.message.slice(0, MAX_MESSAGE_LENGTH),
        stack: error.stack?.slice(0, MAX_STACK_LENGTH),
        category: error.category ?? "unknown",
        severity: error.severity ?? "medium",
        organizationId: error.organizationId ?? null,
        userId: error.userId ?? null,
        userEmail: error.userEmail ?? null,
        path: error.path ?? null,
        method: error.method ?? null,
        userAgent: error.userAgent?.slice(0, 500) ?? null,
        digest: error.digest ?? null,
        metadata: (error.metadata ?? {}) as Prisma.InputJsonValue,
        firstSeenAt: now,
        lastSeenAt: now,
      },
    });
  });
}

/** Never let error reporting itself throw into a request path. */
export async function recordErrorSafely(error: ReportedError): Promise<void> {
  try {
    await recordError(error);
  } catch (caught) {
    console.error("Failed to persist error report:", caught);
  }
}

export interface ErrorListFilters {
  severity?: string;
  category?: string;
  includeResolved?: boolean;
  page?: number;
  pageSize?: number;
}

export async function listErrors(filters: ErrorListFilters = {}) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 25));

  const where: Prisma.ErrorLogWhereInput = {
    ...(filters.severity && filters.severity !== "all"
      ? { severity: filters.severity }
      : {}),
    ...(filters.category && filters.category !== "all"
      ? { category: filters.category }
      : {}),
    ...(filters.includeResolved ? {} : { resolvedAt: null }),
  };

  return bypassOrgScope(async () => {
    const [rows, total, severityGroups] = await Promise.all([
      authDb.errorLog.findMany({
        where,
        orderBy: { lastSeenAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      authDb.errorLog.count({ where }),
      authDb.errorLog.groupBy({
        by: ["severity"],
        where: { resolvedAt: null },
        _count: { _all: true },
        _sum: { occurrences: true },
      }),
    ]);

    return {
      errors: rows,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
      summary: severityGroups.map((group) => ({
        severity: group.severity,
        groups: group._count._all,
        occurrences: group._sum.occurrences ?? 0,
      })),
    };
  });
}

/** Mark a group resolved. A new occurrence reopens it automatically. */
export async function resolveError(id: string): Promise<boolean> {
  return bypassOrgScope(async () => {
    const result = await authDb.errorLog.updateMany({
      where: { id, resolvedAt: null },
      data: { resolvedAt: new Date() },
    });
    return result.count > 0;
  });
}

/** Retention purge, called from the cleanup cron. */
export async function purgeResolvedErrors(
  olderThanDays = 30,
): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  return bypassOrgScope(async () => {
    const result = await authDb.errorLog.deleteMany({
      where: { resolvedAt: { lt: cutoff } },
    });
    return result.count;
  });
}
