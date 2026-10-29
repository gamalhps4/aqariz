"use client";

import { Bell, BellOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

export function PushToggle() {
  const { status, busy, subscribe, unsubscribe } = usePushNotifications();
  const { t } = useLocalizationContext();

  if (status === "unsupported") {
    return (
      <p className="text-xs text-muted-foreground">
        {t("settings.push.unsupported", { defaultValue: "This browser does not support push notifications." })}
      </p>
    );
  }

  if (status === "loading") {
    return (
      <Button variant="outline" size="sm" disabled>
        <Loader2 className="me-2 h-3.5 w-3.5 animate-spin" />
        {t("settings.twoFactor.checking", { defaultValue: "Checking…" })}
      </Button>
    );
  }

  if (status === "denied") {
    return (
      <p className="text-xs text-muted-foreground">
        {t("settings.push.blocked", { defaultValue: "Notifications are blocked. Allow them in your browser's site settings." })}
      </p>
    );
  }

  if (status === "granted-subscribed") {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => void unsubscribe()}
        disabled={busy}
      >
        {busy ? (
          <Loader2 className="me-2 h-3.5 w-3.5 animate-spin" />
        ) : (
          <BellOff className="me-2 h-3.5 w-3.5" />
        )}
        {t("settings.push.disable", { defaultValue: "Turn off push notifications" })}
      </Button>
    );
  }

  return (
    <Button size="sm" onClick={() => void subscribe()} disabled={busy}>
      {busy ? (
        <Loader2 className="me-2 h-3.5 w-3.5 animate-spin" />
      ) : (
        <Bell className="me-2 h-3.5 w-3.5" />
      )}
      {t("settings.push.enable", { defaultValue: "Turn on push notifications" })}
    </Button>
  );
}
