/**
 * Letting a stranger write to the office: the honeypot, the validation, the
 * rate limit and the hashed source — the four things between a public form and
 * the inbox.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  HONEYPOT_FIELD,
  INQUIRY_RATE_RULES,
  checkInquiryRate,
  evaluateInquiry,
  hashSource,
  type RateCounter,
} from "@/lib/listings/inquiry-guard";

const good = {
  name: "  Sara   Al-Qahtani ",
  phone: "050 123 4567",
  email: "Sara@Example.com ",
  message: " Is the flat still free? ",
};

describe("the honeypot", () => {
  test("a filled hidden field is a bot, whatever else it sent", () => {
    assert.deepEqual(evaluateInquiry({ ...good, [HONEYPOT_FIELD]: "http://spam.example" }), {
      kind: "honeypot",
    });
  });

  test("is checked before validation, so a bot learns nothing from a refusal", () => {
    assert.deepEqual(
      evaluateInquiry({ name: "", phone: "nope", [HONEYPOT_FIELD]: "x" }),
      { kind: "honeypot" },
    );
  });

  test("an empty or whitespace-only hidden field is a person", () => {
    assert.equal(evaluateInquiry({ ...good, [HONEYPOT_FIELD]: "" }).kind, "ok");
    assert.equal(evaluateInquiry({ ...good, [HONEYPOT_FIELD]: "   " }).kind, "ok");
  });
});

describe("validation", () => {
  test("a good message is cleaned and the phone stored as E.164", () => {
    const outcome = evaluateInquiry(good);
    assert.equal(outcome.kind, "ok");
    if (outcome.kind !== "ok") return;
    assert.deepEqual(outcome.data, {
      name: "Sara Al-Qahtani",
      phone: "+966501234567",
      email: "sara@example.com",
      message: "Is the flat still free?",
    });
  });

  test("email and message are optional", () => {
    const outcome = evaluateInquiry({ name: "Omar", phone: "0501234567" });
    assert.equal(outcome.kind, "ok");
    if (outcome.kind !== "ok") return;
    assert.equal(outcome.data.email, null);
    assert.equal(outcome.data.message, null);
  });

  test("Arabic digits and the +966 and 00966 forms are one number", () => {
    for (const phone of ["٠٥٠١٢٣٤٥٦٧", "+966501234567", "00966501234567", "966501234567", "(050) 123-4567"]) {
      const outcome = evaluateInquiry({ ...good, phone });
      assert.equal(outcome.kind, "ok", phone);
      if (outcome.kind === "ok") assert.equal(outcome.data.phone, "+966501234567", phone);
    }
  });

  test("names the fields that are wrong, all at once", () => {
    const outcome = evaluateInquiry({
      name: "x",
      phone: "12345",
      email: "not-an-email",
      message: "m".repeat(1001),
    });
    assert.equal(outcome.kind, "invalid");
    if (outcome.kind !== "invalid") return;
    assert.deepEqual(outcome.errors, {
      name: "name_required",
      phone: "phone_invalid",
      email: "email_invalid",
      message: "message_too_long",
    });
  });

  test("anything that is not an object is an empty submission", () => {
    for (const body of [null, undefined, "hello", 42, [], true]) {
      const outcome = evaluateInquiry(body);
      assert.equal(outcome.kind, "invalid");
    }
  });

  test("a phone that is not text is refused, not thrown on", () => {
    const outcome = evaluateInquiry({ name: "Omar", phone: { number: 1 } });
    assert.equal(outcome.kind, "invalid");
  });
});

/** The in-memory counter the app falls back on, fixed-window like the real one. */
function memoryCounter(now: () => number): RateCounter {
  const windows = new Map<string, { count: number; resetTime: number }>();
  return async (key, windowMs, maxRequests) => {
    const current = windows.get(key);
    const entry =
      current && current.resetTime > now()
        ? current
        : { count: 0, resetTime: now() + windowMs };
    entry.count += 1;
    windows.set(key, entry);
    return { success: entry.count <= maxRequests, resetTime: entry.resetTime };
  };
}

