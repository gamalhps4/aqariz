-- AlterTable
ALTER TABLE "users" ADD COLUMN     "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "auth_two_factors" (
    "id" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "backupCodes" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT true,
    "failedVerificationCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_two_factors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "auth_two_factors_userId_idx" ON "auth_two_factors"("userId");

-- CreateIndex
CREATE INDEX "auth_two_factors_secret_idx" ON "auth_two_factors"("secret");

-- AddForeignKey
ALTER TABLE "auth_two_factors" ADD CONSTRAINT "auth_two_factors_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- TOTP secrets are auth infrastructure, written only through the bypass
-- client (Better Auth). Same policy as auth_accounts: invisible to any
-- org-scoped query, so one tenant can never read another's 2FA material.
ALTER TABLE "auth_two_factors" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "auth_two_factors" FORCE ROW LEVEL SECURITY;
CREATE POLICY bypass_only ON "auth_two_factors" USING (
  current_setting('app.bypass_rls', true) = 'on'
) WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
);
