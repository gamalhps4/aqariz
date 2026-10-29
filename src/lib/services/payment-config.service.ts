/**
 * PropertyPro - Payment Gateway Configuration Resolver
 *
 * Resolves the credentials an ORGANIZATION uses to collect money from its own
 * tenants. Every value comes from that organization's own settings row
 * (`system_settings.paymentGateways.<id>`) and nowhere else.
 *
 * There is deliberately NO environment-variable fallback here. The platform's
 * own Stripe credentials live in env and belong to a different rail entirely —
 * subscription billing, `src/lib/billing/stripe.ts`. Letting this resolver fall
 * back to them meant an organization that had never configured a gateway
 * collected its rent into the platform's Stripe account. An organization with
 * no credentials configured simply cannot collect online; the UI says so.
 *
 * Everything is keyed by organization. The cache included: it used to be keyed
 * by provider alone, so whichever organization resolved first supplied the
 * secret key for every other organization's charges for the next 60 seconds.
 *
 * Resolution requires an organization context (`runWithOrgContext`). Calling
 * from a bypass or platform-admin context throws rather than guessing — a
 * webhook must resolve its organization from its URL first (see
 * `src/app/api/payments/webhook/[gateway]/[orgSlug]`).
 */

import Stripe from "stripe";
import { getOrgContext } from "@/lib/tenancy/context";
import { getOrgSystemSettings } from "@/lib/services/system-settings";
import {
  PAYMENT_GATEWAYS,
  getGatewayDef,
  getRequiredFieldKeys,
  type GatewayId,
} from "@/lib/payments/gateway-registry";
import { decryptSensitiveValue } from "@/lib/security/field-encryption";
import { DEFAULT_CURRENCY } from "@/lib/regional/region";
import { STRIPE_GATEWAY_API_VERSION } from "@/lib/payments/adapters/stripe";

/** Single Stripe API version used by every server-side Stripe client. */
export const STRIPE_API_VERSION = STRIPE_GATEWAY_API_VERSION;
const CACHE_TTL_MS = 60 * 1000;

/**
 * Thrown when gateway credentials are asked for outside an organization
 * context. Carries a 500 rather than a 4xx: it means a caller is wired wrong,
 * not that the user did something invalid.
 */
export class MissingGatewayContextError extends Error {
  statusCode = 500;
  constructor(providerId: string) {
    super(
      `Cannot resolve ${providerId} credentials without an organization context. ` +
        `Wrap the call in runWithOrgContext, or resolve the organization from the request first.`,
    );
    this.name = "MissingGatewayContextError";
  }
}

/**
 * Thrown when the organization has not configured this gateway. A 4xx: the
 * fix is for one of their admins to add credentials.
 */
export class GatewayNotConfiguredError extends Error {
  statusCode = 503;
  constructor(providerId: string) {
    const name = getGatewayDef(providerId)?.name ?? providerId;
    super(
      `${name} is not set up for this organization. ` +
        `Add your ${name} credentials in Settings → Payments to start accepting online payments.`,
    );
    this.name = "GatewayNotConfiguredError";
  }
}

export interface ResolvedGatewayConfig {
  providerId: GatewayId;
  /** The organization these credentials belong to. */
  organizationId: string;
  enabled: boolean;
  /** Resolved credential values keyed by registry field key. */
  credentials: Record<string, string>;
  /** True when the gateway is enabled and all required fields are present. */
  configured: boolean;
}

interface ConfigCacheEntry {
  value: ResolvedGatewayConfig;
  expiresAt: number;
}

/** Keyed by `${organizationId}:${providerId}` — never by provider alone. */
const configCache = new Map<string, ConfigCacheEntry>();

/**
 * Stripe clients keyed by the secret they were built with. Two organizations
 * on the same account legitimately share one client; a key change builds a new
 * one. Bounded so a large tenant base cannot grow it without limit.
 */
