-- Optional electricity and water charges on a lease contract.
--
-- Billed WITH the rent, per installment, so a quarterly contract charging 300
-- electricity charges it every quarter. Existing contracts default to 0 and
-- their schedules are unchanged.
--
-- Real columns, not keys in the `terms` JSON: the installment generator, the
-- invoice line items and the owner statement all read them, and a prorated
-- final period has to shrink them alongside the rent.

ALTER TABLE "leases"
  ADD COLUMN "electricityAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "waterAmount" DECIMAL(14,2) NOT NULL DEFAULT 0;
