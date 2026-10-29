/**
 * PropertyPro SaaS - Payment gateways (Platform Console)
 *
 * GET  — every gateway: on or off for the platform, which packages include
 *        it, and how it is doing (offices connected, last webhook, the last
 *        30 days' online payments).
 * PUT  — { gateway, platformEnabled?, plans? } switches one gateway for the
 *        whole platform and/or sets the packages that include it.
 *
 * A gateway is a plan module (`capability.gateway_<id>`, menu-config.ts), so
 * both switches are the ones every module has: the platform-wide list
 * (lib/billing/platform-modules.ts) and each package's stored list. Offices
 * bring their own merchant accounts (Settings → Online payments); nothing
 * here holds a credential.
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/prisma";
import { bypassOrgScope } from "@/lib/tenancy/context";
import {
  type AuthenticatedAccessUser,
  createErrorResponse,
  createSuccessResponse,
  handleApiError,
  parseRequestBody,
  withPlatformAdminAndDB,
} from "@/lib/api-utils";
import {
  PAYMENT_GATEWAYS,
  getGatewayDef,
  GATEWAY_IDS,
  type GatewayId,
} from "@/lib/payments/gateway-registry";
import { getAllPlans, invalidatePlanCache } from "@/lib/billing/plans";
import { isPlanFeatureKey } from "@/lib/billing/plan-constants";
import {
  encodeModuleSelection,
  enabledToggleableLeaves,
  resolveModuleState,
  withModulesAddedLater,
} from "@/lib/billing/modules";
import {
  getPlatformModuleSwitches,
  setPlatformModuleSwitches,
} from "@/lib/billing/platform-modules";
import { gatewayColumnsAvailable } from "@/lib/payments/gateway-columns";
import { recordPlatformSettingsChange } from "@/lib/audit/platform-events";
import { PLATFORM_GATEWAY_AUDIT_KEYS } from "@/lib/audit/settings-keys";
import { PaymentStatus } from "@/types";

const DAY_MS = 24 * 60 * 60 * 1000;

interface GatewayHealth {
  /** Offices that switched it on with their own account. */
  officesConnected: number;
  lastWebhookAt: string | null;
  webhooks30d: number;
  /** Payments it took in the last 30 days, by currency. Null before the migration. */
  received30d: Array<{ currency: string; count: number; amount: number }> | null;
  failed30d: number | null;
}

async function healthOf(id: GatewayId, columns: boolean): Promise<GatewayHealth> {
  const since = new Date(Date.now() - 30 * DAY_MS);
  return bypassOrgScope(async () => {
    const [officesConnected, lastWebhook, webhooks30d] = await Promise.all([
      db.systemSettings.count({
        where: { paymentGateways: { path: [id, "enabled"], equals: true } },
      }),
      db.webhookEvent.findFirst({
        where: { gateway: id },
        orderBy: { processedAt: "desc" },
        select: { processedAt: true },
      }),
      db.webhookEvent.count({ where: { gateway: id, processedAt: { gte: since } } }),
    ]);

    let received30d: GatewayHealth["received30d"] = null;
    let failed30d: number | null = null;
    if (columns) {
      const [received, failed] = await Promise.all([
        db.payment.groupBy({
          by: ["currency"],
          where: {
            gatewayProvider: id,
            status: { in: [PaymentStatus.PAID, PaymentStatus.PARTIAL] },
            paidDate: { gte: since },
          },
          _count: { _all: true },
          _sum: { amountPaid: true },
        }),
        db.payment.count({
          where: { gatewayProvider: id, status: PaymentStatus.FAILED, updatedAt: { gte: since } },
        }),
      ]);
      received30d = received.map((row) => ({
        currency: row.currency,
        count: row._count._all,
        amount: Number(row._sum.amountPaid ?? 0),
      }));
      failed30d = failed;
    }

    return {
      officesConnected,
      lastWebhookAt: lastWebhook?.processedAt.toISOString() ?? null,
      webhooks30d,
      received30d,
      failed30d,
    };
  });
}

