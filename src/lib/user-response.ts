import "server-only";

import { db } from "@/lib/db/prisma";
import type { GroupNames } from "@/lib/role-display";

/**
 * PropertyPro - A user row as the employee screens are sent it
 *
 * Columns safe to return to user_view / user_management callers. The full row
 * also carries the SSN envelope, the integrations JSON and the Stripe
 * identity, none of which belong in a response — the detail route has always
 * projected with this, and the list now does too.
 */
export const USER_RESPONSE_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  name: true,
  phone: true,
  organizationId: true,
  role: true,
  avatar: true,
  bio: true,
  location: true,
  city: true,
  website: true,
  address: true,
  isActive: true,
  emailVerified: true,
  twoFactorEnabled: true,
  lastLogin: true,
  isLocked: true,
  lockedUntil: true,
  failedLoginAttempts: true,
  dateOfBirth: true,
  emergencyContacts: true,
  backgroundCheckStatus: true,
  tenantStatus: true,
  applicationDate: true,
  applicationNotes: true,
  currentLeaseId: true,
  moveInDate: true,
  moveOutDate: true,
  statusHistory: true,
  preferredContactMethod: true,
  lastStatusUpdate: true,
  notificationPreferences: true,
  // Whether the employee sees only their assigned buildings — the list marks
  // them. Which buildings stays with the Access tab.
  scopeRestricted: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** The organization's groups by stored name, for naming a user's role. */
export async function loadGroupNames(): Promise<Map<string, GroupNames>> {
  const rows = await db.role.findMany({
    where: { isSystem: false },
    select: { name: true, label: true, labelAr: true, deletedAt: true },
    orderBy: [{ deletedAt: { sort: "desc", nulls: "first" } }],
  });
  const names = new Map<string, GroupNames>();
  for (const row of rows) {
    if (!names.has(row.name)) {
      names.set(row.name, { label: row.label, labelAr: row.labelAr });
    }
  }
  return names;
}

/**
 * `row` with its role's names beside it. Null for a built-in role, which a
 * screen names from the catalogue in the reader's language.
 */
export function withRoleNames<T extends { role: string }>(
  row: T,
  groups: ReadonlyMap<string, GroupNames>,
): T & { roleLabel: string | null; roleLabelAr: string | null } {
  const group = groups.get(row.role);
  return {
    ...row,
    roleLabel: group?.label ?? null,
    roleLabelAr: group?.labelAr ?? null,
  };
}
