-- Accounting phase 0: what the office's VAT needs before the ledger posts it.
--
--   invoices        an invoice may be to an owner or to a customer who is not
--                   a tenant (tenant and building become optional), carries
--                   the buyer as printed on the tax invoice, and may be a
--                   credit note against another invoice
--   invoice_lines   a custom invoice's or credit note's lines, each with its
--                   own VAT category and rate, the discount taken before VAT
--   expenses        the VAT inside an expense, its category, its supplier and
--                   the supplier's invoice number
--   suppliers       the minimum a supplier needs: name, VAT number, phone
--
-- Additive and backward compatible: two NOT NULL constraints are dropped,
-- every new column is nullable or has a default, and nothing is backfilled.
-- Existing invoices keep their tenant and building; an invoice without lines
-- is read as before. The application leaves the new invoice and expense
-- columns out of its reads until it has seen this migration applied
-- (src/lib/invoice/phase0-columns.ts).

-- ============================================================================
-- INVOICES
-- ============================================================================
ALTER TABLE "invoices" ALTER COLUMN "tenantId" DROP NOT NULL;
ALTER TABLE "invoices" ALTER COLUMN "propertyId" DROP NOT NULL;

ALTER TABLE "invoices"
    ADD COLUMN "documentType"      TEXT NOT NULL DEFAULT 'invoice',
    ADD COLUMN "originalInvoiceId" TEXT,
    ADD COLUMN "creditedAmount"    DECIMAL(14,2) NOT NULL DEFAULT 0,
    ADD COLUMN "customerType"      TEXT,
    ADD COLUMN "customerUserId"    TEXT,
    ADD COLUMN "customerName"      TEXT,
    ADD COLUMN "customerVatNumber" TEXT,
    ADD COLUMN "customerAddress"   TEXT;

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_documentType_check"
    CHECK ("documentType" IN ('invoice', 'credit_note'));
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customerType_check"
    CHECK ("customerType" IS NULL OR "customerType" IN ('tenant', 'owner', 'customer'));
-- A credit note always names the invoice it corrects; an invoice never does.
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_credit_note_original_check"
    CHECK (("documentType" = 'credit_note') = ("originalInvoiceId" IS NOT NULL));

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_originalInvoiceId_fkey"
    FOREIGN KEY ("originalInvoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customerUserId_fkey"
    FOREIGN KEY ("customerUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "invoices_originalInvoiceId_idx" ON "invoices"("originalInvoiceId");
CREATE INDEX "invoices_customerUserId_idx" ON "invoices"("customerUserId");

-- ============================================================================
-- INVOICE LINES
-- ============================================================================
CREATE TABLE "invoice_lines" (
    "id"             TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "invoiceId"      TEXT NOT NULL,
    "position"       INTEGER NOT NULL DEFAULT 0,
    "description"    TEXT NOT NULL,
    "category"       TEXT,
    "quantity"       DECIMAL(14,3) NOT NULL DEFAULT 1,
    "unitPrice"      DECIMAL(14,2) NOT NULL,
    "discountAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "netAmount"      DECIMAL(14,2) NOT NULL,
    "vatCategory"    TEXT NOT NULL,
    "vatRate"        DECIMAL(6,3) NOT NULL DEFAULT 0,
    "vatAmount"      DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalAmount"    DECIMAL(14,2) NOT NULL,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "invoice_lines_vatCategory_check" CHECK ("vatCategory" IN ('S', 'Z', 'E', 'O')),
    -- Only a standard-rated line carries a rate.
    CONSTRAINT "invoice_lines_vatRate_check"
        CHECK ("vatRate" >= 0 AND ("vatCategory" = 'S' OR "vatRate" = 0))
);

CREATE INDEX "invoice_lines_organizationId_idx" ON "invoice_lines"("organizationId");
CREATE INDEX "invoice_lines_invoiceId_idx" ON "invoice_lines"("invoiceId");

ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoiceId_fkey"
    FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- SUPPLIERS
-- ============================================================================
CREATE TABLE "suppliers" (
    "id"             TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name"           TEXT NOT NULL,
    "vatNumber"      TEXT,
    "phone"          TEXT,
    "isActive"       BOOLEAN NOT NULL DEFAULT true,
    "deletedAt"      TIMESTAMP(3),
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "suppliers_organizationId_idx" ON "suppliers"("organizationId");
CREATE INDEX "suppliers_organizationId_name_idx" ON "suppliers"("organizationId", "name");

ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- EXPENSES
-- ============================================================================
ALTER TABLE "expenses"
    ADD COLUMN "vatAmount"             DECIMAL(14,2) NOT NULL DEFAULT 0,
    ADD COLUMN "vatCategory"           TEXT,
    ADD COLUMN "supplierId"            TEXT,
    ADD COLUMN "supplierInvoiceNumber" TEXT;

ALTER TABLE "expenses" ADD CONSTRAINT "expenses_vatCategory_check"
    CHECK ("vatCategory" IS NULL OR "vatCategory" IN ('S', 'Z', 'E', 'O'));
-- The VAT is part of what was paid, never more than it.
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_vatAmount_check"
    CHECK ("vatAmount" >= 0 AND "vatAmount" <= GREATEST("amount", 0));

ALTER TABLE "expenses" ADD CONSTRAINT "expenses_supplierId_fkey"
    FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "expenses_supplierId_idx" ON "expenses"("supplierId");

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['invoice_lines', 'suppliers'] LOOP
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
