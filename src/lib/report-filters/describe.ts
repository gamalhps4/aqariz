import "server-only";

/**
 * PropertyPro - Which filters a report was run with, in words
 *
 * A downloaded report outlives the screen it came from, and "Owner statement,
 * 2026" does not say whose buildings it covers or which contract it was cut
 * to. This names what the request was narrowed by — "Building: Al Nakheel
 * Tower", "Tenant: Sara Ahmed" — so a file can say it on its face.
 *
 * Names are read through the reader's own scope. A filter that names a record
 * they may not see has already narrowed the report to nothing, and printing
 * who that record is would hand them what the scope withheld; it is simply
 * left out.
 *
 * Labels are the English words the export catalogue translates
 * (lib/reports/labels.ts), so the lines come out in the reader's language
 * like every other label on the sheet.
 *
 * Every export names its filters here — the report pages and the lists alike
 * — and hands the lines to `sheet.filtersSummary.filters`, so the block under
 * a file's title reads the same whichever screen it came from.
 */

import { db } from "@/lib/db/prisma";
import {
  agreementScope,
  compoundScope,
  leaseScope,
  ownerRecordScope,
  propertyScope,
  tenantRecordScope,
  withScope,
  type ScopeActor,
} from "@/lib/db/scopes";
import { joinFullName } from "@/lib/full-name";
import type { FilterIdKey } from "./params";

/** One line a report prints about how it was filtered. */
export type FilterLine = [label: string, value: string];

export interface DescribedFilters
  extends Partial<Record<FilterIdKey, string | null | undefined>> {
  /** A record's own status — a payment's, an agreement's — as stored. */
  status?: string | null;
}

/**
 * The lines for the filters a request carried, in the order the filter bar
 * shows them. Only the ones that resolved to a record the reader may see.
 */
export async function describeAppliedFilters(
  actor: ScopeActor,
  filters: DescribedFilters,
): Promise<FilterLine[]> {
  const [owner, compound, building, unit, tenant, lease, agreement] =
    await Promise.all([
      filters.ownerId
        ? db.user.findFirst({
            where: withScope({ id: filters.ownerId }, ownerRecordScope(actor)),
            select: { firstName: true, lastName: true },
          })
        : null,
      filters.compoundId
        ? db.compound.findFirst({
            where: withScope({ id: filters.compoundId }, compoundScope(actor)),
            select: { name: true },
          })
        : null,
      filters.propertyId
        ? db.property.findFirst({
            where: withScope({ id: filters.propertyId }, propertyScope(actor)),
            select: { name: true },
          })
        : null,
      filters.unitId
        ? db.unit.findFirst({
            where: {
              id: filters.unitId,
              property: withScope({ deletedAt: null }, propertyScope(actor)),
            },
            select: { unitNumber: true, property: { select: { name: true } } },
          })
        : null,
      filters.tenantId
        ? db.user.findFirst({
            where: withScope({ id: filters.tenantId }, tenantRecordScope(actor)),
            select: { firstName: true, lastName: true },
          })
        : null,
      filters.leaseId
        ? db.lease.findFirst({
            where: withScope({ id: filters.leaseId }, leaseScope(actor)),
            select: {
              contractNumber: true,
              tenant: { select: { firstName: true, lastName: true } },
              unit: { select: { unitNumber: true } },
            },
          })
        : null,
      filters.agreementId
        ? db.agreement.findFirst({
            where: withScope(
              { id: filters.agreementId },
              agreementScope(actor),
            ),
            select: { agreementNumber: true },
          })
        : null,
    ]);

  // An owner is named by their company when they have one.
  let ownerName = owner ? joinFullName(owner) : "";
  if (owner && filters.ownerId) {
    const profile = await db.owner.findFirst({
      where: { userId: filters.ownerId },
      select: { companyName: true },
    });
    if (profile?.companyName) ownerName = profile.companyName;
  }

  const lines: FilterLine[] = [];
  if (ownerName) lines.push(["Owner", ownerName]);
  if (compound) lines.push(["Compound", compound.name]);
  if (building) lines.push(["Building", building.name]);
  if (unit) {
    lines.push([
      "Unit",
      unit.property?.name
        ? `${unit.property.name} · ${unit.unitNumber}`
        : unit.unitNumber,
    ]);
  }
  if (tenant) {
    const name = joinFullName(tenant);
    if (name) lines.push(["Tenant", name]);
  }
  if (lease) {
    const value =
      lease.contractNumber ??
      [joinFullName(lease.tenant), lease.unit?.unitNumber]
        .filter(Boolean)
        .join(" · ");
    if (value) lines.push(["Contract", value]);
  }
  if (agreement) {
    lines.push(["Agreement", agreement.agreementNumber ?? "—"]);
  }
  if (filters.status) lines.push(["Status", filters.status]);
  return lines;
}
