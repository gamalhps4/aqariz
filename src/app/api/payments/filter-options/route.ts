/**
 * PropertyPro - Choices for the payments filter panel
 *
 * One request for every dropdown on that panel — contracts, buildings, units,
 * compounds, owners and tenants. Six separate list endpoints would be six
 * round trips before the operator can touch anything, which is felt on any
 * deployment where the database is not next door.
 *
 * Everything here is scoped the same way the payments list itself is, so the
 * dropdowns can only offer what the caller could already see. An option a
 * caller cannot act on is worse than a missing one: it invites a filter that
 * silently returns nothing.
 *
 * The Record payment dialog and the Add a charge form pick their contract
 * from the same list, so each contract also carries its tenant, building and
 * unit ids and its dates, for the caller to label and fill in from.
 *
 * The full list stops at the 300 most recent contracts. An office with more
 * searches instead: `?section=leases|units|tenants&search=…` answers from
 * every contract the caller can see, matched on the tenant's name or mobile,
 * the unit, the contract number or the building, and `&ids=` names the ones
 * already chosen so a picker can label them whatever the search.
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";
import {
  AuthenticatedAccessUser,
  createErrorResponse,
  createSuccessResponse,
  handleApiError,
  withPermissionAndDB,
} from "@/lib/api-utils";
import {
  leaseScope,
  paymentScope,
  propertyScope,
  withScope,
} from "@/lib/db/scopes";
import { phoneSearchVariants } from "@/lib/payments/phone-search";
import { businessDay } from "@/lib/dates/business-day";

const LIMIT = 300;
/** Matches a search answers with. */
const SEARCH_LIMIT = 50;

const LEASE_SELECT = {
  id: true,
  status: true,
  startDate: true,
  endDate: true,
  contractNumber: true,
  unitId: true,
  tenantId: true,
  propertyId: true,
  property: { select: { id: true, name: true } },
  unit: { select: { id: true, unitNumber: true } },
  tenant: { select: { id: true, firstName: true, lastName: true, phone: true } },
} as const;

type LeaseRow = Prisma.LeaseGetPayload<{ select: typeof LEASE_SELECT }>;

function tenantNameOf(lease: LeaseRow): string {
  return `${lease.tenant?.firstName ?? ""} ${lease.tenant?.lastName ?? ""}`.trim();
}

/** A contract as the pickers show it: who holds it and where. */
function leaseOption(lease: LeaseRow) {
  return {
    id: lease.id,
    label: [
      tenantNameOf(lease),
      lease.unit?.unitNumber ? `#${lease.unit.unitNumber}` : null,
    ]
      .filter(Boolean)
      .join(" "),
    hint: [
      lease.property?.name,
      businessDay(lease.startDate),
      lease.status,
    ]
      .filter(Boolean)
      .join(" · "),
    tenantId: lease.tenantId,
    propertyId: lease.propertyId,
    unitId: lease.unitId,
    tenantName: tenantNameOf(lease),
    /** The tenant's mobile, so a contract can be told apart by it. */
    tenantPhone: lease.tenant?.phone ?? "",
    propertyName: lease.property?.name ?? "",
    unitNumber: lease.unit?.unitNumber ?? "",
    contractNumber: lease.contractNumber,
    status: lease.status,
    startDate: lease.startDate,
    endDate: lease.endDate,
  };
}

/** Contracts whose tenant, mobile, unit, number or building match the words. */
function leaseSearchWhere(search: string): Prisma.LeaseWhereInput {
  const words = search.split(/\s+/).filter(Boolean).slice(0, 5);
  return {
    AND: words.map((word) => ({
      OR: [
        { tenant: { firstName: { contains: word, mode: "insensitive" } } },
        { tenant: { lastName: { contains: word, mode: "insensitive" } } },
        { tenant: { phone: { contains: word } } },
        // As dialled at home: "0501234567" is stored "+966501234567".
        ...phoneSearchVariants(word).map((variant) => ({
          tenant: { phone: { contains: variant } },
        })),
        { unit: { unitNumber: { contains: word, mode: "insensitive" } } },
        { contractNumber: { contains: word, mode: "insensitive" } },
        { property: { name: { contains: word, mode: "insensitive" } } },
      ],
    })),
  };
}

