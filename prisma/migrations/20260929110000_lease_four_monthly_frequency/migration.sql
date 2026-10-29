-- Contracts can fall due every four months: three installments a year.
--
-- Widens the vocabulary guarded by 20260822180000_lease_contract_terms. Every
-- existing row already satisfies the new list, so this only relaxes the rule.
-- Agreements keep their own four-value check (agreements_fee_frequency_check).

ALTER TABLE "leases" DROP CONSTRAINT "leases_payment_frequency_check";
ALTER TABLE "leases" ADD CONSTRAINT "leases_payment_frequency_check"
  CHECK ("paymentFrequency" IN ('monthly','quarterly','four_monthly','semi_annual','annual'));
