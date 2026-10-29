import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { ApiResponse, PaginationParams, UserRole } from "@/types";
import { ensureTenantProfile } from "./tenant-utils";
import { db } from "./db/prisma";
import {
  AccessProfile,
  createAccessProfile,
  hasAllPermissions,
  hasAnyPermission,
  matchesRequiredRoles,
} from "./role-utils";
import {
  loadUserAccessRow,
  resolveAccessProfile,
} from "./server-permissions";
import { resolveStaffPropertyIds } from "./db/staff-scope";
import { uniqueViolationMessage } from "./db/unique-violation";
import { runWithOrgContext } from "./tenancy/context";
import { runRequestWithAudit } from "./audit/backstop";
import { getPlatformSettings } from "./platform/settings";
import {
  AUTHENTICATED_READ_LIMIT,
  AUTHENTICATED_WRITE_LIMIT,
  checkRateLimitByKey,
  createRateLimitResponse,
} from "./rate-limit";
// Import will be done dynamically to avoid circular dependencies

export { formatCurrency } from "@/lib/utils/formatting";

// ============================================================================
// RESPONSE HELPERS
// ============================================================================

/**
 * Compatibility bridge from the MongoDB era: rows now carry `id`, but plenty
 * of client code still reads `_id`. Mirror `id` onto `_id` in every success
 * payload so the UI keeps working either way; remove once the client has
 * standardised on `id`.
 */
function withLegacyIdAliases(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== "object") return value;
  if (value instanceof Date) return value;
  if (Array.isArray(value)) {
    return value.map((item) => withLegacyIdAliases(item, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    out[key] = withLegacyIdAliases(entry, depth + 1);
  }
  if (typeof out.id === "string" && out._id === undefined) {
    out._id = out.id;
  }
  return out;
}

export function createSuccessResponse<T>(
  data: T,
  message?: string,
  pagination?: ApiResponse["pagination"],
  /** Totals over the whole filtered set — see ApiResponse.summary. */
  summary?: ApiResponse["summary"]
): NextResponse<ApiResponse<T>> {
  return NextResponse.json({
    success: true,
    data: withLegacyIdAliases(data) as T,
    message,
    pagination,
    summary,
  });
}

// Machine-readable error codes live in the shared contracts package so API
// clients (web + mobile) branch on the same constants the server emits.
export {
  API_ERROR_CODES,
  defaultErrorCode,
} from "@propertypro/contracts/errors";
import { defaultErrorCode } from "@propertypro/contracts/errors";

export function createErrorResponse(
  error: string,
  statusCode: number = 400,
  message?: string,
  code?: string
): NextResponse<ApiResponse> {
  return NextResponse.json(
    {
      success: false,
      error,
      message,
      code: code ?? defaultErrorCode(statusCode),
    },
    { status: statusCode }
  );
}

// ============================================================================
// AUTHENTICATION HELPERS
// ============================================================================

// ============================================================================
// PAGINATION HELPERS
// ============================================================================

export function parsePaginationParams(
  searchParams: URLSearchParams
): PaginationParams {
  return {
    page: parseInt(searchParams.get("page") || "1"),
  limit: Math.min(parseInt(searchParams.get("limit") || "12"), 100),
    sortBy: searchParams.get("sortBy") || undefined,
    sortOrder: (searchParams.get("sortOrder") as "asc" | "desc") || "desc",
    search: searchParams.get("search") || undefined,
  };
}

export function createPaginationInfo(
  page: number,
  limit: number,
  total: number
) {
  const totalPages = Math.ceil(total / limit);

  return {
    page,
    limit,
    total,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  };
}

// ============================================================================
// ERROR HANDLING
// ============================================================================

function getExactErrorMessage(
  error: unknown,
  fallbackMessage: string = "Internal server error"
): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (typeof error === "string" && error.trim()) {
    return error;
  }

  if (error && typeof error === "object") {
    const possibleMessage = (error as { message?: unknown }).message;
    if (typeof possibleMessage === "string" && possibleMessage.trim()) {
      return possibleMessage;
    }
  }

  return fallbackMessage;
}

