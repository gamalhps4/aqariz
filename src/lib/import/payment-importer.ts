import "server-only";

/**
 * PropertyPro - Payment import
 *
 * Each row is money already received against an installment of an existing
 * contract, recorded by `recordInstallmentPayment`
 * (lib/services/payment-invoice-linking.service.ts) — the service behind the
 * "Record payment" dialog — with the method, day and reference from the
 * file and the importer as the member of staff who recorded it. So the
 * receipt is numbered, the installment's balance and status move, and the
 * office's books are posted exactly as for a payment typed at the desk.
 * Nothing here writes a payment row or touches a balance itself.
 *
 * The rules of importers.ts hold: the whole file is checked before anything
 * is written, a bad row is skipped and reported without stopping the rest.
 * The check asks the service's refusals of every row before the real run
 * does (`installmentPaymentRefusal`), with the rows above it counted, so a
 * file whose rows overpay an installment together is caught in the check.
 *
 * One difference from the desk, on purpose: the tenant is not sent an SMS
 * or WhatsApp receipt for each row. A file of last year's collections must
 * not text every tenant in it.
 */

import { db } from "@/lib/db/prisma";
import { PaymentStatus, UserRole } from "@/types";
import {
  invoiceScope,
  leaseScope,
  withScope,
} from "@/lib/db/scopes";
import { businessDay, businessToday, dateOnly } from "@/lib/dates/business-day";
import { recordInstallmentPayment } from "@/lib/services/payment-invoice-linking.service";
import type { ParsedCsv } from "./csv";
import { codeKey, type RowProblem } from "./cells";
import {
  addBuilding,
  hasTenantKey,
  matchTenant,
  matchUnit,
  tenantDirectory,
  unitDirectory,
  type TenantDirectory,
  type UnitDirectory,
  type UnitRecord,
} from "./match";
import {
  PaymentFilePlan,
  installmentPaymentRefusal,
  pickInstallment,
  readPaymentRow,
  type InstallmentRecord,
  type PaymentRowDraft,
} from "./payment-row";
import {
  emptyResult,
  rowNumber,
  type ImportActor,
  type ImportResult,
} from "./result";

interface ContractRecord {
  id: string;
  contractNumber: string | null;
  tenantId: string;
  unitId: string | null;
}

function failure(error: unknown): RowProblem {
  const reason = error instanceof Error ? error.message : "Failed to import";
  return { message: reason, code: "failedBecause", values: { reason } };
}

const mismatch = (label: string): RowProblem => ({
  message: `Contract ${label} is not this row's tenant or unit`,
  code: "contractMismatch",
  values: { number: label },
});

async function loadTenants(): Promise<TenantDirectory> {
  const tenants = await db.user.findMany({
    where: { role: UserRole.TENANT, deletedAt: null },
    select: {
      id: true,
      email: true,
      phone: true,
      tenantProfile: { select: { idNumber: true } },
    },
  });
  return tenantDirectory(
    tenants.map((tenant) => ({
      id: tenant.id,
      email: tenant.email,
      phone: tenant.phone,
      idNumber: tenant.tenantProfile?.idNumber ?? null,
    })),
  );
}

async function loadUnits(): Promise<UnitDirectory> {
  // Every building, not only the caller's: a unit is only used here to find
  // or check a contract, and the contracts themselves are scoped below.
  const properties = await db.property.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      name: true,
      units: {
        where: { deletedAt: null },
        select: { id: true, unitNumber: true, status: true },
      },
    },
  });
  const directory = unitDirectory(
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
  properties.forEach((property) => addBuilding(directory, property));
  return directory;
}

