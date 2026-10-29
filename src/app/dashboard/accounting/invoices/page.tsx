"use client";

import { useSession } from "@/lib/auth-client";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import GlobalSearch from "@/components/ui/global-search";
import { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTable, DataTableColumn } from "@/components/ui/data-table";

// The sort menu's own orders. A header can choose one it does not list (the
// invoice number, the building); the menu then shows its placeholder rather
// than a choice that is not the one in force.
const SORT_MENU_VALUES = [
  "createdAt-desc",
  "createdAt-asc",
  "dueDate-asc",
  "dueDate-desc",
  "totalAmount-desc",
  "totalAmount-asc",
  "status-asc",
];
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  FileText,
  Plus,
  MoreHorizontal,
  Eye,
  Edit,
  Trash2,
  Download,
  RefreshCw,
  LayoutGrid,
  List,
  Calendar,
  DollarSign,
  AlertTriangle,
  CheckCircle,
  Clock,
  Send,
  CreditCard,
  CheckSquare,
  Printer,
  Building2,
  X,
} from "lucide-react";
import {
  printInvoice,
  downloadInvoiceAsPDF,
  type PrintableInvoice,
} from "@/lib/invoice-print";
import {
  AnalyticsCard,
  AnalyticsCardGrid,
} from "@/components/analytics/AnalyticsCard";
import { useAuthorization } from "@/hooks/useAuthorization";
import { ReportExportButton } from "@/components/reports/export-button";
import { hasAnyPermission } from "@/lib/permissions-manager";
import { INVOICE_CREATE_PERMISSIONS } from "@/lib/finance-permissions";
import { GlobalPagination } from "@/components/ui/global-pagination";
import { normalizeInvoiceForPrint } from "@/lib/invoice/invoice-shared";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { useViewPreferencesStore } from "@/stores/view-preferences.store";
import PaymentRecordDialog from "@/components/invoice/PaymentRecordDialog";
import { useGatewayReturn } from "@/components/payments/GatewayPayOptions";
import BulkOperationsDialog from "@/components/invoice/BulkOperationsDialog";
import { showSimpleError, showSimpleSuccess } from "@/lib/toast-notifications";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { formatDisplayDate } from "@/lib/utils/formatting";

