/**
 * PropertyPro - Payment Gateway Registry
 *
 * Single source of truth for every payment gateway an office can collect
 * through. This one declaration drives:
 *   1. The per-organization storage shape (system_settings.paymentGateways).
 *   2. The office's settings page (one card per gateway, fields rendered from
 *      here) and the Super Admin's gateway page.
 *   3. Validation (which fields are required to enable a gateway).
 *   4. Which fields are secret (encrypted at rest, never returned to the
 *      browser) and which are public.
 *   5. The plan module that switches each gateway on per package and
 *      platform-wide (`moduleKey`, a capability in navigation/menu-config.ts).
 *   6. What the pay screens offer: the currencies a gateway can charge in and
 *      the methods its hosted page takes.
 *
 * Every office brings its own merchant account for each gateway and the money
 * goes straight to it. The platform's own Stripe credentials live in env and
 * are used ONLY for subscription billing (src/lib/billing/stripe.ts), never
 * for tenant collection. Talking to a gateway is its adapter's job
 * (lib/payments/adapters/, interface in lib/payments/gateway-adapter.ts).
 *
 * Pure data: the browser imports it.
 */

export type GatewayId = "stripe" | "paypal" | "moyasar" | "paytabs" | "tap";

/** What a gateway's hosted page lets the payer pay with — badges on the pay screens. */
export type GatewayMethod = "mada" | "card" | "applepay" | "stcpay" | "paypal";

export type GatewayFieldType = "text" | "secret" | "select";

export interface GatewayField {
  /** Credential key, e.g. "secretKey". Matches the model + DB shape. */
  key: string;
  label: string;
  /** "secret" => masked in the UI and never returned to the client. */
  type: GatewayFieldType;
  /** Exposed to the browser (e.g. Stripe publishable key). */
  isPublic?: boolean;
  /** Required for the gateway to be enabled. */
  required?: boolean;
  placeholder?: string;
  helpText?: string;
  /** Options for `select` fields (e.g. PayPal sandbox/live). */
  options?: { value: string; label: string }[];
}

// https://developer.paypal.com/docs/reports/reference/paypal-supported-currencies/
// The Saudi riyal is not one of them: PayPal stays hidden for SAR.
export const PAYPAL_CURRENCIES: readonly string[] = [
  "AUD", "BRL", "CAD", "CNY", "CZK", "DKK", "EUR", "HKD", "HUF", "ILS", "JPY",
  "MYR", "MXN", "TWD", "NZD", "NOK", "PHP", "PLN", "GBP", "SGD", "SEK", "CHF",
  "THB", "USD",
];

/** The regional PayTabs domains; a profile belongs to exactly one. */
export const PAYTABS_REGIONS: Record<string, string> = {
  SAU: "https://secure.paytabs.sa",
  ARE: "https://secure.paytabs.com",
  EGY: "https://secure-egypt.paytabs.com",
  OMN: "https://secure-oman.paytabs.com",
  JOR: "https://secure-jordan.paytabs.com",
  IRQ: "https://secure-iraq.paytabs.com",
  GLOBAL: "https://secure-global.paytabs.com",
};

export interface GatewayDef {
  id: GatewayId;
  name: string;
  /** false => UI shows "Coming soon" and the gateway cannot be enabled. */
  implemented: boolean;
  description: string;
  fields: GatewayField[];
  /** Plan module (capability) that lets a package, and the platform, use it. */
  moduleKey: string;
  /** ISO codes it can charge in; null when it takes whatever the office bills in. */
  currencies: readonly string[] | null;
  /** What its hosted page takes. */
  methods: readonly GatewayMethod[];
  /** Where the gateway is based — the Super Admin's page groups by it. */
  region: "saudi" | "global";
}

