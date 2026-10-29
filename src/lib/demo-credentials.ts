/**
 * PropertyPro - The accounts the sign-in page offers
 *
 * One list, read by both the page that advertises these logins and the seed
 * that creates them. They used to be written out separately, and the platform
 * super-admin drifted: the page offered `superadmin@gmail.com`, but nothing
 * in any seed created it — it was bootstrapped once by hand with
 * `create:super-admin`, and `db:reset` truncates every table, so the first
 * reset after that quietly removed the only account the page promised would
 * work.
 *
 * Keep them here. A credential advertised on a screen and a credential
 * created by a script are the same fact, and two copies of a fact is how one
 * of them ends up wrong.
 *
 * Nothing is exposed by this file that the page did not already ship to the
 * browser: these are demo logins, printed on the sign-in screen on purpose.
 */

export interface DemoLogin {
  /** Short label in the credentials panel. */
  label: string;
  email: string;
  password: string;
  /**
   * True for the platform operator, who belongs to no organization and so is
   * created outside the demo organization the rest of the seed builds.
   */
  isPlatformAdmin?: boolean;
  firstName?: string;
  lastName?: string;
}

export const DEMO_LOGINS: readonly DemoLogin[] = [
  {
    label: "Super Admin",
    email: "superadmin@gmail.com",
    password: "Super123$",
    isPlatformAdmin: true,
    firstName: "Platform",
    lastName: "Admin",
  },
  { label: "Admin", email: "admin@propertypro.com", password: "Admin123$" },
  { label: "Manager", email: "manager@propertypro.com", password: "Manager123$" },
  { label: "Tenant", email: "tenant@propertypro.com", password: "Tenant123$" },
];

/** The platform operator's demo login. */
export const DEMO_PLATFORM_ADMIN: DemoLogin = DEMO_LOGINS.find(
  (login) => login.isPlatformAdmin,
)!;
