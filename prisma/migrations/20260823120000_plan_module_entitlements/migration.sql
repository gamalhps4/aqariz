-- Volume limits to sit beside the module-level entitlement catalog.
-- Null means unlimited on every one, matching the existing limit columns.
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "limitsTenants" INTEGER;
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "limitsLeases" INTEGER;
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "limitsDocuments" INTEGER;
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "limitsInvoicesPerMonth" INTEGER;

-- ---------------------------------------------------------------------------
-- Entitlement catalog: four coarse keys -> module-level keys
-- ---------------------------------------------------------------------------
-- `plans` runs with FORCE ROW LEVEL SECURITY and its platform_write policy only
-- admits statements with `app.bypass_rls` set, so a data migration that skips
-- this SET updates zero rows and still reports success. That is exactly what
-- 20260822190000 did; see 20260822200000 for the post-mortem.
SET app.bypass_rls = 'on';

-- 1. priority_support has no in-app boundary, so it belongs with the
--    pricing-page bullets rather than the enforced catalog. Copy the promise
--    across BEFORE step 3 strips the key, for any plan not already saying it.
UPDATE "plans"
SET "highlights" = "highlights" || ARRAY['Priority support']
WHERE 'priority_support' = ANY("features")
  AND NOT ('Priority support' = ANY("highlights"));

-- 2. `core_property_management` gated nothing in code, so a plan carrying it
--    was in practice granting the whole product. Expand it into the modules it
--    was understood to cover. Without this, `toPlanDefinition` (which drops
--    keys missing from the catalog) would hand back an empty feature list and
--    every such customer would lose access the moment this deploys.
UPDATE "plans"
SET "features" = ARRAY(
  SELECT DISTINCT k FROM unnest(
    ARRAY(
      SELECT existing FROM unnest("features") AS existing
      WHERE existing NOT IN ('core_property_management', 'priority_support')
    )
    ||
    ARRAY['properties','tenants','leases','applications','agreements',
          'owner_portal','maintenance','inspections','tickets','calendar',
          'accounting','payments','security_deposits','messaging',
          'announcements']
  ) AS k
)
WHERE 'core_property_management' = ANY("features");

-- 3. Plans that advertised priority_support without the core key just lose it.
UPDATE "plans"
SET "features" = ARRAY(
  SELECT k FROM unnest("features") AS k WHERE k <> 'priority_support'
)
WHERE 'priority_support' = ANY("features");

-- Fail loudly rather than leave a plan holding a key nothing recognises: a
-- retired key survives here as an empty feature list at runtime, which reads
-- as "this plan includes nothing".
DO $$
DECLARE stale INT;
BEGIN
  SELECT count(*) INTO stale FROM "plans"
   WHERE 'core_property_management' = ANY("features")
      OR 'priority_support' = ANY("features");
  IF stale > 0 THEN
    RAISE EXCEPTION
      'entitlement remap changed nothing (% plan(s) still on retired keys) - app.bypass_rls not in effect', stale;
  END IF;
END $$;

RESET app.bypass_rls;
