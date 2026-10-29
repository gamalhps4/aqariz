-- Saudi Arabia is the market this deployment ships for.
--
-- The defaults this replaces were US ones: a property assumed to be in the
-- United States, money assumed to be dollars, a dashboard assumed to open in
-- English on New York time with month-first dates. None of that was a
-- decision anyone made for this product; they were the values the schema was
-- first written with. This migration makes the database agree with
-- `lib/regional/region.ts`, which is where the same choices are named for the
-- application side.
--
-- DEFAULTS ONLY — NO BACKFILL. `SET DEFAULT` decides what a row that was
-- never told looks like; it does not touch a single existing row. That is
-- deliberate: a property genuinely recorded in the United States, or a
-- payment genuinely taken in dollars, must keep saying so. Rewriting stored
-- money's currency code would silently restate every historical amount.
-- Existing demo/seed rows keep their US values until they are re-seeded.
--
-- `addressDistrict` (حي) is the one new column. In Saudi Arabia the district
-- is how an address is found and is quoted more often than the postal code,
-- so a property record without it is incomplete here in a way it never was in
-- the US. Nullable, because every row written before today has none.

-- The district tier, on both things that carry a street address.
ALTER TABLE "properties" ADD COLUMN "addressDistrict" TEXT;
ALTER TABLE "compounds"  ADD COLUMN "addressDistrict" TEXT;
-- An owner's own address is printed on their statement, so it carries the
-- district too.
ALTER TABLE "owners"     ADD COLUMN "addressDistrict" TEXT;

-- Districts are searched and filtered the way cities already are.
CREATE INDEX "properties_addressDistrict_idx" ON "properties" ("addressDistrict");

-- A new address is in Saudi Arabia unless it says otherwise.
ALTER TABLE "properties" ALTER COLUMN "addressCountry" SET DEFAULT 'Saudi Arabia';

-- Money is recorded in riyals unless the writer names a currency. Every one
-- of these columns exists precisely so an amount carries its own currency, so
-- they are changed together or the product contradicts itself.
ALTER TABLE "leases"             ALTER COLUMN "currency" SET DEFAULT 'SAR';
ALTER TABLE "invoices"           ALTER COLUMN "currency" SET DEFAULT 'SAR';
ALTER TABLE "payments"           ALTER COLUMN "currency" SET DEFAULT 'SAR';
ALTER TABLE "recurring_payments" ALTER COLUMN "currency" SET DEFAULT 'SAR';
ALTER TABLE "security_deposits"  ALTER COLUMN "currency" SET DEFAULT 'SAR';
ALTER TABLE "expenses"           ALTER COLUMN "currency" SET DEFAULT 'SAR';

-- An unconfigured dashboard opens in the market it ships for: Arabic, Riyadh
-- time, riyals, day-first dates. RTL is not set here — the settings provider
-- already derives it from an RTL language, and a second stored copy of the
-- same fact is a second thing to get wrong.
ALTER TABLE "display_settings" ALTER COLUMN "language"   SET DEFAULT 'ar';
ALTER TABLE "display_settings" ALTER COLUMN "timezone"   SET DEFAULT 'Asia/Riyadh';
ALTER TABLE "display_settings" ALTER COLUMN "currency"   SET DEFAULT 'SAR';
ALTER TABLE "display_settings" ALTER COLUMN "dateFormat" SET DEFAULT 'DD/MM/YYYY';
