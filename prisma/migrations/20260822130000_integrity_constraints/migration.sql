-- Data-integrity constraints surfaced by the 2026-08-22 audit.
--
-- If any CREATE UNIQUE INDEX below fails, existing rows already violate the
-- invariant (e.g. two active leases on one unit, or duplicate generated
-- invoices) — resolve those rows first, then re-run the migration.

-- ============================================================================
-- Invoices: billing-period dedupe + optimistic locking
-- ============================================================================

-- First day of the billing period a generated invoice covers.
ALTER TABLE "invoices" ADD COLUMN "periodStart" TIMESTAMP(3);

-- Optimistic-concurrency column, mirroring payments.version. Every
-- balance-affecting write should claim the row via UPDATE ... WHERE version =
-- <read version> and increment it.
ALTER TABLE "invoices" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;

-- One generated invoice per lease per category per billing period. The
-- generators previously had no idempotency at all: re-running lease invoice
-- generation double-billed every month of the lease.
CREATE UNIQUE INDEX invoices_period_per_lease_unique
  ON invoices ("leaseId", category, "periodStart")
  WHERE "leaseId" IS NOT NULL
    AND "periodStart" IS NOT NULL
    AND "deletedAt" IS NULL;

-- ============================================================================
-- Leases: one active lease per unit, enforced by the database
-- ============================================================================

CREATE UNIQUE INDEX leases_one_active_per_unit
  ON leases ("unitId")
  WHERE status = 'active' AND "deletedAt" IS NULL;

-- ============================================================================
-- Payments: extend generation dedupe beyond type='rent'
-- ============================================================================

-- One deposit charge per lease per deposit type (setupLeasePaymentSystem
-- retries previously duplicated security/pet deposits).
CREATE UNIQUE INDEX payments_deposit_per_lease_unique
  ON payments ("leaseId", type)
  WHERE "leaseId" IS NOT NULL
    AND "deletedAt" IS NULL
    AND type IN ('security_deposit', 'pet_deposit');

-- One late-fee payment per parent payment (overlapping cron runs previously
-- created duplicate fees; fee payments must set "parentPaymentId").
CREATE UNIQUE INDEX payments_late_fee_per_parent_unique
  ON payments ("parentPaymentId")
  WHERE type = 'late_fee'
    AND "parentPaymentId" IS NOT NULL
    AND "deletedAt" IS NULL;
