import "server-only";

/**
 * PropertyPro - Listings, from the office's side
 *
 * Everything the Marketing → Listings screens and routes do with a listing:
 * list, read, start one from a vacant unit or for a property not in the
 * system, edit, publish, take down, archive and restore. Runs inside the
 * request's organization context, so the database's row-level security
 * already confines every query to the office; what is added here is the
 * second tier — an employee narrowed to some buildings sees the ads for those
 * buildings only (`propertyScope`).
 *
 * A listing for a property not in the system belongs to no building. Like an
 * expense with none, it is the office's own business: it falls outside an
 * employee's narrower view, so only someone who sees every building can start
 * one (`advertisesBeyondBuildings`). For everyone else the scope adds no
 * condition, and those listings are in the list with the rest.
 *
 * The public side of the same table lives in ./public.ts and shares nothing
 * with this file but the visibility rule in ./public-visibility.ts.
 */

import { db } from "@/lib/db/prisma";
import { applyScope, propertyScope } from "@/lib/db/scopes";
import { uniqueViolationTarget } from "@/lib/db/unique-violation";
import type { Prisma } from "@/generated/prisma/client";
import type { AuthenticatedAccessUser } from "@/lib/api-utils";
import {
  defaultPeriodFor,
  isListingStatus,
  isListingType,
  periodFitsType,
  type ListingType,
  type PricePeriod,
} from "./constants";
import { assertCategorySlug, UnknownCategoryError } from "@/lib/property-categories";
import { dayOf, dayToDate, riyadhDay } from "./dates";
import { ListingError, notFound } from "./errors";
import { listingAbilities } from "./permissions";
import { toListingDto, type ListingRowSource } from "./presenters";
import { PUBLISH_PROBLEM_TEXT, publishProblems } from "./publish-rules";
import {
  STANDALONE_DETAIL_KEYS,
  type ListingAction,
  type ListingCreateInput,
  type ListingUpdateInput,
} from "./schemas";
import { pickSlug, randomizedSlug, slugBase } from "./slug";
import { officePath } from "./urls";
import type {
  CandidateUnitDto,
  ListingDto,
  ListingListSummary,
} from "./types";

const ROW_INCLUDE = {
  unit: {
    select: {
      id: true,
      unitNumber: true,
      unitType: true,
      status: true,
      bedrooms: true,
      bathrooms: true,
      squareFootage: true,
      floor: true,
      rentAmount: true,
      images: true,
      deletedAt: true,
    },
  },
  property: {
    select: {
      id: true,
      name: true,
      addressCity: true,
      addressDistrict: true,
      images: true,
    },
  },
} satisfies Prisma.ListingInclude;

export interface ListFilters {
  page: number;
  limit: number;
  search?: string;
  /** draft | published | archived | active (draft + published) | all */
  status?: string;
  type?: string;
  propertyId?: string;
  /** Only ads that need the office's attention: published but not showing. */
  attention?: boolean;
}

/** The part of a `where` every query here starts from: the caller's buildings. */
function scoped(user: AuthenticatedAccessUser): Prisma.ListingWhereInput {
  const where: Prisma.ListingWhereInput = {};
  applyScope(where, { property: propertyScope(user) });
  return where;
}

/**
 * A published ad that is not on the public page: licence gone, or unit let.
 * (A listing with no unit matches neither unit clause.)
 */
function attentionWhere(today: string): Prisma.ListingWhereInput {
  return {
    status: "published",
    OR: [
      { adLicenceExpiry: { lt: dayToDate(today) } },
      { adLicenceExpiry: null },
      { unit: { status: { not: "available" } } },
      { unit: { deletedAt: { not: null } } },
    ],
  };
}

