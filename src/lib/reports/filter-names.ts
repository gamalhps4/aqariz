import "server-only";

/**
 * PropertyPro - The names behind a list's other filters
 *
 * A file that says "Assigned to: cmg3x8…" tells whoever receives it nothing.
 * The owner, compound, building, unit, tenant, contract and agreement a list
 * was narrowed by are named by `describeAppliedFilters`
 * (lib/report-filters/describe.ts), through the reader's own scope; these
 * name the rest — a member of staff, a building or unit category — so the
 * block under a file's title can say who and what.
 */

import { db } from "@/lib/db/prisma";
import { joinFullName } from "@/lib/full-name";
import { categoryLabel, type CategoryKind } from "@/lib/property-categories";
import type { ReportLanguage } from "./labels";

/**
 * A member of staff's name — who a request is assigned to, who inspected —
 * or "" when there is no such person in the office.
 */
export async function staffName(id: string | null | undefined): Promise<string> {
  if (!id) return "";
  const user = await db.user.findFirst({
    where: { id },
    select: { firstName: true, lastName: true },
  });
  return joinFullName(user);
}

/**
 * A category's name in the reader's language, from the office's own list —
 * "Residential Tower", "برج سكني" — for the slug a building or unit stores.
 * A slug the list does not have (it was archived and purged) reads as itself.
 */
export async function categoryNamer(
  kind: CategoryKind,
  language: ReportLanguage,
): Promise<(slug: string | null | undefined) => string> {
  // Archived categories are still the name of the rows that carry them:
  // naming `deletedAt` at all opts out of the automatic soft-delete filter.
  const rows = await db.propertyCategory.findMany({
    where: { kind, deletedAt: undefined },
    select: { slug: true, nameEn: true, nameAr: true },
  });
  const bySlug = new Map(rows.map((row) => [row.slug, row]));
  return (slug) => {
    if (!slug) return "";
    const row = bySlug.get(slug);
    return row ? categoryLabel(row, language) : slug;
  };
}
