"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeftRight,
  DollarSign,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Calendar,
  FileText,
  CreditCard,
  Receipt,
  ExternalLink,
  FileSpreadsheet,
  ArrowUpDown,
  Download,
  Loader2,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AnalyticsCard,
  AnalyticsCardGrid,
} from "@/components/analytics/AnalyticsCard";
import { TransactionType } from "@/types";
import GlobalSearch from "@/components/ui/global-search";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { GlobalPagination } from "@/components/ui/global-pagination";
import { DataTable, DataTableColumn } from "@/components/ui/data-table";
import { keepSorted } from "@/lib/server-sort";
import type { IUnifiedTransaction, ITransactionSummary } from "@/types";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { describeCharge } from "@/lib/i18n/charge-description";
import { codeLabel, TRANSACTION_CATEGORY_TABLES } from "@/lib/i18n/code-label";
import { useAuthorization } from "@/hooks/useAuthorization";
import { ReportExportButton } from "@/components/reports/export-button";
import { buildCsv } from "@/lib/reports/csv";
import { hasAnyPermission } from "@/lib/permissions-manager";
import { toast } from "sonner";
import { businessToday } from "@/lib/dates/business-day";
import { isReportLanguage, translateLabel } from "@/lib/reports/labels";

interface TransactionResponse {
  success: boolean;
  data: {
    transactions: IUnifiedTransaction[];
    summary: ITransactionSummary;
  };
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

const EMPTY_TRANSACTION_SUMMARY: ITransactionSummary = {
  totalIncome: 0,
  totalExpenses: 0,
  netAmount: 0,
  outstanding: 0,
  transactionCount: 0,
};

export default function TransactionsPage() {
  const { isTenant, permissions } = useAuthorization();
  const canExportAccounting = hasAnyPermission(permissions, [
    "accounting_export",
    "financial_management",
    "data_export",
  ]);
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t, formatCurrency, formatDate, language } = useLocalizationContext();

  // State
  const [transactions, setTransactions] = useState<IUnifiedTransaction[]>([]);
  const [summary, setSummary] = useState<ITransactionSummary>(
    EMPTY_TRANSACTION_SUMMARY,
  );
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(parseInt(searchParams.get("page") || "1"));
  const [limit, setLimit] = useState(
    parseInt(searchParams.get("limit") || "12"),
  );
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [search, setSearch] = useState(searchParams.get("search") || "");
  const [typeFilter, setTypeFilter] = useState(
    searchParams.get("type") || "all",
  );
  const [categoryFilter, setCategoryFilter] = useState(
    searchParams.get("category") || "all",
  );
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [isExporting, setIsExporting] = useState(false);

  const buildQueryParams = useCallback(
    (pageValue: number, limitValue: number) => {
      const params = new URLSearchParams();
      params.set("page", pageValue.toString());
      params.set("limit", limitValue.toString());
      params.set("sortOrder", sortOrder);
      if (search) params.set("search", search);
      if (typeFilter && typeFilter !== "all") params.set("type", typeFilter);
      if (categoryFilter && categoryFilter !== "all")
        params.set("category", categoryFilter);
      return params;
    },
    [categoryFilter, search, sortOrder, typeFilter],
  );

  // Fetch transactions
  const fetchTransactions = useCallback(async () => {
    setLoading(true);
    try {
      const params = buildQueryParams(page, limit);
      const res = await fetch(`/api/accounting/transactions?${params}`);
      const data: TransactionResponse = await res.json();

      if (data?.success) {
        setTransactions(data?.data?.transactions ?? []);
        setSummary(data?.data?.summary ?? EMPTY_TRANSACTION_SUMMARY);
        setTotalPages(data?.pagination?.totalPages ?? 1);
        setTotalItems(data?.pagination?.total ?? 0);
      }
    } catch (error) {
      console.error("Failed to fetch transactions:", error);
    } finally {
      setLoading(false);
    }
  }, [buildQueryParams, limit, page]);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  // Navigate to source document
  const handleRowClick = (transaction: IUnifiedTransaction) => {
    if (transaction.sourceType === "payment") {
      router.push(`/dashboard/payments/${transaction.sourceId}`);
    } else if (transaction.sourceType === "invoice") {
      router.push(`/dashboard/accounting/invoices/${transaction.sourceId}`);
    } else if (transaction.sourceType === "expense") {
      router.push(`/dashboard/accounting/expenses/${transaction.sourceId}`);
    } else if (transaction.sourceType === "bill") {
      router.push(`/dashboard/accounting/bills/${transaction.sourceId}`);
    }
  };

