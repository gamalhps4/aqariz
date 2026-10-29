/**
 * PropertyPro - Sessions API Route
 * List tracked login sessions and bulk-terminate them
 */

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import { Prisma } from "@/generated/prisma/client";
import { UserRole } from "@/types";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  withAccessAndDB,
  withPermissionAndDB,
  hasAccess,
  parsePaginationParams,
  isValidObjectId,
} from "@/lib/api-utils";
import {
  auditService,
  AuditCategory,
  AuditAction,
  AuditSeverity,
} from "@/lib/audit-service";

// One boundary, not a 5min/30min pair: Better Auth rewrites a session row at
// most once per updateAge (24h, see better-auth.ts) and getSession never
// touches it in between, so `updatedAt` moves in day-sized steps. Minute-scale
// thresholds against that clock reported every real session as idle. "Active"
// here honestly means "seen within the last day".
const ACTIVE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

// ============================================================================
// GET /api/sessions - Get active sessions
// ============================================================================

/**
 * Listing sessions needs `user_view` only when asking about *other* people.
 * Reviewing and revoking your own devices is a basic account-security
 * feature every role must have — gating it behind an admin permission left
 * tenants and managers with no way to see their own logins at all.
 */
export const GET = withAccessAndDB({})(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const { searchParams } = new URL(request.url);
      const requestedUserId = searchParams.get("userId");
      const isSelfOnly = requestedUserId === user.id;
      if (
        !isSelfOnly &&
        !hasAccess(user, { permissions: ["user_view"] })
      ) {
        // Anything broader than "my own sessions" stays an admin view.
        return createErrorResponse(
          "Add ?userId=<your id> to list your own sessions",
          403,
        );
      }
      const paginationParams = parsePaginationParams(searchParams);
      const page = paginationParams.page ?? 1;
      const limit = paginationParams.limit ?? 12;
      const userId = searchParams.get("userId");
      const deviceType = searchParams.get("deviceType");
      const status = searchParams.get("status"); // active, idle, all

      // Better Auth deletes a session row when it is revoked rather than
      // flagging it, so "not revoked" is simply "still present"; only expiry
      // needs filtering.
      const now = Date.now();
      const where: Prisma.SessionWhereInput = {
        expiresAt: { gt: new Date(now) },
      };

      if (userId) {
        if (!isValidObjectId(userId)) {
          return createErrorResponse("Invalid user ID", 400);
        }
        where.userId = userId;
      }

      if (deviceType) {
        where.deviceType = deviceType;
      }

      if (status === "active") {
        where.updatedAt = { gte: new Date(now - ACTIVE_THRESHOLD_MS) };
      } else if (status === "idle") {
        where.updatedAt = { lt: new Date(now - ACTIVE_THRESHOLD_MS) };
      }

      // Property managers cannot see admin sessions
      if (user.isManager && !user.isAdmin) {
        const admins = await db.user.findMany({
          where: { role: UserRole.ADMIN },
          select: { id: true },
        });
        const adminIds = admins.map((a) => a.id);
        if (userId) {
          if (adminIds.includes(userId)) {
            return createErrorResponse("Insufficient permissions", 403);
          }
        } else {
          where.userId = { notIn: adminIds };
        }
      }

      const skip = (page - 1) * limit;

      const [sessions, totalCount, activeCount, idleCount] = await Promise.all(
        [
          db.session.findMany({
            where,
            orderBy: { updatedAt: "desc" },
            skip,
            take: limit,
            include: {
              user: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  email: true,
                  role: true,
                  avatar: true,
                },
              },
            },
          }),
          db.session.count({ where }),
          db.session.count({
            where: {
              ...where,
              updatedAt: { gte: new Date(now - ACTIVE_THRESHOLD_MS) },
            },
          }),
          db.session.count({
            where: {
              ...where,
              updatedAt: { lt: new Date(now - ACTIVE_THRESHOLD_MS) },
            },
          }),
        ]
      );

      // `sessionId` is the session row's id, not its token — the shim exposes
      // the id deliberately so the raw session token never travels in a
      // response. Compare against the row id; comparing it to the token
      // silently matched nothing and left every row unflagged.
      const currentSessionId = user.sessionId;

      const mapped = sessions.map((session) => {
        const sessionUser = session.user;
        return {
          id: session.id,
          userId: sessionUser?.id ?? "",
          userName:
            [sessionUser?.firstName, sessionUser?.lastName]
              .filter(Boolean)
              .join(" ") || sessionUser?.email ||
            "Unknown user",
          userEmail: sessionUser?.email ?? "",
          userRole: sessionUser?.role ?? UserRole.TENANT,
          userAvatar: sessionUser?.avatar,
          deviceType: session.deviceType,
          browser: session.browser,
          os: session.os,
          ipAddress: session.ipAddress ?? "Unknown",
          lastActivity: session.updatedAt,
          createdAt: session.createdAt,
          isCurrentSession:
            !!currentSessionId && session.id === currentSessionId,
        };
      });

      return createSuccessResponse({
        sessions: mapped,
        pagination: {
          page,
          limit,
          total: totalCount,
          pages: Math.ceil(totalCount / limit),
        },
        summary: {
          totalSessions: totalCount,
          activeSessions: activeCount,
          idleSessions: idleCount,
        },
      });
    } catch (error) {
      return handleApiError(error);
    }
  }
);

// ============================================================================
// DELETE /api/sessions - Bulk terminate sessions
// ============================================================================

export const DELETE = withPermissionAndDB("user_view")(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      if (!user.isAdmin) {
        return createErrorResponse("Insufficient permissions", 403);
      }

      const { searchParams } = new URL(request.url);
      const sessionIds =
        searchParams.get("ids")?.split(",").filter(Boolean) || [];
      const userId = searchParams.get("userId"); // Terminate all sessions for a user

      if (sessionIds.length === 0 && !userId) {
        return createErrorResponse("Session IDs or user ID required", 400);
      }

      const revokeWhere: Prisma.SessionWhereInput = {};

      if (userId) {
        if (!isValidObjectId(userId)) {
          return createErrorResponse("Invalid user ID", 400);
        }
        revokeWhere.userId = userId;
      } else {
        const invalidId = sessionIds.find((id) => !isValidObjectId(id));
        if (invalidId) {
          return createErrorResponse(`Invalid session ID: ${invalidId}`, 400);
        }
        revokeWhere.id = { in: sessionIds };
      }

      // Deleting the row is what actually ends the session: Better Auth looks
      // the token up on every request, so a missing row means the next request
      // is rejected. The old flag-and-keep approach left the JWT valid.
      const result = await db.session.deleteMany({ where: revokeWhere });

      const terminatedCount = result.count;

      await auditService.logEvent(
        {
          category: AuditCategory.SECURITY,
          action: AuditAction.LOGOUT,
          severity: AuditSeverity.MEDIUM,
          description: userId
            ? `Terminated all sessions (${terminatedCount}) for user ${userId}`
            : `Terminated ${terminatedCount} session(s)`,
          resourceType: userId ? "user" : undefined,
          resourceId: userId || undefined,
          details: { terminatedCount, sessionIds, userId },
          tags: ["security", "session_termination"],
        },
        auditService.extractContextFromRequest(request, user)
      );

      return createSuccessResponse(
        {
          terminatedCount,
          terminatedAt: new Date(),
          terminatedBy: user.email,
        },
        `Successfully terminated ${terminatedCount} session(s)`
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);
