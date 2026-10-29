-- SMS and WhatsApp gateways: each office's own provider account, the Super
-- Admin's default gateway, a monthly message quota per package, and a log of
-- every message sent.
--
--   message_logs                      one row per message an office sent or
--                                     tried to send (blocked ones too), with
--                                     the provider's id and the delivery
--                                     status its reports move forward;
--   platform_settings.messaging       the default gateway, JSON
--                                     { sms: {...}, whatsapp: {...} } with
--                                     encrypted secrets;
--   plans.limitsMessagesPerMonth      messages a package may send per month
--                                     through the platform's gateway. NULL
--                                     is unlimited, as for every other limit.
--
-- Additive: a new table and two nullable columns. The office's own settings
-- live in the existing system_settings.integrations JSON. The two new columns
-- are read with raw SQL (Prisma `@ignore`) so code that runs before this
-- migration treats them as "no default gateway" and "unlimited".

-- ============================================================================
-- message_logs
-- ============================================================================
CREATE TABLE "message_logs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "gatewaySource" TEXT NOT NULL,
    "event" TEXT,
    "purpose" TEXT NOT NULL DEFAULT 'automation',
    "status" TEXT NOT NULL,
    "blockReason" TEXT,
    "recipientUserId" TEXT,
    "recipientName" TEXT,
    "toNumber" TEXT,
    "body" TEXT NOT NULL DEFAULT '',
    "templateName" TEXT,
    "providerMessageId" TEXT,
    "error" TEXT,
    "countsTowardQuota" BOOLEAN NOT NULL DEFAULT false,
    "sentById" TEXT,
    "communicationId" TEXT,
    "statusUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_logs_pkey" PRIMARY KEY ("id")
);

-- The log screen: newest first, inside one office.
CREATE INDEX "message_logs_organizationId_createdAt_idx"
    ON "message_logs"("organizationId", "createdAt" DESC);
-- The month's quota count.
CREATE INDEX "message_logs_organizationId_countsTowardQuota_createdAt_idx"
    ON "message_logs"("organizationId", "countsTowardQuota", "createdAt");
-- Delivery reports find their message by the provider's id.
CREATE INDEX "message_logs_provider_providerMessageId_idx"
    ON "message_logs"("provider", "providerMessageId");

ALTER TABLE "message_logs" ADD CONSTRAINT "message_logs_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['message_logs'] LOOP
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
-- The Super Admin's default gateway and the package quota
-- ============================================================================
-- platform_settings and plans already carry their RLS policies, which cover
-- the new columns.
ALTER TABLE "platform_settings" ADD COLUMN IF NOT EXISTS "messaging" JSONB;
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "limitsMessagesPerMonth" INTEGER;
