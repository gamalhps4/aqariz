/**
 * PropertyPro - Property & unit category catalogue
 *
 * Replaces the hard-coded `PropertyType` enum and the inline `unitType` union
 * with a per-organization, extendable list. `Property.type` and
 * `Unit.unitType` keep storing a slug string, so the category table supplies
 * the *choices* without owning the data — existing rows, filters and indexes
 * are untouched.
 *
 * Defaults are seeded lazily (`ensureDefaultCategories`) rather than by a
 * backfill migration, so organizations that predate the table pick them up on
 * first read and newly added defaults reach existing organizations too.
 */

import { db } from "@/lib/db/prisma";

export type CategoryKind = "property" | "unit";

export const CATEGORY_KINDS: readonly CategoryKind[] = [
  "property",
  "unit",
] as const;

export function isCategoryKind(value: unknown): value is CategoryKind {
  return value === "property" || value === "unit";
}

export interface CategorySeed {
  slug: string;
  nameEn: string;
  nameAr: string;
}

/**
 * Property categories required by the Saudi scope, in the order the client
 * listed them, followed by the pre-existing types so properties created
 * before this table still resolve to a label instead of a raw slug.
 */
export const DEFAULT_PROPERTY_CATEGORIES: readonly CategorySeed[] = [
  { slug: "villa", nameEn: "Villa", nameAr: "فيلا" },
  { slug: "apartment", nameEn: "Apartment", nameAr: "شقة" },
  { slug: "duplex", nameEn: "Duplex", nameAr: "دوبلكس" },
  { slug: "studio", nameEn: "Studio", nameAr: "استوديو" },
  { slug: "floor", nameEn: "Floor", nameAr: "دور" },
  { slug: "annex", nameEn: "Annex", nameAr: "ملحق" },
  { slug: "chalet", nameEn: "Chalet", nameAr: "شاليه" },
  { slug: "residential_unit", nameEn: "Residential Unit", nameAr: "وحدة سكنية" },
  { slug: "floor_with_annex", nameEn: "Floor with Annex", nameAr: "دور مع ملحق" },
  { slug: "hotel", nameEn: "Hotel", nameAr: "فندق" },
  {
    slug: "residential_building",
    nameEn: "Residential Building",
    nameAr: "عمارة سكنية",
  },
  {
    slug: "residential_tower",
    nameEn: "Residential Tower",
    nameAr: "برج سكني",
  },
  {
    slug: "attached_apartment",
    nameEn: "Attached Apartment",
    nameAr: "شقة ملحقة",
  },
  { slug: "penthouse_villa", nameEn: "Penthouse Villa", nameAr: "فيلا بنتهاوس" },
  { slug: "driver_room", nameEn: "Driver Room", nameAr: "غرفة سائق" },
  { slug: "room", nameEn: "Room", nameAr: "غرفة" },
  {
    slug: "apartment_with_annex",
    nameEn: "Apartment with Annex",
    nameAr: "شقة مع ملحق",
  },
  {
    slug: "other_residential",
    nameEn: "Other - Residential",
    nameAr: "أخرى - سكني",
  },
  // Legacy PropertyType values. Kept so historical rows keep a readable label;
  // an organization that does not want them offered can deactivate them.
  { slug: "house", nameEn: "House", nameAr: "منزل" },
  { slug: "condo", nameEn: "Condo", nameAr: "شقة تمليك" },
  { slug: "townhouse", nameEn: "Townhouse", nameAr: "تاون هاوس" },
  { slug: "commercial", nameEn: "Commercial", nameAr: "تجاري" },
  { slug: "office", nameEn: "Office", nameAr: "مكتب" },
  { slug: "retail", nameEn: "Retail", nameAr: "محل تجاري" },
] as const;

/**
 * Unit types available inside one building. The scope calls for a single
 * building to mix apartments, rooms, floors and shops — each with its own
 * price, status, contracts and payments, which units already model.
 */
