-- Two consolidations from the 2026-08-22 audit:
--  1. Lease money becomes real columns (backfilled from the terms JSON).
--  2. Sensitive tenant PII (ssn / employmentInfo / creditScore) gets a single
--     home on the tenants profile table; the duplicate users columns are
--     dropped after backfill.

-- ============================================================================
-- 1. Lease money columns
-- ============================================================================

ALTER TABLE "leases" ADD COLUMN "rentAmount" DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "leases" ADD COLUMN "securityDepositAmount" DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "leases" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'USD';

-- Backfill from the terms JSON. Non-numeric junk (from the old untyped
-- writes) falls back to 0 rather than aborting the migration.
UPDATE "leases" SET
  "rentAmount" = COALESCE(
    CASE WHEN terms->>'rentAmount' ~ '^-?[0-9]+(\.[0-9]+)?$'
         THEN (terms->>'rentAmount')::numeric(14,2) END, 0),
  "securityDepositAmount" = COALESCE(
    CASE WHEN terms->>'securityDeposit' ~ '^-?[0-9]+(\.[0-9]+)?$'
         THEN (terms->>'securityDeposit')::numeric(14,2) END, 0);

-- ============================================================================
-- 2. Tenant PII single home
-- ============================================================================

-- Upsert users' PII into the tenants profile. Existing profile values win
-- (the update path has been writing there, so they are the fresher copy);
-- the users copy only fills gaps.
INSERT INTO "tenants" (
  "id", "organizationId", "userId", "ssn", "employmentInfo", "creditScore",
  "applicationDate", "createdAt", "updatedAt"
)
SELECT
  'tprof_' || md5(u."id"),
  u."organizationId", u."id", u."ssn", u."employmentInfo", u."creditScore",
  COALESCE(u."applicationDate", u."createdAt"), now(), now()
FROM "users" u
WHERE u."role" = 'tenant'
  AND u."organizationId" IS NOT NULL
  AND (u."ssn" IS NOT NULL OR u."employmentInfo" IS NOT NULL OR u."creditScore" IS NOT NULL)
ON CONFLICT ("userId") DO UPDATE SET
  "ssn" = COALESCE("tenants"."ssn", EXCLUDED."ssn"),
  "employmentInfo" = COALESCE("tenants"."employmentInfo", EXCLUDED."employmentInfo"),
  "creditScore" = COALESCE("tenants"."creditScore", EXCLUDED."creditScore"),
  "updatedAt" = now();

ALTER TABLE "users" DROP COLUMN "ssn";
ALTER TABLE "users" DROP COLUMN "employmentInfo";
ALTER TABLE "users" DROP COLUMN "creditScore";