interface Invoice {
  _id: string;
  invoiceNumber: string;
  tenantId?: {
    _id: string;
    firstName: string;
    lastName: string;
    email: string;
    avatar?: string;
  } | null;
  propertyId?: {
    _id?: string;
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
  leaseId?: {
    _id: string;
    startDate: string;
    endDate: string;
    propertyId: {
      _id?: string;
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
    };
  } | null;
  issueDate?: string;
  dueDate?: string;
  status?: string;
  totalAmount?: number;
  amountPaid?: number;
  balanceRemaining?: number;
  daysOverdue?: number;
  items?: Array<{
    description: string;
    amount: number;
    type: string;
  }>;
  createdAt?: string;
  updatedAt?: string;
  /** invoice | credit_note (accounting phase 0). */
  documentType?: string;
  /** tenant | owner | customer: who it is to. */
  customerType?: string | null;
  /** The buyer's name: an owner's or a customer's, else the tenant's. */
  customerName?: string | null;
  customerVatNumber?: string | null;
  creditedAmount?: number;
}

/** Who an invoice is to, by name: its tenant, or the owner or customer it names. */
function billedTo(invoice: Invoice): string {
  const tenant = `${invoice.tenantId?.firstName ?? ""} ${invoice.tenantId?.lastName ?? ""}`.trim();
  return invoice.customerName?.trim() || tenant;
}

interface InvoiceQueryParams {
  page: number;
  limit: number;
  search?: string;
  status?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  tenantId?: string;
  propertyId?: string;
  leaseId?: string;
}

// Helper function to format address
const formatAddress = (
  address:
    | string
    | {
        street: string;
        city: string;
        state: string;
        zipCode: string;
        country: string;
      }
    | undefined,
): string => {
  if (typeof address === "string") {
    return address;
  }
  if (address && typeof address === "object") {
    const { street, city, state, zipCode } = address;
    return `${street}, ${city}, ${state} ${zipCode}`;
  }
  return "";
};

export default function InvoicesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, status } = useSession();
  const { isTenant, permissions } = useAuthorization();
  const canCreateInvoices = hasAnyPermission(
    permissions,
    INVOICE_CREATE_PERMISSIONS,
  );
  const canExportInvoices = hasAnyPermission(permissions, [
    "invoice_export",
    "financial_management",
    "data_export",
  ]);
  const { t, formatCurrency: formatCurrencyLocalized, language } =
    useLocalizationContext();
  // Back from a gateway's payment page opened from the payment dialog.
  useGatewayReturn();
  const initialLeaseId = searchParams.get("leaseId") || undefined;
  const initialPropertyId = searchParams.get("propertyId") || undefined;
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSearching, setIsSearching] = useState(false);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
  const [selectedInvoiceForPayment, setSelectedInvoiceForPayment] =
    useState<Invoice | null>(null);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 12,
    total: 0,
    pages: 0,
    hasNext: false,
    hasPrev: false,
  });
  const [filters, setFilters] = useState<InvoiceQueryParams>({
    page: 1,
    limit: 12,
    search: "",
    status: undefined,
    sortBy: "createdAt",
    sortOrder: "desc",
    ...(initialPropertyId ? { propertyId: initialPropertyId } : {}),
    ...(initialLeaseId ? { leaseId: initialLeaseId } : {}),
  });
  const viewMode = useViewPreferencesStore((state) => state.invoicesView);
  const setViewMode = useViewPreferencesStore((state) => state.setInvoicesView);
  const [selectedInvoices, setSelectedInvoices] = useState<string[]>([]);
  const [stats, setStats] = useState({
    total: 0,
    scheduled: 0,
    issued: 0,
    paid: 0,
    partial: 0,
    overdue: 0,
    cancelled: 0,
    totalAmount: 0,
    paidAmount: 0,
    overdueAmount: 0,
  });
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (status !== "authenticated") {
      return;
    }

    fetchInvoices(filters, true);
    fetchStats();
  }, [status]);

  useEffect(() => {
    if (status !== "authenticated" || isInitialLoad) {
      return;
    }

    fetchInvoices(filters, false);
  }, [filters, isInitialLoad, status]);

  useEffect(() => {
    if (status !== "authenticated") {
      return;
    }

    fetchStats();
  }, [filters.propertyId, filters.tenantId, filters.leaseId, status]);

  const fetchInvoices = async (
    currentFilters?: InvoiceQueryParams,
    showFullLoading: boolean = false,
  ) => {
    try {
      const activeFilters = currentFilters ?? filters;

      if (showFullLoading) {
        setLoading(true);
      }

      if (isTenant) {
        // For tenants, use the tenant invoices API
        const params = new URLSearchParams();
        params.set("page", "1");
        params.set("limit", "1000");
        const response = await fetch(
          `/api/tenant/invoices?${params.toString()}`,
        );
        const data = await response.json();

        if (data?.success) {
          const allInv: Invoice[] = data.data?.invoices || [];
          const search = (activeFilters.search || "").toLowerCase().trim();
          const filtered = allInv.filter((inv) => {
            const matchesStatus =
              !activeFilters.status || inv.status === activeFilters.status;
            if (!search) return matchesStatus;
            const haystack = [
              inv.invoiceNumber,
              inv.propertyId?.name,
              inv.tenantId?.firstName,
              inv.tenantId?.lastName,
              inv.tenantId?.email,
              inv.customerName,
            ]
              .filter(Boolean)
              .map((v) => String(v).toLowerCase());
            const matchesSearch = haystack.some((v) => v.includes(search));
            return matchesStatus && matchesSearch;
          });
          const sortBy = activeFilters.sortBy || "createdAt";
          const sortOrder = activeFilters.sortOrder || "desc";
          const get = (obj: any, path: string) =>
            path
              .split(".")
              .reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
          const getSortVal = (inv: Invoice) => {
            const v = get(inv, sortBy);
            if (!v) return 0;
            const key = sortBy.toLowerCase();
            if (
              key.includes("date") ||
              key.includes("createdat") ||
              key.includes("updatedat")
            ) {
              const t = new Date(v as any).getTime();
              return Number.isNaN(t) ? 0 : t;
            }
            return typeof v === "number" ? v : String(v).toLowerCase();
          };
          const sorted = [...filtered].sort((a, b) => {
            const av = getSortVal(a);
            const bv = getSortVal(b);
            if (typeof av === "number" && typeof bv === "number") {
              return sortOrder === "asc" ? av - bv : bv - av;
            }
            return sortOrder === "asc"
              ? String(av).localeCompare(String(bv))
              : String(bv).localeCompare(String(av));
          });
          const page = activeFilters.page || 1;
          const limit = activeFilters.limit || 10;
          const total = sorted.length;
          const pages = Math.max(1, Math.ceil(total / limit));
          const start = (page - 1) * limit;
          const paginated = sorted.slice(start, start + limit);
          setInvoices(paginated);
          setPagination({
            page,
            limit,
            total,
            pages,
            hasNext: page < pages,
            hasPrev: page > 1,
          });

          // Keep tenant stats in sync with the currently filtered dataset
          setStats({
            total: filtered.length,
            scheduled: filtered.filter((inv) => inv.status === "scheduled")
              .length,
            issued: filtered.filter((inv) => inv.status === "issued").length,
            paid: filtered.filter((inv) => inv.status === "paid").length,
            partial: filtered.filter((inv) => inv.status === "partial").length,
            overdue: filtered.filter((inv) => inv.status === "overdue").length,
            cancelled: filtered.filter((inv) => inv.status === "cancelled")
              .length,
            totalAmount: filtered.reduce(
              (sum, inv) => sum + (inv.totalAmount || 0),
              0,
            ),
            paidAmount: filtered.reduce(
              (sum, inv) => sum + (inv.amountPaid || 0),
              0,
            ),
            overdueAmount: filtered.reduce(
              (sum, inv) => sum + (inv.balanceRemaining || 0),
              0,
            ),
          });
        } else {
          showSimpleError(
            "Load Error",
            t("leases.invoices.toasts.fetchTenantError"),
          );
        }
      } else {
        // For admin/manager, use the existing invoices API
        const params = new URLSearchParams();

        Object.entries(activeFilters).forEach(([key, value]) => {
          if (value !== undefined && value !== "") {
            params.append(key, value.toString());
          }
        });

        params.set("page", "1");
        params.set("limit", "1000");
        // Everything the office issued: owners' and customers' invoices and
        // credit notes too, not only tenants' charges.
        params.set("party", "all");
        const response = await fetch(`/api/invoices?${params}`);
        const data = await response.json();

        if (data?.success) {
          const allInv: Invoice[] = data.data?.invoices || [];
          const search = (activeFilters.search || "").toLowerCase().trim();
          const filtered = allInv.filter((inv) => {
            const matchesStatus =
              !activeFilters.status || inv.status === activeFilters.status;
            if (!search) return matchesStatus;
            const haystack = [
              inv.invoiceNumber,
              inv.propertyId?.name,
              inv.tenantId?.firstName,
              inv.tenantId?.lastName,
              inv.tenantId?.email,
              inv.customerName,
            ]
              .filter(Boolean)
              .map((v) => String(v).toLowerCase());
            const matchesSearch = haystack.some((v) => v.includes(search));
            return matchesStatus && matchesSearch;
          });
          const sortBy = activeFilters.sortBy || "createdAt";
          const sortOrder = activeFilters.sortOrder || "desc";
          const get = (obj: any, path: string) =>
            path
              .split(".")
              .reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
          const getSortVal = (inv: Invoice) => {
            const v = get(inv, sortBy);
            if (!v) return 0;
            const key = sortBy.toLowerCase();
            if (
              key.includes("date") ||
              key.includes("createdat") ||
              key.includes("updatedat")
            ) {
              const t = new Date(v as any).getTime();
              return Number.isNaN(t) ? 0 : t;
            }
            return typeof v === "number" ? v : String(v).toLowerCase();
          };
          const sorted = [...filtered].sort((a, b) => {
            const av = getSortVal(a);
            const bv = getSortVal(b);
            if (typeof av === "number" && typeof bv === "number") {
              return sortOrder === "asc" ? av - bv : bv - av;
            }
            return sortOrder === "asc"
              ? String(av).localeCompare(String(bv))
              : String(bv).localeCompare(String(av));
          });
          const page = activeFilters.page || 1;
          const limit = activeFilters.limit || 10;
          const total = sorted.length;
          const pages = Math.max(1, Math.ceil(total / limit));
          const start = (page - 1) * limit;
          const paginated = sorted.slice(start, start + limit);
          setInvoices(paginated);
          setPagination({
            page,
            limit,
            total,
            pages,
            hasNext: page < pages,
            hasPrev: page > 1,
          });
        } else {
          showSimpleError("Load Error", t("leases.invoices.toasts.fetchError"));
        }
      }
    } catch {
      showSimpleError("Load Error", t("leases.invoices.toasts.fetchError"));
    } finally {
      setLoading(false);
      setIsSearching(false);
      if (showFullLoading) {
        setIsInitialLoad(false);
      }
    }
  };

  const fetchStats = async () => {
    try {
      // Skip fetching stats for tenants - already fetched with invoices
      if (isTenant) {
        return;
      }

      const params = new URLSearchParams();
      if (filters.propertyId)
        params.append("propertyId", String(filters.propertyId));
      if (filters.tenantId) params.append("tenantId", String(filters.tenantId));
      if (filters.leaseId) params.append("leaseId", String(filters.leaseId));
      // The figures over the same documents the list shows.
      params.append("party", "all");
      const url = `/api/invoices/stats${
        params.toString() ? `?${params.toString()}` : ""
      }`;
      const response = await fetch(url);
      const data = await response.json();

      if (data?.success && data?.data) {
        setStats((prev) => ({
          ...prev,
          ...(data?.data || {}),
        }));
      }
    } catch (error) {
      // Failed to fetch invoice stats
    }
  };

  const handleSearch = (value: string) => {
    setIsSearching(true);
    setFilters((prev) => ({ ...prev, search: value, page: 1 }));
  };

  const handleStatusFilter = (status: string) => {
    setFilters((prev) => ({
      ...prev,
      status: status === "all" ? undefined : status,
      page: 1,
    }));
  };

  const handleSort = (sortBy: string, sortOrder: "asc" | "desc") => {
    setFilters((prev) => ({ ...prev, sortBy, sortOrder, page: 1 }));
  };

  const handlePageChange = (page: number) => {
    setFilters((prev) => ({ ...prev, page }));
  };
  const handlePageSizeChange = (newLimit: number) => {
    setFilters((prev) => ({ ...prev, limit: newLimit, page: 1 }));
  };

  const handleDownloadInvoice = async (inv: Invoice) => {
    try {
      // Fetch company info from display settings
      const { getCompanyInfo } = await import("@/lib/utils/company-info");
      const companyInfo = await getCompanyInfo();

      const printable = normalizeInvoiceForPrint(inv, {
        companyInfo: companyInfo || undefined,
      }) as PrintableInvoice;
      await downloadInvoiceAsPDF(printable);
      showSimpleSuccess(
        "Download Complete",
        t("leases.invoices.toasts.downloadSuccess"),
      );
    } catch (error) {
      showSimpleError(
        "Download Failed",
        t("leases.invoices.toasts.downloadError"),
      );
    }
  };

  const handlePrintInvoice = async (inv: Invoice) => {
    try {
      // Fetch company info from display settings
      const { getCompanyInfo } = await import("@/lib/utils/company-info");
      const companyInfo = await getCompanyInfo();

      const printable = normalizeInvoiceForPrint(inv, {
        companyInfo: companyInfo || undefined,
      }) as PrintableInvoice;
      printInvoice(printable);
    } catch (error) {
      showSimpleError("Print Failed", t("leases.invoices.toasts.printError"));
    }
  };

  const handleSendInvoice = async (inv: Invoice) => {
    if (!inv?.tenantId?.email) {
      showSimpleError(t("leases.invoices.toasts.emailFailedTitle", { defaultValue: "Email not sent" }), t("leases.invoices.toasts.emailError"));
      return;
    }
    try {
      const body = {
        leaseId: inv.leaseId?._id || (inv as any).leaseId,
        invoiceId: inv._id,
        to: inv.tenantId?.email,
        invoiceNumber: inv.invoiceNumber,
        // Subject and message come from the route, in this language.
        lang: language,
      };
      const res = await fetch("/api/invoices/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok && data?.success) {
        showSimpleSuccess(
          t("leases.invoices.toasts.emailSentTitle", { defaultValue: "Email sent" }),
          t("leases.invoices.toasts.emailSuccess"),
        );
      } else {
        throw new Error(data?.error || t("leases.invoices.toasts.emailError"));
      }
    } catch {
      showSimpleError(t("leases.invoices.toasts.emailFailedTitle", { defaultValue: "Email not sent" }), t("leases.invoices.toasts.emailError"));
    }
  };

  const handleDeleteInvoice = async (invoiceId: string) => {
    try {
      setDeletingId(invoiceId);
      const res = await fetch(`/api/invoices/${invoiceId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (res.ok && data?.success) {
        showSimpleSuccess(
          "Invoice Deleted",
          t("leases.invoices.toasts.refreshed"),
        );
        fetchInvoices(filters, false);
      } else {
        throw new Error(data?.error || "Failed to delete invoice");
      }
    } catch {
      showSimpleError("Delete Failed", "Failed to delete invoice");
    } finally {
      setDeletingId(null);
    }
  };

  const formatCurrency = useCallback(
    (amount: number) => formatCurrencyLocalized(amount ?? 0),
    [formatCurrencyLocalized],
  );

  const getStatusBadge = (status?: string | null, daysOverdue?: number) => {
    const safeStatus = status || "unknown";
    const statusConfig = {
      scheduled: {
        variant: "secondary" as const,
        label: t("leases.invoices.status.scheduled"),
        icon: Calendar,
      },
      issued: {
        variant: "outline" as const,
        label: t("leases.invoices.status.issued"),
        icon: Send,
      },
      paid: {
        variant: "default" as const,
        label: t("leases.invoices.status.paid"),
        icon: CheckCircle,
      },
      partial: {
        variant: "secondary" as const,
        label: t("leases.invoices.status.partial"),
        icon: Clock,
      },
      overdue: {
        variant: "destructive" as const,
        label:
          daysOverdue && daysOverdue > 0
            ? `${t("leases.invoices.status.overdue")} (${daysOverdue}d)`
            : t("leases.invoices.status.overdue"),
        icon: AlertTriangle,
      },
      cancelled: {
        variant: "outline" as const,
        label: t("leases.invoices.status.cancelled"),
        icon: Trash2,
      },
    };

    const config = statusConfig[safeStatus as keyof typeof statusConfig] || {
      variant: "outline" as const,
      label: safeStatus,
      icon: FileText,
    };

    return (
      <Badge variant={config.variant} className="flex items-center gap-1">
        <config.icon className="h-3 w-3" />
        {config.label}
      </Badge>
    );
  };

  const handleBulkAction = async () => {
    if (selectedInvoices.length === 0) {
      showSimpleError("No Selection", t("leases.invoices.toasts.noSelection"));
      return;
    }

    // Open bulk operations dialog instead of direct action
    setBulkDialogOpen(true);
  };

  const handleRecordPayment = (invoice: Invoice) => {
    setSelectedInvoiceForPayment(invoice);
    setPaymentDialogOpen(true);
  };

  const handleViewInvoice = (invoiceId: string) => {
    router.push(`/dashboard/accounting/invoices/${invoiceId}`);
  };

  const handleEditInvoice = (invoiceId: string) => {
    router.push(`/dashboard/accounting/invoices/${invoiceId}/edit`);
  };

  // Define columns for DataTable
  const invoiceColumns: DataTableColumn<Invoice>[] = [
    {
      id: "invoiceNumber",
      sortKey: "invoiceNumber",
      header: t("leases.invoices.table.invoiceNumber"),
      cell: (invoice) => (
        <Link
          href={`/dashboard/accounting/invoices/${invoice._id}`}
          className="group inline-flex items-center gap-2 text-foreground transition-colors hover:text-blue-600 dark:hover:text-blue-400"
        >
          <FileText className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-blue-600 dark:group-hover:text-blue-400" />
          <span className="font-mono font-medium">
            {invoice.invoiceNumber || "—"}
          </span>
          {invoice.documentType === "credit_note" && (
            <Badge variant="outline" className="text-xs">
              {t("invoices.creditNote.badge", { defaultValue: "Credit note" })}
            </Badge>
          )}
        </Link>
      ),
    },
    ...(!isTenant
      ? [
          {
            id: "tenant",
            header: t("leases.invoices.table.tenant"),
            cell: (invoice: Invoice) => {
              // An owner's or a customer's invoice: their name, what they are,
              // and their VAT number when they gave one.
              if (!invoice.tenantId) {
                return (
                  <div className="min-w-0">
                    <div className="font-medium truncate">{billedTo(invoice) || "—"}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {t(`invoices.customer.type.${invoice.customerType ?? "customer"}`, {
                        defaultValue: invoice.customerType ?? "customer",
                      })}
                      {invoice.customerVatNumber ? ` · ${invoice.customerVatNumber}` : ""}
                    </div>
                  </div>
                );
              }
              const tenantContent = (
                <>
                  <Avatar className="h-8 w-8">
                    <AvatarImage
                      src={invoice.tenantId?.avatar}
                      alt={`${invoice.tenantId?.firstName || ""} ${
                        invoice.tenantId?.lastName || ""
                      }`}
                    />
                    <AvatarFallback className="text-xs bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                      {invoice.tenantId?.firstName?.[0] || "T"}
                      {invoice.tenantId?.lastName?.[0] || "U"}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <div className="font-medium text-gray-900 dark:text-gray-100 truncate transition-colors group-hover:text-blue-600 dark:group-hover:text-blue-400">
                      {invoice.tenantId?.firstName ||
                        t("leases.labels.unknownFirstName")}{" "}
                      {invoice.tenantId?.lastName ||
                        t("leases.labels.unknownLastName")}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                      {invoice.tenantId?.email}
                    </div>
                  </div>
                </>
              );

              if (!invoice.tenantId?._id) {
                return <div className="flex items-center gap-2">{tenantContent}</div>;
              }

              return (
                <Link
                  href={`/dashboard/tenants/${invoice.tenantId._id}`}
                  className="group flex items-center gap-2 text-foreground transition-colors"
                >
                  {tenantContent}
                </Link>
              );
            },
            visibility: "md" as const,
          },
        ]
      : []),
    {
      id: "property",
      sortKey: "propertyId.name",
      header: t("leases.invoices.table.property"),
      cell: (invoice) => {
        const propertyId = invoice.propertyId?._id || invoice.leaseId?.propertyId?._id;
        const propertyName =
          invoice.propertyId?.name ||
          invoice.leaseId?.propertyId?.name ||
          (invoice.tenantId ? "Unknown Property" : "—");
        const propertyAddress =
          invoice.propertyId?.address || invoice.leaseId?.propertyId?.address;
        const address = formatAddress(propertyAddress);
        const words = address.split(" ");
        const truncatedAddress =
          words.length > 3 ? words.slice(0, 3).join(" ") + "..." : address;
        const propertyContent = (
          <>
            <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
            <div className="min-w-0 max-w-[180px]">
              <div className="font-medium truncate transition-colors group-hover:text-blue-600 dark:group-hover:text-blue-400">
                {propertyName}
              </div>
              <div
                className="text-xs text-muted-foreground truncate"
                title={address}
              >
                {truncatedAddress}
              </div>
            </div>
          </>
        );

        if (!propertyId) {
          return <div className="flex items-center gap-2">{propertyContent}</div>;
        }

        return (
          <Link
            href={`/dashboard/properties/${propertyId}`}
            className="group flex items-center gap-2 text-foreground transition-colors"
          >
            {propertyContent}
          </Link>
        );
      },
      visibility: "lg" as const,
    },
    {
      id: "issueDate",
      sortKey: "issueDate",
      header: t("leases.invoices.table.issueDate"),
      cell: (invoice) => (
        <span className="text-sm">
          {formatDisplayDate(invoice.issueDate)}
        </span>
      ),
      visibility: "md" as const,
    },
    {
      id: "dueDate",
      sortKey: "dueDate",
      header: t("leases.invoices.table.dueDate"),
      cell: (invoice) => (
        <span className="text-sm">
          {formatDisplayDate(invoice.dueDate)}
        </span>
      ),
    },
    {
      id: "amount",
      sortKey: "totalAmount",
      header: t("leases.invoices.table.amount"),
      cell: (invoice) => (
        <span className="font-medium">
          {formatCurrency(invoice.totalAmount ?? 0)}
        </span>
      ),
    },
    {
      id: "paid",
      sortKey: "amountPaid",
      header: t("leases.invoices.table.paid"),
      cell: (invoice) => (
        <span className="text-green-600 dark:text-green-400">
          {formatCurrency(invoice.amountPaid ?? 0)}
        </span>
      ),
      visibility: "lg" as const,
    },
    {
      id: "balance",
      sortKey: "balanceRemaining",
      header: t("leases.invoices.table.balance"),
      cell: (invoice) => (
        <span
          className={
            (invoice.balanceRemaining ?? 0) > 0
              ? "text-red-600 dark:text-red-400 font-medium"
              : ""
          }
        >
          {formatCurrency(invoice.balanceRemaining ?? 0)}
        </span>
      ),
      visibility: "md" as const,
    },
    {
      id: "status",
      sortKey: "status",
      header: t("leases.invoices.table.status"),
      cell: (invoice) => getStatusBadge(invoice.status, invoice.daysOverdue),
    },
    {
      id: "actions",
      header: t("leases.invoices.table.actions"),
      align: "right" as const,
      cell: (invoice) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-8 w-8 p-0">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>
              {t("leases.invoices.actions.menuLabel")}
            </DropdownMenuLabel>
            <DropdownMenuItem onClick={() => handleViewInvoice(invoice._id)}>
              <Eye className="me-2 h-4 w-4" />
              {t("leases.invoices.actions.viewDetails")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleDownloadInvoice(invoice)}>
              <Download className="me-2 h-4 w-4" />
              {t("leases.invoices.actions.downloadPdf")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handlePrintInvoice(invoice)}>
              <Printer className="me-2 h-4 w-4" />
              {t("leases.invoices.actions.print")}
            </DropdownMenuItem>
            {!isTenant && (
              <>
                <DropdownMenuSeparator />
                {invoice.status !== "paid" && (
                  <DropdownMenuItem
                    onClick={() => handleRecordPayment(invoice)}
                  >
                    <CreditCard className="me-2 h-4 w-4" />
                    {t("leases.invoices.actions.recordPayment")}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => handleSendInvoice(invoice)}>
                  <Send className="me-2 h-4 w-4" />
                  {t("leases.invoices.actions.sendToTenant")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => handleEditInvoice(invoice._id)}
                >
                  <Edit className="me-2 h-4 w-4" />
                  {t("leases.invoices.actions.editInvoice")}
                </DropdownMenuItem>
                <ConfirmationDialog
                  title={t("leases.invoices.dialog.delete.title")}
                  description={t("leases.invoices.dialog.delete.description", {
                    values: { invoiceNumber: invoice.invoiceNumber },
                  })}
                  confirmText={t("leases.invoices.dialog.delete.confirm")}
                  cancelText={t("leases.invoices.dialog.delete.cancel")}
                  variant="destructive"
                  onConfirm={() => handleDeleteInvoice(invoice._id)}
                  loading={deletingId === invoice._id}
                >
                  <DropdownMenuItem
                    onSelect={(e) => e.preventDefault()}
                    className="text-red-600"
                  >
                    <Trash2 className="me-2 h-4 w-4" />
                    {t("leases.invoices.actions.deleteInvoice")}
                  </DropdownMenuItem>
                </ConfirmationDialog>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  const paymentDialogInvoice = selectedInvoiceForPayment
    ? {
        _id: selectedInvoiceForPayment._id,
        invoiceNumber: selectedInvoiceForPayment.invoiceNumber || "—",
        totalAmount: selectedInvoiceForPayment.totalAmount ?? 0,
        amountPaid: selectedInvoiceForPayment.amountPaid ?? 0,
        balanceRemaining: selectedInvoiceForPayment.balanceRemaining ?? 0,
        tenantId: selectedInvoiceForPayment.tenantId
          ? {
              firstName: selectedInvoiceForPayment.tenantId?.firstName || "",
              lastName: selectedInvoiceForPayment.tenantId?.lastName || "",
            }
          : null,
      }
    : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            {isTenant
              ? t("invoices.header.myTitle", {
                  defaultValue: "My Invoices",
                })
              : t("invoices.header.title", {
                  defaultValue: "Invoices",
                })}
          </h1>
          <p className="text-muted-foreground text-sm sm:text-base">
            {isTenant
              ? t("invoices.header.mySubtitle", {
                  defaultValue: "View and pay your invoices",
                })
              : t("invoices.header.subtitle", {
                  defaultValue:
                    "Create and manage invoices for leases, services, and charges",
                })}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              fetchInvoices(filters, true);
              fetchStats();
              showSimpleSuccess(
                "Refreshed",
                t("leases.invoices.toasts.refreshed"),
              );
            }}
          >
            <RefreshCw className="me-2 h-4 w-4" />
            {t("leases.actions.refresh")}
          </Button>
          {/* The list as filtered, as a file: Export invoices, as the
              server asks. */}
          {!isTenant && canExportInvoices && (
            <ReportExportButton
              endpoint="/api/invoices"
              params={
                new URLSearchParams([
                  ...Object.entries(filters)
                    .filter(
                      ([key, value]) =>
                        !["page", "limit"].includes(key) &&
                        value !== undefined &&
                        value !== "",
                    )
                    .map(([key, value]): [string, string] => [key, String(value)]),
                  ["party", "all"],
                ])
              }
              disabled={invoices.length === 0}
            />
          )}
          {!isTenant && canCreateInvoices && (
            <Button
              size="sm"
              onClick={() => router.push("/dashboard/accounting/invoices/new")}
            >
              <Plus className="me-2 h-4 w-4" />
              {t("invoices.actions.createInvoice", {
                defaultValue: "Create Invoice",
              })}
            </Button>
          )}
        </div>
      </div>

      {/* Stats Cards */}
      {isTenant ? (
        <AnalyticsCardGrid className="md:grid-cols-4 lg:grid-cols-4">
          <AnalyticsCard
            title={t("leases.invoices.stats.total")}
            value={stats.total}
            description={t("leases.invoices.stats.totalDescription", {
              defaultValue: "All invoices",
            })}
            icon={FileText}
            iconColor="primary"
          />
          <AnalyticsCard
            title={t("leases.invoices.stats.paid")}
            value={stats.paid}
            description={t("leases.invoices.stats.paidDescription", {
              defaultValue: "Successfully paid",
            })}
            icon={CheckCircle}
            iconColor="success"
          />
          <AnalyticsCard
            title={t("leases.invoices.stats.overdue")}
            value={stats.overdue}
            description={t("leases.invoices.stats.overdueDescription", {
              defaultValue: "Needs attention",
            })}
            icon={AlertTriangle}
            iconColor="warning"
          />
          <AnalyticsCard
            title={t("leases.invoices.stats.balance", {
              defaultValue: "Balance",
            })}
            value={formatCurrency(stats.overdueAmount)}
            description={t("leases.invoices.stats.balanceDescription", {
              defaultValue: "Outstanding balance",
            })}
            icon={DollarSign}
            iconColor="error"
          />
        </AnalyticsCardGrid>
      ) : (
        <AnalyticsCardGrid className="md:grid-cols-4 lg:grid-cols-4">
          <AnalyticsCard
            title={t("leases.invoices.stats.total")}
            value={stats.total}
            description={t("leases.invoices.stats.totalDescription", {
              defaultValue: "All invoices",
            })}
            icon={FileText}
            iconColor="primary"
          />

          <AnalyticsCard
            title={t("leases.invoices.stats.paid")}
            value={stats.paid}
            description={t("leases.invoices.stats.paidDescription", {
              defaultValue: "Successfully paid",
            })}
            icon={CheckCircle}
            iconColor="success"
          />

          <AnalyticsCard
            title={t("leases.invoices.stats.issued")}
            value={stats.issued}
            description={t("leases.invoices.stats.issuedDescription", {
              defaultValue: "Sent and awaiting payment",
            })}
            icon={Send}
            iconColor="info"
          />

          <AnalyticsCard
            title={t("leases.invoices.stats.overdue")}
            value={stats.overdue}
            description={t("leases.invoices.stats.overdueDescription", {
              defaultValue: "Needs attention",
            })}
            icon={AlertTriangle}
            iconColor="error"
          />
        </AnalyticsCardGrid>
      )}

      {/* Invoice List with Integrated Filters */}
      <Card className="gap-2">
        <CardHeader>
          {/* Main Header */}
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-2">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-50 dark:bg-blue-900/30 rounded-lg border border-blue-100 dark:border-blue-800">
                <FileText className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {t("leases.invoices.list.title")}
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {t("leases.invoices.list.subtitle")}
                </p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              {/* View Mode Toggle */}
              <div className="flex items-center border rounded-lg p-1 w-full sm:w-auto">
                <Button
                  variant={viewMode === "cards" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setViewMode("cards")}
                  className="h-8 flex-1 sm:flex-none sm:px-3"
                >
                  <LayoutGrid className="h-4 w-4" />
                </Button>
                <Button
                  variant={viewMode === "table" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setViewMode("table")}
                  className="h-8 flex-1 sm:flex-none sm:px-3"
                >
                  <List className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          {/* Integrated Filters Bar */}
          <div className="flex flex-col gap-4 p-4 bg-gray-50/50 dark:bg-gray-800/50 rounded-lg border border-gray-200/60 dark:border-gray-700/60">
            {/* Search and Filter Controls in one row */}
            <div className="flex flex-col lg:flex-row lg:items-center gap-3">
              {/* Search */}
              <GlobalSearch
                placeholder={t("leases.invoices.filters.searchPlaceholder")}
                initialValue={filters.search || ""}
                debounceDelay={300}
                onSearch={handleSearch}
                isLoading={isSearching}
                className="flex-1 min-w-0"
                inputClassName="h-10 border-gray-200 dark:border-gray-700 focus:border-blue-400 dark:focus:border-blue-500 focus:ring-1 focus:ring-blue-400 dark:focus:ring-blue-500 bg-white dark:bg-gray-800"
                ariaLabel={t("search.invoices", { defaultValue: "Search invoices" })}
              />

              {/* Filter Controls */}
              <Select
                value={filters.status || "all"}
                onValueChange={handleStatusFilter}
              >
                <SelectTrigger className="w-40 h-10 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                  <SelectValue
                    placeholder={t("leases.invoices.filters.statusPlaceholder")}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t("leases.invoices.filters.status.all")}
                  </SelectItem>
                  <SelectItem value="scheduled">
                    {t("leases.invoices.status.scheduled")}
                  </SelectItem>
                  <SelectItem value="issued">
                    {t("leases.invoices.status.issued")}
                  </SelectItem>
                  <SelectItem value="partial">
                    {t("leases.invoices.status.partial")}
                  </SelectItem>
                  <SelectItem value="paid">
                    {t("leases.invoices.status.paid")}
                  </SelectItem>
                  <SelectItem value="overdue">
                    {t("leases.invoices.status.overdue")}
                  </SelectItem>
                  <SelectItem value="cancelled">
                    {t("leases.invoices.status.cancelled")}
                  </SelectItem>
                </SelectContent>
              </Select>

              <Select
                value={
                  SORT_MENU_VALUES.includes(`${filters.sortBy}-${filters.sortOrder}`)
                    ? `${filters.sortBy}-${filters.sortOrder}`
                    : ""
                }
                onValueChange={(value) => {
                  const [sortBy, sortOrder] = value.split("-");
                  handleSort(sortBy, sortOrder as "asc" | "desc");
                }}
              >
                <SelectTrigger className="w-40 h-10 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                  <SelectValue placeholder={t("leases.filters.sortBy")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="createdAt-desc">
                    {t("leases.sort.newestFirst")}
                  </SelectItem>
                  <SelectItem value="createdAt-asc">
                    {t("leases.sort.oldestFirst")}
                  </SelectItem>
                  <SelectItem value="dueDate-asc">
                    {t("leases.invoices.sort.dueDateEarliest")}
                  </SelectItem>
                  <SelectItem value="dueDate-desc">
                    {t("leases.invoices.sort.dueDateLatest")}
                  </SelectItem>
                  <SelectItem value="totalAmount-desc">
                    {t("leases.invoices.sort.amountHighToLow")}
                  </SelectItem>
                  <SelectItem value="totalAmount-asc">
                    {t("leases.invoices.sort.amountLowToHigh")}
                  </SelectItem>
                  <SelectItem value="status-asc">
                    {t("leases.invoices.sort.statusAZ")}
                  </SelectItem>
                </SelectContent>
              </Select>

              {/* Clear Filters */}
              {(filters.search || filters.status) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setFilters((prev) => ({
                      ...prev,
                      search: "",
                      status: undefined,
                      page: 1,
                    }))
                  }
                  className="h-10 px-3 text-gray-500 hover:text-gray-700"
                >
                  <X className="h-4 w-4 me-1" />
                  {t("leases.filters.clear") || "Clear"}
                </Button>
              )}
            </div>

            {/* Bulk Actions - When items selected */}
            {selectedInvoices.length > 0 && (
              <div className="flex items-center gap-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                <span className="text-sm text-muted-foreground">
                  {t("leases.invoices.bulk.selected", {
                    values: { count: selectedInvoices.length },
                  })}
                </span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm">
                      {t("leases.invoices.bulk.actions")}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem onClick={() => setBulkDialogOpen(true)}>
                      <CheckSquare className="me-2 h-4 w-4" />
                      {t("leases.invoices.bulk.openDialog")}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={handleBulkAction}>
                      <Send className="me-2 h-4 w-4" />
                      {t("leases.invoices.bulk.sendInvoices")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleBulkAction}>
                      <Download className="me-2 h-4 w-4" />
                      {t("leases.invoices.bulk.downloadPdfs")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleBulkAction}>
                      <CreditCard className="me-2 h-4 w-4" />
                      {t("leases.invoices.bulk.markAsPaid")}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={handleBulkAction}
                      className="text-red-600"
                    >
                      <Trash2 className="me-2 h-4 w-4" />
                      {t("leases.invoices.bulk.cancelInvoices")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="p-6">
              <div className="space-y-4">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="flex items-center space-x-4">
                    <Skeleton className="h-12 w-12 rounded" />
                    <div className="space-y-2 flex-1">
                      <Skeleton className="h-4 w-[250px]" />
                      <Skeleton className="h-4 w-[200px]" />
                    </div>
                    <Skeleton className="h-4 w-[100px]" />
                    <Skeleton className="h-4 w-[80px]" />
                  </div>
                ))}
              </div>
            </div>
          ) : viewMode === "cards" ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 p-4">
              {invoices.length === 0 ? (
                <div className="col-span-full flex flex-col items-center gap-2 py-12">
                  <FileText className="h-12 w-12 text-muted-foreground" />
                  <h3 className="text-lg font-semibold">
                    {t("leases.invoices.empty.noInvoices", {
                      defaultValue: "No invoices found",
                    })}
                  </h3>
                  <p className="text-muted-foreground mb-2">
                    {t("leases.invoices.empty.description", {
                      defaultValue: "No invoices match your current filters.",
                    })}
                  </p>
                  {!isTenant && !filters.search && !filters.status && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        router.push("/dashboard/accounting/invoices/new")
                      }
                    >
                      {t("invoices.empty.createFirst", {
                        defaultValue: "Create Invoice",
                      })}
                    </Button>
                  )}
                </div>
              ) : (
                invoices.map((invoice) => (
                  <Card
                    key={invoice._id}
                    className="hover:shadow-md transition-shadow"
                  >
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <div className="space-y-1 flex-1">
                          <div className="flex items-center gap-2">
                            <FileText className="h-4 w-4 text-muted-foreground" />
                            <span className="text-base font-semibold font-mono">
                              {invoice.invoiceNumber || "—"}
                            </span>
                          </div>
                          {!isTenant && (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <Avatar className="h-6 w-6">
                                <AvatarImage
                                  src={invoice.tenantId?.avatar}
                                  alt={`${invoice.tenantId?.firstName || ""} ${
                                    invoice.tenantId?.lastName || ""
                                  }`}
                                />
                                <AvatarFallback className="text-xs">
                                  {invoice.tenantId?.firstName?.[0] || "T"}
                                  {invoice.tenantId?.lastName?.[0] || "U"}
                                </AvatarFallback>
                              </Avatar>
                              <span className="truncate">
                                {invoice.tenantId
                                  ? `${invoice.tenantId.firstName || t("leases.labels.unknownFirstName")} ${
                                      invoice.tenantId.lastName || t("leases.labels.unknownLastName")
                                    }`
                                  : billedTo(invoice) || "—"}
                              </span>
                            </div>
                          )}
                        </div>
                        {!isTenant && (
                          <input
                            type="checkbox"
                            checked={selectedInvoices.includes(invoice._id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedInvoices([
                                  ...selectedInvoices,
                                  invoice._id,
                                ]);
                              } else {
                                setSelectedInvoices(
                                  selectedInvoices.filter(
                                    (id) => id !== invoice._id,
                                  ),
                                );
                              }
                            }}
                            className="rounded border-gray-300"
                          />
                        )}
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-sm">
                          <Building2 className="h-4 w-4 text-muted-foreground" />
                          <span className="font-medium truncate">
                            {invoice.leaseId?.propertyId?.name ||
                              invoice.propertyId?.name ||
                              t("leases.labels.addressNotAvailable")}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {formatAddress(
                            invoice.leaseId?.propertyId?.address ||
                              invoice.propertyId?.address,
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <div className="text-xs text-muted-foreground">
                            {t("leases.invoices.table.issueDate")}
                          </div>
                          <div className="font-medium">
                            {formatDisplayDate(invoice.issueDate)}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">
                            {t("leases.invoices.table.dueDate")}
                          </div>
                          <div
                            className={`font-medium ${
                              new Date(invoice.dueDate || "") < new Date() &&
                              invoice.status !== "paid"
                                ? "text-red-600"
                                : ""
                            }`}
                          >
                            {formatDisplayDate(invoice.dueDate)}
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-2 text-sm">
                        <div>
                          <div className="text-xs text-muted-foreground">
                            {t("leases.invoices.table.total")}
                          </div>
                          <div className="font-semibold">
                            {formatCurrency(invoice.totalAmount ?? 0)}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">
                            {t("leases.invoices.table.paid")}
                          </div>
                          <div className="font-medium text-green-600">
                            {formatCurrency(invoice.amountPaid ?? 0)}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">
                            {t("leases.invoices.table.balance")}
                          </div>
                          <div
                            className={`font-semibold ${
                              (invoice.balanceRemaining ?? 0) > 0
                                ? "text-red-600"
                                : "text-green-600"
                            }`}
                          >
                            {formatCurrency(invoice.balanceRemaining ?? 0)}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-2 border-t">
                        {getStatusBadge(invoice.status, invoice.daysOverdue)}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() =>
                                router.push(
                                  `/dashboard/accounting/invoices/${invoice._id}`,
                                )
                              }
                            >
                              <Eye className="me-2 h-4 w-4" />
                              {t("leases.invoices.actions.viewDetails")}
                            </DropdownMenuItem>
                            {!isTenant && (
                              <>
                                <DropdownMenuItem
                                  onClick={() => {
                                    setSelectedInvoiceForPayment(invoice);
                                    setPaymentDialogOpen(true);
                                  }}
                                  disabled={invoice.status === "paid"}
                                >
                                  <CreditCard className="me-2 h-4 w-4" />
                                  {t("leases.invoices.actions.recordPayment")}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => handleDownloadInvoice(invoice)}
                                >
                                  <Download className="me-2 h-4 w-4" />
                                  {t("leases.invoices.actions.downloadPdf")}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => handlePrintInvoice(invoice)}
                                >
                                  <Printer className="me-2 h-4 w-4" />
                                  {t("leases.invoices.actions.print")}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => handleSendInvoice(invoice)}
                                >
                                  <Send className="me-2 h-4 w-4" />
                                  {t("leases.invoices.actions.sendToTenant")}
                                </DropdownMenuItem>
                                <ConfirmationDialog
                                  title={t(
                                    "leases.invoices.dialog.delete.title",
                                  )}
                                  description={t(
                                    "leases.invoices.dialog.delete.description",
                                    {
                                      values: {
                                        invoiceNumber: invoice.invoiceNumber,
                                      },
                                    },
                                  )}
                                  confirmText={t(
                                    "leases.invoices.dialog.delete.confirm",
                                  )}
                                  cancelText={t(
                                    "leases.invoices.dialog.delete.cancel",
                                  )}
                                  variant="destructive"
                                  onConfirm={() =>
                                    handleDeleteInvoice(invoice._id)
                                  }
                                  loading={deletingId === invoice._id}
                                >
                                  <DropdownMenuItem
                                    onSelect={(e) => e.preventDefault()}
                                    className="text-red-600"
                                  >
                                    <Trash2 className="me-2 h-4 w-4" />
                                    {t("leases.invoices.actions.deleteInvoice")}
                                  </DropdownMenuItem>
                                </ConfirmationDialog>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          ) : (
            <DataTable<Invoice>
              columns={invoiceColumns}
              data={invoices}
              getRowKey={(invoice: Invoice) => invoice._id}
              // The table holds one page of a list this page sorts itself, in
              // full, before paging it: the headers and the sort menu drive
              // that one order, so a click orders every invoice, not just the
              // page on screen. The customer cell is a tenant or a named
              // customer, two fields, so its header stays plain.
              sort={{
                key: filters.sortBy ?? null,
                direction: filters.sortOrder ?? "desc",
                onSortChange: (key, direction) =>
                  key ? handleSort(key, direction) : handleSort("createdAt", "desc"),
              }}
              selection={
                !isTenant
                  ? {
                      enabled: true,
                      selectedIds: selectedInvoices,
                      onSelectAll: (checked: boolean) => {
                        if (checked) {
                          setSelectedInvoices(invoices.map((inv) => inv._id));
                        } else {
                          setSelectedInvoices([]);
                        }
                      },
                      onSelectRow: (id: string, checked: boolean) => {
                        if (checked) {
                          setSelectedInvoices((prev) => [...prev, id]);
                        } else {
                          setSelectedInvoices((prev) =>
                            prev.filter((i) => i !== id),
                          );
                        }
                      },
                      getRowId: (invoice: Invoice) => invoice._id,
                      selectAllLabel: t("leases.invoices.selection.selectAll", {
                        defaultValue: "Select all",
                      }),
                      selectRowLabel: () =>
                        t("leases.invoices.selection.selectInvoice", {
                          defaultValue: "Select invoice",
                        }),
                    }
                  : undefined
              }
              emptyState={{
                icon: <FileText className="h-12 w-12 text-muted-foreground" />,
                title: t("leases.invoices.empty.noInvoices", {
                  defaultValue: "No invoices found",
                }),
                description: t("leases.invoices.empty.description", {
                  defaultValue: "No invoices match your current filters.",
                }),
              }}
              striped
            />
          )}
          {!loading && pagination.total > 0 && (
            <GlobalPagination
              currentPage={filters.page || 1}
              totalPages={pagination.pages}
              totalItems={pagination.total}
              pageSize={filters.limit ?? 12}
              onPageChange={handlePageChange}
              onPageSizeChange={handlePageSizeChange}
              showingLabel={t("common.showing", { defaultValue: "Showing" })}
              previousLabel={t("common.previous", { defaultValue: "Previous" })}
              nextLabel={t("common.next", { defaultValue: "Next" })}
              pageLabel={t("common.page", { defaultValue: "Page" })}
              ofLabel={t("common.of", { defaultValue: "of" })}
              itemsPerPageLabel={t("common.perPage", {
                defaultValue: "per page",
              })}
              disabled={loading || isSearching}
            />
          )}
        </CardContent>
      </Card>

      {/* Payment Record Dialog */}
      <PaymentRecordDialog
        open={paymentDialogOpen}
        onOpenChange={setPaymentDialogOpen}
        invoice={paymentDialogInvoice}
        onPaymentRecorded={() => {
          fetchInvoices(filters, false);
          setSelectedInvoiceForPayment(null);
        }}
      />

      {/* Bulk Operations Dialog */}
      <BulkOperationsDialog
        open={bulkDialogOpen}
        onOpenChange={setBulkDialogOpen}
        selectedInvoices={selectedInvoices}
        onOperationComplete={() => {
          fetchInvoices(filters, false);
          setSelectedInvoices([]);
        }}
      />
    </div>
  );
}
