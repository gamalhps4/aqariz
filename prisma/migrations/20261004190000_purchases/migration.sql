-- Purchases and payments: what the office buys and how it pays for it, on top
-- of the ledger.
--
--   suppliers                      the Phase 0 minimum (name, VAT number, phone)
--                                  gains a contact, an address, the bank details
--                                  to pay into, and payment terms
--   purchase_bills                 a supplier's invoice to the office: numbered
--                                  in sequence (BILL-000123), dated, due, and
--                                  approved before it is owed
--   purchase_bill_lines            what is bought, line by line: the ledger
--                                  account it is charged to, its VAT category
--                                  and rate, and the building and unit it
--                                  belongs to (the cost centre)
--   payment_vouchers               money paid out (سند صرف), numbered in
--                                  sequence (PV-000045), drawn on one of the
--                                  office's bank or cash accounts
--   payment_voucher_allocations    which bills a voucher paid, and how much
--   purchase_counters              the next bill and voucher number, one row per
--                                  organization and kind
--   bank_reconciled_lines          the lines of a bank or cash account the
--                                  office has ticked off against its statement
--
-- The ledger posts both documents (source types purchase_bill and
-- payment_voucher, widened below): a bill, once approved, owes the supplier
-- (Dr the cost account and input VAT / Cr suppliers' payable); a voucher pays
-- them (Dr suppliers' payable / Cr the bank or cash account).
--
-- Reconciliation marks live in a table of their own rather than on
-- journal_lines: the closed-period guard refuses any change to a line dated
-- in a closed period, and ticking a line off against the bank statement must
-- stay possible for months already closed.
--
-- Additive and backward compatible: the supplier columns are nullable and the
-- application leaves them out of its reads until it has seen this migration
-- (src/lib/db/prisma.ts, src/lib/accounting/purchases/availability.ts); every
-- other change is a new table, and the one constraint widened only admits two
-- more source types. Nothing is backfilled.

-- ============================================================================
-- SUPPLIERS
-- ============================================================================
ALTER TABLE "suppliers"
    ADD COLUMN "contactName"      TEXT,
    ADD COLUMN "email"            TEXT,
    ADD COLUMN "address"          TEXT,
    ADD COLUMN "city"             TEXT,
    ADD COLUMN "crNumber"         TEXT,
    ADD COLUMN "bankName"         TEXT,
    ADD COLUMN "iban"             TEXT,
    ADD COLUMN "paymentTermsDays" INTEGER,
    ADD COLUMN "notes"            TEXT;

ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_paymentTermsDays_check"
    CHECK ("paymentTermsDays" IS NULL OR ("paymentTermsDays" >= 0 AND "paymentTermsDays" <= 365));

-- ============================================================================
-- NUMBERS
-- ============================================================================
-- The next bill number and the next voucher number, per organization. Taken
-- with an upsert inside the transaction that writes the document, so a number
-- is never skipped (a rollback gives it back) and never repeated (the row is
-- locked until commit).
CREATE TABLE "purchase_counters" (
    "organizationId" TEXT NOT NULL,
    "key"            TEXT NOT NULL,
    "lastNumber"     INTEGER NOT NULL DEFAULT 0,
    "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_counters_pkey" PRIMARY KEY ("organizationId", "key"),
    CONSTRAINT "purchase_counters_key_check" CHECK ("key" IN ('bill', 'voucher')),
    CONSTRAINT "purchase_counters_lastNumber_check" CHECK ("lastNumber" >= 0)
);

ALTER TABLE "purchase_counters" ADD CONSTRAINT "purchase_counters_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- PURCHASE BILLS
-- ============================================================================
CREATE TABLE "purchase_bills" (
    "id"                    TEXT NOT NULL,
    "organizationId"        TEXT NOT NULL,
    "number"                INTEGER NOT NULL,
    "supplierId"            TEXT NOT NULL,
    -- The supplier's own number for the invoice.
    "supplierInvoiceNumber" TEXT,
    -- Calendar days, stored as the midnight UTC that begins them (as the
    -- ledger's entries are).
    "billDate"              TIMESTAMP(3) NOT NULL,
    "dueDate"               TIMESTAMP(3) NOT NULL,
    -- pending (awaiting approval) | approved | partially_paid | paid | cancelled
    "status"                TEXT NOT NULL DEFAULT 'pending',
    "currency"              TEXT NOT NULL DEFAULT 'SAR',
    -- The lines' value before the discount; the discount is taken before VAT
    -- (as on the office's own invoices); the total is what is owed.
    "subtotal"              DECIMAL(14,2) NOT NULL,
    "discountAmount"        DECIMAL(14,2) NOT NULL DEFAULT 0,
    "vatAmount"             DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalAmount"           DECIMAL(14,2) NOT NULL,
    -- What posted vouchers have paid on it (the service keeps it equal to the
    -- sum of the bill's allocations on vouchers not cancelled).
    "amountPaid"            DECIMAL(14,2) NOT NULL DEFAULT 0,
    "notes"                 TEXT,
    "approvedById"          TEXT,
    "approvedAt"            TIMESTAMP(3),
    "cancelledById"         TEXT,
    "cancelledAt"           TIMESTAMP(3),
    "cancelReason"          TEXT,
    "createdById"           TEXT,
    "version"               INTEGER NOT NULL DEFAULT 0,
    "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"             TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_bills_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "purchase_bills_number_check" CHECK ("number" > 0),
    CONSTRAINT "purchase_bills_status_check"
        CHECK ("status" IN ('pending', 'approved', 'partially_paid', 'paid', 'cancelled')),
    CONSTRAINT "purchase_bills_amounts_check"
        CHECK ("subtotal" >= 0 AND "discountAmount" >= 0 AND "vatAmount" >= 0 AND "totalAmount" > 0),
    CONSTRAINT "purchase_bills_paid_check"
        CHECK ("amountPaid" >= 0 AND "amountPaid" <= "totalAmount"),
    CONSTRAINT "purchase_bills_due_check" CHECK ("dueDate" >= "billDate"),
    CONSTRAINT "purchase_bills_billDate_is_day_check" CHECK ("billDate" = date_trunc('day', "billDate")),
    CONSTRAINT "purchase_bills_dueDate_is_day_check" CHECK ("dueDate" = date_trunc('day', "dueDate"))
);

CREATE UNIQUE INDEX "purchase_bills_organizationId_number_key"
    ON "purchase_bills"("organizationId", "number");
-- The same supplier invoice is entered once: a second entry is almost always
-- the same paper keyed twice. A cancelled bill steps aside, so it can be
-- entered again.
CREATE UNIQUE INDEX "purchase_bills_supplier_invoice_unique"
    ON "purchase_bills"("organizationId", "supplierId", "supplierInvoiceNumber")
    WHERE "supplierInvoiceNumber" IS NOT NULL AND "status" <> 'cancelled';
CREATE INDEX "purchase_bills_organizationId_billDate_idx"
    ON "purchase_bills"("organizationId", "billDate");
CREATE INDEX "purchase_bills_organizationId_supplierId_status_idx"
    ON "purchase_bills"("organizationId", "supplierId", "status");
CREATE INDEX "purchase_bills_organizationId_status_dueDate_idx"
    ON "purchase_bills"("organizationId", "status", "dueDate");

ALTER TABLE "purchase_bills" ADD CONSTRAINT "purchase_bills_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_bills" ADD CONSTRAINT "purchase_bills_supplierId_fkey"
    FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "purchase_bill_lines" (
    "id"             TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "billId"         TEXT NOT NULL,
    "position"       INTEGER NOT NULL DEFAULT 0,
    "description"    TEXT NOT NULL,
    -- The ledger account the line is charged to: an expense account, or an
    -- asset for something the office capitalises.
    "accountId"      TEXT NOT NULL,
    "quantity"       DECIMAL(14,3) NOT NULL DEFAULT 1,
    "unitPrice"      DECIMAL(14,2) NOT NULL,
    -- This line's share of the bill's discount.
    "discountAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "netAmount"      DECIMAL(14,2) NOT NULL,
    -- S standard | Z zero-rated | E exempt | O out of scope — the ledger's
    -- VAT codes.
    "vatCategory"    TEXT NOT NULL,
    "vatRate"        DECIMAL(6,3) NOT NULL DEFAULT 0,
    "vatAmount"      DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalAmount"    DECIMAL(14,2) NOT NULL,
    -- The cost centre: the building and unit the cost belongs to. Plain
    -- columns, as on a journal line: the books outlive the records they
    -- describe.
    "propertyId"     TEXT,
    "unitId"         TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_bill_lines_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "purchase_bill_lines_vatCategory_check" CHECK ("vatCategory" IN ('S', 'Z', 'E', 'O')),
    CONSTRAINT "purchase_bill_lines_vatRate_check"
        CHECK ("vatRate" >= 0 AND ("vatCategory" = 'S' OR "vatRate" = 0)),
    CONSTRAINT "purchase_bill_lines_quantity_check" CHECK ("quantity" > 0),
    CONSTRAINT "purchase_bill_lines_amounts_check"
        CHECK ("unitPrice" >= 0 AND "discountAmount" >= 0 AND "netAmount" >= 0 AND "vatAmount" >= 0)
);

CREATE INDEX "purchase_bill_lines_organizationId_idx" ON "purchase_bill_lines"("organizationId");
CREATE INDEX "purchase_bill_lines_billId_idx" ON "purchase_bill_lines"("billId");
CREATE INDEX "purchase_bill_lines_accountId_idx" ON "purchase_bill_lines"("accountId");

ALTER TABLE "purchase_bill_lines" ADD CONSTRAINT "purchase_bill_lines_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_bill_lines" ADD CONSTRAINT "purchase_bill_lines_billId_fkey"
    FOREIGN KEY ("billId") REFERENCES "purchase_bills"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- An account a bill is charged to is never deleted from under it.
ALTER TABLE "purchase_bill_lines" ADD CONSTRAINT "purchase_bill_lines_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- PAYMENT VOUCHERS
-- ============================================================================
CREATE TABLE "payment_vouchers" (
    "id"             TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "number"         INTEGER NOT NULL,
    "supplierId"     TEXT NOT NULL,
    "voucherDate"    TIMESTAMP(3) NOT NULL,
    -- The bank or cash account the money left.
    "bankAccountId"  TEXT NOT NULL,
    "amount"         DECIMAL(14,2) NOT NULL,
    "currency"       TEXT NOT NULL DEFAULT 'SAR',
    -- cash | bank_transfer | cheque | card | other
    "method"         TEXT NOT NULL DEFAULT 'bank_transfer',
    -- The cheque or transfer number.
    "reference"      TEXT,
    "notes"          TEXT,
    -- posted | cancelled
    "status"         TEXT NOT NULL DEFAULT 'posted',
    "cancelledById"  TEXT,
    "cancelledAt"    TIMESTAMP(3),
    "cancelReason"   TEXT,
    "createdById"    TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_vouchers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payment_vouchers_number_check" CHECK ("number" > 0),
    CONSTRAINT "payment_vouchers_amount_check" CHECK ("amount" > 0),
    CONSTRAINT "payment_vouchers_status_check" CHECK ("status" IN ('posted', 'cancelled')),
    CONSTRAINT "payment_vouchers_voucherDate_is_day_check"
        CHECK ("voucherDate" = date_trunc('day', "voucherDate"))
);

CREATE UNIQUE INDEX "payment_vouchers_organizationId_number_key"
    ON "payment_vouchers"("organizationId", "number");
CREATE INDEX "payment_vouchers_organizationId_voucherDate_idx"
    ON "payment_vouchers"("organizationId", "voucherDate");
CREATE INDEX "payment_vouchers_organizationId_supplierId_status_idx"
    ON "payment_vouchers"("organizationId", "supplierId", "status");
CREATE INDEX "payment_vouchers_bankAccountId_idx" ON "payment_vouchers"("bankAccountId");

ALTER TABLE "payment_vouchers" ADD CONSTRAINT "payment_vouchers_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_vouchers" ADD CONSTRAINT "payment_vouchers_supplierId_fkey"
    FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_vouchers" ADD CONSTRAINT "payment_vouchers_bankAccountId_fkey"
    FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "payment_voucher_allocations" (
    "id"             TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "voucherId"      TEXT NOT NULL,
    "billId"         TEXT NOT NULL,
    "amount"         DECIMAL(14,2) NOT NULL,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_voucher_allocations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payment_voucher_allocations_amount_check" CHECK ("amount" > 0)
);

-- One line per bill on a voucher; paying a bill again takes a new allocation
-- only through the same line, so the pair is unique.
CREATE UNIQUE INDEX "payment_voucher_allocations_voucherId_billId_key"
    ON "payment_voucher_allocations"("voucherId", "billId");
CREATE INDEX "payment_voucher_allocations_billId_idx" ON "payment_voucher_allocations"("billId");
CREATE INDEX "payment_voucher_allocations_organizationId_idx" ON "payment_voucher_allocations"("organizationId");

ALTER TABLE "payment_voucher_allocations" ADD CONSTRAINT "payment_voucher_allocations_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_voucher_allocations" ADD CONSTRAINT "payment_voucher_allocations_voucherId_fkey"
    FOREIGN KEY ("voucherId") REFERENCES "payment_vouchers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payment_voucher_allocations" ADD CONSTRAINT "payment_voucher_allocations_billId_fkey"
    FOREIGN KEY ("billId") REFERENCES "purchase_bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- BANK RECONCILIATION
-- ============================================================================
CREATE TABLE "bank_reconciled_lines" (
    "id"             TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "bankAccountId"  TEXT NOT NULL,
    "journalLineId"  TEXT NOT NULL,
    -- The day the bank cleared it (the statement's date for the line).
    "reconciledOn"   TIMESTAMP(3) NOT NULL,
    "createdById"    TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_reconciled_lines_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "bank_reconciled_lines_reconciledOn_is_day_check"
        CHECK ("reconciledOn" = date_trunc('day', "reconciledOn"))
);

-- A line is reconciled once.
CREATE UNIQUE INDEX "bank_reconciled_lines_journalLineId_key"
    ON "bank_reconciled_lines"("journalLineId");
CREATE INDEX "bank_reconciled_lines_organizationId_bankAccountId_idx"
    ON "bank_reconciled_lines"("organizationId", "bankAccountId");

ALTER TABLE "bank_reconciled_lines" ADD CONSTRAINT "bank_reconciled_lines_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bank_reconciled_lines" ADD CONSTRAINT "bank_reconciled_lines_bankAccountId_fkey"
    FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- When a document's entry is replaced in an open period its lines go with it,
-- and their ticks with them: the new line then shows up to be ticked again.
ALTER TABLE "bank_reconciled_lines" ADD CONSTRAINT "bank_reconciled_lines_journalLineId_fkey"
    FOREIGN KEY ("journalLineId") REFERENCES "journal_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- THE LEDGER'S SOURCE TYPES
-- ============================================================================
-- Widens the closed list and nothing else. Until this migration is applied
-- the application posts no bill or voucher (their tables do not exist
-- either), and everything else posts as before.
ALTER TABLE "journal_entries" DROP CONSTRAINT "journal_entries_source_type_check";
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_source_type_check"
    CHECK ("sourceType" IN (
      'manual', 'opening_balance', 'invoice', 'invoice_settlement', 'payment',
      'payment_refund', 'expense', 'deposit_receipt', 'deposit_settlement',
      'bank_transfer', 'owner_settlement', 'owner_payout',
      'purchase_bill', 'payment_voucher'
    ));

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'purchase_counters', 'purchase_bills', 'purchase_bill_lines',
    'payment_vouchers', 'payment_voucher_allocations', 'bank_reconciled_lines'
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
