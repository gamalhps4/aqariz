/**
 * Where an authenticated user belongs.
 *
 * Sign-in used to send everyone to `/dashboard` and let the dashboard layout
 * bounce whoever did not belong there. For a platform super-admin that meant
 * paying for the org shell, resolving the session a second time in the
 * browser, and then throwing `redirect()` mid-render — which unmounts the tree
 * and leaves a blank screen until `/admin` has finished rendering server-side.
 *
 * Deciding the destination once, from the user the sign-in response already
 * carries, removes the detour entirely. Shared by the sign-in client and the
 * dashboard/console guards so every hop agrees on the same answer.
 */

export const ADMIN_HOME = "/admin";
export const DASHBOARD_HOME = "/dashboard";
export const ONBOARDING_HOME = "/auth/onboarding";

export interface LandingUser {
  role?: string | null;
  organizationId?: string | null;
}

/** Strip `?query` / `#hash` so prefix tests compare paths, not whole targets. */
function pathnameOf(target: string): string {
  const cut = target.search(/[?#]/);
  return cut === -1 ? target : target.slice(0, cut);
}

function isUnder(target: string, root: string): boolean {
  const pathname = pathnameOf(target);
  return pathname === root || pathname.startsWith(`${root}/`);
}

/**
 * Resolve the post-authentication destination.
 *
 * `requested` is the already-sanitised callbackUrl (see `safeCallbackUrl`) —
 * it is honoured whenever it points somewhere this user can actually go, so a
 * deep link survives the trip through the login form. A destination the user
 * would only be bounced out of is replaced with their real home.
 */
export function landingPathForUser(
  user: LandingUser | null | undefined,
  requested?: string | null,
): string {
  const target = typeof requested === "string" && requested.startsWith("/")
    ? requested
    : null;

  // Platform super-admins live in the console and have no organization, so a
  // /dashboard target is never usable for them.
  if (user?.role === "super_admin") {
    return target && isUnder(target, ADMIN_HOME) ? target : ADMIN_HOME;
  }

  // Everyone else is bounced straight back out of the console.
  if (target && isUnder(target, ADMIN_HOME)) {
    return user?.organizationId ? DASHBOARD_HOME : ONBOARDING_HOME;
  }

  // Authenticated but not yet attached to an organization (e.g. a fresh OAuth
  // sign-up) — onboarding first, then whatever they asked for.
  if (user && !user.organizationId) return ONBOARDING_HOME;

  return target ?? DASHBOARD_HOME;
}