function listWhere(
  user: AuthenticatedAccessUser,
  filters: ListFilters,
  today: string,
): Prisma.ListingWhereInput {
  const and: Prisma.ListingWhereInput[] = [];

  if (filters.status === "active") {
    and.push({ status: { in: ["draft", "published"] } });
  } else if (
    filters.status &&
    filters.status !== "all" &&
    isListingStatus(filters.status)
  ) {
    and.push({ status: filters.status });
  }
  if (filters.type && isListingType(filters.type)) {
    and.push({ type: filters.type });
  }
  if (filters.propertyId) and.push({ propertyId: filters.propertyId });
  if (filters.attention) and.push(attentionWhere(today));
  if (filters.search) {
    const contains = { contains: filters.search, mode: "insensitive" } as const;
    and.push({
      OR: [
        { titleAr: contains },
        { titleEn: contains },
        { slug: contains },
        { city: contains },
        { district: contains },
        { addressLine: contains },
        { adLicenceNumber: contains },
        { unit: { unitNumber: contains } },
        { property: { name: contains } },
      ],
    });
  }

  const where: Prisma.ListingWhereInput = and.length > 0 ? { AND: and } : {};
  applyScope(where, { property: propertyScope(user) });
  return where;
}

/** Each listing's inquiries: how many, and how many nobody has opened yet. */
async function inquiryCounts(
  listingIds: string[],
): Promise<Map<string, { total: number; new: number }>> {
  const counts = new Map<string, { total: number; new: number }>();
  if (listingIds.length === 0) return counts;
  const groups = await db.listingInquiry.groupBy({
    by: ["listingId", "status"],
    where: { listingId: { in: listingIds } },
    _count: { _all: true },
  });
  for (const group of groups) {
    const entry = counts.get(group.listingId) ?? { total: 0, new: 0 };
    entry.total += group._count._all;
    if (group.status === "new") entry.new += group._count._all;
    counts.set(group.listingId, entry);
  }
  return counts;
}

function present(
  user: AuthenticatedAccessUser,
  row: ListingRowSource,
  today: string,
  inquiries?: { total: number; new: number },
): ListingDto {
  return toListingDto(row, {
    today,
    organizationSlug: user.organizationSlug ?? "",
    inquiries,
  });
}

export async function listListings(
  user: AuthenticatedAccessUser,
  filters: ListFilters,
  exportAllowed: boolean,
): Promise<{
  rows: ListingDto[];
  total: number;
  summary: ListingListSummary;
}> {
  const today = riyadhDay();
  const where = listWhere(user, filters, today);
  const base = scoped(user);
  const skip = (filters.page - 1) * filters.limit;

  const inquiryScope: Prisma.ListingInquiryWhereInput = {};
  applyScope(inquiryScope, { listing: { property: propertyScope(user) } });

  const [rows, total, byStatus, attention, newInquiries] = await Promise.all([
    db.listing.findMany({
      where,
      include: ROW_INCLUDE,
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      skip,
      take: filters.limit,
    }),
    db.listing.count({ where }),
    db.listing.groupBy({ by: ["status"], where: base, _count: { _all: true } }),
    db.listing.count({
      where: { AND: [base, attentionWhere(today)] },
    }),
    db.listingInquiry.count({ where: { AND: [inquiryScope, { status: "new" }] } }),
  ]);

  const counts = await inquiryCounts(rows.map((row) => row.id));

  const byName = new Map(byStatus.map((group) => [group.status, group._count._all]));
  const draft = byName.get("draft") ?? 0;
  const published = byName.get("published") ?? 0;
  const archived = byName.get("archived") ?? 0;

  return {
    rows: rows.map((row) => present(user, row, today, counts.get(row.id))),
    total,
    summary: {
      total: draft + published + archived,
      draft,
      published,
      archived,
      attention,
      newInquiries,
      abilities: listingAbilities(user.permissions, exportAllowed),
      officePath: officePath(user.organizationSlug ?? ""),
    },
  };
}

/** Every listing a file would carry for these filters — no paging. */
export async function listListingsForExport(
  user: AuthenticatedAccessUser,
  filters: Omit<ListFilters, "page" | "limit">,
  take: number,
): Promise<ListingDto[]> {
  const today = riyadhDay();
  const rows = await db.listing.findMany({
    where: listWhere(user, { ...filters, page: 1, limit: take }, today),
    include: ROW_INCLUDE,
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    take,
  });
  const counts = await inquiryCounts(rows.map((row) => row.id));
  return rows.map((row) => present(user, row, today, counts.get(row.id)));
}

