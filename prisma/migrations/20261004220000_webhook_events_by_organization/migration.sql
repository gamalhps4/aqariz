-- Webhook idempotency per office.
--
-- webhook_events was unique on (gateway, eventId) across every office, and
-- the per-office payment webhook claims an event before it has matched it to
-- a payment. PayTabs and Tap send no event id, so theirs is built from the
-- transaction (`<tran_ref>:A`, `<chg_id>:CAPTURED`): an office that saved its
-- own secret could sign an event carrying another office's transaction id,
-- claim it first, and that office's real webhook was then ignored as a
-- duplicate. The claim now names the office (src/lib/payments/webhook-claims.ts).
--
-- Additive: a nullable column, and the unique index widened to include it.
-- Existing rows keep NULL and stay unique among themselves. NULLS NOT
-- DISTINCT keeps the platform's own events (the Stripe billing webhook, no
-- office) unique exactly as before. The new index is built before the old
-- one goes, so uniqueness never lapses.

ALTER TABLE "webhook_events" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "webhook_events_gateway_organizationId_eventId_key"
  ON "webhook_events" ("gateway", "organizationId", "eventId") NULLS NOT DISTINCT;

DROP INDEX IF EXISTS "webhook_events_gateway_eventId_key";
