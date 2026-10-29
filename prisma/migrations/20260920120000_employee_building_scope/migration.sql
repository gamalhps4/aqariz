-- An employee sees only the buildings they were given.
--
-- Until now every member of staff saw the whole organization. Between-tenant
-- isolation was enforced (row-level security), and the two client tiers were
-- narrowed in lib/db/scopes.ts — an owner to their portfolio, a tenant to
-- their own rows — but an employee fell through to "no filter". For an office
-- with one team that was the correct default; for an office that hires a
-- building supervisor it is a data leak, and the client review asks for it
-- first and loudest.
--
-- Three columns rather than a join table, following `permissionGrants` /
-- `permissionDenials` directly above them: this is the same kind of fact
-- about the same person, read on the same request, and it stays one row.
--
-- `scopeRestricted` is deliberately separate from the two lists. If the lists
-- alone decided, then clearing an employee's last building would widen them
-- back to everything — the dangerous direction, and silent. The flag makes
-- "assigned nothing" mean "sees nothing".
--
-- Defaults keep every existing employee exactly as they are: unrestricted
-- until somebody deliberately narrows them.

ALTER TABLE "users"
  ADD COLUMN "scopeRestricted"   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "scopedCompoundIds" TEXT[]  NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "scopedPropertyIds" TEXT[]  NOT NULL DEFAULT ARRAY[]::TEXT[];

-- The scope resolver reads only restricted staff, which is a small minority
-- of the table; a partial index keeps that lookup off a full scan.
CREATE INDEX "users_scopeRestricted_idx"
  ON "users" ("organizationId")
  WHERE "scopeRestricted" = true;
