"use client";

/**
 * PropertyPro - Payments
 *
 * Every payment and charge the office can see, each shown on the contract
 * and installment it belongs to.
 *
 * Money is recorded in one place: the installment dialog (contract →
 * installment → date, method, amount, reference, notes), the same one the
 * contract's own Payments tab uses. "Record payment" used to open a separate
 * page that failed on every attempt ("Failed to process payment"), and "Add
 * payment" wrote an unpaid charge that read as if money had been taken; the
 * second is now called what it is, "Add a charge".
 */

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  BarChart3,
  Calendar,
  CheckCircle,
  Clock,
  CreditCard,
  DollarSign,
  Edit,
  Eye,
  Grid3X3,
  List,
  MessageCircle,
  MessageSquare,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Trash2,
  XCircle,
} from "lucide-react";
import { showSimpleError, showSimpleSuccess } from "@/lib/toast-notifications";
import { ReportExportButton } from "@/components/reports/export-button";
import {
  EMPTY_RECORD_FILTERS,
  PaymentRecordFilters,
  countActiveRecordFilters,
  type PaymentRecordFilterValue,
} from "@/components/payments/PaymentRecordFilters";
import PaymentRecordDialog from "@/components/invoice/PaymentRecordDialog";
import { useGatewayReturn } from "@/components/payments/GatewayPayOptions";
import { useSession } from "@/lib/auth-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import GlobalSearch from "@/components/ui/global-search";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { PaymentType, PaymentStatus, PaymentMethod } from "@/types";
import { GlobalPagination } from "@/components/ui/global-pagination";
import { DataTable, DataTableColumn } from "@/components/ui/data-table";
import type { SortDirection } from "@/lib/table-sort";
import { PaymentMessageDialog } from "@/components/payments/PaymentMessageDialog";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  AnalyticsCard,
  AnalyticsCardGrid,
} from "@/components/analytics/AnalyticsCard";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import {
  MANUAL_PAYMENT_METHODS,
  paymentMethodLabel,
} from "@/lib/payments/methods";
import {
  isOnlinePayment,
  recordedByText,
  type PaymentRecorderFields,
} from "@/lib/payments/recorder";
import { paymentReference } from "@/lib/payments/report-lines";
import { useAuthorization } from "@/hooks/useAuthorization";
import { hasAnyPermission } from "@/lib/permissions-manager";
import {
  daysOverdue as computeDaysOverdue,
  isPaymentDisplayStatus,
  paymentDisplayStatus,
  PAYMENT_DISPLAY_STATUSES,
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUS_STYLES,
  type PaymentDisplayStatus,
} from "@/lib/payments/display-status";
import { CHARGE_TYPES, paymentTypeLabel } from "@/lib/payments/type-labels";

/** A row as `/api/payments` returns it. `recordedBy` arrives for staff only. */
interface Payment extends PaymentRecorderFields {
  _id: string;
  /**
   * RCP-000123 — the payment number, which is also its receipt number. Null
   * for a charge nobody has paid.
   */
  paymentNumber?: string | null;
  /** Money events; a recorded one carries the reference the office typed. */
  paymentHistory?: unknown;
  amount: number;
  /** What has actually arrived against this row; the rest is still owed. */
  amountPaid?: number;
  type: PaymentType;
  status: PaymentStatus;
  paymentMethod?: PaymentMethod;
  dueDate: string;
  paidDate?: string;
  description?: string;
  notes?: string;
  tenantId: {
    _id: string;
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
  };
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
  leaseId?: string | null;
  invoiceId?: string | null;
  /** The contract this row is on. */
  lease?: {
    _id: string;
    contractNumber?: string | null;
    startDate: string;
    endDate: string;
    status: string;
    unit?: { unitNumber?: string | null } | null;
  } | null;
  /** The installment this row belongs to. */
  invoice?: {
    _id: string;
    invoiceNumber: string;
    dueDate: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

/** What the record dialog opens on. */
interface Recording {
  leaseId?: string;
  invoiceId?: string;
  convertPaymentId?: string;
  convertInvoiceId?: string | null;
  amount?: number;
}

const noopSubscribe = () => () => {};

/** Statuses of a row that has no money on it yet, so it can become the receipt. */
const CONVERTIBLE_STATUSES: string[] = [
  PaymentStatus.PENDING,
  PaymentStatus.OVERDUE,
  PaymentStatus.FAILED,
];

/** A payment's contract id, whether the API sent the id or the contract. */
function leaseIdOf(payment: {
  leaseId?: unknown;
  lease?: { _id?: string } | null;
}): string | undefined {
  if (typeof payment.leaseId === "string" && payment.leaseId) {
    return payment.leaseId;
  }
  const populated = payment.leaseId as { _id?: string; id?: string } | null;
  return payment.lease?._id ?? populated?._id ?? populated?.id ?? undefined;
}

/**
 * Where "Record payment" on a row starts: its contract, its installment, and
 * — for an entry with no money on it yet — that entry, so recording turns it
 * into the receipt instead of leaving it beside one still reading as owed.
 */
function recordingFor(payment: Payment): Recording {
  const paid = Number(payment.amountPaid ?? 0);
  const convertible =
    paid === 0 &&
    CONVERTIBLE_STATUSES.includes(payment.status) &&
    !isOnlinePayment(payment);
  const owed = Math.max(0, Number(payment.amount) - paid);
  return {
    leaseId: leaseIdOf(payment),
    invoiceId: payment.invoiceId ?? undefined,
    convertPaymentId: convertible ? payment._id : undefined,
    convertInvoiceId: payment.invoiceId ?? null,
    amount: owed > 0 ? owed : undefined,
  };
}

export default function PaymentsPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t, formatCurrency, formatDate } = useLocalizationContext();
  // Back from a gateway's payment page opened from the payment dialog.
  useGatewayReturn();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  // A badge state ("overdue", "due", "partial"…) — what the rows show, not
  // the stored status. See displayStatusWhere.
  const [statusFilter, setStatusFilter] = useState<"all" | PaymentDisplayStatus>(
    "all",
  );
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [paymentMethodFilter, setPaymentMethodFilter] = useState<string>("all");

