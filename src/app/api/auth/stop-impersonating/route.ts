/**
 * PropertyPro SaaS - End impersonation
 *
 * Clearing the cookie is the whole operation — there is no session for the
 * target to revoke. Deliberately reachable while impersonating (the read-only
 * guard exempts it), otherwise the operator would have no way out but to
 * clear cookies by hand.
 */

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { authDb } from "@/lib/db/prisma";
import {
  IMPERSONATION_COOKIE,
  IMPERSONATION_HINT_COOKIE,
  impersonationCookieOptions,
  impersonationHintCookieOptions,
  readImpersonationGrant,
} from "@/lib/platform/impersonation";
import { recordPlatformAudit } from "@/lib/platform/audit";
import { bypassOrgScope } from "@/lib/tenancy/context";
import { AuditAction, recordActivity } from "@/lib/audit-service";
import { fullName, requestIpAddress } from "@/lib/audit/scope";

export async function POST(_request: NextRequest) {
  const grant = await readImpersonationGrant();

  // Always clear, even with no valid grant: a stale or malformed cookie must
  // not be able to wedge the operator into a state they cannot leave.
  const response = NextResponse.json({
    success: true,
    message: "Returned to your own account",
  });
  response.cookies.set(IMPERSONATION_COOKIE, "", {
    ...impersonationCookieOptions,
    maxAge: 0,
  });
  response.cookies.set(IMPERSONATION_HINT_COOKIE, "", {
    ...impersonationHintCookieOptions,
    maxAge: 0,
  });

  if (!grant) return response;

  try {
    // `auth()` resolves as the *target* while the cookie is set, so the
    // operator's own identity comes from the signed grant, not the session.
    const session = await auth();
    const operator = await bypassOrgScope(() =>
      authDb.user.findUnique({
        where: { id: grant.impersonatorId },
        select: { id: true, email: true, firstName: true, lastName: true },
      }),
    );

    if (operator) {
      // The operator, by their own name: the session here is the customer's.
      await recordPlatformAudit({
        actor: {
          id: operator.id,
          email: operator.email,
          firstName: operator.firstName,
          lastName: operator.lastName,
        } as never,
        ipAddress: requestIpAddress(_request.headers),
        userAgent: _request.headers.get("user-agent"),
        action: "user.impersonation_ended",
        targetType: "user",
        targetId: grant.targetUserId,
        targetName: session?.user?.email ?? grant.targetUserId,
        organizationId: session?.user?.organizationId ?? null,
        summary: `Stopped viewing the app as ${session?.user?.email ?? grant.targetUserId}`,
      });

      // And in the customer's own log, beside the entry that started it.
      if (session?.user?.organizationId) {
        await recordActivity({
          action: AuditAction.IMPERSONATION_ENDED,
          recordType: "user",
          recordId: grant.targetUserId,
          recordName:
            fullName(session.user.firstName, session.user.lastName) ??
            session.user.email ??
            grant.targetUserId,
          organizationId: session.user.organizationId,
          actor: {
            id: grant.targetUserId,
            name: fullName(session.user.firstName, session.user.lastName),
            email: session.user.email ?? null,
            role: session.user.role ?? null,
            isPlatformAdmin: false,
          },
          impersonator: { id: operator.id, email: operator.email ?? "" },
          ipAddress: requestIpAddress(_request.headers),
          userAgent: _request.headers.get("user-agent"),
        });
      }
    }
  } catch (error) {
    // Auditing must never prevent the operator from getting out.
    console.error("Failed to audit impersonation end:", error);
  }

  return response;
}
