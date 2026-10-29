"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Wallet,
  Plus,
  DollarSign,
  TrendingDown,
  Calendar,
  Trash2,
  Edit,
  Eye,
  MoreHorizontal,
  Receipt,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AnalyticsCard,
  AnalyticsCardGrid,
} from "@/components/analytics/AnalyticsCard";
import { DataTable, DataTableColumn } from "@/components/ui/data-table";
import type { SortDirection } from "@/lib/table-sort";
import GlobalSearch from "@/components/ui/global-search";
import { GlobalPagination } from "@/components/ui/global-pagination";
import { ExpenseCategory, ExpenseStatus } from "@/types";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { ReportExportButton } from "@/components/reports/export-button";
import { useAuthorization } from "@/hooks/useAuthorization";
import { hasAnyPermission } from "@/lib/permissions-manager";
import { EXPENSE_CREATE_PERMISSIONS } from "@/lib/finance-permissions";

interface ExpenseItem {
  _id: string;
  expenseNumber: string;
  propertyId?: {
    _id: string;
    name: string;
    address?: {
      street?: string;
      city?: string;
      state?: string;
      zipCode?: string;
    };
  };
  category: string;
  description: string;
  amount: number;
  date: string;
  status: string;
  paymentMethod?: string;
  referenceNumber?: string;
  taxDeductible: boolean;
  notes?: string;
  createdBy?: { firstName: string; lastName: string };
  createdAt: string;
}

interface ExpenseSummary {
  totalExpenses: number;
  totalPaid: number;
  totalPending: number;
  monthToDate: number;
  yearToDate: number;
  topCategory: string;
  count: number;
}

