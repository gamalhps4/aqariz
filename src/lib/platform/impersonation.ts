import "server-only";

/**
 * PropertyPro SaaS - Support impersonation
 *
 * "View as this customer" for platform operators. Deliberately implemented as
 * an overlay on the operator's own session rather than by minting a session
 * for the target user:
 *
 *   - The operator's real session must still be valid on every request, so
 *     revoking their access instantly ends any impersonation too.
 *   - No row is written to `user_sessions`, so an impersonated session cannot
 *     outlive the operator, be resumed later, or show up in the customer's own
 *     device list as a login they didn't make.
 *   - Ending it is deleting a cookie — there is no session to leak.
 *
 * Impersonated requests are **read-only** (enforced in `withAccessAndDB`).
 * Support needs to see what the customer sees; it does not need to move their
 * money. Every start and stop is written to the platform audit trail.
 */

import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

export const IMPERSONATION_COOKIE = "pp_impersonate";

/** How long a single impersonation grant lasts before it must be re-started. */
const MAX_AGE_SECONDS = 60 * 60;

function secret(): string {
  const value =
    process.env.BETTER_AUTH_SECRET ??
    process.env.AUTH_SECRET ??
    process.env.NEXTAUTH_SECRET;
  if (!value) {
    throw new Error(
      "BETTER_AUTH_SECRET is required to sign impersonation tokens",
    );
  }
  return value;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export interface ImpersonationGrant {
  /** The user being viewed as. */
  targetUserId: string;
  /** The platform admin who started it — recorded on every audited action. */
  impersonatorId: string;
  expiresAt: number;
}

/** Mint the cookie value. The operator's id is inside the signed payload, so a
 * cookie stolen by another admin still names its true author in the audit. */
export function createImpersonationToken(
  targetUserId: string,
  impersonatorId: string,
): { value: string; maxAge: number } {
  const expiresAt = Date.now() + MAX_AGE_SECONDS * 1000;
  const payload = `${targetUserId}.${impersonatorId}.${expiresAt}`;
  return {
    value: `${payload}.${sign(payload)}`,
    maxAge: MAX_AGE_SECONDS,
  };
}

export function verifyImpersonationToken(
  value: string | undefined,
): ImpersonationGrant | null {
  if (!value) return null;

  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const [targetUserId, impersonatorId, expiresRaw, signature] = parts;

  const payload = `${targetUserId}.${impersonatorId}.${expiresRaw}`;
  const expected = Buffer.from(sign(payload));
  const provided = Buffer.from(signature);
  if (
    expected.length !== provided.length ||
    !timingSafeEqual(expected, provided)
  ) {
    return null;
  }

  const expiresAt = Number(expiresRaw);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;

  return { targetUserId, impersonatorId, expiresAt };
}

/** The active grant on this request, if the cookie carries a valid one. */
export async function readImpersonationGrant(): Promise<ImpersonationGrant | null> {
  try {
    const store = await cookies();
    return verifyImpersonationToken(store.get(IMPERSONATION_COOKIE)?.value);
  } catch {
    // Outside a request scope (or no secret configured) there is no grant.
    return null;
  }
}

export const impersonationCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

export { IMPERSONATION_HINT_COOKIE } from "./impersonation-hint";

/** The browser-readable companion of the grant; see ./impersonation-hint. */
export const impersonationHintCookieOptions = {
  ...impersonationCookieOptions,
  httpOnly: false,
};