  // Status badge color mapping
  const getStatusColor = (status?: string | null) => {
    const normalizedStatus = (status ?? "").toLowerCase();
    const colors: Record<string, string> = {
      completed: "bg-success/10 text-success border-success/20",
      paid: "bg-success/10 text-success border-success/20",
      pending: "bg-warning/10 text-warning border-warning/20",
      processing: "bg-info/10 text-info border-info/20",
      overdue: "bg-error/10 text-error border-error/20",
      late: "bg-error/10 text-error border-error/20",
      severely_overdue: "bg-error/10 text-error border-error/20",
      failed: "bg-error/10 text-error border-error/20",
      cancelled: "bg-muted text-muted-foreground border-muted",
      issued: "bg-info/10 text-info border-info/20",
      scheduled: "bg-muted text-muted-foreground border-muted",
      partial: "bg-warning/10 text-warning border-warning/20",
      refunded: "bg-muted text-muted-foreground border-muted",
      draft: "bg-muted text-muted-foreground border-muted",
      approved: "bg-success/10 text-success border-success/20",
    };
    return (
      colors[normalizedStatus] || "bg-muted text-muted-foreground border-muted"
    );
  };

  const getTransactionTypeLabel = (type?: string | null) => {
    const normalizedType = (type ?? "unknown").toLowerCase();
    return t(`transactions.types.${normalizedType}`, {
      defaultValue:
        normalizedType.charAt(0).toUpperCase() + normalizedType.slice(1),
    });
  };

  // A payment's type, an invoice line's type or an expense's category: the
  // ledger's table first, then the expense one ("utilities", "taxes").
  const getCategoryLabel = (category?: string | null) =>
    codeLabel(language, category ?? "other", TRANSACTION_CATEGORY_TABLES);

  const getStatusLabel = (status?: string | null) => {
    const normalizedStatus = (status ?? "unknown").toLowerCase();
    return t(`transactions.status.${normalizedStatus}`, {
      defaultValue: normalizedStatus.replace(/_/g, " "),
    });
  };

  // The list words a payment by its type ("Rent Payment") and an invoice by
  // its number ("Invoice INV-…") in English; said here in the reader's
  // language. What somebody typed (an expense's description) stays as typed.
  const getDescription = (transaction: IUnifiedTransaction) =>
    describeCharge(
      { description: transaction.description, type: transaction.category },
      language,
    );

  const getSourceTypeLabel = (sourceType?: string | null) => {
    const normalizedSourceType = (sourceType ?? "transaction").toLowerCase();
    return t(`transactions.sourceTypes.${normalizedSourceType}`, {
      defaultValue:
        normalizedSourceType.charAt(0).toUpperCase() +
        normalizedSourceType.slice(1),
    });
  };

  const getSignedAmount = (transaction: IUnifiedTransaction) => {
    const isOutflow =
      transaction.type === TransactionType.EXPENSE ||
      transaction.type === TransactionType.CREDIT;
    const baseAmount = Number(transaction.amount ?? 0);
    return isOutflow ? -Math.abs(baseAmount) : Math.abs(baseAmount);
  };

