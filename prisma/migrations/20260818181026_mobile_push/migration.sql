-- AlterTable
ALTER TABLE "push_subscriptions" ALTER COLUMN "p256dh" DROP NOT NULL,
ALTER COLUMN "auth" DROP NOT NULL;
