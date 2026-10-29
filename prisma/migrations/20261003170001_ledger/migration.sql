-- The ledger: the office's double-entry books.
--
-- Until now the Accounting section had no books at all: "transactions" was a
-- union of paid payments and paid expenses, and nothing of the owner
-- settlement — the commission, the payout, the balance carried forward — was
-- ever recorded. These tables are the core the accounting screens and
-- reports are built on:
--
--   ledger_accounts      the chart of accounts, seeded per organization from
--                        the Saudi template when accounting is set up
--   journal_entries      numbered, dated entries; one live entry per source
--                        document, reversed (never edited) once its period
--                        is closed
--   journal_lines        the debits and credits, with the party (tenant,
--                        owner, supplier, customer) and the building, unit,
--                        contract and agreement they concern
--   accounting_settings  cut-over date, period lock, VAT registration and
--                        the account map, one row per organization
--   bank_accounts        the office's bank, cash, POS and gateway accounts
--   bank_transfers       money moved between them
--   owner_settlements    an owner's period, closed
--   owner_payouts        money paid to an owner
--
-- Two triggers hold the books together whatever writes to them:
--   * every entry balances — a deferred constraint trigger checks, at
--     commit, that an entry has lines, that its debits equal its credits and
--     its stored total, and that its lines carry its date;
--   * nothing changes inside a closed period — no entry dated on or before
--     accounting_settings.closedThrough is inserted, edited or deleted, bar
--     marking one reversed.
--
-- Additive only: new tables, no change to an existing one. Nothing is
-- backfilled; an office's books start when it sets accounting up, and the
-- posting sweep (src/lib/accounting/sweep.service.ts) posts its documents
-- from its cut-over date on.

-- ============================================================================
-- CHART OF ACCOUNTS
-- ============================================================================
CREATE TABLE "ledger_accounts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "normalSide" TEXT NOT NULL,
    "parentId" TEXT,
    "postable" BOOLEAN NOT NULL DEFAULT true,
    "systemKey" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ledger_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ledger_accounts_organizationId_code_key"
    ON "ledger_accounts"("organizationId", "code");
CREATE UNIQUE INDEX "ledger_accounts_organizationId_systemKey_key"
    ON "ledger_accounts"("organizationId", "systemKey");
CREATE INDEX "ledger_accounts_organizationId_parentId_idx"
    ON "ledger_accounts"("organizationId", "parentId");

ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- A heading with accounts under it cannot be deleted from under them.
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_parentId_fkey"
    FOREIGN KEY ("parentId") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_type_check"
    CHECK ("type" IN ('asset', 'liability', 'equity', 'income', 'expense'));
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_normal_side_check"
    CHECK ("normalSide" IN ('debit', 'credit'));
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_not_own_parent_check"
    CHECK ("parentId" IS NULL OR "parentId" <> "id");

-- ============================================================================
-- JOURNAL
-- ============================================================================
CREATE TABLE "journal_entries" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "sourceRef" TEXT,
    "memo" TEXT,
    "status" TEXT NOT NULL DEFAULT 'posted',
    "reversesId" TEXT,
    "totalAmount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'SAR',
    "fingerprint" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "journal_entries_organizationId_number_key"
    ON "journal_entries"("organizationId", "number");
CREATE INDEX "journal_entries_organizationId_date_idx"
    ON "journal_entries"("organizationId", "date");
CREATE INDEX "journal_entries_organizationId_sourceType_sourceId_idx"
    ON "journal_entries"("organizationId", "sourceType", "sourceId");
CREATE INDEX "journal_entries_reversesId_idx" ON "journal_entries"("reversesId");

-- One live entry per source document. A reversed entry and the reversal
-- itself step aside, so a document corrected after its period was closed
-- can be posted again.
CREATE UNIQUE INDEX "journal_entries_live_source_unique"
    ON "journal_entries"("organizationId", "sourceType", "sourceId")
    WHERE "sourceId" IS NOT NULL AND "status" = 'posted' AND "reversesId" IS NULL;

ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_reversesId_fkey"
    FOREIGN KEY ("reversesId") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_status_check"
    CHECK ("status" IN ('posted', 'reversed'));
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_source_type_check"
    CHECK ("sourceType" IN (
      'manual', 'opening_balance', 'invoice', 'payment', 'payment_refund',
      'expense', 'deposit_receipt', 'deposit_settlement', 'bank_transfer',
      'owner_settlement', 'owner_payout'
    ));
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_number_check"
    CHECK ("number" > 0);
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_total_check"
    CHECK ("totalAmount" > 0);
