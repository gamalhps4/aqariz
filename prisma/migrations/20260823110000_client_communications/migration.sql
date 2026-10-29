-- Communication records: every interaction with a client that happens
-- OUTSIDE the in-app messaging module — calls, meetings, WhatsApp, letters.

-- CreateTable
CREATE TABLE "client_communications" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'note',
    "direction" TEXT NOT NULL DEFAULT 'outbound',
    "subject" TEXT NOT NULL,
    "body" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "propertyId" TEXT,
    "leaseId" TEXT,
    "followUpAt" TIMESTAMP(3),
    "followUpDone" BOOLEAN NOT NULL DEFAULT false,
    "recordedById" TEXT,
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_communications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "client_communications_organizationId_idx" ON "client_communications"("organizationId");
CREATE INDEX "client_communications_clientId_occurredAt_idx" ON "client_communications"("clientId", "occurredAt" DESC);
CREATE INDEX "client_communications_organizationId_followUpAt_idx" ON "client_communications"("organizationId", "followUpAt");
CREATE INDEX "client_communications_propertyId_idx" ON "client_communications"("propertyId");
CREATE INDEX "client_communications_deletedAt_idx" ON "client_communications"("deletedAt");

-- AddForeignKey
ALTER TABLE "client_communications" ADD CONSTRAINT "client_communications_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "client_communications" ADD CONSTRAINT "client_communications_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "client_communications" ADD CONSTRAINT "client_communications_recordedById_fkey"
    FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- Detaching, never cascading: a communication is a record of what was said,
-- and losing a property must not erase the conversation about it.
ALTER TABLE "client_communications" ADD CONSTRAINT "client_communications_propertyId_fkey"
    FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "client_communications" ADD CONSTRAINT "client_communications_leaseId_fkey"
    FOREIGN KEY ("leaseId") REFERENCES "leases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Guard the vocabularies at the database: the timeline groups and icons
-- switch on these, and an unknown value would render as a blank row.
ALTER TABLE "client_communications" ADD CONSTRAINT "client_communications_channel_check"
    CHECK ("channel" IN ('call','email','meeting','whatsapp','sms','letter','note'));
ALTER TABLE "client_communications" ADD CONSTRAINT "client_communications_direction_check"
    CHECK ("direction" IN ('inbound','outbound','internal'));

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['client_communications'] LOOP
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
