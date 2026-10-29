/**
 * PropertyPro - Payment History Component
 * Displays payment history with timeline and transaction details
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PaymentStatusBadge } from "./payment-status-badge";
import { PaymentMethodBadge } from "./payment-method-selector";
import { IPayment } from "@/types";
import {
  Calendar,
  DollarSign,
  Receipt,
  Download,
  Clock,
  CheckCircle,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

interface PaymentHistoryProps {
  payments: IPayment[];
  showActions?: boolean;
  onActionClick?: (action: string, payment: IPayment) => void;
  className?: string;
}

interface PaymentHistoryItemProps {
  payment: IPayment;
  showActions?: boolean;
  onActionClick?: (action: string, payment: IPayment) => void;
  isLast?: boolean;
}
import { formatCurrency } from "@/lib/utils/formatting";

function PaymentHistoryItem({
  payment,
  showActions = true,
  onActionClick,
  isLast = false,
}: PaymentHistoryItemProps) {
  // const formatCurrency = (amount: number) => {
  //   return new Intl.NumberFormat("en-US", {
  //     style: "currency",
  //     currency: "USD",
  //   }).format(amount);
  // };

  const formatDate = (date: string | Date) => {
    return format(new Date(date), "MMM dd, yyyy");
  };

  const formatTime = (date: string | Date) => {
    return format(new Date(date), "h:mm a");
  };

  const getStatusIcon = () => {
    switch (payment.status) {
      case "paid":
        return <CheckCircle className="h-4 w-4 text-green-600" />;
      case "pending":
        return <Clock className="h-4 w-4 text-yellow-600" />;
      case "overdue":
      case "failed":
        return <AlertCircle className="h-4 w-4 text-red-600" />;
      default:
        return <Clock className="h-4 w-4 text-gray-600" />;
    }
  };

  const isOverdue =
    payment.status === "overdue" ||
    (payment.status === "pending" && new Date(payment.dueDate) < new Date());

  return (
    <div className="relative">
      {/* Timeline connector */}
      {!isLast && (
        <div className="absolute start-6 top-12 w-0.5 h-full bg-gray-200" />
      )}

      <div className="flex gap-4">
        {/* Timeline dot */}
        <div
          className={cn(
            "flex items-center justify-center w-12 h-12 rounded-full border-2 bg-white dark:bg-gray-800",
            payment.status === "paid" &&
              "border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30",
            payment.status === "pending" &&
              "border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-950/30",
            (payment.status === "overdue" || payment.status === "failed") &&
              "border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30"
          )}
        >
          {getStatusIcon()}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <Card
            className={cn(
              "transition-all duration-200",
              isOverdue &&
                "border-red-200 dark:border-red-800 bg-red-50/30 dark:bg-red-950/20"
            )}
          >
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold">
                      {formatCurrency(payment.amount)}
                    </h3>
                    <PaymentStatusBadge status={payment.status} size="sm" />
                    {payment.paymentMethod && (
                      <PaymentMethodBadge method={payment.paymentMethod} />
                    )}
                  </div>

                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Calendar className="h-4 w-4" />
                      <span>Due: {formatDate(payment.dueDate)}</span>
                    </div>
                    {payment.paidDate && (
                      <div className="flex items-center gap-1">
                        <CheckCircle className="h-4 w-4" />
                        <span>
                          Paid: {formatDate(payment.paidDate)} at{" "}
                          {formatTime(payment.paidDate)}
                        </span>
                      </div>
                    )}
                  </div>

                  {payment.description && (
                    <p className="text-sm text-muted-foreground">
                      {payment.description}
                    </p>
                  )}

                  {/* Payment History Details */}
                  {payment.paymentHistory &&
                    payment.paymentHistory.length > 0 && (
                      <div className="space-y-1">
                        <h4 className="text-xs font-medium text-muted-foreground">
                          Payment Details:
                        </h4>
                        {payment.paymentHistory.map((history, index) => (
                          <div
                            key={index}
                            className="text-xs text-muted-foreground flex items-center gap-2"
                          >
                            <DollarSign className="h-3 w-3" />
                            <span>
                              {formatCurrency(history.amount)} via{" "}
                              {history.paymentMethod.replace(/_/g, " ")}
                            </span>
                            <span>on {formatDate(history.paidDate)}</span>
                            {history.transactionId && (
                              <Badge variant="outline" className="text-xs">
                                {history.transactionId}
                              </Badge>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                  {/* Late Fee Information */}
                  {payment.lateFeeApplied && payment.lateFeeApplied > 0 && (
                    <div className="flex items-center gap-2 text-sm text-red-600">
                      <AlertCircle className="h-4 w-4" />
                      <span>
                        Late fee: {formatCurrency(payment.lateFeeApplied)}
                      </span>
                      {payment.lateFeeDate && (
                        <span className="text-muted-foreground">
                          (applied {formatDate(payment.lateFeeDate)})
                        </span>
                      )}
                    </div>
                  )}

                  {/* Partial Payment Information */}
                  {payment.amountPaid &&
                    payment.amountPaid > 0 &&
                    payment.amountPaid < payment.amount && (
                      <div className="text-sm text-orange-600">
                        Partial payment: {formatCurrency(payment.amountPaid)} of{" "}
                        {formatCurrency(payment.amount)}
                      </div>
                    )}
                </div>

                {/* Actions */}
                {showActions && (
                  <div className="flex gap-2">
                    {payment.status === "paid" && payment.receiptUrl && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onActionClick?.("receipt", payment)}
                      >
                        <Receipt className="h-4 w-4" />
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onActionClick?.("details", payment)}
                    >
                      Details
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

export function PaymentHistory({
  payments,
  showActions = true,
  onActionClick,
  className,
}: PaymentHistoryProps) {
  const sortedPayments = [...payments].sort(
    (a, b) => new Date(b.dueDate).getTime() - new Date(a.dueDate).getTime()
  );

  if (payments.length === 0) {
    return (
      <Card className={className}>
        <CardContent className="p-8 text-center">
          <DollarSign className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-medium text-muted-foreground mb-2">
            No Payment History
          </h3>
          <p className="text-sm text-muted-foreground">
            Payment history will appear here once payments are made.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5" />
            Payment History
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onActionClick?.("export", payments[0])}
          >
            <Download className="h-4 w-4 me-2" />
            Export
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {sortedPayments.map((payment, index) => (
          <PaymentHistoryItem
            key={payment._id.toString()}
            payment={payment}
            showActions={showActions}
            onActionClick={onActionClick}
            isLast={index === sortedPayments.length - 1}
          />
        ))}
      </CardContent>
    </Card>
  );
}

export function PaymentHistorySkeleton() {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="h-6 w-32 bg-gray-200 rounded animate-pulse" />
          <div className="h-8 w-20 bg-gray-200 rounded animate-pulse" />
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="flex gap-4">
            <div className="w-12 h-12 bg-gray-200 rounded-full animate-pulse" />
            <div className="flex-1 space-y-3">
              <div className="h-4 w-3/4 bg-gray-200 rounded animate-pulse" />
              <div className="h-3 w-1/2 bg-gray-200 rounded animate-pulse" />
              <div className="h-3 w-2/3 bg-gray-200 rounded animate-pulse" />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
