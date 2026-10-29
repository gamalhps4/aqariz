export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import {
  type AuthenticatedAccessUser,
  createErrorResponse,
  createSuccessResponse,
  handleApiError,
  isValidObjectId,
  parseRequestBody,
  withPlatformAdminAndDB,
} from "@/lib/api-utils";
import { recordPlatformAudit } from "@/lib/platform/audit";
import { bypassOrgScope } from "@/lib/tenancy/context";

export const PATCH = withPlatformAdminAndDB()(
  async (
    actor: AuthenticatedAccessUser,
    request: NextRequest,
    context: { params?: Promise<{ id: string }> },
  ) => {
    try {
      const { id } = (await context.params) ?? { id: "" };
      if (!isValidObjectId(id)) return createErrorResponse("Invalid user id", 400);

      const parsed = await parseRequestBody(request);
      if (!parsed.success) return createErrorResponse(parsed.error!, 400);
      const isActive = (parsed.data as { isActive?: unknown }).isActive;
      if (typeof isActive !== "boolean") {
        return createErrorResponse("isActive must be a boolean", 400);
      }

      const user = await bypassOrgScope(() =>
        db.user.findFirst({ where: { id } }),
      );
      if (!user) return createErrorResponse("User not found", 404);
      if (user.role === "super_admin" || !user.organizationId) {
        return createErrorResponse("Platform administrator accounts cannot be changed here", 403);
      }

      const previous = user.isActive;
      await bypassOrgScope(() =>
        db.user.update({ where: { id }, data: { isActive } }),
      );
      const organizationId = user.organizationId;
      const organization = await db.organization.findFirst({
        where: { id: organizationId },
        select: { name: true },
      });
      // Falls through to the id: an audit entry must name its subject, and a
      // person can be recorded with neither a name nor an email address.
      const targetName =
        `${user.firstName} ${user.lastName}`.trim() || user.email || id;

      await recordPlatformAudit({
        actor,
        action: "user.status_changed",
        targetType: "user",
        targetId: id,
        targetName,
        organizationId,
        summary: `${targetName} was ${isActive ? "activated" : "deactivated"}`,
        metadata: {
          previous,
          current: isActive,
          organizationName: organization?.name ?? null,
        },
      });

      return createSuccessResponse(
        { id, isActive },
        `User ${isActive ? "activated" : "deactivated"}`,
      );
    } catch (error) {
      return handleApiError(error, "Failed to update user access");
    }
  },
);