export default function ExpensesPage() {
  const router = useRouter();
  const { t, formatCurrency, formatDate } = useLocalizationContext();
  const { permissions } = useAuthorization();
  const canAddExpenses = hasAnyPermission(permissions, EXPENSE_CREATE_PERMISSIONS);
  const canExportExpenses = hasAnyPermission(permissions, [
    "expense_export",
    "financial_management",
    "data_export",
  ]);

  const [expenses, setExpenses] = useState<ExpenseItem[]>([]);
  const [summary, setSummary] = useState<ExpenseSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(12);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  // A header's order, which the API applies to the whole list rather than
  // the page on screen; no key: its own, latest date first.
  const [sort, setSort] = useState<{ key: string | null; direction: SortDirection }>({
    key: null,
    direction: "asc",
  });

  const fetchExpenses = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", page.toString());
      params.set("limit", limit.toString());
      params.set("includeSummary", "true");
      if (search) params.set("search", search);
      if (categoryFilter !== "all") params.set("category", categoryFilter);
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (sort.key) {
        params.set("sortBy", sort.key);
        params.set("sortOrder", sort.direction);
      }

      const res = await fetch(`/api/accounting/expenses?${params}`);
      const data = await res.json();

      if (data?.success) {
        setExpenses(data?.data?.expenses || []);
        setSummary(data?.data?.summary || null);
        setTotalPages(data.pagination?.totalPages || 1);
        setTotalItems(data.pagination?.total || 0);
      }
    } catch (error) {
      console.error("Failed to fetch expenses:", error);
    } finally {
      setLoading(false);
    }
  }, [page, limit, search, categoryFilter, statusFilter, sort]);

  useEffect(() => {
    fetchExpenses();
  }, [fetchExpenses]);

  const handleDelete = async (id: string) => {
    if (
      !confirm(
        t("expenses.actions.confirmDelete", {
          defaultValue: "Are you sure you want to delete this expense?",
        }),
      )
    )
      return;
    try {
      const res = await fetch(`/api/accounting/expenses/${id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        fetchExpenses();
      }
    } catch (error) {
      console.error("Failed to delete expense:", error);
    }
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      paid: "bg-success/10 text-success border-success/20",
      approved: "bg-info/10 text-info border-info/20",
      pending: "bg-warning/10 text-warning border-warning/20",
      cancelled: "bg-muted text-muted-foreground border-muted",
    };
    return colors[status] || "bg-muted text-muted-foreground border-muted";
  };

  const getCategoryLabel = (category?: string | null) => {
    const normalizedCategory = (category ?? "unknown").toLowerCase();
    return t(`expenses.categories.${normalizedCategory}`, {
      defaultValue: normalizedCategory.replace(/_/g, " "),
    });
  };

  const getStatusLabel = (status?: string | null) => {
    const normalizedStatus = (status ?? "unknown").toLowerCase();
    return t(`expenses.status.${normalizedStatus}`, {
      defaultValue: normalizedStatus.replace(/_/g, " "),
    });
  };

  const formatPropertyAddress = (property?: ExpenseItem["propertyId"]) => {
    if (!property?.address) return "";
    const { street, city, state, zipCode } = property.address;
    return [street, city, state, zipCode].filter(Boolean).join(", ");
  };

  const columns: DataTableColumn<ExpenseItem>[] = [
    {
      id: "date",
      sortKey: "date",
      header: t("expenses.table.date", { defaultValue: "Date" }),
      cell: (row) => (
        <div className="flex items-center gap-2 text-sm">
          <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
          <span>{formatDate(row.date)}</span>
        </div>
      ),
      width: "min-w-[130px]",
    },
    {
      id: "expenseNumber",
      sortKey: "expenseNumber",
      header: t("expenses.table.reference", { defaultValue: "Reference" }),
      cell: (row) => (
        <Link
          href={`/dashboard/accounting/expenses/${row._id}`}
          className="group inline-flex font-mono text-xs text-muted-foreground transition-colors hover:text-blue-600 dark:hover:text-blue-400"
        >
          {row.expenseNumber}
        </Link>
      ),
      visibility: "lg",
      width: "min-w-[140px]",
    },
    {
      id: "category",
      sortKey: "category",
      header: t("expenses.table.category", { defaultValue: "Category" }),
      cell: (row) => (
        <Badge variant="outline" className="capitalize text-xs font-normal">
          {getCategoryLabel(row.category)}
        </Badge>
      ),
      width: "min-w-[130px]",
    },
    {
      id: "description",
      sortKey: "description",
      header: t("expenses.table.description", {
        defaultValue: "Description",
      }),
      cell: (row) => (
        <div className="max-w-55 truncate text-sm" title={row.description}>
          {row.description}
        </div>
      ),
      width: "min-w-[180px]",
    },
    {
      id: "property",
      header: t("expenses.table.property", { defaultValue: "Property" }),
      cell: (row) =>
        row.propertyId ? (
          <Link
            href={`/dashboard/properties/${row.propertyId._id}`}
            className="group inline-flex flex-col max-w-42 text-foreground transition-colors"
          >
            <span className="text-sm truncate block transition-colors group-hover:text-blue-600 dark:group-hover:text-blue-400">
              {row.propertyId?.name || "—"}
            </span>
            {formatPropertyAddress(row.propertyId) && (
              <span className="text-xs text-muted-foreground truncate block">
                {formatPropertyAddress(row.propertyId)}
              </span>
            )}
          </Link>
        ) : (
          <span className="text-muted-foreground text-sm">—</span>
        ),
      visibility: "md",
      width: "min-w-[120px]",
    },
    {
      id: "amount",
      sortKey: "amount",
      header: t("expenses.table.amount", { defaultValue: "Amount" }),
      cell: (row) => (
        <span className="font-semibold text-sm text-error">
          -{formatCurrency(row.amount)}
        </span>
      ),
      align: "right",
      width: "min-w-[110px]",
    },
    {
      id: "status",
      sortKey: "status",
      header: t("expenses.table.status", { defaultValue: "Status" }),
      cell: (row) => (
        <Badge
          variant="outline"
          className={`capitalize text-xs ${getStatusColor(row.status)}`}
        >
          {getStatusLabel(row.status)}
        </Badge>
      ),
      width: "min-w-[100px]",
    },
    {
      id: "actions",
      header: "",
      cell: (row) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() =>
                router.push(`/dashboard/accounting/expenses/${row._id}`)
              }
            >
              <Eye className="h-4 w-4 me-2" />
              {t("expenses.actions.view", { defaultValue: "View" })}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                router.push(`/dashboard/accounting/expenses/${row._id}/edit`)
              }
            >
              <Edit className="h-4 w-4 me-2" />
              {t("expenses.actions.edit", { defaultValue: "Edit" })}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => handleDelete(row._id)}
              className="text-destructive"
            >
              <Trash2 className="h-4 w-4 me-2" />
              {t("expenses.actions.delete", { defaultValue: "Delete" })}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
      width: "w-10",
      align: "center",
    },
  ];

  const hasActiveFilters =
    !!search || categoryFilter !== "all" || statusFilter !== "all";

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("nav.accounting.expenses", { defaultValue: "Expenses" })}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("expenses.header.subtitle", {
              defaultValue: "Track and manage property expenses",
            })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* The list as filtered, as a file — Export expenses is its own
              right, as the server holds it. */}
          {canExportExpenses && (
            <ReportExportButton
              endpoint="/api/accounting/expenses"
              params={
                new URLSearchParams({
                  ...(search ? { search } : {}),
                  ...(categoryFilter !== "all" ? { category: categoryFilter } : {}),
                  ...(statusFilter !== "all" ? { status: statusFilter } : {}),
                })
              }
              disabled={expenses.length === 0}
            />
          )}
          {canAddExpenses && (
            <Button
              size="sm"
              onClick={() => router.push("/dashboard/accounting/expenses/new")}
            >
              <Plus className="h-4 w-4" />
              {t("expenses.actions.addExpense", { defaultValue: "Add Expense" })}
            </Button>
          )}
        </div>
      </div>

      {/* Stats Cards */}
      <AnalyticsCardGrid className="lg:grid-cols-4">
        <AnalyticsCard
          title={t("expenses.stats.monthToDate", {
            defaultValue: "Month to Date",
          })}
          value={formatCurrency(summary?.monthToDate || 0)}
          icon={TrendingDown}
          iconColor="error"
        />
        <AnalyticsCard
          title={t("expenses.stats.yearToDate", {
            defaultValue: "Year to Date",
          })}
          value={formatCurrency(summary?.yearToDate || 0)}
          icon={DollarSign}
          iconColor="warning"
        />
        <AnalyticsCard
          title={t("expenses.stats.pending", { defaultValue: "Pending" })}
          value={formatCurrency(summary?.totalPending || 0)}
          icon={Wallet}
          iconColor="info"
        />
        <AnalyticsCard
          title={t("expenses.stats.topCategory", {
            defaultValue: "Top Category",
          })}
          value={getCategoryLabel(summary?.topCategory || "none")}
          icon={Receipt}
          iconColor="primary"
          description={t("expenses.stats.totalExpensesCount", {
            defaultValue: "{count} total expenses",
            values: { count: summary?.count || 0 },
          })}
        />
      </AnalyticsCardGrid>

      {/* Expense List with Integrated Filters */}
      <Card className="gap-2">
        <CardHeader>
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-2">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-50 dark:bg-blue-900/30 rounded-lg border border-blue-100 dark:border-blue-800">
                <Receipt className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {t("nav.accounting.expenses", { defaultValue: "Expenses" })}
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {t("expenses.header.subtitle", {
                    defaultValue: "Track and manage property expenses",
                  })}
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-4 p-4 bg-gray-50/50 dark:bg-gray-800/50 rounded-lg border border-gray-200/60 dark:border-gray-700/60">
            <div className="flex flex-col lg:flex-row lg:items-center gap-3">
              <GlobalSearch
                placeholder={t("expenses.filters.searchPlaceholder", {
                  defaultValue: "Search expenses...",
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
                ariaLabel={t("expenses.filters.searchAriaLabel", {
                  defaultValue: "Search expenses",
                })}
              />

              <Select
                value={categoryFilter}
                onValueChange={(val) => {
                  setCategoryFilter(val);
                  setPage(1);
                }}
              >
                <SelectTrigger className="w-42.5 h-10 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                  <SelectValue
                    placeholder={t("expenses.filters.allCategories", {
                      defaultValue: "All Categories",
                    })}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t("expenses.filters.allCategories", {
                      defaultValue: "All Categories",
                    })}
                  </SelectItem>
                  {Object.values(ExpenseCategory).map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      <span className="capitalize">
                        {getCategoryLabel(cat)}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={statusFilter}
                onValueChange={(val) => {
                  setStatusFilter(val);
                  setPage(1);
                }}
              >
                <SelectTrigger className="w-42.5 h-10 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                  <SelectValue
                    placeholder={t("expenses.filters.allStatus", {
                      defaultValue: "All Status",
                    })}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t("expenses.filters.allStatus", {
                      defaultValue: "All Status",
                    })}
                  </SelectItem>
                  {Object.values(ExpenseStatus).map((s) => (
                    <SelectItem key={s} value={s}>
                      <span className="capitalize">{getStatusLabel(s)}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {hasActiveFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSearch("");
                    setCategoryFilter("all");
                    setStatusFilter("all");
                    setPage(1);
                  }}
                  className="h-10 px-3 text-gray-500 hover:text-gray-700"
                >
                  <X className="h-4 w-4 me-1" />
                  {t("expenses.filters.clear", { defaultValue: "Clear" })}
                </Button>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent>
          <DataTable
            columns={columns}
            data={expenses}
            loading={loading}
            getRowKey={(row) => row._id}
            // Sorted by the API across every page. Category and status go by
            // their stored values, so they group alike rows; the building has
            // no order there and its header stays plain.
            sort={{
              key: sort.key,
              direction: sort.direction,
              onSortChange: (key, direction) => {
                setSort({ key, direction });
                setPage(1);
              },
            }}
            emptyState={{
              icon: <Wallet className="h-12 w-12 text-muted-foreground" />,
              title: t("expenses.empty.title", {
                defaultValue: "No expenses found",
              }),
              description: hasActiveFilters
                ? t("expenses.empty.filtered", {
                    defaultValue: "Try adjusting your filters",
                  })
                : t("expenses.empty.default", {
                    defaultValue: "Add your first expense to start tracking",
                  }),
              action: (
                <Button
                  onClick={() =>
                    router.push("/dashboard/accounting/expenses/new")
                  }
                  size="sm"
                >
                  <Plus className="h-4 w-4 me-2" />
                  {t("expenses.actions.addExpense", {
                    defaultValue: "Add Expense",
                  })}
                </Button>
              ),
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