export function handleApiError(
  error: any,
  fallbackMessage: string = "Internal server error"
): NextResponse<ApiResponse> {
  console.error("API Error:", error);

  // Tenant-isolation contract violation (see src/lib/tenancy/context.ts)
  if (error?.name === "MissingOrganizationContextError") {
    return createErrorResponse(
      "Organization context is required",
      403,
      undefined,
      "ORG_CONTEXT_REQUIRED"
    );
  }

  // Password rejected by the strength policy (src/lib/password-policy.ts)
  if (error?.name === "WeakPasswordError") {
    return createErrorResponse(
      error.message || "Password does not meet the security requirements",
      400,
      undefined,
      "VALIDATION_ERROR"
    );
  }

  // Prisma known request errors
  if (typeof error?.code === "string" && error.code.startsWith("P2")) {
    if (error.code === "P2002") {
      // Read the way the invoice writers read it: this stack never fills in
      // `meta.target`, so building the message from it said "record already
      // exists" for every duplicate — see lib/db/unique-violation.ts.
      return createErrorResponse(
        uniqueViolationMessage(error) ?? "This record already exists",
        409,
        undefined,
        "DUPLICATE"
      );
    }
    if (error.code === "P2025") {
      return createErrorResponse("Record not found", 404, undefined, "NOT_FOUND");
    }
    if (error.code === "P2003") {
      return createErrorResponse(
        "Related record does not exist",
        400,
        undefined,
        "INVALID_REFERENCE"
      );
    }
    // Row-level security refusals surface as a generic database error — never
    // leak cross-tenant existence; report as not found.
    if (error.code === "P2010" || /row-level security/i.test(String(error.message))) {
      return createErrorResponse("Record not found", 404, undefined, "NOT_FOUND");
    }
  }
  if (/row-level security/i.test(String(error?.message ?? ""))) {
    return createErrorResponse("Record not found", 404, undefined, "NOT_FOUND");
  }

  // Custom API error — honor an explicit machine code when the error carries one
  if (error.statusCode) {
    return createErrorResponse(
      getExactErrorMessage(error, fallbackMessage),
      error.statusCode,
      undefined,
      typeof error.code === "string" ? error.code : undefined
    );
  }

  // Default server error. In production, never echo the raw Error.message —
  // unexpected errors carry internals (Prisma/adapter messages, env hints)
  // that don't belong in a client response. Typed errors with statusCode are
  // handled above and keep their exact messages.
  if (process.env.NODE_ENV === "production") {
    return createErrorResponse(fallbackMessage, 500);
  }
  return createErrorResponse(getExactErrorMessage(error, fallbackMessage), 500);
}

// ============================================================================
// REQUEST VALIDATION
// ============================================================================

export async function parseRequestBody(request: NextRequest) {
  try {
    const body = await request.json();
    return { success: true, data: body };
  } catch (error) {
    return { success: false, error: "Invalid JSON body" };
  }
}

export function validateRequiredFields(data: any, fields: string[]) {
  const missing = fields.filter((field) => !data[field]);

  if (missing.length > 0) {
    throw new Error(`Missing required fields: ${missing.join(", ")}`);
  }
}

// ============================================================================
// AUTHENTICATION MIDDLEWARE
// ============================================================================

export interface AuthenticatedAccessUser extends AccessProfile {
  id: string;
  email: string;
  isActive: boolean;
  firstName?: string;
  lastName?: string;
  /** Owning organization (SaaS account). Null for platform super-admins. */
  organizationId: string | null;
  organizationSlug: string | null;
  /** True for platform super-admins acting above all organizations. */
  isPlatformAdmin: boolean;
  /** The Better Auth session row id (not its token) — used by the sessions
   * screen to flag the caller's current session. */
  sessionId?: string;
  /** When the account confirmed its email address, or null if it never has. */
  emailVerified?: Date | null;
  /** True when this user self-registered as the organization's owner. */
  isOrganizationOwner?: boolean;
  /**
   * The buildings a property-owner caller holds, resolved once per request.
   *
   * Row scoping for an owner keys on `propertyId`, which means the scope needs
   * this list to build a `where` at all. Resolving it here — and only for an
   * owner — keeps every `xxxScope(user)` call site synchronous and means a
   * route cannot accidentally scope against an unresolved actor. Undefined for
   * every other role, and treated as "nothing" if it is ever missing, so the
   * failure direction is an empty portfolio rather than the whole one.
   */
  ownedPropertyIds?: readonly string[];
  /**
   * The buildings a *restricted* employee may see, flattened from their
   * compound and building assignments. Undefined for everyone else, which is
   * what keeps an ordinary staff query unfiltered; an empty array means
   * restricted-and-assigned-nothing and must show nothing. See
   * `User.scopeRestricted` and lib/db/scopes.ts.
   */
  scopedPropertyIds?: readonly string[];
  /** Present when a platform operator is viewing the app as this user. */
  impersonatedBy?: { id: string; email: string } | null;
}

