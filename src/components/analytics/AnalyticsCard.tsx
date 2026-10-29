import React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";
import { formatCurrency as formatCurrencyValue } from "@/lib/formatters";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface AnalyticsCardProps {
  title: string;
  value: string | number;
  description?: string;
  icon?: LucideIcon;
  iconColor?: "primary" | "success" | "warning" | "error" | "info";
  trend?: {
    value: string;
    isPositive: boolean;
    icon?: LucideIcon;
  };
  variant?: "default" | "primary" | "compact";
  /**
   * Where this indicator's detail lives.
   *
   * The review asks that clicking an indicator opens the related report. A
   * card that is a link says so — cursor, hover, focus ring, and a real
   * anchor the browser can open in a new tab — rather than being a div that
   * happens to react to a click.
   */
  href?: string;
  className?: string;
  children?: React.ReactNode;
}

export interface FinancialCardProps {
  label: string;
  amount: number;
  variant: "success" | "warning" | "error" | "info";
  className?: string;
}

export interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: LucideIcon;
  iconColor?: "primary" | "success" | "warning" | "error" | "info";
  className?: string;
}

const iconColorClasses = {
  primary: "text-primary bg-primary/10",
  success: "text-success bg-success/10",
  warning: "text-warning bg-warning/10",
  error: "text-error bg-error/10",
  info: "text-info bg-info/10",
};

const analyticsCardVariantClasses = {
  default: "min-h-[122px] py-4 gap-0",
  primary:
    "min-h-[138px] py-5 gap-0 border-border shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_rgba(15,23,42,0.04)]",
  compact: "min-h-[112px] py-4 gap-0 shadow-none",
};

const financialVariantClasses = {
  success: {
    background: "bg-gradient-to-r from-success/15 to-success/8",
    border: "border-success/15",
    text: "text-success",
  },
  warning: {
    background: "bg-gradient-to-r from-warning/15 to-warning/8",
    border: "border-warning/15",
    text: "text-warning",
  },
  error: {
    background: "bg-gradient-to-r from-error/15 to-error/8",
    border: "border-error/15",
    text: "text-error",
  },
  info: {
    background: "bg-gradient-to-r from-info/15 to-info/8",
    border: "border-info/15",
    text: "text-info",
  },
};

export function AnalyticsCard({
  title,
  value,
  description,
  icon: Icon,
  iconColor = "primary",
  trend,
  variant = "default",
  href,
  className,
  children,
}: AnalyticsCardProps) {
  const TrendIcon = trend?.icon;

  const card = (
    <Card
      className={cn(
        analyticsCardVariantClasses[variant],
        href &&
          "transition-colors hover:border-primary/40 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        className,
      )}
    >
      <CardHeader
        className={cn(
          "min-w-0 flex flex-row items-center justify-between space-y-0",
          variant === "compact" ? "px-4" : "px-5"
        )}
      >
        <CardTitle
          className={cn(
            "min-w-0 font-semibold text-foreground/85",
            variant === "compact" ? "text-xs" : "text-sm"
          )}
        >
          {title}
        </CardTitle>
        {Icon && (
          <div
            className={cn(
              "rounded-lg",
              variant === "primary" ? "p-2.5" : "p-2",
              iconColorClasses[iconColor]
            )}
          >
            <Icon
              className={cn(
                variant === "primary" ? "h-[18px] w-[18px]" : "h-4 w-4"
              )}
            />
          </div>
        )}
      </CardHeader>
      <CardContent className={variant === "compact" ? "px-4" : "px-5"}>
        <div
          className={cn(
            "font-bold tracking-tight text-foreground",
            variant === "primary" ? "text-[28px] leading-8" : "text-2xl leading-7"
          )}
        >
          {value}
        </div>
        {description && (
          <p
            className={cn(
              "mt-1 leading-4 text-muted-foreground",
              variant === "primary" ? "text-[13px]" : "text-xs"
            )}
          >
            {description}
          </p>
        )}
        {/* {trend && (
          <div className="flex items-center text-xs mt-2">
            {TrendIcon && (
              <TrendIcon
                className={cn(
                  "h-3 w-3 me-1",
                  trend.isPositive ? "text-green-600" : "text-red-600"
                )}
              />
            )}
            <span
              className={cn(
                "flex items-center",
                trend.isPositive ? "text-green-600" : "text-red-600"
              )}
            >
              {trend.value}
            </span>
          </div>
        )} */}
        {children}
      </CardContent>
    </Card>
  );

  // Wrapped rather than made clickable: an anchor is what gives the keyboard
  // and the middle mouse button the behaviour a reader already expects of
  // something that navigates.
  return href ? (
    <Link href={href} className="block rounded-xl">
      {card}
    </Link>
  ) : (
    card
  );
}

export function FinancialCard({
  label,
  amount,
  variant,
  className,
}: FinancialCardProps) {
  const variantClasses = financialVariantClasses[variant];

  return (
    <div
      className={cn(
        "flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 p-3 lg:p-4 rounded-xl border",
        variantClasses.background,
        variantClasses.border,
        className
      )}
    >
      <span
        className={cn(
          "font-semibold text-sm lg:text-base",
          variantClasses.text
        )}
      >
        {label}
      </span>
      <span
        className={cn("font-bold text-base lg:text-lg", variantClasses.text)}
      >
        {formatCurrencyValue(amount)}
      </span>
    </div>
  );
}

export function MetricCard({
  title,
  value,
  subtitle,
  icon: Icon,
  iconColor = "primary",
  className,
}: MetricCardProps) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-3 text-lg">
          {Icon && (
            <div className={cn("p-2 rounded-lg", iconColorClasses[iconColor])}>
              <Icon className="h-5 w-5" />
            </div>
          )}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-2xl font-bold">{value}</div>
        {subtitle && (
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        )}
      </CardContent>
    </Card>
  );
}

export function AnalyticsCardGrid({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4",
        className
      )}
    >
      {children}
    </div>
  );
}

export function FinancialCardGrid({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid grid-cols-1 gap-3 lg:gap-4", className)}>
      {children}
    </div>
  );
}