async function findRow(user: AuthenticatedAccessUser, id: string) {
  const where: Prisma.ListingWhereInput = { id };
  applyScope(where, { property: propertyScope(user) });
  const row = await db.listing.findFirst({ where, include: ROW_INCLUDE });
  if (!row) throw notFound();
  return row;
}

export async function getListing(
  user: AuthenticatedAccessUser,
  id: string,
): Promise<ListingDto> {
  const row = await findRow(user, id);
  const counts = await inquiryCounts([row.id]);
  return present(user, row, riyadhDay(), counts.get(row.id));
}

// ---------------------------------------------------------------------------
// Starting a listing
// ---------------------------------------------------------------------------

/** The names in a building's amenities JSON (`[{ name, category }]`). */
export function amenityNames(amenities: unknown): string[] {
  if (!Array.isArray(amenities)) return [];
  return amenities
    .map((entry) =>
      typeof entry === "string"
        ? entry
        : entry && typeof entry === "object" && "name" in entry
          ? String((entry as { name: unknown }).name ?? "")
          : "",
    )
    .map((name) => name.trim())
    .filter(Boolean);
}

/**
 * Vacant units that have no live listing of this type yet — what the "new
 * listing" screen offers — with the facts the form starts from.
 */
export async function listCandidateUnits(
  user: AuthenticatedAccessUser,
  options: { type: ListingType; search?: string; limit: number },
): Promise<CandidateUnitDto[]> {
  const where: Prisma.UnitWhereInput = {
    deletedAt: null,
    status: "available",
    property: { deletedAt: null },
    listings: { none: { type: options.type, status: { not: "archived" } } },
  };
  if (options.search) {
    const contains = { contains: options.search, mode: "insensitive" } as const;
    where.OR = [
      { unitNumber: contains },
      { property: { name: contains } },
      { property: { addressDistrict: contains } },
      { property: { addressCity: contains } },
    ];
  }
  applyScope(where, { property: propertyScope(user) });

  const units = await db.unit.findMany({
    where,
    orderBy: [{ property: { name: "asc" } }, { unitNumber: "asc" }],
    take: options.limit,
    select: {
      id: true,
      unitNumber: true,
      unitType: true,
      floor: true,
      bedrooms: true,
      bathrooms: true,
      squareFootage: true,
      rentAmount: true,
      availableFrom: true,
      images: true,
      features: true,
      property: {
        select: {
          id: true,
          name: true,
          type: true,
          addressCity: true,
          addressDistrict: true,
          images: true,
          amenities: true,
        },
      },
    },
  });

  return units.map((unit) => ({
    id: unit.id,
    unitNumber: unit.unitNumber,
    unitType: unit.unitType,
    floor: unit.floor,
    bedrooms: unit.bedrooms,
    bathrooms: unit.bathrooms,
    squareFootage: unit.squareFootage,
    rentAmount: Number(unit.rentAmount) || 0,
    availableFrom: dayOf(unit.availableFrom),
    images: unit.images,
    features:
      unit.features && typeof unit.features === "object"
        ? (unit.features as Record<string, unknown>)
        : {},
    property: {
      id: unit.property.id,
      name: unit.property.name,
      type: unit.property.type,
      addressCity: unit.property.addressCity,
      addressDistrict: unit.property.addressDistrict,
      images: unit.property.images,
      amenities: amenityNames(unit.property.amenities),
    },
  }));
}

async function takenSlugs(base: string): Promise<Set<string>> {
  const rows = await db.listing.findMany({
    where: { slug: { startsWith: base } },
    select: { slug: true },
    take: 300,
  });
  return new Set(rows.map((row) => row.slug));
}

function constraintName(error: unknown): "slug" | "live" | null {
  const target = uniqueViolationTarget(error);
  if (!target) return null;
  if (target.includes("listings_unit_type_live_unique")) return "live";
  if (target.includes("listings_organizationId_slug_key") || target.includes("slug")) {
    return "slug";
  }
  return null;
}

