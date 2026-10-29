"use client";

/**
 * A contract's rent the way the contract states it: what each installment
 * bills, and how often.
 *
 * The lease lists used to print the unit's listed price with "per month"
 * under it — wrong twice over for a quarterly contract agreed below the list
 * price. The contract is the source of the rent; the unit's price is at most
 * a reference.
 */

import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { FREQUENCY_LABELS, normalizeFrequency } from "@/lib/lease-installments";
import { leaseRentAmount } from "@/lib/lease-money";

export interface ContractRentSource {
  rentAmount?: unknown;
  paymentFrequency?: unknown;
  terms?: unknown;
}

/** The contract's frequency in the reader's language ("Quarterly"). */
export function useFrequencyLabel() {
  const { t } = useLocalizationContext();
  return (lease: ContractRentSource) => {
    const frequency = normalizeFrequency(lease.paymentFrequency);
    return t(`leases.contract.frequency.${frequency}`, {
      defaultValue: FREQUENCY_LABELS[frequency],
    });
  };
}

export function ContractRent({ lease }: { lease: ContractRentSource }) {
  const { formatCurrency } = useLocalizationContext();
  const frequencyLabel = useFrequencyLabel();

  return (
    <div>
      <div className="font-medium">{formatCurrency(leaseRentAmount(lease))}</div>
      <div className="text-sm text-muted-foreground">
        {frequencyLabel(lease)}
      </div>
    </div>
  );
}
