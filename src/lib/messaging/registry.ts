/**
 * PropertyPro - SMS and WhatsApp gateway registry
 *
 * The one declaration of every messaging provider, the credentials each one
 * needs, the events an office can switch on per channel, and the named
 * parameters a WhatsApp template for each event may use. It drives the
 * settings screens (office and Super Admin render their fields from here),
 * validation (which fields an enabled gateway must have), storage (which
 * fields are secrets, encrypted at rest and never sent to a browser) and the
 * send path.
 *
 * Client-safe: no server imports. The payment equivalent is
 * `src/lib/payments/gateway-registry.ts`.
 *
 * Field labels and hints are catalogue keys, `settings.messaging.field.<key>`
 * and `settings.messaging.fieldHint.<key>`; provider names are brands and are
 * not translated.
 */

export type MessagingChannel = "sms" | "whatsapp";

export const MESSAGING_CHANNELS: readonly MessagingChannel[] = [
  "sms",
  "whatsapp",
];

export function isMessagingChannel(value: unknown): value is MessagingChannel {
  return value === "sms" || value === "whatsapp";
}

export type MessagingProviderId =
  | "unifonic"
  | "taqnyat"
  | "msegat"
  | "twilio"
  | "meta";

export interface MessagingField {
  /** Credential key as stored, e.g. "apiToken". */
  key: string;
  /** "secret" is masked in the form, encrypted at rest, never returned. */
  type: "text" | "secret";
  /** Needed before the gateway can be used. */
  required?: boolean;
  placeholder?: string;
  /** Has a hint under the field (`settings.messaging.fieldHint.<key>`). */
  hint?: boolean;
}

export interface MessagingProviderDef {
  id: MessagingProviderId;
  name: string;
  channel: MessagingChannel;
  fields: MessagingField[];
  /**
   * How delivery reports reach us:
   *  - "per-message": the send names a status callback URL (Twilio);
   *  - "app-webhook": one webhook set up in the provider's dashboard (Meta);
   *  - "none": the provider reports nothing back, the log stops at "sent".
   */
  deliveryReports: "per-message" | "app-webhook" | "none";
  /** Sends approved templates by name with named parameters (Meta). */
  templates?: boolean;
}

const TWILIO_ACCOUNT_FIELDS: MessagingField[] = [
  { key: "accountSid", type: "text", required: true, placeholder: "AC…" },
  { key: "authToken", type: "secret", required: true },
];

export const MESSAGING_PROVIDERS: readonly MessagingProviderDef[] = [
  {
    id: "unifonic",
    name: "Unifonic",
    channel: "sms",
    deliveryReports: "none",
    fields: [
      { key: "appSid", type: "secret", required: true },
      { key: "senderId", type: "text", placeholder: "PropertyPro", hint: true },
    ],
  },
  {
    id: "taqnyat",
    name: "Taqnyat",
    channel: "sms",
    deliveryReports: "none",
    fields: [
      { key: "apiToken", type: "secret", required: true },
      {
        key: "senderId",
        type: "text",
        required: true,
        placeholder: "PropertyPro",
        hint: true,
      },
    ],
  },
  {
    id: "msegat",
    name: "Msegat",
    channel: "sms",
    deliveryReports: "none",
    fields: [
      { key: "userName", type: "text", required: true },
      { key: "apiKey", type: "secret", required: true },
      {
        key: "senderId",
        type: "text",
        required: true,
        placeholder: "PropertyPro",
        hint: true,
      },
    ],
  },
  {
    id: "twilio",
    name: "Twilio",
    channel: "sms",
    deliveryReports: "per-message",
    fields: [
      ...TWILIO_ACCOUNT_FIELDS,
      {
        key: "senderId",
        type: "text",
        required: true,
        placeholder: "+15551234567",
        hint: true,
      },
    ],
  },
  {
    id: "meta",
    name: "Meta WhatsApp Cloud API",
    channel: "whatsapp",
    deliveryReports: "app-webhook",
    templates: true,
    fields: [
      { key: "phoneNumberId", type: "text", required: true },
      { key: "accessToken", type: "secret", required: true },
      { key: "appSecret", type: "secret", hint: true },
      { key: "verifyToken", type: "text", hint: true },
    ],
  },
  {
    id: "twilio",
    name: "Twilio",
    channel: "whatsapp",
    deliveryReports: "per-message",
    fields: [
      ...TWILIO_ACCOUNT_FIELDS,
      {
        key: "senderId",
        type: "text",
        required: true,
        placeholder: "+15551234567",
        hint: true,
      },
    ],
  },
];

export function providersFor(
  channel: MessagingChannel,
): MessagingProviderDef[] {
  return MESSAGING_PROVIDERS.filter((provider) => provider.channel === channel);
}

