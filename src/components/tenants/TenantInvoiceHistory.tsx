"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  FileText,
  MoreHorizontal,
  Eye,
  Download,
  Printer,
  Mail,
  Calendar,
  CheckCircle,
  Clock,
  AlertTriangle,
  XCircle,
  Send,
  Trash2,
} from "lucide-react";
import { InvoiceStatus } from "@/types";
import {
  printInvoice,
  downloadInvoiceAsPDF,
  type PrintableInvoice,
} from "@/lib/invoice-print";
import { normalizeInvoiceForPrint } from "@/lib/invoice/invoice-shared";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { SortableTableHead, serverTableSort } from "@/components/ui/sortable-table";
import type { SortDirection } from "@/lib/table-sort";

interface Invoice {
  _id: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  status: InvoiceStatus;
  totalAmount: number;
  amountPaid: number;
  balanceRemaining: number;
  propertyId?: {
    name: string;
    address: any;
  };
  leaseId?: {
    propertyId?: {
      name: string;
      address: any;
    };
  };
  lineItems: Array<{
    description: string;
    amount: number;
    type: string;
  }>;
  daysOverdue?: number;
  createdAt: string;
  updatedAt: string;
}

interface TenantInvoiceHistoryProps {
  tenantId: string;
  className?: string;
}

