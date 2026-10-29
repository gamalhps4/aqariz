import "server-only";

import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { bearer, twoFactor } from "better-auth/plugins";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { getSessionCookie } from "better-auth/cookies";
import bcrypt from "bcryptjs";

import { UserRole } from "@/types";
import { authDb } from "@/lib/db/prisma";
import { extractIpAddress, parseUserAgent } from "./session-tracker";
import { auditService } from "./audit-service";
import { fullName } from "./audit/scope";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "./password-policy";
import {
  MAX_LOGIN_ATTEMPTS,
  engagedLockState,
  isLockActive,
} from "./lockout-policy";

/**
 * Better Auth server instance (SaaS build).
 *
 * This file owns the auth library; `src/lib/auth.ts` wraps it in the session
 * shape the rest of the app already consumes, so route handlers and components
 * do not import from here directly.
 *
 * Three decisions shape everything below:
 *
 * 1. Better Auth is pointed at the app's own `users` table via the Prisma
 *    adapter (bypass client) — one user store for the auth library and the
 *    application, no split-brain.
 *
 * 2. Passwords stay bcrypt. Better Auth keeps the hash on the `account` record
 *    rather than the user, so the migration script moves each existing hash
 *    across, and the custom verify below reads it with the same bcrypt that
 *    wrote it. No customer has to reset a password.
 *
 * 3. Multi-tenancy stays in the app's own Organization/Role models — the
 *    organization plugin is deliberately NOT used. Billing state lives on
 *    Organization, membership is single-org-per-user, and the permission
 *    catalog is custom; the plugin's many-to-many membership tables would
 *    duplicate all of it. Better Auth only needs to know the user's
 *    organizationId, which is stamped onto the user and each session below.
 */

const BCRYPT_ROUNDS = 12;
const SESSION_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 30; // 30 days
const SESSION_UPDATE_AGE_SECONDS = 60 * 60 * 24; // refresh at most daily

/**
 * The deployment's public base URL, resolved once.
 *
 * The NextAuth-era names are read as fallbacks so an upgraded deployment keeps
 * working without touching its environment. `baseURL` and `trustedOrigins`
 * must both come from this: deriving the origin list separately means a
 * deployment that set only NEXTAUTH_URL gets a baseURL from its real host and
 * a trusted origin of "http://localhost:3000", and every state-changing auth
 * request fails the origin check in production.
 */
const APP_BASE_URL =
  process.env.BETTER_AUTH_URL ??
  process.env.NEXTAUTH_URL ??
  process.env.NEXT_PUBLIC_APP_URL ??
  "http://localhost:3000";

/**
 * The apex domain organizations get subdomains under (org1.example.com).
 * Sessions must survive subdomain hops, and auth requests from org subdomains
 * must pass the origin check — both derive from this.
 */
const SAAS_ROOT_DOMAIN = (() => {
  const rootDomain = process.env.SAAS_ROOT_DOMAIN?.trim().toLowerCase();
  if (
    !rootDomain ||
    rootDomain === "localhost" ||
    !/^[a-z0-9.-]+$/.test(rootDomain)
  ) {
    return undefined;
  }
  return rootDomain;
})();

const sharedSessionCookieDomain =
  process.env.NODE_ENV === "production" && SAAS_ROOT_DOMAIN
    ? `.${SAAS_ROOT_DOMAIN}`
    : undefined;

const socialProviders: Record<string, unknown> = {};

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  socialProviders.google = {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    // Keep the split name fields the dashboard reads; Better Auth itself only
    // stores the combined `name`.
    mapProfileToUser: (profile: {
      given_name?: string;
      family_name?: string;
    }) => ({
      firstName: profile.given_name ?? "",
      lastName: profile.family_name ?? "",
    }),
  };
}

if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
  socialProviders.github = {
    clientId: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
    mapProfileToUser: (profile: { name?: string | null }) => ({
      firstName: profile.name?.split(" ")?.[0] ?? "",
      lastName: profile.name?.split(" ")?.slice(1)?.join(" ") ?? "",
    }),
  };
}

/** Providers whose credentials are present. The sign-in page reads this
 * (via /api/platform/status) so a button only appears when it would work —
 * previously the config existed with no UI at all, making the whole OAuth
 * path, and the /auth/onboarding page built to catch it, unreachable. */
export const configuredSocialProviders = Object.keys(socialProviders);

