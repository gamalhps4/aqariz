import "server-only";

/**
 * PropertyPro - What the reader may filter a report by
 *
 * The lists behind the report filter bar's pickers: owners, compounds,
 * buildings, units, tenants, contracts and agreements. Every one is read
 * through the scope the reader's own lists are read through, so a picker can
 * only offer what they could already open — an option they cannot act on is
 * worse than a missing one, because it invites a filter that quietly returns
 * nothing.
 *
 * One request for all of them: a round trip to the database costs most of a
 * second, and the bar narrows one picker by another in the browser from these
 * same lists (./dependent.ts) rather than asking again.
 */

import { db } from "@/lib/db/prisma";
import {
  agreementScope,
  compoundScope,
  leaseScope,
  propertyScope,
  withScope,
  type ScopeActor,
} from "@/lib/db/scopes";
import { joinFullName } from "@/lib/full-name";
import type {
  AgreementOption,
  BuildingOption,
  CompoundOption,
  ContractOption,
  FilterOptionKey,
  FilterOptions,
  OwnerOption,
  TenantOption,
  UnitOption,
} from "./options";
import { businessDay } from "@/lib/dates/business-day";

/**
 * How many of each a picker is sent. Far beyond what one office holds of
 * buildings, units or compounds; a list that is longer is cut here and said
 * to be cut, never silently.
 */
export const OPTION_LIMIT = 1500;

/** The list as it will be sent, and whether the limit cut it short. */
function capped<T>(rows: T[]): { rows: T[]; truncated: boolean } {
  return rows.length > OPTION_LIMIT
    ? { rows: rows.slice(0, OPTION_LIMIT), truncated: true }
    : { rows, truncated: false };
}

const day = (value: Date) => businessDay(value);

/**
 * The lists a page asked for, and no others.
 *
 * Owners and compounds are worked out from the buildings the reader holds,
 * so asking for any of buildings, owners or agreements reads the buildings
 * once; asking for tenants or contracts reads the contracts once.
 */
