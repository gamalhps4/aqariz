"use client";

/**
 * PropertyPro - Send an SMS or WhatsApp message to a tenant or owner
 *
 * Opened from the client's communication history. The message goes through
 * the office's gateway (Settings → SMS & WhatsApp) and, once sent, is kept in
 * that history. A person who asked not to be messaged on a channel is not
 * messaged on it; staff record such a request here.
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { messagingOutcomeText } from "@/components/settings/messaging/messaging-parts";
import {
  MESSAGING_CHANNELS,
  type MessagingChannel,
} from "@/lib/messaging/registry";

const MAX_LENGTH = 1000;

interface Options {
  channels: Record<MessagingChannel, { enabled: boolean; ready: boolean }>;
  phone: string | null;
  phoneUsable: boolean;
  receives: Record<MessagingChannel, boolean>;
}

export function SendMessageDialog({
  clientId,
  open,
  onClose,
  onSent,
}: {
  clientId: string;
  open: boolean;
  onClose: () => void;
  onSent: () => void | Promise<void>;
}) {
  const { t } = useLocalizationContext();
  const [options, setOptions] = useState<Options | null>(null);
  const [channel, setChannel] = useState<MessagingChannel>("sms");
  const [body, setBody] = useState("");
  const [subject, setSubject] = useState("");
  const [sending, setSending] = useState(false);
  const [savingPreference, setSavingPreference] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/clients/${clientId}/messaging`, {
        cache: "no-store",
      });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error);
      setOptions(json.data);
      const usable = MESSAGING_CHANNELS.find(
        (value) => json.data.channels[value].enabled,
      );
      if (usable) setChannel(usable);
    } catch {
      toast.error(
        t("clients.communications.send.loadFailed", {
          defaultValue: "Could not load the message options",
        }),
      );
    }
  }, [clientId, t]);

  useEffect(() => {
    if (open) {
      setBody("");
      setSubject("");
      void load();
    }
  }, [open, load]);

  const state = options?.channels[channel];
  const receives = options?.receives[channel] ?? true;
  const blocker = !options
    ? null
    : !state?.enabled
      ? t("clients.communications.send.channelOff", {
          defaultValue:
            "This channel is switched off for your office (Settings → SMS & WhatsApp).",
        })
      : !state.ready
        ? t("clients.communications.send.notReady", {
            defaultValue: "No gateway is set up for this channel yet.",
          })
        : !options.phoneUsable
          ? t("clients.communications.send.noPhone", {
              defaultValue: "There is no usable mobile number on file.",
            })
          : !receives
            ? t("clients.communications.send.optedOut", {
                defaultValue: "This person asked not to be messaged on this channel.",
              })
            : null;

  const channelLabel = (value: MessagingChannel) =>
    t(`settings.messaging.channel.${value}`, { defaultValue: value });

  const setReceives = async (next: boolean) => {
    setSavingPreference(true);
    try {
      const response = await fetch(`/api/clients/${clientId}/messaging`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [channel]: next }),
      });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error);
      setOptions((current) =>
        current ? { ...current, receives: json.data.receives } : current,
      );
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSavingPreference(false);
    }
  };

  const send = async () => {
    setSending(true);
    try {
      const response = await fetch(`/api/clients/${clientId}/messaging`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, body, subject }),
      });
      const json = await response.json();
      if (!response.ok || !json.success) {
        throw new Error(
          messagingOutcomeText(
            t,
            json.code,
            json.error ||
              t("clients.communications.send.failed", {
                defaultValue: "The message was not sent",
              }),
          ),
        );
      }
      toast.success(
        t("clients.communications.send.sent", { defaultValue: "Message sent" }),
      );
      await onSent();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {t("clients.communications.send.title", {
              defaultValue: "Send a message",
            })}
          </DialogTitle>
          <DialogDescription>
            {t("clients.communications.send.description", {
              defaultValue:
                "Sent through your office's gateway and kept in this history.",
            })}
          </DialogDescription>
        </DialogHeader>

        {!options ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="send-channel">
                  {t("clients.communications.channelLabel", {
                    defaultValue: "Channel",
                  })}
                </Label>
                <Select
                  value={channel}
                  onValueChange={(value) => setChannel(value as MessagingChannel)}
                >
                  <SelectTrigger id="send-channel">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MESSAGING_CHANNELS.map((value) => (
                      <SelectItem key={value} value={value}>
                        {channelLabel(value)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>
                  {t("clients.communications.send.to", { defaultValue: "To" })}
                </Label>
                <p className="flex h-9 items-center text-sm" dir="ltr">
                  {options.phone || "—"}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="send-receives" className="text-sm">
                  {t("clients.communications.send.receives", {
                    defaultValue: "Receives {channel}",
                    values: { channel: channelLabel(channel) },
                  })}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t("clients.communications.send.receivesHint", {
                    defaultValue:
                      "Switch off when the person asks not to be messaged on this channel. Reminders stop too.",
                  })}
                </p>
              </div>
              <Switch
                id="send-receives"
                checked={receives}
                disabled={savingPreference}
                onCheckedChange={(next) => void setReceives(next)}
              />
            </div>

            {blocker ? (
              <p className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                {blocker}
              </p>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="send-subject">
                {t("clients.communications.send.subject", {
                  defaultValue: "Subject (for the history)",
                })}
              </Label>
              <Input
                id="send-subject"
                value={subject}
                maxLength={200}
                onChange={(event) => setSubject(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="send-body">
                {t("clients.communications.send.message", { defaultValue: "Message" })}
              </Label>
              <Textarea
                id="send-body"
                rows={5}
                value={body}
                maxLength={MAX_LENGTH}
                onChange={(event) => setBody(event.target.value)}
              />
              <p className="text-end text-xs text-muted-foreground tabular-nums" dir="ltr">
                {body.length}/{MAX_LENGTH}
              </p>
              {channel === "whatsapp" ? (
                <p className="text-xs text-muted-foreground">
                  {t("clients.communications.send.whatsappWindow", {
                    defaultValue:
                      "WhatsApp delivers a typed message only to someone who wrote to your number in the last 24 hours.",
                  })}
                </p>
              ) : null}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={sending}>
            {t("common.cancel", { defaultValue: "Cancel" })}
          </Button>
          <Button
            onClick={send}
            disabled={!options || Boolean(blocker) || !body.trim() || sending}
          >
            {sending ? (
              <Loader2 className="me-2 h-4 w-4 animate-spin" />
            ) : (
              <Send className="me-2 h-4 w-4" />
            )}
            {t("clients.communications.send.send", { defaultValue: "Send" })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
