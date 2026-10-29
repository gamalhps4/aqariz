-- One gateway reference for every payment gateway (Stripe, PayPal, Moyasar,
-- PayTabs, Tap). Additive and nullable: existing rows keep their Stripe/PayPal
-- columns, which src/scripts/backfill-payment-gateway-refs.ts copies across.
-- A reference belongs to one payment, whichever office it is in.

ALTER TABLE "payments" ADD COLUMN "gatewayProvider" TEXT;
ALTER TABLE "payments" ADD COLUMN "gatewayPaymentId" TEXT;

CREATE UNIQUE INDEX "payments_gatewayProvider_gatewayPaymentId_key"
  ON "payments"("gatewayProvider", "gatewayPaymentId");