export const DEFAULT_UNIT_CATEGORIES: readonly CategorySeed[] = [
  { slug: "apartment", nameEn: "Apartment", nameAr: "شقة" },
  { slug: "room", nameEn: "Room", nameAr: "غرفة" },
  { slug: "floor", nameEn: "Floor", nameAr: "دور" },
  { slug: "shop", nameEn: "Shop", nameAr: "محل" },
  { slug: "studio", nameEn: "Studio", nameAr: "استوديو" },
  { slug: "office", nameEn: "Office", nameAr: "مكتب" },
  { slug: "showroom", nameEn: "Showroom", nameAr: "معرض" },
  { slug: "warehouse", nameEn: "Warehouse", nameAr: "مستودع" },
  { slug: "annex", nameEn: "Annex", nameAr: "ملحق" },
  { slug: "villa", nameEn: "Villa", nameAr: "فيلا" },
  { slug: "duplex", nameEn: "Duplex", nameAr: "دوبلكس" },
  { slug: "penthouse", nameEn: "Penthouse", nameAr: "بنتهاوس" },
  { slug: "loft", nameEn: "Loft", nameAr: "لوفت" },
  { slug: "house", nameEn: "House", nameAr: "منزل" },
  { slug: "storage", nameEn: "Storage", nameAr: "مخزن" },
  { slug: "parking", nameEn: "Parking", nameAr: "موقف" },
] as const;

export function defaultsFor(kind: CategoryKind): readonly CategorySeed[] {
  return kind === "unit"
    ? DEFAULT_UNIT_CATEGORIES
    : DEFAULT_PROPERTY_CATEGORIES;
}

/** Fallback used when a stored slug has no matching category row. */
export const FALLBACK_PROPERTY_CATEGORY = "apartment";
export const FALLBACK_UNIT_CATEGORY = "apartment";

/**
 * Normalise free text into a slug usable as `Property.type` / `Unit.unitType`.
 * Arabic and other non-ASCII names are allowed through so an organization can
 * add "غرفة سائق" without the slug collapsing to an empty string.
 */
