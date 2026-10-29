import "server-only";

import { db } from "@/lib/db/prisma";
import type { AuthenticatedAccessUser } from "@/lib/api-utils";

const STAFF_NOTIFICATION_MARKERS = [
  "admin",
  "admins",
  "manager",
  "managers",
  "staff",
  "landlord",
  "owner",
  "owners",
];

const TENANT_ACCOUNT_NOTIFICATION_TYPES = [
  "welcome",
  "account_activation",
  "password_reset",
];

type WhereFilter = Record<string, any>;

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

export function mergeNotificationFilters(
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

export interface VisibleNotificationFields {
  type?: string | null;
  metadata?: unknown;
}

export interface NotificationVisibility {
  /** Prisma where clause enforcing recipient scope (applied DB-side). */
  where: WhereFilter;
  /** True when rows must additionally pass `matches` (tenant callers). */
  isRestricted: boolean;
  /**
   * Metadata-based tenant visibility rules, evaluated in JS (the metadata
   * column is Json): staff-marked notifications are hidden and the rest must
   * relate to the tenant's own leases/payments/invoices/maintenance or be an
   * account-level notification type.
   */
  matches: (notification: VisibleNotificationFields) => boolean;
}

export async function buildNotificationVisibilityFilter(
  user: AuthenticatedAccessUser,
  tenantProfile?: any
): Promise<NotificationVisibility> {
  const recipientFilter: WhereFilter = { userId: user.id };

  if (!user.isTenant) {
    return { where: recipientFilter, isRestricted: false, matches: () => true };
  }

  const tenantIds = new Set<string>();
  for (const raw of [
    user.id,
    tenantProfile?.id,
    tenantProfile?._id,
    tenantProfile?.userId,
  ]) {
    const id = normalizeIdValue(raw);
    if (id) tenantIds.add(id);
  }
  const tenantIdList = [...tenantIds];

  const [leases, payments, maintenanceRequests] = await Promise.all([
    tenantIdList.length > 0
      ? db.lease.findMany({
          where: { tenantId: { in: tenantIdList }, deletedAt: null },
          select: { id: true },
        })
      : Promise.resolve([]),
    tenantIdList.length > 0
      ? db.payment.findMany({
          where: { tenantId: { in: tenantIdList }, deletedAt: null },
          select: { id: true, leaseId: true, invoiceId: true },
        })
      : Promise.resolve([]),
    tenantIdList.length > 0
      ? db.maintenanceRequest.findMany({
          where: { tenantId: { in: tenantIdList }, deletedAt: null },
          select: { id: true },
        })
      : Promise.resolve([]),
  ]);

  const leaseIds = new Set<string>(leases.map((lease) => lease.id));
  const paymentIds = new Set<string>();
  const invoiceIds = new Set<string>();
  const maintenanceRequestIds = new Set<string>(
    maintenanceRequests.map((request) => request.id)
  );

  for (const payment of payments) {
    paymentIds.add(payment.id);
    if (payment.leaseId) leaseIds.add(payment.leaseId);
    if (payment.invoiceId) invoiceIds.add(payment.invoiceId);
  }

  const isStaffMarker = (value: unknown): boolean =>
    typeof value === "string" && STAFF_NOTIFICATION_MARKERS.includes(value);

  const inSet = (value: unknown, set: Set<string>): boolean => {
    const id = normalizeIdValue(value);
    return id !== null && set.has(id);
  };

  const matches = (notification: VisibleNotificationFields): boolean => {
    const metadata =
      notification?.metadata &&
      typeof notification.metadata === "object" &&
      !Array.isArray(notification.metadata)
        ? (notification.metadata as Record<string, unknown>)
        : {};

    if (metadata.isLandlord === true) {
      return false;
    }

    if (isStaffMarker(metadata.audience) || isStaffMarker(metadata.recipientRole)) {
      return false;
    }

    return (
      inSet(metadata.tenantId, tenantIds) ||
      inSet(metadata.leaseId, leaseIds) ||
      inSet(metadata.paymentId, paymentIds) ||
      inSet(metadata.invoiceId, invoiceIds) ||
      inSet(metadata.maintenanceRequestId, maintenanceRequestIds) ||
      inSet(metadata.requestId, maintenanceRequestIds) ||
      (typeof notification.type === "string" &&
        TENANT_ACCOUNT_NOTIFICATION_TYPES.includes(notification.type))
    );
  };

  return { where: recipientFilter, isRestricted: true, matches };
}
