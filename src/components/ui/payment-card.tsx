/**
 * PropertyPro - Payment Card Component
 * Displays payment information in a card format with actions
 */

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PaymentStatusBadge } from "./payment-status-badge";
import { IPayment, PaymentType, PaymentMethod } from "@/types";
import {
  Calendar,
  DollarSign,
  User,
  Home,
  MoreHorizontal,
  Receipt,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

interface PaymentCardProps {
  payment: IPayment & {
    tenantId?: {
      userId?: {
        firstName: string;
        lastName: string;
        email: string;
      };
    };
    propertyId?: {
      name: string;
      address?: {
        street: string;
        city: string;
        state: string;
      };
    };
  };
  onPaymentAction?: (action: string, payment: IPayment) => void;
  showActions?: boolean;
  compact?: boolean;
  className?: string;
}

const paymentTypeLabels = {
  [PaymentType.RENT]: "Rent",
  [PaymentType.SECURITY_DEPOSIT]: "Security Deposit",
  [PaymentType.LATE_FEE]: "Late Fee",
  [PaymentType.PET_DEPOSIT]: "Pet Deposit",
  [PaymentType.UTILITY]: "Utility",
  [PaymentType.MAINTENANCE]: "Maintenance",
  [PaymentType.INVOICE]: "Invoice",
  [PaymentType.OTHER]: "Other",
};

// Typed as a total record so a method added to the enum fails the build here
// rather than rendering `undefined` next to an amount.
const paymentMethodLabels: Record<PaymentMethod, string> = {
  [PaymentMethod.CREDIT_CARD]: "Credit Card",
  [PaymentMethod.DEBIT_CARD]: "Debit Card",
  [PaymentMethod.BANK_TRANSFER]: "Bank Transfer",
  [PaymentMethod.ACH]: "ACH",
  [PaymentMethod.CHECK]: "Check",
  [PaymentMethod.CASH]: "Cash",
  [PaymentMethod.POS]: "POS",
  [PaymentMethod.MONEY_ORDER]: "Money Order",
  [PaymentMethod.EJARI]: "Ejar Platform",
  [PaymentMethod.OWNER_ACCOUNT]: "Transfer to Owner",
  [PaymentMethod.OWNER_CASH]: "Cash to Owner",
  [PaymentMethod.PAYPAL]: "PayPal",
  // Retired gateways — kept so historical payment rows still render a name.
  [PaymentMethod.RAZORPAY]: "Razorpay",
  [PaymentMethod.PAYSTACK]: "Paystack",
  [PaymentMethod.OTHER]: "Other",
};
import { formatCurrency } from "@/lib/utils/formatting";

export function PaymentCard({
  payment,
  onPaymentAction,
  showActions = true,
  compact = false,
  className,
}: PaymentCardProps) {
  const isOverdue =
    payment.status === "overdue" ||
    (payment.status === "pending" && new Date(payment.dueDate) < new Date());

  const hasLateFee = payment.lateFeeApplied && payment.lateFeeApplied > 0;
  const isPartiallyPaid =
    payment.amountPaid &&
    payment.amountPaid > 0 &&
    payment.amountPaid < payment.amount;

  // const formatCurrency = (amount: number) => {
  //   return new Intl.NumberFormat("en-US", {
  //     style: "currency",
  //     currency: "USD",
  //   }).format(amount);
  // };

  const formatDate = (date: string | Date) => {
    return format(new Date(date), "MMM dd, yyyy");
  };

  return (
    <Card
      className={cn(
        "transition-all duration-200 hover:shadow-md",
        isOverdue && "border-red-200 bg-red-50/50",
        className
      )}
    >
      <CardHeader className={cn("pb-3", compact && "pb-2")}>
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">
                {paymentTypeLabels[payment.type]}
              </Badge>
              {hasLateFee && (
                <Badge variant="destructive" className="text-xs">
                  <AlertTriangle className="h-3 w-3 me-1" />
                  Late Fee
                </Badge>
              )}
              {payment.isRecurring && (
                <Badge variant="secondary" className="text-xs">
                  Recurring
                </Badge>
              )}
            </div>
            <h3 className="font-semibold text-lg">
              {formatCurrency(payment.amount)}
              {hasLateFee && (
                <span className="text-red-600 text-sm ms-2">
                  (+{formatCurrency(payment.lateFeeApplied)})
                </span>
              )}
            </h3>
            {isPartiallyPaid && (
              <p className="text-sm text-muted-foreground">
                Paid: {formatCurrency(payment.amountPaid || 0)} of{" "}
                {formatCurrency(payment.amount)}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <PaymentStatusBadge status={payment.status} size="sm" />
            {showActions && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onPaymentAction?.("menu", payment)}
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className={cn("pt-0", compact && "space-y-2")}>
        {!compact && (
          <div className="space-y-3">
            {/* Tenant Information */}
            {payment.tenantId?.userId && (
              <div className="flex items-center gap-2 text-sm">
                <User className="h-4 w-4 text-muted-foreground" />
                <span>
                  {payment.tenantId.userId.firstName}{" "}
                  {payment.tenantId.userId.lastName}
                </span>
                <span className="text-muted-foreground">
                  ({payment.tenantId.userId.email})
                </span>
              </div>
            )}

            {/* Property Information */}
            {payment.propertyId && (
              <div className="flex items-center gap-2 text-sm">
                <Home className="h-4 w-4 text-muted-foreground" />
                <span>{payment.propertyId.name}</span>
                {payment.propertyId.address && (
                  <span className="text-muted-foreground">
                    - {payment.propertyId.address.street},{" "}
                    {payment.propertyId.address.city}
                  </span>
                )}
              </div>
            )}

            {/* Due Date */}
            <div className="flex items-center gap-2 text-sm">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span>Due: {formatDate(payment.dueDate)}</span>
              {payment.paidDate && (
                <span className="text-green-600">
                  • Paid: {formatDate(payment.paidDate)}
                </span>
              )}
            </div>

            {/* Payment Method */}
            {payment.paymentMethod && (
              <div className="flex items-center gap-2 text-sm">
                <DollarSign className="h-4 w-4 text-muted-foreground" />
                <span>
                  Method: {paymentMethodLabels[payment.paymentMethod]}
                </span>
              </div>
            )}

            {/* Description */}
            {payment.description && (
              <p className="text-sm text-muted-foreground">
                {payment.description}
              </p>
            )}
          </div>
        )}

        {/* Actions */}
        {showActions && !compact && (
          <div className="flex gap-2 pt-3 border-t">
            {payment.status === "pending" && (
              <Button
                size="sm"
                onClick={() => onPaymentAction?.("pay", payment)}
                className="flex-1"
              >
                Record Payment
              </Button>
            )}
            {payment.status === "paid" && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onPaymentAction?.("receipt", payment)}
                className="flex items-center gap-1"
              >
                <Receipt className="h-4 w-4" />
                Receipt
              </Button>
            )}
            {payment.status === "partial" && (
              <Button
                size="sm"
                onClick={() => onPaymentAction?.("pay_remaining", payment)}
                className="flex-1"
              >
                Pay Remaining
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPaymentAction?.("details", payment)}
            >
              Details
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function PaymentCardSkeleton() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <div className="h-4 w-20 bg-gray-200 rounded animate-pulse" />
            <div className="h-6 w-24 bg-gray-200 rounded animate-pulse" />
          </div>
          <div className="h-6 w-16 bg-gray-200 rounded animate-pulse" />
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        <div className="h-4 w-full bg-gray-200 rounded animate-pulse" />
        <div className="h-4 w-3/4 bg-gray-200 rounded animate-pulse" />
        <div className="h-4 w-1/2 bg-gray-200 rounded animate-pulse" />
      </CardContent>
    </Card>
  );
}

export function PaymentSummaryCard({
  title,
  amount,
  count,
  trend,
  className,
}: {
  title: string;
  amount: number;
  count: number;
  trend?: { value: number; isPositive: boolean };
  className?: string;
}) {
  // const formatCurrency = (amount: number) => {
  //   return new Intl.NumberFormat("en-US", {
  //     style: "currency",
  //     currency: "USD",
  //   }).format(amount);
  // };

  return (
    <Card className={className}>
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <div className="flex items-baseline gap-2">
              <p className="text-2xl font-bold">{formatCurrency(amount)}</p>
              {trend && (
                <span
                  className={cn(
                    "text-sm font-medium",
                    trend.isPositive ? "text-green-600" : "text-red-600"
                  )}
                >
                  {trend.isPositive ? "+" : ""}
                  {trend.value}%
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {count} payment{count !== 1 ? "s" : ""}
            </p>
          </div>
          <DollarSign className="h-8 w-8 text-muted-foreground" />
        </div>
      </CardContent>
    </Card>
  );
}