export async function loadFilterOptions(
  actor: ScopeActor,
  include: readonly FilterOptionKey[],
): Promise<FilterOptions> {
  const wants = new Set(include);
  const result: FilterOptions = {};
  const truncated: Partial<Record<FilterOptionKey, boolean>> = {};

  const needBuildings = wants.has("buildings") || wants.has("owners");

  const [buildingRows, compoundRows, unitRows, leaseRows, agreementRows] =
    await Promise.all([
      needBuildings
        ? db.property.findMany({
            where: withScope({ deletedAt: null }, propertyScope(actor)),
            select: {
              id: true,
              name: true,
              ownerId: true,
              compoundId: true,
              addressCity: true,
              addressDistrict: true,
              owner: {
                select: { id: true, firstName: true, lastName: true },
              },
            },
            orderBy: { name: "asc" },
            take: OPTION_LIMIT + 1,
          })
        : Promise.resolve(null),

      wants.has("compounds")
        ? db.compound.findMany({
            where: withScope({ deletedAt: null }, compoundScope(actor)),
            select: { id: true, name: true, code: true },
            orderBy: { name: "asc" },
            take: OPTION_LIMIT + 1,
          })
        : Promise.resolve(null),

      wants.has("units")
        ? db.unit.findMany({
            where: {
              deletedAt: null,
              property: withScope({ deletedAt: null }, propertyScope(actor)),
            },
            select: {
              id: true,
              unitNumber: true,
              propertyId: true,
              property: { select: { name: true } },
            },
            orderBy: [{ propertyId: "asc" }, { unitNumber: "asc" }],
            take: OPTION_LIMIT + 1,
          })
        : Promise.resolve(null),

      wants.has("contracts") || wants.has("tenants")
        ? db.lease.findMany({
            where: withScope({ deletedAt: null }, leaseScope(actor)),
            select: {
              id: true,
              contractNumber: true,
              status: true,
              startDate: true,
              endDate: true,
              propertyId: true,
              unitId: true,
              tenantId: true,
              property: { select: { name: true } },
              unit: { select: { unitNumber: true } },
              tenant: { select: { id: true, firstName: true, lastName: true } },
            },
            orderBy: { startDate: "desc" },
            take: OPTION_LIMIT + 1,
          })
        : Promise.resolve(null),

      wants.has("agreements")
        ? db.agreement.findMany({
            where: withScope({ deletedAt: null }, agreementScope(actor)),
            select: {
              id: true,
              agreementNumber: true,
              kind: true,
              status: true,
              ownerId: true,
              propertyId: true,
              compoundId: true,
              owner: { select: { firstName: true, lastName: true } },
              property: { select: { name: true } },
              compound: { select: { name: true } },
            },
            orderBy: { createdAt: "desc" },
            take: OPTION_LIMIT + 1,
          })
        : Promise.resolve(null),
    ]);

  // An owner that is a company is named by its company, as everywhere an owner
  // is picked — the owners the buildings name and the ones the agreements do.
  const ownerIds = new Set<string>();
  if (wants.has("owners")) {
    for (const row of buildingRows ?? []) ownerIds.add(row.ownerId);
  }
  for (const row of agreementRows ?? []) ownerIds.add(row.ownerId);
  const profiles = ownerIds.size
    ? await db.owner.findMany({
        where: { userId: { in: [...ownerIds] } },
        select: { userId: true, companyName: true },
      })
    : [];
  const companies = new Map(
    profiles
      .filter((profile) => profile.companyName)
      .map((profile) => [profile.userId, profile.companyName as string]),
  );

  // Buildings, and the owners who hold them.
  if (buildingRows) {
    const { rows, truncated: cut } = capped(buildingRows);

    if (wants.has("buildings")) {
      result.buildings = rows.map(
        (row): BuildingOption => ({
          id: row.id,
          label: row.name,
          hint:
            [row.addressDistrict, row.addressCity].filter(Boolean).join(" · ") ||
            null,
          compoundId: row.compoundId,
          ownerId: row.ownerId,
        }),
      );
      truncated.buildings = cut;
    }

    if (wants.has("owners")) {
      const people = new Map<string, string>();
      for (const row of rows) {
        if (row.owner) people.set(row.owner.id, joinFullName(row.owner));
      }
      result.owners = [...people.entries()]
        .map(
          ([id, name]): OwnerOption => ({
            id,
            label: companies.get(id) ?? name,
          }),
        )
        .sort((a, b) => a.label.localeCompare(b.label));
      // Derived from the buildings, so as complete as they are.
      truncated.owners = cut;
    }
  }

  if (compoundRows) {
    const { rows, truncated: cut } = capped(compoundRows);
    result.compounds = rows.map(
      (row): CompoundOption => ({
        id: row.id,
        label: row.code ? `${row.name} (${row.code})` : row.name,
      }),
    );
    truncated.compounds = cut;
  }

  if (unitRows) {
    const { rows, truncated: cut } = capped(unitRows);
    result.units = rows.map(
      (row): UnitOption => ({
        id: row.id,
        label: row.unitNumber,
        // Unit numbers repeat across buildings, so the building tells them apart.
        hint: row.property?.name ?? null,
        propertyId: row.propertyId,
      }),
    );
    truncated.units = cut;
  }

  if (leaseRows) {
    const { rows, truncated: cut } = capped(leaseRows);

    if (wants.has("contracts")) {
      result.contracts = rows.map(
        (row): ContractOption => ({
          id: row.id,
          label: row.contractNumber ?? "",
          tenantName: joinFullName(row.tenant),
          propertyName: row.property?.name ?? "",
          unitNumber: row.unit?.unitNumber ?? "",
          propertyId: row.propertyId,
          unitId: row.unitId,
          tenantId: row.tenantId,
          status: row.status,
          startDate: day(row.startDate),
          endDate: day(row.endDate),
        }),
      );
      truncated.contracts = cut;
    }

    if (wants.has("tenants")) {
      const seen = new Map<string, string>();
      for (const row of rows) {
        if (row.tenant && !seen.has(row.tenant.id)) {
          seen.set(row.tenant.id, joinFullName(row.tenant));
        }
      }
      result.tenants = [...seen.entries()]
        .map(([id, label]): TenantOption => ({ id, label }))
        .sort((a, b) => a.label.localeCompare(b.label));
      // Derived from the contracts, so as complete as they are.
      truncated.tenants = cut;
    }
  }

  if (agreementRows) {
    const { rows, truncated: cut } = capped(agreementRows);
    result.agreements = rows.map(
      (row): AgreementOption => ({
        id: row.id,
        label: row.agreementNumber ?? "",
        ownerName: companies.get(row.ownerId) ?? joinFullName(row.owner),
        scopeName: row.property?.name ?? row.compound?.name ?? "",
        ownerId: row.ownerId,
        propertyId: row.propertyId,
        compoundId: row.compoundId,
        status: row.status,
        kind: row.kind,
      }),
    );
    truncated.agreements = cut;
  }

  result.truncated = Object.fromEntries(
    Object.entries(truncated).filter(([, cut]) => cut),
  ) as Partial<Record<FilterOptionKey, boolean>>;

  return result;
}
