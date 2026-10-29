/**
 * PropertyPro - Owners
 *
 * The owners list is DERIVED from who actually owns properties, not from the
 * `owners` profile table. That is the whole design: a landlord who owns and
 * manages their own buildings is already the owner of record on every
 * property they created, and must appear here without ever filling in a
 * profile. The profile table only enriches a row that already exists.
 *
 * The consequence to keep in mind when changing this file: never filter the
 * list by "has a profile", and never require a profile before an owner can be
 * shown, paid, or reported on.
 */

import { db } from "@/lib/db/prisma";
import {
  ownerRecordScope,
  propertyScope,
  withScope,
  type ScopeActor,
} from "@/lib/db/scopes";
import { LeaseStatus, PropertyStatus, UserRole } from "@/types";

export interface OwnerSummary {
  /** The user id — the owner's identity everywhere, profile or not. */
  userId: string;
  /** Profile row id, or null when this owner has no profile yet. */
  ownerProfileId: string | null;
  name: string;
  email: string;
  phone: string | null;
  companyName: string | null;
  isActive: boolean;
  /** True when this owner is the signed-in user (the self-managing landlord). */
  isSelf: boolean;
  /**
   * True when the person is an owner account the office keeps for them —
   * rather than a member of staff who happens to own buildings, whose name
   * and email are their own sign-in and are edited under Employees.
   */
  isOwnerAccount: boolean;
  propertyCount: number;
  unitCount: number;
  occupiedUnits: number;
  occupancyRate: number;
  activeLeases: number;
  monthlyRent: number;
  outstandingBalance: number;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Everyone who owns at least one property, plus anyone with an owner profile
 * who does not (yet) own one — a client onboarded before their buildings were
 * entered would otherwise vanish from the list.
 */
export async function listOwners(options: {
  currentUserId?: string;
  search?: string;
  includeInactive?: boolean;
  /**
   * Restrict the result to one owner. Set by the API when the caller is a
   * property owner rather than office staff: an owner's own record is the only
   * one they are entitled to, and the rest of this list is other people's
   * portfolios and payout details.
   */
  onlyUserId?: string;
  /**
   * Who is asking. An owner summary is built from the buildings they hold, so
   * a reader narrowed to a few buildings should see the owners of those —
   * with portfolios counted over what they can actually see, not over the
   * whole office.
   */
  actor?: ScopeActor;
} = {}): Promise<OwnerSummary[]> {
  const properties = await db.property.findMany({
    where: {
      deletedAt: null,
      ...(options.actor ? propertyScope(options.actor) : {}),
    },
    select: { id: true, ownerId: true },
  });

  const allProfiles = await db.owner.findMany({
    where: options.includeInactive ? {} : { isActive: true },
    select: {
      id: true,
      userId: true,
      companyName: true,
      isActive: true,
    },
  });

  // An employee narrowed to some buildings sees the owners of those buildings
  // (ownerRecordScope) — not every client the office has a profile for. The
  // buildings above are already narrowed, so their owners are the set. An
  // owner caller is narrowed by `onlyUserId` instead, profile or not.
  const narrowed = options.actor?.scopedPropertyIds !== undefined;
  const ownersInReach = new Set(properties.map((property) => property.ownerId));
  const profiles = narrowed
    ? allProfiles.filter((profile) => ownersInReach.has(profile.userId))
    : allProfiles;

  const ownerIds = [
    ...new Set([
      ...properties.map((property) => property.ownerId),
      ...profiles.map((profile) => profile.userId),
    ]),
  ].filter((id) => !options.onlyUserId || id === options.onlyUserId);
  if (ownerIds.length === 0) return [];

  const users = await db.user.findMany({
    where: { id: { in: ownerIds } },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      role: true,
    },
  });
  const userById = new Map(users.map((user) => [user.id, user]));
  const profileByUser = new Map(
    profiles.map((profile) => [profile.userId, profile]),
  );

  const propertyIdsByOwner = new Map<string, string[]>();
  for (const property of properties) {
    const list = propertyIdsByOwner.get(property.ownerId) ?? [];
    list.push(property.id);
    propertyIdsByOwner.set(property.ownerId, list);
  }

  const allPropertyIds = properties.map((property) => property.id);

