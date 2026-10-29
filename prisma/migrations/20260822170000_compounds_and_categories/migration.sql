-- Compounds / residential complexes and extendable property + unit categories.
--
-- Property.type and Unit.unitType are already free-text columns; the new
-- property_categories table supplies the *selectable list* for them keyed by
-- slug, so no data migration is required and existing rows keep their values.

-- CreateTable
CREATE TABLE "property_categories" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'property',
    "slug" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "property_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compounds" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "description" TEXT,
    "addressStreet" TEXT NOT NULL,
    "addressCity" TEXT NOT NULL,
    "addressState" TEXT NOT NULL,
    "addressZipCode" TEXT NOT NULL,
    "addressCountry" TEXT NOT NULL DEFAULT 'Saudi Arabia',
    "totalArea" DOUBLE PRECISION,
    "yearBuilt" INTEGER,
    "amenities" JSONB NOT NULL DEFAULT '[]',
    "images" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "ownerId" TEXT,
    "managerId" TEXT,
    "notes" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "compounds_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "properties" ADD COLUMN "compoundId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "property_categories_organizationId_kind_slug_key"
    ON "property_categories"("organizationId", "kind", "slug");
CREATE INDEX "property_categories_organizationId_kind_isActive_sortOrder_idx"
    ON "property_categories"("organizationId", "kind", "isActive", "sortOrder");
CREATE INDEX "property_categories_deletedAt_idx" ON "property_categories"("deletedAt");

CREATE INDEX "compounds_organizationId_idx" ON "compounds"("organizationId");
CREATE INDEX "compounds_organizationId_name_idx" ON "compounds"("organizationId", "name");
CREATE INDEX "compounds_ownerId_idx" ON "compounds"("ownerId");
CREATE INDEX "compounds_managerId_idx" ON "compounds"("managerId");
CREATE INDEX "compounds_deletedAt_idx" ON "compounds"("deletedAt");
CREATE INDEX "compounds_createdAt_idx" ON "compounds"("createdAt" DESC);

CREATE INDEX "properties_compoundId_idx" ON "properties"("compoundId");

-- A compound code, when present, must be unique inside the organization.
-- Partial so the many rows without a code do not collide, and so a
-- soft-deleted compound frees its code for reuse.
CREATE UNIQUE INDEX "compounds_org_code_active_unique"
    ON "compounds"("organizationId", "code")
    WHERE "code" IS NOT NULL AND "deletedAt" IS NULL;

-- AddForeignKey
ALTER TABLE "property_categories" ADD CONSTRAINT "property_categories_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "compounds" ADD CONSTRAINT "compounds_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "compounds" ADD CONSTRAINT "compounds_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "compounds" ADD CONSTRAINT "compounds_managerId_fkey"
    FOREIGN KEY ("managerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Detaching, never cascading: deleting a compound must leave its properties
-- (and everything hanging off them) intact and independently manageable.
ALTER TABLE "properties" ADD CONSTRAINT "properties_compoundId_fkey"
    FOREIGN KEY ("compoundId") REFERENCES "compounds"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- ROW LEVEL SECURITY
-- Both new tables are org-scoped, so they get the same fail-closed
-- org_isolation policy every other tenant table carries. Without this the
-- Prisma client's set_config would be stamped but nothing would enforce it.
-- ============================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['compounds','property_categories'] LOOP
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
