-- The landing page in Arabic, and sections the operator adds to it.
--
-- The marketing site gains Arabic pages (/ar, /ar/pricing, /ar/contact). They
-- are the English pages with the text swapped: the Arabic is stored as an
-- overlay of the English blocks' text only, so an image, a link or a number
-- changed in the console changes both pages at once, and nothing has to be
-- kept in step by hand.
--
--   landing_pages.translations    { "ar": { "hero": {...}, ..., "seo": {...},
--                                   "custom": { "<id>": {...} } } }
--   landing_pages.customSections  [ { id, heading, body, image, imageAlt,
--                                   imagePosition, ctaLabel, ctaHref,
--                                   background } ], placed on the page by
--                                   "custom:<id>" entries in "sections"
--   plans.translations            { "ar": { name, description, highlights,
--                                   priceSuffix, featuresHeader, ctaLabel } }
--
-- Additive: three nullable JSONB columns with no default. A default would be
-- sent with every insert by the application (Prisma 7), and break seeding the
-- landing page or creating a plan on a database this has not reached yet. Null
-- reads as "no Arabic text saved yet" (the shipped translation fills in) and
-- "no custom sections"; every existing row keeps rendering exactly as before.

ALTER TABLE "landing_pages" ADD COLUMN IF NOT EXISTS "translations" JSONB;
ALTER TABLE "landing_pages" ADD COLUMN IF NOT EXISTS "customSections" JSONB;
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "translations" JSONB;
