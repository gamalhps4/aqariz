/**
 * PropertyPro - Payment analytics figures
 *
 * Draws what GET /api/payments/reports/analytics worked out over every
 * payment in the period. Nothing is added up here: the page used to total
 * whatever twelve rows the payments list handed it, and to call billed
 * amounts revenue.
 */

"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle,
  CalendarRange,
  CheckCircle,
  CreditCard,
  HandCoins,
  Layers,
  RotateCcw,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { paymentMethodLabel } from "@/lib/payments/methods";
import { paymentTypeLabel } from "@/lib/payments/type-labels";
import type {
  PaymentAnalytics,
  PaymentRegisterGroup,
} from "@/types/payment-report";

function percent(part: number, whole: number): string {
  return whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : "0%";
}

/** "2026-09" as the month's name in the reader's language. */
function monthName(key: string, language: string): string {
  const [year, month] = key.split("-").map(Number);
  if (!year || !month) return key;
  try {
    return new Intl.DateTimeFormat(language === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : language, {
      month: "long",
      year: "numeric",
    }).format(new Date(year, month - 1, 1));
  } catch {
    return key;
  }
}

interface StatProps {
  title: string;
  value: string;
  hint?: string;
  icon: typeof Wallet;
  tone?: "default" | "success" | "warning" | "error";
}

function Stat({ title, value, hint, icon: Icon, tone = "default" }: StatProps) {
  const toneClass =
    tone === "success"
      ? "text-green-600"
      : tone === "warning"
        ? "text-orange-600"
        : tone === "error"
          ? "text-red-600"
          : "text-muted-foreground";
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className={`h-4 w-4 ${toneClass}`} />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

/** The headline figures for the period. */
export function PaymentStatistics({ analytics }: { analytics: PaymentAnalytics }) {
  const { t, formatCurrency } = useLocalizationContext();
  const { received, due, outstanding, overdue, period } = analytics;
  const average =
    received.paymentCount > 0 ? received.totalReceived / received.paymentCount : 0;
  const months = received.byMonth;
  const last = months[months.length - 1];
  const previous = months[months.length - 2];
  const growth =
    last && previous && previous.net !== 0
      ? ((last.net - previous.net) / Math.abs(previous.net)) * 100
      : null;

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <Stat
        title={t("payments.statistics.netReceived", { defaultValue: "Received, net of refunds" })}
        value={formatCurrency(received.totalCollected)}
        hint={t("payments.statistics.netReceivedHint", {
          defaultValue: "{received} received · {refunded} refunded",
          values: {
            received: formatCurrency(received.totalReceived),
            refunded: formatCurrency(received.totalRefunded),
          },
        })}
        icon={HandCoins}
        tone="success"
      />
      <Stat
        title={t("payments.statistics.paymentsReceived", { defaultValue: "Payments received" })}
        value={String(received.paymentCount)}
        hint={t("payments.statistics.averageOf", {
          defaultValue: "Average {amount}",
          values: { amount: formatCurrency(average) },
        })}
        icon={CheckCircle}
      />
      <Stat
        title={t("payments.statistics.dueInPeriod", { defaultValue: "Due in the period" })}
        value={formatCurrency(due.billed)}
        hint={t("payments.statistics.dueCollected", {
          // The catalogue places the percent sign: Arabic writes "%{rate}"
          // so that it reads "85%" once the line runs right to left.
          defaultValue: "{collected} collected · {rate}%",
          values: {
            collected: formatCurrency(due.collected),
            rate: due.collectionRate,
          },
        })}
        icon={CalendarRange}
      />
      <Stat
        title={t("payments.statistics.owedNow", { defaultValue: "Owed now" })}
        value={formatCurrency(outstanding.amount)}
        hint={t("payments.statistics.owedNowOverdue", {
          defaultValue: "{amount} of it overdue",
          values: { amount: formatCurrency(overdue.amount) },
        })}
        icon={AlertTriangle}
        tone={overdue.amount > 0 ? "error" : "warning"}
      />
      <Stat
        title={t("payments.statistics.refunds", { defaultValue: "Refunds" })}
        value={formatCurrency(received.totalRefunded)}
        hint={t("payments.statistics.refundCount", {
          defaultValue: "Refunds made: {count}",
          values: { count: received.refundCount },
        })}
        icon={RotateCcw}
        tone={received.totalRefunded > 0 ? "warning" : "default"}
      />
      <Stat
        title={t("payments.statistics.perDay", { defaultValue: "Received per day" })}
        value={formatCurrency(period.days > 0 ? received.totalCollected / period.days : 0)}
        hint={t("payments.statistics.overDays", {
          defaultValue: "Days in the period: {days}",
          values: { days: period.days },
        })}
        icon={Wallet}
      />
      <Stat
        title={t("payments.statistics.growth", { defaultValue: "Monthly growth" })}
        value={growth === null ? "—" : `${growth >= 0 ? "+" : ""}${growth.toFixed(1)}%`}
        hint={
          last && previous
            ? t("payments.statistics.growthMonths", {
                defaultValue: "Last month in the period against the one before",
              })
            : t("payments.statistics.growthNeedsMonths", {
                defaultValue: "Needs a period of two months or more",
              })
        }
        icon={growth !== null && growth < 0 ? TrendingDown : TrendingUp}
        tone={growth === null ? "default" : growth >= 0 ? "success" : "error"}
      />
      <Stat
        title={t("payments.statistics.installmentsDue", { defaultValue: "Installments due" })}
        value={String(due.installmentCount)}
        hint={t("payments.statistics.stillOwed", {
          defaultValue: "{amount} still owed on them",
          values: { amount: formatCurrency(due.outstanding) },
        })}
        icon={Layers}
      />
    </div>
  );
}

