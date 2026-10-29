-- CreateTable
CREATE TABLE "error_logs" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "category" TEXT NOT NULL DEFAULT 'unknown',
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "organizationId" TEXT,
    "userId" TEXT,
    "userEmail" TEXT,
    "path" TEXT,
    "method" TEXT,
    "userAgent" TEXT,
    "digest" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "resolvedAt" TIMESTAMP(3),
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "error_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "error_logs_severity_lastSeenAt_idx" ON "error_logs"("severity", "lastSeenAt");

-- CreateIndex
CREATE INDEX "error_logs_organizationId_idx" ON "error_logs"("organizationId");

-- CreateIndex
CREATE INDEX "error_logs_resolvedAt_idx" ON "error_logs"("resolvedAt");

-- CreateIndex
CREATE UNIQUE INDEX "error_logs_fingerprint_key" ON "error_logs"("fingerprint");

-- Errors are written through the bypass client (reports can arrive before
-- sign-in, so there is no organization context to scope them to) and read
-- only from the platform console. Same shape as the other infrastructure
-- tables: nothing is visible without an explicit bypass.
ALTER TABLE "error_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "error_logs" FORCE ROW LEVEL SECURITY;
CREATE POLICY bypass_only ON "error_logs" USING (
  current_setting('app.bypass_rls', true) = 'on'
) WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
);
