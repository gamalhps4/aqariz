-- Listings for a property that is not in the system.
--
-- A listing was always made from a vacant unit, and read its type, area,
-- rooms, floor, photos and place from that unit and its building. An office
-- also markets properties it has not added (a client's flat, a sale it
-- brokers), so a listing may now name no unit and no building and carry those
-- details itself.
--
-- Additive: the unit and building columns lose NOT NULL, and six nullable
-- columns arrive with no default (a default would be sent with every insert
-- by the application, and break creating a listing on a database this has
-- not reached yet). Every existing row names its unit and building and keeps
-- reading from them; the new columns stay NULL on it.
--
-- The one live ad per unit and type index (listings_unit_type_live_unique,
-- on ("unitId", "type") WHERE status <> 'archived') is left as it is. Postgres
-- treats NULLs as distinct in a unique index, so any number of live listings
-- with no unit sit beside each other, while two live ads for the same unit
-- and type are still refused.

ALTER TABLE "listings" ALTER COLUMN "propertyId" DROP NOT NULL;
ALTER TABLE "listings" ALTER COLUMN "unitId" DROP NOT NULL;

ALTER TABLE "listings" ADD COLUMN IF NOT EXISTS "propertyType" TEXT;
ALTER TABLE "listings" ADD COLUMN IF NOT EXISTS "addressLine" TEXT;
ALTER TABLE "listings" ADD COLUMN IF NOT EXISTS "areaSqm" DOUBLE PRECISION;
ALTER TABLE "listings" ADD COLUMN IF NOT EXISTS "bedrooms" INTEGER;
ALTER TABLE "listings" ADD COLUMN IF NOT EXISTS "bathrooms" INTEGER;
ALTER TABLE "listings" ADD COLUMN IF NOT EXISTS "floor" INTEGER;

-- A unit always comes with its building: a listing names both or neither,
-- so "no unit" is the one test for a property not in the system.
ALTER TABLE "listings" ADD CONSTRAINT "listings_unit_property_pair_check"
    CHECK (("unitId" IS NULL) = ("propertyId" IS NULL));

-- A listing with no unit always says what it is and which city it is in:
-- that is what its row in the office's list, its public card and its address
-- are made from. (Its area is asked for only when it is published.)
ALTER TABLE "listings" ADD CONSTRAINT "listings_standalone_details_check"
    CHECK (
      "unitId" IS NOT NULL
      OR (
        "propertyType" IS NOT NULL AND btrim("propertyType") <> ''
        AND "city" IS NOT NULL AND btrim("city") <> ''
      )
    );

-- The same bounds the form and the API hold the details to.
ALTER TABLE "listings" ADD CONSTRAINT "listings_details_range_check"
    CHECK (
      ("areaSqm" IS NULL OR ("areaSqm" >= 0 AND "areaSqm" <= 1000000))
      AND ("bedrooms" IS NULL OR "bedrooms" BETWEEN 0 AND 100)
      AND ("bathrooms" IS NULL OR "bathrooms" BETWEEN 0 AND 100)
      AND ("floor" IS NULL OR "floor" BETWEEN -10 AND 300)
    );
