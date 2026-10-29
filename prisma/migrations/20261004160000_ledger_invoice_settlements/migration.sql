-- What an owner or a customer pays on their invoice is kept on the invoice
-- itself (invoices.metadata.settlements; they have no tenant record for a
-- payment row). Each settlement now posts as a journal entry of its own:
-- sourceType 'invoice_settlement', sourceId '<invoice id>:<n>'.
--
-- Widens the closed list of source types and nothing else. Until it is
-- applied the app posts no settlements (src/lib/accounting/documents.service.ts
-- checks for it) and everything else posts as before.

ALTER TABLE "journal_entries" DROP CONSTRAINT "journal_entries_source_type_check";
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_source_type_check"
    CHECK ("sourceType" IN (
      'manual', 'opening_balance', 'invoice', 'invoice_settlement', 'payment',
      'payment_refund', 'expense', 'deposit_receipt', 'deposit_settlement',
      'bank_transfer', 'owner_settlement', 'owner_payout'
    ));