export async function importPayments(
  table: ParsedCsv,
  actor: ImportActor,
  dryRun: boolean,
): Promise<ImportResult> {
  const { rows } = table;
  const result = emptyResult("payments", dryRun, rows.length);
  const today = businessToday();

  const drafts: Array<{ index: number; draft: PaymentRowDraft }> = [];
  rows.forEach((row, index) => {
    const read = readPaymentRow(row, today);
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

  // Contracts the caller may record against — the record dialog reaches an
  // installment only through them — and, where rows name an installment by
  // number, those installments. Once for the whole file.
  const invoiceNumbers = [
    ...new Set(
      drafts.flatMap(({ draft }) =>
        draft.invoiceNumber
          ? [draft.invoiceNumber.trim(), draft.invoiceNumber.trim().toUpperCase()]
          : [],
      ),
    ),
  ];
  const needsTenants = drafts.some(({ draft }) => hasTenantKey(draft.tenant));
  const needsUnits = drafts.some(
    ({ draft }) => draft.unit.building && draft.unit.unitNumber,
  );
  const [contracts, numbered, people, places] = await Promise.all([
    db.lease.findMany({
      where: withScope({ deletedAt: null }, leaseScope(actor)),
      select: { id: true, contractNumber: true, tenantId: true, unitId: true },
    }),
    invoiceNumbers.length === 0
      ? Promise.resolve([])
      : db.invoice.findMany({
          where: withScope(
            { invoiceNumber: { in: invoiceNumbers }, deletedAt: null },
            invoiceScope(actor),
          ),
          select: { invoiceNumber: true, leaseId: true },
        }),
    needsTenants ? loadTenants() : Promise.resolve(null),
    needsUnits ? loadUnits() : Promise.resolve(null),
  ]);

  const contractById = new Map<string, ContractRecord>(
    contracts.map((contract) => [contract.id, contract]),
  );
  const contractsByNumber = new Map<string, ContractRecord[]>();
  for (const contract of contracts) {
    if (!contract.contractNumber) continue;
    const key = codeKey(contract.contractNumber);
    contractsByNumber.set(key, [...(contractsByNumber.get(key) ?? []), contract]);
  }
  const leaseOfInvoice = new Map(
    numbered.map((invoice) => [codeKey(invoice.invoiceNumber), invoice.leaseId]),
  );

  // Which contracts each row could mean.
  const located: Array<{
    index: number;
    draft: PaymentRowDraft;
    contracts: ContractRecord[];
  }> = [];
  for (const { index, draft } of drafts) {
    const row = rowNumber(index);
    const tenant =
      people && hasTenantKey(draft.tenant)
        ? matchTenant(people, draft.tenant)
        : null;
    const unit =
      places && draft.unit.building && draft.unit.unitNumber
        ? matchUnit(places, draft.unit)
        : null;

    let candidates: ContractRecord[];
    let label: string | null = null;
    if (draft.contractNumber) {
      label = draft.contractNumber.trim();
      candidates = contractsByNumber.get(codeKey(label)) ?? [];
      if (candidates.length === 0) {
        result.errors.push({
          row,
          message: `No contract numbered ${label}`,
          code: "contractNotFound",
          values: { number: label },
        });
        continue;
      }
    } else if (draft.invoiceNumber) {
      label = draft.invoiceNumber.trim();
      const key = codeKey(label);
      if (!leaseOfInvoice.has(key)) {
        result.errors.push({
          row,
          message: `No installment numbered ${label}`,
          code: "invoiceNotFound",
          values: { number: label },
        });
        continue;
      }
      const contract = contractById.get(leaseOfInvoice.get(key) ?? "");
      if (!contract) {
        result.errors.push({
          row,
          message: `${label} is not an installment of a contract`,
          code: "invoiceNotOnContract",
          values: { number: label },
        });
        continue;
      }
      candidates = [contract];
    } else {
      // Found by tenant and unit — readPaymentRow made sure both are there.
      if (!tenant?.ok) {
        result.errors.push({ row, ...tenant!.issue });
        continue;
      }
      if (!unit?.ok) {
        result.errors.push({ row, ...unit!.issue });
        continue;
      }
      candidates = contracts.filter(
        (contract) =>
          contract.tenantId === tenant.tenantId &&
          contract.unitId === unit.unit.id,
      );
      if (candidates.length === 0) {
        result.errors.push({
          row,
          message: `This tenant has no contract on ${draft.unit.building} ${draft.unit.unitNumber}`,
          code: "contractNotFoundForTenant",
          values: { building: draft.unit.building, unit: draft.unit.unitNumber },
        });
        continue;
      }
    }

    // A contract named by number, with a tenant or a unit beside it that
    // belongs to someone else, is a row put together from two lines of a
    // ledger; the money is not recorded on either.
    if (label) {
      if (tenant?.ok && !candidates.some((c) => c.tenantId === tenant.tenantId)) {
        result.errors.push({ row, ...mismatch(label) });
        continue;
      }
      if (unit?.ok && !candidates.some((c) => c.unitId === unit.unit.id)) {
        result.errors.push({ row, ...mismatch(label) });
        continue;
      }
    }

    located.push({ index, draft, contracts: candidates });
  }

  // The installments of every contract the rows could mean, and what has
  // been received on them already.
  const leaseIds = [
    ...new Set(located.flatMap((entry) => entry.contracts.map((c) => c.id))),
  ];
  const invoices =
    leaseIds.length === 0
      ? []
      : await db.invoice.findMany({
          where: withScope(
            {
              leaseId: { in: leaseIds },
              deletedAt: null,
              // A credit note is stored negative and is nobody's installment.
              totalAmount: { gt: 0 },
            },
            invoiceScope(actor),
          ),
          select: {
            id: true,
            invoiceNumber: true,
            leaseId: true,
            dueDate: true,
            status: true,
            category: true,
            balanceRemaining: true,
            tenantId: true,
            propertyId: true,
          },
        });
  const installmentsByLease = new Map<string, InstallmentRecord[]>();
  for (const invoice of invoices) {
    const record: InstallmentRecord = {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      leaseId: invoice.leaseId,
      dueDay: businessDay(invoice.dueDate),
      status: invoice.status,
      category: invoice.category,
      balanceRemaining: Number(invoice.balanceRemaining),
      tenantId: invoice.tenantId,
      propertyId: invoice.propertyId,
    };
    const key = invoice.leaseId ?? "";
    installmentsByLease.set(key, [...(installmentsByLease.get(key) ?? []), record]);
  }

  const received =
    invoices.length === 0
      ? []
      : await db.payment.findMany({
          where: {
            invoiceId: { in: invoices.map((invoice) => invoice.id) },
            deletedAt: null,
            status: { in: [PaymentStatus.PAID, PaymentStatus.PARTIAL] },
          },
          select: { invoiceId: true, amount: true, amountPaid: true, paidDate: true },
        });
  const alreadyRecorded = new Set(
    received.map((payment) =>
      [
        payment.invoiceId,
        Number(payment.amountPaid ?? payment.amount).toFixed(2),
        businessDay(payment.paidDate),
      ].join("|"),
    ),
  );

  const plan = new PaymentFilePlan();
  const ready: Array<{
    index: number;
    draft: PaymentRowDraft;
    installment: InstallmentRecord;
  }> = [];
  for (const { index, draft, contracts: candidates } of located) {
    const row = rowNumber(index);
    const picked = pickInstallment(
      candidates.flatMap((contract) => installmentsByLease.get(contract.id) ?? []),
      { invoiceNumber: draft.invoiceNumber, dueDate: draft.dueDate },
    );
    if (!picked.ok) {
      result.errors.push({ row, ...picked.issue });
      continue;
    }
    const { installment } = picked;

    const refusal = installmentPaymentRefusal(
      installment,
      draft.amount,
      plan.plannedOn(installment.id),
    );
    if (refusal) {
      result.errors.push({ row, ...refusal });
      continue;
    }

    // Recorded all the same — two equal payments on one day happen — but
    // said, because a file imported twice looks exactly like this.
    const earlierRow = plan.repeats(installment.id, draft);
    if (earlierRow !== null) {
      result.warnings.push({
        row,
        message: `Same installment, amount, day and reference as row ${earlierRow}`,
        code: "paymentRepeatsRow",
        values: { row: earlierRow },
      });
    } else if (
      alreadyRecorded.has(
        [installment.id, draft.amount.toFixed(2), draft.paidDate].join("|"),
      )
    ) {
      result.warnings.push({
        row,
        message: `A payment of ${draft.amount.toFixed(2)} on ${draft.paidDate} is already recorded on installment ${installment.invoiceNumber}`,
        code: "paymentMayRepeat",
        values: {
          amount: draft.amount.toFixed(2),
          date: draft.paidDate,
          number: installment.invoiceNumber,
        },
      });
    }

    plan.admit(installment.id, draft, row);
    ready.push({ index, draft, installment });
  }

  result.errors.sort((a, b) => a.row - b.row);
  result.warnings.sort((a, b) => a.row - b.row);
  result.valid = ready.length;
  result.skipped = result.totalRows - ready.length;
  if (dryRun || ready.length === 0) return result;

  for (const { index, draft, installment } of ready) {
    try {
      // The record dialog's path, row by row: each payment is its own
      // transaction, so one refused (the installment changed since the
      // check) leaves the others recorded.
      await recordInstallmentPayment({
        invoiceId: installment.id,
        amount: draft.amount,
        paymentMethod: draft.paymentMethod,
        // A calendar day, stored as date-only values are: midnight UTC, the
        // same day on the office's calendar (lib/dates/business-day.ts).
        paidDate: dateOnly(draft.paidDate),
        reference: draft.reference,
        notes: draft.notes,
        recordedBy: actor.id,
        notifyTenant: false,
      });
      result.imported++;
    } catch (error) {
      result.errors.push({ row: rowNumber(index), ...failure(error) });
    }
  }

  result.errors.sort((a, b) => a.row - b.row);
  result.skipped = result.totalRows - result.imported;
  return result;
}
