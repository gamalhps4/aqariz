-- Reference-integrity follow-ups from the 2026-08-22 audit: real FKs for
-- soft references on money/messaging rows, missing FK-column indexes,
-- currency on long-lived money rows, and soft-delete-aware unit numbering.
--
-- If an ADD CONSTRAINT fails, orphan rows reference ids that no longer
-- exist — resolve those rows, then re-run.

-- ============================================================================
-- Security deposits: FK to units, missing indexes, held currency
-- ============================================================================

CREATE INDEX "security_deposits_unitId_idx" ON "security_deposits"("unitId");
CREATE INDEX "security_deposits_propertyId_idx" ON "security_deposits"("propertyId");
ALTER TABLE "security_deposits" ADD CONSTRAINT "security_deposits_unitId_fkey"
  FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "security_deposits" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'USD';

-- Recurring payments are the templates that GENERATE payments — their amount
-- carries its own currency like payments/invoices/expenses already do.
ALTER TABLE "recurring_payments" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'USD';

-- ============================================================================
-- Message statuses die with their message/conversation
-- ============================================================================

ALTER TABLE "message_statuses" ADD CONSTRAINT "message_statuses_messageId_fkey"
  FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "message_statuses" ADD CONSTRAINT "message_statuses_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "message_statuses_senderId_idx" ON "message_statuses"("senderId");

-- ============================================================================
-- Unit numbers: unique among live rows only
-- ============================================================================

-- The total unique blocked re-creating "3B" after soft-deleting it.
DROP INDEX "units_propertyId_unitNumber_key";
CREATE UNIQUE INDEX units_property_unit_number_active_unique
  ON "units"("propertyId", "unitNumber") WHERE "deletedAt" IS NULL;
CREATE INDEX "units_propertyId_unitNumber_idx" ON "units"("propertyId", "unitNumber");

-- ============================================================================
-- FK-column indexes (Postgres does not auto-index FK columns)
-- ============================================================================

CREATE INDEX "roles_createdById_idx" ON "roles"("createdById");
CREATE INDEX "event_invitations_inviterId_idx" ON "event_invitations"("inviterId");
