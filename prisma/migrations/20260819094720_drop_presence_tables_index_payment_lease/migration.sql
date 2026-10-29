/*
  Warnings:

  - You are about to drop the `online_statuses` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `typing_indicators` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "online_statuses" DROP CONSTRAINT "online_statuses_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "typing_indicators" DROP CONSTRAINT "typing_indicators_organizationId_fkey";

-- DropTable
DROP TABLE "online_statuses";

-- DropTable
DROP TABLE "typing_indicators";

-- CreateIndex
CREATE INDEX "payments_leaseId_idx" ON "payments"("leaseId");
