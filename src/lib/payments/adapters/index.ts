/**
 * PropertyPro - The adapter for each gateway (interface: ../gateway-adapter.ts)
 */

import type { GatewayId } from "@/lib/payments/gateway-registry";
import type { GatewayAdapter } from "@/lib/payments/gateway-adapter";
import { stripeAdapter } from "./stripe";
import { paypalAdapter } from "./paypal";
import { moyasarAdapter } from "./moyasar";
import { paytabsAdapter } from "./paytabs";
import { tapAdapter } from "./tap";

const ADAPTERS: Record<GatewayId, GatewayAdapter> = {
  stripe: stripeAdapter,
  paypal: paypalAdapter,
  moyasar: moyasarAdapter,
  paytabs: paytabsAdapter,
  tap: tapAdapter,
};

export function getGatewayAdapter(id: GatewayId): GatewayAdapter {
  return ADAPTERS[id];
}
