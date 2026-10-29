/**
 * PropertyPro - Public Payment Config API
 *
 * Returns browser-safe payment gateway config (publishable keys + enabled
 * flags) so the client can initialize the active gateway at runtime instead of
 * relying on build-time NEXT_PUBLIC_* env vars. No secrets are ever returned.
 *
 * `available` lists the gateways a payer can be sent to right now: allowed by
 * the platform and the office's package, and connected by the office
 * (lib/payments/gateway-availability.ts). The pay screens draw one button per
 * entry that takes the payment's currency.
 *
 * Available to any authenticated user (tenants need it to pay).
 */

export const dynamic = "force-dynamic";

import {
  AuthenticatedAccessUser,
  withAccessAndDB,
  createSuccessResponse,
  handleApiError,
} from "@/lib/api-utils";
import { getPublicGatewayConfig } from "@/lib/services/payment-config.service";
import { officeGateways } from "@/lib/payments/gateway-availability";

// ============================================================================
// GET /api/payments/config - public (non-secret) gateway config for the browser
// ============================================================================
export const GET = withAccessAndDB({})(
  async (user: AuthenticatedAccessUser) => {
    try {
      const config = await getPublicGatewayConfig();
      // A platform super-admin belongs to no office: nothing to pay through.
      const available = user.organizationId
        ? (await officeGateways(user.organizationId))
            .filter((gateway) => gateway.allowed && gateway.connected)
            .map(({ id, name, methods, currencies }) => ({ id, name, methods, currencies }))
        : [];
      return createSuccessResponse({ ...config, available });
    } catch (error) {
      console.error("GET /api/payments/config error:", error);
      return handleApiError(error);
    }
  }
);
