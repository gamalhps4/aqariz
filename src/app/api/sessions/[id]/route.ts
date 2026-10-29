/**
 * PropertyPro - Individual Session API Route
 * Get details for and terminate a single tracked session
 */

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import { UserRole } from "@/types";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  withAccessAndDB,
  isValidObjectId,
} from "@/lib/api-utils";
import { hasPermission } from "@/lib/permissions-manager";
import { resolveAccessProfile } from "@/lib/server-permissions";
import {
  auditService,
  AuditCategory,
  AuditAction,
  AuditSeverity,
} from "@/lib/audit-service";

// ============================================================================
// GET /api/sessions/[id] - Get session details
// ============================================================================

export const GET = withAccessAndDB({})(
  async (
    user: AuthenticatedAccessUser,
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    try {
      const { id } = await params;

      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid session ID", 400);
      }

      const session = await db.session.findFirst({
        where: { id },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              role: true,
            },
          },
        },
      });

      if (!session) {
        return createErrorResponse("Session not found", 404);
      }

      const sessionUser = session.user;
      const isOwnSession = sessionUser?.id === user.id;
      // Someone else's session takes `user_view`, as listing them does. This
      // asked for the admin or manager tier instead, and every permission
      // group is on the manager tier: with a session id, any of them could
      // read another person's IP address, device and email.
      if (!isOwnSession && !hasPermission(user.permissions, "user_view")) {
        return createErrorResponse("Insufficient permissions", 403);
      }

      // The list route hides admin sessions from managers; this detail route
      // must hold the same line, or a manager who learned a session id could
      // read an administrator's IP, device and email anyway. Asked of anyone
      // who is not an administrator, not of the manager tier alone: holding
      // `user_view` is now what lets a caller in, and one person below that
      // tier can be granted it.
      if (!user.isAdmin && !isOwnSession) {
        const targetAccess = await resolveAccessProfile(sessionUser?.role);
        if (targetAccess.isAdmin) {
          return createErrorResponse("Insufficient permissions", 403);
        }
      }

      return createSuccessResponse({
        session: {
          id: session.id,
          userId: sessionUser?.id ?? "",
          userName:
            [sessionUser?.firstName, sessionUser?.lastName]
              .filter(Boolean)
              .join(" ") || sessionUser?.email ||
            "Unknown user",
          userEmail: sessionUser?.email ?? "",
          userRole: sessionUser?.role ?? UserRole.TENANT,
          deviceType: session.deviceType,
          browser: session.browser,
          os: session.os,
          ipAddress: session.ipAddress ?? "Unknown",
          lastActivity: session.updatedAt,
          createdAt: session.createdAt,
          // A revoked session no longer exists, so anything returned is live.
          isRevoked: false,
        },
      });
    } catch (error) {
      return handleApiError(error);
    }
  }
);

// ============================================================================
// DELETE /api/sessions/[id] - Terminate a session
// ============================================================================

export const DELETE = withAccessAndDB({})(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    try {
      const { id } = await params;

      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid session ID", 400);
      }

      const session = await db.session.findFirst({ where: { id } });

      if (!session) {
        return createErrorResponse("Session not found", 404);
      }

      // Admins can terminate any session; other users only their own. No
      // permission stands in for this: a permission group is never an admin,
      // whatever it has been ticked.
      const isOwnSession = session.userId === user.id;
      if (!user.isAdmin && !isOwnSession) {
        return createErrorResponse("Insufficient permissions", 403);
      }

      // Deleting the row ends the session: Better Auth resolves the token
      // against this table on every request, so the next one is rejected.
      await db.session.deleteMany({ where: { id } });

      await auditService.logEvent(
        {
          category: AuditCategory.SECURITY,
          action: AuditAction.LOGOUT,
          severity: AuditSeverity.MEDIUM,
          description: isOwnSession
            ? "User terminated their own session"
            : "Session terminated by administrator",
          resourceType: "user",
          resourceId: session.userId,
          details: {
            sessionId: id,
            deviceType: session.deviceType,
            browser: session.browser,
            ipAddress: session.ipAddress,
          },
          tags: ["security", "session_termination"],
        },
        auditService.extractContextFromRequest(request, user)
      );

      return createSuccessResponse(
        {
          sessionId: id,
          // Revocation deletes the row, so nothing ever writes revokedAt —
          // the moment of deletion IS the termination time.
          terminatedAt: new Date(),
          terminatedBy: user.email,
        },
        "Session terminated successfully"
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);
