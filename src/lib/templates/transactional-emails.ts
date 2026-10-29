/**
 * PropertyPro - The emails the system sends, in the recipient's language
 *
 * Every transactional email (invitations, password and email changes, rent
 * and lease reminders, calendar invitations, maintenance updates) used to be
 * written in English inside `email-service.ts`, with `<html lang="en">` and a
 * left-to-right layout — an Arabic office's tenants got English mail. They are
 * now built here from the same catalogue as the screens
 * (`src/locales/<language>/common.json`, keys `notifications.email.*`), in the
 * recipient's language (`lib/i18n/recipient-locale.ts` decides which), laid
 * out right to left for Arabic.
 *
 * Pure functions: no database, no SMTP. `email-service.ts` resolves the
 * office's branding and the recipient's language, calls a builder here, and
 * sends what it returns — which is also what the tests render.
 *
 * Everything that came from a person (a name, a property, a note) is escaped
 * before it goes into the markup.
 */

import { formatCurrency } from "@/lib/utils/formatting";
import { roleDisplayName } from "@/lib/role-display";
import { maintenanceStatusText } from "@/lib/maintenance-labels";
import { PASSWORD_MIN_LENGTH } from "@/lib/password-policy";
import type { RecipientLocale } from "@/lib/i18n/recipient-locale-core";
import {
  fillPlaceholders,
  formatDateFor,
  formatTimeFor,
  pluralKey,
  translateFor,
} from "@/lib/i18n/translate";

export interface EmailTemplate {
  subject: string;
  html: string;
  text: string;
}

/** What every email needs to know besides its own content. */
export interface EmailContext {
  locale: RecipientLocale;
  /** The office's name (its branding), or the product's. */
  appName: string;
  /** The deployment's base URL, for links. */
  appUrl: string;
  /** The office's primary colour, for the header and buttons. */
  brandColor: string;
  /** The year in the footer; defaults to the current one. */
  year?: number;
}

export interface ActionButton {
  text: string;
  url: string;
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/**
 * Faces that carry Arabic. Cairo — the app's face — where the mail client
 * loads web fonts (Apple Mail, iOS); otherwise system faces with designed
 * Arabic (Segoe UI and Tahoma on Windows, Geeza/SF on Apple).
 */
const EMAIL_FONT_STACK =
  "'Cairo', 'Segoe UI', Tahoma, -apple-system, BlinkMacSystemFont, Roboto, 'Helvetica Neue', Arial, 'Noto Sans Arabic', sans-serif";

const CAIRO_STYLESHEET =
  "https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&display=swap";

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&copy;/g, "©")
    .replace(/&amp;/g, "&");
}

/** Markup that is already safe — passed through a placeholder unescaped. */
interface Markup {
  markup: string;
}

type HtmlValues = Record<string, string | number | null | undefined | Markup>;

function isMarkup(value: unknown): value is Markup {
  return typeof value === "object" && value !== null && "markup" in value;
}

/**
 * Writes one email in one language. Catalogue keys are relative to
 * `notifications.email.`.
 */
export class EmailWriter {
  constructor(readonly ctx: EmailContext) {}

  get language(): string {
    return this.ctx.locale.language;
  }

  get dir(): "rtl" | "ltr" {
    return this.ctx.locale.dir;
  }

  /** The leading edge — "right" for Arabic, for inline styles. */
  get start(): "right" | "left" {
    return this.ctx.locale.dir === "rtl" ? "right" : "left";
  }

  /** Plain text (a subject line, a button label): nothing is escaped. */
  plain(key: string, values?: Record<string, string | number | null | undefined>): string {
    return translateFor(this.language, `notifications.email.${key}`, {
      appName: this.ctx.appName,
      ...(values ?? {}),
    });
  }

  /** Text for the markup: the wording and every value are escaped. */
  html(key: string, values?: HtmlValues): string {
    const template = translateFor(this.language, `notifications.email.${key}`);
    const filled: Record<string, string> = {
      appName: escapeHtml(this.ctx.appName),
    };
    for (const [token, value] of Object.entries(values ?? {})) {
      filled[token] = isMarkup(value) ? value.markup : escapeHtml(value ?? "");
    }
    return fillPlaceholders(escapeHtml(template), filled);
  }

  /** A value set in bold, escaped. */
  strong(value: unknown): Markup {
    return { markup: `<strong>${escapeHtml(value)}</strong>` };
  }

  /** Text from elsewhere in the catalogue (a status, a role, an event type). */
  catalogue(key: string, fallback: string): string {
    return translateFor(this.language, key, undefined, fallback);
  }

