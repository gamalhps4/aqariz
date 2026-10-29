"use client";

import { useMemo, useSyncExternalStore } from "react";
import { createAuthClient } from "better-auth/react";
import {
  inferAdditionalFields,
  twoFactorClient,
} from "better-auth/client/plugins";
import type { auth } from "./better-auth";
import { safeCallbackUrl } from "./safe-callback-url";
import { landingPathForUser } from "./auth-landing";
import { IMPERSONATION_HINT_COOKIE } from "./platform/impersonation-hint";

/**
 * Browser-side auth client.
 *
 * The exported `useSession` / `signIn` / `signOut` deliberately mirror the
 * next-auth/react API the app was built against, so migrating the ~80 call
 * sites was an import-path change rather than a rewrite. Better Auth's own
 * client is exported as `authClient` for anything new — prefer it, and prefer
 * its richer return values (`error`, `isPending`, `refetch`) over the
 * lowest-common-denominator shapes below.
 */

// No baseURL: the client then talks to the origin the page was served from,
// which is always right — including on organization subdomains, where pinning
// it to NEXT_PUBLIC_APP_URL would send auth requests to the apex host and
// break the per-subdomain session binding.
export const authClient = createAuthClient({
  plugins: [
    inferAdditionalFields<typeof auth>(),
    // Exposes authClient.twoFactor.{enable,disable,verifyTotp,…}. A sign-in
    // for an enrolled user returns twoFactorRedirect instead of a session.
    twoFactorClient(),
  ],
});

/** The session user as the dashboard consumes it. */
export interface AppSessionUser {
  id: string;
  email: string;
  name?: string;
  role: string;
  isActive: boolean;
  /** Owning organization (SaaS account). Null for platform super-admins and
   * users who have not completed onboarding. */
  organizationId: string | null;
  firstName?: string;
  lastName?: string;
  phone?: string;
  avatar?: string;
  image?: string;
}

export interface AppSession {
  user: AppSessionUser;
  sessionId?: string;
  expires?: string;
}

export type SessionStatus = "loading" | "authenticated" | "unauthenticated";

const noopSubscribe = () => () => {};

/**
 * Support impersonation ("View as" on /admin/users).
 *
 * The overlay lives on the server: `auth()` resolves as the customer while
 * the signed cookie is set, but Better Auth's get-session — what this hook
 * reads — keeps answering with the operator. The dashboard's guard then saw a
 * super-admin and sent them to /admin, whose server guard saw the customer
 * and sent them back: a loop that held until the grant expired an hour later.
 *
 * So for a platform super-admin (the only account that can hold a grant) with
 * the hint cookie present, the hook asks the server once per page load whom
 * it is viewing as, and stays "loading" until it knows. Starting and ending a
 * support view are both hard navigations, so the answer never outlives the
 * page that asked.
 */
type ImpersonationLookup =
  | { state: "pending" }
  | { state: "done"; user: AppSessionUser | null };

let impersonationLookup: ImpersonationLookup | null = null;
const impersonationListeners = new Set<() => void>();

function hasImpersonationHint(): boolean {
  return document.cookie
    .split(";")
    .some((part) => part.trim().startsWith(`${IMPERSONATION_HINT_COOKIE}=1`));
}

function subscribeImpersonation(listener: () => void): () => void {
  impersonationListeners.add(listener);
  if (!impersonationLookup) {
    impersonationLookup = { state: "pending" };
    const settle = (user: AppSessionUser | null) => {
      impersonationLookup = { state: "done", user };
      impersonationListeners.forEach((notify) => notify());
    };
    if (!hasImpersonationHint()) {
      settle(null);
    } else {
      fetch("/api/auth/impersonation-status", { cache: "no-store" })
        .then((response) => (response.ok ? response.json() : null))
        .then((payload) =>
          settle(
            payload?.data?.impersonating && payload.data.user
              ? (payload.data.user as AppSessionUser)
              : null,
          ),
        )
        // The operator's own session is the safe answer: the server applies
        // the overlay regardless, and the console's guard routes from there.
        .catch(() => settle(null));
    }
  }
  return () => {
    impersonationListeners.delete(listener);
  };
}

const getImpersonationLookup = () => impersonationLookup;
const getNoImpersonationLookup = () => null;

/**
 * next-auth-compatible `useSession`.
 *
 * Returns `{ data, status, update }`. Better Auth reports loading as a boolean
 * and has no notion of an "unauthenticated" state distinct from "no data", so
 * the three-way status the app branches on is reconstructed here.
 */