export const auth = betterAuth({
  appName: "PropertyPro",
  secret:
    process.env.BETTER_AUTH_SECRET ??
    process.env.AUTH_SECRET ??
    process.env.NEXTAUTH_SECRET,
  baseURL: APP_BASE_URL,

  // authDb is the bypass Prisma client: sign-in resolves users by bare email
  // across every organization by design; the sign-in gate below stands guard.
  database: prismaAdapter(authDb, { provider: "postgresql" }),

  emailAndPassword: {
    enabled: true,
    // Self-registration goes through /api/auth/signup-organization, which
    // provisions the user AND their organization atomically. The library's own
    // /sign-up/email endpoint would mint org-less users outside that flow, so
    // it stays off.
    disableSignUp: true,
    // Verification is handled by the app's own email flows, not here: this
    // flag would refuse the sign-in itself, locking out staff an admin
    // invited (and tenants) who have no reason to click anything. The real
    // gate lives in `withAccessAndDB` — it applies only to self-registered
    // organization owners, and only when the super-admin has turned on
    // `registration.requireEmailVerification` in the platform console.
    requireEmailVerification: false,
    autoSignIn: false,
    minPasswordLength: PASSWORD_MIN_LENGTH,
    maxPasswordLength: PASSWORD_MAX_LENGTH,
    password: {
      hash: async (password) => bcrypt.hash(password, BCRYPT_ROUNDS),
      verify: async ({ password, hash }) => {
        // Hashes were carried over verbatim from the Mongo era, so an
        // existing password keeps working with no reset.
        return bcrypt.compare(password, hash);
      },
    },
  },

  socialProviders,

  user: {
    fields: {
      // The app's User row stores an avatar URL; Better Auth calls it `image`.
      image: "avatar",
      // The app's own `emailVerified` is a Date and is read all over the
      // dashboard. Better Auth wants a boolean, so give it its own field
      // instead of overwriting a column other code depends on.
      emailVerified: "emailVerifiedFlag",
    },
    additionalFields: {
      // `input: false` is the security-relevant part: without it these are
      // accepted from the sign-up request body, which is how a self-registering
      // user would hand themselves an admin role or someone else's org.
      role: { type: "string", required: false, defaultValue: UserRole.TENANT, input: false },
      isActive: { type: "boolean", required: false, defaultValue: true, input: false },
      isLocked: { type: "boolean", required: false, defaultValue: false, input: false },
      organizationId: { type: "string", required: false, input: false },
      tenantStatus: { type: "string", required: false, input: false },
      deletedAt: { type: "date", required: false, input: false },
      passwordChangedAt: { type: "date", required: false, input: false },
      firstName: { type: "string", required: false },
      lastName: { type: "string", required: false },
      phone: { type: "string", required: false },
    },
  },

  session: {
    // Maps to the user_sessions table (see prisma/schema.prisma). Better Auth
    // owns the lifecycle, so there is exactly one source of truth — deleting a
    // row terminates the session on its very next request.
    expiresIn: SESSION_EXPIRES_IN_SECONDS,
    updateAge: SESSION_UPDATE_AGE_SECONDS,
    additionalFields: {
      // Written by the session hook below. deviceType/browser/os feed the
      // sessions screen; organizationId is what lets the org-scoped
      // UserSession model list only the caller's own organization.
      deviceType: { type: "string", required: false, input: false },
      browser: { type: "string", required: false, input: false },
      os: { type: "string", required: false, input: false },
      organizationId: { type: "string", required: false, input: false },
    },
  },

  account: {
    accountLinking: {
      enabled: true,
      // An OAuth identity may only attach to an existing local account when the
      // provider is one we trust to have verified the address. Linking on a
      // bare email match is the classic pre-account-takeover: register a GitHub
      // account against someone's address and inherit their account.
      trustedProviders: ["google"],
      allowDifferentEmails: false,
    },
  },

  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    storage: "database",
    customRules: {
      "/sign-in/email": { window: 300, max: 10 },
    },
  },

  advanced: {
    // Cookies must not be readable by scripts, and must not ride along on
    // cross-site requests.
    defaultCookieAttributes: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    },
    // One session across every organization subdomain (org1.example.com and
    // app.example.com share `.example.com` cookies), matching the NextAuth
    // cookie-domain behaviour this replaces.
    ...(sharedSessionCookieDomain
      ? {
          crossSubDomainCookies: {
            enabled: true,
            domain: sharedSessionCookieDomain,
          },
        }
      : {}),
  },

  // Same source as baseURL — see APP_BASE_URL. Organization subdomains are
  // trusted via wildcard so sign-in posted from org1.example.com passes the
  // origin check.
  trustedOrigins: Array.from(
    new Set(
      [
        APP_BASE_URL,
        process.env.NEXT_PUBLIC_APP_URL,
        ...(SAAS_ROOT_DOMAIN
          ? [`https://${SAAS_ROOT_DOMAIN}`, `https://*.${SAAS_ROOT_DOMAIN}`]
          : []),
      ].filter(Boolean)
    )
  ) as string[],

  databaseHooks: {
    session: {
      create: {
        /**
         * The sign-in gate. Runs after credentials or OAuth have been accepted
         * but before a session exists, so it is the one place that covers every
         * provider — the NextAuth version only guarded the credentials path,
         * which let a locked or deactivated user in through Google.
         *
         * Deliberately does NOT gate on tenantStatus: on this SaaS build,
         * tenants are provisioned by organization staff and sign in before any
         * application workflow completes — matching the NextAuth behaviour
         * this replaces.
         */
        before: async (session) => {
          const user = await authDb.user.findUnique({
            where: { id: String(session.userId) },
          });

          if (!user) throw new APIError("FORBIDDEN", { message: "Account not found" });
          if (user.deletedAt)
            throw new APIError("FORBIDDEN", { message: "Account not found" });
          if (user.isActive === false)
            throw new APIError("FORBIDDEN", {
              message: "Account is deactivated",
            });

          if (isLockActive(user.isLocked, user.lockedUntil)) {
            throw new APIError("FORBIDDEN", {
              message: user.lockedUntil
                ? "Account is temporarily locked after too many failed sign-in attempts"
                : "Account is blocked. Please contact an administrator",
            });
          }

          // Members of a suspended (or deleted) organization cannot sign in.
          // Platform super-admins and not-yet-onboarded users have no
          // organizationId and are unaffected.
          if (user.organizationId) {
            const organization = await authDb.organization.findUnique({
              where: { id: user.organizationId },
              select: { status: true },
            });
            if (!organization || organization.status === "suspended") {
              throw new APIError("FORBIDDEN", {
                message: "Your organization is unavailable",
              });
            }
          }

          // Decorate the row with what the admin sessions screen displays, and
          // stamp the owning organization so the org-scoped UserSession model
          // can list sessions per tenant organization.
          const { deviceType, browser, os } = parseUserAgent(session.userAgent);

          return {
            data: {
              ...session,
              deviceType,
              browser,
              os,
              organizationId: user.organizationId ?? null,
            },
          };
        },

        /**
         * Audit the successful sign-in.
         *
         * Runs here rather than on the sign-in endpoint because this is the one
         * point every provider passes through, and it fires only after the gate
         * above has accepted the account — so the log records real sign-ins, not
         * attempts that were about to be refused.
         */
        after: async (session) => {
          try {
            const user = await authDb.user.findUnique({
              where: { id: String(session.userId) },
              select: {
                email: true,
                role: true,
                organizationId: true,
                firstName: true,
                lastName: true,
              },
            });

            // A platform operator has no organization: the entry goes to the
            // platform's own log rather than being dropped.
            await auditService.logLogin(String(session.userId), {
              userId: String(session.userId),
              userEmail: user?.email ?? undefined,
              userRole: user?.role,
              userName: fullName(user?.firstName, user?.lastName) ?? undefined,
              organizationId: user?.organizationId ?? undefined,
              ipAddress: session.ipAddress || undefined,
              userAgent: session.userAgent || undefined,
              sessionId: session.id ? String(session.id) : undefined,
            });

            // Clear the lockout counter and stamp the login. The Mongoose
            // model's updateLastLogin/resetLoginAttempts used to do this from
            // NextAuth's authorize(); Better Auth never calls them, so doing it
            // here is what keeps lockout and the admin dashboard's "active in
            // the last 24 hours" working.
            await authDb.user.update({
              where: { id: String(session.userId) },
              data: {
                lastLogin: new Date(),
                failedLoginAttempts: 0,
                isLocked: false,
                lockedUntil: null,
              },
            });
          } catch (error) {
            // Never let an audit write break a sign-in.
            console.error("Failed to audit login:", error);
          }
        },
      },
    },
  },

  hooks: {
    /**
     * Sign-out is audited here rather than in the `after` hook below: by the
     * time the response is being returned the session has already been
     * destroyed, leaving nobody to attribute the event to.
     */
    before: createAuthMiddleware(async (ctx) => {
      // The library's own change-password endpoint writes a correct hash but
      // skips the app's invariants: no passwordChangedAt stamp and, unless the
      // caller opts in, no session revocation — so a stolen session would
      // survive the very password change meant to kill it. The app's route
      // (/api/user/change-password) holds those guarantees; this one is closed.
      if (ctx.path === "/change-password") {
        throw new APIError("FORBIDDEN", {
          message: "Password changes go through the account settings screen",
        });
      }

      if (ctx.path !== "/sign-out") return;
      try {
        // Resolve the session straight from the cookie rather than calling
        // auth.api.getSession from inside auth's own configuration, which is
        // re-entrant and silently returns nothing here. getSessionCookie is
        // the library's own reader: it also finds the `__Secure-`-prefixed
        // name the cookie carries in production.
        const raw = ctx.headers ? getSessionCookie(ctx.headers) : null;
        if (!raw) return;

        // The cookie carries "<token>.<signature>"; the row stores the token.
        const token = raw.split(".")[0];
        const row = await authDb.session.findUnique({
          where: { token },
          select: { userId: true },
        });
        if (!row?.userId) return;

        const user = await authDb.user.findUnique({
          where: { id: row.userId },
          select: {
            email: true,
            role: true,
            organizationId: true,
            firstName: true,
            lastName: true,
          },
        });

        await auditService.logLogout(String(row.userId), {
          userId: String(row.userId),
          userEmail: user?.email ?? undefined,
          userRole: user?.role,
          userName: fullName(user?.firstName, user?.lastName) ?? undefined,
          organizationId: user?.organizationId ?? undefined,
          ipAddress: extractIpAddress(ctx.headers as Headers),
          userAgent: ctx.headers?.get("user-agent") ?? undefined,
        });
      } catch (error) {
        console.error("Failed to audit logout:", error);
      }
    }),

    /**
     * The auth events that never create a session, and so cannot be caught by
     * the session hooks above: a rejected sign-in. It was audited before the
     * migration and the security overview reads it, so losing it would quietly
     * blind the activity log to failed logins.
     */
    after: createAuthMiddleware(async (ctx) => {
      try {
        const returned = ctx.context.returned;
        const failed = returned instanceof APIError;

        if (ctx.path === "/sign-in/email" && failed) {
          const email =
            typeof ctx.body?.email === "string" ? ctx.body.email : "unknown";
          const reason = String(returned.body?.message ?? "Sign-in refused");
          const attempted = await authDb.user.findUnique({
            where: { email: email.trim().toLowerCase() },
            select: {
              id: true,
              organizationId: true,
              role: true,
              firstName: true,
              lastName: true,
            },
          }).catch(() => null);
          // Filed against the account that was tried, so an employee's
          // activity shows the attempts on their account. An address that
          // matches no account — or a platform operator's — has no
          // organization, and goes to the platform's own log.
          await auditService.logLoginFailed(email, reason, {
            userId: attempted?.id,
            userRole: attempted?.role,
            userName:
              fullName(attempted?.firstName, attempted?.lastName) ?? undefined,
            ipAddress: extractIpAddress(ctx.headers as Headers),
            userAgent: ctx.headers?.get("user-agent") ?? undefined,
            organizationId: attempted?.organizationId ?? undefined,
          });

          // Only a genuine credential failure (401) counts toward lockout.
          // The sign-in gate's refusals — locked, suspended org, deactivated —
          // are 403s thrown AFTER the password verified; counting them would
          // lock users out for signing in with the right password. Every
          // refusal is still audited above.
          if (returned.statusCode === 401) {
            await registerFailedLoginAttempt(email);
          }
        }
      } catch (error) {
        // Auditing must never turn a successful request into a failure.
        console.error("Failed to audit auth event:", error);
      }
    }),
  },

  // nextCookies must stay last: it lets Better Auth set cookies from server
  // actions. bearer() lets non-browser clients (the future mobile app)
  // authenticate with `Authorization: Bearer <session token>` instead of the
  // cookie jar. twoFactor() adds opt-in TOTP: a user who has not enrolled
  // signs in exactly as before, so this changes nothing for existing accounts.
  plugins: [
    twoFactor({
      issuer: process.env.APP_NAME || "PropertyPro",
      skipVerificationOnEnable: false,
    }),
    bearer(),
    nextCookies(),
  ],
});

