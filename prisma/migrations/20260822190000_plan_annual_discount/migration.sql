-- Annual term becomes a switch plus a discount, with the price derived from
-- the monthly one. Existing plans that already carry a hand-set annual price
-- keep it exactly, as an override, so nobody's advertised price moves.

ALTER TABLE "plans"
  ADD COLUMN "annualEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "yearlyDiscountPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN "yearlyPriceOverride" BOOLEAN NOT NULL DEFAULT false;

UPDATE "plans"
SET "annualEnabled" = true,
    "yearlyPriceOverride" = true,
    -- Record the discount the existing price already represents, so the form
    -- shows a truthful number the moment the override is switched off.
    "yearlyDiscountPercent" = CASE
      WHEN "monthlyPrice" > 0
        THEN GREATEST(0, LEAST(100,
          ROUND((1 - ("yearlyPrice" / ("monthlyPrice" * 12))) * 100, 2)))
      ELSE 0
    END
WHERE "yearlyPrice" IS NOT NULL;