/** One breakdown: each group's net money and its share of the total. */
export function PaymentBreakdown({
  title,
  description,
  groups,
  label,
  icon: Icon = CreditCard,
  emptyText,
}: {
  title: string;
  description: string;
  groups: PaymentRegisterGroup[];
  label: (group: PaymentRegisterGroup) => string;
  icon?: typeof CreditCard;
  emptyText: string;
}) {
  const { formatCurrency } = useLocalizationContext();
  const total = groups.reduce((sum, group) => sum + Math.max(group.net, 0), 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon className="h-5 w-5" />
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {groups.length === 0 && (
          <p className="py-4 text-center text-sm text-muted-foreground">{emptyText}</p>
        )}
        {groups.map((group) => (
          <div key={group.key} className="space-y-1">
            <div className="flex items-center justify-between gap-3">
              <Badge variant="outline" className="max-w-[60%] truncate text-xs">
                <bdi>{label(group)}</bdi>
              </Badge>
              <div className="text-end">
                <div className="font-medium">{formatCurrency(group.net)}</div>
                <div className="text-xs text-muted-foreground">
                  {percent(Math.max(group.net, 0), total)}
                </div>
              </div>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary/70"
                style={{
                  width: total > 0 ? `${Math.max(0, (group.net / total) * 100)}%` : "0%",
                }}
              />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/** The period's breakdowns, by kind of payment, method and month. */
export function PaymentBreakdowns({ analytics }: { analytics: PaymentAnalytics }) {
  const { t, language } = useLocalizationContext();
  const empty = t("payments.statistics.noPayments", {
    defaultValue: "No payments received in this period",
  });
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <PaymentBreakdown
        title={t("payments.statistics.byType", { defaultValue: "By payment type" })}
        description={t("payments.statistics.byTypeNet", {
          defaultValue: "Money received by kind of payment, refunds taken off",
        })}
        groups={analytics.received.byType}
        label={(group) => paymentTypeLabel(group.key, t)}
        icon={Layers}
        emptyText={empty}
      />
      <PaymentBreakdown
        title={t("payments.statistics.byMethod", { defaultValue: "By payment method" })}
        description={t("payments.statistics.byMethodNet", {
          defaultValue: "Money received by how it was paid, refunds taken off",
        })}
        groups={analytics.received.byMethod}
        label={(group) =>
          group.key === "unspecified"
            ? t("payments.statistics.noMethod", { defaultValue: "Not recorded" })
            : paymentMethodLabel(group.key, t)
        }
        icon={CreditCard}
        emptyText={empty}
      />
      <PaymentBreakdown
        title={t("payments.statistics.byMonth", { defaultValue: "By month" })}
        description={t("payments.statistics.byMonthHint", {
          defaultValue: "Money received each month of the period",
        })}
        groups={analytics.received.byMonth}
        label={(group) => monthName(group.key, language)}
        icon={CalendarRange}
        emptyText={empty}
      />
      <PaymentBreakdown
        title={t("payments.statistics.byReceiver", { defaultValue: "By who received it" })}
        description={t("payments.statistics.byReceiverHint", {
          defaultValue: "The office's account, or the owner directly",
        })}
        groups={analytics.received.byReceiver}
        label={(group) =>
          group.key === "owner"
            ? t("payments.reports.receiver.owner", { defaultValue: "Received by the owner" })
            : t("payments.reports.receiver.office", { defaultValue: "Received by the office" })
        }
        icon={Wallet}
        emptyText={empty}
      />
    </div>
  );
}
