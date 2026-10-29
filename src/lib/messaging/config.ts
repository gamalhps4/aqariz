/**
 * PropertyPro - Messaging settings: shapes, normalising, and gateway choice
 *
 * Pure functions over the stored settings, so the rules are testable without a
 * database:
 *
 *   - an office's settings (`system_settings.integrations.messaging`): per
 *     channel on/off, whether it uses its own provider account, the account's
 *     credentials and sender ID, WhatsApp templates, and per-event switches;
 *   - the Super Admin's default gateway (`platform_settings.messaging`): the
 *     account offices without their own send through;
 *   - which gateway a send uses: the office's own account when it chose one,
 *     else the platform default, else the deployment's environment variables.
 *
 * Secrets are stored encrypted. Encryption and decryption are passed in, so
 * this file has no server imports and the browser can share its types.
 */

import {
  DEFAULT_PROVIDER,
  EVENT_TEMPLATE_PARAMS,
  MESSAGING_CHANNELS,
  MESSAGING_EVENTS,
  TEMPLATE_LANGUAGES,
  getProviderDef,
  missingRequiredFields,
  type GatewaySource,
  type MessagingChannel,
  type MessagingEvent,
  type MessagingProviderId,
  type TemplateLanguage,
} from "./registry";

// ============================================================================
// Shapes
// ============================================================================

/** One approved WhatsApp template: its name, language code and parameters. */
export interface TemplateRef {
  name: string;
  /** Meta's language code, e.g. "ar" or "en_US". */
  language: string;
  /** The named parameters its body uses, from EVENT_TEMPLATE_PARAMS. */
  params: string[];
}

export type TemplateMap = Partial<
  Record<MessagingEvent, Partial<Record<TemplateLanguage, TemplateRef>>>
>;

/** A provider account for one channel. Secrets are stored encrypted. */
export interface ChannelGateway {
  provider: MessagingProviderId;
  credentials: Record<string, string>;
  templates: TemplateMap;
}

export interface OfficeChannelSettings extends ChannelGateway {
  /** The office sends on this channel at all. */
  enabled: boolean;
  /** Its own provider account rather than the platform's default gateway. */
  useOwnGateway: boolean;
}

export type EventSwitches = Record<
  MessagingEvent,
  Record<MessagingChannel, boolean>
>;

export interface OfficeMessagingSettings {
  sms: OfficeChannelSettings;
  whatsapp: OfficeChannelSettings;
  events: EventSwitches;
}

export interface PlatformChannelSettings extends ChannelGateway {
  /** Offices without their own account may send through this one. */
  enabled: boolean;
}

export interface PlatformMessagingSettings {
  sms: PlatformChannelSettings;
  whatsapp: PlatformChannelSettings;
}

/** A gateway ready to send with: credentials decrypted. Server-side only. */
export interface ResolvedGateway {
  channel: MessagingChannel;
  provider: MessagingProviderId;
  source: GatewaySource;
  credentials: Record<string, string>;
  templates: TemplateMap;
}

export type Crypt = (value: string) => string | null | undefined;

// ============================================================================
// Normalising what is stored
// ============================================================================

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function cleanString(value: unknown, max = 500): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function cleanCredentials(
  channel: MessagingChannel,
  provider: MessagingProviderId,
  raw: unknown,
): Record<string, string> {
  const source = record(raw);
  const out: Record<string, string> = {};
  // Secrets are long encryption envelopes; give them room.
  for (const field of getProviderDef(channel, provider)?.fields ?? []) {
    const value = cleanString(source[field.key], 4000);
    if (value) out[field.key] = value;
  }
  return out;
}

const PARAM_NAME = /^[a-z_]+$/;

function cleanTemplate(
  event: MessagingEvent,
  raw: unknown,
): TemplateRef | null {
  const source = record(raw);
  const name = cleanString(source.name, 512);
  if (!name) return null;
  const allowed = EVENT_TEMPLATE_PARAMS[event];
  const params = Array.isArray(source.params)
    ? source.params.filter(
        (param): param is string =>
          typeof param === "string" &&
          PARAM_NAME.test(param) &&
          allowed.includes(param),
      )
    : [...allowed];
  return {
    name,
    language: cleanString(source.language, 16) || "ar",
    params: Array.from(new Set(params)),
  };
}

export function normalizeTemplates(raw: unknown): TemplateMap {
  const source = record(raw);
  const out: TemplateMap = {};
  for (const event of MESSAGING_EVENTS) {
    const byLanguage = record(source[event]);
    const entry: Partial<Record<TemplateLanguage, TemplateRef>> = {};
    for (const language of TEMPLATE_LANGUAGES) {
      const template = cleanTemplate(event, byLanguage[language]);
      if (template) entry[language] = template;
    }
    if (Object.keys(entry).length > 0) out[event] = entry;
  }
  return out;
}

