import "server-only";

/**
 * PropertyPro - Listings, from a stranger's side
 *
 * The only code that reads a listing for someone who is not signed in. A
 * visitor has no organization, so every query here runs under an explicit
 * bypass of row-level security — which means the `where` clause is the whole
 * of the isolation, and so it is built in one place
 * (./public-visibility.ts), keyed on the office the URL names, and never
 * trusts anything the visitor sent beyond the slugs and an id.
 *
 * What may be read:
 *   - an office that is a live account, by its slug;
 *   - that office's listings that are published, with a current licence, whose
 *     unit is still available (or that have no unit: a property not in the
 *     system) — and only the columns PUBLIC_LISTING_SELECT names (no tenant,
 *     no lease, no deposit, no inquiries, no internal notes).
 * What may be written:
 *   - one inquiry, for a listing that passes the same filter.
 *
 * All of it follows the office's package: an office whose plan (or the
 * platform-wide switch) leaves out the Marketing listings module has no
 * public listings — its page, its sitemap entries and its inquiry intake
 * answer as if it had none (officeShowsListings).
 */

import { cache } from "react";
import { db } from "@/lib/db/prisma";
import { bypassOrgScope } from "@/lib/tenancy/context";
import {
  EFFECTIVE_PLAN_SELECT,
  organizationRowHasModule,
  type EffectivePlanFields,
} from "@/lib/billing/entitlements";
import { pickDocumentLogo } from "@/lib/invoice/logo-utils";
import { PUBLIC_PAGE_SIZE, SITEMAP_LISTING_LIMIT, type ListingType } from "./constants";
import { riyadhDay } from "./dates";
import { isRenderablePhotoUrl } from "./photos";
import type { InquiryData } from "./inquiry-guard";
import type { PublicListingView, PublicOffice } from "./public-types";
import {
  PUBLIC_LISTING_SELECT,
  PUBLIC_ORGANIZATION_STATUSES,
  publicListingFilter,
  publicListingWhere,
} from "./public-visibility";
import { publicTypeSlug, toPublicListingView } from "./public-view";
import { falLicenceIsShowable, readOfficeSettings } from "./settings";
import { isOrganizationSlug, listingPath, officePath } from "./urls";

/** The module the public pages belong to (lib/navigation/menu-config.ts). */
const LISTINGS_MODULE = "marketing.listings";

/**
 * Whether the office's package, after the platform switches, includes the
 * listings module. Read from the organization columns each public query
 * already loads (EFFECTIVE_PLAN_SELECT) — the plans and switches are cached —
 * so the check adds no query. The page, the sitemap and the inquiry intake
 * all go through it.
 */
function officeShowsListings(organization: EffectivePlanFields): Promise<boolean> {
  return organizationRowHasModule(organization, LISTINGS_MODULE);
}

function r2PublicUrl(): string | null {
  return (
    process.env.NEXT_PUBLIC_R2_PUBLIC_URL || process.env.R2_PUBLIC_URL || null
  );
}

interface Branding {
  companyName?: unknown;
  [key: string]: unknown;
}

function asBranding(value: unknown): Branding | null {
  return value && typeof value === "object" ? (value as Branding) : null;
}

function hasIdentity(branding: Branding | null): boolean {
  if (!branding) return false;
  const name = typeof branding.companyName === "string" && branding.companyName.trim();
  return Boolean(name || pickDocumentLogo(branding));
}

/**
 * The office as its public page shows it.
 *
 * The name and logo are the office's branding — the same document the login
 * page and the printed statements read — taken from its owner's display
 * settings, or the first admin's that has any. (The app's own resolver loads
 * every user and their access profile to find the branding owner; a public
 * page that anyone can hit should not.) The organization's own name is the
 * fallback, so a brand-new office still has a heading.
 */
