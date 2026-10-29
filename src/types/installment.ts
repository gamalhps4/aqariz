/**
 * PropertyPro - Lease installment client types
 *
 * Mirrors what `/api/leases/[id]/installments` returns. Kept separate from
 * the service so client components do not pull the Prisma client into the
 * browser bundle through a type import.
 */

import type { PaymentFrequencyKey } from "@/lib/lease-installments";

// One definition, re-exported: this was a hand-kept copy, and a copy is how
// a state gets renamed in one place and not the other. A type-only export
// pulls nothing into the browser bundle.
import type { InstallmentState } from "@/lib/lease-installment-state";
import type { ContractRights } from "@/lib/contract-rights";
export type { InstallmentState };

export interface InstallmentRow {
  /** Null while the contract calls for this installment but has not billed it. */
  invoiceId: string | null;
  invoiceNumber: string | null;
  /**
   * An installment's number in the contract's schedule: 1 to N by period, the
   * same whatever else is billed on the contract. A charge's place among the
   * contract's other charges.
   */
  index: number;
  periodStart: string | null;
  periodEnd: string | null;
  dueDate: string;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  amountPaid: number;
  balanceRemaining: number;
  state: InstallmentState;
  /**
   * "generated" and "planned" rows are the schedule's, billed or not;
   * "manual" charges were added by hand; "orphaned" ones were billed for a
   * period the contract's terms no longer have.
   */
  source: "generated" | "planned" | "manual" | "orphaned";
  prorated: boolean;
  description: string;
  /** The whole due day is over. On a row not billed yet, that is the warning. */
  dueDatePassed: boolean;
}

export interface InstallmentScheduleSummary {
  frequency: PaymentFrequencyKey;
  taxEnabled: boolean;
  taxRate: number;
  currency: string;
  /** Installments of the schedule, not counting cancelled ones or charges. */
  totalInstallments: number;
  generatedInstallments: number;
  paidCount: number;
  /** Everything late: installments and charges alike, as in `overdueTotal`. */
  overdueCount: number;
  upcomingCount: number;
  /** What the schedule's installments add up to — the contract itself. */
  contractValue: number;
  /** Charges outside the schedule that still stand. */
  chargesCount: number;
  chargesTotal: number;
  /** The money figures below cover installments and charges alike. */
  billedTotal: number;
  collectedTotal: number;
  outstandingTotal: number;
  overdueTotal: number;
}

/** What the viewer may do on the schedule — see lib/contract-rights.ts. */
export interface ScheduleViewerRights extends ContractRights {
  /** Download the schedule as a file. */
  exportSchedule: boolean;
}

export interface InstallmentSchedule {
  summary: InstallmentScheduleSummary;
  /** The contract's own schedule, one row per period, numbered 1 to N. */
  installments: InstallmentRow[];
  /** Everything else billed on the contract, oldest due first. */
  charges: InstallmentRow[];
  /** Sent by the API for the person asking; absent on older responses. */
  viewer?: ScheduleViewerRights;
}

/**
 * What billing a contract's installments produced. Every call that brings a
 * contract into force returns one (create, sign, status change, renewal), as
 * does the schedule's own "Generate installments" action. `errors` is what
 * could not be billed: the contract is active all the same, so the caller has
 * to say so rather than report a clean success.
 */
export interface InstallmentGenerationOutcome {
  invoicesGenerated: number;
  errors: string[];
}

/** What a contract still owes, split at a cut-off date (used by termination). */
export interface OutstandingSummary {
  outstandingTotal: number;
  overdueTotal: number;
  overdueCount: number;
  openInstallments: number;
  futureInstallments: number;
  futureTotal: number;
  currency: string;
}
