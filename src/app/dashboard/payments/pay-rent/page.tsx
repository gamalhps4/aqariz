"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/auth-client";
import { toast } from "sonner";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { describeCharge } from "@/lib/i18n/charge-description";
import { paymentTypeLabel } from "@/lib/payments/type-labels";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AnalyticsCard,
  AnalyticsCardGrid,
} from "@/components/analytics/AnalyticsCard";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  CreditCard,
  Building2,
  Calendar,
  DollarSign,
  AlertTriangle,
  CheckCircle,
  Clock,
  Receipt,
  ArrowLeft,
  Download,
} from "lucide-react";
import Link from "next/link";
import { PaymentStatus, PaymentType } from "@/types";
import {
  GatewayPayOptions,
  useGatewayReturn,
} from "@/components/payments/GatewayPayOptions";
import { downloadInvoiceAsPDF, PrintableInvoice } from "@/lib/invoice-print";
import { normalizeInvoiceForPrint } from "@/lib/invoice/invoice-shared";
import { useAuthorization } from "@/hooks/useAuthorization";

// ============================================================================
// INTERFACES
// ============================================================================

interface InvoiceLineItemLite {
  description: string;
  amount?: number;
  type?: string;
  quantity?: number;
  unitPrice?: number;
}

interface InvoiceSummaryLite {
  _id: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  status: string;
  subtotal?: number;
  taxAmount?: number;
  totalAmount: number;
  amountPaid: number;
  balanceRemaining: number;
  notes?: string;
  lineItems?: InvoiceLineItemLite[];
  propertyId?: {
    name?: string;
    address?:
      | {
          street?: string;
          city?: string;
          state?: string;
          zipCode?: string;
          [key: string]: any;
        }
      | string;
  };
  tenantId?: {
    firstName?: string;
    lastName?: string;
    email?: string;
  };
}

interface TenantPayment {
  currency?: string;
  _id: string;
  amount: number;
  type: PaymentType;
  status: PaymentStatus;
  paymentMethod?: string;
  dueDate: string;
  paidDate?: string;
  description?: string;
  notes?: string;
  invoiceId?: InvoiceSummaryLite;
  propertyId?: {
    _id?: string;
    name?: string;
    address?:
      | {
          street?: string;
          city?: string;
          state?: string;
          zipCode?: string;
          [key: string]: any;
        }
      | string;
  } | null;
  leaseId?: {
    _id: string;
    terms?: {
      rentAmount?: number;
    };
  };
  stripePaymentIntentId?: string;
  createdAt?: string;
  referenceNumber?: string;
  tenantId?: {
    firstName?: string;
    lastName?: string;
    email?: string;
  };
}

interface TenantLease {
  _id: string;
  propertyId: {
    _id: string;
    name: string;
    address: {
      street: string;
      city: string;
      state: string;
      zipCode: string;
    };
  };
  terms: {
    rentAmount: number;
    securityDeposit: number;
  };
  startDate: string;
  endDate: string;
  status: string;
}

