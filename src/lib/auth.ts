import "server-only";

import { cache } from "react";
import { headers } from "next/headers";

import { auth as betterAuth } from "./better-auth";
import { authDb } from "@/lib/db/prisma";
import { UserRole } from "@/types";
import { isLockActive } from "./lockout-policy";
import { enterOrgContext } from "./tenancy/context";
import { readImpersonationGrant } from "./platform/impersonation";
import {
  hasRequiredRole,
  isAdminRole,
  isManagerRole,
  isTenantRole,
} from "./role-utils";

/**
 * Compatibility layer over Better Auth.
 *
 * `auth()` returns the same session shape the app has always consumed —
 * `session.user.{id,role,isActive,organizationId,organizationSlug,…}` plus
 * `session.sessionId` — so the route handlers and `withAccessAndDB` that call
 * it did not have to change when the underlying library did. Anything new
 * should prefer importing the Better Auth instance from `./better-auth`.
 *
 * The profile fields below are read fresh on every call, exactly as the old
 * NextAuth `session` callback did, so deactivating a user or suspending an
 * organization takes effect on their next request instead of whenever a token
 * happened to rotate.
 */

export interface AppSessionUser {
  id: string;
  email: string;
  role: string;
  isActive: boolean;
  /** Owning organization (SaaS account). Null for platform super-admins and
   * users who have not completed onboarding. */
  organizationId: string | null;
  organizationSlug: string | null;
  name?: string;
  firstName?: string;
  lastName?: string;
  avatar?: string;
  bio?: string;
  location?: string;
  city?: string;
  website?: string;
  address?: string;
  phone?: string;
  createdAt?: Date;
  /** When the account confirmed its email address, or null if it never has. */
  emailVerified?: Date | null;
  /** True when this user owns the organization — i.e. self-registered through
   * the public signup form rather than being created by an admin. */
  isOrganizationOwner?: boolean;
  /** Set when a platform operator is viewing the app as this user. Requests
   * carrying it are read-only; see lib/platform/impersonation. */
  impersonatedBy?: { id: string; email: string } | null;
}

export interface AppSession {
  user: AppSessionUser;
  sessionId?: string;
  expires?: string;
}

/**
 * Resolve the current session, refresh the user and organization state from
 * the database, and bind the organization to the active async request chain.
 *
 * Request-memoised via React cache(): a single render pass may ask for the
 * session from several components, and each bare call is a session read plus a
 * user read. cache() collapses them to one resolution per request and is a
 * no-op outside a render pass, so route handlers are unaffected.
 */