-- An entry is dated by a calendar day, stored as the midnight that begins it.
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_date_is_day_check"
    CHECK ("date" = date_trunc('day', "date"));

CREATE TABLE "journal_lines" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL DEFAULT 0,
    "accountId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "debit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "partyType" TEXT,
    "partyId" TEXT,
    "propertyId" TEXT,
    "unitId" TEXT,
    "leaseId" TEXT,
    "agreementId" TEXT,
    "vatCode" TEXT,
    "memo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "journal_lines_entryId_idx" ON "journal_lines"("entryId");
CREATE INDEX "journal_lines_organizationId_accountId_date_idx"
    ON "journal_lines"("organizationId", "accountId", "date");
CREATE INDEX "journal_lines_organizationId_partyType_partyId_idx"
    ON "journal_lines"("organizationId", "partyType", "partyId");
CREATE INDEX "journal_lines_organizationId_propertyId_idx"
    ON "journal_lines"("organizationId", "propertyId");

ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entryId_fkey"
    FOREIGN KEY ("entryId") REFERENCES "journal_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- An account with postings is never deleted: the books must keep reading.
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A line is a debit or a credit, above zero, never both.
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_one_side_check"
    CHECK ("debit" >= 0 AND "credit" >= 0
           AND (("debit" > 0 AND "credit" = 0) OR ("credit" > 0 AND "debit" = 0)));
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_party_type_check"
    CHECK ("partyType" IS NULL OR "partyType" IN ('tenant', 'owner', 'supplier', 'customer'));
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_party_pair_check"
    CHECK (("partyType" IS NULL) = ("partyId" IS NULL));
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_vat_code_check"
    CHECK ("vatCode" IS NULL OR "vatCode" IN ('S', 'Z', 'E', 'O'));

-- ============================================================================
-- SETTINGS
-- ============================================================================
CREATE TABLE "accounting_settings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "cutOverDate" TIMESTAMP(3),
    "closedThrough" TIMESTAMP(3),
    "vatRegistered" BOOLEAN NOT NULL DEFAULT false,
    "vatNumber" TEXT,
    "basis" TEXT NOT NULL DEFAULT 'accrual',
    "depositHolder" TEXT NOT NULL DEFAULT 'owner',
    "accountMap" JSONB NOT NULL DEFAULT '{}',
    "lastJournalNumber" INTEGER NOT NULL DEFAULT 0,
    "templateVersion" TEXT,
    "setupAt" TIMESTAMP(3),
    "setupById" TEXT,
    "lastSweepAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounting_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "accounting_settings_organizationId_key"
    ON "accounting_settings"("organizationId");

ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_basis_check"
    CHECK ("basis" IN ('accrual'));
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_deposit_holder_check"
    CHECK ("depositHolder" IN ('owner', 'office'));
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_journal_number_check"
    CHECK ("lastJournalNumber" >= 0);

-- ============================================================================
-- BANK AND CASH
-- ============================================================================
CREATE TABLE "bank_accounts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ledgerAccountId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'bank',
    "name" TEXT NOT NULL,
    "bankName" TEXT,
    "iban" TEXT,
    "accountNumber" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'SAR',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "bank_accounts_ledgerAccountId_key" ON "bank_accounts"("ledgerAccountId");
CREATE INDEX "bank_accounts_organizationId_kind_idx" ON "bank_accounts"("organizationId", "kind");

ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_ledgerAccountId_fkey"
    FOREIGN KEY ("ledgerAccountId") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_kind_check"
    CHECK ("kind" IN ('bank', 'cash', 'pos', 'gateway_clearing'));

CREATE TABLE "bank_transfers" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "fromBankAccountId" TEXT NOT NULL,
    "toBankAccountId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "reference" TEXT,
    "memo" TEXT,
    "status" TEXT NOT NULL DEFAULT 'posted',
    "journalEntryId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_transfers_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "bank_transfers_organizationId_date_idx" ON "bank_transfers"("organizationId", "date");

