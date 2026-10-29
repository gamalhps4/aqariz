/**
 * PropertyPro - One contract row of an import file
 *
 * A row describes one lease contract the way the office writes it down: who
 * (national ID / iqama, email or phone), where (building and unit), when
 * (start and end), for how much (the rent per installment, or the contract's
 * total), how often it falls due, the deposit and the status.
 *
 * The row becomes the same request body the contract form sends to
 * POST /api/leases (`leaseRequestBody`), checked by the same `leaseSchema`,
 * and the importer creates it through the same service the route uses
 * (lib/services/lease-creation.service.ts). This file only reads the cells
 * and keeps the file's own rows from colliding with each other.
 *
 * No database, so it can be tested; lib/import/importers.ts does the rest.
 */

import { LeaseStatus } from "@/types";
import {
  PAYMENT_FREQUENCIES,
  isPaymentFrequency,
  normalizeFrequency,
  type PaymentFrequencyKey,
} from "@/lib/lease-installments";
import { translateFor } from "@/lib/i18n/translate";
import { nameKey, readAmount, readDay, type RowProblem } from "./cells";
import { pick } from "./csv";
import {
  hasTenantKey,
  readTenantKeys,
  readUnitKeys,
  type TenantKeys,
  type UnitKeys,
} from "./match";

/** The statuses the contract form's API accepts on create. */
export const IMPORTABLE_LEASE_STATUSES = [
  LeaseStatus.ACTIVE,
  LeaseStatus.DRAFT,
  LeaseStatus.PENDING,
  LeaseStatus.EXPIRED,
  LeaseStatus.TERMINATED,
] as const;

export type ImportableLeaseStatus = (typeof IMPORTABLE_LEASE_STATUSES)[number];

export interface LeaseRowDraft {
  contractNumber: string | null;
  tenant: TenantKeys;
  unit: UnitKeys;
  /** Calendar days, "YYYY-MM-DD". */
  startDate: string;
  endDate: string;
  frequency: PaymentFrequencyKey;
  /** Rent per installment; null when the contract is priced as a total. */
  rentAmount: number | null;
  /** Rent for the whole term; null when priced per installment. */
  contractAmount: number | null;
  securityDeposit: number;
  status: ImportableLeaseStatus;
  notes?: string;
}

export type LeaseRowResult =
  | { ok: true; value: LeaseRowDraft; warnings: RowProblem[] }
  | { ok: false; issue: RowProblem };

/**
 * Words for each value, in English and as the app's own Arabic screens say
 * them, so a sheet filled in from the contract page reads back. Built from
 * the catalogue rather than written out, so a label reworded in
 * src/locales/ is still accepted here.
 */
function labelsFor(key: string): string[] {
  return ["en", "ar"].map((language) => nameKey(translateFor(language, key)));
}

const FREQUENCY_WORDS: ReadonlyMap<string, PaymentFrequencyKey> = (() => {
  const words = new Map<string, PaymentFrequencyKey>();
  for (const frequency of PAYMENT_FREQUENCIES) {
    for (const label of labelsFor(`leases.contract.frequency.${frequency}`)) {
      words.set(label, frequency);
    }
  }
  const extra: Array<[string, PaymentFrequencyKey]> = [
    ["month", "monthly"],
    ["quarter", "quarterly"],
    ["fourmonthly", "four_monthly"],
    ["every four months", "four_monthly"],
    ["كل اربعه اشهر", "four_monthly"],
    ["semiannual", "semi_annual"],
    ["semi annual", "semi_annual"],
    ["half yearly", "semi_annual"],
    ["biannual", "semi_annual"],
    ["yearly", "annual"],
    ["year", "annual"],
  ];
  for (const [word, frequency] of extra) words.set(nameKey(word), frequency);
  return words;
})();

/** A payment frequency: empty is monthly, as on the form; unknown is null. */
export function readFrequency(raw: string): PaymentFrequencyKey | null {
  const value = raw.trim();
  if (!value) return "monthly";
  const key = value.toLowerCase().replace(/[\s-]+/g, "_");
  if (isPaymentFrequency(key)) return normalizeFrequency(key);
  return FREQUENCY_WORDS.get(nameKey(value)) ?? null;
}

const STATUS_WORDS: ReadonlyMap<string, ImportableLeaseStatus> = (() => {
  const words = new Map<string, ImportableLeaseStatus>();
  for (const status of IMPORTABLE_LEASE_STATUSES) {
    for (const label of labelsFor(`leases.status.${status}`)) {
      words.set(label, status);
    }
  }
  return words;
})();

