"use client";

/**
 * PropertyPro SaaS - Billing state banner
 *
 * Surfaces the one thing the customer could previously only discover by
 * hitting a raw 402: the trial is about to end, a payment failed, or the
 * subscription is winding down. Everyone in the organization sees the notice —
 * only the people who can actually pay get the action button.
 *
 * Severity maps to how much access is at stake, not to how loud we can be:
 * `info` while nothing is lost yet, `warning` inside a grace window, and
 * `critical` once paid features are already paused.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CreditCard, Clock, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

type Severity = "info" | "warning" | "critical";

interface BillingNotice {
  kind: string;
  severity: Severity;
  message: string;
  daysRemaining?: number;
  endsAt?: string;
}

const STYLES: Record<
  Severity,
  { wrapper: string; icon: string; action: string }
> = {
  info: {
    wrapper:
      "border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-100",
    icon: "text-blue-600 dark:text-blue-300",
    action:
      "bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-400",
  },
  warning: {
    wrapper:
      "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100",
    icon: "text-amber-600 dark:text-amber-300",
    action:
      "bg-amber-600 text-white hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-400",
  },
  critical: {
    wrapper:
      "border-red-200 bg-red-50 text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-100",
    icon: "text-red-600 dark:text-red-300",
    action:
      "bg-red-600 text-white hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-400",
  },
};

function NoticeIcon({ kind, className }: { kind: string; className: string }) {
  if (kind.startsWith("trial")) return <Clock className={className} />;
  if (kind.startsWith("past_due")) return <CreditCard className={className} />;
  return <AlertTriangle className={className} />;
}

export function BillingNotice() {
  const [notice, setNotice] = useState<BillingNotice | null>(null);
  const [canManageBilling, setCanManageBilling] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const { t, formatDate } = useLocalizationContext();

  useEffect(() => {
    let active = true;
    fetch("/api/billing/status")
      .then((res) => (res.ok ? res.json() : null))
      .then((payload) => {
        if (!active || !payload?.data?.notice) return;
        setNotice(payload.data.notice);
        setCanManageBilling(Boolean(payload.data.canManageBilling));
      })
      .catch(() => {
        // A billing banner is never worth breaking the dashboard over.
      });
    return () => {
      active = false;
    };
  }, []);

  if (!notice || dismissed) return null;

  const style = STYLES[notice.severity];
  // Losing access is not dismissible — an info notice is.
  const dismissible = notice.severity === "info";

  return (
    <div
      role="status"
      className={`mb-4 flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${style.wrapper}`}
    >
      <NoticeIcon kind={notice.kind} className={`mt-0.5 size-5 shrink-0 ${style.icon}`} />
      {/* Written from the notice's kind in the reader's language; the
          server's English sentence is only the fallback for a kind this
          list does not know yet. */}
      <p className="flex-1 leading-relaxed">
        {t(`billing.notice.${notice.kind}`, {
          defaultValue: notice.message,
          values: {
            days: notice.daysRemaining ?? 0,
            date: notice.endsAt ? formatDate(notice.endsAt) : "",
          },
        })}
      </p>
      {canManageBilling && (
        <Button asChild size="sm" className={`shrink-0 ${style.action}`}>
          <Link href="/dashboard/settings/billing">
            {notice.kind.startsWith("past_due")
              ? t("billing.notice.updatePayment", { defaultValue: "Update payment" })
              : t("billing.notice.viewPlans", { defaultValue: "View plans" })}
          </Link>
        </Button>
      )}
      {dismissible && (
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label={t("common.dismiss", { defaultValue: "Dismiss" })}
          className="shrink-0 rounded p-1 opacity-70 transition hover:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}
