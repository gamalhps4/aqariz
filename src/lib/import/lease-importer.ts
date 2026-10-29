import "server-only";

/**
 * PropertyPro - Contract import
 *
 * Each row becomes a lease contract created by `createLease`
 * (lib/services/lease-creation.service.ts) — the service POST /api/leases
 * runs — from the body the contract form would have sent
 * (`leaseRequestBody`), validated by the route's own `leaseSchema`. So an
 * imported contract gets what a typed-in one gets: the overlap guard, the
 * rent worked out from a total, its installments and deposit billed, its
 * unit marked occupied and the property resynced. Nothing here writes a
 * lease row itself.
 *
 * The rules of importers.ts hold: the whole file is checked before anything
 * is written, a bad row is skipped and reported without stopping the rest,
 * and the plan's contract limit is asked once for the whole batch first.
 *
 * The check asks the service's own questions of every row
 * (`checkLeaseCreation`, read-only) and replays the file's rows against each
 * other (`LeaseFilePlan`), so what it reports is what the real run will do.
 */

import type { z } from "zod";
import { db } from "@/lib/db/prisma";
import { UserRole } from "@/types";
import { AuditAction, recordActivity } from "@/lib/audit-domain";
import { enforcePlanLimit } from "@/lib/billing/entitlements";
import { countLeases } from "@/lib/billing/usage";
import { propertyScope, withScope } from "@/lib/db/scopes";
import { leaseSchema, validateSchema } from "@/lib/validations";
import {
  LeaseCreationError,
  checkLeaseCreation,
  createLease,
  type LeaseCreateInput,
} from "@/lib/services/lease-creation.service";
import type { ParsedCsv } from "./csv";
import type { RowProblem } from "./cells";
import {
  addBuilding,
  matchTenant,
  matchUnit,
  tenantDirectory,
  unitDirectory,
  type UnitRecord,
} from "./match";
import {
  LeaseFilePlan,
  leaseRequestBody,
  readLeaseRow,
  type LeaseRowDraft,
} from "./lease-row";
import {
  emptyResult,
  rowNumber,
  type ImportActor,
  type ImportResult,
} from "./result";

/**
 * A refusal from the lease-creation service, in the import's words: its
 * code, the unit it is about, and its message as the route sends it.
 */
function creationProblem(
  error: LeaseCreationError,
  draft: LeaseRowDraft,
): RowProblem {
  return {
    message: error.message,
    // The row's tenant was found by the matcher, so the service's "not
    // found" means something else here: that person cannot hold a contract.
    code: error.code === "tenantNotFound" ? "tenantCannotLease" : error.code,
    values: {
      building: draft.unit.building,
      unit: draft.unit.unitNumber,
      number: draft.contractNumber ?? "",
    },
  };
}

function failure(error: unknown): RowProblem {
  const reason = error instanceof Error ? error.message : "Failed to import";
  return { message: reason, code: "failedBecause", values: { reason } };
}

