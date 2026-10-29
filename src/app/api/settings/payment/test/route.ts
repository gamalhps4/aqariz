/**
 * PropertyPro - Payment Gateway Test API
 *
 * Verifies a gateway's credentials using the values currently in the admin
 * form (so settings can be checked before saving), falling back on this
 * organization's saved values for any field left blank. Admin-only.
 *
 * Each gateway's adapter makes the cheapest authenticated call its API has
 * (lib/payments/adapters/*: `testCredentials`) — Stripe reads the balance,
 * PayPal mints a token, Moyasar lists payments, PayTabs and Tap look up a
 * reference that does not exist and accept "not found" as a key that works.
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import {
  AuthenticatedAccessUser,
  withPermissionAndDB,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
} from "@/lib/api-utils";
import { getOrgSystemSettings } from "@/lib/services/system-settings";
import { getGatewayDef, isGatewayId } from "@/lib/payments/gateway-registry";
import { getGatewayAdapter } from "@/lib/payments/adapters";
import { decryptSensitiveValue } from "@/lib/security/field-encryption";
import { allowedGatewayIds } from "@/lib/payments/gateway-availability";
import { noteAuditEntry } from "@/lib/audit/scope";

/** "test" or "live", where the credentials say. */
function modeOf(credentials: Record<string, string>): string | null {
  if (credentials.mode) return credentials.mode === "live" ? "live" : "test";
  const key = credentials.secretKey ?? "";
  if (key.startsWith("sk_live_")) return "live";
  if (key.startsWith("sk_test_")) return "test";
  return null;
}

// ============================================================================
// POST /api/settings/payment/test - verify a gateway's credentials
// ============================================================================
export const POST = withPermissionAndDB("system_settings")(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const body = await request.json().catch(() => ({}));
      const provider = body.provider || "stripe";

      const def = isGatewayId(provider) ? getGatewayDef(provider) : undefined;
      if (!def) {
        return createErrorResponse("Unknown payment gateway", 400);
      }
      if (!(await allowedGatewayIds(user.organizationId!)).includes(def.id)) {
        return createErrorResponse(`${def.name} is not available on your package.`, 403);
      }

      // Form value → this organization's saved value, per field.
      const saved = ((await getOrgSystemSettings())?.paymentGateways as any)?.[def.id] ?? {};
      const credentials: Record<string, string> = {};
      for (const field of def.fields) {
        const submitted = body[field.key];
        if (typeof submitted === "string" && submitted.trim()) {
          credentials[field.key] = submitted.trim();
        } else if (saved[field.key]) {
          credentials[field.key] =
            field.type === "secret"
              ? String(decryptSensitiveValue(String(saved[field.key])) ?? "")
              : String(saved[field.key]);
        }
      }

      const missing = def.fields.filter((field) => field.required && !credentials[field.key]);
      if (missing.length > 0) {
        return createErrorResponse(
          `Enter ${missing.map((field) => field.label).join(", ")} to test ${def.name}.`,
          400,
        );
      }

      try {
        await getGatewayAdapter(def.id).testCredentials({ credentials });
      } catch (error) {
        return createErrorResponse(
          `${def.name} connection failed: ${
            error instanceof Error && error.message
              ? error.message
              : "could not authenticate with these credentials"
          }`,
          400,
        );
      }

      // A credentials check reads from the gateway and changes nothing, so it
      // is not an entry. The API wrapper would otherwise log it as an email
      // sent (a path ending in /test), which it is not.
      noteAuditEntry();

      const mode = modeOf(credentials);
      return createSuccessResponse({
        message: `${def.name} connection successful${mode ? ` (${mode} mode)` : ""}.`,
        provider: def.id,
        mode,
      });
    } catch (error) {
      console.error("POST /api/settings/payment/test error:", error);
      return handleApiError(error);
    }
  }
);
