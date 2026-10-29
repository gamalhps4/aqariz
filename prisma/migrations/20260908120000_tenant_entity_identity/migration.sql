-- The tenant identity the scope actually asks for.
--
-- A tenant here is a party to a lease contract, and in this market that party
-- is as often a company as a person. The record needs to say which, and carry
-- the one number that identifies them: a national ID for an individual, a
-- Commercial Registration number for a company.
--
-- One column for both, because it is one field on the contract; `entityType`
-- says which of the two it holds. Unlike `ssn` it is not encrypted — a CR
-- number is public register data that has to be searchable and printed.
--
-- Existing rows default to "individual", which is what every tenant entered
-- before this column existed was assumed to be.

ALTER TABLE "tenants"
  ADD COLUMN "entityType" TEXT NOT NULL DEFAULT 'individual',
  ADD COLUMN "idNumber" TEXT;

CREATE INDEX "tenants_organizationId_idNumber_idx"
  ON "tenants"("organizationId", "idNumber");