async function registerFailedLoginAttempt(email: string): Promise<void> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return;

  const now = new Date();

  // A lapsed timed lock means this failure starts a fresh streak. Without the
  // reset the counter never comes back down, so one typo after the lock
  // expired re-locks the account instantly — and keeps doing so forever.
  await authDb.user.updateMany({
    where: {
      email: normalized,
      deletedAt: null,
      isLocked: true,
      lockedUntil: { lte: now },
    },
    data: { failedLoginAttempts: 0, isLocked: false, lockedUntil: null },
  });

  // Atomic increment-and-read: K parallel wrong guesses each count once.
  // Counting only while no lock is in force keeps retries during a lock from
  // pushing its deadline out, and leaves an admin's manual block untouched.
  const counted = await authDb.$queryRaw<
    { id: string; failedLoginAttempts: number }[]
  >`UPDATE users SET "failedLoginAttempts" = "failedLoginAttempts" + 1
     WHERE email = ${normalized} AND "deletedAt" IS NULL AND "isLocked" = false
     RETURNING id, "failedLoginAttempts"`;

  const row = counted[0];
  if (!row) return;

  if (row.failedLoginAttempts >= MAX_LOGIN_ATTEMPTS) {
    const lock = engagedLockState(now.getTime());
    await authDb.user.updateMany({
      where: { id: row.id, isLocked: false },
      data: { isLocked: true, lockedUntil: lock.lockedUntil },
    });
  }
}