function normalizeGateway(
  channel: MessagingChannel,
  raw: Record<string, unknown>,
): ChannelGateway {
  const provider = getProviderDef(channel, raw.provider)
    ? (raw.provider as MessagingProviderId)
    : DEFAULT_PROVIDER[channel];
  return {
    provider,
    credentials: cleanCredentials(channel, provider, raw.credentials),
    templates: getProviderDef(channel, provider)?.templates
      ? normalizeTemplates(raw.templates)
      : {},
  };
}

export function defaultEventSwitches(): EventSwitches {
  const out = {} as EventSwitches;
  for (const event of MESSAGING_EVENTS) {
    out[event] = { sms: true, whatsapp: true };
  }
  return out;
}

export function normalizeEventSwitches(raw: unknown): EventSwitches {
  const source = record(raw);
  const out = defaultEventSwitches();
  for (const event of MESSAGING_EVENTS) {
    const entry = record(source[event]);
    for (const channel of MESSAGING_CHANNELS) {
      if (typeof entry[channel] === "boolean") {
        out[event][channel] = entry[channel] as boolean;
      }
    }
  }
  return out;
}

/** An office's settings with every gap filled: nothing is on until chosen. */
export function normalizeOfficeSettings(raw: unknown): OfficeMessagingSettings {
  const source = record(raw);
  const channel = (name: MessagingChannel): OfficeChannelSettings => {
    const entry = record(source[name]);
    return {
      enabled: entry.enabled === true,
      useOwnGateway: entry.useOwnGateway === true,
      ...normalizeGateway(name, entry),
    };
  };
  return {
    sms: channel("sms"),
    whatsapp: channel("whatsapp"),
    events: normalizeEventSwitches(source.events),
  };
}

export function normalizePlatformSettings(
  raw: unknown,
): PlatformMessagingSettings {
  const source = record(raw);
  const channel = (name: MessagingChannel): PlatformChannelSettings => {
    const entry = record(source[name]);
    return { enabled: entry.enabled === true, ...normalizeGateway(name, entry) };
  };
  return { sms: channel("sms"), whatsapp: channel("whatsapp") };
}

// ============================================================================
// What a browser may see
// ============================================================================

/** A gateway without its secrets: text fields as they are, secrets as "set". */
export interface GatewayView {
  provider: MessagingProviderId;
  credentials: Record<string, string>;
  secretsSet: Record<string, boolean>;
  templates: TemplateMap;
}

export function gatewayView(
  channel: MessagingChannel,
  gateway: ChannelGateway,
): GatewayView {
  const credentials: Record<string, string> = {};
  const secretsSet: Record<string, boolean> = {};
  for (const field of getProviderDef(channel, gateway.provider)?.fields ?? []) {
    if (field.type === "secret") {
      secretsSet[field.key] = Boolean(gateway.credentials[field.key]);
    } else {
      credentials[field.key] = gateway.credentials[field.key] ?? "";
    }
  }
  return {
    provider: gateway.provider,
    credentials,
    secretsSet,
    templates: gateway.templates,
  };
}

// ============================================================================
// Applying a form submission
// ============================================================================

export interface GatewayPatch {
  provider?: unknown;
  /** Text values replace; a secret left blank keeps the stored one. */
  credentials?: unknown;
  templates?: unknown;
}

/**
 * The stored gateway after a submission. Switching provider starts from empty
 * credentials: one provider's secret is never kept under another's name.
 */
export function applyGatewayPatch(
  channel: MessagingChannel,
  existing: ChannelGateway,
  patch: GatewayPatch,
  encrypt: Crypt,
  generateToken: () => string,
): ChannelGateway {
  const provider = getProviderDef(channel, patch.provider)
    ? (patch.provider as MessagingProviderId)
    : existing.provider;
  const def = getProviderDef(channel, provider)!;
  const kept = provider === existing.provider ? existing.credentials : {};
  const submitted = record(patch.credentials);

  const credentials: Record<string, string> = {};
  for (const field of def.fields) {
    const value = submitted[field.key];
    if (field.type === "secret") {
      const typed = typeof value === "string" ? value.trim() : "";
      const stored = typed ? encrypt(typed) || "" : kept[field.key] || "";
      if (stored) credentials[field.key] = stored;
    } else {
      const text =
        typeof value === "string" ? value.trim().slice(0, 500) : kept[field.key];
      if (text) credentials[field.key] = text;
    }
  }

  // Meta asks for a verify token when its webhook is set up; one the office
  // never has to invent is one it cannot get wrong.
  if (provider === "meta" && !credentials.verifyToken) {
    credentials.verifyToken = generateToken();
  }

  return {
    provider,
    credentials,
    templates: def.templates
      ? patch.templates === undefined
        ? existing.templates
        : normalizeTemplates(patch.templates)
      : {},
  };
}

