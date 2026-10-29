-- Owner profiles.
--
-- A profile ON a user, mirroring `tenants` — NOT a replacement for
-- properties.ownerId, which keeps pointing at users exactly as before. No
-- existing property row changes, and a landlord who manages their own
-- buildings never needs a row here.

-- CreateTable
CREATE TABLE "owners" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyName" TEXT,
    "nationalId" TEXT,
    "taxNumber" TEXT,
    "addressStreet" TEXT,
    "addressCity" TEXT,
    "addressCountry" TEXT,
    "payoutMethod" TEXT,
    "bankName" TEXT,
    "bankAccountName" TEXT,
    "bankIban" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "owners_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "owners_userId_key" ON "owners"("userId");
CREATE INDEX "owners_organizationId_idx" ON "owners"("organizationId");
CREATE INDEX "owners_organizationId_isActive_idx" ON "owners"("organizationId", "isActive");
CREATE INDEX "owners_deletedAt_idx" ON "owners"("deletedAt");

-- AddForeignKey
ALTER TABLE "owners" ADD CONSTRAINT "owners_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "owners" ADD CONSTRAINT "owners_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- ROW LEVEL SECURITY
-- Owner profiles carry bank details and tax numbers, so they get the same
-- fail-closed org_isolation policy every other tenant table carries.
-- ============================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['owners'] LOOP
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
