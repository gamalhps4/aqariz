/**
 * PropertyPro - Stripe Browser Client
 *
 * Resolves the Stripe.js publishable key at runtime from /api/payments/config,
 * which serves the CURRENT ORGANIZATION's key. No secrets are exposed here.
 *
 * There is deliberately no build-time NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
 * fallback. That key belongs to the platform's own Stripe account (subscription
 * billing); using it here charged tenants' rent into the platform's account
 * instead of the property manager's. An organization with no Stripe key
 * configured gets `null`, and the payment gate renders its unavailable state.
 */

import { loadStripe, Stripe } from "@stripe/stripe-js";

export interface PublicGatewayEntry {
  configured: boolean;
  [field: string]: string | boolean;
}
/** A gateway a payer can be sent to now (GET /api/payments/config). */
export interface AvailableGateway {
  id: string;
  name: string;
  methods: string[];
  /** ISO codes it charges in; null when any. */
  currencies: string[] | null;
}
export interface PublicPaymentConfig {
  defaultProvider: string;
  gateways: Record<string, PublicGatewayEntry>;
  /** Allowed by the platform and package, and connected by the office. */
  available?: AvailableGateway[];
}

let publicConfigPromise: Promise<PublicPaymentConfig | null> | null = null;
let stripePromise: Promise<Stripe | null> | null = null;

/**
 * Shared, cached fetch of the browser-safe payment config (publishable keys +
 * `configured` flags per gateway). No secrets. Returns null if unreachable.
 */
export const getPublicPaymentConfig = (): Promise<PublicPaymentConfig | null> => {
  if (!publicConfigPromise) {
    publicConfigPromise = fetch("/api/payments/config", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => (j?.data ?? j ?? null))
      .catch(() => null);
  }
  return publicConfigPromise;
};

async function resolvePublishableKey(): Promise<string> {
  const config = await getPublicPaymentConfig();
  const key = config?.gateways?.stripe?.publishableKey;
  return typeof key === "string" ? key : "";
}

/**
 * Shared, cached Stripe.js promise. Pass straight into `<Elements stripe={...}>`.
 */
export const getStripePromise = (): Promise<Stripe | null> => {
  if (!stripePromise) {
    stripePromise = resolvePublishableKey().then((key) =>
      key ? loadStripe(key) : Promise.resolve(null)
    );
  }
  return stripePromise;
};

export const getStripe = () => getStripePromise();
