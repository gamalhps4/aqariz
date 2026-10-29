/**
 * PropertyPro - Which language a message is written in (the decision)
 *
 * The owner's rule: an email, an in-app notification or an SMS is written in
 * the language of the recipient's organization — its display settings'
 * language. There is no per-person language yet; when there is, it slots in
 * ahead of the organization here and every sender follows.
 *
 * This file holds only the decision and its cache, with the lookups injected,
 * so it can be tested without a database. `recipient-locale.ts` wires it to
 * the database and is what senders import.
 */

import { REGION_DISPLAY_LOCALE } from "./locale-cookie";
import { APP_CURRENCY } from "@/lib/regional/region";
import {
  directionFor,
  toAppLanguage,
  type AppLanguage,
  type TextDirection,
} from "./languages";

export interface RecipientLocale {
  language: AppLanguage;
  dir: TextDirection;
  /** ISO 4217 — the office's display currency, for amounts in the text. */
  currency: string;
  /** IANA zone — the office's, for dates near midnight. */
  timeZone: string;
}

/** Who the message is for. Every field is optional; see `resolve`. */
export interface RecipientTarget {
  /** The organization the recipient belongs to, when the caller knows it. */
  organizationId?: string | null;
  /** The recipient's user id. */
  userId?: string | null;
  /** The recipient's address — looked up when nothing better is known. */
  email?: string | null;
}

/** An organization's display settings, as far as messages care. */
export interface OrgDisplayRow {
  language?: string | null;
  currency?: string | null;
  timezone?: string | null;
}

export interface RecipientLocaleLookups {
  /** The organization bound to the current request or sweep, if any. */
  contextOrganizationId: () => string | null | undefined;
  /** The organization a user belongs to. */
  organizationOfUser: (userId: string) => Promise<string | null>;
  /** The organization of the user with this address. */
  organizationOfEmail: (email: string) => Promise<string | null>;
  /** The organization's display settings (its branding owner's row). */
  displayRowOf: (organizationId: string) => Promise<OrgDisplayRow | null>;
  /** The deployment's defaults. */
  fallback: RecipientLocale;
  /** Milliseconds a resolved organization is remembered. */
  ttlMs?: number;
  now?: () => number;
}

/** The market's defaults: Arabic, right to left, riyals, Riyadh time. */
export function regionRecipientLocale(timeZone: string): RecipientLocale {
  return {
    language: REGION_DISPLAY_LOCALE.language,
    dir: REGION_DISPLAY_LOCALE.dir,
    currency: REGION_DISPLAY_LOCALE.currency,
    timeZone,
  };
}

/** A display row read as a recipient locale, the gaps filled from `fallback`. */
export function localeFromDisplayRow(
  row: OrgDisplayRow | null | undefined,
  fallback: RecipientLocale,
): RecipientLocale {
  const language = toAppLanguage(row?.language, fallback.language);
  return {
    language,
    // Messages follow the language: an English email is never mirrored, and an
    // Arabic one always is, whatever the screen's own right-to-left switch says.
    dir: directionFor(language),
    // Riyal whatever the row holds (lib/regional/region): an office that
    // once picked dollars must not be sent amounts in them.
    currency: APP_CURRENCY,
    timeZone: row?.timezone?.trim() || fallback.timeZone,
  };
}

/**
 * A resolver with its own cache. One sweep sends hundreds of reminders for
 * the same office, so each organization is looked up once per `ttlMs`
 * (a minute by default — a language changed in the settings reaches the
 * next message within that).
 */
export function createRecipientLocaleResolver(lookups: RecipientLocaleLookups) {
  const ttl = lookups.ttlMs ?? 60_000;
  const now = lookups.now ?? Date.now;
  const cache = new Map<string, { value: RecipientLocale; at: number }>();

  async function forOrganization(organizationId: string): Promise<RecipientLocale> {
    const hit = cache.get(organizationId);
    if (hit && now() - hit.at < ttl) return hit.value;
    const value = localeFromDisplayRow(
      await lookups.displayRowOf(organizationId),
      lookups.fallback,
    );
    cache.set(organizationId, { value, at: now() });
    return value;
  }

  /**
   * The recipient's locale. The organization is taken from, in order: the
   * caller (`organizationId`), the recipient's user record (`userId`), the
   * request or sweep being served, the user with the recipient's address
   * (`email`). With none — a platform-level sender writing to someone outside
   * any organization — the market's defaults. A lookup that fails also falls
   * back: a message in the default language beats no message.
   */
  async function resolve(target: RecipientTarget = {}): Promise<RecipientLocale> {
    try {
      let organizationId = target.organizationId?.trim() || null;
      if (!organizationId && target.userId) {
        organizationId = await lookups.organizationOfUser(target.userId);
      }
      if (!organizationId) {
        organizationId = lookups.contextOrganizationId() ?? null;
      }
      if (!organizationId && target.email) {
        organizationId = await lookups.organizationOfEmail(
          target.email.trim().toLowerCase(),
        );
      }
      if (!organizationId) return lookups.fallback;
      return await forOrganization(organizationId);
    } catch {
      return lookups.fallback;
    }
  }

  function forget(organizationId?: string): void {
    if (organizationId) cache.delete(organizationId);
    else cache.clear();
  }

  return { resolve, forget };
}
