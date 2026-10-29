-- Two problems with the 20260822190000 backfill, fixed together here.
--
-- 1. It silently affected zero rows. `plans` runs with FORCE ROW LEVEL
--    SECURITY, and its `platform_write` policy only admits statements where
--    `app.bypass_rls` is 'on' -- which a migration has no reason to set. Every
--    row was filtered out and the migration still reported success. Any future
--    data migration against an RLS table needs the SET below.
--
-- 2. Adopting the legacy figures would have been wrong anyway. They were
--    per-month-billed-annually amounts (25.00 against a 29.00 monthly price),
--    not annual totals. Read as annual totals -- which is what `yearlyPrice`
--    now means -- they would have sold a year of Business for 179.00 instead
--    of 2388.00. No organization is subscribed on any of these yearly prices,
--    so clearing them costs nothing and removes the mispricing.
--
-- Annual billing therefore starts off for every plan. Switching it on per plan
-- in the console derives the price from the monthly one and creates the
-- matching Stripe price on save.

SET app.bypass_rls = 'on';

UPDATE "plans"
SET "yearlyPrice" = NULL,
    "stripePriceIdYearly" = NULL,
    "annualEnabled" = false,
    "yearlyPriceOverride" = false,
    "yearlyDiscountPercent" = 0
WHERE "yearlyPrice" IS NOT NULL
   OR "stripePriceIdYearly" IS NOT NULL
   OR "annualEnabled";

-- Fail loudly rather than repeat a silent no-op if the bypass stops working.
DO $$
DECLARE stale INT;
BEGIN
  SELECT count(*) INTO stale FROM "plans"
   WHERE "yearlyPrice" IS NOT NULL
      OR "stripePriceIdYearly" IS NOT NULL
      OR "annualEnabled";
  IF stale > 0 THEN
    RAISE EXCEPTION
      'annual reset changed nothing (% row(s) still set) - app.bypass_rls not in effect', stale;
  END IF;
END $$;

RESET app.bypass_rls;
