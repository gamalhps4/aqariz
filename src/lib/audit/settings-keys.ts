/**
 * PropertyPro - What a settings save is compared on
 *
 * An activity entry for a settings save lists only the fields that moved
 * (`auditSettingsChange`), so each screen needs two things the route cannot
 * improvise: which fields are worth comparing, and the stored settings read
 * into one flat, comparable shape — the same shape before and after, so a
 * default filled in on one side does not look like a change.
 *
 * Three rules shape every snapshot here:
 *
 *   - Secrets (SMTP password, gateway keys, tokens) are returned as they are
 *     stored and named in a `*_SECRETS` list: `diffSettings` compares them and
 *     stores only "set", never the value. Personal details an entry does not
 *     need to copy (a date of birth, an emergency contact) are handled the
 *     same way.
 *   - An uploaded image is a file name, never its URL.
 *   - A provider is its brand name; a gateway is "Stripe", not an id.
 *
 * Every key a snapshot returns is a label in `admin.audit.fields.<key>`
 * (settings-keys.test.ts checks all five languages).
 *
 * Pure — no database, nothing server-only. The tests read it directly.
 */

import { type Snapshot } from "./diff";
import {
  PAYMENT_GATEWAYS,
  getGatewayDef,
} from "@/lib/payments/gateway-registry";
import {
  MESSAGING_CHANNELS,
  MESSAGING_EVENTS,
  MESSAGING_PROVIDERS,
  TEMPLATE_LANGUAGES,
  getProviderDef,
  type MessagingChannel,
} from "@/lib/messaging/registry";

// ============================================================================
// Reading stored values
// ============================================================================

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** A trimmed string, or null when there is none (numbers are kept as text). */
function text(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function flag(value: unknown): boolean {
  return value === true;
}

function whole(value: unknown): number | null {
  const number = typeof value === "string" ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number) ? number : null;
}