ALTER TABLE "bank_transfers" ADD CONSTRAINT "bank_transfers_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bank_transfers" ADD CONSTRAINT "bank_transfers_fromBankAccountId_fkey"
    FOREIGN KEY ("fromBankAccountId") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bank_transfers" ADD CONSTRAINT "bank_transfers_toBankAccountId_fkey"
    FOREIGN KEY ("toBankAccountId") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bank_transfers" ADD CONSTRAINT "bank_transfers_journalEntryId_fkey"
    FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "bank_transfers" ADD CONSTRAINT "bank_transfers_amount_check" CHECK ("amount" > 0);
ALTER TABLE "bank_transfers" ADD CONSTRAINT "bank_transfers_accounts_check"
    CHECK ("fromBankAccountId" <> "toBankAccountId");
ALTER TABLE "bank_transfers" ADD CONSTRAINT "bank_transfers_status_check"
    CHECK ("status" IN ('posted', 'reversed'));

-- ============================================================================
-- OWNERS
-- ============================================================================
CREATE TABLE "owner_settlements" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "agreementId" TEXT,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "collected" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "ownerReceivedDirect" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "commission" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "commissionVat" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "expenses" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "investmentRent" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "netDue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'SAR',
    "status" TEXT NOT NULL DEFAULT 'closed',
    "journalEntryId" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "owner_settlements_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "owner_settlements_organizationId_ownerId_periodStart_idx"
    ON "owner_settlements"("organizationId", "ownerId", "periodStart");

ALTER TABLE "owner_settlements" ADD CONSTRAINT "owner_settlements_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "owner_settlements" ADD CONSTRAINT "owner_settlements_journalEntryId_fkey"
    FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "owner_settlements" ADD CONSTRAINT "owner_settlements_period_check"
    CHECK ("periodEnd" >= "periodStart");
ALTER TABLE "owner_settlements" ADD CONSTRAINT "owner_settlements_status_check"
    CHECK ("status" IN ('closed', 'reversed'));

CREATE TABLE "owner_payouts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'posted',
    "journalEntryId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "owner_payouts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "owner_payouts_organizationId_ownerId_date_idx"
    ON "owner_payouts"("organizationId", "ownerId", "date");

ALTER TABLE "owner_payouts" ADD CONSTRAINT "owner_payouts_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "owner_payouts" ADD CONSTRAINT "owner_payouts_bankAccountId_fkey"
    FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "owner_payouts" ADD CONSTRAINT "owner_payouts_journalEntryId_fkey"
    FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "owner_payouts" ADD CONSTRAINT "owner_payouts_amount_check" CHECK ("amount" > 0);
ALTER TABLE "owner_payouts" ADD CONSTRAINT "owner_payouts_status_check"
    CHECK ("status" IN ('posted', 'reversed'));

-- ============================================================================
-- EVERY ENTRY BALANCES
-- ============================================================================
-- Checked at commit (DEFERRABLE INITIALLY DEFERRED), so an entry and its
-- lines can be written in any order inside one transaction. Runs as the
-- writer, under the same row-level security: it sees exactly the entry the
-- writer could write.
CREATE OR REPLACE FUNCTION "ledger_assert_entry_balanced"(target_id TEXT) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  entry_date TIMESTAMP(3);
  entry_total NUMERIC(14,2);
  line_count INTEGER;
  sum_debit NUMERIC;
  sum_credit NUMERIC;
  off_date INTEGER;
BEGIN
  SELECT e."date", e."totalAmount" INTO entry_date, entry_total
    FROM "journal_entries" e WHERE e."id" = target_id;
  IF NOT FOUND THEN
    -- The entry itself was deleted in the same transaction (its lines went
    -- with it): nothing is left to check.
    RETURN;
  END IF;

  SELECT COUNT(*), COALESCE(SUM(l."debit"), 0), COALESCE(SUM(l."credit"), 0),
         COUNT(*) FILTER (WHERE l."date" <> entry_date)
    INTO line_count, sum_debit, sum_credit, off_date
    FROM "journal_lines" l WHERE l."entryId" = target_id;

  IF line_count = 0 THEN
    RAISE EXCEPTION 'Journal entry % has no lines', target_id USING ERRCODE = '23514';
  END IF;
  IF sum_debit <> sum_credit THEN
    RAISE EXCEPTION 'Journal entry % does not balance: debits %, credits %',
      target_id, sum_debit, sum_credit USING ERRCODE = '23514';
  END IF;
  IF sum_debit <> entry_total THEN
    RAISE EXCEPTION 'Journal entry % totals % but its lines carry %',
      target_id, entry_total, sum_debit USING ERRCODE = '23514';
  END IF;
  IF off_date > 0 THEN
    RAISE EXCEPTION 'Journal entry % has lines dated differently from the entry',
      target_id USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION "ledger_check_entry_balanced"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'journal_entries' THEN
    PERFORM "ledger_assert_entry_balanced"(NEW."id");
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM "ledger_assert_entry_balanced"(OLD."entryId");
  ELSE
    PERFORM "ledger_assert_entry_balanced"(NEW."entryId");
    IF TG_OP = 'UPDATE' AND OLD."entryId" <> NEW."entryId" THEN
      PERFORM "ledger_assert_entry_balanced"(OLD."entryId");
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "journal_entries_balanced"
  AFTER INSERT OR UPDATE ON "journal_entries"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "ledger_check_entry_balanced"();

