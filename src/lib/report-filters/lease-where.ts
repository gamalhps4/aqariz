/**
 * PropertyPro - Which contracts a leasing report lists
 *
 * The registers (lib/reports/report-where.ts) each decide which contracts
 * they are about; the review asks every one of them to be narrowed by owner,
 * compound, building, unit, tenant and contract as well. Those six are written
 * once here and AND-ed on, so no register can forget one — and, as in every
 * report, the rule they share is the one lib/db/scope-where.ts pins:
 *
 *     a filter narrows what the reader may see; it never replaces it.
 *
 * Owner and compound live on the building, so they filter through it.
 *
 * No database and no session here. The caller passes the reader's scope in as
 * the fragment lib/db/scopes.ts already made of it.
 */

import type { Prisma } from "@/generated/prisma/client";
import { withScope } from "@/lib/db/scope-where";
import {
  leaseReportWhere,
  type LeaseReportFilters,
} from "@/lib/reports/report-where";
import type { LeaseReportType } from "@/types/lease-report";

/** The record filters a contract register takes. */
export interface LeaseRecordFilters {
  ownerId?: string;
  compoundId?: string;
  propertyId?: string;
  unitId?: string;
  tenantId?: string;
  /** One contract. */
  leaseId?: string;
}

/**
 * The filters as a condition on contracts — the filters alone, with no
 * entitlement in it. Never run on its own: it is AND-ed with the reader's
 * scope by `leaseRegisterWhere`.
 */
export function leaseFilterWhere(
  filters: LeaseRecordFilters,
): Prisma.LeaseWhereInput {
  // Owner and compound are columns of the building, so they share one
  // relation filter rather than two that could each be satisfied by a
  // different row.
  const building: Prisma.PropertyWhereInput | undefined =
    filters.ownerId || filters.compoundId
      ? {
          ...(filters.ownerId ? { ownerId: filters.ownerId } : {}),
          ...(filters.compoundId ? { compoundId: filters.compoundId } : {}),
        }
      : undefined;

  return {
    ...(filters.leaseId ? { id: filters.leaseId } : {}),
    ...(filters.propertyId ? { propertyId: filters.propertyId } : {}),
    ...(filters.unitId ? { unitId: filters.unitId } : {}),
    ...(filters.tenantId ? { tenantId: filters.tenantId } : {}),
    ...(building ? { property: building } : {}),
  };
}

/**
 * Which contracts a register lists: its own rule and window, the filters
 * asked for, and the reader's entitlement — all AND-ed, in that order, so a
 * building or a contract the reader does not hold matches nothing rather than
 * being listed because it was named.
 *
 * The register's own owner and building filters are left unused: the
 * record filters above say the same thing for every register at once.
 */
export function leaseRegisterWhere(
  type: LeaseReportType,
  filters: LeaseRecordFilters,
  window: Omit<LeaseReportFilters, "propertyId" | "ownerId">,
  scope: Prisma.LeaseWhereInput,
): Prisma.LeaseWhereInput {
  return withScope(
    leaseReportWhere(type, window, scope),
    leaseFilterWhere(filters),
  );
}
