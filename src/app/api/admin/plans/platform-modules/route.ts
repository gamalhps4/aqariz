/**
 * PropertyPro SaaS - Platform-wide module switches (Platform Console)
 *
 * GET  — which modules are switched off for every package.
 * PUT  — { disabled: string[] } replaces that list.
 *
 * A switched-off module is off in every package at once, whatever each one
 * includes (lib/billing/modules.ts). Stored in platform_settings.modules; until
 * that migration is applied GET reports `available: false` and PUT refuses.
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import {
  type AuthenticatedAccessUser,
  createErrorResponse,
  createSuccessResponse,
  handleApiError,
  parseRequestBody,
  withPlatformAdminAndDB,
} from "@/lib/api-utils";
import {
  getPlatformModuleSwitches,
  setPlatformModuleSwitches,
} from "@/lib/billing/platform-modules";
import { recordPlatformAudit } from "@/lib/platform/audit";

export const GET = withPlatformAdminAndDB()(
  async (_user: AuthenticatedAccessUser, _request: NextRequest) => {
    try {
      return createSuccessResponse(await getPlatformModuleSwitches());
    } catch (error) {
      return handleApiError(error, "Failed to load the platform modules");
    }
  },
);

export const PUT = withPlatformAdminAndDB()(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const body = await parseRequestBody(request);
      if (!body.success) return createErrorResponse("Invalid JSON body", 400);
      const disabled = (body.data as { disabled?: unknown } | null)?.disabled;
      if (!Array.isArray(disabled)) {
        return createErrorResponse("`disabled` must be a list of module keys", 400);
      }

      const before = await getPlatformModuleSwitches();
      const saved = await setPlatformModuleSwitches(disabled);

      const switchedOff = saved.disabled.filter(
        (key) => !before.disabled.includes(key),
      );
      const switchedOn = before.disabled.filter(
        (key) => !saved.disabled.includes(key),
      );
      await recordPlatformAudit({
        actor: user,
        action: "settings.updated",
        targetType: "settings",
        targetId: "platform-modules",
        targetName: "Platform modules",
        summary:
          switchedOff.length + switchedOn.length === 0
            ? "Platform modules saved unchanged"
            : `Platform modules: off ${switchedOff.join(", ") || "—"}; on ${switchedOn.join(", ") || "—"}`,
        metadata: { disabled: saved.disabled, switchedOff, switchedOn },
      });

      return createSuccessResponse(saved, "Platform modules saved");
    } catch (error) {
      return handleApiError(error, "Failed to save the platform modules");
    }
  },
);
