"use client";

/**
 * PropertyPro SaaS - Admin → Settings → Messaging
 *
 * The default SMS and WhatsApp gateway: offices that have not connected their
 * own provider account send through it, up to their package's monthly
 * message quota (Admin → Plans). Saved on its own, apart from the page's
 * other settings. Reads and writes /api/admin/settings/messaging.
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertCircle,
  Loader2,
  MessageCircle,
  MessageSquare,
  Server,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import {
  CopyField,
  GatewayFields,
  TemplateEditor,
  TestSend,
  missingFieldsText,
  type GatewayFormValue,
} from "@/components/settings/messaging/messaging-parts";
import {
  MESSAGING_CHANNELS,
  getProviderDef,
  type MessagingChannel,
} from "@/lib/messaging/registry";

interface ChannelForm extends GatewayFormValue {
  enabled: boolean;
}

interface ServerData {
  sms: ChannelForm;
  whatsapp: ChannelForm;
  available: boolean;
  env: Record<MessagingChannel, string | null>;
  webhooks: { meta: string; twilio: string };
}

const CHANNEL_ICON = { sms: MessageSquare, whatsapp: MessageCircle } as const;

function toForm(value: ChannelForm): ChannelForm {
  return {
    enabled: value.enabled,
    provider: value.provider,
    credentials: { ...value.credentials },
    secretsSet: { ...value.secretsSet },
    templates: value.templates ?? {},
  };
}

export function PlatformMessagingSettings() {
  const { t } = useLocalizationContext();
  const [data, setData] = useState<ServerData | null>(null);
  const [form, setForm] = useState<Record<MessagingChannel, ChannelForm> | null>(
    null,
  );
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const apply = (payload: ServerData) => {
    setData(payload);
    setForm({ sms: toForm(payload.sms), whatsapp: toForm(payload.whatsapp) });
    setDirty(false);
  };

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/settings/messaging", {
        cache: "no-store",
      });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error);
      apply(json.data);
      setError("");
    } catch {
      setError(
        t("platform.messaging.loadFailed", {
          defaultValue: "Could not load the messaging gateway",
        }),
      );
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = (channel: MessagingChannel, next: Partial<ChannelForm>) => {
    setForm((current) =>
      current ? { ...current, [channel]: { ...current[channel], ...next } } : current,
    );
    setDirty(true);
  };

  const save = async () => {
    if (!form) return;
    setSaving(true);
    try {
      const body = Object.fromEntries(
        MESSAGING_CHANNELS.map((channel) => [
          channel,
          {
            enabled: form[channel].enabled,
            provider: form[channel].provider,
            credentials: form[channel].credentials,
            templates: form[channel].templates,
          },
        ]),
      );
      const response = await fetch("/api/admin/settings/messaging", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await response.json();
      if (!response.ok || !json.success) {
        throw new Error(
          missingFieldsText(t, json.code) ||
            json.error ||
            t("platform.settings.saveFailed", { defaultValue: "Failed to save" }),
        );
      }
      apply(json.data);
      toast.success(
        t("platform.messaging.saved", { defaultValue: "Messaging gateway saved" }),
      );
    } catch (saveError) {
      toast.error((saveError as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }
  if (!data || !form) {
    return (
      <div className="flex justify-center p-10">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl space-y-1">
          <h2 className="text-lg font-semibold">
            {t("platform.messaging.heading", {
              defaultValue: "Default SMS & WhatsApp gateway",
            })}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t("platform.messaging.hint", {
              defaultValue:
                "Offices without their own provider account send through this gateway, up to their package's monthly message quota (Plans).",
            })}
          </p>
        </div>
        <Button onClick={save} disabled={!dirty || saving || !data.available}>
          {saving && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
          {t("platform.messaging.save", { defaultValue: "Save gateway" })}
        </Button>
      </div>

      {!data.available && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {t("platform.messaging.notAvailable", {
              defaultValue:
                "Apply the database update (migration 20261004113500_messaging) to save a default gateway.",
            })}
          </AlertDescription>
        </Alert>
      )}

      {MESSAGING_CHANNELS.map((channel) => {
        const value = form[channel];
        const Icon = CHANNEL_ICON[channel];
        const def = getProviderDef(channel, value.provider);
        return (
          <Card key={channel}>
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <CardTitle className="flex items-center gap-2">
                    <Icon className="h-5 w-5" />
                    {t(`settings.messaging.channel.${channel}`, {
                      defaultValue: channel,
                    })}
                  </CardTitle>
                  {data.env[channel] && (
                    <CardDescription className="flex items-center gap-1.5">
                      <Server className="h-3.5 w-3.5" />
                      {t("platform.messaging.envInUse", {
                        defaultValue:
                          "The server's environment sets up {provider}; it is used while this gateway is off.",
                        values: {
                          provider:
                            getProviderDef(channel, data.env[channel])?.name ??
                            data.env[channel] ??
                            "",
                        },
                      })}
                    </CardDescription>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Label htmlFor={`platform-enable-${channel}`} className="text-sm">
                    {t(`platform.messaging.enable.${channel}`, {
                      defaultValue: "Offer to offices",
                    })}
                  </Label>
                  <Switch
                    id={`platform-enable-${channel}`}
                    checked={value.enabled}
                    onCheckedChange={(enabled) => patch(channel, { enabled })}
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <GatewayFields
                channel={channel}
                idPrefix={`platform-${channel}`}
                value={value}
                onChange={(next) => patch(channel, next)}
              />

              {def?.deliveryReports === "app-webhook" && (
                <div className="space-y-2 rounded-lg bg-muted/40 p-4">
                  <p className="text-xs text-muted-foreground">
                    {t("platform.messaging.webhookHint", {
                      defaultValue:
                        "For WhatsApp delivery reports, set the Meta app's webhook to this URL with the verify token above.",
                    })}
                  </p>
                  <CopyField
                    label={t("settings.messaging.webhook.url", {
                      defaultValue: "Webhook URL",
                    })}
                    value={data.webhooks.meta}
                  />
                </div>
              )}

              {def?.templates && (
                <div className="space-y-3">
                  <div>
                    <p className="text-sm font-medium">
                      {t("settings.messaging.templates.title", {
                        defaultValue: "WhatsApp templates",
                      })}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("settings.messaging.templates.hint", {
                        defaultValue:
                          "WhatsApp delivers a reminder only as a template Meta has approved. Create one per event and language in WhatsApp Manager with named parameters, then enter its name here.",
                      })}
                    </p>
                  </div>
                  <TemplateEditor
                    value={value.templates}
                    onChange={(templates) => patch(channel, { templates })}
                  />
                </div>
              )}

              <TestSend
                channel={channel}
                endpoint="/api/admin/settings/messaging/test"
                disabled={dirty}
                disabledHint={t("settings.messaging.test.saveFirst", {
                  defaultValue: "Save your changes first.",
                })}
              />
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