CREATE CONSTRAINT TRIGGER "journal_lines_balanced"
  AFTER INSERT OR UPDATE OR DELETE ON "journal_lines"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "ledger_check_entry_balanced"();

-- ============================================================================
-- NOTHING CHANGES INSIDE A CLOSED PERIOD
-- ============================================================================
-- The posting service never writes there — a document corrected after its
-- period was closed is reversed and reposted in the first open day — and
-- this makes sure nothing else does either. The one change allowed to a
-- closed entry is marking it reversed, which the reversal itself (dated in
-- an open period) needs.
CREATE OR REPLACE FUNCTION "ledger_closed_through"(org_id TEXT) RETURNS TIMESTAMP(3)
LANGUAGE sql STABLE AS $$
  SELECT s."closedThrough" FROM "accounting_settings" s WHERE s."organizationId" = org_id
$$;

CREATE OR REPLACE FUNCTION "ledger_guard_closed_entries"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  closed TIMESTAMP(3);
BEGIN
  closed := "ledger_closed_through"(COALESCE(NEW."organizationId", OLD."organizationId"));
  IF closed IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW."date" <= closed THEN
      RAISE EXCEPTION 'The books are closed through %; an entry cannot be dated %',
        closed::date, NEW."date"::date USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD."date" <= closed THEN
      RAISE EXCEPTION 'The books are closed through %; entry % cannot be deleted',
        closed::date, OLD."number" USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE
  IF OLD."date" <= closed OR NEW."date" <= closed THEN
    IF NEW."date" IS DISTINCT FROM OLD."date"
       OR NEW."number" IS DISTINCT FROM OLD."number"
       OR NEW."totalAmount" IS DISTINCT FROM OLD."totalAmount"
       OR NEW."sourceType" IS DISTINCT FROM OLD."sourceType"
       OR NEW."sourceId" IS DISTINCT FROM OLD."sourceId"
       OR NEW."reversesId" IS DISTINCT FROM OLD."reversesId"
       OR NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
       OR NOT (NEW."status" = OLD."status" OR (OLD."status" = 'posted' AND NEW."status" = 'reversed'))
    THEN
      RAISE EXCEPTION 'The books are closed through %; entry % can only be marked reversed',
        closed::date, OLD."number" USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "journal_entries_closed_period_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "journal_entries"
  FOR EACH ROW EXECUTE FUNCTION "ledger_guard_closed_entries"();

CREATE OR REPLACE FUNCTION "ledger_guard_closed_lines"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  closed TIMESTAMP(3);
  line_date TIMESTAMP(3);
BEGIN
  closed := "ledger_closed_through"(COALESCE(NEW."organizationId", OLD."organizationId"));
  IF closed IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  line_date := CASE WHEN TG_OP = 'DELETE' THEN OLD."date" ELSE NEW."date" END;
  IF line_date <= closed OR (TG_OP = 'UPDATE' AND OLD."date" <= closed) THEN
    RAISE EXCEPTION 'The books are closed through %; lines dated % cannot change',
      closed::date, line_date::date USING ERRCODE = '23514';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER "journal_lines_closed_period_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "journal_lines"
  FOR EACH ROW EXECUTE FUNCTION "ledger_guard_closed_lines"();

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'ledger_accounts', 'journal_entries', 'journal_lines', 'accounting_settings',
    'bank_accounts', 'bank_transfers', 'owner_settlements', 'owner_payouts'
  ] LOOP
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
