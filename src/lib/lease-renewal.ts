/**
 * PropertyPro - What a renewal carries over
 *
 * A renewal is a new contract for the same unit and tenant. The route used to
 * copy only the `terms` JSON, so every column the contract module added since
 * fell back to its default: a 3,000 quarterly contract with VAT renewed as
 * 3,000 monthly without it. This decides the renewal's money in one place,
 * shared by the route and its tests.
 */

import {
  contractInstallmentShare,
  normalizeFrequency,
  type PaymentFrequencyKey,
} from "@/lib/lease-installments";
import {
  leaseContractAmount,
  leaseCurrency,
  leaseRentAmount,
  leaseSecurityDeposit,
} from "@/lib/lease-money";
import { LeaseStatus } from "@/types";

/**
 * The status a renewal starts in.
 *
 * Activated at once, it is in force: it takes the unit over and its
 * installments are billed there and then. Otherwise it waits as a draft for
 * review or signing, and is billed when it becomes active. Every renewal used
 * to start — and usually stay — a draft, which is how renewed contracts came
 * to have schedules nobody could collect against.
 */
export function renewalStatus(activate: boolean): LeaseStatus {
  return activate ? LeaseStatus.ACTIVE : LeaseStatus.DRAFT;
}

/** The contract being renewed, as its row reads. */
export interface RenewalSource {
  paymentFrequency?: unknown;
  rentAmount?: unknown;
  contractAmount?: unknown;
  securityDepositAmount?: unknown;
  electricityAmount?: unknown;
  waterAmount?: unknown;
  taxEnabled?: unknown;
  taxRate?: unknown;
  currency?: unknown;
  terms?: unknown;
}

/** What the renewal dialog changed; anything absent carries over. */
export interface RenewalOverrides {
  /** A total for the new term; null prices the renewal per installment. */
  contractAmount?: number | null;
  /** Rent per installment for the new term. */
  rentAmount?: number;
  securityDeposit?: number;
}

/** The renewal's contract columns, ready for `lease.create`. */
export interface RenewalContract {
  paymentFrequency: PaymentFrequencyKey;
  rentAmount: number;
  contractAmount: number | null;
  securityDepositAmount: number;
  electricityAmount: number;
  waterAmount: number;
  taxEnabled: boolean;
  taxRate: number;
  currency: string;
}

export function renewalContract(
  previous: RenewalSource,
  term: { startDate: Date | string; endDate: Date | string },
  overrides: RenewalOverrides = {},
): RenewalContract {
  const frequency = normalizeFrequency(previous.paymentFrequency);

  // How the renewal is priced: whatever the dialog stated, else the way the
  // old contract was written. A new rent per installment replaces a total.
  const contractAmount =
    overrides.contractAmount !== undefined
      ? overrides.contractAmount
      : overrides.rentAmount !== undefined
        ? null
        : leaseContractAmount(previous);

  // A carried-over total is divided over the NEW term, which need not be as
  // long as the old one; the dialog shows that split before anything is saved.
  const rentAmount =
    contractAmount !== null
      ? contractInstallmentShare({ ...term, frequency, contractAmount })
      : (overrides.rentAmount ?? leaseRentAmount(previous));

  const taxEnabled = Boolean(previous.taxEnabled);

  return {
    paymentFrequency: frequency,
    rentAmount,
    contractAmount,
    securityDepositAmount:
      overrides.securityDeposit ?? leaseSecurityDeposit(previous),
    electricityAmount: Number(previous.electricityAmount) || 0,
    waterAmount: Number(previous.waterAmount) || 0,
    taxEnabled,
    taxRate: taxEnabled ? Number(previous.taxRate) || 0 : 0,
    currency: leaseCurrency(previous),
  };
}