/** The required fields a gateway still lacks (encrypted secrets count). */
export function gatewayMissing(
  channel: MessagingChannel,
  gateway: ChannelGateway,
): string[] {
  return missingRequiredFields(channel, gateway.provider, gateway.credentials);
}

// ============================================================================
// Choosing the gateway a send uses
// ============================================================================

function decryptGateway(
  channel: MessagingChannel,
  gateway: ChannelGateway,
  source: GatewaySource,
  decrypt: Crypt,
): ResolvedGateway | null {
  const def = getProviderDef(channel, gateway.provider);
  if (!def) return null;
  const credentials: Record<string, string> = {};
  for (const field of def.fields) {
    const value = gateway.credentials[field.key];
    if (!value) continue;
    if (field.type === "secret") {
      // A secret that no longer decrypts (the key was rotated) is a missing
      // secret, not a crash in the middle of a reminder sweep.
      try {
        const plain = decrypt(value);
        if (plain) credentials[field.key] = plain;
      } catch {
        continue;
      }
    } else {
      credentials[field.key] = value;
    }
  }
  if (missingRequiredFields(channel, gateway.provider, credentials).length) {
    return null;
  }
  return {
    channel,
    provider: gateway.provider,
    source,
    credentials,
    templates: gateway.templates,
  };
}

/**
 * The gateway a message on this channel goes through, or null when there is
 * none. An office that chose its own account uses it or nothing: falling back
 * to the platform's would put its messages on the platform's bill without
 * anyone deciding so.
 */
export function resolveGateway(
  channel: MessagingChannel,
  office: OfficeMessagingSettings | null,
  platform: PlatformMessagingSettings | null,
  env: ChannelGateway | null,
  decrypt: Crypt,
): ResolvedGateway | null {
  const own = office?.[channel];
  if (own?.useOwnGateway) {
    return decryptGateway(channel, own, "office", decrypt);
  }
  const shared = platform?.[channel];
  if (shared?.enabled) {
    const resolved = decryptGateway(channel, shared, "platform", decrypt);
    if (resolved) return resolved;
  }
  if (env) {
    return decryptGateway(channel, env, "env", (value) => value);
  }
  return null;
}

/**
 * The deployment's own gateway from environment variables — the last
 * fallback, kept so a server configured before the settings screens existed
 * still sends.
 */
export function envGateway(
  channel: MessagingChannel,
  env: Record<string, string | undefined>,
): ChannelGateway | null {
  const pick = (map: Record<string, string>): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const [key, name] of Object.entries(map)) {
      const value = env[name]?.trim();
      if (value) out[key] = value;
    }
    return out;
  };

  if (channel === "sms") {
    const provider = (env.SMS_PROVIDER || "").trim().toLowerCase();
    const maps: Record<string, Record<string, string>> = {
      unifonic: { appSid: "UNIFONIC_APP_SID", senderId: "UNIFONIC_SENDER_ID" },
      taqnyat: { apiToken: "TAQNYAT_API_TOKEN", senderId: "TAQNYAT_SENDER_ID" },
      msegat: {
        userName: "MSEGAT_USERNAME",
        apiKey: "MSEGAT_API_KEY",
        senderId: "MSEGAT_SENDER_ID",
      },
      twilio: {
        accountSid: "TWILIO_ACCOUNT_SID",
        authToken: "TWILIO_AUTH_TOKEN",
        senderId: "TWILIO_SMS_FROM",
      },
    };
    if (!maps[provider]) return null;
    return {
      provider: provider as MessagingProviderId,
      credentials: pick(maps[provider]),
      templates: {},
    };
  }

  const provider = (env.WHATSAPP_PROVIDER || "").trim().toLowerCase();
  const maps: Record<string, Record<string, string>> = {
    meta: {
      phoneNumberId: "WHATSAPP_PHONE_NUMBER_ID",
      accessToken: "WHATSAPP_ACCESS_TOKEN",
      appSecret: "WHATSAPP_APP_SECRET",
      verifyToken: "WHATSAPP_VERIFY_TOKEN",
    },
    twilio: {
      accountSid: "TWILIO_ACCOUNT_SID",
      authToken: "TWILIO_AUTH_TOKEN",
      senderId: "TWILIO_WHATSAPP_FROM",
    },
  };
  if (!maps[provider]) return null;
  return {
    provider: provider as MessagingProviderId,
    credentials: pick(maps[provider]),
    templates: {},
  };
}

/**
 * The approved template for an event in a language, falling back to the
 * other language's when only one was set up.
 */
export function pickTemplate(
  templates: TemplateMap,
  event: MessagingEvent,
  language: string,
): TemplateRef | null {
  const entry = templates[event];
  if (!entry) return null;
  const wanted: TemplateLanguage = language === "ar" ? "ar" : "en";
  const other: TemplateLanguage = wanted === "ar" ? "en" : "ar";
  return entry[wanted] ?? entry[other] ?? null;
}