export const GET = withPlatformAdminAndDB()(
  async (_user: AuthenticatedAccessUser, _request: NextRequest) => {
    try {
      const [plans, switches, columns] = await Promise.all([
        getAllPlans(),
        getPlatformModuleSwitches(),
        gatewayColumnsAvailable(),
      ]);
      const gateways = await Promise.all(
        PAYMENT_GATEWAYS.filter((def) => def.implemented).map(async (def) => ({
          id: def.id,
          name: def.name,
          region: def.region,
          methods: def.methods,
          currencies: def.currencies,
          moduleKey: def.moduleKey,
          platformEnabled: !switches.disabled.includes(def.moduleKey),
          plans: plans.filter((plan) => plan.modules.includes(def.moduleKey)).map((plan) => plan.key),
          health: await healthOf(def.id, columns),
        })),
      );
      return createSuccessResponse({
        gateways,
        plans: plans.map((plan) => ({ key: plan.key, name: plan.name })),
        // While false, the platform switch cannot be saved (migration 20261003150000).
        switchesAvailable: switches.available,
        // While false, offices cannot start online payments (migration 20261004140000).
        referenceColumns: columns,
      });
    } catch (error) {
      return handleApiError(error, "Failed to load the payment gateways");
    }
  },
);

const putSchema = z.object({
  gateway: z.enum(GATEWAY_IDS as [GatewayId, ...GatewayId[]]),
  platformEnabled: z.boolean().optional(),
  plans: z.array(z.string().min(1).max(100)).max(100).optional(),
});

/** A package's stored list with one module put in or taken out. */
function withModule(planKey: string, stored: readonly string[], moduleKey: string, on: boolean): string[] {
  const today = withModulesAddedLater(planKey, stored.filter(isPlanFeatureKey));
  const leaves = enabledToggleableLeaves(resolveModuleState(today).planEnabled);
  const next = on ? [...new Set([...leaves, moduleKey])] : leaves.filter((key) => key !== moduleKey);
  return encodeModuleSelection(next, planKey);
}

export const PUT = withPlatformAdminAndDB()(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const body = await parseRequestBody(request);
      if (!body.success) return createErrorResponse("Invalid JSON body", 400);
      const parsed = putSchema.safeParse(body.data);
      if (!parsed.success) {
        return createErrorResponse(parsed.error.issues[0]?.message || "Invalid request", 400);
      }
      const { gateway, platformEnabled, plans: wantedPlans } = parsed.data;
      const def = getGatewayDef(gateway)!;
      const changes: string[] = [];
      // What the entry compares: the platform switch and the packages that
      // include the gateway (by name), before and after. Only what this
      // request touched is filled in.
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};

      if (platformEnabled !== undefined) {
        const switches = await getPlatformModuleSwitches();
        const isOn = !switches.disabled.includes(def.moduleKey);
        before.platformEnabled = isOn;
        after.platformEnabled = isOn;
        if (isOn !== platformEnabled) {
          await setPlatformModuleSwitches(
            platformEnabled
              ? switches.disabled.filter((key) => key !== def.moduleKey)
              : [...switches.disabled, def.moduleKey],
          );
          after.platformEnabled = platformEnabled;
          changes.push(platformEnabled ? "switched on for the platform" : "switched off for the platform");
        }
      }

      if (wantedPlans) {
        const rows = await db.plan.findMany({ select: { key: true, name: true, features: true } });
        const unknown = wantedPlans.filter((key) => !rows.some((row) => row.key === key));
        if (unknown.length > 0) {
          return createErrorResponse(`Unknown package: ${unknown.join(", ")}`, 400);
        }
        const added: string[] = [];
        const removed: string[] = [];
        const packagesBefore: string[] = [];
        const packagesAfter: string[] = [];
        for (const row of rows) {
          const today = withModulesAddedLater(row.key, (row.features ?? []).filter(isPlanFeatureKey));
          const includes = resolveModuleState(today).planEnabled.has(def.moduleKey);
          const wants = wantedPlans.includes(row.key);
          if (includes) packagesBefore.push(row.name);
          if (wants) packagesAfter.push(row.name);
          if (includes === wants) continue;
          await db.plan.update({
            where: { key: row.key },
            data: { features: withModule(row.key, row.features ?? [], def.moduleKey, wants) },
          });
          (wants ? added : removed).push(row.name);
        }
        if (added.length) changes.push(`added to ${added.join(", ")}`);
        if (removed.length) changes.push(`removed from ${removed.join(", ")}`);
        if (added.length || removed.length) invalidatePlanCache();
        before.packages = packagesBefore;
        after.packages = packagesAfter;
      }

      // One entry with the before and after (`metadata.previous`/`current`,
      // which the console's activity screen shows); a save that changes
      // nothing records nothing. Named by the gateway's brand name.
      await recordPlatformSettingsChange({
        actor: user,
        targetId: `payment-gateway:${gateway}`,
        targetName: def.name,
        summary: `${def.name}: ${changes.join("; ")}`,
        before,
        after,
        keys: PLATFORM_GATEWAY_AUDIT_KEYS,
      });

      return createSuccessResponse({ gateway, changes }, "Payment gateway saved");
    } catch (error) {
      return handleApiError(error, "Failed to save the payment gateway");
    }
  },
);