export interface AccessRequirement {
  roles?: string[];
  permissions?: string[];
  requireAllPermissions?: boolean;
  match?: "all" | "any";
  /** Tighter per-user ceiling for routes that cost real money or storage
   * (uploads, outbound mail, gateway calls). Replaces the baseline limit. */
  rateLimit?: { windowMs: number; maxRequests: number };
  /**
   * Module this route needs, overriding the ones derived from its path (a
   * module key such as "accounting.reports", or an old flat key). Almost never
   * necessary — the menu tree maps every module's API prefixes — but a route
   * that sits under one module while belonging to another can say so here.
   * `false` opts the route out of plan gating entirely.
   */
  planFeature?: string | false;
}

async function resolveAuthenticatedUser(): Promise<AuthenticatedAccessUser | null> {
  const session = await auth();

  if (!session?.user) {
    return null;
  }

  if (!session?.user?.id || !session?.user?.email) {
    throw new Error("Invalid session");
  }

  const originalRole = session.user.role || UserRole.TENANT;
  const organizationId = session.user.organizationId ?? null;
  // Platform super-admins operate above every organization (no org binding).
  const isPlatformAdmin =
    originalRole === UserRole.SUPER_ADMIN && !organizationId;

  // Per-employee overrides are read inside the org context alongside the role
  // permissions, so one round trip covers both and a denial takes effect on
  // the very next request rather than when a cache expires.
  const accessRow =
    !organizationId && !isPlatformAdmin
      ? null
      : await runWithOrgContext({ organizationId, isPlatformAdmin }, async () =>
          loadUserAccessRow(session.user.id),
        );

  // Inside the org context as well: a permission group is a row in the
  // organization, and nothing is bound out here — auth() binds the
  // organization for its own async chain, not for its caller. Resolved
  // outside, every request from a member of a group failed with "Organization
  // context is required" before it reached a handler. With no organization
  // there are no stored groups to look among, so the name stands alone.
  const accessProfile =
    !organizationId && !isPlatformAdmin
      ? createAccessProfile(originalRole, [], null, { storedGroup: "none" })
      : await runWithOrgContext({ organizationId, isPlatformAdmin }, async () =>
          resolveAccessProfile(originalRole, accessRow?.overrides ?? null),
        );

  // Only owners pay for this lookup, and only they need it: see
  // ownedPropertyIds above and lib/db/scopes.ts.
  const ownedPropertyIds =
    accessProfile.isOwner && organizationId
      ? await runWithOrgContext({ organizationId, isPlatformAdmin }, async () =>
          (
            await db.property.findMany({
              where: { ownerId: session.user.id },
              select: { id: true },
            })
          ).map((property) => property.id),
        )
      : undefined;

  // Only a narrowed employee pays for this lookup. Owners and tenants have
  // their own, tighter rules and are never restricted this way; leaving it
  // undefined for them keeps those rules the ones that apply.
  const scopedPropertyIds =
    accessRow?.buildingScope &&
    !accessProfile.isOwner &&
    !accessProfile.isTenant &&
    organizationId
      ? await runWithOrgContext({ organizationId, isPlatformAdmin }, async () =>
          resolveStaffPropertyIds(accessRow.buildingScope!),
        )
      : undefined;

  return {
    ...accessProfile,
    ownedPropertyIds,
    scopedPropertyIds,
    id: session.user.id,
    email: session.user.email,
    organizationId,
    organizationSlug: session.user.organizationSlug ?? null,
    isPlatformAdmin,
    isActive: session?.user?.isActive !== false,
    firstName: session.user.firstName,
    lastName: session.user.lastName,
    sessionId: session.sessionId,
    emailVerified: session.user.emailVerified ?? null,
    isOrganizationOwner: session.user.isOrganizationOwner === true,
    impersonatedBy: session.user.impersonatedBy ?? null,
  };
}