export async function importLeases(
  table: ParsedCsv,
  actor: ImportActor,
  dryRun: boolean,
): Promise<ImportResult> {
  const { rows } = table;
  const result = emptyResult("leases", dryRun, rows.length);

  const drafts: Array<{ index: number; draft: LeaseRowDraft }> = [];
  rows.forEach((row, index) => {
    const read = readLeaseRow(row);
    if (!read.ok) {
      result.errors.push({ row: rowNumber(index), ...read.issue });
      return;
    }
    for (const warning of read.warnings) {
      result.warnings.push({ row: rowNumber(index), ...warning });
    }
    drafts.push({ index, draft: read.value });
  });

  if (drafts.length === 0) {
    result.skipped = result.totalRows;
    return result;
  }

  // Who and where, once for the whole file. Tenants are not narrowed to the
  // caller's buildings — the contract form does not narrow them either (a new
  // tenant has no building yet); buildings are, as the service narrows them.
  const [tenants, properties] = await Promise.all([
    db.user.findMany({
      where: { role: UserRole.TENANT, deletedAt: null },
      select: {
        id: true,
        email: true,
        phone: true,
        tenantProfile: { select: { idNumber: true } },
      },
    }),
    db.property.findMany({
      where: withScope({ deletedAt: null }, propertyScope(actor)),
      select: {
        id: true,
        name: true,
        units: {
          where: { deletedAt: null },
          select: { id: true, unitNumber: true, status: true },
        },
      },
    }),
  ]);
  const people = tenantDirectory(
    tenants.map((tenant) => ({
      id: tenant.id,
      email: tenant.email,
      phone: tenant.phone,
      idNumber: tenant.tenantProfile?.idNumber ?? null,
    })),
  );
  const places = unitDirectory(
    properties.flatMap((property) =>
      property.units.map(
        (unit): UnitRecord => ({
          id: unit.id,
          unitNumber: unit.unitNumber,
          status: unit.status,
          propertyId: property.id,
          propertyName: property.name,
        }),
      ),
    ),
  );
  properties.forEach((property) => addBuilding(places, property));

  const plan = new LeaseFilePlan();
  const ready: Array<{
    index: number;
    draft: LeaseRowDraft;
    leaseData: LeaseCreateInput;
  }> = [];

  for (const { index, draft } of drafts) {
    const row = rowNumber(index);

    const tenant = matchTenant(people, draft.tenant);
    if (!tenant.ok) {
      result.errors.push({ row, ...tenant.issue });
      continue;
    }
    const unit = matchUnit(places, draft.unit);
    if (!unit.ok) {
      result.errors.push({ row, ...unit.issue });
      continue;
    }

    // The route's validation, on the form's body: anything it would refuse
    // from the screen is refused from the file. (The schema transforms its
    // dates, so its input and output types differ; the output is the type.)
    const validation = validateSchema(
      leaseSchema as unknown as z.ZodSchema<LeaseCreateInput>,
      leaseRequestBody(draft, {
        propertyId: unit.unit.propertyId,
        unitId: unit.unit.id,
        tenantId: tenant.tenantId,
      }),
    );
    if (!validation.success) {
      const reason = validation.errors.join(", ");
      result.errors.push({
        row,
        message: reason,
        code: "failedBecause",
        values: { reason },
      });
      continue;
    }
    const leaseData = validation.data;

    const planned = {
      row,
      unitId: unit.unit.id,
      status: draft.status,
      startDate: draft.startDate,
      endDate: draft.endDate,
      contractNumber: draft.contractNumber,
    };
    const collision = plan.conflict(planned);
    if (collision) {
      result.errors.push({ row, ...collision });
      continue;
    }

    try {
      await checkLeaseCreation(actor, leaseData);
    } catch (error) {
      if (!(error instanceof LeaseCreationError)) throw error;
      result.errors.push({ row, ...creationProblem(error, draft) });
      continue;
    }

    // Admitted only once it would be created: a row that fails does not
    // hold its unit against the rows after it.
    plan.admit(planned);
    ready.push({ index, draft, leaseData });
  }

  result.errors.sort((a, b) => a.row - b.row);
  result.valid = ready.length;
  result.skipped = result.totalRows - ready.length;
  if (ready.length === 0) return result;

  // Checked before any write, as every importer does: an import must not be
  // a way around the plan.
  await enforcePlanLimit(
    actor.organizationId!,
    "leases",
    await countLeases(),
    ready.length,
  );

  if (dryRun) return result;

  for (const { index, draft, leaseData } of ready) {
    const row = rowNumber(index);
    try {
      // The service checks again: the rows before this one now exist.
      const { lease, invoiceGeneration } = await createLease(actor, leaseData);
      result.imported++;

      // Each contract in its own history, as one created on the form is;
      // the route adds one entry for the import as a whole.
      void recordActivity({
        action: AuditAction.CREATE,
        recordType: "lease",
        recordId: lease.id,
        recordName: lease.contractNumber ?? lease.id,
        description: "Created lease from an import file",
        after: {
          startDate: leaseData.startDate,
          endDate: leaseData.endDate,
          status: lease.status,
          tenantId: lease.tenantId,
          propertyId: lease.propertyId,
          unitId: lease.unitId,
        },
        details: { source: "import", row },
      });

      // Created and active, but not every installment could be billed: the
      // contract stands, and the schedule's "Generate installments" finishes
      // the job — said here rather than discovered later.
      if (invoiceGeneration && invoiceGeneration.errors.length > 0) {
        result.warnings.push({
          row,
          message: `The contract was created, but some installments were not billed: ${invoiceGeneration.errors.join("; ")}`,
          code: "billingIncomplete",
          values: { reason: invoiceGeneration.errors.join("; ") },
        });
      }
    } catch (error) {
      result.errors.push({
        row,
        ...(error instanceof LeaseCreationError
          ? creationProblem(error, draft)
          : failure(error)),
      });
    }
  }

  result.errors.sort((a, b) => a.row - b.row);
  result.skipped = result.totalRows - result.imported;
  return result;
}
