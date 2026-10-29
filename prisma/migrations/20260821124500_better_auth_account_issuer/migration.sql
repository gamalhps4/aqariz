-- better-auth 1.7 added `issuer` to the account model and made it the stable
-- key: credential sign-in now matches on
-- (providerId = 'credential' AND issuer = 'local:credential' AND accountId = user.id).
-- Rows written under 1.6 have no issuer, so every password sign-in fails with
-- "User not found" until they are backfilled.
--
-- Added nullable, backfilled, then made NOT NULL, so this is safe on a database
-- that already holds accounts.

-- auth_accounts carries FORCE ROW LEVEL SECURITY with a bypass-only policy, and
-- migrations run as the ordinary application role — not a superuser. Without
-- this the UPDATE below silently matches zero rows and SET NOT NULL then fails
-- on the still-null column. Same bypass the auth client takes at runtime.
SET app.bypass_rls = 'on';

ALTER TABLE "auth_accounts" ADD COLUMN IF NOT EXISTS "issuer" TEXT;

-- Mirrors better-auth's own issuer derivation:
--   local methods         createLocalAccountIssuer(id) -> 'local:<id>'
--   OAuth, issuer known    provider.accountIssuer      -> e.g. Google's
--   OAuth, issuer unknown  createOAuthAccountIssuer(id) -> 'local:oauth:<id>'
-- Google is the only social provider wired up here that publishes one; GitHub
-- does not, so it takes the synthetic form.
UPDATE "auth_accounts"
SET "issuer" = CASE
  WHEN "providerId" = 'credential' THEN 'local:credential'
  WHEN "providerId" = 'google' THEN 'https://accounts.google.com'
  ELSE 'local:oauth:' || "providerId"
END
WHERE "issuer" IS NULL;

ALTER TABLE "auth_accounts" ALTER COLUMN "issuer" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "auth_accounts_issuer_accountId_key" ON "auth_accounts"("issuer", "accountId");

RESET app.bypass_rls;