/**
 * Whether this caller may advertise a property that is not in the system.
 * Such a listing has no building, so a caller narrowed to some buildings could
 * start it and then never see it again.
 */
export function advertisesBeyondBuildings(user: AuthenticatedAccessUser): boolean {
  return Object.keys(propertyScope(user)).length === 0;
}

/** The office's unit type, or a refusal that says so. */
async function checkedPropertyType(
  user: AuthenticatedAccessUser,
  slug: string,
): Promise<string> {
  try {
    return await assertCategorySlug(user.organizationId!, "unit", slug);
  } catch (error) {
    if (error instanceof UnknownCategoryError) {
      throw new ListingError(
        400,
        "listing_property_type_unknown",
        "Choose a property type from the office's unit types",
      );
    }
    throw error;
  }
}

/**
 * Insert a new listing under a free slug. A slug the office named itself is
 * refused if taken; one made from the listing is retried with a random tail
 * after a lost race. The one-live-ad-per-unit index is the backstop for a
 * listing made from a unit.
 */
async function insertListing(
  user: AuthenticatedAccessUser,
  data: Omit<Prisma.ListingUncheckedCreateInput, "slug">,
  base: string,
  explicitSlug: string | null,
): Promise<ListingDto> {
  let slug = explicitSlug ?? pickSlug(base, await takenSlugs(base));
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const created = await db.listing.create({
        data: { ...data, slug },
        include: ROW_INCLUDE,
      });
      return present(user, created, riyadhDay());
    } catch (error) {
      const which = constraintName(error);
      if (which === "live") {
        throw new ListingError(
          409,
          "listing_exists",
          "This unit already has a live listing of this type",
        );
      }
      if (which === "slug") {
        if (explicitSlug) {
          throw new ListingError(
            409,
            "listing_slug_taken",
            "Another listing already uses this address",
          );
        }
        slug = randomizedSlug(base);
        continue;
      }
      throw error;
    }
  }
  throw new ListingError(
    409,
    "listing_slug_taken",
    "Could not find a free address for this listing",
  );
}

/** The fields every new listing takes from the input the same way. */
function commonCreateData(
  user: AuthenticatedAccessUser,
  input: ListingCreateInput,
  type: ListingType,
  pricePeriod: PricePeriod,
) {
  return {
    organizationId: user.organizationId!,
    type,
    titleAr: input.titleAr ?? "",
    titleEn: input.titleEn ?? "",
    descriptionAr: input.descriptionAr ?? null,
    descriptionEn: input.descriptionEn ?? null,
    pricePeriod,
    photos: input.photos ?? [],
    amenities: input.amenities ?? [],
    contactPhone: input.contactPhone ?? null,
    whatsappNumber: input.whatsappNumber ?? null,
    adLicenceNumber: input.adLicenceNumber ?? null,
    adLicenceExpiry: input.adLicenceExpiry ? dayToDate(input.adLicenceExpiry) : null,
    status: "draft",
    createdById: user.id,
  } satisfies Omit<Prisma.ListingUncheckedCreateInput, "slug">;
}