  date(value: Date | string | number, style: "medium" | "long" | "full" = "long"): string {
    return formatDateFor(this.language, value, {
      style,
      timeZone: this.ctx.locale.timeZone,
    });
  }

  time(value: Date | string | number): string {
    return formatTimeFor(this.language, value, {
      timeZone: this.ctx.locale.timeZone,
    });
  }

  money(amount: number): string {
    return formatCurrency(Number(amount) || 0, this.ctx.locale.currency);
  }

  /** "Hello <b>name</b>," */
  greeting(name: string): string {
    return `<p>${this.html("greeting", { name: this.strong(name) })}</p>`;
  }

  /** The amber box with "Security notice:" and `body` (already markup). */
  securityNotice(body: string): string {
    return `<div class="security-notice"><strong>${this.html("securityNotice")}</strong> ${body}</div>`;
  }

  /** A bulleted list of catalogue entries. */
  list(keys: string[], values?: HtmlValues): string {
    return `<ul>${keys.map((key) => `<li>${this.html(key, values)}</li>`).join("")}</ul>`;
  }

  /** A "Label: value" line; the value is escaped unless it is markup. */
  detail(
    labelKey: string,
    value: string | Markup,
    style = "margin: 5px 0;",
    icon = "",
  ): string {
    const shown = isMarkup(value) ? value.markup : escapeHtml(value);
    const tag = style.includes("margin-bottom") ? "div" : "p";
    return `<${tag} style="${style}"><strong>${icon ? `${icon} ` : ""}${this.html(labelKey)}:</strong> ${shown}</${tag}>`;
  }

  /** Plural-aware wording: `<key>.one` for 1 where the language has it. */
  count(key: string, count: number): string {
    return pluralKey(key, count);
  }
}

