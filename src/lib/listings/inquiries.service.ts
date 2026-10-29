import "server-only";

/**
 * PropertyPro - The inquiry inbox, from the office's side
 *
 * What strangers wrote on the public pages, worked by the people who hold the
 * Handle-inquiries right: read it, say who has it and where it stands (new,
 * contacted, closed), keep notes. Inside the request's organization context,
 * and narrowed to the caller's buildings the way listings are.
 *
 * Writing an inquiry is not here — it comes from the public route and is in
 * ./public.ts, which has no signed-in person to scope by.
 */

import { db } from "@/lib/db/prisma";
import { applyScope, propertyScope } from "@/lib/db/scopes";
import { resolveAccessProfile } from "@/lib/server-permissions";
import { hasAnyPermission } from "@/lib/permissions-manager";
import type { Prisma } from "@/generated/prisma/client";
import type { AuthenticatedAccessUser } from "@/lib/api-utils";
import { isInquiryStatus, isListingType } from "./constants";
import { ListingError, notFound } from "./errors";
import { LISTING_ACCESS, listingAbilities } from "./permissions";
import type { InquiryUpdateInput } from "./schemas";
import type {
  InquiryDto,
  InquiryListSummary,
  StaffMemberDto,
} from "./types";

const ROW_INCLUDE = {
  listing: {
    select: {
      id: true,
      slug: true,
      titleAr: true,
      titleEn: true,
      type: true,
      unit: { select: { unitNumber: true } },
      property: { select: { name: true } },
      // A listing with no unit is named by where it is instead.
      addressLine: true,
      district: true,
      city: true,
    },
  },
  assignee: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.ListingInquiryInclude;

type InquiryRow = Prisma.ListingInquiryGetPayload<{ include: typeof ROW_INCLUDE }>;

export interface InquiryFilters {
  page: number;
  limit: number;
  search?: string;
  status?: string;
  /** "me", "none" (unassigned), or a staff member's id. */
  assignee?: string;
  listingId?: string;
}

function fullName(person: { firstName: string | null; lastName: string | null }) {
  return `${person.firstName ?? ""} ${person.lastName ?? ""}`.trim();
}

function toDto(row: InquiryRow): InquiryDto {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    message: row.message,
    status: isInquiryStatus(row.status) ? row.status : "new",
    assigneeId: row.assigneeId,
    assignee: row.assignee
      ? { id: row.assignee.id, name: fullName(row.assignee) || row.assignee.id }
      : null,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    listing: {
      id: row.listing.id,
      slug: row.listing.slug,
      titleAr: row.listing.titleAr,
      titleEn: row.listing.titleEn,
      type: isListingType(row.listing.type) ? row.listing.type : "rent",
      unitNumber: row.listing.unit?.unitNumber ?? null,
      propertyName: row.listing.property?.name ?? null,
      place: row.listing.unit
        ? null
        : row.listing.addressLine ||
          [row.listing.district, row.listing.city].filter(Boolean).join(" · ") ||
          null,
    },
  };
}

function scopeOf(user: AuthenticatedAccessUser): Prisma.ListingInquiryWhereInput {
  const where: Prisma.ListingInquiryWhereInput = {};
  applyScope(where, { listing: { property: propertyScope(user) } });
  return where;
}

function listWhere(
  user: AuthenticatedAccessUser,
  filters: InquiryFilters,
): Prisma.ListingInquiryWhereInput {
  const and: Prisma.ListingInquiryWhereInput[] = [];

  if (filters.status && filters.status !== "all" && isInquiryStatus(filters.status)) {
    and.push({ status: filters.status });
  }
  if (filters.assignee === "me") and.push({ assigneeId: user.id });
  else if (filters.assignee === "none") and.push({ assigneeId: null });
  else if (filters.assignee) and.push({ assigneeId: filters.assignee });
  if (filters.listingId) and.push({ listingId: filters.listingId });
  if (filters.search) {
    const contains = { contains: filters.search, mode: "insensitive" } as const;
    and.push({
      OR: [
        { name: contains },
        { phone: contains },
        { email: contains },
        { message: contains },
        { listing: { titleAr: contains } },
        { listing: { titleEn: contains } },
      ],
    });
  }

  const where: Prisma.ListingInquiryWhereInput = and.length > 0 ? { AND: and } : {};
  applyScope(where, { listing: { property: propertyScope(user) } });
  return where;
}

