-- Property listings: the Marketing section's Property Listing module.
--
-- An office advertises a vacant unit on its own public page
-- (/o/{organization slug}/{listing slug}) and works the messages that come
-- back from it in an inbox. Two new tables, nothing existing is altered:
--
--   listings           the advertisement: one unit, for rent or for sale, with
--                      its bilingual title and description, price and what it
--                      is per, photos, amenities, contact numbers and the REGA
--                      advertising licence (رقم ترخيص الإعلان) with its expiry;
--   listing_inquiries  a message from a listing's public page, with the
--                      office's status, assignee and notes.
--
-- Additive and self-contained: the application reads neither table anywhere
-- else, so code that does not know them keeps working, and an office with no
-- listings is untouched.
--
-- Rules the pages rely on are held here, not only in the application:
--   * a slug is URL-safe and unique inside the office;
--   * one live (not archived) ad per unit and type, so a unit is never
--     advertised twice for the same thing;
--   * a rent is quoted per month, quarter, half year or year; a sale is total;
--   * a PUBLISHED listing carries a licence number and its expiry day. (That
--     the day has not passed is time-dependent, so the application checks it
--     when publishing and the public read path checks it on every request.)

-- ============================================================================
-- listings
-- ============================================================================
CREATE TABLE "listings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'rent',
    "slug" TEXT NOT NULL,
    "titleAr" TEXT NOT NULL DEFAULT '',
    "titleEn" TEXT NOT NULL DEFAULT '',
    "descriptionAr" TEXT,
    "descriptionEn" TEXT,
    "price" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'SAR',
    "pricePeriod" TEXT NOT NULL DEFAULT 'monthly',
    "photos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "amenities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "city" TEXT,
    "district" TEXT,
    "contactPhone" TEXT,
    "whatsappNumber" TEXT,
    "adLicenceNumber" TEXT,
    "adLicenceExpiry" DATE,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "publishedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "listings_pkey" PRIMARY KEY ("id")
);

-- A slug names one listing inside one office.
CREATE UNIQUE INDEX "listings_organizationId_slug_key"
    ON "listings"("organizationId", "slug");

CREATE INDEX "listings_organizationId_status_idx"
    ON "listings"("organizationId", "status");
CREATE INDEX "listings_organizationId_createdAt_idx"
    ON "listings"("organizationId", "createdAt" DESC);
CREATE INDEX "listings_unitId_idx" ON "listings"("unitId");
CREATE INDEX "listings_propertyId_idx" ON "listings"("propertyId");

-- One live advertisement per unit and type. Archiving one frees the unit for
-- the next; a draft counts, so two people cannot start the same ad at once.
CREATE UNIQUE INDEX "listings_unit_type_live_unique"
    ON "listings"("unitId", "type")
    WHERE "status" <> 'archived';

ALTER TABLE "listings" ADD CONSTRAINT "listings_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Removing a building or a unit for good (the archive's purge) takes its ads
-- with it; archiving one only hides them, through the unit's own status.
ALTER TABLE "listings" ADD CONSTRAINT "listings_propertyId_fkey"
    FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "listings" ADD CONSTRAINT "listings_unitId_fkey"
    FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "listings" ADD CONSTRAINT "listings_type_check"
    CHECK ("type" IN ('rent','sale'));
ALTER TABLE "listings" ADD CONSTRAINT "listings_status_check"
    CHECK ("status" IN ('draft','published','archived'));
ALTER TABLE "listings" ADD CONSTRAINT "listings_price_period_check"
    CHECK ("pricePeriod" IN ('monthly','quarterly','semi_annual','annual','total'));
-- A sale is one price for the property; a rent is a price per period.
ALTER TABLE "listings" ADD CONSTRAINT "listings_period_type_check"
    CHECK (
      ("type" = 'sale' AND "pricePeriod" = 'total')
      OR ("type" = 'rent' AND "pricePeriod" <> 'total')
    );
ALTER TABLE "listings" ADD CONSTRAINT "listings_price_check"
    CHECK ("price" >= 0 AND "price" <= 100000000);
-- Safe in a URL, and a length a person can read out.
ALTER TABLE "listings" ADD CONSTRAINT "listings_slug_check"
    CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length("slug") BETWEEN 3 AND 60);
-- The advertising licence: no published listing without its number and its
-- expiry day. Not-expired is checked by the application, which has a clock.
ALTER TABLE "listings" ADD CONSTRAINT "listings_published_licence_check"
    CHECK (
      "status" <> 'published'
      OR (
        "adLicenceNumber" IS NOT NULL
        AND btrim("adLicenceNumber") <> ''
        AND "adLicenceExpiry" IS NOT NULL
      )
    );

-- ============================================================================
-- listing_inquiries
-- ============================================================================
CREATE TABLE "listing_inquiries" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "assigneeId" TEXT,
    "notes" TEXT,
    "sourceIpHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "listing_inquiries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "listing_inquiries_organizationId_status_createdAt_idx"
    ON "listing_inquiries"("organizationId", "status", "createdAt" DESC);
CREATE INDEX "listing_inquiries_listingId_idx" ON "listing_inquiries"("listingId");
CREATE INDEX "listing_inquiries_assigneeId_idx" ON "listing_inquiries"("assigneeId");

ALTER TABLE "listing_inquiries" ADD CONSTRAINT "listing_inquiries_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- An inquiry belongs to its listing and goes with it.
ALTER TABLE "listing_inquiries" ADD CONSTRAINT "listing_inquiries_listingId_fkey"
    FOREIGN KEY ("listingId") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- A leaver's inquiries are not lost, only unassigned.
ALTER TABLE "listing_inquiries" ADD CONSTRAINT "listing_inquiries_assigneeId_fkey"
    FOREIGN KEY ("assigneeId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "listing_inquiries" ADD CONSTRAINT "listing_inquiries_status_check"
    CHECK ("status" IN ('new','contacted','closed'));
ALTER TABLE "listing_inquiries" ADD CONSTRAINT "listing_inquiries_contact_check"
    CHECK (btrim("name") <> '' AND btrim("phone") <> '');

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
-- Same policy as every org-owned table: a request bound to an organization
-- sees and writes that organization's rows; the bypass (the public inquiry
-- route, which has no organization of its own, and platform jobs) sees all.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['listings','listing_inquiries'] LOOP
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
