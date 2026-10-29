/**
 * The provider requests, against a mocked `fetch`: each provider gets the URL,
 * headers and body its API documents, a rejection comes back as `ok: false`
 * with a reason (never a throw), and numbers reach every provider in E.164 or
 * the bare digits it wants.
 */

import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  deliverMessage,
  metaTemplatePayload,
  toE164,
  type SendGateway,
} from "@/lib/messaging/providers";

interface Call {
  url: string;
  init: RequestInit;
}

const realFetch = globalThis.fetch;
let calls: Call[] = [];
let reply: { status: number; body: unknown } = { status: 200, body: {} };

beforeEach(() => {
  calls = [];
  reply = { status: 200, body: {} };
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const text =
      typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body);
    return new Response(text, { status: reply.status });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const silence = () => {
  const original = console.error;
  console.error = () => {};
  return () => {
    console.error = original;
  };
};

function gateway(
  channel: SendGateway["channel"],
  provider: SendGateway["provider"],
  credentials: Record<string, string>,
): SendGateway {
  return { channel, provider, credentials };
}

describe("toE164", () => {
  test("a Saudi local number takes the country code", () => {
    assert.equal(toE164("0501234567", "966"), "+966501234567");
    assert.equal(toE164("050 123 4567", "966"), "+966501234567");
  });

  test("a number with its country code is not given a second one", () => {
    assert.equal(toE164("966501234567", "966"), "+966501234567");
    assert.equal(toE164("9660501234567", "966"), "+966501234567");
    assert.equal(toE164("00966501234567", "966"), "+966501234567");
    assert.equal(toE164("+966 50 123 4567", "966"), "+966501234567");
  });

  test("nothing usable is null", () => {
    assert.equal(toE164("", "966"), null);
    assert.equal(toE164(null, "966"), null);
    assert.equal(toE164("abc", "966"), null);
    assert.equal(toE164("0501234567", ""), null);
  });
});

describe("SMS providers", () => {
  test("Unifonic: one form POST with the AppSid, a bare number and the sender", async () => {
    reply = { status: 200, body: { success: true, data: { MessageID: 4711 } } };
    const result = await deliverMessage(
      gateway("sms", "unifonic", { appSid: "APP", senderId: "OFFICE" }),
      { to: "+966501234567", body: "مرحبا" },
    );
    assert.deepEqual(result, { ok: true, reference: "4711" });
    const form = new URLSearchParams(String(calls[0].init.body));
    assert.equal(calls[0].url, "https://el.cloud.unifonic.com/rest/SMS/messages");
    assert.equal(form.get("AppSid"), "APP");
    assert.equal(form.get("Recipient"), "966501234567");
    assert.equal(form.get("Body"), "مرحبا");
    assert.equal(form.get("SenderID"), "OFFICE");
  });

  test("Unifonic: a 200 that says success:false is a failure", async () => {
    const restore = silence();
    reply = { status: 200, body: { success: false, message: "Invalid sender" } };
    const result = await deliverMessage(
      gateway("sms", "unifonic", { appSid: "APP" }),
      { to: "+966501234567", body: "x" },
    );
    restore();
    assert.equal(result.ok, false);
    assert.equal(result.error, "Invalid sender");
  });

  test("Taqnyat: bearer token and a JSON body; the 201's message id is kept", async () => {
    reply = { status: 201, body: { statusCode: 201, messageId: 99 } };
    const result = await deliverMessage(
      gateway("sms", "taqnyat", { apiToken: "TOKEN", senderId: "OFFICE" }),
      { to: "+966501234567", body: "Hello" },
    );
    assert.deepEqual(result, { ok: true, reference: "99" });
    assert.equal(calls[0].url, "https://api.taqnyat.sa/v1/messages");
    const headers = calls[0].init.headers as Record<string, string>;
    assert.equal(headers.Authorization, "Bearer TOKEN");
    assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
      recipients: ["966501234567"],
      body: "Hello",
      sender: "OFFICE",
    });
  });

  test("Taqnyat: an error status carries the provider's message", async () => {
    const restore = silence();
    reply = { status: 401, body: { statusCode: 401, message: "Unauthorized" } };
    const result = await deliverMessage(
      gateway("sms", "taqnyat", { apiToken: "BAD", senderId: "OFFICE" }),
      { to: "+966501234567", body: "Hello" },
    );
    restore();
    assert.deepEqual(result, { ok: false, error: "Unauthorized" });
  });

  test("Msegat: code 1 or M0000 is success, anything else a failure", async () => {
    const credentials = { userName: "u", apiKey: "k", senderId: "OFFICE" };
    reply = { status: 200, body: { code: "1", message: "Success" } };
    const ok = await deliverMessage(gateway("sms", "msegat", credentials), {
      to: "+966501234567",
      body: "Hi",
    });
    assert.equal(ok.ok, true);
    const sent = JSON.parse(String(calls[0].init.body));
    assert.equal(calls[0].url, "https://www.msegat.com/gw/sendsms.php");
    assert.equal(sent.numbers, "966501234567");
    assert.equal(sent.userSender, "OFFICE");
    assert.equal(sent.msgEncoding, "UTF8");

    reply = { status: 200, body: { code: "M0000", message: "Success" } };
    assert.equal(
      (await deliverMessage(gateway("sms", "msegat", credentials), { to: "+966501234567", body: "Hi" })).ok,
      true,
    );

    const restore = silence();
    reply = { status: 200, body: { code: "M0002", message: "Invalid login info" } };
    const bad = await deliverMessage(gateway("sms", "msegat", credentials), {
      to: "+966501234567",
      body: "Hi",
    });
    restore();
    assert.deepEqual(bad, { ok: false, error: "M0002 Invalid login info" });
  });

  test("Twilio SMS: basic auth, From number and the status callback", async () => {
    reply = { status: 201, body: { sid: "SM123" } };
    const result = await deliverMessage(
      gateway("sms", "twilio", {
        accountSid: "AC1",
        authToken: "secret",
        senderId: "+15551234567",
      }),
      {
        to: "+966501234567",
        body: "Hi",
        statusCallbackUrl: "https://app.example.com/api/messaging/webhook/twilio/demo",
      },
    );
    assert.deepEqual(result, { ok: true, reference: "SM123" });
    assert.equal(
      calls[0].url,
      "https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json",
    );
    const headers = calls[0].init.headers as Record<string, string>;
    assert.equal(
      headers.Authorization,
      `Basic ${Buffer.from("AC1:secret").toString("base64")}`,
    );
    const form = new URLSearchParams(String(calls[0].init.body));
    assert.equal(form.get("To"), "+966501234567");
    assert.equal(form.get("From"), "+15551234567");
    assert.equal(
      form.get("StatusCallback"),
      "https://app.example.com/api/messaging/webhook/twilio/demo",
    );
  });

  test("Twilio: a Messaging Service sender is sent as MessagingServiceSid", async () => {
    reply = { status: 201, body: { sid: "SM9" } };
    const service = `MG${"a".repeat(32)}`;
    await deliverMessage(
      gateway("sms", "twilio", { accountSid: "AC1", authToken: "t", senderId: service }),
      { to: "+966501234567", body: "Hi" },
    );
    const form = new URLSearchParams(String(calls[0].init.body));
    assert.equal(form.get("MessagingServiceSid"), service);
    assert.equal(form.get("From"), null);
  });
});