/** "Name" → "Name" capitalised for a composed key: `stripe` + `secretKey`. */
function pascal(value: string): string {
  return value
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

/**
 * The file an image URL or storage key names — nothing else of it: not the
 * host, not a signature in the query string.
 */
export function fileNameOf(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const embedded = /^data:([^;,]+)/i.exec(raw);
  if (embedded) return embedded[1];
  const path = raw.split(/[?#]/)[0];
  const last = path.split("/").filter(Boolean).pop();
  if (!last) return null;
  let name = last;
  try {
    name = decodeURIComponent(last);
  } catch {
    // keep it as stored
  }
  return name.length > 120 ? `${name.slice(0, 117)}…` : name;
}

function color(value: unknown): string | null {
  return text(value)?.toUpperCase() ?? null;
}

// ============================================================================
// Display and language (Settings → Display, the preferences drawer)
// ============================================================================

/**
 * What the display settings compare. The preferences drawer saves on every
 * tweak, so only organization-wide choices are here; what a person arranges
 * for themselves (sidebar collapsed, last-viewed, layout widths, fonts) is
 * left out, and a save that touches only those records nothing.
 */
export const DISPLAY_AUDIT_KEYS = [
  "theme",
  "language",
  "timezone",
  "currency",
  "dateFormat",
  "timeFormat",
  "numberFormat",
  "contrast",
  "compact",
  "rtl",
  "navColor",
] as const;

export function displaySnapshot(flat: unknown): Snapshot {
  const source = record(flat);
  return {
    theme: text(source.theme),
    language: text(source.language),
    timezone: text(source.timezone),
    currency: text(source.currency),
    dateFormat: text(source.dateFormat),
    timeFormat: text(source.timeFormat),
    numberFormat: text(source.numberFormat),
    contrast: flag(source.contrast),
    compact: flag(source.compact),
    rtl: flag(source.rtl),
    navColor: text(source.navColor),
  };
}

// ============================================================================
// Branding (logos, colours, company details)
// ============================================================================

export const BRANDING_ASSET_KEYS = ["logoLight", "logoDark", "favicon"] as const;
export type BrandingAsset = (typeof BRANDING_ASSET_KEYS)[number];

export const BRANDING_AUDIT_KEYS = [
  ...BRANDING_ASSET_KEYS,
  "primaryColor",
  "secondaryColor",
  "companyName",
  "companyAddress",
  "commercialRegistration",
  "taxNumber",
] as const;

/**
 * What the settings schema fills in for a logo or colour nobody chose. A save
 * that merely completes them (the first display save of an office) is not the
 * office changing its branding, so they read as "not set".
 */
const BRANDING_DEFAULTS = new Set([
  "/images/logo-light.png",
  "/images/logo-dark.png",
  "/favicon.ico",
  "#3B82F6",
  "#64748B",
]);

function chosen(value: unknown): unknown {
  const raw = text(value);
  return raw && BRANDING_DEFAULTS.has(raw.replace(/#[0-9a-f]{6}/i, (hex) => hex.toUpperCase())) ? null : value;
}

export function brandingSnapshot(branding: unknown): Snapshot {
  const source = record(branding);
  return {
    logoLight: fileNameOf(chosen(source.logoLight)),
    logoDark: fileNameOf(chosen(source.logoDark)),
    favicon: fileNameOf(chosen(source.favicon)),
    primaryColor: color(chosen(source.primaryColor)),
    secondaryColor: color(chosen(source.secondaryColor)),
    companyName: text(source.companyName),
    companyAddress: text(source.companyAddress),
    commercialRegistration: text(source.commercialRegistration),
    taxNumber: text(source.taxNumber),
  };
}

/** The slot an upload form names: type "logo" + variant "light" → `logoLight`. */
export function brandingSlot(
  type: unknown,
  variant?: unknown,
): BrandingAsset | null {
  if (type === "favicon") return "favicon";
  if (type === "logo") {
    if (variant === "dark") return "logoDark";
    if (variant === "light") return "logoLight";
  }
  return null;
}

/** The slot a stored file belongs to, read from its name: `logo_dark_1759.webp`. */
export function brandingSlotOfFile(fileName: string | null): BrandingAsset | null {
  const match = /^(logo|favicon)(?:_(light|dark))?_\d+/i.exec(fileName ?? "");
  return match
    ? brandingSlot(match[1].toLowerCase(), match[2]?.toLowerCase())
    : null;
}

// ============================================================================
// Email (the office's own SMTP server)
// ============================================================================

export const EMAIL_AUDIT_KEYS = [
  "smtpEnabled",
  "smtpHost",
  "smtpPort",
  "smtpUser",
  "fromEmail",
  "fromName",
  "adminEmail",
  "encryption",
] as const;
export const EMAIL_AUDIT_SECRETS = ["smtpPassword"] as const;

/** The stored email group, with the defaults the settings page shows. */
export function emailSnapshot(email: unknown): Snapshot {
  const source = record(email);
  return {
    smtpEnabled: flag(source.enabled),
    smtpHost: text(source.smtpHost),
    smtpPort: whole(source.smtpPort) ?? 587,
    smtpUser: text(source.smtpUser),
    smtpPassword: text(source.smtpPassword),
    fromEmail: text(source.fromEmail),
    fromName: text(source.fromName),
    adminEmail: text(source.adminEmail),
    encryption: text(source.encryption) ?? "tls",
  };
}

// ============================================================================
// Payment gateways (the office's own merchant accounts)
// ============================================================================

/** `stripe` + `secretKey` → `stripeSecretKey`: the field of one gateway. */
export function gatewayFieldKey(gatewayId: string, field: string): string {
  return `${gatewayId}${pascal(field)}`;
}

export const PAYMENT_AUDIT_KEYS: readonly string[] = [
  "defaultProvider",
  ...PAYMENT_GATEWAYS.flatMap((gateway) => [
    `${gateway.id}Enabled`,
    ...gateway.fields
      .filter((field) => field.type !== "secret")
      .map((field) => gatewayFieldKey(gateway.id, field.key)),
  ]),
];

export const PAYMENT_AUDIT_SECRETS: readonly string[] = PAYMENT_GATEWAYS.flatMap(
  (gateway) =>
    gateway.fields
      .filter((field) => field.type === "secret")
      .map((field) => gatewayFieldKey(gateway.id, field.key)),
);

/** `system_settings.paymentGateways`, flat. Secrets stay as stored (encrypted). */
export function paymentSnapshot(gateways: unknown): Snapshot {
  const source = record(gateways);
  const out: Snapshot = {};
  const provider = text(source.defaultProvider) ?? "stripe";
  out.defaultProvider = getGatewayDef(provider)?.name ?? provider;
  for (const gateway of PAYMENT_GATEWAYS) {
    const entry = record(source[gateway.id]);
    out[`${gateway.id}Enabled`] = flag(entry.enabled);
    for (const field of gateway.fields) {
      out[gatewayFieldKey(gateway.id, field.key)] = text(entry[field.key]);
    }
  }
  return out;
}

// ============================================================================
// SMS and WhatsApp (the office's own gateway, or the platform's default)
// ============================================================================

/** `sms` + `senderId` → `smsSenderId`. */
export function messagingFieldKey(
  channel: MessagingChannel,
  field: string,
): string {
  return `${channel}${pascal(field)}`;
}

/** Credential fields a channel can have, across its providers. */
const CHANNEL_FIELDS: Record<MessagingChannel, string[]> = {
  sms: [],
  whatsapp: [],
};
const CHANNEL_SECRET_FIELDS: Record<MessagingChannel, Set<string>> = {
  sms: new Set(),
  whatsapp: new Set(),
};
for (const provider of MESSAGING_PROVIDERS) {
  for (const field of provider.fields) {
    if (!CHANNEL_FIELDS[provider.channel].includes(field.key)) {
      CHANNEL_FIELDS[provider.channel].push(field.key);
    }
    // The webhook verify token is generated for the office and pasted into
    // Meta's dashboard; it authenticates callbacks, so it is not copied either.
    if (field.type === "secret" || field.key === "verifyToken") {
      CHANNEL_SECRET_FIELDS[provider.channel].add(field.key);
    }
  }
}

/** `payment_reminder` → `PaymentReminder`: the event in a composed key. */
function eventKey(channel: MessagingChannel, event: string): string {
  return `${channel}Event${pascal(event)}`;
}

/**
 * The fields to compare. `office` adds what only an office has: the choice of
 * its own account and the per-event switches; the platform's default gateway
 * has neither.
 */
export function messagingAuditKeys(options: { office: boolean }): string[] {
  const keys: string[] = [];
  for (const channel of MESSAGING_CHANNELS) {
    keys.push(`${channel}Enabled`, `${channel}Provider`);
    if (options.office) keys.push(`${channel}UseOwnGateway`);
    for (const field of CHANNEL_FIELDS[channel]) {
      if (!CHANNEL_SECRET_FIELDS[channel].has(field)) {
        keys.push(messagingFieldKey(channel, field));
      }
    }
    if (channel === "whatsapp") keys.push("whatsappTemplates");
    if (options.office) {
      for (const event of MESSAGING_EVENTS) keys.push(eventKey(channel, event));
    }
  }
  return keys;
}

export const MESSAGING_AUDIT_SECRETS: readonly string[] = MESSAGING_CHANNELS.flatMap(
  (channel) =>
    [...CHANNEL_SECRET_FIELDS[channel]].map((field) =>
      messagingFieldKey(channel, field),
    ),
);

/** The approved WhatsApp templates as "event (language): template name". */
function templateList(templates: unknown): string[] {
  const source = record(templates);
  const out: string[] = [];
  for (const event of MESSAGING_EVENTS) {
    const byLanguage = record(source[event]);
    for (const language of TEMPLATE_LANGUAGES) {
      const name = text(record(byLanguage[language]).name);
      if (name) out.push(`${event} (${language}): ${name}`);
    }
  }
  return out;
}

/**
 * Office settings (`office: true`, with its own-account choice and event
 * switches) or the platform's default gateway, flat. Provider accounts keep
 * the credentials as stored (encrypted); a provider switch drops the old
 * provider's, which reads as cleared.
 */
export function messagingSnapshot(
  settings: unknown,
  options: { office: boolean },
): Snapshot {
  const source = record(settings);
  const events = record(source.events);
  const out: Snapshot = {};
  for (const channel of MESSAGING_CHANNELS) {
    const entry = record(source[channel]);
    out[`${channel}Enabled`] = flag(entry.enabled);
    if (options.office) out[`${channel}UseOwnGateway`] = flag(entry.useOwnGateway);
    const provider = text(entry.provider);
    out[`${channel}Provider`] =
      getProviderDef(channel, provider)?.name ?? provider;
    const credentials = record(entry.credentials);
    for (const field of CHANNEL_FIELDS[channel]) {
      out[messagingFieldKey(channel, field)] = text(credentials[field]);
    }
    if (channel === "whatsapp") {
      out.whatsappTemplates = templateList(entry.templates);
    }
    if (options.office) {
      for (const event of MESSAGING_EVENTS) {
        // A switch nobody turned off is on.
        out[eventKey(channel, event)] =
          record(events[event])[channel] !== false;
      }
    }
  }
  return out;
}

// ============================================================================
// The signed-in person's own account
// ============================================================================

/** What `PUT /api/user/profile` can change on the person's own row. */
export const USER_PROFILE_AUDIT_KEYS = [
  "firstName",
  "lastName",
  "email",
  "phone",
  "bio",
  "location",
  "city",
  "website",
  "address",
  "role",
  "avatar",
] as const;
/** Compared, never copied into an entry. */
export const USER_PROFILE_AUDIT_SECRETS = ["dateOfBirth"] as const;

/** The Super Admin's profile form: name, phone, about, place and website. */
export const ADMIN_PROFILE_AUDIT_KEYS = [
  "firstName",
  "lastName",
  "phone",
  "bio",
  "location",
  "city",
  "website",
] as const;

export function userProfileSnapshot(row: unknown): Snapshot {
  const source = record(row);
  return {
    firstName: text(source.firstName),
    lastName: text(source.lastName),
    email: text(source.email),
    phone: text(source.phone),
    bio: text(source.bio),
    location: text(source.location),
    city: text(source.city),
    website: text(source.website),
    address: text(source.address),
    role: text(source.role),
    avatar: fileNameOf(source.avatar),
    dateOfBirth:
      source.dateOfBirth instanceof Date
        ? source.dateOfBirth.toISOString()
        : text(source.dateOfBirth),
  };
}

/**
 * The profile page's second save, `/api/settings/profile`: the extras kept
 * beside the user row (job, social links, contact preferences). Name, phone,
 * email, address and the like are written by `/api/user/profile` in the same
 * click and audited there; they are not compared twice.
 */
export const PROFILE_SETTINGS_AUDIT_KEYS = [
  "jobTitle",
  "company",
  "gender",
  "linkedin",
  "twitter",
  "facebook",
  "instagram",
  "preferredContactMethod",
  "language",
  "timezone",
  "newsletter",
  "marketingEmails",
] as const;
/** Personal data an entry notes was changed without copying it. */
export const PROFILE_SETTINGS_AUDIT_SECRETS = [
  "dateOfBirth",
  "emergencyContactName",
  "emergencyContactPhone",
  "emergencyContactRelationship",
] as const;

export function profileSettingsSnapshot(profile: unknown): Snapshot {
  const source = record(profile);
  const emergency = record(source.emergencyContact);
  const social = record(source.socialLinks);
  const preferences = record(source.preferences);
  return {
    jobTitle: text(source.jobTitle),
    company: text(source.company),
    gender: text(source.gender),
    linkedin: text(social.linkedin),
    twitter: text(social.twitter),
    facebook: text(social.facebook),
    instagram: text(social.instagram),
    preferredContactMethod: text(preferences.preferredContactMethod),
    language: text(preferences.language),
    timezone: text(preferences.timezone),
    newsletter: flag(preferences.newsletter),
    marketingEmails: flag(preferences.marketingEmails),
    dateOfBirth: text(source.dateOfBirth),
    emergencyContactName: text(emergency.name),
    emergencyContactPhone: text(emergency.phone),
    emergencyContactRelationship: text(emergency.relationship),
  };
}

/** Whether the person gets SMS and WhatsApp from their office (opt-out switches). */
export const MESSAGING_OPT_AUDIT_KEYS = [
  "smsOptIn",
  "whatsappOptIn",
] as const;

export function messagingOptSnapshot(preferences: unknown): Snapshot {
  const source = record(preferences);
  return {
    smsOptIn: source.sms !== false,
    whatsappOptIn: source.whatsapp !== false,
  };
}

// ============================================================================
// Calendar (the person's own calendar preferences)
// ============================================================================

const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

export const CALENDAR_AUDIT_KEYS = [
  "defaultView",
  "firstDay",
  "weekends",
  "showWeekNumbers",
  "showDeclinedEvents",
  "eventLimit",
  "businessHoursEnabled",
  "businessHoursStart",
  "businessHoursEnd",
  "slotDuration",
  "snapDuration",
  "defaultEventDuration",
  "defaultEventType",
  "defaultEventPriority",
  "defaultReminders",
  "notifyInvitations",
  "notifyReminders",
  "notifyUpdates",
  "notifyCancellations",
] as const;

/** The settings with the defaults filled in (the page shows them that way). */
export function calendarSnapshot(settings: unknown): Snapshot {
  const source = record(settings);
  const hours = record(source.businessHours);
  const notify = record(source.emailNotifications);
  const first = whole(source.firstDay);
  const reminders = Array.isArray(source.defaultReminders)
    ? source.defaultReminders.filter(
        (item): item is number => typeof item === "number",
      )
    : [];
  return {
    defaultView: text(source.defaultView),
    firstDay: first === null ? null : (WEEKDAYS[first] ?? String(first)),
    weekends: flag(source.weekends),
    showWeekNumbers: flag(source.showWeekNumbers),
    showDeclinedEvents: flag(source.showDeclinedEvents),
    eventLimit: whole(source.eventLimit),
    businessHoursEnabled: flag(hours.enabled),
    businessHoursStart: text(hours.startTime),
    businessHoursEnd: text(hours.endTime),
    slotDuration: text(source.slotDuration),
    snapDuration: text(source.snapDuration),
    defaultEventDuration: text(source.defaultEventDuration),
    defaultEventType: text(source.defaultEventType),
    defaultEventPriority: text(source.defaultEventPriority),
    defaultReminders: reminders,
    notifyInvitations: flag(notify.invitations),
    notifyReminders: flag(notify.reminders),
    notifyUpdates: flag(notify.updates),
    notifyCancellations: flag(notify.cancellations),
  };
}

// ============================================================================
// The platform's own settings (Super Admin console)
// ============================================================================

export const PLATFORM_SETTINGS_AUDIT_KEYS = [
  "platformName",
  "supportEmail",
  "logoLight",
  "logoDark",
  "favicon",
  "defaultCurrency",
  "defaultTimezone",
  "defaultLanguage",
  "allowSignups",
  "requireEmailVerification",
  "defaultTrialDays",
  "maintenanceEnabled",
  "maintenanceMessage",
  "fromName",
  "fromEmail",
  "smtpHost",
  "smtpPort",
  "smtpSecure",
  "smtpUser",
] as const;
export const PLATFORM_SETTINGS_AUDIT_SECRETS = ["smtpPassword"] as const;

/** `PlatformSettingsData` flat; the stored password is the encrypted envelope. */
export function platformSettingsSnapshot(data: unknown): Snapshot {
  const source = record(data);
  const general = record(source.general);
  const registration = record(source.registration);
  const maintenance = record(source.maintenance);
  const email = record(source.email);
  return {
    platformName: text(general.platformName),
    supportEmail: text(general.supportEmail),
    logoLight: fileNameOf(general.logoLight),
    logoDark: fileNameOf(general.logoDark),
    favicon: fileNameOf(general.favicon),
    defaultCurrency: text(general.defaultCurrency),
    defaultTimezone: text(general.defaultTimezone),
    defaultLanguage: text(general.defaultLanguage),
    allowSignups: flag(registration.allowSignups),
    requireEmailVerification: flag(registration.requireEmailVerification),
    defaultTrialDays: whole(registration.defaultTrialDays),
    maintenanceEnabled: flag(maintenance.enabled),
    maintenanceMessage: text(maintenance.message),
    fromName: text(email.fromName),
    fromEmail: text(email.fromEmail),
    smtpHost: text(email.smtpHost),
    smtpPort: whole(email.smtpPort),
    smtpSecure: flag(email.smtpSecure),
    smtpUser: text(email.smtpUser),
    smtpPassword: text(email.smtpPasswordEncrypted),
  };
}

// ============================================================================
// Fields of single events, outside any settings snapshot
// ============================================================================

/** The platform's switch for one payment gateway (Super Admin → Payment gateways). */
export const PLATFORM_GATEWAY_AUDIT_KEYS = ["platformEnabled", "packages"] as const;

/**
 * Fields written by one event rather than a snapshot: an email change asked
 * for and not yet confirmed, an address verified, the address a test email
 * went to, and the list of secrets an entry says were replaced.
 */
export const EVENT_AUDIT_FIELDS = [
  "pendingEmail",
  "emailVerified",
  "recipient",
  "secretsChanged",
] as const;

// ============================================================================
// Every key an entry can carry — what needs a label
// ============================================================================

/** Every field name the snapshots above can put in a before/after (or a detail). */
export function allSettingsAuditFields(): string[] {
  return [
    ...new Set([
      ...DISPLAY_AUDIT_KEYS,
      ...BRANDING_AUDIT_KEYS,
      ...EMAIL_AUDIT_KEYS,
      ...EMAIL_AUDIT_SECRETS,
      ...PAYMENT_AUDIT_KEYS,
      ...PAYMENT_AUDIT_SECRETS,
      ...messagingAuditKeys({ office: true }),
      ...MESSAGING_AUDIT_SECRETS,
      ...USER_PROFILE_AUDIT_KEYS,
      ...USER_PROFILE_AUDIT_SECRETS,
      ...PROFILE_SETTINGS_AUDIT_KEYS,
      ...PROFILE_SETTINGS_AUDIT_SECRETS,
      ...MESSAGING_OPT_AUDIT_KEYS,
      ...CALENDAR_AUDIT_KEYS,
      ...PLATFORM_SETTINGS_AUDIT_KEYS,
      ...PLATFORM_SETTINGS_AUDIT_SECRETS,
      ...PLATFORM_GATEWAY_AUDIT_KEYS,
      ...EVENT_AUDIT_FIELDS,
    ]),
  ];
}
