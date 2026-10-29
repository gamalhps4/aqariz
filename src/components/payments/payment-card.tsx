"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  CreditCard,
  MoreHorizontal,
  Edit,
  Eye,
  Trash2,
  CheckCircle,
  XCircle,
  Clock,
  RefreshCw,
  Send,
  User,
  Building2,
  Calendar,
  DollarSign,
} from "lucide-react";
import { PaymentStatus, PaymentType, PaymentMethod } from "@/types";
import { formatCurrency } from "@/lib/utils/formatting";

interface PaymentCardProps {
  payment: {
    _id: string;
    amount: number;
    type: PaymentType;
    status: PaymentStatus;
    paymentMethod?: PaymentMethod;
    dueDate: string;
    paidDate?: string;
    description?: string;
    notes?: string;
    tenantId: {
      _id: string;
      userId: {
        firstName: string;
        lastName: string;
        email: string;
        phone?: string;
      };
    };
    propertyId: {
      _id: string;
      name: string;
      address: {
        street: string;
        city: string;
        state: string;
      };
    };
    leaseId?: {
      _id: string;
      startDate: string;
      endDate: string;
    };
    createdAt: string;
    updatedAt: string;
  };
  onDelete?: (paymentId: string) => void;
}

export function PaymentCard({ payment, onDelete }: PaymentCardProps) {
  const getStatusColor = (status: PaymentStatus) => {
    switch (status) {
      case PaymentStatus.PENDING:
        return "default";
      case PaymentStatus.PAID:
        return "secondary";
      case PaymentStatus.OVERDUE:
        return "destructive";
      case PaymentStatus.FAILED:
        return "destructive";
      case PaymentStatus.REFUNDED:
        return "outline";
      default:
        return "outline";
    }
  };

  const getTypeColor = (type: PaymentType) => {
    switch (type) {
      case PaymentType.RENT:
        return "default";
      case PaymentType.SECURITY_DEPOSIT:
        return "secondary";
      case PaymentType.LATE_FEE:
        return "destructive";
      case PaymentType.PET_DEPOSIT:
        return "secondary";
      case PaymentType.UTILITY:
        return "outline";
      case PaymentType.MAINTENANCE:
        return "outline";
      case PaymentType.INVOICE:
        return "secondary";
      case PaymentType.OTHER:
        return "outline";
      default:
        return "outline";
    }
  };

  const getStatusIcon = (status: PaymentStatus) => {
    switch (status) {
      case PaymentStatus.PENDING:
        return Clock;
      case PaymentStatus.PAID:
        return CheckCircle;
      case PaymentStatus.OVERDUE:
        return XCircle;
      case PaymentStatus.FAILED:
        return XCircle;
      case PaymentStatus.REFUNDED:
        return RefreshCw;
      default:
        return Clock;
    }
  };

  // const formatCurrency = (amount: number) => {
  //   return new Intl.NumberFormat("en-US", {
  //     style: "currency",
  //     currency: "USD",
  //   }).format(amount);
  // };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const getDaysOverdue = (dueDate: string, status: PaymentStatus) => {
    if (
      status === PaymentStatus.PAID ||
      status === PaymentStatus.REFUNDED
    ) {
      return 0;
    }
    const now = new Date();
    const due = new Date(dueDate);
    const diffTime = now.getTime() - due.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return Math.max(0, diffDays);
  };

  const StatusIcon = getStatusIcon(payment.status);
  const daysOverdue = getDaysOverdue(payment.dueDate, payment.status);

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-muted-foreground" />
            <Badge
              variant={
                getStatusColor(payment.status) as
                  | "default"
                  | "secondary"
                  | "destructive"
                  | "outline"
              }
              className="text-xs"
            >
              <StatusIcon className="h-3 w-3 me-1" />
              {payment.status.charAt(0).toUpperCase() + payment.status.slice(1)}
            </Badge>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 w-8 p-0">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Actions</DropdownMenuLabel>
              <DropdownMenuItem asChild>
                <Link href={`/dashboard/payments/${payment._id}`}>
                  <Eye className="me-2 h-4 w-4" />
                  View Details
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href={`/dashboard/payments/${payment._id}/edit`}>
                  <Edit className="me-2 h-4 w-4" />
                  Edit Payment
                </Link>
              </DropdownMenuItem>
              {payment.status === PaymentStatus.PENDING && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem>
                    <Send className="me-2 h-4 w-4" />
                    Send Payment Link
                  </DropdownMenuItem>
                  <DropdownMenuItem className="text-green-600">
                    <CheckCircle className="me-2 h-4 w-4" />
                    Mark as Paid
                  </DropdownMenuItem>
                </>
              )}
              {payment.status === PaymentStatus.PAID && (
                <DropdownMenuItem className="text-orange-600">
                  <RefreshCw className="me-2 h-4 w-4" />
                  Refund Payment
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-red-600"
                onClick={() => onDelete?.(payment._id)}
              >
                <Trash2 className="me-2 h-4 w-4" />
                Delete Payment
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="text-2xl font-bold">
          {formatCurrency(payment.amount)}
        </div>
        <Badge
          variant={
            getTypeColor(payment.type) as
              | "default"
              | "secondary"
              | "destructive"
              | "outline"
          }
          className="w-fit text-xs capitalize"
        >
          {payment.type.replace("_", " ")}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-start gap-2">
          <User className="h-4 w-4 text-muted-foreground mt-0.5" />
          <div>
            <p className="text-sm font-medium">
              {payment.tenantId.userId.firstName}{" "}
              {payment.tenantId.userId.lastName}
            </p>
            <p className="text-xs text-muted-foreground">
              {payment.tenantId.userId.email}
            </p>
          </div>
        </div>

        <div className="flex items-start gap-2">
          <Building2 className="h-4 w-4 text-muted-foreground mt-0.5" />
          <div>
            <p className="text-sm font-medium">{payment.propertyId.name}</p>
            <p className="text-xs text-muted-foreground">
              {payment.propertyId.address.city},{" "}
              {payment.propertyId.address.state}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-sm">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">Due:</span>
          <span>{formatDate(payment.dueDate)}</span>
        </div>

        {payment.paidDate && (
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle className="h-4 w-4 text-green-600" />
            <span className="text-muted-foreground">Paid:</span>
            <span>{formatDate(payment.paidDate)}</span>
          </div>
        )}

        {daysOverdue > 0 && (
          <div className="flex items-center gap-2 text-sm">
            <XCircle className="h-4 w-4 text-red-600" />
            <span className="text-muted-foreground">Overdue:</span>
            <span className="text-red-600 font-medium">{daysOverdue} days</span>
          </div>
        )}

        {payment.paymentMethod && (
          <div className="flex items-center gap-2 text-sm">
            <DollarSign className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">Method:</span>
            <span className="capitalize">
              {payment.paymentMethod.replace("_", " ")}
            </span>
          </div>
        )}

        {payment.description && (
          <div className="pt-2 border-t">
            <p className="text-xs text-muted-foreground line-clamp-2">
              {payment.description}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