export function useSession(): {
  data: AppSession | null;
  status: SessionStatus;
  update: () => void;
} {
  const { data, isPending, error, refetch } = authClient.useSession();
  // False on the server and while React hydrates the page, true afterwards.
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);

  const realUser = data?.user as
    | { role?: string; organizationId?: string | null }
    | undefined;
  const mayImpersonate =
    realUser?.role === "super_admin" && !realUser.organizationId;
  const lookup = useSyncExternalStore(
    mayImpersonate ? subscribeImpersonation : noopSubscribe,
    mayImpersonate ? getImpersonationLookup : getNoImpersonationLookup,
    getNoImpersonationLookup,
  );
  const impersonatedUser = lookup?.state === "done" ? lookup.user : null;

  // "unauthenticated" is a verdict, not an absence: several layouts redirect
  // to sign-in the moment they see it. A transient get-session failure at
  // first paint (network blip, server restart) has data=null but is not that
  // verdict — report it as still loading rather than bouncing a genuinely
  // signed-in user to the login form. A 401 is the real thing.
  const status: SessionStatus = isPending
    ? "loading"
    : data?.user
      ? mayImpersonate && lookup?.state !== "done"
        ? "loading"
        : "authenticated"
      : error && error.status !== 401
        ? "loading"
        : "unauthenticated";

  // Memoized on the store snapshot: the underlying store atom only changes
  // identity when the session actually changes, and many dashboard pages key
  // data-fetch effects on this object — a fresh literal per render would
  // re-run them all on every render.
  const session = useMemo<AppSession | null>(() => data?.user
    ? {
        user: impersonatedUser ?? {
          id: String(data.user.id),
          email: data.user.email ?? "",
          role: (data.user as { role?: string }).role ?? "tenant",
          isActive: (data.user as { isActive?: boolean }).isActive !== false,
          organizationId:
            (data.user as { organizationId?: string | null }).organizationId ??
            null,
          firstName: (data.user as { firstName?: string }).firstName,
          lastName: (data.user as { lastName?: string }).lastName,
          phone: (data.user as { phone?: string }).phone,
          // The Mongoose model calls it `avatar`; Better Auth maps that column
          // onto `image`. Expose both so either spelling keeps working.
          avatar: data.user.image ?? undefined,
          image: data.user.image ?? undefined,
          name:
            data.user.name ||
            [
              (data.user as { firstName?: string }).firstName,
              (data.user as { lastName?: string }).lastName,
            ]
              .filter(Boolean)
              .join(" ") ||
            undefined,
        },
        sessionId: data.session?.id ? String(data.session.id) : undefined,
        expires: data.session?.expiresAt
          ? new Date(data.session.expiresAt).toISOString()
          : undefined,
      }
    : null, [data, impersonatedUser]);

  // The server never knows the session, so it draws every page as "loading".
  // The store can be filled before React hydrates a part of the page; drawing
  // that part signed-in would not match the server's HTML (error #418 — the
  // dashboard drew the staff overview over the server's tenant fallback). So
  // hydration answers what the server answered, and the session follows in
  // the render straight after.
  if (!hydrated) return { data: null, status: "loading", update: refetch };

  return { data: session, status, update: refetch };
}

/**
 * next-auth-compatible `signIn`.
 *
 * Only the credentials provider resolves rather than redirects, matching how
 * the sign-in page consumes the result: `{ ok, error }` with `error` holding a
 * message to display rather than throwing.
 */
export async function signIn(
  provider: "credentials" | "google" | "github",
  options?: {
    email?: string;
    password?: string;
    callbackUrl?: string;
    redirect?: boolean;
  }
): Promise<{
  ok: boolean;
  error: string | null;
  status: number | null;
  url: string | null;
  /** The password was right, but the account has TOTP enrolled — Better Auth
   * has issued a short-lived 2FA challenge cookie instead of a session, and
   * the caller must collect a code before anyone is signed in. */
  twoFactorRequired?: boolean;
}> {
  // Validated at every entry point, not just where the query string is read:
  // this wrapper is shared, and a caller that forwards an unchecked value must
  // not be able to turn the post-sign-in redirect into an open redirect.
  const callbackURL = safeCallbackUrl(options?.callbackUrl);

  if (provider === "credentials") {
    // No callbackURL in the body: /sign-in/email would echo it back with
    // redirect:true, and the client's default redirectPlugin then hard-
    // navigates (window.location.href), racing the router.replace the sign-in
    // form performs — a visible flash and a doubled dashboard render.
    // Navigation is the caller's job; `url` below is already sanitized.
    const { data, error } = await authClient.signIn.email({
      email: options?.email ?? "",
      password: options?.password ?? "",
    });

    const twoFactorRequired = Boolean(
      (data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect,
    );

    return {
      ok: !error && Boolean(data),
      error: error?.message ?? (error ? "Unable to sign in" : null),
      // The HTTP status distinguishes refusals the form must word differently
      // — a 429 from the rate limiter is not "wrong password".
      status: error?.status ?? null,
      // A 2FA challenge is not a destination: the caller sends the user to the
      // code screen and keeps this for afterwards.
      //
      // Otherwise the destination is resolved from the user this response just
      // returned, not from callbackURL alone. A platform super-admin asking
      // for the default /dashboard would otherwise load the org shell, wait on
      // a second session round-trip in the browser, and only then be bounced
      // to /admin — the blank screen between the two.
      url:
        error || twoFactorRequired
          ? null
          : landingPathForUser(
              data?.user as { role?: string; organizationId?: string | null },
              callbackURL,
            ),
      twoFactorRequired,
    };
  }

  // The social flow keeps callbackURL: OAuth leaves the site and relies on the
  // redirectPlugin to reach the provider and come back.
  const { error } = await authClient.signIn.social({ provider, callbackURL });
  return {
    ok: !error,
    error: error?.message ?? null,
    status: error?.status ?? null,
    url: error ? null : callbackURL,
  };
}

/** next-auth-compatible `signOut`. */
export async function signOut(options?: {
  callbackUrl?: string;
}): Promise<void> {
  try {
    await authClient.signOut();
  } catch (error) {
    // Navigate anyway: the user asked to leave and must get a definite
    // outcome. If the server call failed the session cookie survives, and the
    // sign-in page's real session check surfaces that immediately (by
    // bouncing back to the dashboard) instead of this failing silently.
    console.error("Sign out request failed:", error);
  }
  if (typeof window !== "undefined") {
    window.location.href = options?.callbackUrl ?? "/auth/signin";
  }
}

/**
 * Kept so the provider tree does not have to change. Better Auth's client holds
 * session state in a store rather than context, so there is nothing to provide.
 */
export function SessionProvider({
  children,
}: {
  children: React.ReactNode;
}): React.ReactNode {
  return children;
}
