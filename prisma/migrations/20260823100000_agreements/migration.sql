-- Management agreements: the contract between a property owner and the
-- management office, and the basis on which the office earns commission.

-- CreateTable
CREATE TABLE "agreements" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'management',
    "agreementNumber" TEXT,
    "ownerId" TEXT NOT NULL,
    "propertyId" TEXT,
    "compoundId" TEXT,
    "feeType" TEXT NOT NULL DEFAULT 'percentage',
    "feePercentage" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "feeAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "feeFrequency" TEXT NOT NULL DEFAULT 'monthly',
    "commissionBasis" TEXT NOT NULL DEFAULT 'collected',
    "currency" TEXT NOT NULL DEFAULT 'SAR',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "documents" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "terminatedDate" TIMESTAMP(3),
    "terminationReason" TEXT,
    "createdById" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agreements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agreements_organizationId_idx" ON "agreements"("organizationId");
CREATE INDEX "agreements_organizationId_status_idx" ON "agreements"("organizationId", "status");
CREATE INDEX "agreements_ownerId_status_idx" ON "agreements"("ownerId", "status");
CREATE INDEX "agreements_propertyId_status_idx" ON "agreements"("propertyId", "status");
CREATE INDEX "agreements_compoundId_status_idx" ON "agreements"("compoundId", "status");
CREATE INDEX "agreements_organizationId_agreementNumber_idx" ON "agreements"("organizationId", "agreementNumber");
CREATE INDEX "agreements_deletedAt_idx" ON "agreements"("deletedAt");
CREATE INDEX "agreements_createdAt_idx" ON "agreements"("createdAt" DESC);

-- An agreement number identifies one agreement inside an organization.
-- Partial so the many rows without one do not collide, and so a soft-deleted
-- agreement releases its number.
CREATE UNIQUE INDEX "agreements_org_number_active_unique"
    ON "agreements"("organizationId", "agreementNumber")
    WHERE "agreementNumber" IS NOT NULL AND "deletedAt" IS NULL;

-- AddForeignKey
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Detaching, never cascading: removing a property or compound must not erase
-- the commercial history of what the office was owed on it.
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_propertyId_fkey"
    FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_compoundId_fkey"
    FOREIGN KEY ("compoundId") REFERENCES "compounds"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Guard the vocabularies at the database, not only in zod: the commission
-- engine switches on these, and an unknown value would silently compute no
-- commission at all rather than failing loudly.
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_fee_type_check"
    CHECK ("feeType" IN ('percentage','fixed'));
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_fee_frequency_check"
    CHECK ("feeFrequency" IN ('monthly','quarterly','semi_annual','annual'));
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_commission_basis_check"
    CHECK ("commissionBasis" IN ('collected','billed'));
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_status_check"
    CHECK ("status" IN ('draft','active','expired','terminated'));

-- A percentage fee outside 0–100 is a data-entry error that would otherwise
-- be silently charged against an owner's payout.
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_fee_percentage_range_check"
    CHECK ("feePercentage" >= 0 AND "feePercentage" <= 100);
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_fee_amount_check"
    CHECK ("feeAmount" >= 0);

-- An agreement cannot end before it starts.
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_date_order_check"
    CHECK ("endDate" IS NULL OR "endDate" > "startDate");

-- An agreement is scoped to a property OR a compound OR (neither) the owner's
-- whole portfolio — never to both a property and a compound at once, which
-- would make its precedence ambiguous.
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_single_scope_check"
    CHECK (NOT ("propertyId" IS NOT NULL AND "compoundId" IS NOT NULL));

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['agreements'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY org_isolation ON %I USING (
         current_setting(''app.bypass_rls'', true) = ''on''
         OR "organizationId" = current_setting(''app.current_org_id'', true)
       ) WITH CHECK (
         current_setting(''app.bypass_rls'', true) = ''on''
         OR "organizationId" = current_setting(''app.current_org_id'', true)
       )', t);
  END LOOP;
END $$;
