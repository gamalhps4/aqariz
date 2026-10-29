"use client";

/**
 * PropertyPro - Settings → SMS & WhatsApp
 *
 * Per channel: on or off, and whether the office sends through the platform's
 * gateway (counted against its package's monthly messages) or its own
 * provider account — Unifonic, Taqnyat, Msegat or Twilio for SMS; the Meta
 * WhatsApp Cloud API or Twilio for WhatsApp — with a test send. Then which
 * events go out on each channel, the WhatsApp templates, and the log of every
 * message. For whoever holds "System settings".
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  MessageCircle,
  MessageSquare,
} from "lucide-react";
import { useSession } from "@/lib/auth-client";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CopyField,
  GatewayFields,
  TemplateEditor,
  TestSend,
  missingFieldsText,
  type GatewayFormValue,
} from "@/components/settings/messaging/messaging-parts";
import { MessageLog } from "@/components/settings/messaging/message-log";
import {
  MESSAGING_CHANNELS,
  MESSAGING_EVENTS,
  getProviderDef,
  type MessagingChannel,
} from "@/lib/messaging/registry";
import type { EventSwitches } from "@/lib/messaging/config";

interface ChannelForm extends GatewayFormValue {
  enabled: boolean;
  useOwnGateway: boolean;
}

interface ServerData {
  sms: ChannelForm;
  whatsapp: ChannelForm;
  events: EventSwitches;
  platform: Record<MessagingChannel, { ready: boolean; provider: string | null }>;
  usage: { used: number; limit: number | null; planName: string | null };
  webhooks: { meta: string; twilio: string } | null;
}

interface FormState {
  sms: ChannelForm;
  whatsapp: ChannelForm;
  events: EventSwitches;
}

function toForm(data: ServerData): FormState {
  const channel = (value: ChannelForm): ChannelForm => ({
    enabled: value.enabled,
    useOwnGateway: value.useOwnGateway,
    provider: value.provider,
    credentials: { ...value.credentials },
    secretsSet: { ...value.secretsSet },
    templates: value.templates ?? {},
  });
  return {
    sms: channel(data.sms),
    whatsapp: channel(data.whatsapp),
    events: data.events,
  };
}

const CHANNEL_ICON = { sms: MessageSquare, whatsapp: MessageCircle } as const;

export default function MessagingSettingsPage() {
  const router = useRouter();
  const { t } = useLocalizationContext();
  const { status } = useSession();
  const { canManageSystemSettings, isLoading: authzLoading } = useAuthorization();

  const [data, setData] = useState<ServerData | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState("gateways");

  // For whoever holds "System settings" — the permission the API asks for.
  useEffect(() => {
    if (status === "authenticated" && !authzLoading && !canManageSystemSettings) {
      router.replace("/dashboard/settings/profile");
    }
  }, [status, authzLoading, canManageSystemSettings, router]);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/settings/messaging", { cache: "no-store" });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error);
      setData(json.data);
      setForm(toForm(json.data));
      setDirty(false);
    } catch {
      toast.error(
        t("settings.messaging.loadFailed", {
          defaultValue: "Could not load the messaging settings",
        }),
      );
    }
  }, [t]);

  useEffect(() => {
    if (status === "authenticated" && canManageSystemSettings) void load();
  }, [status, canManageSystemSettings, load]);

  const patchChannel = (channel: MessagingChannel, next: Partial<ChannelForm>) => {
    setForm((current) =>
      current ? { ...current, [channel]: { ...current[channel], ...next } } : current,
    );
    setDirty(true);
  };

  const setEvent = (
    event: (typeof MESSAGING_EVENTS)[number],
    channel: MessagingChannel,
    on: boolean,
  ) => {
    setForm((current) =>
      current
        ? {
            ...current,
            events: {
              ...current.events,
              [event]: { ...current.events[event], [channel]: on },
            },
          }
        : current,
    );
    setDirty(true);
  };

  const save = async () => {
    if (!form) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = { events: form.events };
      for (const channel of MESSAGING_CHANNELS) {
        const value = form[channel];
        body[channel] = {
          enabled: value.enabled,
          useOwnGateway: value.useOwnGateway,
          provider: value.provider,
          credentials: value.credentials,
          templates: value.templates,
        };
      }
      const response = await fetch("/api/settings/messaging", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await response.json();
      if (!response.ok || !json.success) {
        throw new Error(
          missingFieldsText(t, json.code) ||
            json.error ||
            t("settings.common.saveFailed", {
              defaultValue: "Could not save the settings",
            }),
        );
      }
      setData(json.data);
      setForm(toForm(json.data));
      setDirty(false);
      toast.success(
        t("settings.messaging.saved", { defaultValue: "Messaging settings saved" }),
      );
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const header = (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("settings.messaging.title", { defaultValue: "SMS & WhatsApp" })}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("settings.messaging.subtitle", {
            defaultValue:
              "Text your tenants and owners by SMS and WhatsApp, through the platform's gateway or your own provider account.",
          })}
        </p>
      </div>
      {tab !== "log" && (
        <Button onClick={save} disabled={!dirty || saving || !form}>
          {saving && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
          {dirty
            ? t("settings.messaging.save", { defaultValue: "Save changes" })
            : t("settings.messaging.allSaved", { defaultValue: "All changes saved" })}
        </Button>
      )}
    </div>
  );

  if (!data || !form) {
    return (
      <div className="container mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
        {header}
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-72 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  const usage = data.usage;
  const whatsapp = form.whatsapp;
  const templatesEditable =
    whatsapp.useOwnGateway && getProviderDef("whatsapp", whatsapp.provider)?.templates;

  return (
    <div className="container mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      {header}

      {/* This month's messages on the platform's gateway */}
      <div className="rounded-lg bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_6px_18px_rgba(15,23,42,0.025)] dark:shadow-none">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium">
            {t("settings.messaging.usage.title", {
              defaultValue: "This month's messages",
            })}
          </p>
          <p className="text-sm tabular-nums">
            {usage.limit === null
              ? t("settings.messaging.usage.unlimited", {
                  defaultValue: "{used} through the platform's gateway, no monthly limit",
                  values: { used: usage.used },
                })
              : t("settings.messaging.usage.value", {
                  defaultValue: "{used} of {limit} through the platform's gateway",
                  values: { used: usage.used, limit: usage.limit },
                })}
          </p>
        </div>
        {usage.limit !== null && usage.limit > 0 ? (
          <Progress
            className="mt-3 h-2"
            value={Math.min(100, (usage.used / usage.limit) * 100)}
          />
        ) : null}
        <p className="mt-2 text-xs text-muted-foreground">
          {t("settings.messaging.usage.hint", {
            defaultValue:
              "Messages through your own provider account do not count. The limit comes with your package.",
          })}
        </p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="gateways">
            {t("settings.messaging.tab.gateways", { defaultValue: "Gateways" })}
          </TabsTrigger>
          <TabsTrigger value="events">
            {t("settings.messaging.tab.events", { defaultValue: "What to send" })}
          </TabsTrigger>
          <TabsTrigger value="log">
            {t("settings.messaging.tab.log", { defaultValue: "Message log" })}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="gateways" className="space-y-6">
          {MESSAGING_CHANNELS.map((channel) => {
            const value = form[channel];
            const Icon = CHANNEL_ICON[channel];
            const platform = data.platform[channel];
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
                      <CardDescription>
                        {t(`settings.messaging.channelHint.${channel}`, {
                          defaultValue: "",
                        })}
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      <Label htmlFor={`enable-${channel}`} className="text-sm">
                        {t(`settings.messaging.enable.${channel}`, {
                          defaultValue: "On",
                        })}
                      </Label>
                      <Switch
                        id={`enable-${channel}`}
                        checked={value.enabled}
                        onCheckedChange={(enabled) => patchChannel(channel, { enabled })}
                      />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div
                    role="radiogroup"
                    aria-label={t("settings.messaging.gateway.label", {
                      defaultValue: "Gateway",
                    })}
                    className="grid gap-3 sm:grid-cols-2"
                  >
                    {[false, true].map((own) => {
                      const selected = value.useOwnGateway === own;
                      return (
                        <button
                          key={String(own)}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          onClick={() => patchChannel(channel, { useOwnGateway: own })}
                          className={`rounded-lg border p-4 text-start transition-colors ${
                            selected
                              ? "border-primary bg-primary/5"
                              : "hover:bg-muted/50"
                          }`}
                        >
                          <p className="text-sm font-medium">
                            {own
                              ? t("settings.messaging.gateway.own", {
                                  defaultValue: "Our own provider account",
                                })
                              : t("settings.messaging.gateway.platform", {
                                  defaultValue: "The platform's gateway",
                                })}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {own
                              ? t("settings.messaging.gateway.ownHint", {
                                  defaultValue:
                                    "Your provider bills you directly; no monthly limit from us.",
                                })
                              : t("settings.messaging.gateway.platformHint", {
                                  defaultValue:
                                    "Counts toward your package's monthly messages.",
                                })}
                          </p>
                          {!own && (
                            <p className="mt-2 flex items-center gap-1 text-xs">
                              {platform.ready ? (
                                <>
                                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                                  {t("settings.messaging.gateway.platformReady", {
                                    defaultValue: "Available",
                                  })}
                                </>
                              ) : (
                                <>
                                  <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                                  {t("settings.messaging.gateway.platformMissing", {
                                    defaultValue: "Not set up by the platform yet",
                                  })}
                                </>
                              )}
                            </p>
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {value.useOwnGateway && (
                    <>
                      <GatewayFields
                        channel={channel}
                        idPrefix={channel}
                        value={value}
                        onChange={(next) => patchChannel(channel, next)}
                      />
                      <div className="space-y-2 rounded-lg bg-muted/40 p-4">
                        <p className="text-sm font-medium">
                          {t("settings.messaging.webhook.title", {
                            defaultValue: "Delivery reports",
                          })}
                        </p>
                        {def?.deliveryReports === "app-webhook" && data.webhooks ? (
                          <>
                            <p className="text-xs text-muted-foreground">
                              {t("settings.messaging.webhook.meta", {
                                defaultValue:
                                  "In your Meta app, set the WhatsApp webhook to this URL with the verify token above, and subscribe to “messages”.",
                              })}
                            </p>
                            <CopyField
                              label={t("settings.messaging.webhook.url", {
                                defaultValue: "Webhook URL",
                              })}
                              value={data.webhooks.meta}
                            />
                          </>
                        ) : def?.deliveryReports === "per-message" ? (
                          <p className="text-xs text-muted-foreground">
                            {t("settings.messaging.webhook.twilio", {
                              defaultValue:
                                "Twilio reports delivery by itself; nothing to set up.",
                            })}
                          </p>
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            {t("settings.messaging.webhook.none", {
                              defaultValue:
                                "This provider does not report delivery; messages stay “Sent” in the log.",
                            })}
                          </p>
                        )}
                      </div>
                    </>
                  )}

                  <TestSend
                    channel={channel}
                    endpoint="/api/settings/messaging/test"
                    disabled={dirty}
                    disabledHint={t("settings.messaging.test.saveFirst", {
                      defaultValue: "Save your changes first.",
                    })}
                  />
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        <TabsContent value="events" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>
                {t("settings.messaging.events.title", { defaultValue: "What to send" })}
              </CardTitle>
              <CardDescription>
                {t("settings.messaging.events.hint", {
                  defaultValue:
                    "Choose which notices also go out by SMS and WhatsApp. Email and in-app notices are not affected.",
                })}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="divide-y rounded-lg border">
                <div className="grid grid-cols-[1fr_auto_auto] items-center gap-4 bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground">
                  <span>
                    {t("settings.messaging.events.event", { defaultValue: "Event" })}
                  </span>
                  {MESSAGING_CHANNELS.map((channel) => (
                    <span key={channel} className="w-20 text-center">
                      {t(`settings.messaging.channel.${channel}`, {
                        defaultValue: channel,
                      })}
                    </span>
                  ))}
                </div>
                {MESSAGING_EVENTS.map((event) => (
                  <div
                    key={event}
                    className="grid grid-cols-[1fr_auto_auto] items-center gap-4 px-4 py-3"
                  >
                    <span className="text-sm">
                      {t(`settings.messaging.event.${event}`, { defaultValue: event })}
                    </span>
                    {MESSAGING_CHANNELS.map((channel) => (
                      <div key={channel} className="flex w-20 justify-center">
                        <Switch
                          aria-label={`${t(`settings.messaging.event.${event}`, {
                            defaultValue: event,
                          })} — ${t(`settings.messaging.channel.${channel}`, {
                            defaultValue: channel,
                          })}`}
                          checked={form.events[event][channel]}
                          disabled={!form[channel].enabled}
                          onCheckedChange={(on) => setEvent(event, channel, on)}
                        />
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              {MESSAGING_CHANNELS.some((channel) => !form[channel].enabled) && (
                <p className="mt-3 text-xs text-muted-foreground">
                  {t("settings.messaging.events.channelOff", {
                    defaultValue:
                      "A channel that is switched off on the Gateways tab sends nothing.",
                  })}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {t("settings.messaging.templates.title", {
                  defaultValue: "WhatsApp templates",
                })}
                {templatesEditable ? (
                  <Badge variant="secondary">Meta</Badge>
                ) : null}
              </CardTitle>
              <CardDescription>
                {templatesEditable
                  ? t("settings.messaging.templates.hint", {
                      defaultValue:
                        "WhatsApp delivers a reminder only as a template Meta has approved. Create one per event and language in WhatsApp Manager with named parameters, then enter its name here.",
                    })
                  : whatsapp.useOwnGateway
                    ? t("settings.messaging.templates.notMeta", {
                        defaultValue:
                          "Templates apply to the Meta WhatsApp Cloud API.",
                      })
                    : t("settings.messaging.templates.platformManaged", {
                        defaultValue:
                          "You use the platform's WhatsApp gateway; its templates are set up by the platform.",
                      })}
              </CardDescription>
            </CardHeader>
            {templatesEditable ? (
              <CardContent>
                <TemplateEditor
                  value={whatsapp.templates}
                  onChange={(templates) => patchChannel("whatsapp", { templates })}
                />
              </CardContent>
            ) : null}
          </Card>
        </TabsContent>

        <TabsContent value="log">
          <MessageLog />
        </TabsContent>
      </Tabs>
    </div>
  );
}
