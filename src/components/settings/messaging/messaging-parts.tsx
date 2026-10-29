"use client";

/**
 * PropertyPro - Pieces shared by the office's Settings → SMS & WhatsApp page
 * and the Super Admin's default gateway tab: the provider picker with its
 * credential fields (from src/lib/messaging/registry.ts), the WhatsApp
 * template editor, the test send, and the wording of a send's outcome.
 */

import { useState } from "react";
import { toast } from "sonner";
import { Check, Copy, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import {
  EVENT_TEMPLATE_PARAMS,
  MESSAGING_EVENTS,
  TEMPLATE_LANGUAGES,
  getProviderDef,
  providersFor,
  type MessagingChannel,
  type MessagingEvent,
  type TemplateLanguage,
} from "@/lib/messaging/registry";
import type { TemplateMap, TemplateRef } from "@/lib/messaging/config";

type Translate = ReturnType<typeof useLocalizationContext>["t"];

/** One channel's account as the form holds it. */
export interface GatewayFormValue {
  provider: string;
  /** Text values as stored; secrets as typed (blank keeps the stored one). */
  credentials: Record<string, string>;
  secretsSet: Record<string, boolean>;
  templates: TemplateMap;
}

/**
 * What an API error code from a send means, in words: "blocked:opted_out",
 * "skipped:not_configured", "failed:<provider's message>".
 */
export function messagingOutcomeText(
  t: Translate,
  code: string | undefined,
  fallback: string,
): string {
  const [status, ...rest] = (code ?? "").split(":");
  const reason = rest.join(":");
  if (status === "failed") {
    return t("settings.messaging.sendFailed", {
      defaultValue: "Not sent: {reason}",
      values: { reason: reason || fallback },
    });
  }
  if ((status === "blocked" || status === "skipped") && reason) {
    return t(`settings.messaging.reason.${reason}`, { defaultValue: fallback });
  }
  return fallback;
}

/** The labels of missing fields from a "missing_fields:<channel>:a,b" code. */
export function missingFieldsText(t: Translate, code: string | undefined): string | null {
  const match = /^missing_fields:(sms|whatsapp):(.+)$/.exec(code ?? "");
  if (!match) return null;
  const fields = match[2]
    .split(",")
    .map((key) => t(`settings.messaging.field.${key}`, { defaultValue: key }))
    .join("، ");
  return t("settings.messaging.missingFields", {
    defaultValue: "Fill in {fields} for {channel}",
    values: {
      fields,
      channel: t(`settings.messaging.channel.${match[1]}`, { defaultValue: match[1] }),
    },
  });
}

export function GatewayFields({
  channel,
  value,
  onChange,
  idPrefix,
}: {
  channel: MessagingChannel;
  value: GatewayFormValue;
  onChange: (next: GatewayFormValue) => void;
  idPrefix: string;
}) {
  const { t } = useLocalizationContext();
  const def = getProviderDef(channel, value.provider);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-provider`}>
          {t("settings.messaging.provider", { defaultValue: "Provider" })}
        </Label>
        <Select
          value={value.provider}
          onValueChange={(provider) =>
            onChange({
              ...value,
              provider,
              // One provider's details never carry over to another's.
              credentials: {},
              secretsSet: {},
            })
          }
        >
          <SelectTrigger id={`${idPrefix}-provider`} className="sm:max-w-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {providersFor(channel).map((provider) => (
              <SelectItem key={provider.id} value={provider.id}>
                {provider.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {def?.fields.map((field) => {
          const id = `${idPrefix}-${field.key}`;
          const stored = field.type === "secret" && value.secretsSet[field.key];
          return (
            <div key={field.key} className="space-y-2">
              <Label htmlFor={id}>
                {t(`settings.messaging.field.${field.key}`, {
                  defaultValue: field.key,
                })}
                {field.required ? <span className="text-destructive"> *</span> : null}
              </Label>
              <Input
                id={id}
                dir="ltr"
                type={field.type === "secret" ? "password" : "text"}
                autoComplete={field.type === "secret" ? "new-password" : "off"}
                placeholder={
                  stored
                    ? t("settings.messaging.secretStored", {
                        defaultValue: "Stored — type to replace",
                      })
                    : field.placeholder
                }
                value={value.credentials[field.key] ?? ""}
                onChange={(event) =>
                  onChange({
                    ...value,
                    credentials: {
                      ...value.credentials,
                      [field.key]: event.target.value,
                    },
                  })
                }
              />
              {field.hint ? (
                <p className="text-xs text-muted-foreground">
                  {t(`settings.messaging.fieldHint.${field.key}`, {
                    defaultValue: "",
                  })}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** A URL to paste into a provider's dashboard, with a copy button. */
export function CopyField({ label, value }: { label: string; value: string }) {
  const { t } = useLocalizationContext();
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="flex items-center gap-2">
        <Input dir="ltr" readOnly value={value} className="font-mono text-xs" />
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={t("settings.messaging.webhook.copy", { defaultValue: "Copy" })}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              toast.error(value);
            }
          }}
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}

/**
 * The WhatsApp templates for the Meta Cloud API: per event and language, the
 * approved template's name, its language code and the named parameters its
 * body uses.
 */
export function TemplateEditor({
  value,
  onChange,
}: {
  value: TemplateMap;
  onChange: (next: TemplateMap) => void;
}) {
  const { t } = useLocalizationContext();

  const update = (
    event: MessagingEvent,
    language: TemplateLanguage,
    patch: Partial<TemplateRef> | null,
  ) => {
    const current = value[event]?.[language];
    const byLanguage = { ...(value[event] ?? {}) };
    if (patch === null) {
      delete byLanguage[language];
    } else {
      byLanguage[language] = {
        name: current?.name ?? "",
        language: current?.language ?? language,
        params: current?.params ?? [...EVENT_TEMPLATE_PARAMS[event]],
        ...patch,
      };
    }
    onChange({ ...value, [event]: byLanguage });
  };

  return (
    <div className="space-y-4">
      {MESSAGING_EVENTS.map((event) => (
        <div key={event} className="space-y-3 rounded-lg border p-4">
          <p className="text-sm font-medium">
            {t(`settings.messaging.event.${event}`, { defaultValue: event })}
          </p>
          <div className="grid gap-4 lg:grid-cols-2">
            {TEMPLATE_LANGUAGES.map((language) => {
              const template = value[event]?.[language];
              const idBase = `tpl-${event}-${language}`;
              return (
                <div key={language} className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    {t(`settings.messaging.templates.lang.${language}`, {
                      defaultValue: language,
                    })}
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    <Input
                      id={`${idBase}-name`}
                      dir="ltr"
                      className="col-span-2"
                      aria-label={t("settings.messaging.templates.name", {
                        defaultValue: "Template name",
                      })}
                      placeholder={t("settings.messaging.templates.name", {
                        defaultValue: "Template name",
                      })}
                      value={template?.name ?? ""}
                      onChange={(e) =>
                        e.target.value.trim()
                          ? update(event, language, { name: e.target.value })
                          : update(event, language, null)
                      }
                    />
                    <Input
                      id={`${idBase}-language`}
                      dir="ltr"
                      aria-label={t("settings.messaging.templates.language", {
                        defaultValue: "Language code",
                      })}
                      placeholder={language}
                      disabled={!template}
                      value={template?.language ?? ""}
                      onChange={(e) =>
                        update(event, language, { language: e.target.value })
                      }
                    />
                  </div>
                  {template ? (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">
                        {t("settings.messaging.templates.params", {
                          defaultValue: "Parameters its body uses",
                        })}
                      </p>
                      <div className="flex flex-wrap gap-x-4 gap-y-1">
                        {EVENT_TEMPLATE_PARAMS[event].map((param) => {
                          const checked = template.params.includes(param);
                          return (
                            <label
                              key={param}
                              className="flex items-center gap-1.5 text-xs"
                              dir="ltr"
                            >
                              <Checkbox
                                checked={checked}
                                onCheckedChange={(next) =>
                                  update(event, language, {
                                    params: next
                                      ? [...template.params, param]
                                      : template.params.filter((p) => p !== param),
                                  })
                                }
                              />
                              <code>{`{{${param}}}`}</code>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/** One test message to a typed number, through the saved settings. */
export function TestSend({
  channel,
  endpoint,
  disabled,
  disabledHint,
}: {
  channel: MessagingChannel;
  endpoint: string;
  disabled?: boolean;
  disabledHint?: string;
}) {
  const { t, language } = useLocalizationContext();
  const [phone, setPhone] = useState("");
  const [sending, setSending] = useState(false);

  const send = async () => {
    if (!phone.trim()) {
      toast.error(
        t("settings.messaging.test.needPhone", {
          defaultValue: "Enter the number to send to",
        }),
      );
      return;
    }
    setSending(true);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, phone, language }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json.success) {
        throw new Error(
          messagingOutcomeText(
            t,
            json.code,
            json.error ||
              t("settings.messaging.test.failed", {
                defaultValue: "The test message was not sent",
              }),
          ),
        );
      }
      toast.success(
        t("settings.messaging.test.sent", { defaultValue: "Test message sent" }),
      );
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-2 border-t pt-4">
      <Label htmlFor={`test-${channel}`}>
        {t("settings.messaging.test.title", { defaultValue: "Send a test" })}
      </Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id={`test-${channel}`}
          dir="ltr"
          type="tel"
          inputMode="tel"
          placeholder="05XXXXXXXX"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="sm:max-w-xs"
        />
        <Button
          type="button"
          variant="outline"
          onClick={send}
          disabled={disabled || sending}
        >
          {sending ? (
            <Loader2 className="me-2 h-4 w-4 animate-spin" />
          ) : (
            <Send className="me-2 h-4 w-4" />
          )}
          {t("settings.messaging.test.send", { defaultValue: "Send test" })}
        </Button>
      </div>
      {disabled && disabledHint ? (
        <p className="text-xs text-muted-foreground">{disabledHint}</p>
      ) : null}
    </div>
  );
}