const stripeClientCache = new Map<string, Stripe>();
const MAX_STRIPE_CLIENTS = 100;

/** The organization whose credentials are being resolved, or throw. */
function currentOrganizationId(providerId: GatewayId): string {
  const organizationId = getOrgContext()?.organizationId;
  if (!organizationId) throw new MissingGatewayContextError(providerId);
  return organizationId;
}

/**
 * True when there is no organization to resolve credentials for — a platform
 * super-admin, who operates above every organization and has none of their own.
 * The charge paths still throw; the display paths below use this to answer
 * "no gateways" instead of erroring.
 */
function hasNoOrganization(): boolean {
  return !getOrgContext()?.organizationId;
}

/** Read a gateway's stored sub-document from this organization's settings. */
async function getDbGateway(
  providerId: GatewayId,
): Promise<Record<string, any> | null> {
  const settings = await getOrgSystemSettings();
  const gateway = (settings?.paymentGateways as any)?.[providerId];
  return gateway && typeof gateway === "object" ? gateway : null;
}

/** A stored gateway sub-document's values, secrets decrypted. */
function readCredentials(
  providerId: GatewayId,
  dbGateway: Record<string, any>,
): Record<string, string> {
  const def = getGatewayDef(providerId);
  const credentials: Record<string, string> = {};
  for (const field of def?.fields ?? []) {
    const value = dbGateway[field.key];
    if (value === undefined || value === null || value === "") continue;
    // Secrets are stored encrypted; text fields (publishable key, PayPal
    // mode) are not. decryptSensitiveValue passes plaintext through, so a
    // row written before encryption landed still resolves.
    credentials[field.key] =
      field.type === "secret"
        ? String(decryptSensitiveValue(String(value)) ?? "")
        : String(value);
  }
  return credentials;
}

/**
 * The credentials this organization stored for a gateway, switched on or
 * not. For money already taken: a webhook to verify, a payer coming back, a
 * refund. An office that switches a gateway off (or whose package no longer
 * includes it) still has payments made through it to record and to refund;
 * starting a new charge goes through `requireGatewayConfig` instead.
 */
export async function getStoredGatewayCredentials(
  providerId: GatewayId,
): Promise<Record<string, string>> {
  currentOrganizationId(providerId);
  const dbGateway = await getDbGateway(providerId);
  return dbGateway ? readCredentials(providerId, dbGateway) : {};
}

function hasAllRequired(
  providerId: GatewayId,
  creds: Record<string, string>,
): boolean {
  return getRequiredFieldKeys(providerId).every((key) => Boolean(creds[key]));
}

/**
 * Resolve one gateway's credentials for the current organization.
 *
 * Always returns — inspect `configured` to decide whether collection is
 * possible. Use `requireGatewayConfig` when you are about to charge and want
 * the failure to be loud.
 */
