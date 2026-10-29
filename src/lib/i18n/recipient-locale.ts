import "server-only";

/**
 * PropertyPro - Which language a message is written in
 *
 * Every email, in-app notification and SMS is written in the language of the
 * recipient's organization (its display settings), with dates in the office's
 * time zone and amounts in its currency. Senders ask here, then write their
 * text through the shared catalogue:
 *
 *   import { recipientLocale } from "@/lib/i18n/recipient-locale";
 *   import { translateFor, formatDateFor } from "@/lib/i18n/translate";
 *
 *   const locale = await recipientLocale({ userId: tenant.id });
 *   const body = translateFor(locale, "notifications.sms.leaseExpiry", {
 *     appName, days,
 *   });
 *
 * Text keys live in `src/locales/<language>/common.json` under
 * `notifications.email.*`, `notifications.message.*` and `notifications.sms.*`.
 * Add a key to all five languages (Arabic and English written, the others may
 * repeat the English) so `pnpm verify:i18n` stays green.
 *
 * Works in a route (the request's organization), in a cron sweep
 * (`forEachOrganization` binds each office in turn) and with no organization
 * at all (pass `organizationId`, `userId` or `email`). Results are cached per
 * organization for a minute.
 */

import { db } from "@/lib/db/prisma";
import {
  bypassOrgScope,
  getOrgContext,
  runWithOrgContext,
} from "@/lib/tenancy/context";
import { resolveGlobalDisplayOwnerId } from "@/lib/utils/global-display-owner";
import { DEFAULT_TIMEZONE } from "@/lib/regional/region";
import {
  createRecipientLocaleResolver,
  regionRecipientLocale,
  type RecipientLocale,
  type RecipientTarget,
} from "./recipient-locale-core";

export type { RecipientLocale, RecipientTarget } from "./recipient-locale-core";

const resolver = createRecipientLocaleResolver({
  contextOrganizationId: () => getOrgContext()?.organizationId ?? null,

  organizationOfUser: async (userId) => {
    const user = await bypassOrgScope(() =>
      db.user.findFirst({
        where: { id: userId },
        select: { organizationId: true },
      }),
    );
    return user?.organizationId ?? null;
  },

  organizationOfEmail: async (email) => {
    const user = await bypassOrgScope(() =>
      db.user.findFirst({
        where: { email: { equals: email, mode: "insensitive" } },
        select: { organizationId: true },
      }),
    );
    return user?.organizationId ?? null;
  },

  // The organization-wide row is its branding owner's — the same row every
  // screen and document reads (see utils/global-display-owner.ts).
  displayRowOf: (organizationId) =>
    runWithOrgContext({ organizationId, isPlatformAdmin: false }, async () => {
      const ownerId = await resolveGlobalDisplayOwnerId();
      if (!ownerId) return null;
      return db.displaySettings.findFirst({
        where: { userId: ownerId, isActive: true },
        select: { language: true, currency: true, timezone: true },
      });
    }),

  fallback: regionRecipientLocale(DEFAULT_TIMEZONE),
});

/** The language, direction, currency and time zone to write to `target` in. */
export function recipientLocale(
  target?: RecipientTarget,
): Promise<RecipientLocale> {
  return resolver.resolve(target);
}

/**
 * Drop a remembered organization (after its display settings change), or all
 * of them. Without this a change reaches messages within a minute anyway.
 */
export function forgetRecipientLocale(organizationId?: string): void {
  resolver.forget(organizationId);
}
