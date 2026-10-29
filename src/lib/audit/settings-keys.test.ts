/**
 * What a settings save is compared on: only the fields that matter, an image
 * as a file name, and no secret anywhere in what an entry would store.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { SECRET_MASK, diffSettings } from "@/lib/audit/diff";
import {
  BRANDING_AUDIT_KEYS,
  CALENDAR_AUDIT_KEYS,
  DISPLAY_AUDIT_KEYS,
  EMAIL_AUDIT_KEYS,
  EMAIL_AUDIT_SECRETS,
  MESSAGING_AUDIT_SECRETS,
  MESSAGING_OPT_AUDIT_KEYS,
  PAYMENT_AUDIT_KEYS,
  PAYMENT_AUDIT_SECRETS,
  PLATFORM_SETTINGS_AUDIT_KEYS,
  PLATFORM_SETTINGS_AUDIT_SECRETS,
  PROFILE_SETTINGS_AUDIT_KEYS,
  PROFILE_SETTINGS_AUDIT_SECRETS,
  USER_PROFILE_AUDIT_KEYS,
  USER_PROFILE_AUDIT_SECRETS,
  allSettingsAuditFields,
  brandingSlot,
  brandingSlotOfFile,
  brandingSnapshot,
  calendarSnapshot,
  displaySnapshot,
  emailSnapshot,
  fileNameOf,
  gatewayFieldKey,
  messagingAuditKeys,
  messagingOptSnapshot,
  messagingSnapshot,
  paymentSnapshot,
  platformSettingsSnapshot,
  profileSettingsSnapshot,
  userProfileSnapshot,
} from "@/lib/audit/settings-keys";

describe("fileNameOf", () => {
  test("keeps the file and nothing else of a URL", () => {
    assert.equal(
      fileNameOf(
        "https://cdn.example.com/PropertyPro/branding/logos/logo_light_1759.webp?X-Amz-Signature=abc123&X-Amz-Expires=300",
      ),
      "logo_light_1759.webp",
    );
    assert.equal(fileNameOf("/images/logo-light.png"), "logo-light.png");
    assert.equal(fileNameOf("org_1/avatars/%D8%B4%D8%B9%D8%A7%D8%B1.png"), "شعار.png");
  });

  test("an empty value is no file; an embedded image is not copied", () => {
    assert.equal(fileNameOf(""), null);
    assert.equal(fileNameOf(null), null);
    assert.equal(fileNameOf(undefined), null);
    assert.equal(fileNameOf("data:image/png;base64,AAAAAAAA"), "image/png");
  });
});

describe("display settings", () => {
  test("a save that only moves what a person arranged for themselves records nothing", () => {
    const before = displaySnapshot({
      theme: "light",
      language: "ar",
      sidebarCollapsed: false,
      itemsPerPage: 25,
      dashboardLayout: "grid",
    });
    const after = displaySnapshot({
      theme: "light",
      language: "ar",
      sidebarCollapsed: true,
      itemsPerPage: 50,
      dashboardLayout: "list",
    });
    const diff = diffSettings(before, after, DISPLAY_AUDIT_KEYS);
    assert.deepEqual(diff.changed, []);
  });

  test("language, currency, theme and direction are compared", () => {
    const diff = diffSettings(
      displaySnapshot({ theme: "light", language: "ar", currency: "SAR", rtl: true }),
      displaySnapshot({ theme: "dark", language: "en", currency: "SAR", rtl: false }),
      DISPLAY_AUDIT_KEYS,
    );
    assert.deepEqual(diff.changed.sort(), ["language", "rtl", "theme"]);
    assert.deepEqual(diff.before, { language: "ar", rtl: true, theme: "light" });
    assert.deepEqual(diff.after, { language: "en", rtl: false, theme: "dark" });
  });
});

describe("branding", () => {
  const stored = {
    logoLight: "https://cdn.example.com/org/branding/logos/logo_light_100.png?sig=SECRET",
    logoDark: "/images/logo-dark.png",
    favicon: "/favicon.ico",
    primaryColor: "#3b82f6",
    secondaryColor: "#64748B",
    r2: { logoLight: { objectKey: "org/branding/logos/logo_light_100.png" } },
  };

  test("a logo is a file name, never a URL", () => {
    const diff = diffSettings(
      brandingSnapshot(stored),
      brandingSnapshot({
        ...stored,
        logoLight: "https://cdn.example.com/org/branding/logos/logo_light_200.webp?sig=OTHER",
      }),
      BRANDING_AUDIT_KEYS,
    );
    assert.deepEqual(diff.changed, ["logoLight"]);
    assert.equal(diff.before.logoLight, "logo_light_100.png");
    assert.equal(diff.after.logoLight, "logo_light_200.webp");
    assert.ok(!JSON.stringify(diff).includes("http"));
    assert.ok(!JSON.stringify(diff).includes("SECRET"));
  });

  test("a colour in another case is the same colour; the r2 metadata is not compared", () => {
    const diff = diffSettings(
      brandingSnapshot(stored),
      brandingSnapshot({ ...stored, primaryColor: "#3B82F6", r2: {} }),
      BRANDING_AUDIT_KEYS,
    );
    assert.deepEqual(diff.changed, []);
  });

  test("what the schema fills in is not a change of branding", () => {
    const diff = diffSettings(
      brandingSnapshot({ companyName: "شركة النخيل" }),
      brandingSnapshot({
        companyName: "شركة النخيل",
        logoLight: "/images/logo-light.png",
        logoDark: "/images/logo-dark.png",
        favicon: "/favicon.ico",
        primaryColor: "#3b82f6",
        secondaryColor: "#64748B",
      }),
      BRANDING_AUDIT_KEYS,
    );
    assert.deepEqual(diff.changed, []);
  });

  test("company details are compared; empty and missing are the same", () => {
    const diff = diffSettings(
      brandingSnapshot({ ...stored, companyName: "" }),
      brandingSnapshot({ ...stored, companyName: "شركة النخيل", taxNumber: "300000000000003" }),
      BRANDING_AUDIT_KEYS,
    );
    assert.deepEqual(diff.changed.sort(), ["companyName", "taxNumber"]);
  });

  test("an upload names its slot", () => {
    assert.equal(brandingSlot("logo", "light"), "logoLight");
    assert.equal(brandingSlot("logo", "dark"), "logoDark");
    assert.equal(brandingSlot("favicon", null), "favicon");
    assert.equal(brandingSlot("logo", undefined), null);
    assert.equal(brandingSlot("banner", "light"), null);
    assert.equal(brandingSlotOfFile("logo_dark_1759000000.png"), "logoDark");
    assert.equal(brandingSlotOfFile("logo_light_1759000000.webp"), "logoLight");
    assert.equal(brandingSlotOfFile("favicon_1759000000.ico"), "favicon");
    assert.equal(brandingSlotOfFile("photo.png"), null);
    assert.equal(brandingSlotOfFile(null), null);
  });
});

describe("email settings", () => {
  const stored = {
    enabled: true,
    smtpHost: "smtp.example.com",
    smtpPort: 465,
    smtpUser: "office@example.com",
    smtpPassword: "hunter2-old",
    fromEmail: "office@example.com",
    fromName: "Al Nakheel",
    adminEmail: "",
    encryption: "ssl",
  };

  test("the password is compared but never stored", () => {
    const diff = diffSettings(
      emailSnapshot(stored),
      emailSnapshot({ ...stored, smtpPassword: "hunter2-new" }),
      EMAIL_AUDIT_KEYS,
      EMAIL_AUDIT_SECRETS,
    );
    assert.deepEqual(diff.changed, ["smtpPassword"]);
    assert.deepEqual(diff.secretsChanged, ["smtpPassword"]);
    assert.equal(diff.before.smtpPassword, SECRET_MASK);
    assert.equal(diff.after.smtpPassword, SECRET_MASK);
    const written = JSON.stringify(diff);
    assert.ok(!written.includes("hunter2"));
  });

  test("a save that keeps the saved password and changes the host", () => {
    const diff = diffSettings(
      emailSnapshot(stored),
      emailSnapshot({ ...stored, smtpHost: "mail.example.com" }),
      EMAIL_AUDIT_KEYS,
      EMAIL_AUDIT_SECRETS,
    );
    assert.deepEqual(diff.changed, ["smtpHost"]);
    assert.deepEqual(diff.secretsChanged, []);
  });

  test("the page's defaults are not a change", () => {
    // A settings group that never stored a port or encryption reads as the
    // page shows it: 587 over TLS.
    const diff = diffSettings(
      emailSnapshot({}),
      emailSnapshot({ smtpPort: 587, encryption: "tls", enabled: false, smtpHost: "" }),
      EMAIL_AUDIT_KEYS,
      EMAIL_AUDIT_SECRETS,
    );
    assert.deepEqual(diff.changed, []);
  });
});

describe("payment gateway settings", () => {
  const stored = {
    defaultProvider: "stripe",
    stripe: {
      enabled: true,
      publishableKey: "pk_live_AAAA",
      secretKey: "enc:v1:old-secret-envelope",
      webhookSecret: "enc:v1:old-webhook-envelope",
    },
    paypal: { enabled: false, mode: "sandbox", clientId: "", clientSecret: "" },
  };

  test("gateway fields are composed from the registry", () => {
    assert.equal(gatewayFieldKey("stripe", "secretKey"), "stripeSecretKey");
    assert.equal(gatewayFieldKey("paytabs", "profileId"), "paytabsProfileId");
    assert.ok(PAYMENT_AUDIT_KEYS.includes("stripeEnabled"));
    assert.ok(PAYMENT_AUDIT_KEYS.includes("stripePublishableKey"));
    assert.ok(PAYMENT_AUDIT_KEYS.includes("paypalMode"));
    assert.ok(PAYMENT_AUDIT_KEYS.includes("paytabsRegion"));
    assert.ok(!PAYMENT_AUDIT_KEYS.includes("stripeSecretKey"));
    for (const secret of [
      "stripeSecretKey",
      "stripeWebhookSecret",
      "paypalClientSecret",
      "moyasarSecretKey",
      "moyasarWebhookSecret",
      "paytabsServerKey",
      "tapSecretKey",
    ]) {
      assert.ok(PAYMENT_AUDIT_SECRETS.includes(secret), secret);
    }
  });

  test("switching a gateway on and replacing its key", () => {
    const next = {
      ...stored,
      defaultProvider: "paypal",
      stripe: { ...stored.stripe, secretKey: "enc:v1:NEW-secret-envelope" },
      paypal: { enabled: true, mode: "live", clientId: "AeA1", clientSecret: "enc:v1:paypal" },
    };
    const diff = diffSettings(
      paymentSnapshot(stored),
      paymentSnapshot(next),
      PAYMENT_AUDIT_KEYS,
      PAYMENT_AUDIT_SECRETS,
    );
    assert.deepEqual(diff.changed.sort(), [
      "defaultProvider",
      "paypalClientId",
      "paypalClientSecret",
      "paypalEnabled",
      "paypalMode",
      "stripeSecretKey",
    ]);
    // The default provider reads as the gateway's name, not its id.
    assert.equal(diff.before.defaultProvider, "Stripe");
    assert.equal(diff.after.defaultProvider, "PayPal");
    assert.deepEqual(diff.secretsChanged.sort(), ["paypalClientSecret", "stripeSecretKey"]);
    const written = JSON.stringify(diff);
    assert.ok(!written.includes("enc:v1"));
    assert.ok(!written.includes("secret-envelope"));
  });

  test("re-saving with every secret left blank changes nothing", () => {
    const diff = diffSettings(
      paymentSnapshot(stored),
      paymentSnapshot({ ...stored }),
      PAYMENT_AUDIT_KEYS,
      PAYMENT_AUDIT_SECRETS,
    );
    assert.deepEqual(diff.changed, []);
  });

  test("an office with no default stored defaults to Stripe", () => {
    assert.equal(paymentSnapshot({}).defaultProvider, "Stripe");
    assert.deepEqual(
      diffSettings(paymentSnapshot(undefined), paymentSnapshot({ defaultProvider: "stripe" }), PAYMENT_AUDIT_KEYS).changed,
      [],
    );
  });
});

describe("messaging settings", () => {
  const office = (overrides: Record<string, unknown> = {}) => ({
    sms: {
      enabled: true,
      useOwnGateway: true,
      provider: "taqnyat",
      credentials: { apiToken: "enc:v1:token-a", senderId: "AlNakheel" },
      templates: {},
    },
    whatsapp: {
      enabled: false,
      useOwnGateway: false,
      provider: "meta",
      credentials: { phoneNumberId: "1055", accessToken: "enc:v1:access-a", verifyToken: "VERIFY-SECRET-1" },
      templates: { payment_reminder: { ar: { name: "rent_reminder_ar", language: "ar", params: [] } } },
    },
    events: { payment_overdue: { sms: false, whatsapp: true } },
    ...overrides,
  });
  const keys = messagingAuditKeys({ office: true });

  test("provider, sender and channel switches are compared by name", () => {
    const next = office({
      sms: {
        ...office().sms,
        provider: "msegat",
        credentials: { userName: "alnakheel", apiKey: "enc:v1:key-b", senderId: "AlNakheel2" },
      },
    });
    const diff = diffSettings(
      messagingSnapshot(office(), { office: true }),
      messagingSnapshot(next, { office: true }),
      keys,
      MESSAGING_AUDIT_SECRETS,
    );
    assert.equal(diff.before.smsProvider, "Taqnyat");
    assert.equal(diff.after.smsProvider, "Msegat");
    assert.equal(diff.after.smsSenderId, "AlNakheel2");
    assert.equal(diff.after.smsUserName, "alnakheel");
    // Switching provider drops the old provider's secret and sets the new one's.
    assert.ok(diff.secretsChanged.includes("smsApiToken"));
    assert.ok(diff.secretsChanged.includes("smsApiKey"));
    const written = JSON.stringify(diff);
    assert.ok(!written.includes("enc:v1"));
  });

  test("the webhook verify token is not copied", () => {
    const diff = diffSettings(
      messagingSnapshot(office(), { office: true }),
      messagingSnapshot(
        office({
          whatsapp: {
            ...office().whatsapp,
            credentials: { phoneNumberId: "1055", accessToken: "enc:v1:access-a", verifyToken: "VERIFY-SECRET-2" },
          },
        }),
        { office: true },
      ),
      keys,
      MESSAGING_AUDIT_SECRETS,
    );
    assert.deepEqual(diff.changed, ["whatsappVerifyToken"]);
    assert.ok(!JSON.stringify(diff).includes("VERIFY-SECRET"));
  });

  test("an event switch nobody turned off is on", () => {
    const snapshot = messagingSnapshot(office(), { office: true });
    assert.equal(snapshot.smsEventPaymentOverdue, false);
    assert.equal(snapshot.whatsappEventPaymentOverdue, true);
    assert.equal(snapshot.smsEventPaymentReminder, true);
    const diff = diffSettings(
      snapshot,
      messagingSnapshot(office({ events: {} }), { office: true }),
      keys,
      MESSAGING_AUDIT_SECRETS,
    );
    assert.deepEqual(diff.changed, ["smsEventPaymentOverdue"]);
  });

  test("templates are listed by event, language and name", () => {
    const snapshot = messagingSnapshot(office(), { office: true });
    assert.deepEqual(snapshot.whatsappTemplates, ["payment_reminder (ar): rent_reminder_ar"]);
  });

  test("the platform's default gateway has no own-account or event keys", () => {
    const platformKeys = messagingAuditKeys({ office: false });
    assert.ok(platformKeys.includes("smsProvider"));
    assert.ok(!platformKeys.some((key) => key.endsWith("UseOwnGateway")));
    assert.ok(!platformKeys.some((key) => key.includes("Event")));
    const snapshot = messagingSnapshot(office(), { office: false });
    assert.ok(!("smsUseOwnGateway" in snapshot));
    assert.ok(!("smsEventPaymentOverdue" in snapshot));
  });

  test("every secret the registry names is a secret here", () => {
    for (const key of [
      "smsAppSid",
      "smsApiToken",
      "smsApiKey",
      "smsAuthToken",
      "whatsappAccessToken",
      "whatsappAppSecret",
      "whatsappAuthToken",
      "whatsappVerifyToken",
    ]) {
      assert.ok(MESSAGING_AUDIT_SECRETS.includes(key), key);
      assert.ok(!keys.includes(key), `${key} must not be compared as plain text`);
    }
  });
});

describe("the person's own account", () => {
  test("a profile save compares the row's own fields and hides the birth date", () => {
    const before = userProfileSnapshot({
      firstName: "Sara",
      lastName: "Hassan",
      email: "sara@office.sa",
      phone: "0500000000",
      role: "manager",
      avatar: "https://cdn.example.com/a/avatar_1.png?sig=1",
      dateOfBirth: new Date("1990-05-04T00:00:00.000Z"),
    });
    const after = userProfileSnapshot({
      firstName: "Sara",
      lastName: "Hassan",
      email: "sara@office.sa",
      phone: "0555555555",
      role: "manager",
      avatar: "https://cdn.example.com/a/avatar_1.png?sig=2",
      dateOfBirth: new Date("1991-01-01T00:00:00.000Z"),
    });
    const diff = diffSettings(before, after, USER_PROFILE_AUDIT_KEYS, USER_PROFILE_AUDIT_SECRETS);
    assert.deepEqual(diff.changed.sort(), ["dateOfBirth", "phone"]);
    assert.equal(diff.before.phone, "0500000000");
    assert.equal(diff.after.phone, "0555555555");
    assert.equal(diff.after.dateOfBirth, SECRET_MASK);
    assert.ok(!JSON.stringify(diff).includes("1990"));
  });

  test("a role written through the profile is recorded", () => {
    const diff = diffSettings(
      userProfileSnapshot({ role: "tenant" }),
      userProfileSnapshot({ role: "admin" }),
      USER_PROFILE_AUDIT_KEYS,
    );
    assert.deepEqual(diff.changed, ["role"]);
  });

  test("the profile extras: contact preferences shown, personal details hidden", () => {
    const before = profileSettingsSnapshot({
      jobTitle: "Accountant",
      emergencyContact: { name: "Omar", phone: "0511111111", relationship: "Brother" },
      preferences: { preferredContactMethod: "email", newsletter: false },
    });
    const after = profileSettingsSnapshot({
      jobTitle: "Accountant",
      emergencyContact: { name: "Omar", phone: "0522222222", relationship: "Brother" },
      preferences: { preferredContactMethod: "sms", newsletter: false },
    });
    const diff = diffSettings(
      before,
      after,
      PROFILE_SETTINGS_AUDIT_KEYS,
      PROFILE_SETTINGS_AUDIT_SECRETS,
    );
    assert.deepEqual(diff.changed.sort(), ["emergencyContactPhone", "preferredContactMethod"]);
    assert.equal(diff.after.preferredContactMethod, "sms");
    assert.equal(diff.after.emergencyContactPhone, SECRET_MASK);
    assert.ok(!JSON.stringify(diff).includes("0522222222"));
  });

  test("the extras leave out what /api/user/profile already records", () => {
    for (const key of ["firstName", "lastName", "email", "phone", "address", "bio"]) {
      assert.ok(!(PROFILE_SETTINGS_AUDIT_KEYS as readonly string[]).includes(key), key);
    }
  });

  test("SMS and WhatsApp are on until switched off", () => {
    assert.deepEqual(messagingOptSnapshot({}), { smsOptIn: true, whatsappOptIn: true });
    assert.deepEqual(messagingOptSnapshot({ sms: false }), { smsOptIn: false, whatsappOptIn: true });
    const diff = diffSettings(
      messagingOptSnapshot({ sms: true, whatsapp: true }),
      messagingOptSnapshot({ sms: false, whatsapp: true }),
      MESSAGING_OPT_AUDIT_KEYS,
    );
    assert.deepEqual(diff.changed, ["smsOptIn"]);
  });
});

describe("calendar preferences", () => {
  const defaults = {
    defaultView: "dayGridMonth",
    weekends: true,
    firstDay: 0,
    businessHours: { enabled: true, startTime: "09:00", endTime: "17:00", daysOfWeek: [1, 2, 3, 4, 5] },
    slotDuration: "00:30",
    defaultReminders: [15],
    emailNotifications: { invitations: true, reminders: true, updates: true, cancellations: true },
    eventLimit: 3,
  };

  test("the week start reads as a day, hours and switches as they are", () => {
    const diff = diffSettings(
      calendarSnapshot(defaults),
      calendarSnapshot({
        ...defaults,
        firstDay: 6,
        businessHours: { ...defaults.businessHours, startTime: "08:00" },
        emailNotifications: { ...defaults.emailNotifications, reminders: false },
        defaultReminders: [15, 60],
      }),
      CALENDAR_AUDIT_KEYS,
    );
    assert.deepEqual(diff.changed.sort(), [
      "businessHoursStart",
      "defaultReminders",
      "firstDay",
      "notifyReminders",
    ]);
    assert.equal(diff.before.firstDay, "sunday");
    assert.equal(diff.after.firstDay, "saturday");
  });

  test("the same settings are no change, whatever order the reminders are in", () => {
    const diff = diffSettings(
      calendarSnapshot({ ...defaults, defaultReminders: [15, 60] }),
      calendarSnapshot({ ...defaults, defaultReminders: [60, 15] }),
      CALENDAR_AUDIT_KEYS,
    );
    assert.deepEqual(diff.changed, []);
  });
});

describe("platform settings", () => {
  const data = (overrides: { email?: object; general?: object; maintenance?: object } = {}) => ({
    general: {
      platformName: "PropertyPro",
      supportEmail: "",
      logoLight: "https://cdn.example.com/p/logo_light_1.png?sig=x",
      logoDark: "",
      favicon: "",
      defaultCurrency: "SAR",
      defaultTimezone: "Asia/Riyadh",
      defaultLanguage: "ar",
      ...overrides.general,
    },
    registration: { allowSignups: true, requireEmailVerification: false, defaultTrialDays: 14 },
    maintenance: { enabled: false, message: "Back soon.", ...overrides.maintenance },
    email: {
      fromName: "PropertyPro",
      fromEmail: "",
      smtpHost: "smtp.example.com",
      smtpPort: 587,
      smtpSecure: false,
      smtpUser: "u",
      smtpPasswordEncrypted: "enc:v1:platform-old",
      ...overrides.email,
    },
  });

  test("maintenance mode, the trial length and the SMTP password", () => {
    const diff = diffSettings(
      platformSettingsSnapshot(data()),
      platformSettingsSnapshot(
        data({
          maintenance: { enabled: true },
          email: { smtpPasswordEncrypted: "enc:v1:platform-new" },
        }),
      ),
      PLATFORM_SETTINGS_AUDIT_KEYS,
      PLATFORM_SETTINGS_AUDIT_SECRETS,
    );
    assert.deepEqual(diff.changed.sort(), ["maintenanceEnabled", "smtpPassword"]);
    assert.equal(diff.after.smtpPassword, SECRET_MASK);
    assert.ok(!JSON.stringify(diff).includes("enc:v1"));
  });

  test("a logo is a file name", () => {
    const diff = diffSettings(
      platformSettingsSnapshot(data()),
      platformSettingsSnapshot(
        data({ general: { logoLight: "https://cdn.example.com/p/logo_light_2.png?sig=y" } }),
      ),
      PLATFORM_SETTINGS_AUDIT_KEYS,
      PLATFORM_SETTINGS_AUDIT_SECRETS,
    );
    assert.deepEqual(diff.after, { logoLight: "logo_light_2.png" });
  });
});

describe("labels", () => {
  const locales = ["en", "ar"];
  const catalogues = Object.fromEntries(
    locales.map((locale) => [
      locale,
      JSON.parse(
        readFileSync(path.join(process.cwd(), "src/locales", locale, "admin.json"), "utf8"),
      ) as Record<string, string>,
    ]),
  );

  test("every field an entry can carry has a label in all five languages", () => {
    const missing: string[] = [];
    for (const field of allSettingsAuditFields()) {
      for (const locale of locales) {
        const label = catalogues[locale][`admin.audit.fields.${field}`];
        if (typeof label !== "string" || !label.trim()) {
          missing.push(`${locale}:${field}`);
        }
      }
    }
    assert.deepEqual(missing, []);
  });

  test("the sentences settings entries use exist in all five languages", () => {
    const missing: string[] = [];
    for (const key of [
      "admin.audit.msg.email_change_requested",
      "admin.audit.msg.email_change_confirmed",
      "admin.audit.msg.email_verified",
      "admin.audit.msg.settings_test_email",
      "admin.audit.msg.settings_test_message",
      "admin.audit.msg.branding_file_deleted",
    ]) {
      for (const locale of locales) {
        if (!catalogues[locale][key]) missing.push(`${locale}:${key}`);
      }
    }
    assert.deepEqual(missing, []);
  });
});