  const buildStatementCsv = (statementTransactions: IUnifiedTransaction[]) => {
    // The export catalogue's headings, in the reader's language.
    const header = [
      "Date",
      "Transaction type",
      "Source",
      "Category",
      "Description",
      "Reference",
      "Tenant",
      "Property",
      "Amount",
      "Status",
    ].map((heading) =>
      translateLabel(heading, isReportLanguage(language) ? language : "en"),
    );

    const rows = statementTransactions.map((transaction) => {
      const tenantName = transaction.tenantId
        ? `${transaction.tenantId.firstName || ""} ${
            transaction.tenantId.lastName || ""
          }`.trim()
        : "";
      const signedAmount = getSignedAmount(transaction);

      return [
        transaction.date ? formatDate(transaction.date) : "",
        getTransactionTypeLabel(transaction.type),
        getSourceTypeLabel(transaction.sourceType),
        getCategoryLabel(transaction.category),
        getDescription(transaction),
        transaction.reference || "",
        tenantName,
        transaction.propertyId?.name || "",
        signedAmount.toFixed(2),
        getStatusLabel(transaction.status),
      ];
    });

    // The shared CSV writer: the byte-order mark Excel needs to read an Arabic
    // name, cells quoted where they have to be, and formula-like text guarded.
    return buildCsv([header, ...rows]);
  };