  // Portfolio figures for every owner in a fixed number of queries.
  const [unitGroups, leaseGroups, invoiceGroups] = allPropertyIds.length
    ? await Promise.all([
        db.unit.groupBy({
          by: ["propertyId", "status"],
          where: { propertyId: { in: allPropertyIds }, deletedAt: null },
          _count: { _all: true },
        }),
        db.lease.groupBy({
          by: ["propertyId"],
          where: {
            propertyId: { in: allPropertyIds },
            status: LeaseStatus.ACTIVE,
            deletedAt: null,
          },
          _count: { _all: true },
          _sum: { rentAmount: true },
        }),
        db.invoice.groupBy({
          by: ["propertyId"],
          where: {
            propertyId: { in: allPropertyIds },
            status: { in: ["scheduled", "issued", "partial", "overdue"] },
            deletedAt: null,
          },
          _sum: { balanceRemaining: true },
        }),
      ])
    : [[], [], []];

  const unitsByProperty = new Map<
    string,
    { total: number; occupied: number }
  >();
  for (const group of unitGroups) {
    const bucket = unitsByProperty.get(group.propertyId) ?? {
      total: 0,
      occupied: 0,
    };
    bucket.total += group._count._all;
    if (group.status === PropertyStatus.OCCUPIED) {
      bucket.occupied += group._count._all;
    }
    unitsByProperty.set(group.propertyId, bucket);
  }

  const leasesByProperty = new Map(
    leaseGroups.map((group) => [
      group.propertyId,
      { count: group._count._all, rent: Number(group._sum.rentAmount ?? 0) },
    ]),
  );
  const dueByProperty = new Map(
    invoiceGroups.map((group) => [
      group.propertyId,
      Number(group._sum.balanceRemaining ?? 0),
    ]),
  );

  const query = options.search?.trim().toLowerCase();

  const owners: OwnerSummary[] = ownerIds.map((userId) => {
    const user = userById.get(userId);
    const profile = profileByUser.get(userId);
    const ownedProperties = propertyIdsByOwner.get(userId) ?? [];

    let unitCount = 0;
    let occupiedUnits = 0;
    let activeLeases = 0;
    let monthlyRent = 0;
    let outstandingBalance = 0;

    for (const propertyId of ownedProperties) {
      const units = unitsByProperty.get(propertyId);
      if (units) {
        unitCount += units.total;
        occupiedUnits += units.occupied;
      }
      const leases = leasesByProperty.get(propertyId);
      if (leases) {
        activeLeases += leases.count;
        monthlyRent = round(monthlyRent + leases.rent);
      }
      outstandingBalance = round(
        outstandingBalance + (dueByProperty.get(propertyId) ?? 0),
      );
    }

    return {
      userId,
      ownerProfileId: profile?.id ?? null,
      name: `${user?.firstName ?? ""} ${user?.lastName ?? ""}`.trim() || "—",
      email: user?.email ?? "",
      phone: user?.phone ?? null,
      companyName: profile?.companyName ?? null,
      isActive: profile?.isActive ?? true,
      isSelf: userId === options.currentUserId,
      isOwnerAccount: user?.role === UserRole.OWNER,
      propertyCount: ownedProperties.length,
      unitCount,
      occupiedUnits,
      occupancyRate:
        unitCount > 0 ? Math.round((occupiedUnits / unitCount) * 1000) / 10 : 0,
      activeLeases,
      monthlyRent,
      outstandingBalance,
    };
  });

  const filtered = query
    ? owners.filter(
        (owner) =>
          owner.name.toLowerCase().includes(query) ||
          owner.email.toLowerCase().includes(query) ||
          (owner.companyName ?? "").toLowerCase().includes(query),
      )
    : owners;

  // Biggest portfolios first; the self-managing landlord naturally lands on
  // top of their own single-owner list.
  return filtered.sort(
    (a, b) => b.propertyCount - a.propertyCount || a.name.localeCompare(b.name),
  );
}

export interface OwnerProperty {
  id: string;
  name: string;
  type: string;
  status: string;
  city: string;
  totalUnits: number;
  compoundName: string | null;
}

export interface OwnerDetail extends OwnerSummary {
  profile: {
    id: string;
    companyName: string | null;
    nationalId: string | null;
    taxNumber: string | null;
    addressStreet: string | null;
    addressCity: string | null;
    addressCountry: string | null;
    payoutMethod: string | null;
    bankName: string | null;
    bankAccountName: string | null;
    bankIban: string | null;
    notes: string | null;
    isActive: boolean;
  } | null;
  properties: OwnerProperty[];
}