const ids = (value: string | null) =>
  [
    ...new Set(
      (value ?? "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ].slice(0, 50);

/**
 * `?section=` — one picker's matches from every contract in scope.
 */
async function searchSection(
  user: AuthenticatedAccessUser,
  section: "leases" | "units" | "tenants",
  search: string,
  chosen: string[],
) {
  const scoped = withScope({ deletedAt: null }, leaseScope(user));

  // The chosen ones, by the id the picker holds: a contract, a unit, a tenant.
  const chosenWhere: Prisma.LeaseWhereInput | null = chosen.length
    ? section === "leases"
      ? { id: { in: chosen } }
      : section === "units"
        ? { unitId: { in: chosen } }
        : { tenantId: { in: chosen } }
    : null;

  const [matches, named] = await Promise.all([
    db.lease.findMany({
      where: search ? { AND: [scoped, leaseSearchWhere(search)] } : scoped,
      select: LEASE_SELECT,
      orderBy: { startDate: "desc" },
      // Units and tenants fold several contracts into one option.
      take: section === "leases" ? SEARCH_LIMIT : SEARCH_LIMIT * 3,
    }),
    chosenWhere
      ? db.lease.findMany({
          where: { AND: [scoped, chosenWhere] },
          select: LEASE_SELECT,
          orderBy: { startDate: "desc" },
          take: SEARCH_LIMIT,
        })
      : Promise.resolve([] as LeaseRow[]),
  ]);

  const leases = [...named, ...matches];

  if (section === "leases") {
    const seen = new Set<string>();
    return {
      leases: leases
        .filter((lease) => !seen.has(lease.id) && seen.add(lease.id))
        .slice(0, SEARCH_LIMIT + chosen.length)
        .map(leaseOption),
    };
  }

  if (section === "units") {
    const units = new Map<string, { id: string; label: string; hint: string }>();
    for (const lease of leases) {
      if (!lease.unit || units.has(lease.unit.id)) continue;
      units.set(lease.unit.id, {
        id: lease.unit.id,
        label: `${lease.property?.name ?? ""} · ${lease.unit.unitNumber}`.trim(),
        hint: tenantNameOf(lease),
      });
    }
    return { units: [...units.values()].slice(0, SEARCH_LIMIT + chosen.length) };
  }

  const tenants = new Map<string, { id: string; label: string; hint: string }>();
  for (const lease of leases) {
    if (!lease.tenant || tenants.has(lease.tenant.id)) continue;
    tenants.set(lease.tenant.id, {
      id: lease.tenant.id,
      label: tenantNameOf(lease),
      hint: lease.tenant.phone ?? "",
    });
  }
  return { tenants: [...tenants.values()].slice(0, SEARCH_LIMIT + chosen.length) };
}

// Whoever can read the payments page can filter it, and whoever can record
// a payment can pick its contract. Processing and finance rights alone left
// the panel's dropdowns empty for everyone else.
export const GET = withPermissionAndDB([
  "payment_view",
  "payment_create",
  "payment_processing",
  "financial_management",
  "financial_reports",
])(async (user: AuthenticatedAccessUser, request: NextRequest) => {
  try {
    if (user.isTenant) {
      return createErrorResponse("Access denied", 403);
    }

    const { searchParams } = new URL(request.url);
    const section = searchParams.get("section");
    if (section) {
      if (section !== "leases" && section !== "units" && section !== "tenants") {
        return createErrorResponse(`Unknown section "${section}"`, 400);
      }
      return createSuccessResponse(
        await searchSection(
          user,
          section,
          (searchParams.get("search") ?? "").trim().slice(0, 100),
          ids(searchParams.get("ids")),
        ),
        "Filter options retrieved successfully",
      );
    }

    const propertyWhere = propertyScope(user);
    const leaseWhere = leaseScope(user);

    const [properties, leases, recorded, methods] = await Promise.all([
      db.property.findMany({
        where: { deletedAt: null, ...propertyWhere },
        select: {
          id: true,
          name: true,
          addressCity: true,
          addressDistrict: true,
          compound: { select: { id: true, name: true } },
          owner: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { name: "asc" },
        take: LIMIT,
      }),
      db.lease.findMany({
        where: { deletedAt: null, ...leaseWhere },
        select: LEASE_SELECT,
        orderBy: { startDate: "desc" },
        take: LIMIT,
      }),
      // Who has recorded payments the caller can see — the payment report's
      // "recorded by" filter.
      db.payment.groupBy({
        by: ["recordedById"],
        where: withScope({ recordedById: { not: null } }, paymentScope(user)),
      }),
      // Every method the caller's payments carry — the six the office records
      // with, and a card taken online or an older cheque besides.
      db.payment.groupBy({
        by: ["paymentMethod"],
        where: withScope({ paymentMethod: { not: null } }, paymentScope(user)),
      }),
    ]);

    const recorderIds = recorded
      .map((row) => row.recordedById)
      .filter((id): id is string => Boolean(id));
    const recorderRows = recorderIds.length
      ? await db.user.findMany({
          where: { id: { in: recorderIds }, deletedAt: undefined },
          select: { id: true, firstName: true, lastName: true },
        })
      : [];

    // Compounds, owners, units and tenants are all derived from the two reads
    // above rather than queried again: whatever appears in the caller's
    // buildings and contracts is exactly what they can filter by, and
    // deriving it keeps the two from drifting apart.
    const compounds = new Map<string, string>();
    const owners = new Map<string, string>();
    for (const property of properties) {
      if (property.compound) {
        compounds.set(property.compound.id, property.compound.name);
      }
      if (property.owner) {
        owners.set(
          property.owner.id,
          `${property.owner.firstName} ${property.owner.lastName}`.trim(),
        );
      }
    }

    const units = new Map<string, string>();
    const tenants = new Map<string, string>();
    for (const lease of leases) {
      if (lease.unit) {
        units.set(
          lease.unit.id,
          `${lease.property?.name ?? ""} · ${lease.unit.unitNumber}`.trim(),
        );
      }
      if (lease.tenant) {
        tenants.set(lease.tenant.id, tenantNameOf(lease));
      }
    }

    const asOptions = (map: Map<string, string>) =>
      [...map.entries()]
        .map(([id, label]) => ({ id, label }))
        .sort((a, b) => a.label.localeCompare(b.label));

    return createSuccessResponse(
      {
        properties: properties.map((property) => ({
          id: property.id,
          label: property.name,
          hint: [property.addressDistrict, property.addressCity]
            .filter(Boolean)
            .join(" · "),
        })),
        // A contract is named by who holds it and where — an id means nothing
        // to the person choosing.
        leases: leases.map(leaseOption),
        // True when the list above stopped at its limit: the pickers then
        // search the server instead of the list.
        leasesTruncated: leases.length === LIMIT,
        compounds: asOptions(compounds),
        owners: asOptions(owners),
        units: asOptions(units),
        tenants: asOptions(tenants),
        methods: methods
          .map((row) => row.paymentMethod)
          .filter((method): method is string => Boolean(method))
          .sort(),
        recorders: recorderRows
          .map((row) => ({
            id: row.id,
            label: `${row.firstName} ${row.lastName}`.trim(),
          }))
          .sort((a, b) => a.label.localeCompare(b.label)),
      },
      "Filter options retrieved successfully",
    );
  } catch (error) {
    return handleApiError(error, "Failed to load filter options");
  }
});
