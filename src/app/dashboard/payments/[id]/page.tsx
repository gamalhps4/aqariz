"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/auth-client";
import { toast } from "sonner";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuthorization } from "@/hooks/useAuthorization";
import { hasAnyPermission } from "@/lib/permissions-manager";
import {
  CreditCard,
  ArrowLeft,
  Edit,
  MoreHorizontal,
  Calendar,
  DollarSign,
  User,
  Building2,
  FileText,
  CheckCircle,
  XCircle,
  Clock,
  RefreshCw,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { PaymentStatus, PaymentType, PaymentMethod } from "@/types";
import { paymentMethodLabel } from "@/lib/payments/methods";
import {
  recordedByText,
  type PaymentRecorderFields,
} from "@/lib/payments/recorder";
import { paymentTypeLabel } from "@/lib/payments/type-labels";
import { describeCharge, describeChargeNote } from "@/lib/i18n/charge-description";
import {
  paymentDisplayStatus,
  PAYMENT_STATUS_LABELS,
} from "@/lib/payments/display-status";

interface PaymentLease {
  _id: string;
  startDate: string;
  endDate: string;
  status: string;
  contractNumber?: string | null;
  unit?: { unitNumber?: string | null } | null;
}

/** `recordedBy` arrives for staff only; online payments carry a gateway id. */
interface PaymentDetails extends PaymentRecorderFields {
  /** RCP-000123 — the payment (and receipt) number; null until money is received. */
  paymentNumber?: string | null;
  _id: string;
  amount: number;
  type: PaymentType;
  status: PaymentStatus;
  paymentMethod?: PaymentMethod;
  dueDate: string;
  paidDate?: string;
  description?: string;
  notes?: string;
  amountPaid?: number;
  /** Money events; a recorded one carries the reference the office typed. */
  paymentHistory?: Array<{ event?: string; reference?: string }> | null;
  tenantId?: {
    _id?: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
  } | null;
  propertyId?: {
    _id: string;
    name: string;
    address?: {
      street: string;
      city: string;
      state: string;
      zipCode: string;
    };
    type?: string;
    ownerId?: string;
    managerId?: string;
  } | null;
  /**
   * The contract it is on, with its number and unit — populated under
   * `leaseId` by GET /api/payments/[id] (`lease` on the list's rows).
   */
  leaseId?: PaymentLease | string | null;
  lease?: PaymentLease | null;
  /** The installment it belongs to. */
  invoice?: {
    _id: string;
    invoiceNumber: string;
    dueDate: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export default function PaymentDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const router = useRouter();
  const { data: session } = useSession();
  const { t, formatCurrency, formatDate, language } = useLocalizationContext();

  const [payment, setPayment] = useState<PaymentDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const { accessProfile } = useAuthorization();
  const canDelete = hasAnyPermission(accessProfile.permissions, [
    "payment_delete",
    "financial_management",
  ]);
  const [resolvedParams, setResolvedParams] = useState<{ id: string } | null>(
    null
  );

  // Resolve params
  useEffect(() => {
    params.then(setResolvedParams);
  }, [params]);

  // Fetch payment details
  useEffect(() => {
    const fetchPayment = async () => {
      if (!resolvedParams?.id) return;

      try {
        setIsLoading(true);
        const response = await fetch(`/api/payments/${resolvedParams.id}`);

        if (!response.ok) {
          const error = await response
            .json()
            .catch(() => ({ error: "Unknown error" }));
          throw new Error(
            error.error || `Failed to fetch payment (${response.status})`
          );
        }

        const result = await response.json();

        if (result.success && result.data) {
          setPayment(result.data);
        } else {
          throw new Error("Invalid response format");
        }
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : t("payments.detail.toasts.loadError")
        );
        // Don't redirect immediately, let user try again
        setTimeout(() => {
          router.push("/dashboard/payments");
        }, 3000);
      } finally {
        setIsLoading(false);
      }
    };

    if (session && resolvedParams) {
      fetchPayment();
    }
  }, [session, resolvedParams, router, t]);

  // The review's correction path: a wrong payment is deleted and the right
  // one recorded. Its money comes back off the installment it paid and it
  // moves to the archive — restoring it puts the money back.
  const handleDelete = async () => {
    if (!payment) return;

    try {
      setIsDeleting(true);
      const response = await fetch(`/api/payments/${payment._id}`, {
        method: "DELETE",
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.success) {
        throw new Error(
          result?.error ||
            t("payments.deleteDialog.failed", {
              defaultValue: "Could not delete the payment",
            }),
        );
      }
      toast.success(
        t("payments.deleteDialog.done", {
          defaultValue:
            "The payment is in the archive and its installment is owed again.",
        }),
      );
      router.push("/dashboard/payments");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("payments.deleteDialog.failed", {
              defaultValue: "Could not delete the payment",
            }),
      );
    } finally {
      setIsDeleting(false);
      setShowDeleteDialog(false);
    }
  };

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

  // The office's date format, as every other date on the page.
  const formatDateTime = (dateString: string) => formatDate(dateString);

  if (isLoading) {
    return (
      <div className="space-y-6">
        {/* Header Skeleton */}
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-64" />
          </div>
          <Skeleton className="h-10 w-32" />
        </div>

        {/* Content Skeleton */}
        <div className="grid gap-6 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-6 w-32" />
              </CardHeader>
              <CardContent className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (!payment) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <h2 className="text-2xl font-semibold">
            {t("payments.detail.notFound.title")}
          </h2>
          <p className="text-muted-foreground mt-2">
            {t("payments.detail.notFound.description")}
          </p>
          <Link href="/dashboard/payments">
            <Button className="mt-4">
              <ArrowLeft className="h-4 w-4 me-2 rtl:-scale-x-100" />
              {t("payments.detail.notFound.backButton")}
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const StatusIcon = getStatusIcon(payment.status);


  // The contract, however the API sent it.
  const lease: PaymentLease | null =
    payment.lease ??
    (payment.leaseId && typeof payment.leaseId === "object" ? payment.leaseId : null);

  // The reference the office typed when the money was recorded — kept on
  // the payment's history, newest last.
  const reference = [...(payment.paymentHistory ?? [])]
    .reverse()
    .find((entry) => entry?.reference)?.reference;

  // The employee who recorded the money, or "Online" for a gateway payment.
  const recorder = recordedByText(
    payment,
    t("payments.table.recordedOnline", { defaultValue: "Online" }),
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2"></div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("payments.detail.header.title")}
            {payment.paymentNumber && (
              <span className="ms-3 font-mono text-lg font-medium text-muted-foreground">
                <bdi dir="ltr">{payment.paymentNumber}</bdi>
              </span>
            )}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("payments.detail.header.subtitle")}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {payment.status === PaymentStatus.PENDING && (
            <Link href={`/dashboard/payments/${payment._id}/pay`}>
              <Button size="sm" variant="outline">
                <CreditCard className="h-4 w-4 me-1" />
                {t("payments.detail.header.payNow")}
              </Button>
            </Link>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline">
                <MoreHorizontal className="h-4 w-4 me-1" />
                {t("payments.detail.header.actions")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>
                {t("payments.detail.header.actions")}
              </DropdownMenuLabel>
              {/* A completed payment is not edited — its amount is history. */}
              {payment.status !== PaymentStatus.PAID &&
                payment.status !== PaymentStatus.REFUNDED && (
                  <DropdownMenuItem asChild>
                    <Link href={`/dashboard/payments/${payment._id}/edit`}>
                      <Edit className="me-2 h-4 w-4" />
                      {t("payments.detail.header.editPayment")}
                    </Link>
                  </DropdownMenuItem>
                )}
              {payment.status === PaymentStatus.PAID && (
                <DropdownMenuItem asChild>
                  <Link href={`/dashboard/payments/${payment._id}/receipt`}>
                    <FileText className="me-1 h-4 w-4" />
                    {t("payments.detail.header.viewReceipt")}
                  </Link>
                </DropdownMenuItem>
              )}
              {canDelete && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-red-600"
                    onClick={() => setShowDeleteDialog(true)}
                  >
                    <Trash2 className="me-2 h-4 w-4" />
                    {t("payments.detail.header.deletePayment")}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <Link href="/dashboard/payments">
            <Button size="sm" variant="outline">
              <ArrowLeft className="h-4 w-4 me-1 rtl:-scale-x-100" />
              {t("payments.detail.header.backToPayments")}
            </Button>
          </Link>
        </div>
      </div>

      {/* Payment Overview */}
      <div className="grid gap-6 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {t("payments.detail.overview.amount")}
            </CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(payment.amount)}
            </div>
            <p className="text-xs text-muted-foreground">
              {paymentTypeLabel(payment.type, t)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {t("payments.detail.overview.status")}
            </CardTitle>
            <StatusIcon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <Badge
              variant={getStatusColor(payment.status) as any}
              className="text-sm"
            >
              <StatusIcon className="h-3 w-3 me-1" />
              {t(PAYMENT_STATUS_LABELS[paymentDisplayStatus(payment)].key, {
                defaultValue: PAYMENT_STATUS_LABELS[paymentDisplayStatus(payment)].fallback,
              })}
            </Badge>
            <p className="text-xs text-muted-foreground mt-2">
              {t("payments.detail.overview.due")}: {formatDate(payment.dueDate)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {t("payments.detail.overview.paymentMethod")}
            </CardTitle>
            <CreditCard className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-sm font-medium">
              {payment.paymentMethod
                ? paymentMethodLabel(payment.paymentMethod, t)
                : t("payments.detail.overview.notSpecified")}
            </div>
            {payment.paidDate && (
              <p className="text-xs text-muted-foreground mt-2">
                {t("payments.detail.overview.paid")}:{" "}
                {formatDate(payment.paidDate)}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Detailed Information */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Tenant Information */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="h-5 w-5" />
              {t("payments.detail.tenant.title")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium text-muted-foreground">
                {t("payments.detail.tenant.name")}
              </label>
              <p className="text-sm">
                {payment.tenantId?.firstName || t("payments.common.na")}{" "}
                {payment.tenantId?.lastName || ""}
              </p>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">
                {t("payments.detail.tenant.email")}
              </label>
              <p className="text-sm">
                {payment.tenantId?.email || t("payments.common.na")}
              </p>
            </div>
            {payment.tenantId?.phone && (
              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  {t("payments.detail.tenant.phone")}
                </label>
                <p className="text-sm">
                  <bdi dir="ltr">{payment.tenantId.phone}</bdi>
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Property Information */}
        {payment.propertyId && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5" />
                {t("payments.detail.property.title")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  {t("payments.detail.property.propertyName")}
                </label>
                <p className="text-sm">
                  {payment.propertyId.name || t("payments.common.na")}
                </p>
              </div>
              {lease?.unit?.unitNumber && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    {t("payments.detail.property.unit", {
                      defaultValue: "Unit number",
                    })}
                  </label>
                  <p className="text-sm">
                    <bdi>{lease.unit.unitNumber}</bdi>
                  </p>
                </div>
              )}
              {payment.propertyId.address && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    {t("payments.detail.property.address")}
                  </label>
                  <p className="text-sm">
                    {payment.propertyId.address.street}
                    <br />
                    {payment.propertyId.address.city},{" "}
                    {payment.propertyId.address.state}{" "}
                    {payment.propertyId.address.zipCode}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Payment Details */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              {t("payments.detail.timeline.title")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium text-muted-foreground">
                {t("payments.detail.timeline.number", {
                  defaultValue: "Payment number",
                })}
              </label>
              <p className="font-mono text-sm">
                <bdi dir="ltr">{payment.paymentNumber ?? "—"}</bdi>
              </p>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">
                {t("payments.detail.timeline.created")}
              </label>
              <p className="text-sm">{formatDateTime(payment.createdAt)}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">
                {t("payments.detail.timeline.dueDate")}
              </label>
              <p className="text-sm">{formatDate(payment.dueDate)}</p>
            </div>
            {payment.paidDate && (
              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  {t("payments.detail.timeline.paidDate")}
                </label>
                <p className="text-sm">{formatDate(payment.paidDate)}</p>
              </div>
            )}
            {recorder && (
              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  {t("payments.detail.timeline.recordedBy", {
                    defaultValue: "Recorded By",
                  })}
                </label>
                <p className="text-sm">{recorder}</p>
              </div>
            )}
            <div>
              <label className="text-sm font-medium text-muted-foreground">
                {t("payments.detail.timeline.lastUpdated")}
              </label>
              <p className="text-sm">{formatDateTime(payment.updatedAt)}</p>
            </div>
          </CardContent>
        </Card>

        {/* Additional Information */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              {t("payments.detail.additional.title")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {payment.description && (
              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  {t("payments.detail.additional.description")}
                </label>
                <p className="text-sm">
                  {describeCharge(
                    { description: payment.description, type: payment.type },
                    language,
                  )}
                </p>
              </div>
            )}
            {reference && (
              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  {t("payments.detail.additional.reference", {
                    defaultValue: "Reference number",
                  })}
                </label>
                <p className="font-mono text-sm">{reference}</p>
              </div>
            )}
            {payment.notes && (
              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  {t("payments.detail.additional.internalNotes")}
                </label>
                <p className="text-sm">{describeChargeNote(payment.notes, language)}</p>
              </div>
            )}
            {lease && (
              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  {t("payments.detail.additional.contractNumber", {
                    defaultValue: "Contract number",
                  })}
                </label>
                <p className="text-sm">
                  <Link
                    href={`/dashboard/leases/${lease._id}?tab=payments`}
                    className="font-medium text-primary hover:underline"
                  >
                    {lease.contractNumber || t("payments.table.contract", {
                      defaultValue: "Contract",
                    })}
                  </Link>
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatDate(lease.startDate)} – {formatDate(lease.endDate)}
                </p>
              </div>
            )}
            {payment.invoice && (
              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  {t("payments.detail.additional.installment", {
                    defaultValue: "Installment",
                  })}
                </label>
                <p className="font-mono text-sm">{payment.invoice.invoiceNumber}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("payments.deleteDialog.title", {
                defaultValue: "Delete this payment?",
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {Number(payment.amountPaid ?? 0) > 0
                ? t("payments.deleteDialog.withMoney", {
                    defaultValue:
                      "{amount} comes back off the installment it paid, which will read as owed again. The payment moves to the archive. Record the correct payment afterwards.",
                    values: { amount: formatCurrency(Number(payment.amountPaid)) },
                  })
                : t("payments.deleteDialog.noMoney", {
                    defaultValue:
                      "This entry has no money recorded on it. It moves to the archive.",
                  })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>
              {t("payments.deleteDialog.cancel", { defaultValue: "Cancel" })}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting
                ? t("payments.deleteDialog.deleting", { defaultValue: "Deleting…" })
                : t("payments.deleteDialog.confirm", {
                    defaultValue: "Delete payment",
                  })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
