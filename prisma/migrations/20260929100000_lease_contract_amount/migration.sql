-- A lease contract can state its rent as one figure for the whole term
-- ("Lease Amount 12,000 [Total]") instead of an amount per installment.
--
-- Nullable with no default: every existing contract stays NULL, which means
-- "priced per installment", so no schedule changes. When set, the installment
-- planner splits it equally across the installments with the remainder on the
-- last one, and "rentAmount" holds the regular share.

-- AlterTable
ALTER TABLE "leases" ADD COLUMN "contractAmount" DECIMAL(14,2);