/** A contract status: empty is active, as the form creates it; unknown is null. */
export function readLeaseStatus(raw: string): ImportableLeaseStatus | null {
  const value = raw.trim();
  if (!value) return LeaseStatus.ACTIVE;
  const key = value.toLowerCase();
  const known = IMPORTABLE_LEASE_STATUSES.find((status) => status === key);
  return known ?? STATUS_WORDS.get(nameKey(value)) ?? null;
}

function dateProblem(column: string, raw: string): RowProblem {
  return raw.trim()
    ? {
        message: `"${raw.trim()}" in ${column} is not a date — write it as YYYY-MM-DD or DD/MM/YYYY`,
        code: "dateInvalid",
        values: { column, value: raw.trim() },
      }
    : {
        message: `Missing required ${column}`,
        code: "dateMissing",
        values: { column },
      };
}

function amountProblem(column: string, raw: string): RowProblem {
  return {
    message: `"${raw.trim()}" in ${column} is not an amount`,
    code: "amountInvalid",
    values: { column, value: raw.trim() },
  };
}

export function readLeaseRow(row: Record<string, string>): LeaseRowResult {
  const warnings: RowProblem[] = [];

  const tenant = readTenantKeys(row);
  if (!hasTenantKey(tenant)) {
    return {
      ok: false,
      issue: {
        message: "Give the tenant's national ID / iqama, email or phone",
        code: "tenantKeyMissing",
      },
    };
  }

  const unit = readUnitKeys(row);
  if (!unit.building || !unit.unitNumber) {
    return {
      ok: false,
      issue: {
        message: "Missing required building name and unit number",
        code: "unitKeyMissing",
      },
    };
  }

  const rawStart = pick(row, "startDate", "start", "leaseStart", "contractStart");
  const start = readDay(rawStart);
  if (!start.ok || !start.value) {
    return { ok: false, issue: dateProblem("startDate", rawStart) };
  }
  const rawEnd = pick(row, "endDate", "end", "leaseEnd", "contractEnd");
  const end = readDay(rawEnd);
  if (!end.ok || !end.value) {
    return { ok: false, issue: dateProblem("endDate", rawEnd) };
  }
  // The rule leaseSchema enforces, said in the file's terms.
  if (end.value <= start.value) {
    return {
      ok: false,
      issue: {
        message: "The end date must be after the start date",
        code: "endBeforeStart",
      },
    };
  }

  const rawFrequency = pick(row, "paymentFrequency", "frequency", "installmentFrequency");
  const frequency = readFrequency(rawFrequency);
  if (!frequency) {
    return {
      ok: false,
      issue: {
        message: `Unknown payment frequency "${rawFrequency}" — use monthly, quarterly, four_monthly, semi_annual or annual`,
        code: "frequencyInvalid",
        values: { value: rawFrequency },
      },
    };
  }

  const rawRent = pick(row, "rentAmount", "rent", "installmentAmount");
  const rent = readAmount(rawRent);
  if (!rent.ok) return { ok: false, issue: amountProblem("rentAmount", rawRent) };
  const rawTotal = pick(row, "contractAmount", "contractTotal", "totalAmount");
  const total = readAmount(rawTotal);
  if (!total.ok) {
    return { ok: false, issue: amountProblem("contractAmount", rawTotal) };
  }
  // Zero is not a price anyone writes on a contract; it reads as "not given",
  // exactly as the form treats an empty total (lib/lease-money.ts).
  const rentAmount = rent.value ? rent.value : null;
  const contractAmount = total.value ? total.value : null;
  if (rentAmount === null && contractAmount === null) {
    return {
      ok: false,
      issue: {
        message: "Give the rent per installment or the contract total",
        code: "rentMissing",
      },
    };
  }
  if (rentAmount !== null && contractAmount !== null) {
    warnings.push({
      message:
        "Both a rent and a contract total were given — the total is used and each installment worked out from it",
      code: "contractTotalUsed",
    });
  }

  const rawDeposit = pick(row, "securityDeposit", "deposit");
  const deposit = readAmount(rawDeposit);
  if (!deposit.ok) {
    return { ok: false, issue: amountProblem("securityDeposit", rawDeposit) };
  }

  const rawStatus = pick(row, "status", "leaseStatus", "contractStatus");
  const status = readLeaseStatus(rawStatus);
  if (!status) {
    return {
      ok: false,
      issue: {
        message: `Unknown status "${rawStatus}" — use active, draft, pending, expired or terminated`,
        code: "leaseStatusInvalid",
        values: { value: rawStatus },
      },
    };
  }

  return {
    ok: true,
    warnings,
    value: {
      contractNumber:
        pick(row, "contractNumber", "contractNo", "ejarContractNumber") || null,
      tenant,
      unit,
      startDate: start.value,
      endDate: end.value,
      frequency,
      rentAmount: contractAmount !== null ? null : rentAmount,
      contractAmount,
      securityDeposit: deposit.value ?? 0,
      status,
      notes: pick(row, "notes") || undefined,
    },
  };
}