export function toCategorySlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s/-]+/g, "_")
    .replace(/[^\p{L}\p{N}_]/gu, "")
    .replace(/_{2,}/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

export interface CategoryOption {
  id: string;
  kind: CategoryKind;
  slug: string;
  nameEn: string;
  nameAr: string | null;
  description: string | null;
  isSystem: boolean;
  isActive: boolean;
  sortOrder: number;
}

/** Pick the label for a locale, falling back to English then to the slug. */
export function categoryLabel(
  category: Pick<CategoryOption, "slug" | "nameEn" | "nameAr">,
  language?: string,
): string {
  if (language?.toLowerCase().startsWith("ar") && category.nameAr) {
    return category.nameAr;
  }
  return category.nameEn || category.slug;
}

/**
 * Insert any default categories the organization is missing.
 *
 * Idempotent and safe to call concurrently: the unique
 * (organizationId, kind, slug) index plus `skipDuplicates` means a race
 * inserts each row once. Only genuinely absent slugs are written, so an
 * organization that renamed or deactivated a default keeps its edit.
 */
export async function ensureDefaultCategories(
  organizationId: string,
  kind?: CategoryKind,
): Promise<void> {
  const kinds = kind ? [kind] : CATEGORY_KINDS;

  for (const currentKind of kinds) {
    const seeds = defaultsFor(currentKind);

    // Include soft-deleted rows: a default the organization archived must not
    // be resurrected on the next read. Naming `deletedAt` at all — even as
    // undefined, i.e. "no constraint" — is how a caller opts out of the
    // automatic `deletedAt: null` filter in src/lib/db/prisma.ts.
    const existing = await db.propertyCategory.findMany({
      where: { kind: currentKind, deletedAt: undefined },
      select: { slug: true },
    });
    const known = new Set(existing.map((row) => row.slug));

    const missing = seeds
      .map((seed, index) => ({ seed, index }))
      .filter(({ seed }) => !known.has(seed.slug));

    if (missing.length === 0) continue;

    await db.propertyCategory.createMany({
      data: missing.map(({ seed, index }) => ({
        organizationId,
        kind: currentKind,
        slug: seed.slug,
        nameEn: seed.nameEn,
        nameAr: seed.nameAr,
        isSystem: true,
        isActive: true,
        sortOrder: index,
      })),
      skipDuplicates: true,
    });
  }
}

/**
 * List an organization's categories, seeding defaults first.
 * `activeOnly` is what forms should pass; management screens want everything.
 */
export async function listCategories(
  organizationId: string,
  kind: CategoryKind,
  options: { activeOnly?: boolean } = {},
): Promise<CategoryOption[]> {
  await ensureDefaultCategories(organizationId, kind);

  const rows = await db.propertyCategory.findMany({
    where: {
      kind,
      ...(options.activeOnly ? { isActive: true } : {}),
    },
    orderBy: [{ sortOrder: "asc" }, { nameEn: "asc" }],
    select: {
      id: true,
      kind: true,
      slug: true,
      nameEn: true,
      nameAr: true,
      description: true,
      isSystem: true,
      isActive: true,
      sortOrder: true,
    },
  });

  return rows as CategoryOption[];
}

/**
 * Assert that a slug is an active category of the given kind.
 * Returns the slug so callers can write it straight through.
 *
 * Throws {@link UnknownCategoryError} rather than returning a boolean so a
 * route cannot forget to branch on the result and silently persist junk.
 */
export class UnknownCategoryError extends Error {
  constructor(
    readonly kind: CategoryKind,
    readonly slug: string,
  ) {
    super(
      `"${slug}" is not an active ${kind === "unit" ? "unit type" : "property category"}`,
    );
    this.name = "UnknownCategoryError";
  }
}

export async function assertCategorySlug(
  organizationId: string,
  kind: CategoryKind,
  slug: string,
): Promise<string> {
  await ensureDefaultCategories(organizationId, kind);

  const match = await db.propertyCategory.findFirst({
    where: { kind, slug, isActive: true },
    select: { slug: true },
  });

  if (!match) throw new UnknownCategoryError(kind, slug);
  return match.slug;
}

/**
 * Validate a batch of unit type slugs in one query.
 * A property is created with its units inline, so this avoids one round trip
 * per unit on a 200-unit tower.
 */
export async function assertUnitTypeSlugs(
  organizationId: string,
  slugs: readonly string[],
): Promise<void> {
  const wanted = [...new Set(slugs.filter(Boolean))];
  if (wanted.length === 0) return;

  await ensureDefaultCategories(organizationId, "unit");

  const found = await db.propertyCategory.findMany({
    where: { kind: "unit", slug: { in: wanted }, isActive: true },
    select: { slug: true },
  });
  const known = new Set(found.map((row) => row.slug));

  const unknown = wanted.find((slug) => !known.has(slug));
  if (unknown) throw new UnknownCategoryError("unit", unknown);
}

/**
 * How many rows still point at a category slug. Deactivating is always
 * allowed; this is what stops a *delete* from orphaning live records.
 *
 * A unit type is also what a listing for a property not in the system is
 * (`Listing.propertyType`); a live one would lose its name on the public page.
 */
export async function categoryUsageCount(
  kind: CategoryKind,
  slug: string,
): Promise<number> {
  if (kind !== "unit") {
    return db.property.count({ where: { type: slug, deletedAt: null } });
  }
  const [units, listings] = await Promise.all([
    db.unit.count({ where: { unitType: slug, deletedAt: null } }),
    db.listing.count({
      where: { propertyType: slug, status: { not: "archived" } },
    }),
  ]);
  return units + listings;
}
