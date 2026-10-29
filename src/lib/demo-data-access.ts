/**
 * PropertyPro - When the demo-data tooling may run
 *
 * /api/demo-data and /api/seed/* fill an organization with sample records and
 * empty it again. A demo database needs that; a live office never does.
 * "Clear" destroys every message, payment, invoice, lease, tenant, unit,
 * building and user the organization holds, archived rows included, and the
 * seeders write invoices and maintenance requests nobody raised. All of it
 * was open to anyone holding `system_settings` — every Administrator — on
 * every deployment, with no screen in front of it, and under /api/v1 too
 * (next.config.ts rewrites it onto /api).
 *
 * Two rules, kept here so the routes cannot each grow their own:
 *
 *   1. In production the whole tool is off, unless the deployment turns it on
 *      with ALLOW_PRODUCTION_DEMO_DATA_API=true — a demo instance that runs a
 *      production build.
 *   2. Destroying records also asks what the archive asks before it destroys
 *      one: the account owner or a platform super admin, holding
 *      `permanent_delete` (lib/archive-access.ts).
 */

import type { AuthenticatedAccessUser } from "@/lib/api-utils";
import { canPermanentlyDelete } from "@/lib/archive-access";

/** The variable a deployment sets to keep the tool on in production. */
export const DEMO_DATA_API_FLAG = "ALLOW_PRODUCTION_DEMO_DATA_API";

/** The two variables the decision reads — passed in by the tests. */
export interface DemoDataEnv {
  NODE_ENV?: string;
  ALLOW_PRODUCTION_DEMO_DATA_API?: string;
}

/** A refusal to send back as-is, with the HTTP status it maps to. */
export interface DemoDataRefusal {
  status: number;
  message: string;
}

export const DEMO_DATA_DISABLED_MESSAGE =
  "The demo-data tools are switched off on this deployment: they install sample records and permanently delete an organization's data. " +
  `In production they run only when ${DEMO_DATA_API_FLAG}=true is set.`;

export const DEMO_DATA_PURGE_DENIED_MESSAGE =
  "Only the account owner or a platform super admin, holding the permanent-delete permission, can permanently delete an organization's data.";

function runtimeEnv(): DemoDataEnv {
  return {
    NODE_ENV: process.env.NODE_ENV,
    ALLOW_PRODUCTION_DEMO_DATA_API: process.env.ALLOW_PRODUCTION_DEMO_DATA_API,
  };
}

/**
 * Whether the tool is switched on at all.
 *
 * Anything that is not a development or test run counts as production: an
 * unset or unfamiliar NODE_ENV must not be what turns a destructive tool on.
 * The flag has to read exactly "true", as ALLOW_PRODUCTION_DEMO_RESET does for
 * `pnpm db:reset`.
 */
export function demoDataApiEnabled(env: DemoDataEnv = runtimeEnv()): boolean {
  if (env.NODE_ENV === "development" || env.NODE_ENV === "test") return true;
  return env.ALLOW_PRODUCTION_DEMO_DATA_API === "true";
}

/** Why a handler that installs sample records must not run, or null. */
export function demoDataWriteRefusal(
  env: DemoDataEnv = runtimeEnv(),
): DemoDataRefusal | null {
  return demoDataApiEnabled(env)
    ? null
    : { status: 403, message: DEMO_DATA_DISABLED_MESSAGE };
}

/**
 * Why a handler that destroys records must not run, or null.
 *
 * The switch is asked first, so on a live deployment even the account owner
 * is told the tool is off rather than being let through.
 */
export function demoDataPurgeRefusal(
  user: Pick<
    AuthenticatedAccessUser,
    "isPlatformAdmin" | "isOrganizationOwner" | "permissions"
  >,
  env: DemoDataEnv = runtimeEnv(),
): DemoDataRefusal | null {
  const disabled = demoDataWriteRefusal(env);
  if (disabled) return disabled;
  return canPermanentlyDelete(user)
    ? null
    : { status: 403, message: DEMO_DATA_PURGE_DENIED_MESSAGE };
}

export const DEMO_DATA_SCOPED_MESSAGE =
  "The demo-data tools report on the whole organization, and you are limited to some buildings.";

/**
 * Why a handler that reports on the tool's data must not run, or null.
 *
 * The status reads were left out of both rules above, so on a live
 * deployment anyone holding `system_settings` could still read them — and
 * they sent sample rows whole: a tenant record with its national id and
 * date of birth. The switch now covers them as it covers the writes, and
 * since they count across the whole organization, a caller limited to some
 * buildings is refused rather than shown totals beyond them.
 */
export function demoDataReadRefusal(
  user: { scopedPropertyIds?: readonly string[] },
  env: DemoDataEnv = runtimeEnv(),
): DemoDataRefusal | null {
  const disabled = demoDataWriteRefusal(env);
  if (disabled) return disabled;
  return user.scopedPropertyIds === undefined
    ? null
    : { status: 403, message: DEMO_DATA_SCOPED_MESSAGE };
}