/**
 * The body the contract form posts to POST /api/leases for this row, field
 * for field (components/lease/SimplifiedLeaseCreation.tsx `basePayload`):
 * no utilities, no tax, rent due when each period opens, and — unlike the
 * form's switch — no invoice emails, because an import must not message a
 * few hundred tenants on its own.
 */
export function leaseRequestBody(
  draft: LeaseRowDraft,
  ids: { propertyId: string; unitId: string; tenantId: string },
) {
  return {
    propertyId: ids.propertyId,
    unitId: ids.unitId,
    tenantId: ids.tenantId,
    contractNumber: draft.contractNumber,
    startDate: draft.startDate,
    endDate: draft.endDate,
    paymentFrequency: draft.frequency,
    electricityAmount: 0,
    waterAmount: 0,
    taxEnabled: false,
    taxRate: 0,
    contractAmount: draft.contractAmount,
    status: draft.status,
    terms: {
      rentAmount: draft.rentAmount ?? 0,
      securityDeposit: draft.securityDeposit,
      utilities: [],
      restrictions: [],
      paymentConfig: {
        rentDueDay: 1,
        autoGenerateInvoices: true,
        autoEmailInvoices: false,
        autoCreatePayments: true,
        prorationEnabled: true,
        advancePaymentMonths: 0,
      },
    },
    ...(draft.notes ? { notes: draft.notes } : {}),
  };
}

// ---------------------------------------------------------------------------
// Rows of the same file
// ---------------------------------------------------------------------------

export interface PlannedLease {
  /** Spreadsheet row number, for the message. */
  row: number;
  unitId: string;
  status: string;
  startDate: string;
  endDate: string;
  contractNumber: string | null;
}

/** Statuses that hold a unit's dates against another contract (findOverlappingLease). */
const HOLDS_DATES: readonly string[] = [LeaseStatus.ACTIVE, LeaseStatus.PENDING];

/**
 * The file's own rows, as the real run will meet them.
 *
 * A check reads the database as it is, where none of the file's contracts
 * exist yet; the real run creates them in order, so each row meets the ones
 * above it. Two rows for the same unit pass the check and then the second
 * one fails — exactly the surprise a check is for. This replays the rules
 * the service applies against earlier rows of the file:
 *
 *   - an active contract occupies its unit, and the service creates a
 *     contract only on an available unit;
 *   - an active or pending contract holds its dates, and another contract on
 *     the unit may not overlap them (start ≤ other end and end ≥ other start,
 *     as `findOverlappingLease` compares);
 *   - a contract number is used once.
 */
export class LeaseFilePlan {
  private readonly admitted: PlannedLease[] = [];

  /** Why this row would be refused after the rows admitted so far, or null. */
  conflict(lease: PlannedLease): RowProblem | null {
    for (const earlier of this.admitted) {
      // Compared as the service compares it: the trimmed text, exactly.
      if (
        lease.contractNumber &&
        lease.contractNumber.trim() === earlier.contractNumber?.trim()
      ) {
        return {
          message: `Contract number ${lease.contractNumber} is also on row ${earlier.row}`,
          code: "contractNumberDuplicateInFile",
          values: { number: lease.contractNumber, row: earlier.row },
        };
      }
      if (earlier.unitId !== lease.unitId) continue;
      if (earlier.status === LeaseStatus.ACTIVE) {
        return {
          message: `The unit is taken by the active contract on row ${earlier.row}`,
          code: "unitTakenInFile",
          values: { row: earlier.row },
        };
      }
      if (
        HOLDS_DATES.includes(earlier.status) &&
        earlier.startDate <= lease.endDate &&
        earlier.endDate >= lease.startDate
      ) {
        return {
          message: `The dates overlap the contract on row ${earlier.row} for the same unit`,
          code: "leaseOverlapInFile",
          values: { row: earlier.row },
        };
      }
    }
    return null;
  }

  admit(lease: PlannedLease): void {
    this.admitted.push(lease);
  }
}