export function getProviderDef(
  channel: MessagingChannel,
  id: unknown,
): MessagingProviderDef | undefined {
  return MESSAGING_PROVIDERS.find(
    (provider) => provider.channel === channel && provider.id === id,
  );
}

/** The provider a channel's form starts on. */
export const DEFAULT_PROVIDER: Record<MessagingChannel, MessagingProviderId> = {
  sms: "unifonic",
  whatsapp: "meta",
};

/** Required keys an enabled gateway is missing. */
export function missingRequiredFields(
  channel: MessagingChannel,
  provider: unknown,
  credentials: Record<string, unknown>,
): string[] {
  const def = getProviderDef(channel, provider);
  if (!def) return ["provider"];
  return def.fields
    .filter((field) => field.required)
    .filter((field) => {
      const value = credentials[field.key];
      return typeof value !== "string" || value.trim() === "";
    })
    .map((field) => field.key);
}

// ============================================================================
// Events
// ============================================================================

/**
 * What an office can send a text or WhatsApp message about. Each one is a
 * switch per channel in Settings → Messaging.
 */
export type MessagingEvent =
  | "payment_reminder"
  | "payment_overdue"
  | "payment_receipt"
  | "lease_expiry"
  | "maintenance_update"
  | "maintenance_emergency";

export const MESSAGING_EVENTS: readonly MessagingEvent[] = [
  "payment_reminder",
  "payment_overdue",
  "payment_receipt",
  "lease_expiry",
  "maintenance_update",
  "maintenance_emergency",
];

export function isMessagingEvent(value: unknown): value is MessagingEvent {
  return MESSAGING_EVENTS.includes(value as MessagingEvent);
}

/**
 * The named parameters the send path fills for each event. A WhatsApp
 * template approved by Meta may use any of them, written `{{recipient_name}}`
 * in its body; its settings list which ones it uses, because Meta rejects a
 * send that names a parameter the template does not have.
 */
export const EVENT_TEMPLATE_PARAMS: Record<MessagingEvent, readonly string[]> =
  {
    payment_reminder: [
      "recipient_name",
      "office_name",
      "property_name",
      "amount",
      "due_date",
      "days",
    ],
    payment_overdue: [
      "recipient_name",
      "office_name",
      "property_name",
      "amount",
      "due_date",
      "days",
    ],
    payment_receipt: [
      "recipient_name",
      "office_name",
      "amount",
      "receipt_number",
      "payment_date",
    ],
    lease_expiry: [
      "recipient_name",
      "office_name",
      "property_name",
      "end_date",
      "days",
    ],
    maintenance_update: [
      "recipient_name",
      "office_name",
      "request_title",
      "status",
    ],
    maintenance_emergency: [
      "recipient_name",
      "office_name",
      "property_name",
      "request_title",
    ],
  };

/** Template languages: the office's display language picks one. */
export type TemplateLanguage = "ar" | "en";
export const TEMPLATE_LANGUAGES: readonly TemplateLanguage[] = ["ar", "en"];

// ============================================================================
// Log vocabulary
// ============================================================================

/** Where a message's gateway came from. Only "office" is the office's bill. */
export type GatewaySource = "office" | "platform" | "env";

/** What started a send. */
export type MessagePurpose = "automation" | "manual" | "test";

/**
 * A logged message's state. "blocked" never reached a provider (opted out,
 * no number, over the package's quota, no template); the others are the
 * provider's own answers, updated by delivery reports.
 */
export type MessageStatus =
  | "sent"
  | "delivered"
  | "read"
  | "failed"
  | "undelivered"
  | "blocked";

export const MESSAGE_STATUSES: readonly MessageStatus[] = [
  "sent",
  "delivered",
  "read",
  "failed",
  "undelivered",
  "blocked",
];

/** Why a message was blocked before it reached a provider. */
export type BlockReason =
  | "opted_out"
  | "no_phone"
  | "quota_exceeded"
  | "no_template"
  /** A test to a number the gateway may not be used for (see decide.ts). */
  | "test_recipient"
  /** The office's test sends for the day are used up. */
  | "test_daily_limit";

/**
 * Delivery reports arrive out of order — a "delivered" can land after the
 * "read" it preceded. A report only moves a message forward.
 */
const STATUS_RANK: Record<MessageStatus, number> = {
  blocked: 0,
  sent: 1,
  delivered: 2,
  failed: 2,
  undelivered: 2,
  read: 3,
};

export function statusAdvances(
  current: MessageStatus,
  next: MessageStatus,
): boolean {
  if (current === "blocked") return false;
  return STATUS_RANK[next] > STATUS_RANK[current];
}