/** Turn the markup into the plain-text part, one block per line. */
function plainTextOf(markup: string): string {
  return decodeEntities(
    markup
      .replace(/<li[^>]*>/gi, "\n- ")
      .replace(/<(br|\/p|\/div|\/h[1-6]|\/ul|\/li)[^>]*>/gi, "\n")
      .replace(/<[^>]*>/g, "")
      .replace(/[ \t]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n"),
  ).trim();
}

/**
 * The frame every email shares: the office's name, the title, the content,
 * an optional button, and the footer — laid out in the recipient's direction.
 */
export function baseEmail(
  w: EmailWriter,
  title: string,
  content: string,
  actionButton?: ActionButton,
): EmailTemplate {
  const { appName, brandColor } = w.ctx;
  const year = w.ctx.year ?? new Date().getFullYear();
  const start = w.start;
  const end = start === "right" ? "left" : "right";
  const footer = [
    w.html("footer.sentFrom"),
    w.html("footer.questions"),
    w.html("footer.rights", { year }),
  ];

  const html = `<!DOCTYPE html>
<html lang="${w.language}" dir="${w.dir}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="${CAIRO_STYLESHEET}">
  <style>
    body {
      font-family: ${EMAIL_FONT_STACK};
      line-height: 1.7;
      color: #333;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
      background-color: #f8f9fa;
      direction: ${w.dir};
      text-align: ${start};
    }
    .container {
      background-color: #ffffff;
      border-radius: 8px;
      padding: 40px;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    }
    .header { text-align: center; margin-bottom: 30px; }
    .logo { font-size: 24px; font-weight: bold; color: ${brandColor}; margin-bottom: 10px; }
    .title { font-size: 20px; font-weight: 600; color: #1f2937; margin-bottom: 20px; }
    .content { margin-bottom: 30px; color: #4b5563; }
    .content ul { padding-${start}: 20px; padding-${end}: 0; }
    .button {
      display: inline-block;
      background-color: ${brandColor};
      color: #ffffff !important;
      padding: 12px 24px;
      text-decoration: none;
      border-radius: 6px;
      font-weight: 500;
      margin: 20px 0;
    }
    .footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #e5e7eb;
      text-align: center;
      color: #6b7280;
      font-size: 14px;
    }
    .security-notice {
      background-color: #fef3c7;
      border: 1px solid #f59e0b;
      border-radius: 6px;
      padding: 16px;
      margin: 20px 0;
      color: #92400e;
    }
  </style>
</head>
<body dir="${w.dir}" style="direction: ${w.dir}; text-align: ${start}; font-family: ${EMAIL_FONT_STACK};">
  <div class="container" dir="${w.dir}">
    <div class="header">
      <div class="logo">${escapeHtml(appName)}</div>
      <h1 class="title">${escapeHtml(title)}</h1>
    </div>
    <div class="content">
      ${content}
    </div>
    ${
      actionButton
        ? `<div style="text-align: center;">
      <a href="${escapeHtml(actionButton.url)}" class="button" style="display: inline-block; background-color: ${brandColor}; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 500; margin: 20px 0;">${escapeHtml(actionButton.text)}</a>
    </div>`
        : ""
    }
    <div class="footer">
      ${footer.map((line) => `<p>${line}</p>`).join("\n      ")}
    </div>
  </div>
</body>
</html>`;

  const text = [
    appName,
    "",
    title,
    "",
    plainTextOf(content),
    "",
    actionButton ? `${actionButton.text}: ${actionButton.url}` : "",
    "---",
    ...footer.map((line) => decodeEntities(line)),
  ]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { subject: title, html, text };
}

// ---------------------------------------------------------------------------
// Account emails
// ---------------------------------------------------------------------------

export function tenantInvitationEmail(
  ctx: EmailContext,
  input: { tenantName: string; invitedBy: string; invitationUrl: string },
): EmailTemplate {
  const w = new EmailWriter(ctx);
  const content = `
      ${w.greeting(input.tenantName)}
      <p>${w.html("tenantInvitation.intro", { invitedBy: w.strong(input.invitedBy) })}</p>
      <p>${w.html("tenantInvitation.prompt")}</p>
      ${w.securityNotice(w.html("tenantInvitation.expiry"))}
      <p>${w.html("tenantInvitation.benefitsIntro")}</p>
      ${w.list([
        "tenantInvitation.benefit.dashboard",
        "tenantInvitation.benefit.lease",
        "tenantInvitation.benefit.maintenance",
        "tenantInvitation.benefit.payments",
        "tenantInvitation.benefit.messages",
      ])}
      <p>${w.html("contactSupport")}</p>
      <p>${w.html("welcomeTo")}</p>`;
  return baseEmail(w, w.plain("tenantInvitation.subject"), content, {
    text: w.plain("tenantInvitation.button"),
    url: input.invitationUrl,
  });
}

export function memberInvitationEmail(
  ctx: EmailContext,
  input: {
    memberName: string;
    invitedBy: string;
    organizationName: string;
    role: string;
    expiresAt: Date;
    invitationUrl: string;
  },
): EmailTemplate {
  const w = new EmailWriter(ctx);
  const role = roleDisplayName(input.role, {
    language: w.language,
    t: (key, options) =>
      translateFor(w.language, key, undefined, options?.defaultValue),
  });
  const content = `
      ${w.greeting(input.memberName)}
      <p>${w.html("memberInvitation.intro", {
        invitedBy: w.strong(input.invitedBy),
        organizationName: w.strong(input.organizationName),
        role: w.strong(role),
      })}</p>
      <p>${w.html("memberInvitation.prompt")}</p>
      ${w.securityNotice(
        w.html("memberInvitation.expiry", {
          date: w.date(input.expiresAt, "full"),
          invitedBy: input.invitedBy,
        }),
      )}
      <p>${w.html("memberInvitation.benefitsIntro")}</p>
      ${w.list([
        "memberInvitation.benefit.properties",
        "memberInvitation.benefit.payments",
        "memberInvitation.benefit.maintenance",
        "memberInvitation.benefit.messages",
      ])}
      <p>${w.html("memberInvitation.ignore")}</p>`;
  return baseEmail(
    w,
    w.plain("memberInvitation.subject", { organizationName: input.organizationName }),
    content,
    { text: w.plain("memberInvitation.button"), url: input.invitationUrl },
  );
}

export function passwordResetEmail(
  ctx: EmailContext,
  input: { userName: string; resetUrl: string },
): EmailTemplate {
  const w = new EmailWriter(ctx);
  const content = `
      ${w.greeting(input.userName)}
      <p>${w.html("passwordReset.intro")}</p>
      <p>${w.html("passwordReset.prompt")}</p>
      ${w.securityNotice(w.html("passwordReset.expiry"))}
      <p><strong>${w.html("passwordReset.notYou")}</strong></p>
      ${w.list(["ignoreSafely", "passwordReset.unchanged", "changePasswordIfSuspicious"])}
      <p>${w.html("passwordReset.strongIntro")}</p>
      ${w.list(
        ["passwordReset.strong.length", "passwordReset.strong.case", "passwordReset.strong.symbols"],
        { min: PASSWORD_MIN_LENGTH },
      )}`;
  return baseEmail(w, w.plain("passwordReset.subject"), content, {
    text: w.plain("passwordReset.button"),
    url: input.resetUrl,
  });
}

export function emailChangeEmail(
  ctx: EmailContext,
  input: { userName: string; newEmail: string; confirmUrl: string },
): EmailTemplate {
  const w = new EmailWriter(ctx);
  const content = `
      ${w.greeting(input.userName)}
      <p>${w.html("emailChange.intro", { email: w.strong(input.newEmail) })}</p>
      <p>${w.html("emailChange.prompt")}</p>
      ${w.securityNotice(w.html("emailChange.expiry"))}
      <p><strong>${w.html("emailChange.notYou")}</strong></p>
      ${w.list(["ignoreSafely", "emailChange.unchanged", "changePasswordIfSuspicious"])}`;
  return baseEmail(w, w.plain("emailChange.subject"), content, {
    text: w.plain("emailChange.button"),
    url: input.confirmUrl,
  });
}

export function emailVerificationEmail(
  ctx: EmailContext,
  input: { userName: string; userEmail: string; verifyUrl: string },
): EmailTemplate {
  const w = new EmailWriter(ctx);
  const content = `
      ${w.greeting(input.userName)}
      <p>${w.html("emailVerification.intro", { email: w.strong(input.userEmail) })}</p>
      <p>${w.html("emailVerification.prompt")}</p>
      ${w.securityNotice(w.html("emailVerification.expiry"))}
      <p><strong>${w.html("emailVerification.notYou")}</strong></p>
      ${w.list(["ignoreSafely", "emailVerification.unchanged"])}`;
  return baseEmail(w, w.plain("emailVerification.subject"), content, {
    text: w.plain("emailVerification.button"),
    url: input.verifyUrl,
  });
}

export function accountActivatedEmail(
  ctx: EmailContext,
  input: { userName: string; loginUrl: string },
): EmailTemplate {
  const w = new EmailWriter(ctx);
  const features = ["dashboard", "lease", "maintenance", "payments", "messages", "profile"]
    .map(
      (feature) =>
        `<li><strong>${w.html(`accountActivated.feature.${feature}.label`)}:</strong> ${w.html(
          `accountActivated.feature.${feature}.text`,
        )}</li>`,
    )
    .join("");
  const content = `
      ${w.greeting(input.userName)}
      <p>${w.html("accountActivated.intro")}</p>
      <p>${w.html("accountActivated.prompt")}</p>
      <ul>${features}</ul>
      <p>${w.html("accountActivated.help")}</p>
      <p>${w.html("welcomeTo")}</p>`;
  return baseEmail(w, w.plain("accountActivated.subject"), content, {
    text: w.plain("accountActivated.button"),
    url: input.loginUrl,
  });
}

/**
 * A message someone else wrote (a reply, a billing notice). Its subject and
 * body arrive written; the greeting and the frame follow the recipient.
 */
export function notificationEmail(
  ctx: EmailContext,
  input: {
    userName: string;
    subject: string;
    message: string;
    actionButton?: ActionButton;
  },
): EmailTemplate {
  const w = new EmailWriter(ctx);
  const body = escapeHtml(input.message).replace(/\r?\n/g, "<br>");
  const content = `
      ${w.greeting(input.userName)}
      <div style="margin: 20px 0;">
        ${body}
      </div>`;
  return baseEmail(w, input.subject, content, input.actionButton);
}

// ---------------------------------------------------------------------------
// Calendar emails
// ---------------------------------------------------------------------------

/** Event type → its label in the calendar settings catalogue. */
const EVENT_TYPE_KEYS: Record<string, string> = {
  general: "calendar.settings.events.typeGeneral",
  property_showing: "calendar.settings.events.typePropertyShowing",
  property_inspection: "calendar.settings.events.typePropertyInspection",
  maintenance_appointment: "calendar.settings.events.typeMaintenance",
  maintenance: "calendar.settings.events.typeMaintenance",
  tenant_meeting: "calendar.settings.events.typeTenantMeeting",
  lease_renewal: "calendar.settings.events.typeLeaseRenewal",
  rent_collection: "calendar.settings.events.typeRentCollection",
  move_in: "calendar.settings.events.typeMoveIn",
  move_out: "calendar.settings.events.typeMoveOut",
};

function humanise(code: string): string {
  const words = code.replace(/_/g, " ").trim();
  return words ? `${words.charAt(0).toUpperCase()}${words.slice(1)}` : "";
}

export interface EmailEvent {
  title: string;
  description?: string;
  startDate: Date;
  endDate?: Date;
  location?: string;
  organizer?: string;
  type?: string;
  allDay?: boolean;
  reason?: string;
}

function eventTime(w: EmailWriter, event: EmailEvent, withEnd: boolean): string {
  if (event.allDay) return w.plain("event.allDay");
  const start = w.time(event.startDate);
  return withEnd && event.endDate ? `${start} – ${w.time(event.endDate)}` : start;
}

function eventCard(
  w: EmailWriter,
  event: EmailEvent,
  palette: { background: string; border: string; heading: string },
  rows: string,
  icon = "",
): string {
  return `
      <div style="background: ${palette.background}; border: 1px solid ${palette.border}; border-radius: 8px; padding: 20px; margin: 20px 0;">
        <h3 style="margin: 0 0 15px 0; color: ${palette.heading}; font-size: 18px;">${icon}${escapeHtml(event.title)}</h3>
        ${rows}
      </div>`;
}

const ROW = "margin-bottom: 10px;";

export function eventInvitationEmail(
  ctx: EmailContext,
  input: { attendeeName: string; event: EmailEvent; rsvpUrl?: string | null },
): EmailTemplate {
  const w = new EmailWriter(ctx);
  const { event } = input;
  const typeLabel = event.type
    ? w.catalogue(EVENT_TYPE_KEYS[event.type] ?? "", humanise(event.type))
    : "";
  const rows = [
    w.detail("label.date", w.date(event.startDate, "full"), ROW, "📅"),
    w.detail("label.time", eventTime(w, event, true), ROW, "🕐"),
    event.location ? w.detail("label.location", event.location, ROW, "📍") : "",
    event.organizer ? w.detail("label.organizer", event.organizer, ROW, "👤") : "",
    typeLabel ? w.detail("label.type", typeLabel, ROW, "📋") : "",
    event.description
      ? `<div style="margin-top: 15px;"><strong>${w.html("label.description")}:</strong><p style="margin: 5px 0 0 0; color: #64748b;">${escapeHtml(event.description)}</p></div>`
      : "",
  ].join("");

  const rsvp = input.rsvpUrl
    ? `
      <p>${w.html("event.invitation.respond")}</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${escapeHtml(`${input.rsvpUrl}&response=accepted`)}" style="display: inline-block; background: #10b981; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 0 5px;">${w.html("event.invitation.accept")}</a>
        <a href="${escapeHtml(`${input.rsvpUrl}&response=declined`)}" style="display: inline-block; background: #ef4444; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 0 5px;">${w.html("event.invitation.decline")}</a>
        <a href="${escapeHtml(`${input.rsvpUrl}&response=tentative`)}" style="display: inline-block; background: #f59e0b; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 0 5px;">${w.html("event.invitation.maybe")}</a>
      </div>`
    : "";

  const content = `
      ${w.greeting(input.attendeeName)}
      <p>${w.html("event.invitation.intro")}</p>
      ${eventCard(w, event, { background: "#f8fafc", border: "#e2e8f0", heading: "#1e293b" }, rows)}
      ${rsvp}
      <p>${w.html("event.invitation.questions")}</p>`;

  return baseEmail(
    w,
    w.plain("event.invitation.subject", { title: event.title }),
    content,
    input.rsvpUrl
      ? { text: w.plain("event.invitation.button"), url: input.rsvpUrl }
      : undefined,
  );
}

export type ReminderWhen = "1_hour" | "1_day" | "1_week";

export function eventReminderEmail(
  ctx: EmailContext,
  input: { attendeeName: string; event: EmailEvent; reminderType: ReminderWhen },
): EmailTemplate {
  const w = new EmailWriter(ctx);
  const { event } = input;
  const when = w.plain(`event.reminder.when.${input.reminderType}`);
  const rows = [
    w.detail("label.date", w.date(event.startDate, "full"), ROW, "📅"),
    w.detail("label.time", eventTime(w, event, false), ROW, "🕐"),
    event.location ? w.detail("label.location", event.location, ROW, "📍") : "",
    event.description
      ? `<div style="margin-top: 15px;"><strong>${w.html("label.description")}:</strong><p style="margin: 5px 0 0 0; color: #92400e;">${escapeHtml(event.description)}</p></div>`
      : "",
  ].join("");
  const content = `
      ${w.greeting(input.attendeeName)}
      <p>${w.html("event.reminder.intro", { when: w.strong(when) })}</p>
      ${eventCard(w, event, { background: "#fef3c7", border: "#f59e0b", heading: "#92400e" }, rows, "⏰ ")}
      <p>${w.html("event.reminder.outro")}</p>`;
  return baseEmail(
    w,
    w.plain("event.reminder.subject", { title: event.title, when }),
    content,
  );
}

export function eventCancellationEmail(
  ctx: EmailContext,
  input: { attendeeName: string; event: EmailEvent },
): EmailTemplate {
  const w = new EmailWriter(ctx);
  const { event } = input;
  const rows = [
    w.detail("label.originalDate", w.date(event.startDate, "full"), ROW, "📅"),
    event.location ? w.detail("label.location", event.location, ROW, "📍") : "",
    event.organizer ? w.detail("label.organizer", event.organizer, ROW, "👤") : "",
    event.reason
      ? `<div style="margin-top: 15px;"><strong>${w.html("event.cancellation.reason")}:</strong><p style="margin: 5px 0 0 0; color: #dc2626;">${escapeHtml(event.reason)}</p></div>`
      : "",
  ].join("");
  const content = `
      ${w.greeting(input.attendeeName)}
      <p>${w.html("event.cancellation.intro")}</p>
      ${eventCard(w, event, { background: "#fef2f2", border: "#ef4444", heading: "#dc2626" }, rows, "❌ ")}
      <p>${w.html("event.cancellation.outro")}</p>`;
  return baseEmail(
    w,
    w.plain("event.cancellation.subject", { title: event.title }),
    content,
  );
}

export function eventUpdateEmail(
  ctx: EmailContext,
  input: { attendeeName: string; event: EmailEvent; changes: string[] },
): EmailTemplate {
  const w = new EmailWriter(ctx);
  const { event } = input;
  const rows = [
    w.detail("label.date", w.date(event.startDate, "full"), ROW, "📅"),
    w.detail("label.time", eventTime(w, event, false), ROW, "🕐"),
    event.location ? w.detail("label.location", event.location, ROW, "📍") : "",
    `<div style="margin-top: 15px;"><strong>${w.html("event.update.changes")}:</strong><ul style="margin: 5px 0 0 0; color: #0369a1;">${input.changes
      .map((change) => `<li>${escapeHtml(change)}</li>`)
      .join("")}</ul></div>`,
  ].join("");
  const content = `
      ${w.greeting(input.attendeeName)}
      <p>${w.html("event.update.intro")}</p>
      ${eventCard(w, event, { background: "#f0f9ff", border: "#0ea5e9", heading: "#0369a1" }, rows, "📝 ")}
      <p>${w.html("event.update.outro")}</p>`;
  return baseEmail(
    w,
    w.plain("event.update.subject", { title: event.title }),
    content,
  );
}

export type RsvpResponse = "accepted" | "declined" | "tentative";

export function rsvpConfirmationEmail(
  ctx: EmailContext,
  input: { attendeeName: string; event: EmailEvent; response: RsvpResponse },
): EmailTemplate {
  const w = new EmailWriter(ctx);
  const { event, response } = input;
  const color = { accepted: "#10b981", declined: "#ef4444", tentative: "#f59e0b" }[response];
  const rows = [
    w.detail("label.date", w.date(event.startDate, "full"), ROW, "📅"),
    event.location ? w.detail("label.location", event.location, ROW, "📍") : "",
  ].join("");
  const content = `
      ${w.greeting(input.attendeeName)}
      <p style="color: ${color}; font-weight: 600;">${w.html(`event.rsvp.intro.${response}`)}</p>
      ${eventCard(w, event, { background: "#f8fafc", border: "#e2e8f0", heading: "#1e293b" }, rows)}
      <p>${w.html(`event.rsvp.outro.${response}`)}</p>`;
  return baseEmail(
    w,
    w.plain("event.rsvp.subject", { title: event.title }),
    content,
  );
}

// ---------------------------------------------------------------------------
// Rent, lease and maintenance emails
// ---------------------------------------------------------------------------

export function paymentReminderEmail(
  ctx: EmailContext,
  input: {
    tenantName: string;
    propertyName: string;
    rentAmount: number;
    dueDate: Date;
    daysOverdue: number;
    paymentUrl: string;
  },
): EmailTemplate {
  const w = new EmailWriter(ctx);
  const days = Math.max(0, Math.floor(Number(input.daysOverdue) || 0));
  const isOverdue = days > 0;
  const content = `
      ${w.greeting(input.tenantName)}
      ${
        isOverdue
          ? `<div style="background-color: #fef2f2; border: 1px solid #fca5a5; border-radius: 6px; padding: 16px; margin: 20px 0; color: #dc2626;">
             <strong>⚠️ ${w.html("paymentReminder.overdueTitle")}</strong><br>
             ${w.html(w.count("paymentReminder.overdueDays", days), { days })}
           </div>`
          : `<p>${w.html("paymentReminder.friendly")}</p>`
      }
      <div style="background-color: #f3f4f6; border-radius: 6px; padding: 20px; margin: 20px 0;">
        <h3 style="margin: 0 0 10px 0; color: #1f2937;">${w.html("paymentReminder.detailsTitle")}</h3>
        ${w.detail("label.property", input.propertyName)}
        ${w.detail("label.amountDue", w.money(input.rentAmount))}
        ${w.detail("label.dueDate", w.date(input.dueDate))}
        ${isOverdue ? w.detail("label.daysOverdue", String(days), "margin: 5px 0; color: #dc2626;") : ""}
      </div>
      <p>${w.html("paymentReminder.portal")}</p>
      ${
        isOverdue
          ? `<p style="color: #dc2626;"><strong>${w.html("paymentReminder.important")}</strong></p>`
          : `<p>${w.html("paymentReminder.thanks")}</p>`
      }`;
  return baseEmail(
    w,
    w.plain(isOverdue ? "paymentReminder.subject.overdue" : "paymentReminder.subject.due"),
    content,
    { text: w.plain("paymentReminder.button"), url: input.paymentUrl },
  );
}

function expiryPalette(daysUntilExpiry: number) {
  return daysUntilExpiry <= 30
    ? { background: "#fef3c7", border: "#f59e0b" }
    : { background: "#f0f9ff", border: "#0ea5e9" };
}

export function leaseExpiryEmail(
  ctx: EmailContext,
  input: {
    tenantName: string;
    propertyName: string;
    expiryDate: Date;
    daysUntilExpiry: number;
    leaseUrl: string;
  },
): EmailTemplate {
  const w = new EmailWriter(ctx);
  const days = Math.max(0, Math.floor(Number(input.daysUntilExpiry) || 0));
  const palette = expiryPalette(days);
  const content = `
      ${w.greeting(input.tenantName)}
      <p>${w.html("leaseExpiry.intro", { property: w.strong(input.propertyName) })}</p>
      <div style="background-color: ${palette.background}; border: 1px solid ${palette.border}; border-radius: 6px; padding: 20px; margin: 20px 0;">
        <h3 style="margin: 0 0 10px 0; color: #1f2937;">${w.html("leaseExpiry.infoTitle")}</h3>
        ${w.detail("label.property", input.propertyName)}
        ${w.detail("label.leaseExpires", w.date(input.expiryDate))}
        ${w.detail("label.daysRemaining", String(days))}
      </div>
      ${
        days <= 30
          ? `<p style="color: #92400e;"><strong>${w.html(w.count("leaseExpiry.actionRequired", days), { days })}</strong></p>`
          : `<p>${w.html("leaseExpiry.consider")}</p>`
      }
      <p>${w.html("leaseExpiry.portal")}</p>`;
  return baseEmail(
    w,
    w.plain(w.count("leaseExpiry.subject", days), { days }),
    content,
    { text: w.plain("leaseExpiry.button"), url: input.leaseUrl },
  );
}

export function leaseExpiryLandlordEmail(
  ctx: EmailContext,
  input: {
    landlordName: string;
    propertyName: string;
    tenantName: string;
    expiryDate: Date;
    daysUntilExpiry: number;
    leaseUrl: string;
  },
): EmailTemplate {
  const w = new EmailWriter(ctx);
  const days = Math.max(0, Math.floor(Number(input.daysUntilExpiry) || 0));
  const palette = expiryPalette(days);
  const urgent = days <= 30;
  const content = `
      ${w.greeting(input.landlordName)}
      <p>${w.html("leaseExpiryLandlord.intro")}</p>
      <div style="background-color: ${palette.background}; border: 1px solid ${palette.border}; border-radius: 6px; padding: 20px; margin: 20px 0;">
        <h3 style="margin: 0 0 10px 0; color: #1f2937;">${w.html("leaseExpiryLandlord.detailsTitle")}</h3>
        ${w.detail("label.property", input.propertyName)}
        ${w.detail("label.tenant", input.tenantName)}
        ${w.detail("label.leaseExpires", w.date(input.expiryDate))}
        ${w.detail("label.daysRemaining", String(days))}
      </div>
      ${
        urgent
          ? `<div style="background-color: #fef2f2; border: 1px solid #fca5a5; border-radius: 6px; padding: 16px; margin: 20px 0; color: #dc2626;">
               <strong>⚠️ ${w.html("leaseExpiryLandlord.actionTitle")}</strong><br>
               ${w.html(w.count("leaseExpiryLandlord.actionIntro", days), { days })}
               ${w.list([
                 "leaseExpiryLandlord.action.contact",
                 "leaseExpiryLandlord.action.prepare",
                 "leaseExpiryLandlord.action.turnover",
                 "leaseExpiryLandlord.action.inspection",
               ])}
             </div>`
          : `<p>${w.html("leaseExpiryLandlord.sufficientTime")}</p>`
      }
      <p><strong>${w.html("leaseExpiryLandlord.recommendedTitle")}</strong></p>
      ${w.list([
        "leaseExpiryLandlord.recommended.review",
        "leaseExpiryLandlord.recommended.decide",
        "leaseExpiryLandlord.recommended.rent",
        "leaseExpiryLandlord.recommended.communicate",
        ...(urgent ? ["leaseExpiryLandlord.recommended.promptly"] : []),
      ])}
      <p>${w.html("leaseExpiryLandlord.outro")}</p>`;
  return baseEmail(
    w,
    w.plain(w.count("leaseExpiryLandlord.subject", days), {
      property: input.propertyName,
      days,
    }),
    content,
    { text: w.plain("leaseExpiry.button"), url: input.leaseUrl },
  );
}

const MAINTENANCE_STATUS_COLORS: Record<string, string> = {
  submitted: "#3b82f6",
  in_progress: "#f59e0b",
  completed: "#10b981",
  cancelled: "#ef4444",
};

export function maintenanceUpdateEmail(
  ctx: EmailContext,
  input: {
    userName: string;
    requestId: string;
    propertyName: string;
    status: string;
    description: string;
    notes?: string;
    requestUrl: string;
  },
): EmailTemplate {
  const w = new EmailWriter(ctx);
  const color = MAINTENANCE_STATUS_COLORS[input.status] || "#6b7280";
  const statusLabel = maintenanceStatusText(input.status, (key, english) =>
    w.catalogue(key, english),
  );
  const content = `
      ${w.greeting(input.userName)}
      <p>${w.html("maintenanceUpdate.intro")}</p>
      <div style="background-color: #f9fafb; border-radius: 6px; padding: 20px; margin: 20px 0;">
        <h3 style="margin: 0 0 15px 0; color: #1f2937;">${w.html("maintenanceUpdate.detailsTitle")}</h3>
        ${w.detail("label.requestId", `#${input.requestId}`)}
        ${w.detail("label.property", input.propertyName)}
        ${w.detail("label.description", input.description)}
        ${w.detail("label.status", {
          markup: `<span style="background-color: ${color}; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px;">${escapeHtml(statusLabel)}</span>`,
        })}
        ${input.notes ? w.detail("label.notes", input.notes, "margin: 15px 0 5px 0;") : ""}
      </div>
      <p>${w.html("maintenanceUpdate.outro")}</p>`;
  return baseEmail(
    w,
    w.plain("maintenanceUpdate.subject", { id: input.requestId }),
    content,
    { text: w.plain("maintenanceUpdate.button"), url: input.requestUrl },
  );
}

/** The message an administrator sends to check the mail settings. */
export function testEmail(ctx: EmailContext, input: { sentAt: Date }): EmailTemplate {
  const w = new EmailWriter(ctx);
  const align = w.dir === "rtl" ? "right" : "left";
  const sentAt = `${w.date(input.sentAt, "medium")} ${w.time(input.sentAt)}`;
  const html = `<!DOCTYPE html>
<html lang="${w.language}" dir="${w.dir}">
<head><meta charset="UTF-8"><title>${escapeHtml(w.plain("test.subject"))}</title></head>
<body dir="${w.dir}" style="direction: ${w.dir}; text-align: ${align};">
  <div dir="${w.dir}" style="font-family: ${EMAIL_FONT_STACK}; max-width: 600px; margin: 0 auto; padding: 20px;">
    <h2 style="color: #333; text-align: center;">${w.html("test.heading")}</h2>
    <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
      <p style="margin: 0; color: #666;">${w.html("test.body")}</p>
    </div>
    <div style="text-align: center; margin-top: 30px;">
      <p style="color: #28a745; font-weight: bold;">✅ ${w.html("test.working")}</p>
    </div>
    <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
    <p style="color: #999; font-size: 12px; text-align: center;">${w.html("test.sentAt", { time: sentAt })}</p>
  </div>
</body>
</html>`;
  const text = [
    w.plain("test.subject"),
    "",
    w.plain("test.body"),
    "",
    `✅ ${w.plain("test.working")}`,
    "",
    w.plain("test.sentAt", { time: sentAt }),
  ].join("\n");
  return { subject: w.plain("test.subject"), html, text };
}