export const auth = cache(async (): Promise<AppSession | null> => {
  const requestHeaders = await headers();
  const result = await betterAuth.api.getSession({ headers: requestHeaders });

  if (!result?.user) return null;

  // Support impersonation. The operator's own session is what was just
  // validated; the grant only redirects *which* user the rest of this request
  // resolves as, and only when the real caller is a platform admin.
  const grant = await readImpersonationGrant();
  const realUserIsPlatformAdmin =
    (result.user as { role?: string }).role === UserRole.SUPER_ADMIN &&
    !(result.user as { organizationId?: string | null }).organizationId;
  const impersonation =
    grant && realUserIsPlatformAdmin && grant.impersonatorId === String(result.user.id)
      ? grant
      : null;

  const userId = impersonation
    ? impersonation.targetUserId
    : String(result.user.id);

  const session: AppSession = {
    user: {
      id: userId,
      email: impersonation ? "" : (result.user.email ?? ""),
      // Falls back to the least-privileged role rather than trusting a missing
      // value, and is overwritten from the database immediately below.
      role: impersonation
        ? UserRole.TENANT
        : ((result.user as { role?: string }).role ?? UserRole.TENANT),
      isActive: impersonation
        ? true
        : (result.user as { isActive?: boolean }).isActive !== false,
      organizationId: null,
      organizationSlug: null,
    },
    sessionId: result.session?.id ? String(result.session.id) : undefined,
    expires: result.session?.expiresAt
      ? new Date(result.session.expiresAt).toISOString()
      : undefined,
  };

  try {
    // Platform-level lookup of the signed-in user (any org). The bypass client
    // is deliberately context-independent, so this works during React Server
    // Component rendering where the request's AsyncLocalStorage org context is
    // not available.
    const dbUser = await authDb.user.findUnique({ where: { id: userId } });

    if (dbUser && !dbUser.deletedAt) {
      session.user.role = dbUser.role ?? UserRole.TENANT;
      session.user.isActive = dbUser.isActive ?? false;
      // A blocked account must stop working NOW, not at its next sign-in.
      // The sign-in gate only runs when a session is created, so an admin
      // blocking a compromised account would otherwise change nothing for the
      // sessions it already holds — fold the lock into isActive, which every
      // access wrapper already refuses.
      if (isLockActive(dbUser.isLocked, dbUser.lockedUntil)) {
        session.user.isActive = false;
      }
      session.user.firstName = dbUser.firstName;
      session.user.lastName = dbUser.lastName;
      session.user.name = `${dbUser.firstName || ""} ${
        dbUser.lastName || ""
      }`.trim();
      session.user.avatar = dbUser.avatar ?? undefined;
      session.user.bio = dbUser.bio ?? undefined;
      session.user.location = dbUser.location ?? undefined;
      session.user.city = dbUser.city ?? undefined;
      session.user.website = dbUser.website ?? undefined;
      session.user.address = dbUser.address ?? undefined;
      session.user.phone = dbUser.phone ?? undefined;
      session.user.createdAt = dbUser.createdAt;
      session.user.emailVerified = dbUser.emailVerified ?? null;
      session.user.email = dbUser.email ?? session.user.email;
      // Reflect the latest org assignment (e.g. right after onboarding).
      session.user.organizationId = dbUser.organizationId ?? null;

      if (dbUser.organizationId) {
        const organization = await authDb.organization.findUnique({
          where: { id: dbUser.organizationId },
          select: { status: true, slug: true, ownerId: true },
        });
        if (!organization || organization.status === "suspended") {
          session.user.isActive = false;
        } else {
          session.user.organizationSlug = organization.slug;
          // Owners are the accounts that self-registered through the public
          // signup form; everyone else was created by an admin who already
          // vouched for the address. Email verification is only enforced on
          // the former.
          session.user.isOrganizationOwner = organization.ownerId === dbUser.id;
        }
      }
    } else {
      // No row (deleted or soft-deleted). Revoke rather than fall back to the
      // session copy, otherwise a deleted account keeps working until its
      // session expires.
      session.user.isActive = false;
    }
  } catch (error) {
    console.error("Session user fetch error:", error);
    session.user.isActive = false;
  }

  // Treat inactive, deleted, or suspended accounts as unauthenticated so
  // legacy/direct-auth routes cannot forget a separate isActive check.
  if (session.user.isActive === false) {
    return null;
  }

  if (impersonation) {
    session.user.impersonatedBy = {
      id: impersonation.impersonatorId,
      email: result.user.email ?? "",
    };
  }

  // Subdomain binding: a session may only be used on its own organization's
  // subdomain. The proxy owns this header (it strips any client-supplied
  // value), so a mismatch means someone opened another org's subdomain.
  const requestedOrganizationSlug = requestHeaders.get(
    "x-propertypro-org-slug",
  );
  if (
    !impersonation &&
    requestedOrganizationSlug &&
    requestedOrganizationSlug !== session.user.organizationSlug
  ) {
    return null;
  }

  // Bind the organization for downstream Prisma queries. Cross-organization
  // access is granted only by the dedicated platform wrapper, never as a side
  // effect of calling auth() in an org route.
  enterOrgContext({
    organizationId: session.user.organizationId,
    isPlatformAdmin: false,
  });

  return session;
});

export { betterAuth };

// ---------------------------------------------------------------------------
// Role helpers — unchanged, and independent of the auth library.
// ---------------------------------------------------------------------------

export function hasRole(userRole: string, requiredRoles: string[]): boolean {
  return hasRequiredRole(userRole, requiredRoles);
}

export function isAdmin(userRole: string): boolean {
  return isAdminRole(userRole);
}

export function canManageProperties(userRole: string): boolean {
  return isAdminRole(userRole) || isManagerRole(userRole);
}

export function canAccessTenantFeatures(userRole: string): boolean {
  return (
    isAdminRole(userRole) || isManagerRole(userRole) || isTenantRole(userRole)
  );
}

export function hasCompanyAccess(userRole: string): boolean {
  return isAdminRole(userRole) || isManagerRole(userRole);
}

export function canManageUsers(userRole: string): boolean {
  return isAdminRole(userRole);
}

export function canViewAllData(userRole: string): boolean {
  return isAdminRole(userRole) || isManagerRole(userRole);
}
