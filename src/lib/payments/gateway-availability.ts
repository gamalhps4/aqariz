/**
 * PropertyPro - Which gateways an office can take payments through
 *
 * Three switches, all of which must be on:
 *
 *   1. the platform — the Super Admin can switch a gateway off for everyone;
 *   2. the package — each package includes the gateways the Super Admin ticks
 *      (both are the gateway's plan module, `capability.gateway_<id>`, read
 *      through lib/billing/modules.ts like every other module);
 *   3. the office — it switched the gateway on in Settings → Online payments
 *      with its own merchant account's credentials.
 *
 * And a fourth per payment: the gateway must take the payment's currency
 * (PayPal never the riyal, Moyasar only the riyal).
 *
 * This gates STARTING a payment and the office's settings page. Money already
 * taken through a gateway is still recorded, and refunded, after any of the
 * switches goes off — see getStoredGatewayCredentials.
 */

import "server-only";

import {
  PAYMENT_GATEWAYS,
  getGatewayDef,
  gatewaySupportsCurrency,
  type GatewayId,
  type GatewayMethod,
} from "@/lib/payments/gateway-registry";
import { chargeCurrency } from "@/lib/payments/gateway-currency";
import { getOrganizationModules } from "@/lib/billing/entitlements";
import { isModuleOn } from "@/lib/billing/modules";
import {
  getGatewayConfig,
  type ResolvedGatewayConfig,
} from "@/lib/services/payment-config.service";

export interface OfficeGateway {
  id: GatewayId;
  name: string;
  methods: readonly GatewayMethod[];
  currencies: readonly string[] | null;
  /** The platform and the office's package allow it. */
  allowed: boolean;
  /** The office switched it on with complete credentials. */
  connected: boolean;
}

/** The gateways the platform and this office's package allow. */
export async function allowedGatewayIds(organizationId: string): Promise<GatewayId[]> {
  const { state } = await getOrganizationModules(organizationId);
  return PAYMENT_GATEWAYS.filter(
    (def) => def.implemented && isModuleOn(state, def.moduleKey),
  ).map((def) => def.id);
}

/** Every gateway, with whether this office may use it and has connected it. */
export async function officeGateways(organizationId: string): Promise<OfficeGateway[]> {
  const allowed = new Set(await allowedGatewayIds(organizationId));
  return Promise.all(
    PAYMENT_GATEWAYS.map(async (def) => {
      const config = await getGatewayConfig(def.id);
      return {
        id: def.id,
        name: def.name,
        methods: def.methods,
        currencies: def.currencies,
        allowed: allowed.has(def.id),
        connected: config.configured,
      };
    }),
  );
}

/** What a payer can pay this currency with, in the registry's order. */
export async function payableGateways(
  organizationId: string,
  currency: string | null | undefined,
): Promise<OfficeGateway[]> {
  const code = chargeCurrency(currency);
  return (await officeGateways(organizationId)).filter(
    (gateway) =>
      gateway.allowed && gateway.connected && gatewaySupportsCurrency(gateway.id, code),
  );
}

/** Why a gateway cannot take this payment. Carries the HTTP status to answer with. */
export class GatewayUnavailableError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "GatewayUnavailableError";
    this.statusCode = statusCode;
  }
}

/**
 * The office's credentials for a gateway it may charge this currency
 * through, or a GatewayUnavailableError saying why not.
 */
export async function requireUsableGateway(
  organizationId: string,
  id: GatewayId,
  currency: string | null | undefined,
): Promise<ResolvedGatewayConfig> {
  const def = getGatewayDef(id);
  if (!def?.implemented) {
    throw new GatewayUnavailableError("Unknown payment service.", 400);
  }
  if (!(await allowedGatewayIds(organizationId)).includes(id)) {
    throw new GatewayUnavailableError(
      `${def.name} is not available on this office's package.`,
      403,
    );
  }
  const config = await getGatewayConfig(id);
  if (!config.configured) {
    throw new GatewayUnavailableError(
      `${def.name} is not set up for this office. Contact the office to pay.`,
      409,
    );
  }
  if (!gatewaySupportsCurrency(id, chargeCurrency(currency))) {
    throw new GatewayUnavailableError(
      `${def.name} cannot take payments in ${chargeCurrency(currency)}.`,
      409,
    );
  }
  return config;
}
