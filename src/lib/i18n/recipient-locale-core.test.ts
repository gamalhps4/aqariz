/**
 * Which language an email, notification or SMS is written in.
 *
 * The owner's rule is the recipient's organization's display language. The
 * resolver finds the organization from the caller, the recipient's account,
 * the request or sweep being served, or the recipient's address — in that
 * order — and remembers each organization for a minute, because one cron
 * sweep sends hundreds of reminders for the same office.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  createRecipientLocaleResolver,
  localeFromDisplayRow,
  regionRecipientLocale,
  type OrgDisplayRow,
} from "@/lib/i18n/recipient-locale-core";

const FALLBACK = regionRecipientLocale("Asia/Riyadh");

function setup(options: {
  context?: string | null;
  users?: Record<string, string | null>;
  emails?: Record<string, string | null>;
  rows?: Record<string, OrgDisplayRow | null>;
  failRows?: boolean;
}) {
  let clock = 0;
  const calls = { rows: 0, users: 0, emails: 0 };
  const resolver = createRecipientLocaleResolver({
    contextOrganizationId: () => options.context ?? null,
    organizationOfUser: async (id) => {
      calls.users += 1;
      return options.users?.[id] ?? null;
    },
    organizationOfEmail: async (email) => {
      calls.emails += 1;
      return options.emails?.[email] ?? null;
    },
    displayRowOf: async (org) => {
      calls.rows += 1;
      if (options.failRows) throw new Error("database down");
      return options.rows?.[org] ?? null;
    },
    fallback: FALLBACK,
    ttlMs: 60_000,
    now: () => clock,
  });
  return {
    resolver,
    calls,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe("recipient locale", () => {
  test("an Arabic office's recipient reads Arabic, right to left, in riyals", async () => {
    const { resolver } = setup({
      context: "org-sa",
      rows: { "org-sa": { language: "ar", currency: "SAR", timezone: "Asia/Riyadh" } },
    });
    assert.deepEqual(await resolver.resolve(), {
      language: "ar",
      dir: "rtl",
      currency: "SAR",
      timeZone: "Asia/Riyadh",
    });
  });

  test("an English office keeps its English and zone, in riyal", async () => {
    const { resolver } = setup({
      context: "org-us",
      rows: { "org-us": { language: "en", currency: "USD", timezone: "America/New_York" } },
    });
    assert.deepEqual(await resolver.resolve(), {
      language: "en",
      dir: "ltr",
      // A stored "USD" from before the app went riyal-only reads as SAR.
      currency: "SAR",
      timeZone: "America/New_York",
    });
  });

  test("the caller's organization wins over the request's", async () => {
    const { resolver, calls } = setup({
      context: "org-us",
      rows: { "org-us": { language: "en" }, "org-sa": { language: "ar" } },
    });
    const locale = await resolver.resolve({ organizationId: "org-sa", userId: "u1" });
    assert.equal(locale.language, "ar");
    assert.equal(calls.users, 0, "no user lookup when the organization is given");
  });

  test("a user's own organization wins over the request's", async () => {
    const { resolver } = setup({
      context: "org-us",
      users: { tenant: "org-sa" },
      rows: { "org-us": { language: "en" }, "org-sa": { language: "ar" } },
    });
    assert.equal((await resolver.resolve({ userId: "tenant" })).language, "ar");
  });

  test("the address is looked up only when nothing else is known", async () => {
    const withContext = setup({
      context: "org-us",
      emails: { "a@b.co": "org-sa" },
      rows: { "org-us": { language: "en" }, "org-sa": { language: "ar" } },
    });
    assert.equal((await withContext.resolver.resolve({ email: "a@b.co" })).language, "en");
    assert.equal(withContext.calls.emails, 0);

    const noContext = setup({
      emails: { "a@b.co": "org-sa" },
      rows: { "org-sa": { language: "ar" } },
    });
    assert.equal(
      (await noContext.resolver.resolve({ email: "  A@B.co " })).language,
      "ar",
      "addresses are compared trimmed and lower-cased",
    );
  });

  test("no organization at all: the market's defaults", async () => {
    const { resolver } = setup({});
    assert.deepEqual(await resolver.resolve({ email: "nobody@example.com" }), FALLBACK);
  });

  test("a failing lookup still yields a language rather than no message", async () => {
    const { resolver } = setup({ context: "org-sa", failRows: true });
    assert.deepEqual(await resolver.resolve(), FALLBACK);
  });

  test("each organization is read once a minute", async () => {
    const { resolver, calls, advance } = setup({
      context: "org-sa",
      rows: { "org-sa": { language: "ar" } },
    });
    for (let i = 0; i < 200; i += 1) await resolver.resolve();
    assert.equal(calls.rows, 1);
    advance(61_000);
    await resolver.resolve();
    assert.equal(calls.rows, 2);
    resolver.forget("org-sa");
    await resolver.resolve();
    assert.equal(calls.rows, 3);
  });

  test("a display row with gaps borrows them from the defaults", () => {
    assert.deepEqual(localeFromDisplayRow({ language: "en-GB", currency: "eur" }, FALLBACK), {
      language: "en",
      dir: "ltr",
      currency: "SAR",
      timeZone: "Asia/Riyadh",
    });
    assert.deepEqual(localeFromDisplayRow({ language: "klingon" }, FALLBACK), FALLBACK);
    // Removed 2026-10-16: an office still storing French reads as the default.
    assert.deepEqual(localeFromDisplayRow({ language: "fr-FR" }, FALLBACK), FALLBACK);
  });
});