export function hasAccess(
  user: AccessProfile,
  requirement: AccessRequirement
): boolean {
  const requiredRoles = requirement.roles ?? [];
  const requiredPermissions = requirement.permissions ?? [];
  const requireAllPermissions = requirement.requireAllPermissions ?? false;
  const match = requirement.match ?? "all";

  const matchesRole = matchesRequiredRoles(user, requiredRoles);
  const matchesPermissions =
    requiredPermissions.length === 0
      ? true
      : requireAllPermissions
      ? hasAllPermissions(user.permissions, requiredPermissions)
      : hasAnyPermission(user.permissions, requiredPermissions);

  if (requiredRoles.length > 0 && requiredPermissions.length > 0 && match === "any") {
    return matchesRole || matchesPermissions;
  }

  return matchesRole && matchesPermissions;
}

/**
 * Paths that must keep working while an account is blocked on verification —
 * otherwise the verification screen cannot load, resend a link, or let the
 * user sign out.
 */
const VERIFICATION_EXEMPT_PREFIXES = [
  "/api/auth/",
  "/api/user/send-verification-email",
  "/api/user/confirm-email-verification",
  "/api/user/change-email",
  "/api/billing/status",
  "/api/platform/status",
  "/api/settings/display",
  "/api/settings/profile",
];

/** Endpoints an impersonating operator may still call: ending the session,
 * and the reads the banner itself needs. */
const IMPERSONATION_ALLOWED_WRITES = ["/api/auth/stop-impersonating"];

/**
 * Impersonation is read-only.
 *
 * Support needs to see what the customer sees; it does not need to move their
 * money, edit their leases, or send mail on their behalf. Enforcing that in
 * one place beats trusting every future write route to remember.
 */
function enforceImpersonationReadOnly(
  user: AuthenticatedAccessUser,
  request: NextRequest,
): NextResponse | null {
  if (!user.impersonatedBy) return null;
  if (request.method === "GET" || request.method === "HEAD") return null;

  const pathname = new URL(request.url).pathname;
  if (IMPERSONATION_ALLOWED_WRITES.some((path) => pathname.startsWith(path))) {
    return null;
  }

  return createErrorResponse(
    "You are viewing this account as a support operator. Impersonated sessions are read-only — stop impersonating to make changes.",
    403,
    undefined,
    "IMPERSONATION_READ_ONLY",
  );
}

/**
 * Email-verification gate.
 *
 * Only self-registered owners are held to it: a user an admin created was
 * already vouched for by that admin, and locking invited staff out of the app
 * until they click a link would be a support burden with no security gain.
 * The whole gate is off unless the super-admin has enabled
 * `registration.requireEmailVerification` in the platform console — which
 * until now was a switch that saved but did nothing.
 */
async function enforceEmailVerification(
  user: AuthenticatedAccessUser,
  request: NextRequest,
): Promise<NextResponse | null> {
  if (user.emailVerified || !user.isOrganizationOwner) return null;

  const pathname = new URL(request.url).pathname;
  if (
    VERIFICATION_EXEMPT_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  ) {
    return null;
  }

  const { registration } = await getPlatformSettings();
  if (!registration.requireEmailVerification) return null;

  return createErrorResponse(
    "Confirm your email address to continue. Check your inbox for the verification link.",
    403,
    undefined,
    "EMAIL_NOT_VERIFIED",
  );
}

/**
 * Baseline abuse ceiling for every authenticated request. Individual routes
 * may still add a tighter `withRateLimit`; this is the floor that stops a
 * single compromised or scripted session from hammering any of the ~200
 * authenticated endpoints that carry no limit of their own.
 *
 * Reads and writes get separate buckets so a burst of dashboard fetches can
 * never exhaust the allowance a form submission needs.
 */
async function enforceBaselineRateLimit(
  userId: string,
  request: NextRequest,
  override?: { windowMs: number; maxRequests: number },
): Promise<NextResponse | null> {
  const isRead = request.method === "GET" || request.method === "HEAD";
  const { windowMs, maxRequests } =
    override ?? (isRead ? AUTHENTICATED_READ_LIMIT : AUTHENTICATED_WRITE_LIMIT);

  // An override is route-specific, so it gets its own bucket keyed by path —
  // otherwise a tight upload limit would eat the caller's whole write budget.
  const bucket = override
    ? `route:${new URL(request.url).pathname}`
    : `api:${isRead ? "read" : "write"}`;

  const result = await checkRateLimitByKey(
    `${bucket}:user:${userId}`,
    windowMs,
    maxRequests,
  );
  if (result.success) return null;

  return createRateLimitResponse(
    "Too many requests. Please slow down and try again shortly.",
    result.resetTime,
  ) as unknown as NextResponse;
}

