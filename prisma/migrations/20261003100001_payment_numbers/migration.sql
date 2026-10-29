-- Payment numbers: the receipt voucher number (سند قبض).
--
-- The client asked for every payment to carry a payment number, shown on the
-- payments list, the reports, the exports, the receipt and the statements'
-- السند column. There was none: receipts were numbered three different ways
-- (from the payment id, by month once a tenant generated one, and again by
-- the receipt service), so the same payment could print under two numbers.
--
-- One number per organization, in sequence, given to a payment when money is
-- received on it: when the row becomes paid or partly paid, or is inserted
-- with money on it. Charges nobody has paid carry none. Once given, a number
-- is the payment's for good — a refund, a cancellation or moving it to the
-- archive keeps it — and it is never given again.
--
-- The database hands the numbers out, not the application. Some thirty code
-- paths settle a payment (the record dialog, the installment dialog, gateway
-- webhooks, "mark as paid", reconciliation); a trigger on `payments` sees all
-- of them, and the per-organization counter row it locks makes two payments
-- settled at the same moment take two different numbers. The application
-- never writes the column.
--
-- Organizations that already hold payments are numbered by the backfill
-- (src/scripts/backfill-payment-numbers.ts), oldest payment first. Until it
-- has run for an organization, that organization's counter is "not ready"
-- and new payments wait unnumbered, so the history and the payments taken
-- meanwhile are numbered together, in date order, with no number out of
-- place. An organization created after this migration starts ready.
--
-- Additive: a nullable column, a new table, a trigger. Code that does not
-- know the column keeps working (the client omits it by default — see
-- src/lib/db/prisma.ts).

ALTER TABLE "payments" ADD COLUMN "number" INTEGER;

CREATE UNIQUE INDEX "payments_organizationId_number_key"
  ON "payments"("organizationId", "number");

CREATE TABLE "payment_number_counters" (
    "organizationId" TEXT NOT NULL,
    -- The last number handed out; the next payment takes lastNumber + 1.
    "lastNumber" INTEGER NOT NULL DEFAULT 0,
    -- False until the backfill has numbered this organization's history.
    "ready" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_number_counters_pkey" PRIMARY KEY ("organizationId")
);

-- Every organization that exists now holds payments from before numbering,
-- so each waits for the backfill. `organizations` is FORCE ROW LEVEL
-- SECURITY with no org bound on a migration connection, so the read would
-- match zero rows without the bypass.
SELECT set_config('app.bypass_rls', 'on', false);

INSERT INTO "payment_number_counters" ("organizationId", "lastNumber", "ready")
SELECT o."id", 0, false
FROM "organizations" o;

SELECT set_config('app.bypass_rls', 'off', false);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
-- The trigger runs as whoever wrote the payment, so the counter is guarded
-- like every other org-owned table: a request bound to an organization sees
-- that organization's counter, and the bypass (webhooks, platform jobs)
-- sees every one.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['payment_number_counters'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY org_isolation ON %I USING (
         current_setting(''app.bypass_rls'', true) = ''on''
         OR "organizationId" = current_setting(''app.current_org_id'', true)
       ) WITH CHECK (
         current_setting(''app.bypass_rls'', true) = ''on''
         OR "organizationId" = current_setting(''app.current_org_id'', true)
       )', t);
  END LOOP;
END $$;

-- ============================================================================
-- THE TRIGGER
-- ============================================================================
CREATE OR REPLACE FUNCTION "assign_payment_number"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  counter_ready BOOLEAN;
  next_number INTEGER;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Given once, kept for good: no update can change or clear it.
    IF OLD."number" IS NOT NULL THEN
      NEW."number" := OLD."number";
      RETURN NEW;
    END IF;
    -- Set by the backfill. The counter is kept at or above it, so the
    -- trigger can never hand the same number out again.
    IF NEW."number" IS NOT NULL THEN
      UPDATE "payment_number_counters"
         SET "lastNumber" = GREATEST("lastNumber", NEW."number"),
             "updatedAt" = CURRENT_TIMESTAMP
       WHERE "organizationId" = NEW."organizationId";
      RETURN NEW;
    END IF;
  ELSE
    -- Never taken from whoever inserts the row.
    NEW."number" := NULL;
  END IF;

  -- Only money received is numbered; a charge nobody has paid is not.
  IF NOT (
    NEW."status" IN ('paid', 'partial', 'refunded')
    OR COALESCE(NEW."amountPaid", 0) > 0
  ) THEN
    RETURN NEW;
  END IF;

  -- The counter row is locked until this transaction ends, so two payments
  -- settled at once are numbered one after the other.
  SELECT "ready" INTO counter_ready
    FROM "payment_number_counters"
   WHERE "organizationId" = NEW."organizationId"
   FOR UPDATE;

  IF FOUND THEN
    -- This organization's history is not numbered yet; the backfill numbers
    -- this payment with it, in date order.
    IF NOT counter_ready THEN
      RETURN NEW;
    END IF;
    UPDATE "payment_number_counters"
       SET "lastNumber" = "lastNumber" + 1,
           "updatedAt" = CURRENT_TIMESTAMP
     WHERE "organizationId" = NEW."organizationId"
    RETURNING "lastNumber" INTO next_number;
  ELSE
    -- An organization's first payment: number 1, or past any number its
    -- payments already carry should its counter row ever have gone missing.
    -- A concurrent first payment waits on the insert and then takes the
    -- next number.
    INSERT INTO "payment_number_counters" AS c ("organizationId", "lastNumber", "ready")
    VALUES (
      NEW."organizationId",
      COALESCE(
        (SELECT MAX(p."number") FROM "payments" p
          WHERE p."organizationId" = NEW."organizationId"),
        0
      ) + 1,
      true
    )
    ON CONFLICT ("organizationId") DO UPDATE
       SET "lastNumber" = c."lastNumber" + 1,
           "updatedAt" = CURRENT_TIMESTAMP
     WHERE c."ready"
    RETURNING c."lastNumber" INTO next_number;
  END IF;

  NEW."number" := next_number;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "payments_assign_number"
  BEFORE INSERT OR UPDATE ON "payments"
  FOR EACH ROW EXECUTE FUNCTION "assign_payment_number"();
