-- Seed the OWNER system role for organizations provisioned before it existed.
--
-- UserRole.OWNER has been wired through the permission catalog, the API
-- guards, the sidebar and the seat guard for a while, but
-- provision-organization.ts only ever wrote three `roles` rows. Everything
-- user-facing (role management, create-user, bulk assignment) reads that
-- table, so the role was unreachable from the UI in every existing workspace.
--
-- Permissions must stay in step with SYSTEM_ROLE_PERMISSIONS[UserRole.OWNER]
-- in src/lib/permission-catalog.ts. Each one is narrowed to the owner's own
-- rows by lib/db/scopes.ts — property_view alone would expose the whole
-- portfolio.

-- `roles` is FORCE ROW LEVEL SECURITY with no org bound on a migration
-- connection, so the insert would match zero rows without this.
SELECT set_config('app.bypass_rls', 'on', false);

INSERT INTO "roles" (
  "id", "organizationId", "name", "label", "description", "permissions",
  "isSystem", "isActive", "color", "createdById", "createdAt", "updatedAt"
)
SELECT
  'role_' || md5(o."id" || ':owner'),
  o."id",
  'owner',
  'Property Owner',
  'Read-only access to their own buildings, statements and commissions',
  ARRAY[
    'profile_management',
    'property_view',
    'lease_view',
    'payment_history',
    'maintenance_history',
    'document_access',
    'reports_own'
  ]::TEXT[],
  true,
  true,
  'outline',
  -- createdById is a real FK; fall back to NULL if the recorded owner user
  -- has since been hard-deleted rather than aborting the migration.
  (SELECT u."id" FROM "users" u WHERE u."id" = o."ownerId"),
  now(),
  now()
FROM "organizations" o
WHERE o."deletedAt" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "roles" r
    WHERE r."organizationId" = o."id"
      AND r."name" = 'owner'
      AND r."deletedAt" IS NULL
  );

SELECT set_config('app.bypass_rls', 'off', false);
