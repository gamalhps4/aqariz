"use client";

/**
 * PropertyPro - Naming a role on screen
 *
 * `roleName(role)` is what a screen prints for a user's role: a permission
 * group by its label, or its Arabic name on an Arabic screen, and a built-in
 * role by the catalogue's wording (lib/role-display.ts). The groups' names
 * come from /api/roles/names, asked once and shared by every screen mounted
 * in the same session; a caller that is not staff gets none and sees the
 * built-in names only, which are all it could meet.
 */

import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/lib/auth-client";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import {
  isBuiltInRoleName,
  normalizeRoleName,
  resolveSystemRole,
} from "@/lib/permissions-manager";
import { UserRole } from "@/types";
import { roleDisplayName, type GroupNames } from "@/lib/role-display";
import { useRolePermissions } from "./useRolePermissions";

export interface StoredGroupNames extends GroupNames {
  name: string;
  isActive: boolean;
}

const CACHE_DURATION = 5 * 60 * 1000;

let cached: { at: number; groups: Map<string, StoredGroupNames> } | null = null;
let pending: Promise<Map<string, StoredGroupNames>> | null = null;

const NO_GROUPS = new Map<string, StoredGroupNames>();

async function loadGroupNames(): Promise<Map<string, StoredGroupNames>> {
  if (cached && Date.now() - cached.at < CACHE_DURATION) {
    return cached.groups;
  }
  if (pending) return pending;

  pending = (async () => {
    const response = await fetch("/api/roles/names");
    if (!response.ok) {
      // Not staff, or the request failed: no group names, which leaves the
      // built-in roles named and a group by the words of its key. Remembered
      // like an answer, so a tenant's every page does not ask again.
      cached = { at: Date.now(), groups: NO_GROUPS };
      return NO_GROUPS;
    }
    const body = await response.json();
    const groups: StoredGroupNames[] = body?.data?.groups ?? [];
    const map = new Map(groups.map((group) => [group.name, group]));
    cached = { at: Date.now(), groups: map };
    return map;
  })().finally(() => {
    pending = null;
  });

  return pending;
}

/** Forget the names — after a group is created, renamed or deleted. */
export function clearGroupNamesCache(): void {
  cached = null;
}

export function useGroupNames() {
  const { t, language } = useLocalizationContext();
  const { data: session } = useSession();
  const [groups, setGroups] = useState<Map<string, StoredGroupNames>>(
    () => cached?.groups ?? NO_GROUPS,
  );

  // Owners and tenants are not staff: the names are not theirs to read, and
  // the screens they share with staff name only built-in roles for them.
  const sessionRole = resolveSystemRole(session?.user?.role);
  const isClient =
    sessionRole === UserRole.OWNER || sessionRole === UserRole.TENANT;

  useEffect(() => {
    if (!session?.user || isClient) return;
    let cancelled = false;
    loadGroupNames()
      .then((loaded) => {
        if (!cancelled) setGroups(loaded);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [session?.user, isClient]);

  /**
   * What to print for `role`. `known` is a group's names the caller already
   * holds — a row that came with them — and is used when the shared list has
   * not answered yet.
   */
  const roleName = useCallback(
    (role: string | null | undefined, known?: GroupNames | null) => {
      const key = normalizeRoleName(role);
      const group = (key ? groups.get(key) : undefined) ?? known ?? null;
      return roleDisplayName(role, { group, language, t });
    },
    [groups, language, t],
  );

  return { roleName, groups };
}

/**
 * What the signed-in person's own role is called — the profile badge, the
 * account menu. Read from the lookup the permission hook already makes for
 * their group, so it costs no request of its own.
 */
export function useOwnRoleName(): string {
  const { data: session } = useSession();
  const { roleInfo, storedGroup, isLoading } = useRolePermissions();
  const { t, language } = useLocalizationContext();
  const role = session?.user?.role;

  // A group's key is never shown, even for the moment before its names
  // arrive.
  if (!isBuiltInRoleName(role) && isLoading) return "";
  const group = storedGroup === "active" && roleInfo && !roleInfo.isSystem
    ? { label: roleInfo.label, labelAr: roleInfo.labelAr }
    : null;
  return roleDisplayName(role, { group, language, t });
}