describe("the rate limit", () => {
  const BURST = INQUIRY_RATE_RULES[0];

  test("lets a source send a few messages and then asks it to wait", async () => {
    const clock = 1_000_000;
    const counter = memoryCounter(() => clock);
    const source = hashSource("203.0.113.9", "test-secret");

    for (let n = 0; n < BURST.maxRequests; n += 1) {
      assert.deepEqual(await checkInquiryRate(counter, source, clock), { allowed: true });
    }
    const refused = await checkInquiryRate(counter, source, clock);
    assert.equal(refused.allowed, false);
    if (!refused.allowed) {
      assert.ok(refused.retryAfterSeconds >= 1);
      assert.ok(refused.retryAfterSeconds <= BURST.windowMs / 1000);
    }
  });

  test("a different source is counted on its own", async () => {
    const clock = 1_000_000;
    const counter = memoryCounter(() => clock);
    const flooder = hashSource("203.0.113.9", "test-secret");
    const neighbour = hashSource("203.0.113.10", "test-secret");
    for (let n = 0; n < BURST.maxRequests + 2; n += 1) {
      await checkInquiryRate(counter, flooder, clock);
    }
    assert.equal((await checkInquiryRate(counter, flooder, clock)).allowed, false);
    assert.equal((await checkInquiryRate(counter, neighbour, clock)).allowed, true);
  });

  test("the window reopens once it has passed", async () => {
    let clock = 1_000_000;
    const counter = memoryCounter(() => clock);
    const source = hashSource("203.0.113.9", "test-secret");
    for (let n = 0; n <= BURST.maxRequests; n += 1) {
      await checkInquiryRate(counter, source, clock);
    }
    assert.equal((await checkInquiryRate(counter, source, clock)).allowed, false);
    clock += BURST.windowMs + 1;
    assert.equal((await checkInquiryRate(counter, source, clock)).allowed, true);
  });

  test("the long window catches a slow trickle the short one lets through", async () => {
    let clock = 1_000_000;
    const counter = memoryCounter(() => clock);
    const source = hashSource("203.0.113.9", "test-secret");
    const day = INQUIRY_RATE_RULES[1];
    let allowed = 0;
    // One message every eleven minutes: never more than the burst limit in
    // ten minutes, steadily more than the day's allowance over a day.
    for (let n = 0; n < 200; n += 1) {
      clock += 11 * 60 * 1000;
      if (clock > 1_000_000 + day.windowMs) break;
      if ((await checkInquiryRate(counter, source, clock)).allowed) allowed += 1;
    }
    assert.equal(allowed, day.maxRequests);
  });

  test("a refused message does not spend the longer window's budget", async () => {
    const clock = 1_000_000;
    const seen: string[] = [];
    const counter: RateCounter = async (key, _window, _max) => {
      seen.push(key);
      return { success: !key.includes(":burst:"), resetTime: clock + 60_000 };
    };
    const decision = await checkInquiryRate(counter, "abc", clock);
    assert.equal(decision.allowed, false);
    assert.deepEqual(seen, ["listing-inquiry:burst:abc"]);
  });

  test("the retry-after is at least a second, whatever the clock says", async () => {
    const counter: RateCounter = async () => ({ success: false, resetTime: 5 });
    const decision = await checkInquiryRate(counter, "abc", 1_000_000);
    assert.equal(decision.allowed, false);
    if (!decision.allowed) assert.equal(decision.retryAfterSeconds, 1);
  });
});

describe("the source hash", () => {
  test("is stable for the same address and secret", () => {
    assert.equal(hashSource("203.0.113.9", "s"), hashSource("203.0.113.9", "s"));
    assert.equal(hashSource(" 203.0.113.9 ", "s"), hashSource("203.0.113.9", "s"));
  });

  test("differs between addresses and between secrets, and is not the address", () => {
    assert.notEqual(hashSource("203.0.113.9", "s"), hashSource("203.0.113.10", "s"));
    assert.notEqual(hashSource("203.0.113.9", "s"), hashSource("203.0.113.9", "t"));
    const hash = hashSource("203.0.113.9", "s");
    assert.match(hash, /^[0-9a-f]{32}$/);
    assert.equal(hash.includes("203"), false);
  });
});
