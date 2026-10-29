/**
 * PropertyPro - What a role is called on screen
 *
 * A user row holds a role *name*, and for a permission group that name is a
 * key the server made ("group", "group_2", "sales_marketing") — it is what the
 * user pages, the profile badge, the invitation list and the platform console
 * were printing. A group is called by its label, or by its Arabic name on an
 * Arabic screen when it has one; a built-in role by the catalogue's wording
 * in the reader's language.
 *
 * No React and no database here, so every screen and export can share it.
 */

import { UserRole } from "@/types";
import { resolveSystemRole } from "@/lib/permissions-manager";

/** A permission group's two names. */
export interface GroupNames {
  label: string;
  labelAr?: string | null;
}

type Translate = (key: string, options?: { defaultValue?: string }) => string;

/** The English the catalogue falls back to for each built-in role. */
export const BUILT_IN_ROLE_LABELS: Readonly<Record<UserRole, string>> = {
  [UserRole.SUPER_ADMIN]: "Platform Administrator",
  [UserRole.ADMIN]: "Property Administrator",
  [UserRole.MANAGER]: "Property Manager",
  [UserRole.OWNER]: "Property Owner",
  [UserRole.TENANT]: "Tenant",
};

/** A group's name for a reader of `language`. */
export function groupDisplayName(group: GroupNames, language?: string): string {
  const arabic = group.labelAr?.trim();
  if (arabic && language?.toLowerCase().startsWith("ar")) {
    return arabic;
  }
  return group.label.trim() || arabic || "";
}

/** A key as words, for a name nothing more is known about. */
function humanise(role: string): string {
  return role
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/**
 * What to print for a user's role.
 *
 * `group` is the stored group under that name when the caller has it. It
 * wins over the alias table for the same reason it does on the server
 * (RoleLookup in permissions-manager): a group stored under a name that
 * spells a built-in role is that group, not the role.
 */
export function roleDisplayName(
  role: string | null | undefined,
  options: { group?: GroupNames | null; language?: string; t?: Translate } = {},
): string {
  const { group, language, t } = options;
  if (group) {
    const name = groupDisplayName(group, language);
    if (name) return name;
  }

  const value = role?.trim();
  if (!value) {
    return t ? t("labels.unknownRole", { defaultValue: "Unknown role" }) : "Unknown role";
  }

  const systemRole = resolveSystemRole(value);
  if (systemRole) {
    const english = BUILT_IN_ROLE_LABELS[systemRole];
    return t
      ? t(`admin.roles.defaultRoles.${systemRole}.label`, { defaultValue: english })
      : english;
  }

  return humanise(value);
}
