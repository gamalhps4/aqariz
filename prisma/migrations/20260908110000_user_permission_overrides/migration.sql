-- Per-employee permission overrides.
--
-- Roles remain the normal way to grant access. These two columns cover the
-- exception every office has: one employee who needs a single extra
-- capability, or must lose one, without inventing a role for each of them.
--
-- Denials are applied after grants and after the role, so a permission listed
-- in both is denied. That is the safe reading of a contradiction and it makes
-- "revoke X from this person" hold regardless of later role changes.
--
-- Both default to empty, so every existing user resolves to exactly the
-- permissions their role already gave them.

ALTER TABLE "users"
  ADD COLUMN "permissionGrants" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "permissionDenials" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