export async function listInquiries(
  user: AuthenticatedAccessUser,
  filters: InquiryFilters,
  exportAllowed: boolean,
): Promise<{ rows: InquiryDto[]; total: number; summary: InquiryListSummary }> {
  const where = listWhere(user, filters);
  const base = scopeOf(user);

  const [rows, total, byStatus, unassigned] = await Promise.all([
    db.listingInquiry.findMany({
      where,
      include: ROW_INCLUDE,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (filters.page - 1) * filters.limit,
      take: filters.limit,
    }),
    db.listingInquiry.count({ where }),
    db.listingInquiry.groupBy({
      by: ["status"],
      where: base,
      _count: { _all: true },
    }),
    db.listingInquiry.count({
      where: { AND: [base, { assigneeId: null, status: { not: "closed" } }] },
    }),
  ]);

  const count = new Map(byStatus.map((group) => [group.status, group._count._all]));
  const fresh = count.get("new") ?? 0;
  const contacted = count.get("contacted") ?? 0;
  const closed = count.get("closed") ?? 0;

  return {
    rows: rows.map(toDto),
    total,
    summary: {
      total: fresh + contacted + closed,
      new: fresh,
      contacted,
      closed,
      unassigned,
      abilities: listingAbilities(user.permissions, exportAllowed),
    },
  };
}

export async function listInquiriesForExport(
  user: AuthenticatedAccessUser,
  filters: Omit<InquiryFilters, "page" | "limit">,
  take: number,
): Promise<InquiryDto[]> {
  const rows = await db.listingInquiry.findMany({
    where: listWhere(user, { ...filters, page: 1, limit: take }),
    include: ROW_INCLUDE,
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take,
  });
  return rows.map(toDto);
}

/**
 * Staff who can be handed an inquiry: the office's own people, active, whose
 * role carries the inbox right. Judged by role — a per-person denial is not
 * read here — which is what the people picker needs; the inbox itself still
 * asks the right of whoever opens it.
 */
export async function assignableStaff(): Promise<StaffMemberDto[]> {
  const users = await db.user.findMany({
    where: { isActive: true, deletedAt: null },
    select: { id: true, firstName: true, lastName: true, email: true, role: true },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
  });

  const roles = [...new Set(users.map((user) => user.role))];
  const profiles = new Map(
    await Promise.all(
      roles.map(
        async (role) => [role, await resolveAccessProfile(role)] as const,
      ),
    ),
  );

  return users
    .filter((user) => {
      const profile = profiles.get(user.role);
      return (
        profile?.isCompanyStaff &&
        hasAnyPermission(profile.permissions, LISTING_ACCESS.inquiries)
      );
    })
    .map((user) => ({
      id: user.id,
      name: fullName(user) || user.email || user.id,
      email: user.email ?? "",
    }));
}

export async function updateInquiry(
  user: AuthenticatedAccessUser,
  id: string,
  input: InquiryUpdateInput,
): Promise<InquiryDto> {
  const where: Prisma.ListingInquiryWhereInput = { id };
  applyScope(where, { listing: { property: propertyScope(user) } });
  const existing = await db.listingInquiry.findFirst({ where, select: { id: true } });
  if (!existing) throw notFound("Inquiry");

  const data: Prisma.ListingInquiryUncheckedUpdateInput = {};
  if (input.status !== undefined) data.status = input.status;
  if (input.notes !== undefined) data.notes = input.notes;

  if (input.assigneeId !== undefined) {
    const assigneeId = input.assigneeId ? input.assigneeId : null;
    if (assigneeId) {
      const staff = await assignableStaff();
      if (!staff.some((member) => member.id === assigneeId)) {
        throw new ListingError(
          400,
          "inquiry_assignee_invalid",
          "That person cannot be given inquiries",
        );
      }
    }
    data.assigneeId = assigneeId;
  }

  const updated = await db.listingInquiry.update({
    where: { id: existing.id },
    data,
    include: ROW_INCLUDE,
  });
  return toDto(updated);
}