/**
 * One owner with their portfolio. Returns null only when the user does not
 * exist — an owner with no profile is a perfectly valid result.
 */
export async function getOwner(
  userId: string,
  options: {
    currentUserId?: string;
    onlyUserId?: string;
    /** Who is asking — narrows the record exactly as it narrows the list. */
    actor?: ScopeActor;
  } = {},
): Promise<OwnerDetail | null> {
  // An owner caller asking after anyone but themselves gets nothing back, the
  // same answer they would get for a user who owns nothing.
  if (options.onlyUserId && options.onlyUserId !== userId) return null;

  const summaries = await listOwners({
    currentUserId: options.currentUserId,
    includeInactive: true,
    onlyUserId: options.onlyUserId,
    actor: options.actor,
  });
  const summary = summaries.find((owner) => owner.userId === userId);

  // Outside the reader's buildings: not theirs to open, whatever it holds.
  // The same 404 as an owner that does not exist.
  if (!summary && options.actor?.scopedPropertyIds !== undefined) return null;

  if (!summary) {
    // Not an owner of anything and has no profile — but the user may still
    // exist, so report "not an owner" rather than inventing an empty record.
    const user = await db.user.findFirst({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) return null;
  }

  const [profile, properties] = await Promise.all([
    db.owner.findFirst({ where: { userId } }),
    db.property.findMany({
      // The portfolio as this reader may see it: a narrowed employee is shown
      // the buildings they hold, not the owner's others.
      where: withScope(
        { ownerId: userId, deletedAt: null },
        options.actor ? propertyScope(options.actor) : {},
      ),
      select: {
        id: true,
        name: true,
        type: true,
        status: true,
        addressCity: true,
        totalUnits: true,
        compound: { select: { name: true } },
      },
      orderBy: { name: "asc" },
    }),
  ]);

  if (!summary && !profile && properties.length === 0) return null;

  const user = await db.user.findFirst({
    where: { id: userId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      role: true,
    },
  });

  const base: OwnerSummary = summary ?? {
    userId,
    ownerProfileId: profile?.id ?? null,
    name: `${user?.firstName ?? ""} ${user?.lastName ?? ""}`.trim() || "—",
    email: user?.email ?? "",
    phone: user?.phone ?? null,
    companyName: profile?.companyName ?? null,
    isActive: profile?.isActive ?? true,
    isSelf: userId === options.currentUserId,
    isOwnerAccount: user?.role === UserRole.OWNER,
    propertyCount: 0,
    unitCount: 0,
    occupiedUnits: 0,
    occupancyRate: 0,
    activeLeases: 0,
    monthlyRent: 0,
    outstandingBalance: 0,
  };

  return {
    ...base,
    profile: profile
      ? {
          id: profile.id,
          companyName: profile.companyName,
          nationalId: profile.nationalId,
          taxNumber: profile.taxNumber,
          addressStreet: profile.addressStreet,
          addressCity: profile.addressCity,
          addressCountry: profile.addressCountry,
          payoutMethod: profile.payoutMethod,
          bankName: profile.bankName,
          bankAccountName: profile.bankAccountName,
          bankIban: profile.bankIban,
          notes: profile.notes,
          isActive: profile.isActive,
        }
      : null,
    properties: properties.map((property) => ({
      id: property.id,
      name: property.name,
      type: property.type,
      status: property.status,
      city: property.addressCity,
      totalUnits: property.totalUnits,
      compoundName: property.compound?.name ?? null,
    })),
  };
}

/**
 * The owner's user row, if this caller may act on them — or null, which the
 * owner routes answer with 404.
 *
 * The same rule as the list and the record (ownerRecordScope): an employee
 * narrowed to some buildings reaches the owners of those buildings; anyone
 * else on the office's side reaches any person in the organization, which is
 * what lets a profile be started for someone who owns nothing yet.
 */
export async function findOwnerInScope(actor: ScopeActor, userId: string) {
  return db.user.findFirst({
    where: withScope({ id: userId }, ownerRecordScope(actor)),
    select: {
      id: true,
      role: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
    },
  });
}