describe("WhatsApp providers", () => {
  test("Meta: a template goes by name and language with named parameters", async () => {
    reply = { status: 200, body: { messages: [{ id: "wamid.1" }] } };
    const result = await deliverMessage(
      gateway("whatsapp", "meta", { phoneNumberId: "123", accessToken: "TOKEN" }),
      {
        to: "+966501234567",
        body: "fallback text",
        template: {
          name: "rent_reminder_ar",
          language: "ar",
          params: { recipient_name: "سارة", amount: "1,500.00 ر.س" },
        },
      },
    );
    assert.deepEqual(result, { ok: true, reference: "wamid.1" });
    assert.match(calls[0].url, /^https:\/\/graph\.facebook\.com\/v\d+\.\d+\/123\/messages$/);
    const headers = calls[0].init.headers as Record<string, string>;
    assert.equal(headers.Authorization, "Bearer TOKEN");
    assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
      messaging_product: "whatsapp",
      to: "966501234567",
      type: "template",
      template: {
        name: "rent_reminder_ar",
        language: { code: "ar" },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", parameter_name: "recipient_name", text: "سارة" },
              { type: "text", parameter_name: "amount", text: "1,500.00 ر.س" },
            ],
          },
        ],
      },
    });
  });

  test("Meta: no template means a text message", async () => {
    reply = { status: 200, body: { messages: [{ id: "wamid.2" }] } };
    await deliverMessage(
      gateway("whatsapp", "meta", { phoneNumberId: "123", accessToken: "T" }),
      { to: "+966501234567", body: "Hello" },
    );
    const sent = JSON.parse(String(calls[0].init.body));
    assert.equal(sent.type, "text");
    assert.deepEqual(sent.text, { preview_url: false, body: "Hello" });
  });

  test("Meta: an empty parameter is sent as a dash (Meta refuses empty ones)", () => {
    const payload = metaTemplatePayload("+966501234567", {
      name: "t",
      language: "en",
      params: { property_name: "  " },
    }) as { template: { components: Array<{ parameters: Array<{ text: string }> }> } };
    assert.equal(payload.template.components[0].parameters[0].text, "-");
  });

  test("Meta: an error carries the Graph code and message", async () => {
    const restore = silence();
    reply = {
      status: 400,
      body: { error: { code: 132001, message: "Template name does not exist" } },
    };
    const result = await deliverMessage(
      gateway("whatsapp", "meta", { phoneNumberId: "123", accessToken: "T" }),
      { to: "+966501234567", body: "x", template: { name: "nope", language: "ar", params: {} } },
    );
    restore();
    assert.deepEqual(result, {
      ok: false,
      error: "132001 Template name does not exist",
    });
  });

  test("Twilio WhatsApp: both numbers carry the whatsapp: scheme", async () => {
    reply = { status: 201, body: { sid: "SM5" } };
    await deliverMessage(
      gateway("whatsapp", "twilio", {
        accountSid: "AC1",
        authToken: "t",
        senderId: "+15551234567",
      }),
      { to: "+966501234567", body: "Hi" },
    );
    const form = new URLSearchParams(String(calls[0].init.body));
    assert.equal(form.get("To"), "whatsapp:+966501234567");
    assert.equal(form.get("From"), "whatsapp:+15551234567");
  });
});

describe("never throws", () => {
  test("a network failure is a failed result", async () => {
    const restore = silence();
    globalThis.fetch = (async () => {
      throw new Error("ECONNRESET");
    }) as typeof fetch;
    const result = await deliverMessage(
      gateway("sms", "taqnyat", { apiToken: "T", senderId: "S" }),
      { to: "+966501234567", body: "x" },
    );
    restore();
    assert.deepEqual(result, { ok: false, error: "ECONNRESET" });
  });

  test("an unknown provider and an empty body are refused without a request", async () => {
    const unknown = await deliverMessage(
      gateway("whatsapp", "unifonic", { appSid: "x" }),
      { to: "+966501234567", body: "x" },
    );
    assert.equal(unknown.ok, false);
    const empty = await deliverMessage(
      gateway("sms", "unifonic", { appSid: "x" }),
      { to: "+966501234567", body: "  " },
    );
    assert.deepEqual(empty, { ok: false, error: "Empty message body" });
    assert.equal(calls.length, 0);
  });
});
