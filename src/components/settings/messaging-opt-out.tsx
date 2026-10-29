"use client";

/**
 * PropertyPro - My SMS and WhatsApp choices (Settings → Profile)
 *
 * Whether the property office may text this person on each channel. Turning
 * one off stops every message on it — rent reminders included — and the
 * office's message log shows the blocked attempts as "opted out".
 */

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { MessageSquare } from "lucide-react";
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
  MESSAGING_CHANNELS,
  type MessagingChannel,
} from "@/lib/messaging/registry";

export function MessagingOptOutCard() {
  const { t } = useLocalizationContext();
  const [receives, setReceives] = useState<Record<MessagingChannel, boolean> | null>(
    null,
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings/profile/messaging", { cache: "no-store" })
      .then((response) => response.json())
      .then((json) => {
        if (!cancelled && json?.success) setReceives(json.data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!receives) return null;

  const change = async (channel: MessagingChannel, next: boolean) => {
    setSaving(true);
    try {
      const response = await fetch("/api/settings/profile/messaging", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [channel]: next }),
      });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error);
      setReceives(json.data);
      toast.success(
        t("settings.messaging.optOut.saved", { defaultValue: "Preferences saved" }),
      );
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageSquare className="h-4 w-4" />
          {t("settings.messaging.optOut.title", { defaultValue: "Text messages" })}
        </CardTitle>
        <CardDescription>
          {t("settings.messaging.optOut.hint", {
            defaultValue:
              "Choose how your property office may text you. Switching a channel off stops every message on it, reminders included.",
          })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {MESSAGING_CHANNELS.map((channel) => (
          <div key={channel} className="flex items-center justify-between gap-4">
            <Label htmlFor={`receive-${channel}`}>
              {t(`settings.messaging.optOut.${channel}`, { defaultValue: channel })}
            </Label>
            <Switch
              id={`receive-${channel}`}
              checked={receives[channel]}
              disabled={saving}
              onCheckedChange={(next) => void change(channel, next)}
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
