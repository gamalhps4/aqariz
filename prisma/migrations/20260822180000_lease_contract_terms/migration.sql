-- Lease contract enhancements: electronic contract number, installment
-- frequency, and per-contract tax.
--
-- All four columns carry defaults that reproduce today's behaviour exactly
-- (monthly installments, no tax), so existing leases are unaffected until an
-- operator changes them.

-- AlterTable
ALTER TABLE "leases"
  ADD COLUMN "contractNumber"   TEXT,
  ADD COLUMN "paymentFrequency" TEXT NOT NULL DEFAULT 'monthly',
  ADD COLUMN "taxEnabled"       BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "taxRate"          DECIMAL(6,3) NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "leases_organizationId_contractNumber_idx"
  ON "leases"("organizationId", "contractNumber");

-- An electronic contract number identifies exactly one lease inside an
-- organization. Partial so the many historical rows without one do not
-- collide, and so a soft-deleted lease releases its number.
CREATE UNIQUE INDEX "leases_org_contract_number_active_unique"
  ON "leases"("organizationId", "contractNumber")
  WHERE "contractNumber" IS NOT NULL AND "deletedAt" IS NULL;

-- Guard the frequency vocabulary at the database, not only in zod: the
-- installment generator switches on this value and an unknown one would
-- silently produce no installments at all.
ALTER TABLE "leases" ADD CONSTRAINT "leases_payment_frequency_check"
  CHECK ("paymentFrequency" IN ('monthly','quarterly','semi_annual','annual'));

-- A tax rate is a percentage; anything outside 0–100 is a data-entry error
-- that would otherwise be silently billed to a tenant.
ALTER TABLE "leases" ADD CONSTRAINT "leases_tax_rate_range_check"
  CHECK ("taxRate" >= 0 AND "taxRate" <= 100);