export async function getGatewayConfig(
  providerId: GatewayId,
  force = false,
): Promise<ResolvedGatewayConfig> {
  const organizationId = currentOrganizationId(providerId);
  const cacheKey = `${organizationId}:${providerId}`;

  const cached = configCache.get(cacheKey);
  if (!force && cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const resolved: ResolvedGatewayConfig = {
    providerId,
    organizationId,
    enabled: false,
    credentials: {},
    configured: false,
  };

  const dbGateway = await getDbGateway(providerId);
  if (dbGateway?.enabled) {
    const credentials = readCredentials(providerId, dbGateway);
    resolved.enabled = true;
    resolved.credentials = credentials;
    resolved.configured = hasAllRequired(providerId, credentials);
  }

  configCache.set(cacheKey, {
    value: resolved,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
  return resolved;
}

/** Resolve a gateway, throwing when this organization cannot use it. */
export async function requireGatewayConfig(
  providerId: GatewayId,
  force = false,
): Promise<ResolvedGatewayConfig> {
  const config = await getGatewayConfig(providerId, force);
  if (!config.configured) throw new GatewayNotConfiguredError(providerId);
  return config;
}

/**
 * A Stripe client built from THIS organization's secret key.
 *
 * Never returns a client built from the platform's key — the platform's Stripe
 * account is reachable only through `getBillingStripe()` on the billing rail.
 */
export async function getStripeClient(force = false): Promise<Stripe> {
  const config = await requireGatewayConfig("stripe", force);
  const secretKey = config.credentials.secretKey;
  if (!secretKey) throw new GatewayNotConfiguredError("stripe");

  const existing = stripeClientCache.get(secretKey);
  if (existing) return existing;

  if (stripeClientCache.size >= MAX_STRIPE_CLIENTS) stripeClientCache.clear();
  const client = new Stripe(secretKey, {
    apiVersion: STRIPE_API_VERSION as Stripe.StripeConfig["apiVersion"],
  });
  stripeClientCache.set(secretKey, client);
  return client;
}

/** This organization's Stripe webhook signing secret, if they set one. */
export async function getStripeWebhookSecret(
  force = false,
): Promise<string | undefined> {
  const config = await getGatewayConfig("stripe", force);
  return config.credentials.webhookSecret || undefined;
}

export interface PublicGatewayEntry {
  /** True when the gateway is usable for payments. */
  configured: boolean;
  /** Public credential fields (e.g. publishableKey). */
  [field: string]: string | boolean;
}

export interface PublicGatewayConfig {
  defaultProvider: string;
  gateways: Record<string, PublicGatewayEntry>;
}

/**
 * The browser-safe payment config for the current organization: `isPublic`
 * fields plus a `configured` flag per gateway. No secrets, and no other
 * organization's keys — the publishable key a tenant's browser receives
 * decides which Stripe account their card is charged against.
 */
export async function getPublicGatewayConfig(): Promise<PublicGatewayConfig> {
  // A platform super-admin belongs to no organization, so there are no
  // collection credentials to report. Say that plainly rather than failing:
  // the payment components read this to decide what to offer, and every
  // gateway simply reads as unconfigured.
  if (hasNoOrganization()) {
    return {
      defaultProvider: "stripe",
      gateways: Object.fromEntries(
        PAYMENT_GATEWAYS.map((def) => [def.id, { configured: false }]),
      ),
    };
  }

  let defaultProvider = "stripe";
  const settings = await getOrgSystemSettings();
  if (settings?.paymentGateways?.defaultProvider) {
    defaultProvider = settings.paymentGateways.defaultProvider;
  }

  const gateways: PublicGatewayConfig["gateways"] = {};
  for (const def of PAYMENT_GATEWAYS) {
    const config = await getGatewayConfig(def.id);
    const publicValues: Record<string, string> = {};
    for (const field of def.fields) {
      if (field.isPublic && config.credentials[field.key]) {
        publicValues[field.key] = config.credentials[field.key];
      }
    }
    gateways[def.id] = { configured: config.configured, ...publicValues };
  }

  return { defaultProvider, gateways };
}

/**
 * The currency this organization charges in (e.g. "SAR"), from its own
 * settings. Falls back to the market's currency when unset.
 */
export async function getPaymentCurrency(): Promise<string> {
  if (hasNoOrganization()) return DEFAULT_CURRENCY;
  const settings = await getOrgSystemSettings();
  const currency = settings?.payment?.currency;
  return currency ? String(currency).toUpperCase() : DEFAULT_CURRENCY;
}

/**
 * Drop cached credentials after a settings change.
 *
 * Pass the organization id to evict just that tenant. NOTE: this clears the
 * cache in the current process only — another instance keeps serving the
 * previous values until its own entries expire (CACHE_TTL_MS).
 */
export function clearPaymentConfigCache(organizationId?: string): void {
  if (!organizationId) {
    configCache.clear();
    stripeClientCache.clear();
    return;
  }
  for (const key of configCache.keys()) {
    if (key.startsWith(`${organizationId}:`)) configCache.delete(key);
  }
}
