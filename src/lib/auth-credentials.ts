// The single read/write path for a user's password.
//
// Better Auth keeps a credential's hash on its `account` record, not on the
// user, so every place that used to assign `user.password` goes through here.
// Centralising it also means the two things that must accompany a password
// change — stamping `passwordChangedAt` and destroying existing sessions —
// cannot be forgotten at one call site and remembered at another, which is how
// a stolen session used to survive the victim resetting their password.
//
// Uses the bypass Prisma client: credentials are keyed by user id, and the
// flows that call this (password reset, invitation acceptance, provisioning)
// often run before any organization context exists.
//
// Deliberately NOT "server-only": the seed and super-admin scripts run under
// tsx, outside Next.js, where that module does not resolve.

import bcrypt from "bcryptjs";

import { authDb } from "@/lib/db/prisma";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  WeakPasswordError,
  validatePasswordStrength,
} from "./password-policy";

// Re-exported so call sites can keep importing the policy from here.
export {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  WeakPasswordError,
  validatePasswordStrength,
};

const BCRYPT_ROUNDS = 12;
const CREDENTIAL_PROVIDER = "credential";
/**
 * What better-auth's own `createLocalAccountIssuer("credential")` produces.
 * Inlined rather than imported: the helper lives in @better-auth/core, a
 * transitive dependency this package does not declare. Sign-in compares the
 * stored issuer against this exact string, so a credential row written
 * without it cannot be used to log in.
 */
const CREDENTIAL_ISSUER = `local:${CREDENTIAL_PROVIDER}`;

/**
 * Replace a user's password.
 *
 * Revokes every existing session by default: a password change is the standard
 * response to "someone else is in my account", and it is worthless if the
 * intruder's session keeps working. Pass `revokeSessions: false` only when
 * creating a brand-new account that has no sessions to lose.
 */
export async function setUserPassword(
  userId: string,
  plaintextPassword: string,
  options: { revokeSessions?: boolean } = {},
): Promise<void> {
  const { revokeSessions = true } = options;

  const weakness = validatePasswordStrength(plaintextPassword);
  if (weakness) throw new WeakPasswordError(weakness);

  const hash = await bcrypt.hash(plaintextPassword, BCRYPT_ROUNDS);
  const now = new Date();

  await authDb.account.upsert({
    where: {
      providerId_accountId: {
        providerId: CREDENTIAL_PROVIDER,
        accountId: userId,
      },
    },
    update: { password: hash, updatedAt: now },
    create: {
      userId,
      accountId: userId,
      providerId: CREDENTIAL_PROVIDER,
      issuer: CREDENTIAL_ISSUER,
      password: hash,
    },
  });

  await authDb.user.update({
    where: { id: userId },
    data: { passwordChangedAt: now },
  });

  if (revokeSessions) {
    await revokeAllUserSessions(userId);
  }
}

/**
 * Remove a user's stored credentials and sessions.
 *
 * Exists for compensating rollback: a flow that creates an account and then
 * fails downstream has to undo the credential itself, or the email address is
 * held hostage — the applicant's retry would be refused as a duplicate by an
 * account they cannot sign in to.
 */
export async function deleteUserCredentials(userId: string): Promise<void> {
  await authDb.account.deleteMany({ where: { userId } });
  await authDb.session.deleteMany({ where: { userId } });
}

/** Check a plaintext password against the stored credential. */
export async function verifyUserPassword(
  userId: string,
  plaintextPassword: string,
): Promise<boolean> {
  const account = await authDb.account.findUnique({
    where: {
      providerId_accountId: {
        providerId: CREDENTIAL_PROVIDER,
        accountId: userId,
      },
    },
    select: { password: true },
  });

  const hash = account?.password;
  if (typeof hash !== "string" || hash.length === 0) return false;

  return bcrypt.compare(plaintextPassword, hash);
}

/** Whether the user has a password at all (OAuth-only accounts do not). */
export async function hasPasswordCredential(userId: string): Promise<boolean> {
  const account = await authDb.account.findUnique({
    where: {
      providerId_accountId: {
        providerId: CREDENTIAL_PROVIDER,
        accountId: userId,
      },
    },
    select: { password: true },
  });

  return typeof account?.password === "string" && account.password.length > 0;
}

/**
 * Destroy every session belonging to a user.
 *
 * Deleting the rows is what ends the sessions — Better Auth resolves the
 * session token against this table on every request, so a missing row means
 * the next request is rejected immediately.
 */
export async function revokeAllUserSessions(userId: string): Promise<number> {
  const result = await authDb.session.deleteMany({ where: { userId } });
  return result.count;
}