export async function createListing(
  user: AuthenticatedAccessUser,
  input: ListingCreateInput,
): Promise<ListingDto> {
  const type: ListingType = input.type ?? "rent";
  const pricePeriod: PricePeriod = input.pricePeriod ?? defaultPeriodFor(type);
  if (!periodFitsType(type, pricePeriod)) {
    throw new ListingError(
      400,
      "listing_period_mismatch",
      "The price period does not fit the listing type",
    );
  }

  if (input.standalone) {
    return createStandaloneListing(user, input, type, pricePeriod);
  }
  if (!input.unitId) throw notFound("Unit");

  const unitWhere: Prisma.UnitWhereInput = {
    id: input.unitId,
    deletedAt: null,
    property: { deletedAt: null },
  };
  applyScope(unitWhere, { property: propertyScope(user) });
  const unit = await db.unit.findFirst({
    where: unitWhere,
    select: {
      id: true,
      unitNumber: true,
      rentAmount: true,
      propertyId: true,
      property: {
        select: { name: true, addressCity: true, addressDistrict: true },
      },
    },
  });
  if (!unit) throw notFound("Unit");

  // One live ad per unit and type. The index below is the backstop; asking
  // first lets the answer say which one it is.
  const live = await db.listing.findFirst({
    where: { unitId: unit.id, type, status: { not: "archived" } },
    select: { id: true },
  });
  if (live) {
    throw new ListingError(
      409,
      "listing_exists",
      "This unit already has a live listing of this type",
      { existingId: live.id },
    );
  }

  const base = slugBase({
    titleEn: input.titleEn,
    propertyName: unit.property.name,
    unitNumber: unit.unitNumber,
    type,
  });

  return insertListing(
    user,
    {
      ...commonCreateData(user, input, type, pricePeriod),
      propertyId: unit.propertyId,
      unitId: unit.id,
      price: input.price ?? (type === "rent" ? Number(unit.rentAmount) || 0 : 0),
      city: input.city === undefined ? unit.property.addressCity : input.city,
      district:
        input.district === undefined ? unit.property.addressDistrict : input.district,
    },
    base,
    input.slug ?? null,
  );
}

/**
 * A listing for a property the office has not added: no unit, no building,
 * and the details a unit would have given — the type and the city at least
 * (the schema asks for both), the rest as the office has them.
 */
async function createStandaloneListing(
  user: AuthenticatedAccessUser,
  input: ListingCreateInput,
  type: ListingType,
  pricePeriod: PricePeriod,
): Promise<ListingDto> {
  if (!advertisesBeyondBuildings(user)) {
    throw new ListingError(
      403,
      "listing_standalone_restricted",
      "You can advertise only units in the buildings assigned to you",
    );
  }
  if (!input.propertyType || !input.city) {
    throw new ListingError(
      400,
      "listing_standalone_details",
      "A listing for a property that is not in the system needs its type and city",
    );
  }
  const propertyType = await checkedPropertyType(user, input.propertyType);

  const base = slugBase({ titleEn: input.titleEn, propertyType, type });
  return insertListing(
    user,
    {
      ...commonCreateData(user, input, type, pricePeriod),
      propertyId: null,
      unitId: null,
      price: input.price ?? 0,
      city: input.city,
      district: input.district ?? null,
      propertyType,
      addressLine: input.addressLine ?? null,
      areaSqm: input.areaSqm ?? null,
      bedrooms: input.bedrooms ?? null,
      bathrooms: input.bathrooms ?? null,
      floor: input.floor ?? null,
    },
    base,
    input.slug ?? null,
  );
}

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

/** The fields of the update that were actually sent. */
function sent<T extends object>(input: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) (out as Record<string, unknown>)[key] = value;
  }
  return out;
}

