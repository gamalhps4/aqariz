"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
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
  ArrowLeft,
  Edit,
  Download,
  Mail,
  MoreHorizontal,
  DollarSign,
  Calendar,
  User,
  Building,
  FileText,
  Clock,
  AlertTriangle,
  CheckCircle,
  XCircle,
  CreditCard,
  Receipt,
} from "lucide-react";
import { showSimpleError, showSimpleSuccess } from "@/lib/toast-notifications";
import { useAuthorization } from "@/hooks/useAuthorization";
import {
  downloadInvoiceAsPDF,
  previewInvoice,
  type PrintableInvoice,
} from "@/lib/invoice-print";
import { normalizeInvoiceForPrint } from "@/lib/invoice/invoice-shared";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import PaymentRecordDialog from "@/components/invoice/PaymentRecordDialog";
import { useGatewayReturn } from "@/components/payments/GatewayPayOptions";
import { paymentMethodLabel } from "@/lib/payments/methods";
import { chargeTypeLabel, describeCharge } from "@/lib/i18n/charge-description";

interface InvoiceLineItem {
  description: string;
  amount: number;
  type: string;
  quantity?: number;
  unitPrice?: number;
  dueDate?: string;
  periodStart?: string;
  periodEnd?: string;
}

interface PaymentHistory {
  _id: string;
  amount: number;
  paidDate: string;
  paymentMethod: string;
  status: string;
}

interface Invoice {
  _id: string;
  invoiceNumber: string;
  tenantId: {
    _id: string;
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
  } | null;
  propertyId: {
    _id: string;
    name: string;
    address:
      | {
          street: string;
          city: string;
          state: string;
          zipCode: string;
          country: string;
        }
      | string;
  } | null;
  leaseId: {
    _id: string;
    startDate: string;
    endDate: string;
    terms: {
      rentAmount: number;
    };
  } | null;
  issueDate: string;
  dueDate: string;
  status: string;
  subtotal: number;
  taxAmount?: number;
  totalAmount: number;
  amountPaid: number;
  balanceRemaining: number;
  lineItems: InvoiceLineItem[];
  paymentIds: PaymentHistory[];
  lastPaymentDate?: string;
  emailSent: boolean;
  emailSentDate?: string;
  /** Two shapes: `{stage, sentAt}` from the shared sender (lib/invoice/
   * reminder — "manual" or a cron stage), and the older manual entries'
   * `{type, method, sentDate}`, logged by buttons that sent nothing. */
  remindersSent: Array<{
    stage?: string;
    sentAt?: string;
    type?: string;
    sentDate?: string;
    method?: string;
  }>;
  pdfGenerated: boolean;
  pdfPath?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export default function InvoiceDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const { isTenant } = useAuthorization();
  const {
    t,
    formatCurrency,
    formatDate: formatDateLocalized,
    language,
  } = useLocalizationContext();
  // Back from a gateway's payment page opened from the payment dialog.
  useGatewayReturn();
  const invoiceId = params.id as string;

  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  // "Mark as paid" opens the record dialog: how the money arrived decides
  // whether the office or the owner received it, so it is asked every time.
  const [recordOpen, setRecordOpen] = useState(false);

  const preparePrintableInvoice =
    useCallback(async (): Promise<PrintableInvoice> => {
      if (!invoice) {
        throw new Error("Invoice data not loaded");
      }

      const { getCompanyInfo } = await import("@/lib/utils/company-info");
      const companyInfo = await getCompanyInfo();

      // The PDF loads the logo itself (see loadDocumentLogo).
      return normalizeInvoiceForPrint(invoice, {
        companyInfo: companyInfo || undefined,
      }) as PrintableInvoice;
    }, [invoice]);

  useEffect(() => {
    if (invoiceId) {
      fetchInvoiceDetails();
    }
  }, [invoiceId]);

