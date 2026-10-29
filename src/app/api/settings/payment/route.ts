/**
 * PropertyPro - Payment Gateway Settings API
 *
 * Admin-only endpoints to read and update the payment gateway credentials this
 * organization uses to collect from its own tenants
 * (system_settings.paymentGateways). These are the ONLY credentials that rail
 * uses — there is no environment fallback, so an organization that configures
 * nothing here cannot collect online. Secrets are never returned to the client.
 *
 * The set of gateways and their fields is driven entirely by the registry in
 * src/lib/payments/gateway-registry.ts, so adding a gateway needs no changes here.
 *
 * `allowed` names the gateways the platform and the office's package include
 * (lib/payments/gateway-availability.ts); the page shows only those, and a
 * gateway outside them cannot be switched on. One switched on before its
 * package dropped it keeps its stored credentials, so the payments made
 * through it can still be recorded and refunded.
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
import { db } from "@/lib/db/prisma";
import { getOrCreateOrgSystemSettings } from "@/lib/services/system-settings";
import {
  PAYMENT_GATEWAYS,
  getGatewayDef,
  getRequiredFieldKeys,
  type GatewayId,
} from "@/lib/payments/gateway-registry";
import {
  getGatewayConfig,
  clearPaymentConfigCache,
} from "@/lib/services/payment-config.service";
import { encryptSensitiveValue } from "@/lib/security/field-encryption";
import { resolveApplicationOrigin } from "@/lib/billing/origin";
import { allowedGatewayIds } from "@/lib/payments/gateway-availability";
import { auditSettingsChange } from "@/lib/audit-domain";
import {
  PAYMENT_AUDIT_KEYS,
  PAYMENT_AUDIT_SECRETS,
  paymentSnapshot,
} from "@/lib/audit/settings-keys";

// Browser-safe view of one gateway: text values inline, secrets as booleans.
function serializeGateway(providerId: GatewayId, dbGateway: any) {
  const def = getGatewayDef(providerId)!;
  const out: Record<string, any> = { enabled: !!dbGateway?.enabled };
  const secretSet: Record<string, boolean> = {};
  for (const field of def.fields) {
    if (field.type === "secret") {
      // Only ever reports whether a secret exists — the value, encrypted or
      // not, never leaves the server.
      secretSet[field.key] = !!dbGateway?.[field.key];
    } else {
      out[field.key] = dbGateway?.[field.key] || "";
    }
  }
  out.secretSet = secretSet;
  return out;
}

/**
 * The webhook URL this organization must paste into each gateway's
 * dashboard. It carries their slug because each organization's events are
 * verified against their own signing secret — one shared URL cannot know which
 * secret to use. Built server-side so the browser never has to guess the
 * origin or the slug.
 */
async function buildWebhookUrls(
  origin: string,
): Promise<Record<string, string>> {
  // Readable under the caller's own org context (`org_self` RLS policy).
  const organization = await db.organization.findFirst({
    select: { slug: true },
  });
  if (!organization?.slug) return {};

  const urls: Record<string, string> = {};
  for (const def of PAYMENT_GATEWAYS) {
    urls[def.id] = `${origin}/api/payments/webhook/${def.id}/${organization.slug}`;
  }
  return urls;
}

async function buildResponse(settings: any, origin: string, organizationId: string) {
  const gateways: Record<string, any> = {};
  const active: Record<string, any> = {};

  for (const def of PAYMENT_GATEWAYS) {
    const dbGateway = settings?.paymentGateways?.[def.id];
    gateways[def.id] = serializeGateway(def.id, dbGateway);
    // Credentials come from this organization's row and nowhere else, so
    // `source` is always "database" — the field stays for the UI's benefit.
    const resolved = await getGatewayConfig(def.id, true);
    active[def.id] = {
      source: "database",
      configured: resolved.configured,
    };
  }

  return {
    defaultProvider: settings?.paymentGateways?.defaultProvider || "stripe",
    gateways,
    active,
    allowed: await allowedGatewayIds(organizationId),
    webhookUrls: await buildWebhookUrls(origin),
  };
}

// ============================================================================
// GET /api/settings/payment - read gateway settings + active source
// ============================================================================
export const GET = withPermissionAndDB("system_settings")(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const settings = await getOrCreateOrgSystemSettings(
        user.organizationId!,
      );
      return createSuccessResponse(
        await buildResponse(
          settings,
          resolveApplicationOrigin(request),
          user.organizationId!,
        ),
      );
    } catch (error) {
      console.error("GET /api/settings/payment error:", error);
      return handleApiError(error);
    }
  }
);

