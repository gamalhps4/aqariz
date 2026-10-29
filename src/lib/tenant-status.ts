/**
 * PropertyPro - Tenant status state machine (Prisma)
 *
 * Replaces the Mongoose User model's tenant-status instance methods
 * (changeStatus/approveApplication/rejectApplication/moveIn/moveOut) and the
 * `name` derivation middleware. Routes call these helpers instead of the old
 * document methods.
 */

import { db, runWithOrgTransaction } from "@/lib/db/prisma";
import type { Prisma, User } from "@/generated/prisma/client";
import { LeaseStatus } from "@/types";
import {
  applyLeaseStatusSideEffectsTx,
  resyncPropertyDerivedStatus,
} from "@/lib/services/lease-lifecycle.service";

export const TENANT_STATUS_TRANSITIONS: Record<string, string[]> = {
  application_submitted: ["under_review", "approved", "terminated"],
  under_review: ["approved", "terminated"],
  approved: ["active", "terminated"],
  active: ["inactive", "moved_out", "terminated"],
  inactive: ["active", "moved_out", "terminated"],
  moved_out: ["terminated"],
  terminated: [], // Terminal state
};

export function getAvailableTenantTransitions(
  currentStatus?: string | null
): string[] {
  return TENANT_STATUS_TRANSITIONS[currentStatus || ""] || [];
}

/** Mirrors the old `displayStatus` virtual. */
export function tenantDisplayStatus(user: {
  role: string;
  tenantStatus?: string | null;
}): string | null {
  if (user.role !== "tenant") return null;

  const statusMap: Record<string, string> = {
    application_submitted: "Application Submitted",
    under_review: "Under Review",
    approved: "Approved",
    active: "Active Tenant",
    inactive: "Inactive",
    moved_out: "Moved Out",
    terminated: "Terminated",
  };

  return statusMap[user.tenantStatus || ""] || "Unknown Status";
}

/** Mirrors the old `statusColor` virtual. */
export function tenantStatusColor(user: {
  role: string;
  tenantStatus?: string | null;
}): string | null {
  if (user.role !== "tenant") return null;

  const colorMap: Record<string, string> = {
    application_submitted: "secondary",
    under_review: "outline",
    approved: "default",
    active: "default",
    inactive: "secondary",
    moved_out: "secondary",
    terminated: "destructive",
  };

  return colorMap[user.tenantStatus || ""] || "outline";
}

export interface TenantStatusChangeInput {
  newStatus: string;
  changedBy: string;
  reason?: string;
  notes?: string;
  moveDate?: Date;
  /** Extra column writes applied in the same update (e.g. moveIn bookkeeping). */
  extraData?: Prisma.UserUpdateInput;
}

/**
 * Validates and applies a tenant status transition, mirroring the old
 * User.changeStatus instance method:
 *  - transition must be allowed by TENANT_STATUS_TRANSITIONS (throws the same
 *    error message otherwise),
 *  - appends { status, changedBy, changedAt, reason, notes } to statusHistory,
 *  - sets lastStatusUpdate,
 *  - approved -> backgroundCheckStatus "approved" + backgroundCheckCompletedAt,
 *  - terminated -> backgroundCheckStatus "rejected",
 *  - active + moveDate -> moveInDate, moved_out + moveDate -> moveOutDate.
 */