export const getPublicOffice = cache(
  async (slug: string): Promise<PublicOffice | null> => {
    const key = slug.trim().toLowerCase();
    if (!isOrganizationSlug(key)) return null;

    return bypassOrgScope(async () => {
      const organization = await db.organization.findFirst({
        where: {
          slug: key,
          deletedAt: null,
          status: { in: [...PUBLIC_ORGANIZATION_STATUSES] },
        },
        select: {
          id: true,
          slug: true,
          name: true,
          ownerId: true,
          branding: true,
          settings: true,
          ...EFFECTIVE_PLAN_SELECT,
        },
      });
      if (!organization || !(await officeShowsListings(organization))) {
        return null;
      }

      const displayRows = await db.displaySettings.findMany({
        where: { organizationId: organization.id, isActive: true },
        orderBy: { createdAt: "asc" },
        select: { userId: true, branding: true },
        take: 10,
      });
      const chosen =
        displayRows.find(
          (row) => row.userId === organization.ownerId && hasIdentity(asBranding(row.branding)),
        ) ?? displayRows.find((row) => hasIdentity(asBranding(row.branding)));
      const branding = asBranding(chosen?.branding);
      const orgBranding = asBranding(organization.branding);

      const nameOf = (source: Branding | null) =>
        typeof source?.companyName === "string" ? source.companyName.trim() : "";
      const logo = branding ? pickDocumentLogo(branding) : undefined;

      const settings = readOfficeSettings(organization.settings);
      const today = riyadhDay();

      return {
        id: organization.id,
        slug: organization.slug,
        name: nameOf(branding) || nameOf(orgBranding) || organization.name,
        logoUrl: logo && isRenderablePhotoUrl(logo, r2PublicUrl()) ? logo : null,
        falLicenceNumber: falLicenceIsShowable(settings, today)
          ? settings.falLicenceNumber
          : null,
        phone: settings.contactPhone,
        whatsapp: settings.whatsappNumber,
      };
    });
  },
);

/**
 * The office's own names for its unit types, for the slugs on a page — a
 * unit's type, or the type a listing with no unit was given (the same set).
 */
async function typeLabels(
  organizationId: string,
  slugs: string[],
): Promise<Map<string, { ar: string | null; en: string | null }>> {
  const labels = new Map<string, { ar: string | null; en: string | null }>();
  if (slugs.length === 0) return labels;
  const rows = await db.propertyCategory.findMany({
    where: {
      organizationId,
      kind: "unit",
      slug: { in: slugs },
      deletedAt: null,
    },
    select: { slug: true, nameAr: true, nameEn: true },
  });
  for (const row of rows) {
    labels.set(row.slug, { ar: row.nameAr, en: row.nameEn });
  }
  return labels;
}

export interface PublicListingPage {
  total: number;
  page: number;
  pageSize: number;
  rows: PublicListingView[];
}

/** One page of the office's public listings, newest first. */
export async function getPublicListings(
  office: PublicOffice,
  options: { type?: ListingType; page?: number } = {},
): Promise<PublicListingPage> {
  const page = Math.max(1, Math.floor(options.page ?? 1));
  const today = riyadhDay();
  const where = {
    AND: [
      publicListingWhere(office.id, today),
      ...(options.type ? [{ type: options.type }] : []),
    ],
  };

  return bypassOrgScope(async () => {
    const [rows, total] = await Promise.all([
      db.listing.findMany({
        where,
        select: PUBLIC_LISTING_SELECT,
        orderBy: [{ publishedAt: "desc" }, { id: "asc" }],
        skip: (page - 1) * PUBLIC_PAGE_SIZE,
        take: PUBLIC_PAGE_SIZE,
      }),
      db.listing.count({ where }),
    ]);
    const labels = await typeLabels(
      office.id,
      [...new Set(rows.map(publicTypeSlug).filter(Boolean))],
    );
    return {
      total,
      page,
      pageSize: PUBLIC_PAGE_SIZE,
      rows: rows.map((row) =>
        toPublicListingView(row, { r2Url: r2PublicUrl(), typeLabels: labels }),
      ),
    };
  });
}

