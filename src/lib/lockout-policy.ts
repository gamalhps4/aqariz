/**
 * Per-account brute-force lockout policy.
 *
 * The counting used to live on the Mongoose model, called from NextAuth's
 * `authorize()`. Better Auth never calls those methods, so the logic moved into
 * the sign-in hooks — and the thresholds moved here rather than being restated
 * there, because a lockout that engages at a different count than the one the
 * admin screen reports is worse than no lockout at all.
 *
 * Free of imports and of `server-only`: the sign-in hook, the model and the
 * tests all read it, and the tests run outside the Next.js server bundle.
 */

export const MAX_LOGIN_ATTEMPTS = 5;
export const LOCK_DURATION_MS = 30 * 60 * 1000; // 30 minutes

export interface LockoutState {
  failedLoginAttempts: number;
  isLocked?: boolean;
  lockedUntil?: Date | null;
}

/**
 * The fields to write when the failure count crosses the threshold.
 *
 * The counting itself happens as an atomic `$inc` in the sign-in hook — a
 * read-then-write here would lose concurrent failures and quietly multiply
 * the guesses an account absorbs before locking.
 */
export function engagedLockState(
  now: number = Date.now()
): Pick<LockoutState, "isLocked" | "lockedUntil"> {
  return {
    isLocked: true,
    lockedUntil: new Date(now + LOCK_DURATION_MS),
  };
}

/** The fields to write on a successful sign-in, clearing any lock. */
export function clearedLockoutState(): LockoutState {
  return { failedLoginAttempts: 0, isLocked: false, lockedUntil: null };
}

/**
 * Whether a lock is still in force.
 *
 * A lock with no expiry is an administrator's manual block and never lifts on
 * its own; a timed lock lapses once its deadline passes.
 */
export function isLockActive(
  isLocked: boolean | undefined,
  lockedUntil: Date | string | null | undefined,
  now: number = Date.now()
): boolean {
  if (!isLocked) return false;
  if (!lockedUntil) return true;
  return new Date(lockedUntil).getTime() > now;
}
