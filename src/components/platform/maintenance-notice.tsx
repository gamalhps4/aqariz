"use client";

/**
 * PropertyPro SaaS - Maintenance gate
 *
 * Reads the public platform status (`/api/platform/status`) and reacts to the
 * super-admin's maintenance switch:
 *   - Non-admin users get a full-screen maintenance overlay (the app is locked).
 *   - Super-admins get a dismissible banner so they know it's on but keep access.
 *
 * This is a client-side courtesy gate (the dashboard chrome is a client tree and
 * there is no edge middleware); it is not a hard security boundary.
 */

import { useEffect, useState } from "react";
import { useSession } from "@/lib/auth-client";
import { AlertTriangle, Wrench, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

interface MaintenanceState {
  enabled: boolean;
  message: string;
  platformName: string;
}

export function MaintenanceNotice() {
  const { data: session } = useSession();
  const [state, setState] = useState<MaintenanceState | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const { t } = useLocalizationContext();

  useEffect(() => {
    let active = true;
    fetch("/api/platform/status")
      .then((res) => res.json())
      .then((payload) => {
        if (!active) return;
        const data = payload?.data;
        if (data?.maintenance) {
          setState({
            enabled: Boolean(data.maintenance.enabled),
            message: data.maintenance.message || "",
            platformName: data.platformName || "PropertyPro",
          });
        }
      })
      .catch(() => {
        /* status is best-effort; never block the app on a failed fetch */
      });
    return () => {
      active = false;
    };
  }, []);

  if (!state?.enabled) return null;

  const isSuperAdmin = session?.user?.role === "super_admin";

  // Super-admins keep working; a banner reminds them maintenance is live.
  if (isSuperAdmin) {
    if (dismissed) return null;
    return (
      <div className="flex items-center gap-2 border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span className="flex-1">
          {t("platform.maintenance.adminBanner", { defaultValue: "Maintenance mode is on. Everyone else is locked out; you still have full access." })}
        </span>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="rounded p-1 hover:bg-amber-100 dark:hover:bg-amber-900/40"
          aria-label={t("common.dismiss", { defaultValue: "Dismiss" })}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  // Everyone else: full-screen lock.
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background p-6">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
          <Wrench className="h-8 w-8 text-muted-foreground" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight">
          {t("platform.maintenance.title", { defaultValue: "{name} is under maintenance", values: { name: state.platformName } })}
        </h1>
        <p className="mt-3 text-muted-foreground">{state.message}</p>
        <Button
          variant="outline"
          className="mt-6"
          onClick={() => window.location.reload()}
        >
          {t("maintenance.emergency.retry", { defaultValue: "Try again" })}
        </Button>
      </div>
    </div>
  );
}
