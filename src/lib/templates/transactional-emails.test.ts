/**
 * The emails, rendered — in Arabic for an Arabic office, in English for an
 * English one.
 *
 * Every transactional email used to be English with `<html lang="en">`
 * whatever the office worked in. These render the real templates with no
 * database or mail server and check what a tenant would actually receive:
 * the language and direction of the document, the Arabic wording from the
 * catalogue, the office's currency and dates, and that a name typed into the
 * system cannot inject markup.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  memberInvitationEmail,
  notificationEmail,
  passwordResetEmail,
  paymentReminderEmail,
  leaseExpiryLandlordEmail,
  tenantInvitationEmail,
  eventInvitationEmail,
  type EmailContext,
} from "@/lib/templates/transactional-emails";

const arabicOffice: EmailContext = {
  locale: { language: "ar", dir: "rtl", currency: "SAR", timeZone: "Asia/Riyadh" },
  appName: "شركة بروبرتي برو لإدارة الأملاك",
  appUrl: "https://app.example.sa",
  brandColor: "#2563eb",
  year: 2026,
};

const englishOffice: EmailContext = {
  locale: { language: "en", dir: "ltr", currency: "USD", timeZone: "America/New_York" },
  appName: "Oakline Management",
  appUrl: "https://app.example.com",
  brandColor: "#3B82F6",
  year: 2026,
};

describe("an Arabic office's emails", () => {
  const reminder = paymentReminderEmail(arabicOffice, {
    tenantName: "محمد العتيبي",
    propertyName: "برج الياسمين",
    rentAmount: 2500,
    dueDate: new Date("2026-10-01T09:00:00Z"),
    daysOverdue: 3,
    paymentUrl: "https://app.example.sa/dashboard/payments/pay-rent",
  });

  test("the document is Arabic and right to left", () => {
    assert.match(reminder.html, /<html lang="ar" dir="rtl">/);
    assert.match(reminder.html, /<body dir="rtl"/);
    assert.match(reminder.html, /text-align: right/);
  });

  test("subject, wording, labels and button come from the Arabic catalogue", () => {
    assert.equal(reminder.subject, "إيجار متأخر — يلزم اتخاذ إجراء");
    assert.match(reminder.html, /مرحبًا <strong>محمد العتيبي<\/strong>،/);
    assert.match(reminder.html, /عدد أيام التأخير: 3/);
    assert.match(reminder.html, /المبلغ المستحق/);
    assert.match(reminder.html, /سداد الإيجار الآن/);
    assert.match(reminder.html, /جميع الحقوق محفوظة/);
    assert.doesNotMatch(reminder.html, /Overdue Payment Notice|Amount Due|Pay Rent Now|All rights reserved/);
  });

  test("the date is Arabic with Western digits", () => {
    assert.match(reminder.html, /أكتوبر/);
    assert.doesNotMatch(reminder.html, /[٠-٩]/);
  });

  test("the plain-text part is Arabic too", () => {
    assert.match(reminder.text, /مرحبًا محمد العتيبي،/);
    assert.match(reminder.text, /سداد الإيجار الآن: https:\/\/app\.example\.sa/);
    assert.doesNotMatch(reminder.text, /<|&amp;/);
  });

  test("an invitation names the role in Arabic and dates the expiry", () => {
    const invite = memberInvitationEmail(arabicOffice, {
      memberName: "سارة",
      invitedBy: "عبدالله السبيعي",
      organizationName: "شركة بروبرتي برو",
      role: "manager",
      expiresAt: new Date("2026-10-10T12:00:00Z"),
      invitationUrl: "https://app.example.sa/auth/setup-password?token=x",
    });
    assert.equal(invite.subject, "دعوة للانضمام إلى شركة بروبرتي برو على شركة بروبرتي برو لإدارة الأملاك");
    assert.match(invite.html, /بدور <strong>/);
    assert.doesNotMatch(invite.html, /<strong>manager<\/strong>/);
    assert.match(invite.html, /قبول الدعوة/);
  });

  test("a staff lease-expiry email reads for any number of days", () => {
    const email = leaseExpiryLandlordEmail(arabicOffice, {
      landlordName: "خالد",
      propertyName: "مجمع النخيل",
      tenantName: "فهد",
      expiryDate: new Date("2026-11-01T00:00:00Z"),
      daysUntilExpiry: 14,
      leaseUrl: "https://app.example.sa/dashboard/leases/1",
    });
    assert.equal(email.subject, "عقد يقترب من الانتهاء — مجمع النخيل (الأيام المتبقية: 14)");
    assert.match(email.html, /التواصل مع المستأجر لمناقشة خيارات التجديد/);
  });

  test("a calendar invitation labels the event type in Arabic", () => {
    const email = eventInvitationEmail(arabicOffice, {
      attendeeName: "نورة",
      event: {
        title: "معاينة الوحدة 12",
        startDate: new Date("2026-10-05T08:00:00Z"),
        type: "property_inspection",
        organizer: "عبدالله",
      },
      rsvpUrl: "https://app.example.sa/calendar/rsvp?token=t",
    });
    assert.equal(email.subject, "دعوة إلى موعد: معاينة الوحدة 12");
    assert.match(email.html, /فحص العقار/);
    assert.match(email.html, /response=accepted/);
  });
});

describe("an English office's emails", () => {
  test("stay English, left to right, in the office's currency", () => {
    const email = paymentReminderEmail(englishOffice, {
      tenantName: "Sam Lee",
      propertyName: "Oak Towers",
      rentAmount: 1200,
      dueDate: new Date("2026-10-01T15:00:00Z"),
      daysOverdue: 1,
      paymentUrl: "https://app.example.com/pay",
    });
    assert.match(email.html, /<html lang="en" dir="ltr">/);
    assert.equal(email.subject, "Overdue rent payment — action required");
    assert.match(email.html, /Your rent payment is 1 day overdue\./);
    assert.match(email.html, /\$1,200\.00/);
  });

  test("a password reset names the policy's minimum length", () => {
    const email = passwordResetEmail(englishOffice, {
      userName: "Sam",
      resetUrl: "https://app.example.com/auth/reset-password?token=t",
    });
    assert.equal(email.subject, "Reset your Oakline Management password");
    assert.match(email.html, /At least 8 characters/);
  });
});

describe("text that came from people is escaped", () => {
  test("names and messages cannot inject markup", () => {
    const invite = tenantInvitationEmail(arabicOffice, {
      tenantName: '<img src=x onerror="alert(1)">',
      invitedBy: "A & B",
      invitationUrl: "https://app.example.sa/auth/setup-password?token=a&b=<c>",
    });
    assert.doesNotMatch(invite.html, /<img src=x/);
    assert.match(invite.html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
    assert.match(invite.html, /A &amp; B/);
    assert.match(invite.html, /token=a&amp;b=&lt;c&gt;/);

    const note = notificationEmail(englishOffice, {
      userName: "Sam",
      subject: "Reply",
      message: "Line one\n<script>x</script>",
    });
    assert.match(note.html, /Line one<br>&lt;script&gt;x&lt;\/script&gt;/);
    assert.match(note.text, /Line one\s+<script>x<\/script>/);
  });
});
