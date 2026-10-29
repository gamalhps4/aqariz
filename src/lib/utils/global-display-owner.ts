/**
 * PropertyPro - Organization display/branding owner (server-side)
 *
 * Display & branding is ONE per-organization setting managed by that org's
 * admins. Every reader (settings UI, login page, PWA manifest, emails,
 * invoice & receipt PDFs) resolves the SAME owner — the organization's oldest
 * active admin by ACCESS PROFILE. A permission group is never one, whatever
 * it has been ticked: a group holding "System settings" may change the
 * setting, but the row it changes is this owner's.
 *
 * Runs inside the caller's organization context. Callers with no org bound
 * (the apex marketing domain) get null and fall back to platform defaults —
 * which is also the fix for the Mongo-era behavior that resolved a single
 * GLOBAL owner across every tenant.
 */

import { db } from "@/lib/db/prisma";
import { resolveAccessProfile } from "@/lib/server-permissions";
import { MissingOrganizationContextError } from "@/lib/tenancy/context";

export async function resolveGlobalDisplayOwnerId(): Promise<string | null> {
  let activeUsers: Array<{ id: string; role: string }>;
  try {
    activeUsers = await db.user.findMany({
      where: { isActive: true },
      select: { id: true, role: true },
      orderBy: { createdAt: "asc" },
    });
  } catch (error) {
    if (error instanceof MissingOrganizationContextError) return null;
    throw error;
  }

  for (const activeUser of activeUsers) {
    const accessProfile = await resolveAccessProfile(activeUser.role);
    if (accessProfile.isAdmin) {
      return activeUser.id;
    }
  }

  return null;
}
