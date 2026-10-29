-- CreateTable
CREATE TABLE "platform_announcements" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'info',
    "audience" TEXT,
    "dismissible" BOOLEAN NOT NULL DEFAULT true,
    "publishedAt" TIMESTAMP(3),
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "linkLabel" TEXT,
    "linkUrl" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_announcements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "platform_announcements_publishedAt_endsAt_idx" ON "platform_announcements"("publishedAt", "endsAt");

-- Same shape as `plans` and `landing_pages`: any tenant may read the notices
-- addressed to them, only the platform may write them.
ALTER TABLE "platform_announcements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform_announcements" FORCE ROW LEVEL SECURITY;
CREATE POLICY read_all ON "platform_announcements" FOR SELECT USING (true);
CREATE POLICY platform_write ON "platform_announcements" USING (
  current_setting('app.bypass_rls', true) = 'on'
) WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
);
