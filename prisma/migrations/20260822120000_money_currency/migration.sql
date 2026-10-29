-- Money rows record the currency they are denominated in.
--
-- Every organization collects with its own Stripe/PayPal account and may bill
-- in its own currency. Until now the amount columns were bare decimals and the
-- currency was read from a mutable org setting at display time, so changing
-- that setting silently reinterpreted every historical record — receipts,
-- reports and tax figures alike.
--
-- Additive and non-blocking: Postgres stores a non-volatile column default in
-- the catalogue rather than rewriting the table, so no row is touched.
-- Existing rows adopt 'USD', which is what the previous default resolved to.

ALTER TABLE payments  ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'USD';
ALTER TABLE invoices  ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'USD';
ALTER TABLE expenses  ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'USD';
