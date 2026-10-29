-- CreateTable
CREATE TABLE "contact_messages" (
    "id" TEXT NOT NULL,
    "topic" TEXT NOT NULL DEFAULT 'support',
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "company" TEXT,
    "subject" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'new',
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "readById" TEXT,
    "isStarred" BOOLEAN NOT NULL DEFAULT false,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "lastReplyAt" TIMESTAMP(3),
    "submittedById" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "source" TEXT NOT NULL DEFAULT 'contact_form',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contact_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_message_replies" (
    "id" TEXT NOT NULL,
    "contactMessageId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "authorEmail" TEXT NOT NULL,
    "emailSent" BOOLEAN NOT NULL DEFAULT false,
    "emailError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_message_replies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contact_messages_isArchived_createdAt_idx" ON "contact_messages"("isArchived", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "contact_messages_status_createdAt_idx" ON "contact_messages"("status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "contact_messages_topic_createdAt_idx" ON "contact_messages"("topic", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "contact_messages_isRead_createdAt_idx" ON "contact_messages"("isRead", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "contact_message_replies_contactMessageId_createdAt_idx" ON "contact_message_replies"("contactMessageId", "createdAt");

-- AddForeignKey
ALTER TABLE "contact_message_replies" ADD CONSTRAINT "contact_message_replies_contactMessageId_fkey" FOREIGN KEY ("contactMessageId") REFERENCES "contact_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A contact message carries a stranger's name, email and free text, so unlike
-- `plans` or `platform_announcements` it is NOT world-readable. Both tables are
-- reachable only through bypass: the public form writes inside a
-- `bypassOrgScope()` block, and the console reads as a platform admin.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['contact_messages','contact_message_replies'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY bypass_only ON %I USING (
         current_setting(''app.bypass_rls'', true) = ''on''
       ) WITH CHECK (
         current_setting(''app.bypass_rls'', true) = ''on''
       )', t);
  END LOOP;
END $$;
