/**
 * Whether a message goes out, in the order the rules apply: the office's
 * switches skip it quietly; the recipient, the template and the quota block
 * it on the record; a test send skips the channel and event switches and the
 * opt-out, but not the package — and on the platform's gateway it goes only
 * to the sender's own Saudi mobile, a few a day.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  decideSend,
  isOptedOut,
  isSaudiMobile,
  testRecipientAllowed,
  type SendDecisionInput,
} from "@/lib/messaging/decide";

const ready: SendDecisionInput = {
  purpose: "automation",
  moduleEnabled: true,
  channelEnabled: true,
  eventEnabled: true,
  hasGateway: true,
  optedOut: false,
  hasPhone: true,
  needsTemplate: false,
  hasTemplate: false,
  quota: null,
};

describe("decideSend", () => {
  test("everything in place: send", () => {
    assert.deepEqual(decideSend(ready), { action: "send" });
  });

  test("the office's switches skip without a record", () => {
    assert.deepEqual(decideSend({ ...ready, moduleEnabled: false }), {
      action: "skip",
      reason: "module_off",
    });
    assert.deepEqual(decideSend({ ...ready, channelEnabled: false }), {
      action: "skip",
      reason: "channel_off",
    });
    assert.deepEqual(decideSend({ ...ready, eventEnabled: false }), {
      action: "skip",
      reason: "event_off",
    });
    assert.deepEqual(decideSend({ ...ready, hasGateway: false }), {
      action: "skip",
      reason: "not_configured",
    });
  });

  test("an opted-out recipient is blocked, even when everything else is ready", () => {
    assert.deepEqual(decideSend({ ...ready, optedOut: true }), {
      action: "block",
      reason: "opted_out",
    });
  });

  test("no number, then no template, then no quota left", () => {
    assert.deepEqual(decideSend({ ...ready, hasPhone: false }), {
      action: "block",
      reason: "no_phone",
    });
    assert.deepEqual(decideSend({ ...ready, needsTemplate: true }), {
      action: "block",
      reason: "no_template",
    });
    assert.deepEqual(
      decideSend({ ...ready, needsTemplate: true, hasTemplate: true }),
      { action: "send" },
    );
    assert.deepEqual(
      decideSend({ ...ready, quota: { limit: 100, used: 100 } }),
      { action: "block", reason: "quota_exceeded" },
    );
    assert.deepEqual(decideSend({ ...ready, quota: { limit: 100, used: 99 } }), {
      action: "send",
    });
    // Unlimited, and the office's own account, are never over quota.
    assert.deepEqual(decideSend({ ...ready, quota: { limit: null, used: 10_000 } }), {
      action: "send",
    });
    assert.deepEqual(decideSend({ ...ready, quota: { limit: 0, used: 0 } }), {
      action: "block",
      reason: "quota_exceeded",
    });
  });

  test("a test send ignores the channel and event switches and the opt-out", () => {
    const test = {
      ...ready,
      purpose: "test" as const,
      testRecipientAllowed: true,
      testsToday: { used: 0, limit: 10 },
    };
    assert.deepEqual(
      decideSend({ ...test, channelEnabled: false, eventEnabled: false, optedOut: true }),
      { action: "send" },
    );
    assert.deepEqual(decideSend({ ...test, hasGateway: false }), {
      action: "skip",
      reason: "not_configured",
    });
    assert.deepEqual(decideSend({ ...test, quota: { limit: 5, used: 5 } }), {
      action: "block",
      reason: "quota_exceeded",
    });
  });

  test("a test send is not free of the package: Messaging left out sends none", () => {
    assert.deepEqual(
      decideSend({
        ...ready,
        purpose: "test",
        moduleEnabled: false,
        testRecipientAllowed: true,
        testsToday: { used: 0, limit: 10 },
      }),
      { action: "skip", reason: "module_off" },
    );
  });

  test("a test to a number the gateway may not be used for is blocked", () => {
    const test = { ...ready, purpose: "test" as const, testsToday: { used: 0, limit: 10 } };
    assert.deepEqual(decideSend({ ...test, testRecipientAllowed: false }), {
      action: "block",
      reason: "test_recipient",
    });
    // A caller that never asked gets no test either.
    assert.deepEqual(decideSend(test), { action: "block", reason: "test_recipient" });
  });

  test("the day's test sends are capped", () => {
    const test = { ...ready, purpose: "test" as const, testRecipientAllowed: true };
    assert.deepEqual(decideSend({ ...test, testsToday: { used: 9, limit: 10 } }), {
      action: "send",
    });
    assert.deepEqual(decideSend({ ...test, testsToday: { used: 10, limit: 10 } }), {
      action: "block",
      reason: "test_daily_limit",
    });
    assert.deepEqual(decideSend({ ...test, testsToday: null }), {
      action: "block",
      reason: "test_daily_limit",
    });
  });

  test("the cap and the recipient rule are a test's alone", () => {
    assert.deepEqual(decideSend({ ...ready, purpose: "manual" }), { action: "send" });
  });
});

describe("testRecipientAllowed", () => {
  const own = "+966501234567";

  test("on the office's own account, any number", () => {
    assert.equal(testRecipientAllowed({ source: "office", to: "+447700900123", ownPhone: null }), true);
  });

  test("on the platform's gateway, only the sender's own Saudi mobile", () => {
    assert.equal(testRecipientAllowed({ source: "platform", to: own, ownPhone: own }), true);
    assert.equal(testRecipientAllowed({ source: "env", to: own, ownPhone: own }), true);
    // Someone else's Saudi number.
    assert.equal(
      testRecipientAllowed({ source: "platform", to: "+966559999999", ownPhone: own }),
      false,
    );
    // A foreign (premium) number, even when it is on the sender's profile.
    const foreign = "+88216000000";
    assert.equal(testRecipientAllowed({ source: "platform", to: foreign, ownPhone: foreign }), false);
    // A Saudi landline.
    const landline = "+966112345678";
    assert.equal(
      testRecipientAllowed({ source: "platform", to: landline, ownPhone: landline }),
      false,
    );
    assert.equal(testRecipientAllowed({ source: "platform", to: own, ownPhone: null }), false);
  });

  test("isSaudiMobile", () => {
    assert.equal(isSaudiMobile("+966501234567"), true);
    assert.equal(isSaudiMobile("+96650123456"), false);
    assert.equal(isSaudiMobile("+9665012345678"), false);
    assert.equal(isSaudiMobile("0501234567"), false);
    assert.equal(isSaudiMobile(null), false);
  });
});

describe("isOptedOut", () => {
  test("only an explicit false opts out", () => {
    assert.equal(isOptedOut({ sms: false }, "sms"), true);
    assert.equal(isOptedOut({ sms: false }, "whatsapp"), false);
    assert.equal(isOptedOut({ sms: true }, "sms"), false);
    assert.equal(isOptedOut({}, "sms"), false);
    assert.equal(isOptedOut(null, "sms"), false);
    assert.equal(isOptedOut("garbage", "sms"), false);
  });
});
