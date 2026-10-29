/**
 * PropertyPro SaaS - Plan usage
 *
 * One place that answers "how much of each limit is this organization using".
 * Enforcement, the customer billing screen and the platform over-limit report
 * all read from here, so a limit can never mean one thing when it blocks a
 * create and another when it's displayed.
 *
 * Must be called inside the organization's context (or a bypass with an
 * explicit organizationId), since every count is RLS-scoped.
 */

import { db } from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { bypassOrgScope, runWithOrgContext } from "@/lib/tenancy/context";
import { UserRole } from "@/types";
import type { PlanLimitKey } from "./plan-constants";
import { countQuotaMessagesThisMonth } from "@/lib/messaging/log";

export type PlanUsage = Record<PlanLimitKey, number>;

/** Documents store `fileSize` in bytes; limits are expressed in megabytes. */
const BYTES_PER_MB = 1024 * 1024;

/**
 * Start of the current calendar month, in UTC.
 *
 * `invoicesPerMonth` is the one limit measured over a window rather than over
 * live rows, so it needs a boundary. UTC keeps the reset instant identical for
 * every organization instead of drifting with the server's local zone.
 */
function startOfCurrentMonth(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * What counts as a billed staff seat.
 *
 * Exported because enforcement and reporting must never drift: when the
 * members check counted `role != TENANT` while this module counted something
 * else, a plan limit meant one thing at the wall and another on the invoice.
 * Property owners are excluded deliberately — an owner is a client of the
 * office reading their own buildings, not a member of it (see
 * lib/permission-catalog.ts), and the pricing page says as much.
 */
export function staffSeatWhere(): Prisma.UserWhereInput {
  return {
    role: { notIn: [UserRole.TENANT, UserRole.OWNER] },
    deletedAt: null,
  };
}

/** Live staff seats in the current organization context. */
export function countStaffSeats(): Promise<number> {
  return db.user.count({ where: staffSeatWhere() });
}

/** Renter accounts, which are unbilled but capped separately. */
export function countTenantAccounts(): Promise<number> {
  return db.user.count({ where: { role: UserRole.TENANT, deletedAt: null } });
}

export function countLeases(): Promise<number> {
  return db.lease.count({ where: { deletedAt: null } });
}

/** Invoices raised since the start of the current calendar month — the one
 * limit that resets rather than accumulating. */
export function countInvoicesThisMonth(): Promise<number> {
  return db.invoice.count({
    where: { deletedAt: null, createdAt: { gte: startOfCurrentMonth() } },
  });
}

export async function getPlanUsage(): Promise<PlanUsage> {
  const [
    properties,
    units,
    members,
    tenants,
    leases,
    documents,
    storageBytes,
    invoicesPerMonth,
    messagesPerMonth,
  ] = await Promise.all([
    db.property.count({ where: { deletedAt: null } }),
    db.unit.count({ where: { deletedAt: null } }),
    // Seats are staff accounts only — see staffSeatWhere.
    countStaffSeats(),
    countTenantAccounts(),
    countLeases(),
    db.document.count({ where: { deletedAt: null } }),
    db.document.aggregate({
      where: { deletedAt: null },
      _sum: { fileSize: true },
    }),
    countInvoicesThisMonth(),
    // SMS/WhatsApp through the platform's gateway (message_logs; 0 before
    // the log exists).
    countQuotaMessagesThisMonth(),
  ]);

  return {
    properties,
    units,
    members,
    tenants,
    leases,
    documents,
    storageMb: Math.round((storageBytes._sum.fileSize ?? 0) / BYTES_PER_MB),
    invoicesPerMonth,
    messagesPerMonth,
  };
}

/**
 * Refuse an upload that would push the organization past its storage plan, or
 * past its document count.
 *
 * Checked before the bytes go to R2 so a rejected upload costs no bandwidth
 * and leaves no orphaned object behind. `incomingFiles` matters for the same
 * reason `enforcePlanLimit` takes `adding`: a batch of 40 must not pass a
 * check that only asked whether the first one fitted.
 */
export async function enforceStorageLimit(
  organizationId: string,
  incomingBytes: number,
  incomingFiles = 1,
): Promise<void> {
  const { getPlanByKey } = await import("./plans");
  const { getEffectivePlan, PlanLimitError } = await import("./entitlements");
  const { formatPlanLimitValue } = await import("./plan-constants");

  const plan = await getPlanByKey(await getEffectivePlan(organizationId));
  if (!plan) return; // No plans configured — never block.

  const storageLimit = plan.limits.storageMb ?? null;
  const documentLimit = plan.limits.documents ?? null;
  if (storageLimit === null && documentLimit === null) return;

  const [current, documentCount] = await Promise.all([
    storageLimit === null
      ? Promise.resolve(null)
      : db.document.aggregate({
          where: { deletedAt: null },
          _sum: { fileSize: true },
        }),
    documentLimit === null
      ? Promise.resolve(null)
      : db.document.count({ where: { deletedAt: null } }),
  ]);

  if (documentLimit !== null && documentCount !== null) {
    if (documentCount + incomingFiles > documentLimit) {
      throw new PlanLimitError(
        `This upload would exceed the ${plan.name} plan's document limit (${formatPlanLimitValue(
          "documents",
          documentLimit,
        )}). Delete some files or upgrade your subscription to continue.`,
      );
    }
  }

  if (storageLimit !== null && current !== null) {
    const usedMb = (current._sum.fileSize ?? 0) / BYTES_PER_MB;
    const incomingMb = incomingBytes / BYTES_PER_MB;
    if (usedMb + incomingMb > storageLimit) {
      throw new PlanLimitError(
        `This upload would exceed the ${plan.name} plan's file storage limit (${formatPlanLimitValue(
          "storageMb",
          storageLimit,
        )}). Delete some files or upgrade your subscription to continue.`,
      );
    }
  }
}

/** Usage for an arbitrary organization — for platform-admin reporting, which
 * runs outside any single tenant's context. */
export function getPlanUsageForOrganization(
  organizationId: string,
): Promise<PlanUsage> {
  return runWithOrgContext(
    { organizationId, isPlatformAdmin: false },
    getPlanUsage,
  );
}

export interface OverLimitEntry {
  key: PlanLimitKey;
  limit: number;
  usage: number;
  over: number;
}

/**
 * Which limits the organization is currently past. Non-empty only after a
 * downgrade or a plan edit — `enforcePlanLimit` blocks *creation*, so usage
 * can only exceed a limit when the limit moves, never when the usage does.
 */
export function findOverLimits(
  usage: PlanUsage,
  limits: Record<PlanLimitKey, number | null>,
): OverLimitEntry[] {
  const entries: OverLimitEntry[] = [];
  for (const [key, limit] of Object.entries(limits) as Array<
    [PlanLimitKey, number | null]
  >) {
    if (limit === null) continue;
    const used = usage[key] ?? 0;
    if (used > limit) {
      entries.push({ key, limit, usage: used, over: used - limit });
    }
  }
  return entries;
}

/** Platform-admin sweep: every organization currently over any plan limit. */
export async function findOrganizationsOverLimit(): Promise<
  Array<{
    organizationId: string;
    name: string;
    slug: string;
    plan: string;
    status: string;
    overages: OverLimitEntry[];
  }>
> {
  const { getPlanByKey } = await import("./plans");
  const { getEffectivePlan } = await import("./entitlements");

  const organizations = await bypassOrgScope(() =>
    db.organization.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, slug: true, status: true },
    }),
  );

  const report = [];
  for (const organization of organizations) {
    try {
      const planKey = await runWithOrgContext(
        { organizationId: organization.id, isPlatformAdmin: false },
        () => getEffectivePlan(organization.id),
      );
      const plan = await getPlanByKey(planKey);
      if (!plan) continue;

      const usage = await getPlanUsageForOrganization(organization.id);
      const overages = findOverLimits(usage, plan.limits);
      if (overages.length > 0) {
        report.push({
          organizationId: organization.id,
          name: organization.name,
          slug: organization.slug,
          plan: planKey,
          status: organization.status,
          overages,
        });
      }
    } catch (error) {
      // One unreadable organization must not hide the rest of the report.
      console.error(
        `Over-limit check failed for organization ${organization.id}:`,
        error,
      );
    }
  }
  return report;
}
