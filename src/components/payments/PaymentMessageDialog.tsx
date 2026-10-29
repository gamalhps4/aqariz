"use client";

/**
 * PropertyPro - Tell a tenant about a payment by WhatsApp or SMS
 *
 * Opened from the WhatsApp and SMS icons beside each row on the Payments
 * page. It shows what will go — a receipt, a reminder or an overdue notice,
 * written from the payment (api/payments/[id]/notify) — who gets it and on
 * which number, and says plainly when the channel is not set up or the
 * tenant has no usable mobile, instead of failing after the click.
 */

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Loader2, MessageCircle, MessageSquare, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { messagingOutcomeText } from "@/components/settings/messaging/messaging-parts";
import type { MessagingChannel } from "@/lib/messaging/registry";

interface Preview {
  event: string;
  body: string;
  recipient: { id: string; name: string; phone: string | null; phoneUsable: boolean };
  channels: Record<MessagingChannel, { enabled: boolean; ready: boolean }>;
}

interface PaymentMessageDialogProps {
  /** The payment to message about; null keeps the dialog closed. */
  paymentId: string | null;
  channel: MessagingChannel;
  onClose: () => void;
}

export function PaymentMessageDialog({
  paymentId,
  channel,
  onClose,
}: PaymentMessageDialogProps) {
  // Mounted per payment and channel, so each opening starts from a fresh
  // preview rather than the last one's.
  if (!paymentId) return null;
  return (
    <MessageDialog
      key={`${paymentId}:${channel}`}
      paymentId={paymentId}
      channel={channel}
      onClose={onClose}
    />
  );
}

function MessageDialog({
  paymentId,
  channel,
  onClose,
}: PaymentMessageDialogProps & { paymentId: string }) {
  const { t } = useLocalizationContext();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let active = true;
    fetch(`/api/payments/${paymentId}/notify`)
      .then((response) => response.json().then((json) => ({ response, json })))
      .then(({ response, json }) => {
        if (!active) return;
        if (!response.ok || !json?.success) {
          setLoadError(json?.error || t("payments.message.loadFailed"));
        } else {
          setPreview(json.data as Preview);
        }
      })
      .catch(() => {
        if (active) setLoadError(t("payments.message.loadFailed"));
      });
    return () => {
      active = false;
    };
  }, [paymentId, t]);

  const state = preview?.channels[channel];
  const blocker = !preview
    ? null
    : !state?.enabled
      ? t("settings.messaging.reason.channel_off")
      : !state.ready
        ? t("settings.messaging.reason.not_configured")
        : !preview.recipient.phoneUsable
          ? t("settings.messaging.reason.no_phone")
          : null;

  const send = async () => {
    if (blocker) return;
    setSending(true);
    try {
      const response = await fetch(`/api/payments/${paymentId}/notify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel }),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.success) {
        throw new Error(
          messagingOutcomeText(
            t,
            json?.code,
            json?.error || t("payments.message.failed"),
          ),
        );
      }
      toast.success(
        t("payments.message.sent", {
          values: { name: preview?.recipient.name ?? "" },
        }),
      );
      onClose();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSending(false);
    }
  };

  const Icon = channel === "whatsapp" ? MessageCircle : MessageSquare;

  return (
    <Dialog open onOpenChange={(open) => !open && !sending && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon
              className={
                channel === "whatsapp" ? "h-5 w-5 text-green-600" : "h-5 w-5 text-blue-600"
              }
            />
            {t(
              channel === "whatsapp"
                ? "payments.message.titleWhatsapp"
                : "payments.message.titleSms",
            )}
          </DialogTitle>
          <DialogDescription>
            {preview
              ? t(`payments.message.event.${preview.event}`)
              : t("payments.message.description")}
          </DialogDescription>
        </DialogHeader>

        {!preview && !loadError && (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {loadError && (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {loadError}
          </p>
        )}

        {preview && (
          <div className="space-y-3">
            <div className="text-sm">
              <span className="text-muted-foreground">{t("payments.message.to")} </span>
              <span className="font-medium">{preview.recipient.name}</span>
              {preview.recipient.phone && (
                <span className="text-muted-foreground">
                  {" · "}
                  {/* Isolated: a "+966…" number inside Arabic text otherwise
                      runs into the name beside it. */}
                  <bdi dir="ltr">{preview.recipient.phone}</bdi>
                </span>
              )}
            </div>
            <p className="whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-sm">
              {preview.body}
            </p>
            {channel === "whatsapp" && (
              <p className="text-xs text-muted-foreground">
                {t("payments.message.whatsappTemplateNote")}
              </p>
            )}
            {blocker && (
              <p className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                {blocker}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={sending}>
            {t("common.cancel", { defaultValue: "Cancel" })}
          </Button>
          <Button type="button" onClick={send} disabled={!preview || Boolean(blocker) || sending}>
            {sending ? (
              <Loader2 className="me-2 h-4 w-4 animate-spin" />
            ) : (
              <Send className="me-2 h-4 w-4" />
            )}
            {t("payments.message.send")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