export async function changeTenantStatus(
  tenant: Pick<User, "id" | "role" | "tenantStatus"> & {
    statusHistory: unknown;
  },
  input: TenantStatusChangeInput
): Promise<User> {
  if (tenant.role !== "tenant") {
    throw new Error("Only tenants can have status changes");
  }

  const currentStatus = tenant.tenantStatus || "application_submitted";
  if (!TENANT_STATUS_TRANSITIONS[currentStatus]?.includes(input.newStatus)) {
    throw new Error(
      `Invalid status transition from ${currentStatus} to ${input.newStatus}`
    );
  }

  const history = [
    ...(((tenant.statusHistory as unknown[]) ?? []) as unknown[]),
    {
      status: input.newStatus,
      changedBy: input.changedBy,
      changedAt: new Date(),
      reason: input.reason || "",
      notes: input.notes || "",
    },
  ];

  const data: Prisma.UserUpdateInput = {
    ...(input.extraData ?? {}),
    tenantStatus: input.newStatus,
    statusHistory: history as Prisma.InputJsonValue,
    lastStatusUpdate: new Date(),
  };

  if (input.newStatus === "approved") {
    data.backgroundCheckStatus = "approved";
    data.backgroundCheckCompletedAt = new Date();
  } else if (input.newStatus === "terminated") {
    data.backgroundCheckStatus = "rejected";
  }

  if (input.newStatus === "active" && input.moveDate) {
    data.moveInDate = input.moveDate;
  } else if (input.newStatus === "moved_out" && input.moveDate) {
    data.moveOutDate = input.moveDate;
  }

  const endsTenancy =
    input.newStatus === "moved_out" || input.newStatus === "terminated";
  const affectedPropertyIds = new Set<string>();

  const updated = await runWithOrgTransaction(async (tx) => {
    // Claim the current status: two concurrent transitions used to both pass
    // validation on the same stale row, and one statusHistory entry was
    // silently lost.
    const claimed = await tx.user.updateMany({
      where: {
        id: tenant.id,
        tenantStatus: tenant.tenantStatus ?? null,
        deletedAt: null,
      },
      data: data as Prisma.UserUpdateManyMutationInput,
    });
    if (claimed.count === 0) {
      throw new Error("Tenant status was changed by another process");
    }

    // Ending the tenancy must end its leases: marking a tenant moved_out
    // previously left the Lease ACTIVE and the Unit occupied by the departed
    // tenant — occupancy metrics and rent generation kept running against
    // them until someone separately terminated the lease.
    if (endsTenancy) {
      const openLeases = await tx.lease.findMany({
        where: {
          tenantId: tenant.id,
          status: { in: [LeaseStatus.ACTIVE, LeaseStatus.PENDING] },
          deletedAt: null,
        },
      });

      for (const lease of openLeases) {
        const terminated = await tx.lease.update({
          where: { id: lease.id },
          data: {
            status: LeaseStatus.TERMINATED,
            terminatedDate: input.moveDate ?? new Date(),
            terminatedById: input.changedBy,
            terminationReason:
              input.reason || `Tenant status changed to ${input.newStatus}`,
          },
        });
        await applyLeaseStatusSideEffectsTx(tx, terminated, {
          statusChanged: true,
        });
        affectedPropertyIds.add(lease.propertyId);
      }
    }

    const fresh = await tx.user.findFirst({ where: { id: tenant.id } });
    if (!fresh) throw new Error("Tenant disappeared during status change");
    return fresh;
  });

  // Property derived status is recomputable — refreshed best-effort.
  for (const propertyId of affectedPropertyIds) {
    await resyncPropertyDerivedStatus(propertyId);
  }

  return updated as User;
}

/**
 * users.name derivation: any write changing firstName/lastName must also set
 * `name` (Better Auth reads it). Compose from the incoming values, falling
 * back to the existing ones for a partial update.
 */
export function withUserNameDerivation<
  T extends { firstName?: unknown; lastName?: unknown }
>(
  data: T,
  existing?: { firstName?: string | null; lastName?: string | null }
): T & { name?: string } {
  if (data.firstName === undefined && data.lastName === undefined) {
    return data;
  }

  const composed = [
    (data.firstName as string | undefined) ?? existing?.firstName,
    (data.lastName as string | undefined) ?? existing?.lastName,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();

  return composed ? { ...data, name: composed } : data;
}

/**
 * Replaces Mongoose populate("statusHistory.changedBy"): swaps each entry's
 * changedBy id for { id, firstName, lastName } when the user can be resolved.
 */
export async function populateStatusHistory(
  entries: unknown[]
): Promise<unknown[]> {
  const list = Array.isArray(entries) ? entries : [];
  const ids = [
    ...new Set(
      list
        .map((entry) => {
          const changedBy = (entry as { changedBy?: unknown })?.changedBy;
          if (typeof changedBy === "string") return changedBy;
          const record = changedBy as { id?: string; _id?: string } | null;
          return record?.id ?? record?._id ?? null;
        })
        .filter((id): id is string => Boolean(id))
    ),
  ];

  if (ids.length === 0) return list;

  const users = await db.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, firstName: true, lastName: true },
  });
  const byId = new Map(users.map((user) => [user.id, user]));

  return list.map((entry) => {
    const record = entry as { changedBy?: unknown };
    const changedBy = record?.changedBy;
    const key =
      typeof changedBy === "string"
        ? changedBy
        : ((changedBy as { id?: string; _id?: string } | null)?.id ??
          (changedBy as { id?: string; _id?: string } | null)?._id);
    const user = key ? byId.get(key) : undefined;
    return user ? { ...(entry as object), changedBy: user } : entry;
  });
}