export default function TenantInvoiceHistory({
  tenantId,
  className,
}: TenantInvoiceHistoryProps) {
  const { t, formatDate, formatCurrency, language } = useLocalizationContext();
  const now = new Date();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 10,
    total: 0,
    pages: 0,
  });
  // A header's order, which /api/invoices applies to the whole history, not
  // the page on screen. No key: due date, latest first.
  const [sort, setSort] = useState<{ key: string | null; direction: SortDirection }>({
    key: null,
    direction: "asc",
  });
  // The property and the status have no order on the API — the status shown
  // is worked out per row — so those headers stay plain.
  const headerSort = serverTableSort(sort, (key, direction) => {
    setSort({ key, direction });
    setPagination((prev) => ({ ...prev, page: 1 }));
  });

  useEffect(() => {
    fetchInvoices();
  }, [tenantId, pagination.page, sort]);

  const fetchInvoices = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        tenantId,
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
        sortBy: sort.key ?? "dueDate",
        sortOrder: sort.key ? sort.direction : "desc",
      });

      const response = await fetch(`/api/invoices?${params}`);
      const data = await response.json();

      if (data.success) {
        setInvoices(data.data.invoices || []);
        setPagination(data.data.pagination || pagination);
      } else {
        toast.error(
          t("tenants.details.invoiceHistory.toasts.fetchFailedTitle"),
          {
            description: t(
              "tenants.details.invoiceHistory.toasts.fetchFailedDescription"
            ),
          }
        );
      }
    } catch (error) {
      toast.error(t("tenants.details.invoiceHistory.toasts.fetchFailedTitle"), {
        description: t(
          "tenants.details.invoiceHistory.toasts.fetchFailedDescription"
        ),
      });
    } finally {
      setLoading(false);
    }
  };

  const formatAddress = (address: any): string => {
    if (typeof address === "string") return address;
    if (address && typeof address === "object") {
      const { street, city, state, zipCode } = address;
      return `${street}, ${city}, ${state} ${zipCode}`;
    }
    return "N/A";
  };

  const getStatusBadge = (status: string, daysOverdue?: number) => {
    const statusConfig = {
      scheduled: {
        variant: "secondary" as const,
        icon: Calendar,
        className: "bg-blue-100 text-blue-800 border-blue-200",
      },
      issued: {
        variant: "outline" as const,
        icon: Send,
        className: "bg-gray-100 text-gray-800 border-gray-200",
      },
      paid: {
        variant: "default" as const,
        icon: CheckCircle,
        className: "bg-green-100 text-green-800 border-green-200",
      },
      partial: {
        variant: "secondary" as const,
        icon: Clock,
        className: "bg-orange-100 text-orange-800 border-orange-200",
      },
      overdue: {
        variant: "destructive" as const,
        icon: AlertTriangle,
        className: "bg-red-100 text-red-800 border-red-200",
      },
      cancelled: {
        variant: "outline" as const,
        icon: Trash2,
        className: "bg-gray-100 text-gray-600 border-gray-200",
      },
    } as const;

    const normalizedStatus = (status ||
      "scheduled") as keyof typeof statusConfig;
    const config = statusConfig[normalizedStatus] || statusConfig["scheduled"];

    const Icon = config.icon;

    const baseKey = `tenants.details.invoiceHistory.status.${normalizedStatus}`;
    const label =
      normalizedStatus === "overdue" && typeof daysOverdue === "number"
        ? t("tenants.details.invoiceHistory.status.overdueWithDays", {
            values: { days: daysOverdue },
          })
        : t(baseKey);

    return (
      <Badge variant={config.variant} className={config.className}>
        <Icon className="h-3 w-3 me-1" />
        {label}
      </Badge>
    );
  };

  const handleViewInvoice = (invoiceId: string) => {
    window.open(`/dashboard/leases/invoices/${invoiceId}`, "_blank");
  };

  const handleDownloadInvoice = async (invoice: Invoice) => {
    try {
      // Fetch company info from display settings
      const { getCompanyInfo } = await import("@/lib/utils/company-info");
      const companyInfo = await getCompanyInfo();

      const printable = normalizeInvoiceForPrint(invoice, {
        companyInfo: companyInfo || undefined,
      }) as PrintableInvoice;
      await downloadInvoiceAsPDF(printable);
      toast.success(t("tenants.details.invoiceHistory.toasts.downloadSuccess"));
    } catch (error) {
      toast.error(
        t("tenants.details.invoiceHistory.toasts.downloadFailedTitle"),
        {
          description: t(
            "tenants.details.invoiceHistory.toasts.downloadFailedDescription"
          ),
        }
      );
    }
  };

  const handleEmailInvoice = async (invoiceId: string) => {
    try {
      const response = await fetch(`/api/invoices/email`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        // The route addresses it to the tenant and words it in this language.
        body: JSON.stringify({ invoiceId, lang: language }),
      });

      if (response.ok) {
        toast.success(t("tenants.details.invoiceHistory.toasts.emailSuccess"));
      } else {
        toast.error(
          t("tenants.details.invoiceHistory.toasts.emailFailedTitle"),
          {
            description: t(
              "tenants.details.invoiceHistory.toasts.emailFailedDescription"
            ),
          }
        );
      }
    } catch (error) {
      toast.error(t("tenants.details.invoiceHistory.toasts.emailFailedTitle"), {
        description: t(
          "tenants.details.invoiceHistory.toasts.emailFailedDescription"
        ),
      });
    }
  };

  const handlePrintInvoice = async (invoice: Invoice) => {
    try {
      // Fetch company info from display settings
      const { getCompanyInfo } = await import("@/lib/utils/company-info");
      const companyInfo = await getCompanyInfo();

      const printable = normalizeInvoiceForPrint(invoice, {
        companyInfo: companyInfo || undefined,
      }) as PrintableInvoice;
      printInvoice(printable);
    } catch (error) {
      toast.error(t("tenants.details.invoiceHistory.toasts.printFailedTitle"), {
        description: t(
          "tenants.details.invoiceHistory.toasts.printFailedDescription"
        ),
      });
    }
  };

  if (loading) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            {t("tenants.details.invoiceHistory.title")}
          </CardTitle>
          <CardDescription>
            {t("tenants.details.invoiceHistory.loading")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex items-center space-x-4">
                <Skeleton className="h-12 w-12 rounded" />
                <div className="space-y-2 flex-1">
                  <Skeleton className="h-4 w-[250px]" />
                  <Skeleton className="h-4 w-[200px]" />
                </div>
                <Skeleton className="h-4 w-[100px]" />
                <Skeleton className="h-4 w-20" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5" />
          {t("tenants.details.invoiceHistory.title")}
        </CardTitle>
        <CardDescription>
          {invoices.length > 0
            ? t("tenants.details.invoiceHistory.description")
            : t("tenants.details.invoiceHistory.noInvoicesForTenant")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {invoices.length === 0 ? (
          <div className="text-center py-8">
            <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              {t("tenants.details.invoiceHistory.emptyTitle")}
            </h3>
            <p className="text-muted-foreground">
              {t("tenants.details.invoiceHistory.emptyDescription")}
            </p>
          </div>
        ) : (
          <>
            <div className="border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableTableHead sort={headerSort} column="invoiceNumber">
                      {t(
                        "tenants.details.invoiceHistory.columns.invoiceNumber"
                      )}
                    </SortableTableHead>
                    <TableHead>
                      {t("tenants.details.invoiceHistory.columns.property")}
                    </TableHead>
                    <SortableTableHead sort={headerSort} column="issueDate">
                      {t("tenants.details.invoiceHistory.columns.issueDate")}
                    </SortableTableHead>
                    <SortableTableHead sort={headerSort} column="dueDate">
                      {t("tenants.details.invoiceHistory.columns.dueDate")}
                    </SortableTableHead>
                    <SortableTableHead sort={headerSort} column="totalAmount">
                      {t("tenants.details.invoiceHistory.columns.amount")}
                    </SortableTableHead>
                    <SortableTableHead sort={headerSort} column="amountPaid">
                      {t("tenants.details.invoiceHistory.columns.paid")}
                    </SortableTableHead>
                    <SortableTableHead sort={headerSort} column="balanceRemaining">
                      {t("tenants.details.invoiceHistory.columns.balance")}
                    </SortableTableHead>
                    <TableHead>
                      {t("tenants.details.invoiceHistory.columns.status")}
                    </TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.map((invoice) => (
                    <TableRow key={invoice._id}>
                      <TableCell>
                        <div className="font-mono text-sm">
                          {invoice.invoiceNumber}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div>
                          <div className="font-medium">
                            {invoice.leaseId?.propertyId?.name ||
                              invoice.propertyId?.name ||
                              "N/A"}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {formatAddress(
                              invoice.leaseId?.propertyId?.address ||
                                invoice.propertyId?.address
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>{formatDate(invoice.issueDate)}</TableCell>
                      <TableCell>
                        <div
                          className={`${
                            new Date(invoice.dueDate) < now &&
                            invoice.status !== "paid"
                              ? "text-red-600 font-medium"
                              : ""
                          }`}
                        >
                          {formatDate(invoice.dueDate)}
                        </div>
                      </TableCell>
                      <TableCell className="font-medium">
                        {formatCurrency(invoice.totalAmount)}
                      </TableCell>
                      <TableCell className="text-green-600">
                        {formatCurrency(invoice.amountPaid)}
                      </TableCell>
                      <TableCell
                        className={`font-medium ${
                          invoice.balanceRemaining > 0
                            ? "text-red-600"
                            : "text-green-600"
                        }`}
                      >
                        {formatCurrency(invoice.balanceRemaining)}
                      </TableCell>
                      <TableCell>
                        {getStatusBadge(invoice.status, invoice.daysOverdue)}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" className="h-8 w-8 p-0">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => handleViewInvoice(invoice._id)}
                            >
                              <Eye className="me-2 h-4 w-4" />
                              {t(
                                "tenants.details.invoiceHistory.actions.viewDetails"
                              )}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleDownloadInvoice(invoice)}
                            >
                              <Download className="me-2 h-4 w-4" />
                              {t(
                                "tenants.details.invoiceHistory.actions.downloadPdf"
                              )}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handlePrintInvoice(invoice)}
                            >
                              <Printer className="me-2 h-4 w-4" />
                              {t(
                                "tenants.details.invoiceHistory.actions.printInvoice"
                              )}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleEmailInvoice(invoice._id)}
                            >
                              <Mail className="me-2 h-4 w-4" />
                              {t(
                                "tenants.details.invoiceHistory.actions.emailInvoice"
                              )}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            {pagination.pages > 1 && (
              <div className="flex items-center justify-between mt-4">
                <div className="text-sm text-muted-foreground">
                  {t("tenants.details.invoiceHistory.pagination.summary", {
                    values: {
                      start: (pagination.page - 1) * pagination.limit + 1,
                      end: Math.min(
                        pagination.page * pagination.limit,
                        pagination.total
                      ),
                      total: pagination.total,
                    },
                  })}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setPagination((prev) => ({
                        ...prev,
                        page: prev.page - 1,
                      }))
                    }
                    disabled={pagination.page <= 1}
                  >
                    {t("tenants.details.invoiceHistory.pagination.previous")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setPagination((prev) => ({
                        ...prev,
                        page: prev.page + 1,
                      }))
                    }
                    disabled={pagination.page >= pagination.pages}
                  >
                    {t("tenants.details.invoiceHistory.pagination.next")}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