export async function updateListing(
  user: AuthenticatedAccessUser,
  id: string,
  input: ListingUpdateInput,
): Promise<ListingDto> {
  const existing = await findRow(user, id);
  const today = riyadhDay();
  const changes = sent(input);

  if (existing.status === "archived") {
    throw new ListingError(
      409,
      "listing_archived",
      "An archived listing cannot be edited. Restore it first.",
    );
  }

  // A listing made from a unit reads its type, area and rooms from the unit;
  // one with no unit keeps its own, and never loses what it is or where.
  const standalone = existing.unitId === null;
  if (!standalone) {
    const stray = STANDALONE_DETAIL_KEYS.filter(
      (key) => changes[key] !== undefined && changes[key] !== null,
    );
    if (stray.length > 0) {
      throw new ListingError(
        400,
        "listing_details_from_unit",
        `A listing made from a unit takes these from the unit: ${stray.join(", ")}`,
      );
    }
  } else if (changes.propertyType === null || changes.city === null) {
    throw new ListingError(
      400,
      "listing_standalone_details",
      "A listing for a property that is not in the system needs its type and city",
    );
  }
  const propertyType =
    standalone && changes.propertyType && changes.propertyType !== existing.propertyType
      ? await checkedPropertyType(user, changes.propertyType)
      : undefined;

  const type: ListingType =
    changes.type ?? (isListingType(existing.type) ? existing.type : "rent");
  let pricePeriod = (changes.pricePeriod ?? existing.pricePeriod) as PricePeriod;

  // Changing between rent and sale moves the period with it unless the
  // caller named one: a sale is "total", a rent is not.
  if (changes.type && changes.type !== existing.type && !changes.pricePeriod) {
    pricePeriod = defaultPeriodFor(type);
  }
  if (!periodFitsType(type, pricePeriod)) {
    throw new ListingError(
      400,
      "listing_period_mismatch",
      "The price period does not fit the listing type",
    );
  }

  // The address the office has already shared stays put once it is public.
  if (changes.slug && changes.slug !== existing.slug && existing.status !== "draft") {
    throw new ListingError(
      409,
      "listing_slug_locked",
      "A listing's address cannot change after it has been published. Unpublish it first.",
    );
  }

  // Changing the type of a listing could collide with another live ad of the
  // new type on the same unit. (A listing with no unit collides with nothing.)
  if (!standalone && changes.type && changes.type !== existing.type) {
    const clash = await db.listing.findFirst({
      where: {
        unitId: existing.unitId,
        type,
        status: { not: "archived" },
        id: { not: existing.id },
      },
      select: { id: true },
    });
    if (clash) {
      throw new ListingError(
        409,
        "listing_exists",
        "This unit already has a live listing of that type",
        { existingId: clash.id },
      );
    }
  }

  const next = {
    titleAr: changes.titleAr ?? existing.titleAr,
    titleEn: changes.titleEn ?? existing.titleEn,
    price: changes.price ?? Number(existing.price),
    adLicenceNumber:
      changes.adLicenceNumber === undefined
        ? existing.adLicenceNumber
        : changes.adLicenceNumber,
    adLicenceExpiry:
      changes.adLicenceExpiry === undefined
        ? dayOf(existing.adLicenceExpiry)
        : changes.adLicenceExpiry,
    propertyType: propertyType ?? existing.propertyType,
    city: changes.city === undefined ? existing.city : changes.city,
    areaSqm: changes.areaSqm === undefined ? existing.areaSqm : changes.areaSqm,
  };

  // A published ad must go on meeting what publishing asked for. (The unit
  // being let since is not an edit's doing, so it does not stop a text change.)
  if (existing.status === "published") {
    const problems = publishProblems(
      {
        ...next,
        type,
        pricePeriod,
        unitStatus: "available",
        standalone,
      },
      today,
    );
    if (problems.length > 0) {
      throw new ListingError(
        422,
        "listing_not_publishable",
        problems.map((problem) => PUBLISH_PROBLEM_TEXT[problem]).join(" "),
        { problems },
      );
    }
  }

  const data: Prisma.ListingUncheckedUpdateInput = {
    type,
    pricePeriod,
    ...(changes.slug !== undefined && changes.slug !== null
      ? { slug: changes.slug }
      : {}),
    ...(changes.titleAr !== undefined ? { titleAr: changes.titleAr } : {}),
    ...(changes.titleEn !== undefined ? { titleEn: changes.titleEn } : {}),
    ...(changes.descriptionAr !== undefined
      ? { descriptionAr: changes.descriptionAr }
      : {}),
    ...(changes.descriptionEn !== undefined
      ? { descriptionEn: changes.descriptionEn }
      : {}),
    ...(changes.price !== undefined ? { price: changes.price } : {}),
    ...(changes.photos !== undefined ? { photos: changes.photos } : {}),
    ...(changes.amenities !== undefined ? { amenities: changes.amenities } : {}),
    ...(changes.city !== undefined ? { city: changes.city } : {}),
    ...(changes.district !== undefined ? { district: changes.district } : {}),
    ...(changes.contactPhone !== undefined
      ? { contactPhone: changes.contactPhone }
      : {}),
    ...(changes.whatsappNumber !== undefined
      ? { whatsappNumber: changes.whatsappNumber }
      : {}),
    ...(changes.adLicenceNumber !== undefined
      ? { adLicenceNumber: changes.adLicenceNumber }
      : {}),
    ...(changes.adLicenceExpiry !== undefined
      ? {
          adLicenceExpiry: changes.adLicenceExpiry
            ? dayToDate(changes.adLicenceExpiry)
            : null,
        }
      : {}),
    ...(propertyType !== undefined ? { propertyType } : {}),
    ...(standalone && changes.addressLine !== undefined
      ? { addressLine: changes.addressLine }
      : {}),
    ...(standalone && changes.areaSqm !== undefined ? { areaSqm: changes.areaSqm } : {}),
    ...(standalone && changes.bedrooms !== undefined ? { bedrooms: changes.bedrooms } : {}),
    ...(standalone && changes.bathrooms !== undefined
      ? { bathrooms: changes.bathrooms }
      : {}),
    ...(standalone && changes.floor !== undefined ? { floor: changes.floor } : {}),
  };

  try {
    const updated = await db.listing.update({
      where: { id: existing.id },
      data,
      include: ROW_INCLUDE,
    });
    const counts = await inquiryCounts([updated.id]);
    return present(user, updated, today, counts.get(updated.id));
  } catch (error) {
    const which = constraintName(error);
    if (which === "slug") {
      throw new ListingError(
        409,
        "listing_slug_taken",
        "Another listing already uses this address",
      );
    }
    if (which === "live") {
      throw new ListingError(
        409,
        "listing_exists",
        "This unit already has a live listing of that type",
      );
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Publishing, taking down, archiving
// ---------------------------------------------------------------------------

export async function applyListingAction(
  user: AuthenticatedAccessUser,
  id: string,
  action: ListingAction,
): Promise<ListingDto> {
  const existing = await findRow(user, id);
  const today = riyadhDay();

  const finish = async (data: Prisma.ListingUncheckedUpdateInput) => {
    try {
      const updated = await db.listing.update({
        where: { id: existing.id },
        data,
        include: ROW_INCLUDE,
      });
      const counts = await inquiryCounts([updated.id]);
      return present(user, updated, today, counts.get(updated.id));
    } catch (error) {
      if (constraintName(error) === "live") {
        throw new ListingError(
          409,
          "listing_exists",
          "This unit already has a live listing of this type",
        );
      }
      throw error;
    }
  };

  switch (action) {
    case "publish": {
      if (existing.status === "published") return present(user, existing, today);
      if (existing.status === "archived") {
        throw new ListingError(
          409,
          "listing_archived",
          "An archived listing must be restored before it is published.",
        );
      }
      const problems = publishProblems(
        {
          titleAr: existing.titleAr,
          titleEn: existing.titleEn,
          price: existing.price,
          type: existing.type as ListingType,
          pricePeriod: existing.pricePeriod as PricePeriod,
          adLicenceNumber: existing.adLicenceNumber,
          adLicenceExpiry: dayOf(existing.adLicenceExpiry),
          unitStatus: existing.unit?.status ?? null,
          unitDeleted: existing.unit ? existing.unit.deletedAt !== null : false,
          standalone: existing.unit === null,
          propertyType: existing.propertyType,
          city: existing.city,
          areaSqm: existing.areaSqm,
        },
        today,
      );
      if (problems.length > 0) {
        throw new ListingError(
          422,
          "listing_not_publishable",
          problems.map((problem) => PUBLISH_PROBLEM_TEXT[problem]).join(" "),
          { problems },
        );
      }
      return finish({ status: "published", publishedAt: new Date() });
    }
    case "unpublish": {
      if (existing.status !== "published") return present(user, existing, today);
      return finish({ status: "draft" });
    }
    case "archive": {
      if (existing.status === "archived") return present(user, existing, today);
      return finish({ status: "archived" });
    }
    case "restore": {
      if (existing.status !== "archived") return present(user, existing, today);
      return finish({ status: "draft" });
    }
  }
}
