/**
 * The messaging settings rules: what a browser may see of a gateway, how a
 * form submission changes one, and which gateway a message goes through —
 * the office's own account, else the Super Admin's default, else the
 * environment's.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  applyGatewayPatch,
  envGateway,
  gatewayMissing,
  gatewayView,
  normalizeOfficeSettings,
  normalizePlatformSettings,
  normalizeTemplates,
  pickTemplate,
  resolveGateway,
} from "@/lib/messaging/config";

const encrypt = (value: string) => `enc(${value})`;
const decrypt = (value: string) =>
  value.startsWith("enc(") ? value.slice(4, -1) : value;
const token = () => "generated-token";

describe("normalising what is stored", () => {
  test("nothing stored is everything off, every event switch on", () => {
    const office = normalizeOfficeSettings(undefined);
    assert.equal(office.sms.enabled, false);
    assert.equal(office.sms.useOwnGateway, false);
    assert.equal(office.sms.provider, "unifonic");
    assert.equal(office.whatsapp.provider, "meta");
    assert.deepEqual(office.events.payment_overdue, { sms: true, whatsapp: true });
  });

  test("a provider of the wrong channel falls back to the channel's default", () => {
    const office = normalizeOfficeSettings({
      sms: { provider: "meta" },
      whatsapp: { provider: "taqnyat" },
    });
    assert.equal(office.sms.provider, "unifonic");
    assert.equal(office.whatsapp.provider, "meta");
  });

  test("credentials keep only the provider's own fields", () => {
    const platform = normalizePlatformSettings({
      sms: {
        enabled: true,
        provider: "taqnyat",
        credentials: { apiToken: "enc(t)", senderId: "OFFICE", stray: "x" },
      },
    });
    assert.deepEqual(platform.sms.credentials, {
      apiToken: "enc(t)",
      senderId: "OFFICE",
    });
  });

  test("templates: unknown parameters are dropped, missing ones default to all", () => {
    const templates = normalizeTemplates({
      payment_reminder: {
        ar: { name: "rent_ar", language: "ar", params: ["amount", "evil param", "due_date"] },
        en: { name: "rent_en" },
        fr: { name: "ignored" },
      },
      unknown_event: { ar: { name: "x" } },
    });
    assert.deepEqual(templates.payment_reminder?.ar, {
      name: "rent_ar",
      language: "ar",
      params: ["amount", "due_date"],
    });
    assert.equal(templates.payment_reminder?.en?.language, "ar");
    assert.ok(templates.payment_reminder?.en?.params.includes("recipient_name"));
    assert.equal(Object.keys(templates).length, 1);
  });
});

describe("what a browser sees", () => {
  test("secrets only as set / not set", () => {
    const view = gatewayView("sms", {
      provider: "msegat",
      credentials: { userName: "office", apiKey: "enc(k)", senderId: "OFFICE" },
      templates: {},
    });
    assert.deepEqual(view.credentials, { userName: "office", senderId: "OFFICE" });
    assert.deepEqual(view.secretsSet, { apiKey: true });
    assert.ok(!JSON.stringify(view).includes("enc(k)"));
  });
});

describe("applying a form submission", () => {
  const existing = {
    provider: "taqnyat" as const,
    credentials: { apiToken: "enc(old)", senderId: "OLD" },
    templates: {},
  };

  test("a secret left blank keeps the stored one; a typed one is encrypted", () => {
    const kept = applyGatewayPatch(
      "sms",
      existing,
      { credentials: { apiToken: "", senderId: "NEW" } },
      encrypt,
      token,
    );
    assert.deepEqual(kept.credentials, { apiToken: "enc(old)", senderId: "NEW" });

    const replaced = applyGatewayPatch(
      "sms",
      existing,
      { credentials: { apiToken: "fresh" } },
      encrypt,
      token,
    );
    assert.equal(replaced.credentials.apiToken, "enc(fresh)");
    assert.equal(replaced.credentials.senderId, "OLD");
  });

  test("switching provider never carries a secret across", () => {
    const switched = applyGatewayPatch(
      "sms",
      existing,
      { provider: "msegat", credentials: { userName: "u" } },
      encrypt,
      token,
    );
    assert.equal(switched.provider, "msegat");
    assert.deepEqual(switched.credentials, { userName: "u" });
    assert.deepEqual(gatewayMissing("sms", switched), ["apiKey", "senderId"]);
  });

  test("Meta gets a verify token made up when none was typed", () => {
    const meta = applyGatewayPatch(
      "whatsapp",
      { provider: "meta", credentials: {}, templates: {} },
      { credentials: { phoneNumberId: "1", accessToken: "a" } },
      encrypt,
      token,
    );
    assert.equal(meta.credentials.verifyToken, "generated-token");
    assert.equal(meta.credentials.accessToken, "enc(a)");
  });
});

describe("which gateway a message goes through", () => {
  const ownTaqnyat = normalizeOfficeSettings({
    sms: {
      enabled: true,
      useOwnGateway: true,
      provider: "taqnyat",
      credentials: { apiToken: "enc(office)", senderId: "OFFICE" },
    },
  });
  const platform = normalizePlatformSettings({
    sms: {
      enabled: true,
      provider: "unifonic",
      credentials: { appSid: "enc(platform)" },
    },
  });
  const env = envGateway("sms", {
    SMS_PROVIDER: "twilio",
    TWILIO_ACCOUNT_SID: "AC1",
    TWILIO_AUTH_TOKEN: "t",
    TWILIO_SMS_FROM: "+1555",
  });

  test("the office's own account, decrypted", () => {
    const gateway = resolveGateway("sms", ownTaqnyat, platform, env, decrypt);
    assert.deepEqual(gateway, {
      channel: "sms",
      provider: "taqnyat",
      source: "office",
      credentials: { apiToken: "office", senderId: "OFFICE" },
      templates: {},
    });
  });

  test("without one, the platform's default", () => {
    const office = normalizeOfficeSettings({ sms: { enabled: true } });
    const gateway = resolveGateway("sms", office, platform, env, decrypt);
    assert.equal(gateway?.source, "platform");
    assert.equal(gateway?.credentials.appSid, "platform");
  });

  test("without that, the environment's", () => {
    const office = normalizeOfficeSettings({ sms: { enabled: true } });
    const off = normalizePlatformSettings({ sms: { ...platform.sms, enabled: false } });
    const gateway = resolveGateway("sms", office, off, env, decrypt);
    assert.equal(gateway?.source, "env");
    assert.equal(gateway?.provider, "twilio");
  });

  test("an office that chose its own account never falls back to the platform's", () => {
    const broken = normalizeOfficeSettings({
      sms: { useOwnGateway: true, provider: "taqnyat", credentials: { senderId: "X" } },
    });
    assert.equal(resolveGateway("sms", broken, platform, env, decrypt), null);
  });

  test("a secret that no longer decrypts is a missing secret, not a crash", () => {
    const office = normalizeOfficeSettings({ sms: { enabled: true } });
    const gateway = resolveGateway("sms", office, platform, null, () => {
      throw new Error("bad key");
    });
    assert.equal(gateway, null);
  });

  test("an incomplete environment is no gateway", () => {
    assert.equal(
      resolveGateway(
        "whatsapp",
        null,
        null,
        envGateway("whatsapp", { WHATSAPP_PROVIDER: "meta" }),
        decrypt,
      ),
      null,
    );
    assert.equal(envGateway("sms", {}), null);
  });
});

describe("picking a template", () => {
  const templates = normalizeTemplates({
    payment_overdue: { en: { name: "overdue_en", language: "en_US" } },
  });

  test("the recipient's language first, the other one when only it exists", () => {
    assert.equal(pickTemplate(templates, "payment_overdue", "ar")?.name, "overdue_en");
    assert.equal(pickTemplate(templates, "payment_overdue", "en")?.language, "en_US");
    assert.equal(pickTemplate(templates, "lease_expiry", "ar"), null);
  });
});
