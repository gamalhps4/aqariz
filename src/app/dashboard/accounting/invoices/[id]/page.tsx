"use client";

import Image from "@/components/ui/app-image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  ArrowLeft,
  Printer,
  Download,
  Mail,
  Pencil,
  Trash2,
  CreditCard,
  FileText,
} from "lucide-react";
import {
  downloadInvoiceAsPDF,
  printInvoice,
  type PrintableInvoice,
} from "@/lib/invoice-print";
import { useState, useEffect, useCallback } from "react";
import { normalizeInvoiceForPrint } from "@/lib/invoice/invoice-shared";
import { useParams, useRouter } from "next/navigation";
import PaymentRecordDialog from "@/components/invoice/PaymentRecordDialog";
import InvoiceRefundDialog from "@/components/invoice/InvoiceRefundDialog";
import { showSimpleError, showSimpleSuccess } from "@/lib/toast-notifications";
import { useGatewayReturn } from "@/components/payments/GatewayPayOptions";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { displayCountry } from "@/lib/regional/region";
import { taxDocumentTitle } from "@/lib/invoice/tax-document";
import { describeCharge } from "@/lib/i18n/charge-description";
import Link from "next/link";

interface InvoiceLineItem {
  description: string;
  amount: number;
  type: string;
  quantity?: number;
  unitPrice?: number;
  dueDate?: string;
  /** The billing period a generated rent line covers. */
  periodStart?: string;
  periodEnd?: string;
  /** A line written with its own VAT (accounting phase 0). */
  vatCategory?: "S" | "Z" | "E" | "O";
  vatRate?: number;
  vatAmount?: number;
}

/** A credit note against this invoice, or the invoice a credit note corrects. */
interface LinkedDocument {
  id: string;
  invoiceNumber: string;
  issueDate?: string;
  totalAmount?: number;
  taxAmount?: number;
}

/** What an owner or a customer paid, kept on their invoice. */
interface Settlement {
  amount: number;
  paidDate: string;
  paymentMethod?: string;
  reference?: string | null;
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
    terms: { rentAmount: number };
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
  notes?: string;
  discountAmount?: number;
  // Accounting phase 0.
  documentType?: string;
  customerType?: string | null;
  customerName?: string | null;
  customerVatNumber?: string | null;
  customerAddress?: string | null;
  creditedAmount?: number;
  creditNotes?: LinkedDocument[];
  originalInvoice?: LinkedDocument | null;
  customerUser?: { email?: string | null; phone?: string | null } | null;
  settlements?: Settlement[];
  metadata?: { reason?: string | null; refundDue?: number; building?: { name?: string } };
}

interface CompanyInfo {
  name: string;
  address: string;
  phone: string;
  email: string;
  logo?: string;
  vatNumber?: string;
}

/** How a line's VAT reads: its rate, or what it is instead. */
function vatTreatment(
  item: InvoiceLineItem,
  t: (key: string, options?: { defaultValue?: string }) => string,
): string {
  switch (item.vatCategory) {
    case "S":
      return `${Number(item.vatRate ?? 0)}%`;
    case "Z":
      return t("invoices.vat.category.Z", { defaultValue: "Zero-rated" });
    case "E":
      return t("invoices.vat.category.E", { defaultValue: "Exempt" });
    case "O":
      return t("invoices.vat.category.O", { defaultValue: "Out of scope" });
    default:
      return "—";
  }
}

function formatAddress(
  address:
    | {
        street: string;
        city: string;
        state: string;
        zipCode: string;
        country?: string;
      }
    | string
    | null
    | undefined,
  language: string,
): string {
  if (!address) return "";
  if (typeof address === "string") return address;
  const parts = [
    address.street,
    address.city,
    address.state,
    address.zipCode,
    displayCountry(address.country, language),
  ].filter(Boolean);
  return parts.join(", ");
}