  const handleStatementExport = async () => {
    setIsExporting(true);
    try {
      const exportLimit = 100;
      let currentPage = 1;
      let totalPageCount = 1;
      const allTransactions: IUnifiedTransaction[] = [];

      while (currentPage <= totalPageCount) {
        const params = buildQueryParams(currentPage, exportLimit);
        const response = await fetch(`/api/accounting/transactions?${params}`);
        if (!response.ok) {
          throw new Error("Failed to fetch transactions for export");
        }

        const data: TransactionResponse = await response.json();
        if (!data?.success) {
          throw new Error("Invalid export payload");
        }

        const pageTransactions = data?.data?.transactions ?? [];
        allTransactions.push(...pageTransactions);
        totalPageCount = Math.max(data?.pagination?.totalPages ?? currentPage, 1);
        currentPage += 1;
      }

      if (allTransactions.length === 0) {
        toast.info(
          t("transactions.export.noData", {
            defaultValue: "No transactions available to export",
          }),
        );
        return;
      }

      const csvContent = buildStatementCsv(allTransactions);
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      const exportDate = businessToday();

      link.href = url;
      link.download = `transactions-statement-${exportDate}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      toast.success(
        t("transactions.export.success", {
          defaultValue: "Statement exported successfully",
        }),
      );
    } catch (error) {
      console.error("Failed to export transaction statement:", error);
      toast.error(
        t("transactions.export.error", {
          defaultValue: "Failed to export statement",
        }),
      );
    } finally {
      setIsExporting(false);
    }
  };

  // Source type icon
  const getSourceIcon = (sourceType?: string | null) => {
    switch (sourceType?.toLowerCase()) {
      case "payment":
        return <CreditCard className="h-4 w-4" />;
      case "invoice":
        return <FileText className="h-4 w-4" />;
      case "expense":
        return <Receipt className="h-4 w-4" />;
      case "bill":
        return <Receipt className="h-4 w-4" />;
      default:
        return <ArrowLeftRight className="h-4 w-4" />;
    }
  };

  // Table columns
  const columns: DataTableColumn<IUnifiedTransaction>[] = [
    {
      id: "date",
      header: t("transactions.table.date", { defaultValue: "Date" }),
      cell: (row) => (
        <div className="flex items-center gap-2 text-sm">
          <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
          <span>{row.date ? formatDate(row.date) : "—"}</span>
        </div>
      ),
      width: "min-w-[130px]",
      sortKey: "date",
    },
    {
      id: "source",
      header: t("transactions.table.type", { defaultValue: "Type" }),
      cell: (row) => (
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">
            {getSourceIcon(row?.sourceType)}
          </span>
          <span className="text-sm">
            {getSourceTypeLabel(row?.sourceType)}
          </span>
        </div>
      ),
      width: "min-w-[100px]",
    },
    {
      id: "category",
      header: t("transactions.table.category", { defaultValue: "Category" }),
      cell: (row) => (
        <Badge variant="outline" className="capitalize text-xs font-normal">
          {getCategoryLabel(row?.category)}
        </Badge>
      ),
      visibility: "md",
      width: "min-w-[120px]",
    },
    {
      id: "description",
      header: t("transactions.table.description", {
        defaultValue: "Description",
      }),
      cell: (row) => (
        <div
          className="max-w-62.5 truncate text-sm"
          title={getDescription(row) || "—"}
        >
          {getDescription(row) || "—"}
        </div>
      ),
      width: "min-w-[180px]",
    },
    {
      id: "reference",
      header: t("transactions.table.reference", { defaultValue: "Reference" }),
      cell: (row) => (
        <span className="font-mono text-xs text-muted-foreground">
          {row?.reference || "—"}
        </span>
      ),
      visibility: "lg",
      width: "min-w-[140px]",
    },
    {
      id: "tenant",
      header: t("transactions.table.tenant", { defaultValue: "Tenant" }),
      cell: (row) =>
        row.tenantId ? (
          <Link
            href={`/dashboard/tenants/${row.tenantId._id}`}
            className="group inline-flex text-sm text-foreground transition-colors"
          >
            <span className="transition-colors group-hover:text-blue-600 dark:group-hover:text-blue-400">
              {row.tenantId?.firstName || "—"} {row.tenantId?.lastName || ""}
            </span>
          </Link>
        ) : (
          <span className="text-muted-foreground text-sm">—</span>
        ),
      visibility: "lg",
      width: "min-w-[140px]",
    },
    {
      id: "property",
      header: t("transactions.table.property", { defaultValue: "Property" }),
      cell: (row) =>
        row.propertyId ? (
          <Link
            href={`/dashboard/properties/${row.propertyId._id}`}
            className="group text-sm truncate max-w-30 block text-foreground transition-colors"
          >
            <span className="transition-colors group-hover:text-blue-600 dark:group-hover:text-blue-400">
              {row.propertyId?.name || "—"}
            </span>
          </Link>
        ) : (
          <span className="text-muted-foreground text-sm">—</span>
        ),
      visibility: "xl",
      width: "min-w-[120px]",
    },
    {
      id: "amount",
      header: t("transactions.table.amount", { defaultValue: "Amount" }),
      cell: (row) => (
        <span
          className={`font-semibold text-sm ${
            row.type === TransactionType.EXPENSE ||
            row.type === TransactionType.CREDIT
              ? "text-error"
              : "text-success"
          }`}
        >
          {row.type === TransactionType.EXPENSE ||
          row.type === TransactionType.CREDIT
            ? "-"
            : "+"}
          {formatCurrency(row?.amount ?? 0)}
        </span>
      ),
      align: "right",
      width: "min-w-[110px]",
    },
    {
      id: "status",
      header: t("transactions.table.status", { defaultValue: "Status" }),
      cell: (row) => (
        <Badge
          variant="outline"
          className={`capitalize text-xs ${getStatusColor(row?.status)}`}
        >
          {getStatusLabel(row?.status)}
        </Badge>
      ),
      width: "min-w-[110px]",
    },
    {
      id: "actions",
      header: "",
      cell: (row) => (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={(e) => {
            e.stopPropagation();
            handleRowClick(row);
          }}
        >
          <ExternalLink className="h-4 w-4" />
        </Button>
      ),
      width: "w-10",
      align: "center",
    },
  ];

  // Filter out tenant-only hidden columns
  const visibleColumns = isTenant
    ? columns.filter((c) => c.id !== "tenant")
    : columns;

  const hasActiveFilters =
    !!search || typeFilter !== "all" || categoryFilter !== "all";

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("nav.accounting.transactions", { defaultValue: "Transactions" })}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("transactions.header.bankSubtitle", {
              defaultValue: "Confirmed bank-level money movement only",
            })}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setSortOrder(sortOrder === "desc" ? "asc" : "desc")}
        >
          <ArrowUpDown className="h-4 w-4 me-2" />
          {sortOrder === "desc"
            ? t("transactions.sort.newestFirst", {
                defaultValue: "Newest First",
              })
            : t("transactions.sort.oldestFirst", {
                defaultValue: "Oldest First",
              })}
        </Button>
      </div>

      {/* Stats Cards */}
      <AnalyticsCardGrid className="lg:grid-cols-4">
        <AnalyticsCard
          title={t("transactions.stats.totalIncome", {
            defaultValue: "Total Income",
          })}
          value={formatCurrency(summary.totalIncome)}
          icon={TrendingUp}
          iconColor="success"
          description={t("transactions.stats.transactionCount", {
            defaultValue: "{count} transactions",
            values: { count: summary.transactionCount },
          })}
        />
        <AnalyticsCard
          title={t("transactions.stats.totalExpenses", {
            defaultValue: "Total Expenses",
          })}
          value={formatCurrency(summary.totalExpenses)}
          icon={TrendingDown}
          iconColor="error"
        />
        <AnalyticsCard
          title={t("transactions.stats.netAmount", {
            defaultValue: "Net Amount",
          })}
          value={formatCurrency(summary.netAmount)}
          icon={DollarSign}
          iconColor="primary"
        />
        <AnalyticsCard
          title={t("transactions.stats.outstanding", {
            defaultValue: "Outstanding",
          })}
          value={formatCurrency(summary.outstanding)}
          icon={AlertTriangle}
          iconColor="warning"
        />
      </AnalyticsCardGrid>

      {/* Transactions Table with Integrated Filters */}
      <Card className="gap-2">
        <CardHeader>
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-2">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-50 dark:bg-blue-900/30 rounded-lg border border-blue-100 dark:border-blue-800">
                <FileSpreadsheet className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {t("nav.accounting.transactions", {
                    defaultValue: "Transactions",
                  })}
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {t("transactions.header.bankSubtitle", {
                    defaultValue: "Confirmed bank-level money movement only",
                  })}
                </p>
              </div>
            </div>
            {/* Staff download the ledger from the server, which asks for
                Export accounting; this page used to page through the list
                and build the file itself, so reading was enough to export.
                A tenant keeps the statement they had. */}
            {isTenant ? (
              <Button
                variant="outline"
                size="sm"
                onClick={handleStatementExport}
                disabled={loading || isExporting}
              >
                {isExporting ? (
                  <Loader2 className="h-4 w-4 me-2 animate-spin" />
                ) : (
                  <Download className="h-4 w-4 me-2" />
                )}
                {t("transactions.actions.exportStatement", {
                  defaultValue: "Statement Export",
                })}
              </Button>
            ) : canExportAccounting ? (
              <ReportExportButton
                endpoint="/api/accounting/transactions"
                params={buildQueryParams(1, 100)}
                disabled={loading || transactions.length === 0}
              />
            ) : null}
          </div>

          <div className="flex flex-col gap-4 p-4 bg-gray-50/50 dark:bg-gray-800/50 rounded-lg border border-gray-200/60 dark:border-gray-700/60">
            <div className="flex flex-col lg:flex-row lg:items-center gap-3">
              <GlobalSearch
                placeholder={t("transactions.filters.searchPlaceholder", {
                  defaultValue: "Search transactions...",
                })}
                initialValue={search}
                debounceDelay={300}
                onSearch={(value) => {
                  setSearch(value);
                  setPage(1);
                }}
                isLoading={loading}
                className="flex-1 min-w-0"
                inputClassName="h-10 border-gray-200 dark:border-gray-700 focus:border-blue-400 dark:focus:border-blue-500 focus:ring-1 focus:ring-blue-400 dark:focus:ring-blue-500 bg-white dark:bg-gray-800"
                ariaLabel={t("transactions.filters.searchAriaLabel", {
                  defaultValue: "Search transactions",
                })}
              />

              <Select
                value={typeFilter}
                onValueChange={(val) => {
                  setTypeFilter(val);
                  setPage(1);
                }}
              >
                <SelectTrigger className="w-42.5 h-10 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                  <SelectValue
                    placeholder={t("transactions.filters.allTypes", {
                      defaultValue: "All Types",
                    })}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t("transactions.filters.allTypes", {
                      defaultValue: "All Types",
                    })}
                  </SelectItem>
                  <SelectItem value={TransactionType.INCOME}>
                    {getTransactionTypeLabel(TransactionType.INCOME)}
                  </SelectItem>
                  <SelectItem value={TransactionType.EXPENSE}>
                    {getTransactionTypeLabel(TransactionType.EXPENSE)}
                  </SelectItem>
                </SelectContent>
              </Select>

              <Select
                value={categoryFilter}
                onValueChange={(val) => {
                  setCategoryFilter(val);
                  setPage(1);
                }}
              >
                <SelectTrigger className="w-42.5 h-10 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                  <SelectValue
                    placeholder={t("transactions.filters.allCategories", {
                      defaultValue: "All Categories",
                    })}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t("transactions.filters.allCategories", {
                      defaultValue: "All Categories",
                    })}
                  </SelectItem>
                  <SelectItem value="rent">
                    {getCategoryLabel("rent")}
                  </SelectItem>
                  <SelectItem value="security_deposit">
                    {getCategoryLabel("security_deposit")}
                  </SelectItem>
                  <SelectItem value="utility">
                    {getCategoryLabel("utility")}
                  </SelectItem>
                  <SelectItem value="maintenance">
                    {getCategoryLabel("maintenance")}
                  </SelectItem>
                  <SelectItem value="other">
                    {getCategoryLabel("other")}
                  </SelectItem>
                </SelectContent>
              </Select>

              {hasActiveFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSearch("");
                    setTypeFilter("all");
                    setCategoryFilter("all");
                    setPage(1);
                  }}
                  className="h-10 px-3 text-gray-500 hover:text-gray-700"
                >
                  <X className="h-4 w-4 me-1" />
                  {t("transactions.filters.clear", { defaultValue: "Clear" })}
                </Button>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent>
          <DataTable
            columns={visibleColumns}
            data={transactions}
            loading={loading}
            getRowKey={(row) => row.id}
            // The list is paged and ordered by the API, by date only (its
            // amount order is unsigned, the column is signed), so the date
            // header and the newest/oldest button above are the same order;
            // the other headers stay plain.
            sort={{
              key: "date",
              direction: sortOrder,
              onSortChange: (key, direction) => {
                setSortOrder(
                  keepSorted({ key: "date", direction: sortOrder }, { key, direction }).direction,
                );
                setPage(1);
              },
            }}
            emptyState={{
              icon: (
                <ArrowLeftRight className="h-12 w-12 text-muted-foreground" />
              ),
              title: t("transactions.empty.title", {
                defaultValue: "No transactions found",
              }),
              description: hasActiveFilters
                ? t("transactions.empty.filtered", {
                    defaultValue: "Try adjusting your filters",
                  })
                : t("transactions.empty.default", {
                    defaultValue:
                      "Transactions will appear here once payments or invoices are created",
                  }),
            }}
          />
          {!loading && totalItems > 0 && (
            <GlobalPagination
              currentPage={page}
              totalPages={totalPages}
              totalItems={totalItems}
              pageSize={limit}
              onPageChange={setPage}
              onPageSizeChange={(newLimit) => {
                setLimit(newLimit);
                setPage(1);
              }}
              showingLabel={t("common.showing", { defaultValue: "Showing" })}
              previousLabel={t("common.previous", { defaultValue: "Previous" })}
              nextLabel={t("common.next", { defaultValue: "Next" })}
              pageLabel={t("common.page", { defaultValue: "Page" })}
              ofLabel={t("common.of", { defaultValue: "of" })}
              itemsPerPageLabel={t("common.perPage", {
                defaultValue: "per page",
              })}
              disabled={loading}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
