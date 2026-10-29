/**
 * Delivery reports: a report is believed only with the provider's valid
 * signature, its status maps onto the log's, and a late report never moves a
 * message backwards.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import {
  metaHandshake,
  parseMetaStatuses,
  parseTwilioStatus,
  twilioSignature,
  verifyMetaSignature,
  verifyTwilioSignature,
} from "@/lib/messaging/webhooks";
import { statusAdvances } from "@/lib/messaging/registry";

describe("Twilio", () => {
  // Twilio's documented example: the signature of this URL and parameters
  // with this auth token.
  const authToken = "12345";
  const url = "https://example.com/myapp.php?foo=1&bar=2";
  const params = {
    CallSid: "CA1234567890ABCDE",
    Caller: "+14158675310",
    Digits: "1234",
    From: "+14158675310",
    To: "+18005551212",
  };

  test("the signature matches Twilio's documented example", () => {
    assert.equal(
      twilioSignature(authToken, url, params),
      "L/OH5YylLD5NRKLltdqwSvS0BnU=",
    );
    assert.equal(
      verifyTwilioSignature(authToken, url, params, "L/OH5YylLD5NRKLltdqwSvS0BnU="),
      true,
    );
  });

  test("a wrong token, URL, parameter or missing header is refused", () => {
    const good = twilioSignature(authToken, url, params);
    assert.equal(verifyTwilioSignature("other", url, params, good), false);
    assert.equal(verifyTwilioSignature(authToken, `${url}&x=1`, params, good), false);
    assert.equal(
      verifyTwilioSignature(authToken, url, { ...params, Digits: "9" }, good),
      false,
    );
    assert.equal(verifyTwilioSignature(authToken, url, params, null), false);
    assert.equal(verifyTwilioSignature("", url, params, good), false);
  });

  test("status callbacks map onto the log's statuses", () => {
    assert.deepEqual(
      parseTwilioStatus({ MessageSid: "SM1", MessageStatus: "delivered" }),
      { reference: "SM1", status: "delivered" },
    );
    assert.deepEqual(
      parseTwilioStatus({
        MessageSid: "SM2",
        MessageStatus: "undelivered",
        ErrorCode: "30003",
      }),
      { reference: "SM2", status: "undelivered", error: "30003" },
    );
    // In-between states change nothing.
    assert.equal(parseTwilioStatus({ MessageSid: "SM3", MessageStatus: "queued" }), null);
    assert.equal(parseTwilioStatus({ MessageStatus: "sent" }), null);
  });
});

describe("Meta", () => {
  const secret = "app-secret";
  const body = JSON.stringify({ object: "whatsapp_business_account" });
  const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

  test("X-Hub-Signature-256 is checked against the app secret", () => {
    assert.equal(verifyMetaSignature(secret, body, signature), true);
    assert.equal(verifyMetaSignature("other", body, signature), false);
    assert.equal(verifyMetaSignature(secret, `${body} `, signature), false);
    assert.equal(verifyMetaSignature(secret, body, null), false);
    assert.equal(verifyMetaSignature("", body, signature), false);
  });

  test("the handshake echoes the challenge only for the right token", () => {
    const params = new URLSearchParams({
      "hub.mode": "subscribe",
      "hub.verify_token": "tok",
      "hub.challenge": "42",
    });
    assert.equal(metaHandshake(params, "tok"), "42");
    assert.equal(metaHandshake(params, "other"), null);
    assert.equal(metaHandshake(params, ""), null);
    params.set("hub.mode", "unsubscribe");
    assert.equal(metaHandshake(params, "tok"), null);
  });

  test("statuses are read from every entry; incoming messages are ignored", () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                statuses: [
                  { id: "wamid.A", status: "delivered" },
                  {
                    id: "wamid.B",
                    status: "failed",
                    errors: [{ code: 131047, title: "Re-engagement message" }],
                  },
                  { id: "wamid.C", status: "deleted" },
                ],
                messages: [{ id: "wamid.in", text: { body: "hi" } }],
              },
            },
          ],
        },
      ],
    };
    assert.deepEqual(parseMetaStatuses(payload), [
      { reference: "wamid.A", status: "delivered" },
      { reference: "wamid.B", status: "failed", error: "131047 Re-engagement message" },
    ]);
    assert.deepEqual(parseMetaStatuses({}), []);
    assert.deepEqual(parseMetaStatuses(null), []);
  });
});

describe("a report only moves a message forward", () => {
  test("sent → delivered → read, and sent → failed", () => {
    assert.equal(statusAdvances("sent", "delivered"), true);
    assert.equal(statusAdvances("delivered", "read"), true);
    assert.equal(statusAdvances("sent", "failed"), true);
  });

  test("a late report changes nothing, and a blocked message stays blocked", () => {
    assert.equal(statusAdvances("read", "delivered"), false);
    assert.equal(statusAdvances("delivered", "sent"), false);
    assert.equal(statusAdvances("delivered", "delivered"), false);
    assert.equal(statusAdvances("blocked", "delivered"), false);
  });
});