  const fetchInvoiceDetails = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/invoices/${invoiceId}`);
      const data = await response.json();

      if (data.success && data.data) {
        setInvoice(data.data);
      } else {
        showSimpleError(
          "Load Error",
          data.error || t("leases.invoices.details.toasts.fetchError")
        );
        router.push("/dashboard/leases/invoices");
      }
    } catch (error) {
      showSimpleError("Load Error", t("leases.invoices.details.toasts.fetchError"));
      router.push("/dashboard/leases/invoices");
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case "paid":
        return "bg-green-100 dark:bg-green-900/25 text-green-800 dark:text-green-200 border-green-200 dark:border-green-800/40";
      case "partial":
        return "bg-yellow-100 dark:bg-yellow-900/25 text-yellow-800 dark:text-yellow-200 border-yellow-200 dark:border-yellow-800/40";
      case "overdue":
        return "bg-red-100 dark:bg-red-900/25 text-red-800 dark:text-red-200 border-red-200 dark:border-red-800/40";
      case "issued":
        return "bg-blue-100 dark:bg-blue-900/25 text-blue-800 dark:text-blue-200 border-blue-200 dark:border-blue-800/40";
      case "scheduled":
        return "bg-muted text-muted-foreground border-border";
      case "cancelled":
        return "bg-muted text-muted-foreground border-border";
      default:
        return "bg-muted text-muted-foreground border-border";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status.toLowerCase()) {
      case "paid":
        return <CheckCircle className="h-4 w-4" />;
      case "partial":
        return <Clock className="h-4 w-4" />;
      case "overdue":
        return <AlertTriangle className="h-4 w-4" />;
      case "issued":
        return <FileText className="h-4 w-4" />;
      case "scheduled":
        return <Calendar className="h-4 w-4" />;
      case "cancelled":
        return <XCircle className="h-4 w-4" />;
      default:
        return <FileText className="h-4 w-4" />;
    }
  };

  const formatAddress = (address: any): string => {
    if (typeof address === "string") return address;
    if (address && typeof address === "object") {
      const { street, city, state, zipCode } = address;
      return `${street}, ${city}, ${state} ${zipCode}`;
    }
    return "";
  };

  const handleSendReminder = async () => {
    setActionLoading("send_reminder");
    try {
      const response = await fetch(`/api/invoices/${invoiceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "send_reminder",
          type: "reminder",
          method: "email",
        }),
      });

      const data = await response.json();
      if (data.success) {
        showSimpleSuccess("Reminder Sent", t("leases.invoices.details.toasts.reminderSuccess"));
        fetchInvoiceDetails();
      } else {
        showSimpleError(
          "Reminder Failed",
          data.error || t("leases.invoices.details.toasts.reminderError")
        );
      }
    } catch (error) {
      showSimpleError("Reminder Failed", t("leases.invoices.details.toasts.reminderError"));
    } finally {
      setActionLoading(null);
    }
  };

  const handleViewInvoice = async () => {
    if (!invoice) {
      showSimpleError("No Data", t("leases.invoices.details.toasts.noData"));
      return;
    }

    setActionLoading("view_invoice");
    try {
      const printable = await preparePrintableInvoice();
      // The invoice as it prints and downloads: the same PDF, in a window.
      previewInvoice(printable);
      showSimpleSuccess("Preview Opened", t("leases.invoices.details.toasts.previewOpened"));
    } catch (error) {
      console.error("View invoice error:", error);
      showSimpleError("Preview Failed", t("leases.invoices.details.toasts.previewError"));
    } finally {
      setActionLoading(null);
    }
  };

  const handleDownloadPDF = async () => {
    if (!invoice) {
      showSimpleError("No Data", t("leases.invoices.details.toasts.noData"));
      return;
    }

    setActionLoading("download_pdf");
    try {
      const printable = await preparePrintableInvoice();
      await downloadInvoiceAsPDF(printable);
      showSimpleSuccess("Download Complete", t("leases.invoices.details.toasts.downloadSuccess"));
      setInvoice((prev) =>
        prev
          ? {
              ...prev,
              pdfGenerated: true,
            }
          : prev
      );
    } catch (error) {
      console.error("Download invoice error:", error);
      showSimpleError("Download Failed", t("leases.invoices.details.toasts.downloadError"));
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto py-6 space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-10" />
          <div className="space-y-2">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-4 w-48" />
          </div>
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="container mx-auto py-6">
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <div className="text-center">
              <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">
                {t("leases.invoices.details.notFound.title")}
              </h3>
              <p className="text-muted-foreground mb-4">
                {t("leases.invoices.details.notFound.description")}
              </p>
              <Button onClick={() => router.push("/dashboard/leases/invoices")}>
                {t("leases.invoices.details.notFound.backButton")}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              {t("leases.invoices.details.header.title", {
                values: { invoiceNumber: invoice.invoiceNumber },
              })}
            </h1>
            <p className="text-muted-foreground">
              {t("leases.invoices.details.header.createdOn", {
                values: { date: formatDateLocalized(invoice.createdAt) },
              })}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Badge className={getStatusColor(invoice.status)}>
            {getStatusIcon(invoice.status)}
            <span className="ms-1">
              {t(`leases.invoices.status.${invoice.status.toLowerCase()}`)}
            </span>
          </Badge>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>
                {t("leases.invoices.actions.menuLabel")}
              </DropdownMenuLabel>
              <DropdownMenuItem onClick={handleViewInvoice}>
                <Receipt className="h-4 w-4 me-2" />
                {t("leases.invoices.actions.viewInvoice")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleDownloadPDF}>
                <Download className="h-4 w-4 me-2" />
                {t("leases.invoices.actions.downloadInvoice")}
              </DropdownMenuItem>

              {/* Admin/Manager Only Actions */}
              {!isTenant && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() =>
                      router.push(
                        `/dashboard/leases/invoices/${invoiceId}/edit`
                      )
                    }
                  >
                    <Edit className="h-4 w-4 me-2" />
                    {t("leases.invoices.details.actions.editInvoice")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleSendReminder}>
                    <Mail className="h-4 w-4 me-2" />
                    {t("leases.invoices.details.actions.sendReminder")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {invoice.status !== "paid" && (
                    <DropdownMenuItem onClick={() => setRecordOpen(true)}>
                      <CreditCard className="h-4 w-4 me-2" />
                      {t("leases.invoices.details.actions.markAsPaid")}
                    </DropdownMenuItem>
                  )}
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push("/dashboard/leases/invoices")}
            className="flex items-center gap-2"
          >
            <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" />
            {t("leases.invoices.details.header.backToInvoices")}
          </Button>
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Invoice Summary */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5" />
              {t("leases.invoices.details.summary.title")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  {t("leases.invoices.details.summary.subtotal")}
                </p>
                <p className="text-lg font-semibold">
                  {formatCurrency(invoice.subtotal)}
                </p>
              </div>
              {invoice.taxAmount && (
                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    {t("leases.invoices.details.summary.tax")}
                  </p>
                  <p className="text-lg font-semibold">
                    {formatCurrency(invoice.taxAmount)}
                  </p>
                </div>
              )}
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  {t("leases.invoices.details.summary.totalAmount")}
                </p>
                <p className="text-xl font-bold">
                  {formatCurrency(invoice.totalAmount)}
                </p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  {t("leases.invoices.details.summary.amountPaid")}
                </p>
                <p className="text-lg font-semibold text-success">
                  {formatCurrency(invoice.amountPaid)}
                </p>
              </div>
              <div className="col-span-2">
                <p className="text-sm font-medium text-muted-foreground">
                  {t("leases.invoices.details.summary.balanceRemaining")}
                </p>
                <p
                  className={`text-xl font-bold ${
                    invoice.balanceRemaining > 0
                      ? "text-destructive"
                      : "text-success"
                  }`}
                >
                  {formatCurrency(invoice.balanceRemaining)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Invoice Details */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              {t("leases.invoices.details.info.title")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  {t("leases.invoices.details.info.issueDate")}
                </p>
                <p className="font-semibold">
                  {formatDateLocalized(invoice.issueDate)}
                </p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  {t("leases.invoices.details.info.dueDate")}
                </p>
                <p className="font-semibold">
                  {formatDateLocalized(invoice.dueDate)}
                </p>
              </div>
              {invoice.lastPaymentDate && (
                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    {t("leases.invoices.details.info.lastPayment")}
                  </p>
                  <p className="font-semibold">
                    {formatDateLocalized(invoice.lastPaymentDate)}
                  </p>
                </div>
              )}
            </div>

            <Separator />

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-muted-foreground">
                  {t("leases.invoices.details.info.emailSent")}
                </span>
                <Badge variant={invoice.emailSent ? "default" : "secondary"}>
                  {invoice.emailSent
                    ? t("leases.invoices.details.info.yes")
                    : t("leases.invoices.details.info.no")}
                </Badge>
              </div>
              {invoice.emailSentDate && (
                <p className="text-xs text-muted-foreground">
                  {t("leases.invoices.details.info.emailSentOn", {
                    values: {
                      date: formatDateLocalized(invoice.emailSentDate),
                    },
                  })}
                </p>
              )}

              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-muted-foreground">
                  {t("leases.invoices.details.info.pdfGenerated")}
                </span>
                <Badge variant={invoice.pdfGenerated ? "default" : "secondary"}>
                  {invoice.pdfGenerated
                    ? t("leases.invoices.details.info.yes")
                    : t("leases.invoices.details.info.no")}
                </Badge>
              </div>

              {invoice.remindersSent.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-2">
                    {t("leases.invoices.details.info.remindersSent")}
                  </p>
                  <div className="space-y-1">
                    {invoice.remindersSent.map((reminder, index) => (
                      <div
                        key={index}
                        className="text-xs text-muted-foreground bg-muted p-2 rounded"
                      >
                        {reminder.stage
                          ? t(
                              reminder.stage === "manual"
                                ? "leases.invoices.details.info.reminderManual"
                                : "leases.invoices.details.info.reminderAuto",
                              {
                                values: {
                                  date: formatDateLocalized(
                                    reminder.sentAt ?? "",
                                  ),
                                },
                              },
                            )
                          : t("leases.invoices.details.info.reminderItem", {
                              values: {
                                type: reminder.type ?? "",
                                method: reminder.method ?? "",
                                date: formatDateLocalized(
                                  reminder.sentDate ?? "",
                                ),
                              },
                            })}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {invoice.notes && (
              <>
                <Separator />
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-2">
                    {t("leases.invoices.details.info.notes")}
                  </p>
                  <p className="text-sm text-muted-foreground bg-muted p-3 rounded">
                    {invoice.notes}
                  </p>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Tenant and Property Information */}
      <div
        className={`grid gap-6 ${
          isTenant ? "md:grid-cols-1" : "md:grid-cols-2"
        }`}
      >
        {/* Tenant Information - Hidden for Tenants */}
        {!isTenant && invoice.tenantId && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5" />
                {t("leases.invoices.details.tenant.title")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  {t("leases.invoices.details.tenant.name")}
                </p>
                <p className="font-semibold">
                  {invoice.tenantId.firstName} {invoice.tenantId.lastName}
                </p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  {t("leases.invoices.details.tenant.email")}
                </p>
                <p className="font-semibold">{invoice.tenantId.email}</p>
              </div>
              {invoice.tenantId.phone && (
                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    {t("leases.invoices.details.tenant.phone")}
                  </p>
                  <p className="font-semibold">{invoice.tenantId.phone}</p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Property Information */}
        {invoice.propertyId && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building className="h-5 w-5" />
                {t("leases.invoices.details.property.title")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  {t("leases.invoices.details.property.name")}
                </p>
                <p className="font-semibold">{invoice.propertyId.name}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  {t("leases.invoices.details.property.address")}
                </p>
                <p className="font-semibold">
                  {formatAddress(invoice.propertyId.address) ||
                    t("leases.labels.addressNotAvailable")}
                </p>
              </div>
              {invoice.leaseId && (
                <>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">
                      {t("leases.invoices.details.property.leasePeriod")}
                    </p>
                    <p className="font-semibold">
                      {formatDateLocalized(invoice.leaseId.startDate)} -{" "}
                      {formatDateLocalized(invoice.leaseId.endDate)}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">
                      {t("leases.invoices.details.property.monthlyRent")}
                    </p>
                    <p className="font-semibold">
                      {t("leases.invoices.details.property.monthlyRentValue", {
                        values: {
                          amount: formatCurrency(
                            invoice.leaseId.terms.rentAmount
                          ),
                        },
                      })}
                    </p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Line Items */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5" />
            {t("leases.invoices.details.lineItems.title")}
          </CardTitle>
          <CardDescription>
            {t("leases.invoices.details.lineItems.description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {invoice.lineItems.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Receipt className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>{t("leases.invoices.details.lineItems.empty")}</p>
              </div>
            ) : (
              invoice.lineItems.map((item, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between p-4 bg-muted rounded-lg"
                >
                  <div className="flex-1">
                    <p className="font-semibold">{describeCharge(item, language)}</p>
                    <div className="flex items-center gap-4 mt-1">
                      {chargeTypeLabel(item.type, language) && (
                        <Badge variant="outline" className="text-xs">
                          {chargeTypeLabel(item.type, language)}
                        </Badge>
                      )}
                      {item.quantity && item.unitPrice && (
                        <span className="text-sm text-muted-foreground">
                          {t(
                            "leases.invoices.details.lineItems.quantityAndUnit",
                            {
                              values: {
                                quantity: item.quantity,
                                unitPrice: formatCurrency(item.unitPrice),
                              },
                            }
                          )}
                        </span>
                      )}
                      {item.dueDate && (
                        <span className="text-sm text-muted-foreground">
                          {t("leases.invoices.details.lineItems.dueDate", {
                            values: {
                              date: formatDateLocalized(item.dueDate),
                            },
                          })}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-end">
                    <p className="text-lg font-semibold">
                      {formatCurrency(item.amount)}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      {/* Payment History */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            {t("leases.invoices.details.payments.title")}
          </CardTitle>
          <CardDescription>
            {t("leases.invoices.details.payments.description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {invoice.paymentIds?.length > 0 ? (
              invoice.paymentIds.map((payment, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between p-4 border rounded-lg"
                >
                  <div className="flex items-center gap-4">
                    <div className="p-2 bg-muted rounded-full">
                      <CreditCard className="h-4 w-4 text-success" />
                    </div>
                    <div>
                      <p className="font-semibold">
                        {formatCurrency(payment.amount)}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {t("leases.invoices.details.payments.paymentLine", {
                          values: {
                            date: formatDateLocalized(payment.paidDate),
                            method: paymentMethodLabel(payment.paymentMethod, t),
                          },
                        })}
                      </p>
                    </div>
                  </div>
                  <Badge
                    variant={
                      payment.status === "paid" ? "default" : "secondary"
                    }
                  >
                    {t(`exports.value.${payment.status}`, {
                      defaultValue: payment.status,
                    })}
                  </Badge>
                </div>
              ))
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <CreditCard className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>{t("leases.invoices.details.payments.emptyTitle")}</p>
                <p className="text-sm mt-1">
                  {t("leases.invoices.details.payments.emptySubtitle")}
                </p>
                {!isTenant && invoice.status !== "paid" && (
                  <Button className="mt-4" onClick={() => setRecordOpen(true)}>
                    {t("leases.invoices.actions.recordPayment")}
                  </Button>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle>
            {t("leases.invoices.details.quickActions.title")}
          </CardTitle>
          <CardDescription>
            {t("leases.invoices.details.quickActions.description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            {/* Tenant Payment Button - Show First for Unpaid Invoices */}
            {isTenant &&
              invoice.status !== "paid" &&
              invoice.balanceRemaining > 0 && (
                <Button
                  size="lg"
                  onClick={() =>
                    router.push(
                      `/dashboard/payments/pay-rent?invoiceId=${invoiceId}`
                    )
                  }
                  className="flex items-center gap-2 bg-linear-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700"
                >
                  <CreditCard className="h-5 w-5" />
                  {t("leases.invoices.details.quickActions.payNow", {
                    values: {
                      amount: formatCurrency(invoice.balanceRemaining),
                    },
                  })}
                </Button>
              )}

            {/* View & Download Actions - Available to All Users */}
            <Button
              variant="default"
              onClick={handleViewInvoice}
              disabled={actionLoading === "view_invoice"}
              className="flex items-center gap-2"
            >
              <Receipt className="h-4 w-4" />
              {actionLoading === "view_invoice"
                ? t("leases.invoices.details.quickActions.opening")
                : t("leases.invoices.actions.viewInvoice")}
            </Button>

            <Button
              variant="outline"
              onClick={handleDownloadPDF}
              disabled={actionLoading === "download_pdf"}
              className="flex items-center gap-2"
            >
              <Download className="h-4 w-4" />
              {actionLoading === "download_pdf"
                ? t("leases.invoices.details.quickActions.downloading")
                : t("leases.invoices.actions.downloadPdf")}
            </Button>

            {/* Admin/Manager Only Actions */}
            {!isTenant && invoice.status !== "paid" && (
              <>
                <Button
                  onClick={() => setRecordOpen(true)}
                  className="flex items-center gap-2"
                >
                  <CreditCard className="h-4 w-4" />
                  {t("leases.invoices.details.actions.markAsPaid")}
                </Button>

                <Button
                  variant="outline"
                  onClick={handleSendReminder}
                  disabled={actionLoading === "send_reminder"}
                  className="flex items-center gap-2"
                >
                  <Mail className="h-4 w-4" />
                  {actionLoading === "send_reminder"
                    ? t("leases.invoices.details.quickActions.sending")
                    : t("leases.invoices.details.actions.sendReminder")}
                </Button>

                <Button
                  variant="outline"
                  onClick={() =>
                    router.push(`/dashboard/leases/invoices/${invoiceId}/edit`)
                  }
                  className="flex items-center gap-2"
                >
                  <Edit className="h-4 w-4" />
                  {t("leases.invoices.details.actions.editInvoice")}
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {!isTenant && (
        <PaymentRecordDialog
          open={recordOpen}
          onOpenChange={setRecordOpen}
          invoice={{
            _id: invoice._id,
            invoiceNumber: invoice.invoiceNumber,
            totalAmount: invoice.totalAmount ?? 0,
            amountPaid: invoice.amountPaid ?? 0,
            balanceRemaining: invoice.balanceRemaining ?? 0,
            tenantId: invoice.tenantId
              ? {
                  firstName: invoice.tenantId.firstName || "",
                  lastName: invoice.tenantId.lastName || "",
                }
              : null,
          }}
          onPaymentRecorded={() => {
            setRecordOpen(false);
            fetchInvoiceDetails();
          }}
        />
      )}
    </div>
  );
}
