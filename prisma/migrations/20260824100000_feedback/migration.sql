-- Product feedback raised inside a customer organization and answered by the
-- platform.
--
-- Until now this lived in a module-level Map seeded with five hardcoded sample
-- entries: every deployment showed the same invented feedback, a restart erased
-- anything real, and nothing a customer wrote ever reached the platform
-- operator it was addressed to.

-- CreateTable
CREATE TABLE "feedback" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userRole" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "feature" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "status" TEXT NOT NULL DEFAULT 'new',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "adminResponse" TEXT,
    "respondedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "feedback_organizationId_createdAt_idx" ON "feedback"("organizationId", "createdAt" DESC);
CREATE INDEX "feedback_status_priority_idx" ON "feedback"("status", "priority");
CREATE INDEX "feedback_userId_idx" ON "feedback"("userId");
CREATE INDEX "feedback_deletedAt_idx" ON "feedback"("deletedAt");

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- RESTRICT, not CASCADE: feedback is the record of what a customer told us.
-- Removing the person who said it must not silently delete what they said.
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Guard the vocabularies at the database. The dashboard switches on every one
-- of these to pick a badge colour and a group; an unknown value renders blank.
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_category_check"
    CHECK ("category" IN ('usability','performance','feature_request','bug_report','general'));
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_priority_check"
    CHECK ("priority" IN ('low','medium','high','critical'));
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_status_check"
    CHECK ("status" IN ('new','reviewing','in_progress','resolved','closed'));
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_rating_check"
    CHECK ("rating" BETWEEN 1 AND 5);
-- A reply and its timestamp travel together, so "answered" is never ambiguous.
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_response_check"
    CHECK (("adminResponse" IS NULL) = ("respondedAt" IS NULL));

-- ============================================================================
-- ROW LEVEL SECURITY
--
-- Same policy as every other org-scoped table. The platform console reads
-- across organizations through withPlatformAdminAndDB(), which sets
-- app.bypass_rls — there is no second, weaker policy for it.
-- ============================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['feedback'] LOOP
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
