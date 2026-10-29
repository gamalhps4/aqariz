-- Who recorded a payment.
--
-- The client asked for the payments page to show the employee who recorded
-- each payment. Nothing on the row said so: the recording paths wrote the
-- user id into the `paymentHistory` JSON on some paths and nowhere on others,
-- and a JSON field cannot be joined to a name.
--
-- Nullable, and it stays nullable: an online payment has no person behind it
-- (the gateway recorded it), and rows older than this column have nobody on
-- record until the backfill (src/scripts/backfill-payment-recorded-by.ts)
-- recovers what it can from the payment history and the audit log.
--
-- ON DELETE SET NULL, like every other optional reference to a user: removing
-- an account must never take payments with it, and must not be blocked by
-- them either.
--
-- Additive only. Existing rows are untouched, and code that does not know the
-- column keeps working.

ALTER TABLE "payments" ADD COLUMN "recordedById" TEXT;

CREATE INDEX "payments_recordedById_idx" ON "payments"("recordedById");

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_recordedById_fkey"
  FOREIGN KEY ("recordedById") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
