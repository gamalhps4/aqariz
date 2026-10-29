import "server-only";

import { db } from "@/lib/db/prisma";
import type { AuthenticatedAccessUser } from "@/lib/api-utils";

type WhereFilter = Record<string, any>;

export function mergeInboxFilters(
  ...filters: Array<WhereFilter | null | undefined>
): WhereFilter {
  const compactFilters = filters.filter(Boolean) as WhereFilter[];

  if (compactFilters.length === 0) {
    return {};
  }

  if (compactFilters.length === 1) {
    return compactFilters[0];
  }

  return { AND: compactFilters };
}

function normalizeIdValue(value: unknown): string | null {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "object") {
    const candidate =
      (value as { id?: unknown }).id ?? (value as { _id?: unknown })._id;
    if (candidate) {
      return normalizeIdValue(candidate);
    }
    if (typeof (value as { toString?: () => string }).toString === "function") {
      const stringValue = String(value);
      return stringValue && stringValue !== "[object Object]"
        ? stringValue
        : null;
    }
  }

  return null;
}

export function getTenantIdentityIds(
  user: AuthenticatedAccessUser,
  tenantProfile?: any
): string[] {
  const ids = [
    user.id,
    tenantProfile?.id,
    tenantProfile?._id,
    tenantProfile?.userId,
  ]
    .map(normalizeIdValue)
    .filter((id): id is string => Boolean(id));

  return [...new Set(ids)];
}

export function tenantOwnsRecord(
  tenantValue: unknown,
  tenantIds: string[]
): boolean {
  const recordTenantId = normalizeIdValue(tenantValue);

  if (!recordTenantId) {
    return false;
  }

  return tenantIds.some((tenantId) => tenantId === recordTenantId);
}

// buildTenantTicketFilter used to live here. The ticket rule now has one
// home in lib/db/scopes.ts (ticketScope / ticketAllows), which the tickets
// routes and the sidebar counter share; keeping a second spelling of it here
// only invited the two to drift.

function activeAnnouncementFilter(now = new Date()): WhereFilter {
  return {
    status: "published",
    AND: [
      { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      { OR: [{ scheduledFor: null }, { scheduledFor: { lte: now } }] },
    ],
  };
}

async function getTenantPropertyIds(tenantIds: string[]): Promise<string[]> {
  if (tenantIds.length === 0) {
    return [];
  }

  const leases = await db.lease.findMany({
    where: { tenantId: { in: tenantIds }, deletedAt: null },
    select: { propertyId: true },
  });

  return [
    ...new Set(
      leases
        .map((lease) => lease.propertyId)
        .filter((id): id is string => Boolean(id))
    ),
  ];
}

export interface AnnouncementAudienceFields {
  targetAudience?: unknown;
}

export interface AnnouncementVisibility {
  /** Prisma where clause: soft-delete plus the active publish window. */
  where: WhereFilter;
  /** True when rows must additionally pass `matches` (non-staff callers). */
  isRestricted: boolean;
  /**
   * Audience targeting predicate — the `targetAudience` Json is filtered in
   * JS (includeAll, roles, userIds, tenantIds, propertyIds), replacing the
   * old Mongo dot-path clauses.
   */
  matches: (announcement: AnnouncementAudienceFields) => boolean;
}

export async function buildAnnouncementVisibilityFilter(
  user: AuthenticatedAccessUser,
  tenantProfile?: any,
  options: { activeOnly?: boolean } = {}
): Promise<AnnouncementVisibility> {
  const { activeOnly = true } = options;
  const clauses: WhereFilter[] = [{ deletedAt: null }];

  if (activeOnly) {
    clauses.push(activeAnnouncementFilter());
  }

  const where = mergeInboxFilters(...clauses);

  if (user.isCompanyStaff) {
    return { where, isRestricted: false, matches: () => true };
  }

  const userId = normalizeIdValue(user.id);
  const tenantIds = getTenantIdentityIds(user, tenantProfile);
  const propertyIds = await getTenantPropertyIds(tenantIds);
  const roleValues = [
    user.role,
    user.originalRole,
    user.normalizedRole,
    user.systemRole,
  ]
    .filter(Boolean)
    .map(String);

  const toIdList = (value: unknown): string[] =>
    Array.isArray(value)
      ? (value
          .map(normalizeIdValue)
          .filter((id): id is string => Boolean(id)) as string[])
      : [];

  const matches = (announcement: AnnouncementAudienceFields): boolean => {
    const audience =
      announcement?.targetAudience &&
      typeof announcement.targetAudience === "object" &&
      !Array.isArray(announcement.targetAudience)
        ? (announcement.targetAudience as Record<string, unknown>)
        : {};

    if (audience.includeAll === true) {
      return true;
    }

    const audienceRoles = Array.isArray(audience.roles)
      ? audience.roles.map(String)
      : [];
    if (
      roleValues.length > 0 &&
      audienceRoles.some((role) => roleValues.includes(role))
    ) {
      return true;
    }

    if (userId && toIdList(audience.userIds).includes(userId)) {
      return true;
    }

    if (
      tenantIds.length > 0 &&
      toIdList(audience.tenantIds).some((id) => tenantIds.includes(id))
    ) {
      return true;
    }

    if (
      propertyIds.length > 0 &&
      toIdList(audience.propertyIds).some((id) => propertyIds.includes(id))
    ) {
      return true;
    }

    return false;
  };

  return { where, isRestricted: true, matches };
}