/** One public listing of the office, or null — draft, archived, expired, let or not theirs. */
export const getPublicListing = cache(
  async (
    officeId: string,
    listingSlug: string,
  ): Promise<PublicListingView | null> => {
    const slug = listingSlug.trim().toLowerCase();
    if (!slug || slug.length > 80) return null;
    const today = riyadhDay();

    return bypassOrgScope(async () => {
      const row = await db.listing.findFirst({
        where: { AND: [publicListingWhere(officeId, today), { slug }] },
        select: PUBLIC_LISTING_SELECT,
      });
      if (!row) return null;
      const labels = await typeLabels(
        officeId,
        [publicTypeSlug(row)].filter(Boolean),
      );
      return toPublicListingView(row, {
        r2Url: r2PublicUrl(),
        typeLabels: labels,
      });
    });
  },
);

export interface PublicUrlEntry {
  /** /o/{office}/{listing}, or /o/{office} for the office page. */
  path: string;
  lastModified: Date;
}

/**
 * Every public page, for the sitemap: each office that has a public listing,
 * and each public listing. Bounded, newest first.
 */
export async function listPublicPaths(
  limit: number = SITEMAP_LISTING_LIMIT,
): Promise<PublicUrlEntry[]> {
  const today = riyadhDay();
  const rows = await bypassOrgScope(() =>
    db.listing.findMany({
      where: publicListingFilter(today),
      select: {
        slug: true,
        updatedAt: true,
        organization: { select: { slug: true, ...EFFECTIVE_PLAN_SELECT } },
      },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      take: limit,
    }),
  );

  // Only offices whose package includes the module: one answer per office.
  const shown = new Map<string, boolean>();
  for (const { organization } of rows) {
    if (!shown.has(organization.slug)) {
      shown.set(organization.slug, await officeShowsListings(organization));
    }
  }

  const offices = new Map<string, Date>();
  const entries: PublicUrlEntry[] = [];
  for (const row of rows) {
    if (!shown.get(row.organization.slug)) continue;
    const officeSlug = row.organization.slug;
    const seen = offices.get(officeSlug);
    if (!seen || row.updatedAt > seen) offices.set(officeSlug, row.updatedAt);
    entries.push({
      path: listingPath(officeSlug, row.slug),
      lastModified: row.updatedAt,
    });
  }
  const officeEntries = [...offices].map(([slug, lastModified]) => ({
    path: officePath(slug),
    lastModified,
  }));
  return [...officeEntries, ...entries];
}

export type InquiryIntake =
  | { ok: true; id: string }
  | { ok: false; reason: "not_found" };

/**
 * File one inquiry against a listing — if that listing is on the public page
 * right now. A visitor cannot write to a draft, an archived ad, an expired
 * one or one whose unit has been let, nor to another office's: the lookup is
 * the same filter the page uses.
 */
export async function recordInquiry(input: {
  listingId: string;
  data: InquiryData;
  sourceHash: string | null;
}): Promise<InquiryIntake> {
  const today = riyadhDay();

  return bypassOrgScope(async () => {
    const listing = await db.listing.findFirst({
      where: { AND: [{ id: input.listingId }, publicListingFilter(today)] },
      select: {
        id: true,
        organizationId: true,
        organization: { select: EFFECTIVE_PLAN_SELECT },
      },
    });
    if (!listing || !(await officeShowsListings(listing.organization))) {
      return { ok: false as const, reason: "not_found" as const };
    }

    const created = await db.listingInquiry.create({
      data: {
        organizationId: listing.organizationId,
        listingId: listing.id,
        name: input.data.name,
        phone: input.data.phone,
        email: input.data.email,
        message: input.data.message,
        sourceIpHash: input.sourceHash,
      },
      select: { id: true },
    });
    return { ok: true as const, id: created.id };
  });
}