interface PaymentSummary {
  totalPaid?: number;
  totalPending?: number;
  totalOverdue?: number;
  totalOutstanding?: number;
  paymentsThisMonth?: number;
  paymentsThisYear?: number;
  averagePaymentAmount?: number;
  onTimePaymentRate?: number;
  nextPaymentDue?: {
    amount: number;
    dueDate: string;
    daysUntilDue: number;
  } | null;
  statistics?: {
    totalPayments?: number;
    paidPayments?: number;
    pendingPayments?: number;
    overduePayments?: number;
  };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

const isOverdue = (dueDate: string | Date): boolean => {
  const due = dueDate instanceof Date ? dueDate : new Date(dueDate);
  if (Number.isNaN(due.getTime())) return false;
  const now = new Date();
  return due < now;
};

const formatAddress = (
  address?: NonNullable<TenantPayment["propertyId"]>["address"]
): string => {
  if (!address) return "N/A";
  if (typeof address === "string") return address;
  const parts = [address.street, address.city, address.state, address.zipCode]
    .filter(Boolean)
    .map((part) => part?.toString().trim())
    .filter(Boolean);
  return parts.length ? parts.join(", ") : "N/A";
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function TenantPayRentPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const { isTenant } = useAuthorization();
  const { t, formatCurrency, formatDate } = useLocalizationContext();

  // State management
  const [pendingPayments, setPendingPayments] = useState<TenantPayment[]>([]);
  const [currentLease, setCurrentLease] = useState<TenantLease | null>(null);
  const [paymentSummary, setPaymentSummary] = useState<PaymentSummary | null>(
    null
  );
  const [recentPayments, setRecentPayments] = useState<TenantPayment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPayment, setSelectedPayment] = useState<TenantPayment | null>(
    null
  );
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);

  // Back from a gateway's payment page: say how it went. The lists below
  // load fresh on this visit, so they already show the payment if it went
  // through.
  useGatewayReturn();

  // Authentication check
  useEffect(() => {
    if (status === "loading") return;

    if (!session) {
      router.push("/auth/signin");
      return;
    }

    if (!isTenant) {
      toast.error(t("payments.payRent.toasts.accessDenied"));
      router.push("/dashboard");
      return;
    }
  }, [session, status, isTenant, router, t]);

  // Fetch tenant payment data
  useEffect(() => {
    if (session?.user && isTenant) {
      fetchTenantPaymentData();
    }
  }, [session, isTenant]);

  const fetchTenantPaymentData = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const [pendingRes, summaryRes, recentRes, dashboardRes] =
        await Promise.all([
          fetch("/api/tenant/payments?status=pending,overdue&limit=20"),
          fetch("/api/tenant/payments/summary"),
          fetch("/api/tenant/payments?status=completed&limit=5"),
          fetch("/api/tenant/dashboard"),
        ]);

      if (!pendingRes.ok) {
        throw new Error("Failed to fetch pending payments");
      }
      if (!summaryRes.ok) {
        throw new Error("Failed to fetch payment summary");
      }
      if (!recentRes.ok) {
        throw new Error("Failed to fetch recent payments");
      }
      if (!dashboardRes.ok) {
        throw new Error("Failed to fetch tenant dashboard data");
      }

      const [pendingData, summaryData, recentData, dashboardData] =
        await Promise.all([
          pendingRes.json(),
          summaryRes.json(),
          recentRes.json(),
          dashboardRes.json(),
        ]);

      const pendingList: TenantPayment[] = pendingData.data?.payments || [];
      const summary: PaymentSummary | null = summaryData?.data || null;
      const recentList: TenantPayment[] = recentData.data?.payments || [];

      setPendingPayments(pendingList);
      setPaymentSummary(summary);
      setRecentPayments(recentList);
      setCurrentLease(dashboardData.data?.currentLease || null);
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : t("payments.payRent.loadFailed", { defaultValue: "Could not load your payments" });
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  // Utility functions
  const buildPrintableInvoice = (
    payment: TenantPayment
  ): PrintableInvoice | null => {
    const invoice = payment.invoiceId;
    if (!invoice) {
      const fallbackInvoice = {
        invoiceNumber:
          payment.referenceNumber ||
          `PAY-${payment._id?.slice?.(-8)?.toUpperCase?.() || Date.now()}`,
        issueDate: payment.paidDate || payment.createdAt,
        dueDate: payment.paidDate || payment.createdAt,
        status: payment.status === "paid" ? "paid" : "issued",
        subtotal: payment.amount,
        totalAmount: payment.amount,
        amountPaid: payment.amount,
        balanceRemaining: 0,
        notes: payment.notes,
        tenantId: payment.tenantId,
        propertyId: payment.propertyId,
        lineItems: [
          {
            description: payment.description || "",
            amount: payment.amount,
            quantity: 1,
            unitPrice: payment.amount,
            total: payment.amount,
            type: payment.type,
          },
        ],
      } as Record<string, unknown>;

      return normalizeInvoiceForPrint(fallbackInvoice) as PrintableInvoice;
    }

    const normalizedInvoice = normalizeInvoiceForPrint(
      {
        ...invoice,
        propertyId: invoice.propertyId || payment.propertyId,
        lineItems:
          Array.isArray(invoice.lineItems) && invoice.lineItems.length > 0
            ? invoice.lineItems
            : [
                {
                  description: payment.description || "",
                  amount: payment.amount,
                  quantity: 1,
                  unitPrice: payment.amount,
                  total: payment.amount,
                  type: payment.type,
                },
              ],
      },
      { fallbackStatus: invoice.status }
    );

    return normalizedInvoice as PrintableInvoice;
  };

  const handleDownloadInvoice = async (payment: TenantPayment) => {
    try {
      const printable = buildPrintableInvoice(payment);
      if (!printable) {
        throw new Error(t("payments.payRent.toasts.invoiceNotAvailable"));
      }

      // Fetch company info from display settings
      const { getCompanyInfo } = await import("@/lib/utils/company-info");
      const companyInfo = await getCompanyInfo();

      // Normalize with company info
      const normalizedPrintable = normalizeInvoiceForPrint(printable, {
        companyInfo: companyInfo || undefined,
      }) as PrintableInvoice;

      await downloadInvoiceAsPDF(normalizedPrintable);
      toast.success(t("payments.payRent.toasts.invoiceDownloaded"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("payments.payRent.toasts.downloadFailed")
      );
    }
  };

  const handleViewInvoice = (payment: TenantPayment) => {
    if (payment.invoiceId?._id) {
      router.push(`/dashboard/leases/invoices/${payment.invoiceId._id}`);
    } else {
      toast.error(t("payments.payRent.toasts.invoiceNotAvailable"));
    }
  };

  const handleDownloadReceipt = (payment: TenantPayment) => {
    if (payment.invoiceId) {
      void handleDownloadInvoice(payment);
    } else {
      toast.error(t("payments.payRent.toasts.receiptNotAvailable"));
    }
  };

  const getPaymentStatusBadge = (payment: TenantPayment) => {
    const isPaymentOverdue = isOverdue(payment.dueDate);

    if (isPaymentOverdue) {
      return (
        <Badge variant="destructive">
          {t("payments.payRent.status.overdue")}
        </Badge>
      );
    }

    if (payment.status === PaymentStatus.PENDING) {
      return (
        <Badge variant="secondary">
          {t("payments.payRent.status.pending")}
        </Badge>
      );
    }

    if (payment.status === PaymentStatus.PAID) {
      return (
        <Badge variant="default" className="bg-green-500">
          {t("payments.payRent.status.paid")}
        </Badge>
      );
    }

    if (payment.status === PaymentStatus.FAILED) {
      return (
        <Badge variant="destructive">
          {t("payments.payRent.status.failed")}
        </Badge>
      );
    }

    return (
      <Badge variant="outline">
        {t(`exports.value.${payment.status}`, { defaultValue: payment.status })}
      </Badge>
    );
  };

  // Loading state
  if (status === "loading" || isLoading) {
    return <PayRentPageSkeleton />;
  }

  // Error state
  if (error) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {t("payments.payRent.header.title")}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t("payments.payRent.header.subtitle")}
            </p>
          </div>
        </div>

        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <div className="text-center">
              <AlertTriangle className="h-12 w-12 text-destructive mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">
                {t("payments.payRent.error.title")}
              </h3>
              <p className="text-muted-foreground mb-4">{error}</p>
              <Button onClick={fetchTenantPaymentData}>
                {t("payments.payRent.error.tryAgain")}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("payments.payRent.header.title")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("payments.payRent.header.subtitle")}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Link href="/dashboard/payments/history" className="w-full sm:w-auto">
            <Button variant="outline" className="w-full sm:w-auto">
              <Receipt className="me-2 h-4 w-4" />
              {t("payments.payRent.header.paymentHistory")}
            </Button>
          </Link>
        </div>
      </div>

      {/* Payment Summary Cards */}
      {paymentSummary && (
        <AnalyticsCardGrid className="md:grid-cols-2 lg:grid-cols-4">
          <AnalyticsCard
            title={t("payments.payRent.stats.totalOwed")}
            value={formatCurrency(paymentSummary.totalOutstanding || 0)}
            description={`${paymentSummary.statistics?.overduePayments || 0} ${t("payments.payRent.stats.overduePayments")}`}
            icon={DollarSign}
            iconColor="error"
          />
          <AnalyticsCard
            title={t("payments.payRent.stats.paymentsMade")}
            value={paymentSummary.statistics?.paidPayments || 0}
            description={`${paymentSummary.paymentsThisYear} ${t("payments.payRent.stats.thisYear")}`}
            icon={CheckCircle}
            iconColor="success"
          />
          <AnalyticsCard
            title={t("payments.payRent.stats.nextPayment")}
            value={
              paymentSummary.nextPaymentDue?.dueDate
                ? formatDate(paymentSummary.nextPaymentDue.dueDate)
                : t("payments.common.na")
            }
            description={
              paymentSummary.nextPaymentDue
                ? `${t("payments.payRent.stats.amount")} ${formatCurrency(
                    paymentSummary.nextPaymentDue.amount
                  )}`
                : t("payments.payRent.stats.dueDate")
            }
            icon={Calendar}
            iconColor="warning"
          />
          <AnalyticsCard
            title={t("payments.payRent.stats.currentRent")}
            value={
              currentLease
                ? formatCurrency(currentLease.terms.rentAmount)
                : t("payments.common.na")
            }
            description={t("payments.payRent.stats.monthlyRent")}
            icon={Building2}
            iconColor="primary"
          />
        </AnalyticsCardGrid>
      )}

      {/* Current Lease Information */}
      {currentLease && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              {t("payments.payRent.lease.title")}
            </CardTitle>
            <CardDescription>
              {t("payments.payRent.lease.subtitle")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <h4 className="font-semibold mb-2">
                  {t("payments.payRent.lease.propertyDetails")}
                </h4>
                <p className="font-medium">
                  {currentLease.propertyId?.name || t("payments.common.na")}
                </p>
                <p className="text-sm text-muted-foreground">
                  {currentLease.propertyId?.address?.street ||
                    t("payments.common.na")}
                  <br />
                  {currentLease.propertyId?.address?.city || ""},{" "}
                  {currentLease.propertyId?.address?.state || ""}{" "}
                  {currentLease.propertyId?.address?.zipCode || ""}
                </p>
              </div>
              <div>
                <h4 className="font-semibold mb-2">
                  {t("payments.payRent.lease.leaseTerms")}
                </h4>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span>{t("payments.payRent.lease.monthlyRent")}</span>
                    <span className="font-medium">
                      {formatCurrency(currentLease.terms.rentAmount)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>{t("payments.payRent.lease.securityDeposit")}</span>
                    <span className="font-medium">
                      {formatCurrency(currentLease.terms.securityDeposit)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>{t("payments.payRent.lease.leasePeriod")}</span>
                    <span className="font-medium">
                      {formatDate(currentLease.startDate)} -{" "}
                      {formatDate(currentLease.endDate)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pending Payments */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            {t("payments.payRent.pending.title")} ({pendingPayments.length})
          </CardTitle>
          <CardDescription>
            {t("payments.payRent.pending.subtitle")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {pendingPayments.length === 0 ? (
            <div className="text-center py-8">
              <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">
                {t("payments.payRent.pending.allCaughtUp")}
              </h3>
              <p className="text-muted-foreground">
                {t("payments.payRent.pending.noPending")}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {pendingPayments.map((payment) => (
                <PaymentCard
                  key={payment._id}
                  payment={payment}
                  onPayNow={() => {
                    setSelectedPayment(payment);
                    setShowPaymentDialog(true);
                  }}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Payment Processing Dialog */}
      <PaymentDialog
        payment={selectedPayment}
        isOpen={showPaymentDialog}
        onClose={() => {
          setShowPaymentDialog(false);
          setSelectedPayment(null);
        }}
        onSuccess={() => {
          toast.success(t("payments.payRent.toasts.paymentSuccess"));
          setShowPaymentDialog(false);
          setSelectedPayment(null);
          fetchTenantPaymentData();
        }}
      />
    </div>
  );
}

// ============================================================================
// PAYMENT CARD COMPONENT
// ============================================================================

interface PaymentCardProps {
  payment: TenantPayment;
  onPayNow: () => void;
}

function PaymentCard({ payment, onPayNow }: PaymentCardProps) {
  const { t, formatCurrency, formatDate, language } = useLocalizationContext();

  const isOverdue = (dueDate: string) => {
    return new Date(dueDate) < new Date();
  };

  const getPaymentStatusBadge = (payment: TenantPayment) => {
    const isPaymentOverdue = isOverdue(payment.dueDate);

    if (isPaymentOverdue) {
      return (
        <Badge variant="destructive">
          {t("payments.payRent.status.overdue")}
        </Badge>
      );
    }

    if (payment.status === PaymentStatus.PENDING) {
      return (
        <Badge variant="secondary">
          {t("payments.payRent.status.pending")}
        </Badge>
      );
    }

    if (payment.status === PaymentStatus.PAID) {
      return (
        <Badge variant="default" className="bg-green-500">
          {t("payments.payRent.status.paid")}
        </Badge>
      );
    }

    if (payment.status === PaymentStatus.FAILED) {
      return (
        <Badge variant="destructive">
          {t("payments.payRent.status.failed")}
        </Badge>
      );
    }

    return (
      <Badge variant="outline">
        {t(`exports.value.${payment.status}`, { defaultValue: payment.status })}
      </Badge>
    );
  };

  const paymentOverdue = isOverdue(payment.dueDate);

  return (
    <Card
      className={`transition-all hover:shadow-md ${
        paymentOverdue ? "border-destructive" : ""
      }`}
    >
      <CardContent className="p-4 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex-1">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3 mb-3">
              <div className="flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-muted-foreground" />
                <span className="font-semibold text-sm sm:text-base">
                  {paymentTypeLabel(payment.type, t)}
                </span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {getPaymentStatusBadge(payment)}
                {paymentOverdue && (
                  <Badge variant="destructive" className="animate-pulse">
                    <AlertTriangle className="h-3 w-3 me-1" />
                    {t("payments.payRent.status.overdue")}
                  </Badge>
                )}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-sm text-muted-foreground">
                  {t("payments.payRent.card.property")}
                </p>
                <p className="font-medium">
                  {payment.propertyId?.name || t("payments.common.na")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {typeof payment.propertyId?.address === "string"
                    ? payment.propertyId.address
                    : payment.propertyId?.address?.street ||
                      t("payments.common.na")}
                </p>
              </div>

              <div>
                <p className="text-sm text-muted-foreground">
                  {t("payments.payRent.card.dueDate")}
                </p>
                <p
                  className={`font-medium ${
                    paymentOverdue ? "text-destructive" : ""
                  }`}
                >
                  {formatDate(payment.dueDate)}
                </p>
                {paymentOverdue && (
                  <p className="text-xs text-destructive">
                    {Math.ceil(
                      (new Date().getTime() -
                        new Date(payment.dueDate).getTime()) /
                        (1000 * 60 * 60 * 24)
                    )}{" "}
                    {t("payments.payRent.card.daysOverdue")}
                  </p>
                )}
              </div>
            </div>

            {payment.description && (
              <div className="mt-2">
                <p className="text-sm text-muted-foreground">
                  {t("payments.payRent.card.description")}
                </p>
                <p className="text-sm">
                  {describeCharge(
                    { description: payment.description, type: payment.type },
                    language,
                  )}
                </p>
              </div>
            )}
          </div>

          <div className="w-full sm:w-auto sm:text-end sm:ms-6">
            <div className="mb-3 sm:mb-2">
              <p className="text-sm text-muted-foreground">
                {t("payments.payRent.card.amountDue")}
              </p>
              <p className="text-xl sm:text-2xl font-bold">
                {formatCurrency(payment.amount)}
              </p>
            </div>

            <div className="space-y-2">
              <Button
                onClick={onPayNow}
                className="w-full sm:w-auto sm:min-w-[140px]"
                variant={paymentOverdue ? "destructive" : "default"}
                size="sm"
              >
                <CreditCard className="me-2 h-4 w-4" />
                <span className="hidden sm:inline">
                  {t("payments.payRent.card.pay")}{" "}
                </span>
                {formatCurrency(payment.amount)}
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// PAYMENT DIALOG COMPONENT
// ============================================================================

interface PaymentDialogProps {
  payment: TenantPayment | null;
  isOpen: boolean;
  onClose: () => void;
  /** An earlier attempt turned out paid. */
  onSuccess: () => void;
}

function PaymentDialog({
  payment,
  isOpen,
  onClose,
  onSuccess,
}: PaymentDialogProps) {
  const { t, formatCurrency } = useLocalizationContext();

  if (!payment) return null;

  return (
    <AlertDialog open={isOpen} onOpenChange={onClose}>
      <AlertDialogContent className="max-w-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            {t("payments.payRent.dialog.title")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("payments.payRent.dialog.subtitle")}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-4">
          {/* Payment Summary */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">
                {t("payments.payRent.dialog.summaryTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span>{t("payments.payRent.dialog.paymentType")}</span>
                  <span className="font-medium">
                    {paymentTypeLabel(payment.type, t)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>{t("payments.payRent.dialog.property")}</span>
                  <span className="font-medium">
                    {payment.propertyId?.name || t("payments.common.na")}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>{t("payments.payRent.dialog.baseAmount")}</span>
                  <span className="font-medium">
                    {formatCurrency(payment.amount)}
                  </span>
                </div>
                <div className="border-t pt-2">
                  <div className="flex justify-between text-lg font-bold">
                    <span>{t("payments.payRent.dialog.totalAmount")}</span>
                    <span>{formatCurrency(payment.amount)}</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* The office's gateways that can take this payment: each opens
              its own hosted page (mada, cards, Apple Pay, STC Pay…). */}
          <div className="min-h-[120px]">
            <GatewayPayOptions
              paymentId={payment._id}
              currency={payment.currency}
              returnPath="/dashboard/payments/pay-rent"
              emptyText={t("payments.payRent.onlineUnavailable", { defaultValue: "Online payment is not available. Please pay your property manager directly." })}
              onAlreadyPaid={onSuccess}
            />
          </div>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel onClick={onClose}>
            {t("payments.payRent.dialog.cancel")}
          </AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ============================================================================
// SKELETON LOADING COMPONENT
// ============================================================================

function PayRentPageSkeleton() {
  return (
    <div className="space-y-6">
      {/* Header Skeleton */}
      <div className="flex items-center justify-between">
        <div>
          <Skeleton className="h-8 w-32 mb-2" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-10 w-32" />
      </div>

      {/* Summary Cards Skeleton */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <Card key={i}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-4" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-24 mb-1" />
              <Skeleton className="h-3 w-16" />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Lease Information Skeleton */}
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-32 mb-2" />
          <Skeleton className="h-4 w-48" />
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Skeleton className="h-5 w-24 mb-2" />
              <Skeleton className="h-4 w-32 mb-1" />
              <Skeleton className="h-3 w-40" />
            </div>
            <div>
              <Skeleton className="h-5 w-20 mb-2" />
              <div className="space-y-2">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="flex justify-between">
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-3 w-16" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Pending Payments Skeleton */}
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-40 mb-2" />
          <Skeleton className="h-4 w-56" />
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[...Array(2)].map((_, i) => (
              <Card key={i}>
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <Skeleton className="h-4 w-4" />
                        <Skeleton className="h-4 w-20" />
                        <Skeleton className="h-5 w-16" />
                      </div>
                      <div className="grid gap-2 md:grid-cols-2">
                        <div>
                          <Skeleton className="h-3 w-12 mb-1" />
                          <Skeleton className="h-4 w-24 mb-1" />
                          <Skeleton className="h-3 w-32" />
                        </div>
                        <div>
                          <Skeleton className="h-3 w-16 mb-1" />
                          <Skeleton className="h-4 w-20" />
                        </div>
                      </div>
                    </div>
                    <div className="text-end ms-6">
                      <Skeleton className="h-3 w-16 mb-1" />
                      <Skeleton className="h-8 w-20 mb-2" />
                      <Skeleton className="h-10 w-24" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