/**
 * Refuse a request whose module the organization's package does not include.
 *
 * Returns a 402 response to send back, or null to continue. The path lookup
 * runs first and costs nothing: only routes a module owns (the menu tree in
 * lib/navigation/menu-config.ts) reach the database, so billing, auth,
 * settings, profile and notifications stay on the cheap path — and, more
 * importantly, stay reachable on every package. An organization must always
 * be able to open the screen that sells it the module it is missing.
 *
 * Report APIs answer per `?type=`: each report with a menu entry is its own
 * module. `/api/v1/*` is folded back onto `/api/*` before the lookup.
 */
async function resolvePlanFeatureForRequest(
  requirement: AccessRequirement,
  request: NextRequest,
  organizationId: string,
  user?: AccessProfile,
): Promise<NextResponse | null> {
  if (requirement.planFeature === false) return null;

  const { apiModuleCandidates, moduleCandidatesForKey, decideModuleAccess } =
    await import("./billing/modules");
  const candidates = requirement.planFeature
    ? moduleCandidatesForKey(requirement.planFeature)
    : apiModuleCandidates(
        request.nextUrl.pathname,
        request.nextUrl.searchParams,
      );
  if (!candidates) return null;

  try {
    const [{ getOrganizationModules }, { planFeatureLabel }, { canAccessNavItem }] =
      await Promise.all([
        import("./billing/entitlements"),
        import("./billing/plan-constants"),
        import("./role-utils"),
      ]);

    // Organization-scoped reads, so they need the context that
    // withAccessAndDB establishes further down for the handler itself.
    const { plan, state } = await runWithOrgContext(
      { organizationId, isPlatformAdmin: false },
      async () => getOrganizationModules(organizationId),
    );

    // Among the modules sharing an API, the ones meant for this caller
    // decide: a tenant's "My requests" switched off refuses the tenant even
    // while the office's maintenance list is on.
    const decision = decideModuleAccess(
      candidates,
      (key) => state.enabled.has(key),
      {
        applies: user ? (node) => canAccessNavItem(user, node) : undefined,
        isPlatformOff: (key) => state.platformOff.has(key),
      },
    );
    if (decision.allowed) return null;

    const label = planFeatureLabel(decision.blockedKey ?? candidates[0].key);
    return decision.platformOff
      ? createErrorResponse(
          `${label} is not available at the moment.`,
          402,
          "The platform has switched this module off for every package.",
          "plan_feature_required",
        )
      : createErrorResponse(
          `${label} is not included in the ${plan?.name ?? "current"} plan.`,
          402,
          "Upgrade the subscription to turn this on.",
          "plan_feature_required",
        );
  } catch (error) {
    // A plan lookup that fails must not take the whole API down with it. The
    // limit checks inside the handlers are the second line of defence.
    console.error("Plan entitlement check failed; allowing request", error);
    return null;
  }
}

