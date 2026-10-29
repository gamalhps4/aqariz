/**
 * PropertyPro - Who may do what with listings
 *
 * The rights, named once, so a route, a screen and a test cannot disagree.
 * Each ability is "any of these": the specific right, or the umbrella
 * (`listing_management`) that every route accepts in its place, which is what
 * lets a group hold "everything about listings" without listing eight boxes —
 * and what keeps working for rights added later.
 *
 * Publishing and the inbox are rights of their own, not corners of "edit":
 * publishing puts the office's words and a licence number in front of the
 * public, and the inbox holds strangers' phone numbers. A group that may write
 * the ads need not be the one that may print them.
 *
 * The table is typed against the catalogue, so a misspelt right does not
 * compile.
 */

import type { SystemPermission } from "@/lib/permission-catalog";
import { hasAnyPermission } from "@/lib/permissions-manager";

export const LISTING_ACCESS = {
  view: ["listing_view", "listing_management"],
  create: ["listing_create", "listing_management"],
  edit: ["listing_edit", "listing_management"],
  publish: ["listing_publish", "listing_management"],
  archive: ["listing_delete", "listing_management"],
  inquiries: ["listing_inquiries", "listing_management"],
  /**
   * The office's brokerage licence and default contacts: a compliance detail,
   * so the company-settings right opens it as well as the module's umbrella.
   */
  settings: ["listing_management", "company_settings"],
} as const satisfies Record<string, readonly SystemPermission[]>;

export type ListingAbility = keyof typeof LISTING_ACCESS;

/** A mutable copy, for the API wrappers' `string | string[]` parameter. */
export function accessList(ability: ListingAbility): string[] {
  return [...LISTING_ACCESS[ability]];
}

/** Whether this set of permissions holds the ability. */
export function can(
  held: readonly string[] | null | undefined,
  ability: ListingAbility,
): boolean {
  return hasAnyPermission(held ?? [], LISTING_ACCESS[ability]);
}

/** Every ability, as the screens read them. */
export interface ListingAbilities {
  view: boolean;
  create: boolean;
  edit: boolean;
  publish: boolean;
  archive: boolean;
  inquiries: boolean;
  settings: boolean;
  /** Carrying the lists out as a file — decided by the export library's own rule. */
  export: boolean;
}

export function listingAbilities(
  held: readonly string[] | null | undefined,
  exportAllowed = false,
): ListingAbilities {
  return {
    view: can(held, "view"),
    create: can(held, "create"),
    edit: can(held, "edit"),
    publish: can(held, "publish"),
    archive: can(held, "archive"),
    inquiries: can(held, "inquiries"),
    settings: can(held, "settings"),
    export: exportAllowed,
  };
}

/** Any right in the module: the one a route that serves several actions needs to get in. */
export function anyListingRight(
  held: readonly string[] | null | undefined,
): boolean {
  return (Object.keys(LISTING_ACCESS) as ListingAbility[]).some((ability) =>
    can(held, ability),
  );
}