function statusPillClasses(status?: string | null): string {
  switch ((status || "").toLowerCase()) {
    case "paid":
      return "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-800/50";
    case "partial":
      return "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-800/50";
    case "overdue":
      return "bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-300 dark:border-red-800/50";
    case "issued":
      return "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-800/50";
    case "scheduled":
      return "bg-muted text-muted-foreground border-border";
    case "cancelled":
      return "bg-muted text-muted-foreground border-border line-through";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

function formatSafeDate(
  value: string | undefined,
  formatter: (d: Date) => string,
): string {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : formatter(parsed);
}

export default function InvoiceDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const { t, formatCurrency, formatDate, language } = useLocalizationContext();
  const invoiceId = params.id as string;

  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [companyInfo, setCompanyInfo] = useState<CompanyInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [collectOpen, setCollectOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const preparePrintableInvoice =
    useCallback(async (): Promise<PrintableInvoice> => {
      if (!invoice) throw new Error("Invoice data not loaded");
      const { getCompanyInfo } = await import("@/lib/utils/company-info");
      const info = await getCompanyInfo();
      // The PDF loads the logo itself (see loadDocumentLogo).
      return normalizeInvoiceForPrint(invoice, {
        companyInfo: info || undefined,
      }) as PrintableInvoice;
    }, [invoice]);

  useEffect(() => {
    if (!invoiceId) return;
    fetchInvoiceDetails();
    (async () => {
      const { getCompanyInfo } = await import("@/lib/utils/company-info");
      setCompanyInfo(await getCompanyInfo());
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceId]);

  // Back from a gateway's payment page: the return route has already asked
  // the gateway and recorded the money, and the invoice above loads fresh.
  useGatewayReturn();

  const fetchInvoiceDetails = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/invoices/${invoiceId}`);
      const data = await response.json();
      if (data?.success && data?.data) {
        setInvoice(data.data);
      } else {
        showSimpleError(
          "Load Error",
          data?.error || t("leases.invoices.details.toasts.fetchError"),
        );
        router.push("/dashboard/accounting/invoices");
      }
    } catch {
      showSimpleError(
        "Load Error",
        t("leases.invoices.details.toasts.fetchError"),
      );
      router.push("/dashboard/accounting/invoices");
    } finally {
      setLoading(false);
    }
  };

  const handlePrint = async () => {
    if (!invoice) return;
    setActionLoading("print");
    try {
      const printable = await preparePrintableInvoice();
      // The same PDF the Download button saves, with its footer on every page.
      printInvoice(printable);
    } catch (error) {
      console.error(error);
      showSimpleError(
        "Preview Failed",
        t("leases.invoices.details.toasts.previewError"),
      );
    } finally {
      setActionLoading(null);
    }
  };

  const handleDownload = async () => {
    if (!invoice) return;
    setActionLoading("download");
    try {
      const printable = await preparePrintableInvoice();
      await downloadInvoiceAsPDF(printable);
      showSimpleSuccess(
        "Download Complete",
        t("leases.invoices.details.toasts.downloadSuccess"),
      );
    } catch (error) {
      console.error(error);
      showSimpleError(
        "Download Failed",
        t("leases.invoices.details.toasts.downloadError"),
      );
    } finally {
      setActionLoading(null);
    }
  };

  const handleEmail = async () => {
    if (!invoice?.tenantId?.email && !invoice?.customerUser?.email) {
      showSimpleError(
        t("leases.invoices.toasts.emailFailedTitle", { defaultValue: "Email not sent" }),
        t("leases.invoiceEmail.noEmail", {
          defaultValue: "This tenant has no email address on file.",
        }),
      );
      return;
    }
    setActionLoading("email");
    try {
      const res = await fetch("/api/invoices/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The route addresses it to the invoice's tenant and words it in
        // this language. This used to send `tenantEmail` instead of the `to`
        // the route required, so every attempt was refused.
        body: JSON.stringify({
          invoiceId: invoice._id,
          invoiceNumber: invoice.invoiceNumber,
          lang: language,
        }),
      });
      const data = await res.json();
      if (res.ok && data?.success) {
        showSimpleSuccess(
          t("leases.invoices.toasts.emailSentTitle", { defaultValue: "Email sent" }),
          t("leases.invoices.toasts.emailSuccess"),
        );
        fetchInvoiceDetails();
      } else {
        throw new Error(data?.error || t("leases.invoices.toasts.emailError"));
      }
    } catch {
      showSimpleError(t("leases.invoices.toasts.emailFailedTitle", { defaultValue: "Email not sent" }), t("leases.invoices.toasts.emailError"));
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async () => {
    if (!invoice) return;
    try {
      setDeleting(true);
      const res = await fetch(`/api/invoices/${invoice._id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (res.ok && data?.success) {
        showSimpleSuccess("Invoice Deleted", "");
        router.push("/dashboard/accounting/invoices");
      } else {
        throw new Error(data?.error || "Delete failed");
      }
    } catch {
      showSimpleError("Delete Failed", "Could not delete invoice.");
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-4xl p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <Skeleton className="h-7 w-72" />
            <Skeleton className="h-4 w-48" />
          </div>
          <Skeleton className="h-10 w-32" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
        <Skeleton className="h-120" />
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="mx-auto w-full max-w-4xl p-6">
        <div className="rounded-lg border bg-card p-12 text-center">
          <FileText className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
          <h3 className="mb-2 text-lg font-semibold">
            {t("leases.invoices.details.notFound.title")}
          </h3>
          <p className="mb-4 text-muted-foreground">
            {t("leases.invoices.details.notFound.description")}
          </p>
          <Button onClick={() => router.push("/dashboard/accounting/invoices")}>
            {t("leases.invoices.details.notFound.backButton")}
          </Button>
        </div>
      </div>
    );
  }

  // The buyer: the owner or customer the invoice names, else its tenant.
  const tenantName =
    invoice.customerName?.trim() ||
    (invoice.tenantId
      ? `${invoice.tenantId?.firstName || ""} ${
          invoice.tenantId?.lastName || ""
        }`.trim() || "—"
      : "—");
  // Generated lines ("Monthly Rent") in the reader's language; typed ones as typed.
  const headerSubtitle =
    (invoice.lineItems?.[0] && describeCharge(invoice.lineItems[0], language)) ||
    invoice.propertyId?.name ||
    "";
  const tenantPhone = invoice.tenantId?.phone || invoice.customerUser?.phone || "";
  const tenantEmail = invoice.tenantId?.email || invoice.customerUser?.email || "";

  // A credit note shows what it credits, positive; it is stored negative.
  const isCreditNote = invoice.documentType === "credit_note";
  const shown = (value: number | undefined) =>
    isCreditNote ? Math.abs(value ?? 0) : (value ?? 0);
  const title = taxDocumentTitle({
    documentType: invoice.documentType,
    sellerVatNumber: companyInfo?.vatNumber,
    buyerVatNumber: invoice.customerVatNumber,
  });
  const showVat = invoice.lineItems?.some((item) => item.vatCategory) ?? false;
  const vatByRate = new Map<number, number>();
  for (const item of invoice.lineItems ?? []) {
    if (item.vatCategory !== "S") continue;
    const rate = Number(item.vatRate ?? 0);
    vatByRate.set(rate, (vatByRate.get(rate) ?? 0) + Math.abs(Number(item.vatAmount ?? 0)));
  }
  const creditable =
    Math.round(((invoice.totalAmount ?? 0) - (invoice.creditedAmount ?? 0)) * 100) / 100;
  const canCredit =
    !isCreditNote && invoice.status !== "cancelled" && creditable > 0;

  return (
    <div className="mx-auto w-full max-w-4xl p-6 space-y-4">
      {/* Top bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">
              {invoice.invoiceNumber}
            </h1>
            <Badge
              variant="outline"
              className={`capitalize ${statusPillClasses(invoice.status)}`}
            >
              {t(`leases.invoices.status.${invoice.status}`, {
                defaultValue: invoice.status || "—",
              })}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {tenantName}
            {headerSubtitle ? ` • ${headerSubtitle}` : ""}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => router.push("/dashboard/accounting/invoices")}
        >
          <ArrowLeft className="me-2 h-4 w-4 rtl:-scale-x-100" />
          {t("leases.invoiceView.back", { defaultValue: "Back to invoices" })}
        </Button>
      </div>

      {/* Action bar */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={handlePrint}
          disabled={actionLoading === "print"}
        >
          <Printer className="me-2 h-4 w-4" />
          {t("leases.invoiceDoc.print", { defaultValue: "Print" })}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleDownload}
          disabled={actionLoading === "download"}
        >
          <Download className="me-2 h-4 w-4" />
          {t("leases.invoiceView.download", { defaultValue: "Download" })}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleEmail}
          disabled={actionLoading === "email"}
        >
          <Mail className="me-2 h-4 w-4" />
          {t("leases.invoiceDoc.email.button", { defaultValue: "Email" })}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            router.push(`/dashboard/accounting/invoices/${invoice._id}/edit`)
          }
        >
          <Pencil className="me-2 h-4 w-4" />
          {t("leases.invoiceView.edit", { defaultValue: "Edit" })}
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="text-red-600 hover:text-red-700"
            >
              <Trash2 className="me-2 h-4 w-4" />
              {t("leases.invoiceView.delete", { defaultValue: "Delete" })}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t("leases.invoiceView.deleteTitle", { defaultValue: "Delete this invoice?" })}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t("leases.invoiceView.deleteDescription", { defaultValue: "Invoice {number} will be deleted. An invoice with payments recorded against it cannot be deleted until they are.", values: { number: invoice.invoiceNumber } })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>
                {t("common.cancel", { defaultValue: "Cancel" })}
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDelete}
                disabled={deleting}
                className="bg-red-600 text-white hover:bg-red-700"
              >
                {deleting
                  ? t("leases.invoiceView.deleting", { defaultValue: "Deleting…" })
                  : t("leases.invoiceView.delete", { defaultValue: "Delete" })}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {canCredit && (
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              router.push(
                `/dashboard/accounting/invoices/new?creditNoteFor=${invoice._id}`,
              )
            }
          >
            <FileText className="me-2 h-4 w-4" />
            {t("invoices.creditNote.issue", { defaultValue: "Issue credit note" })}
          </Button>
        )}

        {!isCreditNote && (
          <Button
            size="sm"
            className="ms-auto bg-emerald-600 text-white hover:bg-emerald-700"
            onClick={() => setCollectOpen(true)}
            disabled={(invoice.balanceRemaining ?? 0) <= 0}
          >
            <CreditCard className="me-2 h-4 w-4" />
            {t("leases.invoiceView.collect", { defaultValue: "Record payment" })}
          </Button>
        )}
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs text-muted-foreground">
            {t("leases.invoiceView.total", { defaultValue: "Invoice total" })}
          </p>
          <p className="mt-1 text-2xl font-semibold">
            {formatCurrency(shown(invoice.totalAmount))}
          </p>
          {(invoice.creditedAmount ?? 0) > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              {t("invoices.creditNote.credited", {
                defaultValue: "Credited: {amount}",
                values: { amount: formatCurrency(invoice.creditedAmount ?? 0) },
              })}
            </p>
          )}
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs text-muted-foreground">
            {t("leases.invoiceView.collected", { defaultValue: "Collected" })}
          </p>
          <p className="mt-1 text-2xl font-semibold text-emerald-600">
            {formatCurrency(invoice.amountPaid ?? 0)}
          </p>
        </div>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/50 dark:bg-amber-950/20">
          <p className="text-xs text-amber-700 dark:text-amber-400">
            {t("leases.invoiceView.outstanding", { defaultValue: "Outstanding" })}
          </p>
          <p className="mt-1 text-2xl font-semibold text-amber-700 dark:text-amber-400">
            {formatCurrency(invoice.balanceRemaining ?? 0)}
          </p>
        </div>
      </div>

      {/* Invoice document */}
      <div className="rounded-lg border bg-card p-6 sm:p-8">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-2xl font-semibold">
              {t(title.key, { defaultValue: title.english })}
            </h2>
            {language !== "ar" && companyInfo?.vatNumber ? (
              <p className="text-sm text-muted-foreground" dir="rtl">
                {title.arabic}
              </p>
            ) : null}
            {isCreditNote && invoice.originalInvoice ? (
              <p className="mt-1 text-sm text-muted-foreground">
                {t("leases.invoicePrint.creditNoteFor", {
                  defaultValue: "Credits invoice {number}",
                  values: { number: invoice.originalInvoice.invoiceNumber },
                })}{" "}
                <Link
                  href={`/dashboard/accounting/invoices/${invoice.originalInvoice.id}`}
                  className="underline"
                >
                  {t("invoices.creditNote.openOriginal", { defaultValue: "Open" })}
                </Link>
              </p>
            ) : null}
          </div>
          {companyInfo?.logo ? (
            <div className="relative h-10 w-10 overflow-hidden rounded-md">
              <Image
                src={companyInfo.logo}
                alt={companyInfo.name}
                fill
                sizes="40px"
                className="object-contain"
              />
            </div>
          ) : null}
        </div>

        <dl className="mt-6 grid grid-cols-[auto_1fr] gap-x-8 gap-y-2 text-sm">
          <dt className="font-medium">
            {t("leases.invoiceDoc.number", { defaultValue: "Invoice no." })}
          </dt>
          <dd className="text-muted-foreground">{invoice.invoiceNumber}</dd>

          <dt className="font-medium">
            {t("leases.invoiceDoc.issueDate", { defaultValue: "Issued" })}
          </dt>
          <dd className="text-muted-foreground">
            {formatSafeDate(invoice.issueDate, formatDate)}
          </dd>

          <dt className="font-medium">
            {t("leases.invoiceDoc.dueDate", { defaultValue: "Due" })}
          </dt>
          <dd className="text-muted-foreground">
            {formatSafeDate(invoice.dueDate, formatDate)}
          </dd>

          <dt className="font-medium">
            {t("leases.invoiceDoc.status", { defaultValue: "Status" })}
          </dt>
          <dd>
            <Badge
              variant="outline"
              className={`capitalize ${statusPillClasses(invoice.status)}`}
            >
              {t(`leases.invoices.status.${invoice.status}`, {
                defaultValue: invoice.status || "—",
              })}
            </Badge>
          </dd>
        </dl>

        <div className="mt-6 h-px bg-border" />

        <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("leases.invoicePrint.from", { defaultValue: "From" })}
            </p>
            <div className="mt-2 space-y-0.5 text-sm">
              <p className="font-semibold">{companyInfo?.name || "—"}</p>
              {companyInfo?.address ? (
                <p className="text-muted-foreground">{companyInfo.address}</p>
              ) : null}
              {companyInfo?.phone ? (
                <p className="text-muted-foreground">{companyInfo.phone}</p>
              ) : null}
              {companyInfo?.email ? (
                <p className="text-muted-foreground">{companyInfo.email}</p>
              ) : null}
              {companyInfo?.vatNumber ? (
                <p className="text-muted-foreground">
                  {t("leases.invoicePrint.vatNumber", {
                    defaultValue: "VAT No. {number}",
                    values: { number: companyInfo.vatNumber },
                  })}
                </p>
              ) : null}
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("leases.invoicePrint.to", { defaultValue: "Bill to" })}
            </p>
            <div className="mt-2 space-y-0.5 text-sm">
              <p className="font-semibold">{tenantName}</p>
              {invoice.customerAddress ? (
                <p className="text-muted-foreground">{invoice.customerAddress}</p>
              ) : null}
              {invoice.customerVatNumber ? (
                <p className="text-muted-foreground">
                  {t("leases.invoicePrint.vatNumber", {
                    defaultValue: "VAT No. {number}",
                    values: { number: invoice.customerVatNumber },
                  })}
                </p>
              ) : null}
              {!invoice.propertyId && invoice.metadata?.building?.name ? (
                <p className="text-muted-foreground">{invoice.metadata.building.name}</p>
              ) : null}
              {tenantPhone ? (
                <p className="text-muted-foreground">{tenantPhone}</p>
              ) : null}
              {tenantEmail ? (
                <p className="text-muted-foreground">{tenantEmail}</p>
              ) : null}
              {invoice.propertyId ? (
                <p className="text-muted-foreground">
                  {invoice.propertyId?.name || "—"}
                  {invoice.propertyId?.address
                    ? ` — ${formatAddress(invoice.propertyId?.address, language)}`
                    : ""}
                </p>
              ) : null}
            </div>
          </div>
        </div>

        <div className="mt-8">
          <h3 className="text-sm font-semibold">
            {t("leases.invoiceView.items", { defaultValue: "Items" })}
          </h3>
          <div className="mt-3 overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-start">
                  <th className="px-3 py-2 font-medium text-muted-foreground">
                    #
                  </th>
                  <th className="px-3 py-2 font-medium text-muted-foreground">
                    {t("leases.invoicePrint.description", { defaultValue: "Description" })}
                  </th>
                  <th className="px-3 py-2 text-end font-medium text-muted-foreground">
                    {t("leases.invoicePrint.quantity", { defaultValue: "Qty" })}
                  </th>
                  <th className="px-3 py-2 text-end font-medium text-muted-foreground">
                    {t("leases.invoicePrint.unitPrice", { defaultValue: "Unit price" })}
                  </th>
                  {showVat && (
                    <th className="px-3 py-2 text-end font-medium text-muted-foreground">
                      {t("leases.invoicePrint.vatColumn", { defaultValue: "VAT" })}
                    </th>
                  )}
                  <th className="px-3 py-2 text-end font-medium text-muted-foreground">
                    {t("leases.invoicePrint.total", { defaultValue: "Total" })}
                  </th>
                </tr>
              </thead>
              <tbody>
                {invoice.lineItems?.length ? (
                  invoice.lineItems.map((item, idx) => {
                    const qty = item.quantity ?? 1;
                    const unitPrice = item.unitPrice ?? item.amount;
                    return (
                      <tr
                        key={`${item?.description || "line-item"}-${idx}`}
                        className="border-b last:border-b-0"
                      >
                        <td className="px-3 py-2 text-muted-foreground">
                          {idx + 1}
                        </td>
                        <td className="px-3 py-2">
                          {describeCharge(item, language) || "—"}
                        </td>
                        <td className="px-3 py-2 text-end">{qty}</td>
                        <td className="px-3 py-2 text-end">
                          {formatCurrency(shown(unitPrice))}
                        </td>
                        {showVat && (
                          <td className="px-3 py-2 text-end">
                            <div>{vatTreatment(item, t)}</div>
                            {item.vatCategory === "S" ? (
                              <div className="text-xs text-muted-foreground">
                                {formatCurrency(Math.abs(item.vatAmount ?? 0))}
                              </div>
                            ) : null}
                          </td>
                        )}
                        <td className="px-3 py-2 text-end font-medium">
                          {formatCurrency(shown(item?.amount))}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td
                      colSpan={showVat ? 6 : 5}
                      className="px-3 py-6 text-center text-muted-foreground"
                    >
                      {t("leases.invoicePrint.noItems", { defaultValue: "No line items" })}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex justify-end">
            <dl className="w-full max-w-xs space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">
                  {t("leases.invoicePrint.subtotal", { defaultValue: "Subtotal" })}
                </dt>
                <dd>{formatCurrency(shown(invoice.subtotal))}</dd>
              </div>
              {invoice.discountAmount ? (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">
                    {t("leases.invoicePrint.discount", { defaultValue: "Discount" })}
                  </dt>
                  <dd>-{formatCurrency(Math.abs(invoice.discountAmount))}</dd>
                </div>
              ) : null}
              {vatByRate.size > 0 ? (
                [...vatByRate.entries()].map(([rate, amount]) => (
                  <div key={rate} className="flex justify-between">
                    <dt className="text-muted-foreground">
                      {t("leases.invoicePrint.vat", { defaultValue: "VAT" })} ({rate}%)
                    </dt>
                    <dd>{formatCurrency(amount)}</dd>
                  </div>
                ))
              ) : invoice.taxAmount ? (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">
                    {t("leases.invoicePrint.vat", { defaultValue: "VAT" })}
                  </dt>
                  <dd>{formatCurrency(shown(invoice.taxAmount))}</dd>
                </div>
              ) : null}
              <div className="flex justify-between border-t pt-2 text-base font-semibold">
                <dt>{t("leases.invoicePrint.total", { defaultValue: "Total" })}</dt>
                <dd>{formatCurrency(shown(invoice.totalAmount))}</dd>
              </div>
            </dl>
          </div>
        </div>

        {isCreditNote && invoice.metadata?.reason ? (
          <p className="mt-6 text-sm text-muted-foreground">
            {t("invoices.creditNote.reason", { defaultValue: "Reason" })}: {invoice.metadata.reason}
          </p>
        ) : null}
      </div>

      {/* The credit notes issued against this invoice. */}
      {(invoice.creditNotes?.length ?? 0) > 0 && (
        <div className="rounded-lg border bg-card p-4">
          <h3 className="text-sm font-semibold">
            {t("invoices.creditNote.list", { defaultValue: "Credit notes" })}
          </h3>
          <ul className="mt-2 space-y-1 text-sm">
            {invoice.creditNotes!.map((note) => (
              <li key={note.id} className="flex justify-between gap-4">
                <Link
                  href={`/dashboard/accounting/invoices/${note.id}`}
                  className="font-mono underline"
                >
                  {note.invoiceNumber}
                </Link>
                <span className="text-muted-foreground">
                  {formatSafeDate(note.issueDate, formatDate)}
                </span>
                <span>{formatCurrency(Math.abs(note.totalAmount ?? 0))}</span>
              </li>
            ))}
          </ul>
          {(invoice.metadata?.refundDue ?? 0) > 0 && (
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-amber-700 dark:text-amber-400">
                {t("invoices.creditNote.refundDue", {
                  defaultValue: "Refund due to the customer: {amount}",
                  values: { amount: formatCurrency(invoice.metadata?.refundDue ?? 0) },
                })}
              </p>
              {/* An owner's or a customer's: a tenant's credit stays on their account. */}
              {!invoice.tenantId && (
                <Button size="sm" variant="outline" onClick={() => setRefundOpen(true)}>
                  {t("invoices.creditNote.recordRefund", { defaultValue: "Record refund paid" })}
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {/* What an owner or a customer paid on it. */}
      {(invoice.settlements?.length ?? 0) > 0 && (
        <div className="rounded-lg border bg-card p-4">
          <h3 className="text-sm font-semibold">
            {t("invoices.settlements.title", { defaultValue: "Payments received" })}
          </h3>
          <ul className="mt-2 space-y-1 text-sm">
            {invoice.settlements!.map((entry, index) => (
              <li key={index} className="flex justify-between gap-4">
                <span className="text-muted-foreground">
                  {formatSafeDate(entry.paidDate, formatDate)}
                </span>
                <span>
                  {entry.paymentMethod
                    ? t(`exports.value.${entry.paymentMethod}`, {
                        defaultValue: entry.paymentMethod.replace(/_/g, " "),
                      })
                    : "—"}
                  {entry.reference ? ` · ${entry.reference}` : ""}
                </span>
                <span>{formatCurrency(entry.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {refundOpen && (
        <InvoiceRefundDialog
          open={refundOpen}
          onOpenChange={setRefundOpen}
          invoiceId={invoice._id}
          refundDue={invoice.metadata?.refundDue ?? 0}
          forOwner={invoice.customerType === "owner"}
          onRecorded={() => {
            setRefundOpen(false);
            fetchInvoiceDetails();
          }}
        />
      )}

      <PaymentRecordDialog
        open={collectOpen}
        onOpenChange={setCollectOpen}
        invoice={{
          _id: invoice._id,
          invoiceNumber: invoice.invoiceNumber,
          totalAmount: invoice.totalAmount ?? 0,
          amountPaid: invoice.amountPaid ?? 0,
          balanceRemaining: invoice.balanceRemaining ?? 0,
          tenantId: invoice.tenantId
            ? {
                firstName: invoice.tenantId?.firstName || "",
                lastName: invoice.tenantId?.lastName || "",
              }
            : null,
        }}
        onPaymentRecorded={() => {
          setCollectOpen(false);
          fetchInvoiceDetails();
        }}
      />
    </div>
  );
}