export function withAccessAndDB(requirement: AccessRequirement) {
  return function (handler: any): any {
    return async (
      request: NextRequest,
      context?: any
    ): Promise<NextResponse> => {
      try {
        const user = await resolveAuthenticatedUser();

        if (!user) {
          return createErrorResponse("Authentication required", 401);
        }

        if (!user.isActive) {
          return createErrorResponse("Account is deactivated", 403);
        }

        const throttled = await enforceBaselineRateLimit(
          user.id,
          request,
          requirement.rateLimit,
        );
        if (throttled) return throttled;

        if (!user.organizationId) {
          return createErrorResponse(
            user.isPlatformAdmin
              ? "Platform administrators must use the platform API"
              : "Organization membership required",
            403,
          );
        }

        const requestedOrganizationSlug = request.headers.get(
          "x-propertypro-org-slug",
        );
        if (
          requestedOrganizationSlug &&
          requestedOrganizationSlug !== user.organizationSlug
        ) {
          return createErrorResponse(
            "This account does not belong to the requested organization",
            403,
          );
        }

        const readOnly = enforceImpersonationReadOnly(user, request);
        if (readOnly) return readOnly;

        const unverified = await enforceEmailVerification(user, request);
        if (unverified) return unverified;

        if (!hasAccess(user, requirement)) {
          return createErrorResponse("Insufficient permissions", 403);
        }

        // Plan entitlement. One check here covers every route in the app: the
        // module a path belongs to comes from the menu tree, so adding a
        // route under /api/inspections is gated the day it is written rather
        // than the day someone remembers to tag it.
        //
        // 402 rather than 403 — the caller has the permission, the *account*
        // has not bought the module, and the difference is what tells the UI
        // to offer an upgrade instead of an access error.
        const gatedFeature = await resolvePlanFeatureForRequest(
          requirement,
          request,
          user.organizationId,
          user,
        );
        if (gatedFeature) return gatedFeature;

        // Establish the organization context for the entire request so that
        // every downstream Prisma query (including tenant-profile creation)
        // is automatically scoped to the caller's organization.
        return await runWithOrgContext(
          {
            organizationId: user.organizationId,
            isPlatformAdmin: user.isPlatformAdmin,
          },
          async () => {
            let tenantProfile = null;

            if (user.isTenant) {
              try {
                tenantProfile = await ensureTenantProfile(user.id);
              } catch (tenantError) {
                console.error("Failed to ensure tenant profile:", tenantError);
                return createErrorResponse(
                  "Unable to resolve tenant profile",
                  500
                );
              }

              if (!tenantProfile) {
                console.error(
                  "Tenant profile could not be created or retrieved for user",
                  user.id
                );
                return createErrorResponse("Tenant profile unavailable", 500);
              }
            }

            const augmentedContext = {
              ...(context ?? {}),
              tenantProfile,
            };

            // Inside an audit scope: the actor is copied onto every entry the
            // handler records, and a successful write that recorded none gets
            // one basic entry — see lib/audit/backstop.
            const result = await runRequestWithAudit(user, request, () =>
              handler(user, request, augmentedContext)
            );

            if (!result) {
              console.error("Handler returned null/undefined");
              return createErrorResponse(
                "Internal server error: no response from handler",
                500
              );
            }

            return result;
          }
        );
      } catch (error) {
        console.error("withAccessAndDB error:", error);
        return handleApiError(error);
      }
    };
  };
}

// Primary authentication middleware for Next.js 15 App Router
export function withRoleAndDB(roles: string | string[]) {
  return withAccessAndDB({
    roles: Array.isArray(roles) ? roles : [roles],
  });
}

export function withPermissionAndDB(
  permissions: string | string[],
  options: {
    requireAllPermissions?: boolean;
    roles?: string[];
    rateLimit?: AccessRequirement["rateLimit"];
  } = {}
) {
  return withAccessAndDB({
    roles: options.roles,
    permissions: Array.isArray(permissions) ? permissions : [permissions],
    requireAllPermissions: options.requireAllPermissions,
    rateLimit: options.rateLimit,
  });
}

// Platform-owner middleware: only super-admins (organizationId === null) pass.
// The handler runs with org scoping disabled so it can read across every
// organization (e.g. the platform admin console).
export function withPlatformAdminAndDB() {
  return function (handler: any): any {
    return async (
      request: NextRequest,
      context?: any
    ): Promise<NextResponse> => {
      try {
        const user = await resolveAuthenticatedUser();

        if (!user) {
          return createErrorResponse("Authentication required", 401);
        }
        if (!user.isActive) {
          return createErrorResponse("Account is deactivated", 403);
        }
        if (!user.isPlatformAdmin) {
          return createErrorResponse("Platform admin access required", 403);
        }

        const throttled = await enforceBaselineRateLimit(user.id, request);
        if (throttled) return throttled;

        const result = await runWithOrgContext(
          { organizationId: null, isPlatformAdmin: true },
          () =>
            runRequestWithAudit(user, request, () =>
              handler(user, request, context ?? {})
            )
        );

        return result ?? createErrorResponse("No response from handler", 500);
      } catch (error) {
        console.error("withPlatformAdminAndDB error:", error);
        return handleApiError(error);
      }
    };
  };
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

export function sanitizeUser(user: any) {
  const { password, ...sanitized } = user;
  return sanitized;
}

export function generateSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// export function formatCurrency(amount: number): string {
//   return new Intl.NumberFormat("en-US", {
//     style: "currency",
//     currency: "USD",
//   }).format(amount);
// }

export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

/**
 * Sanity-check a record id from the URL/body before querying. Accepts cuids
 * (current) and 24-hex ObjectIds (legacy links); rejects garbage early so
 * routes can 400 instead of shipping junk to the database.
 */
export function isValidObjectId(id: string): boolean {
  if (!id || typeof id !== "string") return false;
  return /^[A-Za-z0-9_-]{8,64}$/.test(id);
}