// ============================================================================
// PUT /api/settings/payment - update gateway credentials
// ============================================================================
export const PUT = withPermissionAndDB("system_settings")(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const body = await request.json();
      const incoming = body?.gateways ?? {};

      const settings = await getOrCreateOrgSystemSettings(
        user.organizationId!,
      );

      // Work on a plain copy of the Json group; write it back in one update.
      const nextGateways: Record<string, any> = {
        ...((settings.paymentGateways as Record<string, any>) ?? {}),
      };

      const allowed = await allowedGatewayIds(user.organizationId!);

      for (const def of PAYMENT_GATEWAYS) {
        const patch = incoming[def.id];
        if (!patch) continue; // gateway not present in this submission
        // Not on the office's package: the page does not show it, and
        // nothing about it is saved from here.
        if (!allowed.includes(def.id)) {
          if (patch.enabled && !nextGateways[def.id]?.enabled) {
            return createErrorResponse(
              `${def.name} is not available on your package.`,
              403,
            );
          }
          continue;
        }

        const existing = nextGateways[def.id] ?? {};
        const wantsEnabled = !!patch.enabled;

        // Resolve the final value of every field (secrets keep stored value
        // when left blank, mirroring the SMTP password behaviour).
        //
        // Secrets are encrypted before they touch the database. These are live
        // money-moving credentials for someone else's Stripe/PayPal account —
        // a database dump or a replica leak must not hand them over in the
        // clear. A stored value that is already an `enc:v1:` envelope passes
        // through `encryptSensitiveValue` unchanged, so re-saving a form with
        // the secret left blank does not double-encrypt it.
        const resolved: Record<string, string> = {};
        for (const field of def.fields) {
          const submitted = patch[field.key];
          if (field.type === "secret") {
            resolved[field.key] =
              typeof submitted === "string" && submitted.length > 0
                ? encryptSensitiveValue(submitted) || ""
                : existing[field.key] || "";
          } else {
            resolved[field.key] =
              typeof submitted === "string"
                ? submitted.trim()
                : existing[field.key] || "";
          }
        }

        // Guard rails when enabling a gateway.
        if (wantsEnabled) {
          if (!def.implemented) {
            return createErrorResponse(
              `${def.name} is not available yet and cannot be enabled.`,
              400
            );
          }
          const missing = getRequiredFieldKeys(def.id).filter(
            (k) => !resolved[k]
          );
          if (missing.length > 0) {
            const labels = missing.map(
              (k) => def.fields.find((f) => f.key === k)?.label || k
            );
            return createErrorResponse(
              `Cannot enable ${def.name}: missing ${labels.join(", ")}`,
              400
            );
          }
        }

        // Merge onto the existing gateway object (creates it when missing).
        nextGateways[def.id] = {
          ...existing,
          enabled: wantsEnabled,
          ...resolved,
        };
      }

      // Default provider: a known gateway; one outside the package is
      // left as it was (the pay screens list every usable gateway anyway).
      if (typeof body.defaultProvider === "string") {
        const target = getGatewayDef(body.defaultProvider);
        if (!target || !target.implemented) {
          return createErrorResponse("Invalid default gateway", 400);
        }
        if (allowed.includes(target.id)) {
          nextGateways.defaultProvider = body.defaultProvider;
        }
      }

      const updated = await db.systemSettings.update({
        where: { organizationId: user.organizationId! },
        data: {
          paymentGateways: nextGateways,
          updatedById: user.id,
          version: { increment: 1 },
        },
      });

      // One entry: which gateways are on, their mode and default, and which
      // keys were replaced — as "set", never the key. `settings` still holds
      // what was stored before this save (`nextGateways` is a copy).
      auditSettingsChange({
        area: "payment",
        before: paymentSnapshot(settings.paymentGateways),
        after: paymentSnapshot(nextGateways),
        keys: PAYMENT_AUDIT_KEYS,
        secretKeys: PAYMENT_AUDIT_SECRETS,
      });

      // New credentials take effect on the next charge.
      clearPaymentConfigCache(user.organizationId!);

      return createSuccessResponse({
        ...(await buildResponse(
          updated,
          resolveApplicationOrigin(request),
          user.organizationId!,
        )),
        message: "Payment settings saved successfully",
      });
    } catch (error) {
      console.error("PUT /api/settings/payment error:", error);
      return handleApiError(error);
    }
  }
);
