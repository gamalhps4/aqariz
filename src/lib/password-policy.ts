/**
 * The password policy, in one place.
 *
 * Better Auth enforces its own `minPasswordLength` on the endpoints it owns,
 * but the app's reset, invitation and admin-set flows write through
 * `setUserPassword` and never touch those endpoints — so a limit configured
 * only in `better-auth.ts` would be decorative on exactly the paths most
 * passwords are set through. Every one of them reads the constants below.
 *
 * Deliberately free of `server-only` and of any import: validation schemas and
 * unit tests pull this in, and both run outside the Next.js server bundle.
 */

/**
 * Eight, which is what the dashboard's own create-user and create-tenant forms
 * have always asked for and what the welcome email promises. A higher number
 * here would only be enforced on the paths that route through this module,
 * leaving those two forms accepting passwords the API then rejects.
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export class WeakPasswordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WeakPasswordError";
  }
}

/** Returns an error message, or null when the password is acceptable. */
export function validatePasswordStrength(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters long`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Password cannot exceed ${PASSWORD_MAX_LENGTH} characters`;
  }
  return null;
}
