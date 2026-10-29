-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "subscriptionAmount" DECIMAL(14,2),
ADD COLUMN     "subscriptionCurrency" TEXT,
ADD COLUMN     "subscriptionInterval" TEXT;

-- AlterTable
ALTER TABLE "plans" ADD COLUMN     "stripePriceIdYearly" TEXT,
ADD COLUMN     "yearlyPrice" DECIMAL(14,2);