  // `?leaseId=` opens the page on one contract's payments — the contract
  // pages link here that way, and the parameter used to be ignored.
  const urlLeaseId = searchParams?.get("leaseId") ?? "";
  const [recordFilters, setRecordFilters] = useState<PaymentRecordFilterValue>(
    () => ({ ...EMPTY_RECORD_FILTERS, leaseId: urlLeaseId }),
  );
  // What the panel narrowed to, in words, so the totals below say what they
  // are about instead of silently changing meaning.
  const [recordFilterLabel, setRecordFilterLabel] = useState("");
  // A new `?leaseId=` while the page is open (another contract's link).
  const [seenUrlLeaseId, setSeenUrlLeaseId] = useState(urlLeaseId);
  if (urlLeaseId !== seenUrlLeaseId) {
    setSeenUrlLeaseId(urlLeaseId);
    setRecordFilters((previous) => ({ ...previous, leaseId: urlLeaseId }));
    setRecordFilterLabel("");
  }

  const [viewMode, setViewMode] = useState<"table" | "card">("table");
  const [paymentToDelete, setPaymentToDelete] = useState<Payment | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [recording, setRecording] = useState<Recording | null>(null);

  const { accessProfile } = useAuthorization();
  // Delete is its own permission — the review asks for it to be granted
  // separately from recording and editing.
  const canDeletePayments = hasAnyPermission(accessProfile.permissions, [
    "payment_delete",
    "financial_management",
  ]);
  // Permissions are not known while the server renders, so what depends on
  // them appears once the page has hydrated. Rendering the buttons in the
  // first client pass made it disagree with the server's HTML.
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);
  // The same rights the installment dialog's own route and the contract's
  // Payments tab ask for.
  const canRecord =
    hydrated &&
    hasAnyPermission(accessProfile.permissions, [
      "payment_create",
      "payment_processing",
      "financial_management",
    ]);
  // The WhatsApp/SMS icons on each row: the payment desk's rights, the same
  // ones api/payments/[id]/notify asks for.
  const canMessage =
    hydrated &&
    hasAnyPermission(accessProfile.permissions, [
      "payment_edit",
      "payment_processing",
      "financial_management",
    ]);
  const [messaging, setMessaging] = useState<{
    paymentId: string;
    channel: "whatsapp" | "sms";
  } | null>(null);
  const [showRefundDialog, setShowRefundDialog] = useState(false);
  const [paymentToRefund, setPaymentToRefund] = useState<string | null>(null);
  const [isRefunding, setIsRefunding] = useState(false);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalPayments, setTotalPayments] = useState(0);
  // Totals for the WHOLE filtered set, computed by the API in the same query
  // that produced this page — see ApiResponse.summary. Outstanding and
  // overdue are installment figures, not payment rows.
  const [summary, setSummary] = useState<{
    totalAmount: number;
    collectedAmount: number;
    collectedCount: number;
    overdueCount: number;
    overdueAmount: number;
    outstandingAmount: number;
    outstandingCount: number;
    /** Every method the office's payments carry, filters aside. */
    availableMethods?: string[];
  } | null>(null);
  const [pageSize, setPageSize] = useState(12);
  // The column a header click sorts by, as GET /api/payments names it
  // (lib/payments/list-order) — the server orders the whole list, not the
  // page on screen. No key: the API's own order, newest first.
  const [sort, setSort] = useState<{ key: string | null; direction: SortDirection }>({
    key: null,
    direction: "asc",
  });

  /**
   * The filters currently on screen, as a query string.
   *
   * Shared by the list fetch and the export so the file cannot describe a
   * different set from the table above it — which is exactly what the review
   * asked for when it said exports must contain the filtered results.
   */
  const buildFilterParams = () => {
    const params = new URLSearchParams();
    if (searchTerm) params.set("search", searchTerm);
    if (statusFilter !== "all") params.set("displayStatus", statusFilter);
    if (typeFilter && typeFilter !== "all") params.set("type", typeFilter);
    if (paymentMethodFilter && paymentMethodFilter !== "all")
      params.set("paymentMethod", paymentMethodFilter);
    // Only what was actually chosen is sent, so an untouched panel changes
    // nothing about the query.
    if (recordFilters.leaseId) params.set("leaseId", recordFilters.leaseId);
    if (recordFilters.propertyId) params.set("propertyId", recordFilters.propertyId);
    if (recordFilters.unitId) params.set("unitId", recordFilters.unitId);
    if (recordFilters.compoundId) params.set("compoundId", recordFilters.compoundId);
    if (recordFilters.ownerId) params.set("ownerId", recordFilters.ownerId);
    if (recordFilters.tenantId) params.set("tenantId", recordFilters.tenantId);
    if (recordFilters.startDate) params.set("startDate", recordFilters.startDate);
    if (recordFilters.endDate) params.set("endDate", recordFilters.endDate);
    if (recordFilters.startDate || recordFilters.endDate)
      params.set("dateField", recordFilters.dateField);
    // The export follows the order on screen too.
    if (sort.key) {
      params.set("sortBy", sort.key);
      params.set("sortOrder", sort.direction);
    }
    return params;
  };

  const tenantNameOf = (payment: Payment) =>
    `${payment.tenantId?.firstName ?? ""} ${payment.tenantId?.lastName ?? ""}`.trim();

  const fetchPayments = async (
    page: number = currentPage,
    limit: number = pageSize
  ) => {
    if (!session) return;

    try {
      setIsLoading(true);
      const params = buildFilterParams();
      params.set("page", page.toString());
      params.set("limit", limit.toString());

      const response = await fetch(`/api/payments?${params.toString()}`);

      if (response.ok) {
        const result = await response.json();
        const rows: Payment[] = result.data || [];
        setPayments(rows);
        if (result.pagination) {
          setTotalPages(result.pagination.totalPages || 1);
          setTotalPayments(result.pagination.total || 0);
        }
        setSummary(result.summary ?? null);

        // Opened from a contract's link, the panel has not named the
        // contract yet — its rows can.
        if (recordFilters.leaseId && !recordFilterLabel) {
          const row = rows.find(
            (candidate) => candidate.lease?._id === recordFilters.leaseId,
          );
          if (row) {
            const unit = row.lease?.unit?.unitNumber;
            setRecordFilterLabel(
              `${t("payments.filters.contract", { defaultValue: "Contract" })}: ${[
                tenantNameOf(row),
                unit ? `#${unit}` : null,
              ]
                .filter(Boolean)
                .join(" ")}`,
            );
          }
        }
      } else {
        throw new Error(t("payments.toasts.loadError"));
      }
    } catch (error) {
      showSimpleError(
        t("payments.toasts.loadErrorTitle", { defaultValue: "Could not load" }),
        error instanceof Error ? error.message : t("payments.toasts.loadError")
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    fetchPayments(page, pageSize);
  };

  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    setCurrentPage(1);
    fetchPayments(1, newPageSize);
  };

  // The old overdue filter lives on its own page now.
  useEffect(() => {
    if (searchParams?.get("filter") === "overdue") {
      router.replace("/dashboard/payments/overdue");
    }
  }, [searchParams, router]);

  // Back to page 1 whenever the filters (or the order) change.
  useEffect(() => {
    setCurrentPage(1);
    fetchPayments(1, pageSize);
    // fetchPayments reads the filters below; listing it would refetch on
    // every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    session,
    searchTerm,
    statusFilter,
    typeFilter,
    paymentMethodFilter,
    recordFilters,
    sort,
  ]);

  // `?record=<paymentId>` (or `?record=new`) opens the record dialog — where
  // the retired /dashboard/payments/record page now sends its visitors.
  const recordParam = searchParams?.get("record") ?? "";
  useEffect(() => {
    if (!recordParam || !canRecord) return;
    let active = true;
    const clearParam = () =>
      router.replace(
        urlLeaseId
          ? `/dashboard/payments?leaseId=${encodeURIComponent(urlLeaseId)}`
          : "/dashboard/payments",
      );
    void (async () => {
      if (recordParam === "new") {
        setRecording({ leaseId: urlLeaseId || undefined });
        clearParam();
        return;
      }
      const response = await fetch(
        `/api/payments/${encodeURIComponent(recordParam)}`,
      );
      const result = await response.json().catch(() => null);
      if (!active) return;
      if (response.ok && result?.data) {
        setRecording(recordingFor(result.data as Payment));
      } else {
        showSimpleError(
          t("payments.record.toasts.openFailedTitle", {
            defaultValue: "Payment not found",
          }),
          t("payments.record.toasts.openFailed", {
            defaultValue:
              "Could not load that payment. Choose its contract in the dialog.",
          }),
        );
        setRecording({});
      }
      clearParam();
    })();
    return () => {
      active = false;
    };
  }, [recordParam, canRecord, router, urlLeaseId, t]);

  // Deleting a payment is the review's correction path: a wrong payment is
  // deleted and the right one recorded. The API takes its money back off the
  // installment it paid and moves it to the archive, so nothing here is
  // permanent — restoring it from the archive puts the money back.
  const handleDeletePayment = async () => {
    if (!paymentToDelete) return;

    try {
      setIsDeleting(true);
      const response = await fetch(`/api/payments/${paymentToDelete._id}`, {
        method: "DELETE",
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.success) {
        throw new Error(
          result?.error || t("payments.deleteDialog.failed", {
            defaultValue: "Could not delete the payment",
          }),
        );
      }
      showSimpleSuccess(
        t("payments.deleteDialog.doneTitle", { defaultValue: "Payment deleted" }),
        t("payments.deleteDialog.done", {
          defaultValue:
            "The payment is in the archive and its installment is owed again.",
        }),
      );
      fetchPayments();
    } catch (error) {
      showSimpleError(
        t("payments.deleteDialog.failedTitle", {
          defaultValue: "Delete failed",
        }),
        error instanceof Error
          ? error.message
          : t("payments.deleteDialog.failed", {
              defaultValue: "Could not delete the payment",
            }),
      );
    } finally {
      setIsDeleting(false);
      setPaymentToDelete(null);
    }
  };

  const confirmRefund = (paymentId: string) => {
    setPaymentToRefund(paymentId);
    setShowRefundDialog(true);
  };

  const handleRefund = async () => {
    if (!paymentToRefund) return;

    try {
      setIsRefunding(true);

      const response = await fetch(`/api/payments/${paymentToRefund}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "refund",
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error(error?.error || t("payments.toasts.refundError"));
      }

      showSimpleSuccess(
        t("payments.toasts.refundTitle", { defaultValue: "Refund processed" }),
        t("payments.toasts.refundSuccess"),
      );
      fetchPayments();
      setShowRefundDialog(false);
      setPaymentToRefund(null);
    } catch (error) {
      showSimpleError(
        t("payments.toasts.refundErrorTitle", { defaultValue: "Refund failed" }),
        error instanceof Error
          ? error.message
          : t("payments.toasts.refundError")
      );
    } finally {
      setIsRefunding(false);
    }
  };

  const getStatusIcon = (state: PaymentDisplayStatus) => {
    switch (state) {
      case "paid":
        return CheckCircle;
      case "partial":
        return DollarSign;
      case "overdue":
      case "failed":
        return XCircle;
      case "refunded":
        return RefreshCw;
      default:
        return Clock;
    }
  };

  /** Still owes money, so recording a payment against it makes sense. */
  const isSettleable = (payment: Payment) => {
    const state = paymentDisplayStatus(payment);
    return (
      state === "due" ||
      state === "overdue" ||
      state === "partial" ||
      state === "upcoming"
    );
  };

  /**
   * The badge, derived from the stored status AND the due date together.
   *
   * Rendering `payment.status` raw was the reported bug: a payment weeks past
   * due still read "Pending", and the label was never translated.
   */
  const StatusBadge = ({ payment }: { payment: Payment }) => {
    const state = paymentDisplayStatus(payment);
    const StatusIcon = getStatusIcon(state);
    const label = PAYMENT_STATUS_LABELS[state];

    return (
      <Badge
        variant="outline"
        className={`flex w-fit items-center gap-1 ${PAYMENT_STATUS_STYLES[state]}`}
      >
        <StatusIcon className="h-3 w-3" />
        {t(label.key, { defaultValue: label.fallback })}
      </Badge>
    );
  };

  const getTypeColor = (
    type: PaymentType,
  ): "default" | "secondary" | "destructive" | "outline" => {
    switch (type) {
      case PaymentType.RENT:
        return "default";
      case PaymentType.SECURITY_DEPOSIT:
      case PaymentType.INVOICE:
      case PaymentType.PET_DEPOSIT:
        return "secondary";
      case PaymentType.LATE_FEE:
        return "destructive";
      default:
        return "outline";
    }
  };

  /**
   * The contract a row is on — a link to that contract's Payments tab — and
   * the installment it belongs to. Without this the list mixed every
   * contract a tenant ever held, and nothing said which a payment was for.
   */
  /**
   * The contract a payment is on, and the installment it belongs to. In the
   * table's narrow unit column (`compact`) the installment is its number
   * alone, kept on one line, with the full wording as its tooltip.
   */
  const contractCell = (payment: Payment, compact = false) => {
    const lease = payment.lease;
    if (!lease) {
      return (
        <span className="text-sm text-muted-foreground">
          {t("payments.table.noContract", { defaultValue: "No contract" })}
        </span>
      );
    }
    const unlinked =
      !payment.invoice &&
      Number(payment.amountPaid ?? 0) === 0 &&
      CONVERTIBLE_STATUSES.includes(payment.status);
    return (
      <div className="min-w-0 text-sm">
        <Link
          href={`/dashboard/leases/${lease._id}?tab=payments`}
          className="font-medium text-primary hover:underline"
        >
          {lease.contractNumber
            ? t("payments.collect.contractNumber", {
                defaultValue: "No. {number}",
                values: { number: lease.contractNumber },
              })
            : t("payments.table.contract", { defaultValue: "Contract" })}
        </Link>
        {payment.invoice ? (
          compact ? (
            <span
              className="block whitespace-nowrap font-mono text-xs text-muted-foreground"
              title={t("payments.table.installmentRef", {
                defaultValue: "Installment {number}",
                values: { number: payment.invoice.invoiceNumber },
              })}
            >
              {payment.invoice.invoiceNumber}
            </span>
          ) : (
            <span className="block text-xs text-muted-foreground">
              {t("payments.table.installmentRef", {
                defaultValue: "Installment {number}",
                values: { number: payment.invoice.invoiceNumber },
              })}
            </span>
          )
        ) : unlinked ? (
          <span className="block text-xs text-warning">
            {t("leases.contractPayments.unlinked", {
              defaultValue: "Not linked to an installment",
            })}
          </span>
        ) : null}
      </div>
    );
  };

  /** RCP-000123, or a dash for a charge nobody has paid. */
  const numberCell = (payment: Payment) =>
    payment.paymentNumber ? (
      <Link
        href={`/dashboard/payments/${payment._id}`}
        className="whitespace-nowrap font-mono text-xs font-medium text-primary hover:underline"
        dir="ltr"
      >
        {payment.paymentNumber}
      </Link>
    ) : (
      <span className="text-muted-foreground">—</span>
    );

  /**
   * The tenant. The cards on a phone add the mobile number (or the email when
   * there is none); the table gives the mobile a column of its own.
   */
  const customerCell = (payment: Payment, withContact = false) => {
    const phone = withContact ? payment.tenantId?.phone : undefined;
    const email = withContact ? payment.tenantId?.email : undefined;
    return (
      <div className="min-w-0">
        <div className="font-medium">{tenantNameOf(payment) || "—"}</div>
        {phone ? (
          <div className="text-sm text-muted-foreground">
            <bdi dir="ltr">{phone}</bdi>
          </div>
        ) : email ? (
          <div className="truncate text-xs text-muted-foreground">{email}</div>
        ) : null}
      </div>
    );
  };

  /** The tenant's mobile, in its own column. */
  const mobileCell = (payment: Payment) =>
    payment.tenantId?.phone ? (
      <span className="whitespace-nowrap text-sm" dir="ltr">
        <bdi>{payment.tenantId.phone}</bdi>
      </span>
    ) : (
      <span className="text-muted-foreground">—</span>
    );

  /**
   * The payment's details, as the client asked for them in one place: how it
   * was paid, the transfer or cheque number that proves it, the day the money
   * arrived, and who recorded it.
   */
  const paymentDetailsCell = (payment: Payment) => {
    const reference = paymentReference(payment);
    const recorder = recordedByText(
      payment,
      t("payments.table.recordedOnline", { defaultValue: "Online" }),
    );
    if (!payment.paymentMethod && !reference && !payment.paidDate && !recorder) {
      return (
        <span className="text-sm text-muted-foreground">
          {t("payments.table.notPaid")}
        </span>
      );
    }
    return (
      <div className="min-w-0 space-y-0.5 text-sm">
        {payment.paymentMethod && (
          <span className="block">
            {paymentMethodLabel(payment.paymentMethod, t)}
          </span>
        )}
        {reference && (
          <span
            className="block max-w-[170px] truncate font-mono text-xs text-muted-foreground"
            title={reference}
          >
            <bdi dir="ltr">{reference}</bdi>
          </span>
        )}
        {payment.paidDate && (
          <span className="flex items-center gap-1 text-xs text-green-600">
            <CheckCircle className="h-3 w-3" />
            {formatDate(payment.paidDate)}
          </span>
        )}
        {recorder && (
          <span className="block text-xs text-muted-foreground">
            {t("payments.table.recordedByName", {
              defaultValue: "By {name}",
              values: { name: recorder },
            })}
          </span>
        )}
      </div>
    );
  };

  /** The row's actions, shared by the table and the cards. */
  // Cancelled and refunded rows have nothing to tell the tenant.
  const messageButtons = (payment: Payment) =>
    canMessage &&
    payment.status !== PaymentStatus.CANCELLED &&
    payment.status !== PaymentStatus.REFUNDED ? (
      <>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-green-600 hover:text-green-700"
          aria-label={t("payments.message.titleWhatsapp")}
          title={t("payments.message.titleWhatsapp")}
          onClick={() => setMessaging({ paymentId: payment._id, channel: "whatsapp" })}
        >
          <MessageCircle className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-blue-600 hover:text-blue-700"
          aria-label={t("payments.message.titleSms")}
          title={t("payments.message.titleSms")}
          onClick={() => setMessaging({ paymentId: payment._id, channel: "sms" })}
        >
          <MessageSquare className="h-4 w-4" />
        </Button>
      </>
    ) : null;

  const rowActions = (payment: Payment) => (
    <div className="flex items-center justify-end gap-0.5">
      {messageButtons(payment)}
      {rowMenu(payment)}
    </div>
  );

  const rowMenu = (payment: Payment) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="h-8 w-8 p-0"
          aria-label={t("payments.actions.title")}
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t("payments.actions.title")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={`/dashboard/payments/${payment._id}`}>
            <Eye className="me-2 h-4 w-4" />
            {t("payments.actions.viewDetails")}
          </Link>
        </DropdownMenuItem>
        {/* A completed payment is not edited — the API refuses it — so the
            menu does not offer what would only end in an error. */}
        {payment.status !== PaymentStatus.PAID &&
          payment.status !== PaymentStatus.REFUNDED && (
            <DropdownMenuItem asChild>
              <Link href={`/dashboard/payments/${payment._id}/edit`}>
                <Edit className="me-2 h-4 w-4" />
                {t("payments.actions.edit")}
              </Link>
            </DropdownMenuItem>
          )}
        {/* Anything still owed can be settled — the overdue and part-paid
            rows an office chases included — through the installment dialog. */}
        {canRecord && isSettleable(payment) && (
          <DropdownMenuItem onClick={() => setRecording(recordingFor(payment))}>
            <DollarSign className="me-2 h-4 w-4" />
            {t("payments.actions.recordPayment")}
          </DropdownMenuItem>
        )}
        {payment.status === PaymentStatus.PAID && (
          <DropdownMenuItem
            onClick={() => confirmRefund(payment._id)}
            className="text-orange-600"
          >
            <RefreshCw className="me-2 h-4 w-4" />
            {t("payments.actions.refund")}
          </DropdownMenuItem>
        )}
        {canDeletePayments && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => setPaymentToDelete(payment)}
              className="text-red-600"
            >
              <Trash2 className="me-2 h-4 w-4" />
              {t("payments.actions.delete", {
                defaultValue: "Delete payment",
              })}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  // The client asked for each payment to show its number, the customer, the
  // payment's details, the property and the unit number — the mobile, the
  // building and the unit each in a column of its own. Those read from
  // tablet width up ("lg" hid the property on the office's own laptops) and
  // the details from laptop width. What the payment is for, its contract and
  // installment, when it was paid and who recorded it sit inside those cells
  // rather than in columns of their own, to keep the row as narrow as nine
  // columns allow.
  const paymentColumns: DataTableColumn<Payment>[] = [
    {
      id: "number",
      header: t("payments.table.number", { defaultValue: "Payment No." }),
      cell: (payment) => numberCell(payment),
      width: "min-w-[100px]",
      sortKey: "paymentNumber",
    },
    {
      id: "tenant",
      header: t("payments.table.customer", { defaultValue: "Customer" }),
      cell: (payment) => customerCell(payment),
      width: "min-w-[130px]",
    },
    {
      id: "mobile",
      header: t("payments.reports.columns.mobile", { defaultValue: "Mobile" }),
      visibility: "md" as const,
      cell: (payment) => mobileCell(payment),
    },
    {
      id: "property",
      header: t("payments.table.property"),
      visibility: "md" as const,
      cell: (payment) => (
        <div>
          <div className="font-medium">{payment.propertyId?.name || "—"}</div>
          {payment.propertyId?.address?.city && (
            <div className="text-sm text-muted-foreground">
              {payment.propertyId.address.city}
            </div>
          )}
        </div>
      ),
    },
    {
      // The unit number, and under it the contract it is let on and the
      // installment the payment belongs to.
      id: "unit",
      header: t("payments.table.unit", { defaultValue: "Unit No." }),
      visibility: "md" as const,
      cell: (payment) => (
        <div className="max-w-[130px] space-y-0.5 whitespace-normal">
          {payment.lease?.unit?.unitNumber ? (
            <span className="block font-medium">
              <bdi>{payment.lease.unit.unitNumber}</bdi>
            </span>
          ) : (
            <span className="block text-muted-foreground">—</span>
          )}
          {contractCell(payment, true)}
        </div>
      ),
    },
    {
      id: "amount",
      header: t("payments.table.amount"),
      sortKey: "amount",
      // Billed on top, still owed underneath, and what it is for. A partially
      // paid row used to show only its face value, so the one number on
      // screen was neither what had arrived nor what was left.
      cell: (payment) => {
        const paid = Number(payment.amountPaid ?? 0);
        const outstanding = Math.max(0, payment.amount - paid);
        const settled =
          payment.status === PaymentStatus.CANCELLED ||
          payment.status === PaymentStatus.REFUNDED ||
          outstanding === 0;
        return (
          <div>
            <div className="font-medium">{formatCurrency(payment.amount)}</div>
            {!settled && (
              <div className="text-xs font-medium text-amber-600 dark:text-amber-400">
                {t("payments.table.outstandingShort", {
                  defaultValue: "{{amount}} due",
                  values: { amount: formatCurrency(outstanding) },
                })}
              </div>
            )}
            {paid > 0 && outstanding > 0 && (
              <div className="text-xs text-muted-foreground">
                {t("payments.table.paidSoFar", {
                  defaultValue: "{{amount}} paid",
                  values: { amount: formatCurrency(paid) },
                })}
              </div>
            )}
            <Badge variant={getTypeColor(payment.type)} className="mt-1 text-xs">
              {paymentTypeLabel(payment.type, t)}
            </Badge>
          </div>
        );
      },
    },
    {
      id: "details",
      header: t("payments.table.details", { defaultValue: "Payment details" }),
      visibility: "lg" as const,
      // The date the money arrived, the one thing in the cell an order means.
      sortKey: "paidDate",
      cell: (payment) => paymentDetailsCell(payment),
      width: "min-w-[130px]",
    },
    {
      // The badge, the due date it is read against (its calendar icon says
      // so), and how late it is.
      id: "status",
      header: t("payments.table.status"),
      // By status, then the due date under the badge (lib/payments/list-order).
      sortKey: "status",
      cell: (payment) => {
        const daysOverdue = computeDaysOverdue(payment);
        return (
          <div className="space-y-1">
            <StatusBadge payment={payment} />
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Calendar className="h-3 w-3" />
              <span>{formatDate(payment.dueDate)}</span>
            </div>
            {daysOverdue > 0 && (
              <div className="text-xs font-medium text-red-600">
                {daysOverdue} {t("payments.table.days")}
              </div>
            )}
          </div>
        );
      },
    },
    {
      id: "actions",
      header: t("payments.table.actions"),
      align: "right" as const,
      cell: (payment) => rowActions(payment),
    },
  ];

  // The method filter: the six the office records with, then every other
  // method its payments carry — a card taken online, an older cheque — so
  // those can be found too.
  const manualMethodValues = new Set<string>(
    MANUAL_PAYMENT_METHODS.map((method) => method.value),
  );
  const otherMethods = (summary?.availableMethods ?? []).filter(
    (method) => !manualMethodValues.has(method),
  );

  // Every headline figure comes from the API's `summary`, computed over the
  // whole filtered set in the same query that produced this page.
  const totalAmount = summary?.totalAmount ?? 0;
  // What actually arrived, not what was billed: a partial payment counts for
  // the money received.
  const collectedAmount = summary?.collectedAmount ?? 0;
  const collectedCount = summary?.collectedCount ?? 0;
  // Read off the installment schedule: every billed installment still owing,
  // and the part of that already past its due date. Adding up payment rows
  // left out every installment nobody had written a row for.
  const outstandingAmount = summary?.outstandingAmount ?? 0;
  const outstandingCount = summary?.outstandingCount ?? 0;
  const overdueCount = summary?.overdueCount ?? 0;
  const overdueAmount = summary?.overdueAmount ?? 0;

  const quickFiltersActive =
    Boolean(searchTerm) ||
    statusFilter !== "all" ||
    typeFilter !== "all" ||
    paymentMethodFilter !== "all";
  const anyFilterActive =
    quickFiltersActive || countActiveRecordFilters(recordFilters) > 0;

  const clearAllFilters = () => {
    setSearchTerm("");
    setStatusFilter("all");
    setTypeFilter("all");
    setPaymentMethodFilter("all");
    setRecordFilters(EMPTY_RECORD_FILTERS);
    setRecordFilterLabel("");
  };

  const emptyAction = canRecord ? (
    <Button variant="outline" size="sm" onClick={() => setRecording({})}>
      <Plus className="me-2 h-4 w-4" />
      {t("payments.actions.recordPayment")}
    </Button>
  ) : undefined;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            {t("payments.header.title")}
          </h1>
          <p className="text-muted-foreground">
            {t("payments.header.subtitle")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/dashboard/payments/analytics">
            <Button variant="outline" size="sm">
              <BarChart3 className="me-2 h-4 w-4" />
              {t("payments.header.analytics")}
            </Button>
          </Link>
          <ReportExportButton
            endpoint="/api/payments"
            params={buildFilterParams()}
            disabled={isLoading}
          />
          {canRecord && (
            <Link
              href={
                recordFilters.leaseId
                  ? `/dashboard/payments/new?leaseId=${encodeURIComponent(recordFilters.leaseId)}`
                  : "/dashboard/payments/new"
              }
            >
              <Button variant="outline" size="sm">
                <Plus className="me-2 h-4 w-4" />
                {t("payments.header.addCharge", { defaultValue: "Add a charge" })}
              </Button>
            </Link>
          )}
          {canRecord && (
            <Button
              size="sm"
              onClick={() =>
                setRecording({ leaseId: recordFilters.leaseId || undefined })
              }
            >
              <DollarSign className="me-2 h-4 w-4" />
              {t("payments.header.recordPayment", {
                defaultValue: "Record payment",
              })}
            </Button>
          )}
        </div>
      </div>

      {/* What the figures below are about. Absent when nothing is narrowed —
          an unfiltered page needs no caption, and a permanent one would be
          noise. */}
      {countActiveRecordFilters(recordFilters) > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
          <span className="text-sm font-medium">
            {t("payments.summary.showing", {
              defaultValue: "Showing",
            })}
          </span>
          <span className="text-sm text-muted-foreground">
            {recordFilterLabel ||
              t("payments.summary.filtered", {
                defaultValue: "a filtered set of payments",
              })}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="ms-auto h-7"
            onClick={() => {
              setRecordFilters(EMPTY_RECORD_FILTERS);
              setRecordFilterLabel("");
            }}
          >
            <XCircle className="me-1.5 h-3.5 w-3.5" />
            {t("payments.filters.resetRecord", {
              defaultValue: "Reset filters",
            })}
          </Button>
        </div>
      )}

      {/* Stats Cards */}
      <AnalyticsCardGrid className="lg:grid-cols-4">
        <AnalyticsCard
          title={t("payments.stats.totalAmount")}
          value={formatCurrency(totalAmount)}
          description={`${totalPayments} ${t("payments.stats.payments")}`}
          icon={DollarSign}
          iconColor="primary"
        />

        <AnalyticsCard
          title={t("payments.stats.collected")}
          value={formatCurrency(collectedAmount)}
          description={`${collectedCount} ${t("payments.stats.completed")}`}
          icon={CheckCircle}
          iconColor="success"
        />

        <AnalyticsCard
          title={t("payments.stats.outstanding", {
            defaultValue: "Outstanding",
          })}
          value={formatCurrency(outstandingAmount)}
          description={t("payments.stats.installmentsOwed", {
            defaultValue: "{count} installments still owed",
            values: { count: outstandingCount },
          })}
          icon={Clock}
          iconColor="warning"
        />

        <AnalyticsCard
          title={t("payments.stats.overdue")}
          value={formatCurrency(overdueAmount)}
          description={t("payments.stats.installmentsLate", {
            defaultValue: "{count} installments past their due date",
            values: { count: overdueCount },
          })}
          icon={AlertTriangle}
          iconColor="error"
        />
      </AnalyticsCardGrid>

      <Card className="gap-2">
        <CardHeader>
          <div className="mb-2 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3">
              <div className="rounded-lg border border-green-100 bg-green-50 p-2 dark:border-green-800 dark:bg-green-900/30">
                <CreditCard className="h-5 w-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {t("payments.table.title")} ({totalPayments})
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {t("payments.table.description")}
                </p>
              </div>
            </div>

            {/* View Mode Toggle */}
            <div className="flex w-full items-center rounded-lg border p-1 sm:w-auto">
              <Button
                variant={viewMode === "table" ? "default" : "ghost"}
                size="sm"
                onClick={() => setViewMode("table")}
                className="h-8 flex-1 sm:flex-none sm:px-3"
                aria-label={t("payments.view.table", { defaultValue: "Table view" })}
              >
                <List className="h-4 w-4" />
              </Button>
              <Button
                variant={viewMode === "card" ? "default" : "ghost"}
                size="sm"
                onClick={() => setViewMode("card")}
                className="h-8 flex-1 sm:flex-none sm:px-3"
                aria-label={t("payments.view.cards", { defaultValue: "Card view" })}
              >
                <Grid3X3 className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* One filter bar for both views. The contract/building/date panel
              used to exist in card view only. */}
          <div className="flex flex-col gap-4 rounded-lg border border-gray-200/60 bg-gray-50/50 p-4 lg:flex-row lg:items-center dark:border-gray-700/60 dark:bg-gray-800/50">
            <GlobalSearch
              placeholder={t("payments.filters.searchPlaceholder")}
              initialValue={searchTerm}
              debounceDelay={300}
              onSearch={(val) => setSearchTerm(val)}
              isLoading={isLoading}
              className="min-w-0 flex-1"
              inputClassName="h-10 border-gray-200 dark:border-gray-700 focus:border-green-400 dark:focus:border-green-500 focus:ring-1 focus:ring-green-400 dark:focus:ring-green-500 bg-white dark:bg-gray-800"
              ariaLabel={t("search.payments", { defaultValue: "Search payments" })}
            />

            <div className="flex flex-wrap items-center gap-3">
              {/* The states the badges show, and nothing else. */}
              <Select
                value={statusFilter}
                onValueChange={(next) =>
                  setStatusFilter(isPaymentDisplayStatus(next) ? next : "all")
                }
              >
                <SelectTrigger
                  className="h-10 w-37.5 border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"
                  aria-label={t("payments.table.status")}
                >
                  <SelectValue placeholder={t("payments.filters.allStatuses")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t("payments.filters.allStatuses")}
                  </SelectItem>
                  {PAYMENT_DISPLAY_STATUSES.map((state) => (
                    <SelectItem key={state} value={state}>
                      {t(PAYMENT_STATUS_LABELS[state].key, {
                        defaultValue: PAYMENT_STATUS_LABELS[state].fallback,
                      })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger
                  className="h-10 w-37.5 border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"
                  aria-label={t("payments.table.type")}
                >
                  <SelectValue placeholder={t("payments.filters.allTypes")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t("payments.filters.allTypes")}
                  </SelectItem>
                  {[...CHARGE_TYPES, PaymentType.LATE_FEE].map((type) => (
                    <SelectItem key={type} value={type}>
                      {paymentTypeLabel(type, t)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={paymentMethodFilter}
                onValueChange={setPaymentMethodFilter}
              >
                <SelectTrigger
                  className="h-10 w-37.5 border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"
                  aria-label={t("payments.card.method")}
                >
                  <SelectValue placeholder={t("payments.filters.allMethods")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t("payments.filters.allMethods")}
                  </SelectItem>
                  {MANUAL_PAYMENT_METHODS.map((method) => (
                    <SelectItem key={method.value} value={method.value}>
                      {t(method.labelKey, { defaultValue: method.fallback })}
                    </SelectItem>
                  ))}
                  {otherMethods.length > 0 && (
                    <SelectGroup>
                      <SelectLabel className="text-xs text-muted-foreground">
                        {t("payments.filters.otherMethods", {
                          defaultValue: "Online and other methods",
                        })}
                      </SelectLabel>
                      {otherMethods.map((method) => (
                        <SelectItem key={method} value={method}>
                          {paymentMethodLabel(method, t)}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                </SelectContent>
              </Select>

              {anyFilterActive && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearAllFilters}
                  className="h-10 text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
                >
                  <XCircle className="me-2 h-4 w-4" />
                  {t("payments.filters.clearAll") || "Clear All"}
                </Button>
              )}
            </div>
          </div>

          <PaymentRecordFilters
            value={recordFilters}
            onApply={(next, describe) => {
              setRecordFilters(next);
              setRecordFilterLabel(describe);
            }}
          />
        </CardHeader>
        <CardContent>
          {viewMode === "table" ? (
            <DataTable<Payment>
              columns={paymentColumns}
              data={payments}
              getRowKey={(payment) => payment._id}
              loading={isLoading}
              // Sorted by the API: only columns with a sortKey sort, so the
              // customer, mobile, building and unit headers stay plain.
              sort={{
                key: sort.key,
                direction: sort.direction,
                onSortChange: (key, direction) => setSort({ key, direction }),
              }}
              emptyState={{
                icon: (
                  <CreditCard className="h-12 w-12 text-muted-foreground" />
                ),
                title: t("payments.empty.title", {
                  defaultValue: "No payments found",
                }),
                description: anyFilterActive
                  ? t("payments.empty.description", {
                      defaultValue: "No payments match your current filters.",
                    })
                  : t("payments.empty.descriptionStart", {
                      defaultValue: "No payments have been created yet.",
                    }),
                action: emptyAction,
              }}
              striped
            />
          ) : isLoading ? null : payments.length === 0 ? (
            <div className="col-span-full flex flex-col items-center gap-2 py-12">
              <CreditCard className="h-12 w-12 text-muted-foreground" />
              <h3 className="text-lg font-semibold">
                {t("payments.empty.title", {
                  defaultValue: "No payments found",
                })}
              </h3>
              <p className="mb-2 text-muted-foreground">
                {anyFilterActive
                  ? t("payments.empty.description", {
                      defaultValue: "No payments match your current filters.",
                    })
                  : t("payments.empty.descriptionStart", {
                      defaultValue: "No payments have been created yet.",
                    })}
              </p>
              {emptyAction}
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {payments.map((payment) => {
                const daysOverdue = computeDaysOverdue(payment);
                const recorder = recordedByText(
                  payment,
                  t("payments.table.recordedOnline", {
                    defaultValue: "Online",
                  }),
                );

                return (
                  <Card
                    key={payment._id}
                    className="transition-shadow hover:shadow-md"
                  >
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <CreditCard className="h-5 w-5 text-muted-foreground" />
                          <StatusBadge payment={payment} />
                        </div>
                        {rowActions(payment)}
                      </div>
                      <div className="text-2xl font-bold">
                        {formatCurrency(payment.amount)}
                      </div>
                      <Badge
                        variant={getTypeColor(payment.type)}
                        className="w-fit text-xs"
                      >
                        {paymentTypeLabel(payment.type, t)}
                      </Badge>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">
                          {t("payments.table.number", {
                            defaultValue: "Payment No.",
                          })}
                        </span>
                        {numberCell(payment)}
                      </div>
                      {customerCell(payment, true)}
                      {contractCell(payment)}
                      <div>
                        <p className="text-sm font-medium">
                          {payment.propertyId?.name || "—"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {[
                            payment.lease?.unit?.unitNumber
                              ? t("payments.table.unitContract", {
                                  defaultValue: "Unit {unit}",
                                  values: { unit: payment.lease.unit.unitNumber },
                                })
                              : null,
                            payment.propertyId?.address?.city,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">
                          {t("payments.card.due")}
                        </span>
                        <span>{formatDate(payment.dueDate)}</span>
                      </div>
                      {payment.paidDate && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">
                            {t("payments.card.paid")}
                          </span>
                          <span>{formatDate(payment.paidDate)}</span>
                        </div>
                      )}
                      {daysOverdue > 0 && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">
                            {t("payments.card.overdue")}
                          </span>
                          <span className="font-medium text-red-600">
                            {daysOverdue} {t("payments.table.days")}
                          </span>
                        </div>
                      )}
                      {payment.paymentMethod && (
                        <div className="flex justify-between gap-3 text-sm">
                          <span className="text-muted-foreground">
                            {t("payments.card.method")}
                          </span>
                          <span className="text-end">
                            {paymentMethodLabel(payment.paymentMethod, t)}
                          </span>
                        </div>
                      )}
                      {paymentReference(payment) && (
                        <div className="flex justify-between gap-3 text-sm">
                          <span className="text-muted-foreground">
                            {t("payments.card.reference", {
                              defaultValue: "Reference:",
                            })}
                          </span>
                          <span className="truncate font-mono text-xs" dir="ltr">
                            {paymentReference(payment)}
                          </span>
                        </div>
                      )}
                      {recorder && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">
                            {t("payments.card.recordedBy", {
                              defaultValue: "Recorded by:",
                            })}
                          </span>
                          <span>{recorder}</span>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
          {totalPayments > 0 && (
            <GlobalPagination
              currentPage={currentPage}
              totalPages={totalPages}
              totalItems={totalPayments}
              pageSize={pageSize}
              onPageChange={handlePageChange}
              onPageSizeChange={handlePageSizeChange}
              showingLabel={t("common.showing", {
                defaultValue: "Showing",
              })}
              previousLabel={t("common.previous", {
                defaultValue: "Previous",
              })}
              nextLabel={t("common.next", { defaultValue: "Next" })}
              pageLabel={t("common.page", { defaultValue: "Page" })}
              ofLabel={t("common.of", { defaultValue: "of" })}
              itemsPerPageLabel={t("common.perPage", {
                defaultValue: "per page",
              })}
              disabled={isLoading}
            />
          )}
        </CardContent>
      </Card>

      {/* Mounted per opening, so each starts from the row it was opened on. */}
      <PaymentMessageDialog
        paymentId={messaging?.paymentId ?? null}
        channel={messaging?.channel ?? "whatsapp"}
        onClose={() => setMessaging(null)}
      />

      {recording && (
        <PaymentRecordDialog
          open
          onOpenChange={(open) => !open && setRecording(null)}
          pickContract
          initialLeaseId={recording.leaseId}
          initialInvoiceId={recording.invoiceId}
          initialAmount={recording.amount}
          convertPaymentId={recording.convertPaymentId}
          convertInvoiceId={recording.convertInvoiceId}
          onPaymentRecorded={() => {
            setRecording(null);
            fetchPayments();
          }}
        />
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={paymentToDelete !== null}
        onOpenChange={(open) => !open && setPaymentToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("payments.deleteDialog.title", {
                defaultValue: "Delete this payment?",
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {paymentToDelete && Number(paymentToDelete.amountPaid ?? 0) > 0
                ? t("payments.deleteDialog.withMoney", {
                    defaultValue:
                      "{amount} comes back off the installment it paid, which will read as owed again. The payment moves to the archive. Record the correct payment afterwards.",
                    values: {
                      amount: formatCurrency(Number(paymentToDelete.amountPaid)),
                    },
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
              onClick={handleDeletePayment}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting
                ? t("payments.deleteDialog.deleting", {
                    defaultValue: "Deleting…",
                  })
                : t("payments.deleteDialog.confirm", {
                    defaultValue: "Delete payment",
                  })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Refund Confirmation Dialog */}
      <AlertDialog open={showRefundDialog} onOpenChange={setShowRefundDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("payments.refundDialog.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("payments.refundDialog.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("payments.refundDialog.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRefund}
              disabled={isRefunding}
              className="bg-orange-600 text-white hover:bg-orange-700"
            >
              {isRefunding
                ? t("payments.refundDialog.refunding")
                : t("payments.refundDialog.refund")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