export const PAYMENT_GATEWAYS: GatewayDef[] = [
  {
    id: "stripe",
    name: "Stripe",
    implemented: true,
    description:
      "Cards and Apple Pay on Stripe's hosted checkout page.",
    moduleKey: "capability.gateway_stripe",
    currencies: null,
    methods: ["card", "applepay"],
    region: "global",
    fields: [
      {
        key: "publishableKey",
        label: "Publishable Key",
        type: "text",
        isPublic: true,
        required: true,
        placeholder: "pk_live_…",
        helpText: "Safe to expose in the browser.",
      },
      {
        key: "secretKey",
        label: "Secret Key",
        type: "secret",
        required: true,
        placeholder: "sk_live_…",
      },
      {
        key: "webhookSecret",
        label: "Webhook Signing Secret",
        type: "secret",
        placeholder: "whsec_…",
        helpText: "Used to verify incoming Stripe webhook events.",
      },
    ],
  },
  {
    id: "paypal",
    name: "PayPal",
    implemented: true,
    description:
      "PayPal Checkout. Buyers approve on PayPal and are redirected back to complete the payment.",
    moduleKey: "capability.gateway_paypal",
    currencies: PAYPAL_CURRENCIES,
    methods: ["paypal"],
    region: "global",
    fields: [
      {
        key: "mode",
        label: "Environment",
        type: "select",
        isPublic: true,
        required: true,
        helpText: "Use Sandbox while testing, Live to accept real payments.",
        options: [
          { value: "sandbox", label: "Sandbox (testing)" },
          { value: "live", label: "Live (production)" },
        ],
      },
      {
        key: "clientId",
        label: "Client ID",
        type: "text",
        isPublic: true,
        required: true,
        placeholder: "AeA1QIZ…",
        helpText: "Safe to expose in the browser.",
      },
      {
        key: "clientSecret",
        label: "Client Secret",
        type: "secret",
        required: true,
      },
      {
        key: "webhookId",
        label: "Webhook ID",
        type: "text",
        helpText:
          "From your PayPal app's webhook settings — used to verify incoming webhook events.",
      },
    ],
  },
  {
    id: "moyasar",
    name: "Moyasar",
    implemented: true,
    description:
      "Saudi gateway: mada, Visa/Mastercard, Apple Pay and STC Pay on Moyasar's hosted payment page.",
    moduleKey: "capability.gateway_moyasar",
    currencies: ["SAR"],
    methods: ["mada", "card", "applepay", "stcpay"],
    region: "saudi",
    fields: [
      {
        key: "secretKey",
        label: "Secret Key",
        type: "secret",
        required: true,
        placeholder: "sk_live_…",
        helpText: "From Moyasar Dashboard → Settings → API Keys. A sk_test_ key takes test payments only.",
      },
      {
        key: "webhookSecret",
        label: "Webhook Secret Token",
        type: "secret",
        placeholder: "••••••••",
        helpText:
          "The secret token you set on the webhook in Moyasar Dashboard → Settings → Webhooks.",
      },
    ],
  },
  {
    id: "paytabs",
    name: "PayTabs",
    implemented: true,
    description:
      "Saudi gateway: mada, Visa/Mastercard, Apple Pay and STC Pay on PayTabs' hosted payment page.",
    moduleKey: "capability.gateway_paytabs",
    currencies: ["SAR", "AED", "BHD", "EGP", "EUR", "GBP", "JOD", "KWD", "OMR", "QAR", "USD"],
    methods: ["mada", "card", "applepay", "stcpay"],
    region: "saudi",
    fields: [
      {
        key: "region",
        label: "Region",
        type: "select",
        required: true,
        helpText: "The PayTabs region your profile was opened in.",
        options: [
          { value: "SAU", label: "Saudi Arabia" },
          { value: "ARE", label: "United Arab Emirates" },
          { value: "EGY", label: "Egypt" },
          { value: "OMN", label: "Oman" },
          { value: "JOR", label: "Jordan" },
          { value: "IRQ", label: "Iraq" },
          { value: "GLOBAL", label: "Global" },
        ],
      },
      {
        key: "profileId",
        label: "Profile ID",
        type: "text",
        required: true,
        placeholder: "12345",
      },
      {
        key: "serverKey",
        label: "Server Key",
        type: "secret",
        required: true,
        placeholder: "SJNX…",
        helpText:
          "From PayTabs Merchant Dashboard → Developers → Key management. It also signs PayTabs' payment notifications.",
      },
    ],
  },
  {
    id: "tap",
    name: "Tap Payments",
    implemented: true,
    description:
      "Gulf gateway: mada, Visa/Mastercard, Apple Pay and STC Pay on Tap's hosted payment page.",
    moduleKey: "capability.gateway_tap",
    currencies: ["SAR", "AED", "BHD", "EGP", "EUR", "GBP", "JOD", "KWD", "OMR", "QAR", "USD"],
    methods: ["mada", "card", "applepay", "stcpay"],
    region: "saudi",
    fields: [
      {
        key: "secretKey",
        label: "Secret Key",
        type: "secret",
        required: true,
        placeholder: "sk_live_…",
        helpText:
          "From Tap Dashboard → goSell → API Credentials. It also signs Tap's payment notifications.",
      },
    ],
  },
];

/** The gateway ids, in the order the screens list them. */
export const GATEWAY_IDS: readonly GatewayId[] = PAYMENT_GATEWAYS.map((g) => g.id);

export function isGatewayId(value: unknown): value is GatewayId {
  return typeof value === "string" && GATEWAY_IDS.includes(value as GatewayId);
}

/** Whether a gateway can charge in this currency. */
export function gatewaySupportsCurrency(
  id: string,
  currency: string | null | undefined,
): boolean {
  const def = getGatewayDef(id);
  if (!def) return false;
  if (!def.currencies) return true;
  const code = String(currency ?? "").trim().toUpperCase();
  return def.currencies.includes(code);
}

export function getGatewayDef(id: string): GatewayDef | undefined {
  return PAYMENT_GATEWAYS.find((g) => g.id === id);
}

/** Field keys that are safe to expose to the browser for a gateway. */
export function getPublicFieldKeys(id: string): string[] {
  return (
    getGatewayDef(id)?.fields.filter((f) => f.isPublic).map((f) => f.key) ?? []
  );
}

/** Required field keys for a gateway (used when enabling it). */
export function getRequiredFieldKeys(id: string): string[] {
  return (
    getGatewayDef(id)?.fields.filter((f) => f.required).map((f) => f.key) ?? []
  );
}
