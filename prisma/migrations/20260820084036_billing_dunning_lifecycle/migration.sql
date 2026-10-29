-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "dunningNotifiedAt" TIMESTAMP(3),
ADD COLUMN     "pastDueSince" TIMESTAMP(3),
ADD COLUMN     "trialEndingNotifiedAt" TIMESTAMP(3),
ADD COLUMN     "trialExpiredAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "organizations_pastDueSince_idx" ON "organizations"("pastDueSince");

-- CreateIndex
CREATE INDEX "organizations_trialEndsAt_idx" ON "organizations"("trialEndsAt");
