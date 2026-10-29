"use client";

import Link from "next/link";
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
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  FileText,
  MoreHorizontal,
  Eye,
  Check,
  X,
  RefreshCw,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/lib/auth-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useState, useEffect, useCallback } from "react";
import { GlobalSearch } from "@/components/ui/global-search";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { GlobalPagination } from "@/components/ui/global-pagination";
import { DataTable, DataTableColumn } from "@/components/ui/data-table";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

const mapStatusToFilter = (
  status: string,
): "pending" | "approved" | "rejected" => {
  const normalized = status?.toLowerCase?.() ?? "";

  if (
    [
      "submitted",
      "under_review",
      "screening_in_progress",
      "draft",
      "application_submitted",
    ].includes(normalized)
  ) {
    return "pending";
  }

  if (["approved"].includes(normalized)) {
    return "approved";
  }

  if (["rejected", "withdrawn", "terminated"].includes(normalized)) {
    return "rejected";
  }

  return "pending";
};

const matchesStatusFilter = (status: string, filter: string) => {
  if (filter === "all") return true;
  return mapStatusToFilter(status) === filter;
};

const formatLocation = (address?: {
  street?: string;
  city?: string;
  state?: string;
}): string | undefined => {
  if (!address) return undefined;
  const parts = [address.city, address.state].filter(Boolean);
  return parts.length ? parts.join(", ") : undefined;
};

const normalizeDate = (value?: string | Date | null): string | undefined => {
  if (!value) return undefined;
  const date = typeof value === "string" ? new Date(value) : value;
  if (!date || isNaN(date.getTime())) return undefined;
  return date.toISOString();
};

interface ApplicationRow {
  id: string;
  source: "application" | "tenant";
  applicantDetailsHref: string;
  applicantName: string;
  applicantEmail: string;
  applicantPhone?: string;
  status: string;
  submittedAt?: string;
  reviewedBy?: string;
  reviewDate?: string;
  propertyId?: string;
  propertyName?: string;
  propertyLocation?: string;
}

export default function TenantApplicationsPage() {
  const { t, formatDate } = useLocalizationContext();
  const { data: session } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [applications, setApplications] = useState<ApplicationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    search: searchParams.get("search") || "",
    status: searchParams.get("status") || "all",
    page: parseInt(searchParams.get("page") || "1"),
    limit: parseInt(searchParams.get("limit") || "12"),
  });

  const statusOptions = [
    { value: "all", label: t("tenants.applications.filters.status.all") },
    {
      value: "pending",
      label: t("tenants.applications.filters.status.pending"),
    },
    {
      value: "approved",
      label: t("tenants.applications.filters.status.approved"),
    },
    {
      value: "rejected",
      label: t("tenants.applications.filters.status.rejected"),
    },
  ];

  const mapApplicationDocuments = useCallback(
    (data: any[]): ApplicationRow[] => {
      if (!Array.isArray(data)) return [];

      return data.map((item) => {
        const personalInfo = item.personalInfo || {};
        const applicant = item.applicantId || {};
        const property = item.propertyId || {};
        const propertyAddress = property.address || {};
        const reviewer = item.reviewedBy || {};

        const applicantName = [
          personalInfo.firstName || applicant.firstName,
          personalInfo.lastName || applicant.lastName,
        ]
          .filter(Boolean)
          .join(" ");

        return {
          id: item._id,
          source: "application",
          applicantDetailsHref: `/dashboard/applications/${item._id}`,
          applicantName:
            applicantName || personalInfo.fullName || "Unknown Applicant",
          applicantEmail: personalInfo.email || applicant.email || "",
          applicantPhone: personalInfo.phone || applicant.phone,
          status: item.status || "submitted",
          submittedAt:
            normalizeDate(item.submittedAt) ||
            normalizeDate(item.applicationDate) ||
            normalizeDate(item.createdAt),
          reviewedBy:
            reviewer?.firstName || reviewer?.lastName
              ? [reviewer.firstName, reviewer.lastName]
                  .filter(Boolean)
                  .join(" ")
              : undefined,
          reviewDate: normalizeDate(item.reviewedAt || item.reviewDate),
          propertyId: property?._id,
          propertyName: property.name,
          propertyLocation: formatLocation(propertyAddress),
        };
      });
    },
    [],
  );

  const mapTenantApplications = useCallback((data: any[]): ApplicationRow[] => {
    if (!Array.isArray(data)) return [];

    return data.map((tenant) => {
      const reviewer = tenant.reviewedBy || {};
      return {
        id: tenant._id,
        source: "tenant",
        applicantDetailsHref: `/dashboard/tenants/${tenant._id}`,
        applicantName:
          [tenant.firstName, tenant.lastName].filter(Boolean).join(" ") ||
          tenant.fullName ||
          "Unknown Applicant",
        applicantEmail: tenant.email || "",
        applicantPhone: tenant.phone,
        status: tenant.tenantStatus || "application_submitted",
        submittedAt: normalizeDate(tenant.applicationDate || tenant.createdAt),
        reviewedBy:
          reviewer?.firstName || reviewer?.lastName
            ? [reviewer.firstName, reviewer.lastName].filter(Boolean).join(" ")
            : undefined,
        reviewDate: normalizeDate(tenant.lastStatusUpdate),
        propertyId: tenant.currentLeaseId?.propertyId?._id,
        propertyName: tenant.currentLeaseId?.propertyId?.name,
        propertyLocation: formatLocation(
          tenant.currentLeaseId?.propertyId?.address,
        ),
      };
    });
  }, []);

  const fetchApplications = useCallback(async () => {
    if (!session) return;

    try {
      if (!filters.search) {
        setLoading(true);
      }
      setIsSearching(true);
      setError(null);

      const params = new URLSearchParams();
      if (filters.search) {
        params.append("search", filters.search);
      }

      const response = await fetch(`/api/applications?${params.toString()}`);
      let rows: ApplicationRow[] = [];

      if (response.ok) {
        const payload = await response.json();
        rows = mapApplicationDocuments(payload.data || []);
      } else if (response.status !== 404) {
        throw new Error("Failed to fetch applications");
      }

      if (rows.length === 0) {
        const tenantParams = new URLSearchParams();
        const tenantStatusQuery =
          filters.status === "approved"
            ? "approved"
            : filters.status === "rejected"
              ? "terminated"
              : "pending";
        tenantParams.append("status", tenantStatusQuery);
        if (filters.search) {
          tenantParams.append("search", filters.search);
        }

        const tenantResponse = await fetch(
          `/api/tenants?${tenantParams.toString()}`,
        );

        if (tenantResponse.ok) {
          const tenantPayload = await tenantResponse.json();
          rows = mapTenantApplications(tenantPayload.data || []);
        }
      }

      const filteredRows = rows.filter((row) =>
        matchesStatusFilter(row.status, filters.status),
      );

      setApplications(filteredRows);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : t("tenants.applications.error.fetchFailed");
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
      setIsSearching(false);
    }
  }, [
    session,
    filters.search,
    filters.status,
    mapApplicationDocuments,
    mapTenantApplications,
    t,
  ]);

  useEffect(() => {
    fetchApplications();
  }, [fetchApplications]);

  const handleStatusChange = useCallback(
    async (application: ApplicationRow, action: "approve" | "reject") => {
      try {
        if (application.source === "application") {
          const response = await fetch(
            `/api/applications/${application.id}/${action}`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                notes: t("tenants.applications.statusChange.notes", {
                  values: { action, name: session?.user?.name || "" },
                }),
              }),
            },
          );

          if (!response.ok) {
            throw new Error(
              t("tenants.applications.error.statusChangeFailed", {
                values: { action },
              }),
            );
          }
        } else {
          const newStatus = action === "approve" ? "approved" : "terminated";
          const response = await fetch(
            `/api/tenants/${application.id}/status`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                newStatus,
                reason: t("tenants.applications.statusChange.reason", {
                  values: { action },
                }),
              }),
            },
          );

          if (!response.ok) {
            throw new Error(
              t("tenants.applications.error.statusChangeFailed", {
                values: { action },
              }),
            );
          }
        }

        toast.success(
          t("tenants.applications.toasts.statusChangeSuccess", {
            values: { action },
          }),
        );
        fetchApplications();
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : t("tenants.applications.error.statusChangeFailed", {
                values: { action },
              });
        toast.error(message);
      }
    },
    [fetchApplications, session?.user?.name, t],
  );

  const getStatusBadge = (status: string) => {
    const normalized = status?.toLowerCase?.() ?? "";

    if (normalized === "approved") {
      return (
        <Badge className="bg-green-100 text-green-800 border-green-200">
          {t("tenants.applications.status.approved")}
        </Badge>
      );
    }

    if (["rejected", "withdrawn", "terminated"].includes(normalized)) {
      return (
        <Badge className="bg-red-100 text-red-800 border-red-200">
          {t("tenants.applications.status.rejected")}
        </Badge>
      );
    }

    if (["under_review"].includes(normalized)) {
      return (
        <Badge className="bg-blue-100 text-blue-800 border-blue-200">
          {t("tenants.applications.status.underReview")}
        </Badge>
      );
    }

    return (
      <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200">
        {t("tenants.applications.status.pending")}
      </Badge>
    );
  };

  if (!session) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">
            {t("tenants.applications.error.accessDenied")}
          </h2>
          <p className="text-gray-600">
            {t("tenants.applications.error.signInRequired")}
          </p>
        </div>
      </div>
    );
  }

  const paginationTotal = applications.length;
  const totalPages = Math.max(1, Math.ceil(paginationTotal / filters.limit));
  const currentPage = Math.min(filters.page, totalPages);
  const rangeFrom =
    paginationTotal === 0 ? 0 : (currentPage - 1) * filters.limit + 1;
  const rangeTo =
    paginationTotal === 0
      ? 0
      : Math.min(currentPage * filters.limit, paginationTotal);

  const paginatedApplications = applications.slice(
    (currentPage - 1) * filters.limit,
    currentPage * filters.limit,
  );

  const hasActiveFilters = !!(filters.search || filters.status !== "all");

  const handleSearch = (search: string) => {
    setFilters((prev) => ({ ...prev, search, page: 1 }));
  };

  const handleStatusFilterChange = (status: string) => {
    setFilters((prev) => ({ ...prev, status, page: 1 }));
  };

  const handlePageChange = (page: number) => {
    setFilters((prev) => ({ ...prev, page }));
  };

  const handlePageSizeChange = (size: number) => {
    const params = new URLSearchParams(Array.from(searchParams.entries()));
    params.set("limit", size.toString());
    params.set("page", "1");
    if (filters.search) {
      params.set("search", filters.search);
    } else {
      params.delete("search");
    }
    if (filters.status !== "all") {
      params.set("status", filters.status);
    } else {
      params.delete("status");
    }
    router.push(`/dashboard/tenants/applications?${params.toString()}`);
    setFilters((prev) => ({ ...prev, limit: size, page: 1 }));
  };

  const applicationColumns: DataTableColumn<ApplicationRow>[] = [
    {
      id: "applicant",
      header: t("tenants.applications.table.applicant"),
      className: "min-w-[220px]",
      cell: (application) => (
        <Link
          href={application.applicantDetailsHref}
          className="group inline-flex flex-col space-y-1 text-foreground transition-colors"
        >
          <div className="font-medium text-gray-900 dark:text-gray-100 transition-colors group-hover:text-blue-600 dark:group-hover:text-blue-400">
            {application.applicantName}
          </div>
          <div className="text-sm text-gray-600 dark:text-gray-400">
            {application.applicantEmail}
          </div>
          {application.applicantPhone && (
            <div className="text-xs text-gray-500 dark:text-gray-500">
              {application.applicantPhone}
            </div>
          )}
        </Link>
      ),
    },
    {
      id: "property",
      header: t("tenants.applications.table.property"),
      visibility: "md",
      cell: (application) => {
        const propertyContent = (
          <>
            <div className="font-medium text-gray-900 dark:text-gray-100 transition-colors group-hover:text-blue-600 dark:group-hover:text-blue-400">
              {application.propertyName ||
                t("tenants.applications.table.notSpecified")}
            </div>
            <div className="text-sm text-gray-600 dark:text-gray-400">
              {application.propertyLocation ||
                t("tenants.applications.table.notAvailable")}
            </div>
          </>
        );

        if (!application.propertyId) {
          return <div className="flex flex-col space-y-1">{propertyContent}</div>;
        }

        return (
          <Link
            href={`/dashboard/properties/${application.propertyId}`}
            className="group inline-flex flex-col space-y-1 text-foreground transition-colors"
          >
            {propertyContent}
          </Link>
        );
      },
    },
    {
      id: "status",
      header: t("tenants.applications.table.status"),
      cell: (application) => getStatusBadge(application.status),
    },
    {
      id: "submittedAt",
      header: t("tenants.applications.table.applicationDate"),
      visibility: "lg",
      cell: (application) =>
        application.submittedAt
          ? formatDate(application.submittedAt)
          : t("tenants.applications.table.notAvailable"),
    },
    {
      id: "reviewedBy",
      header: t("tenants.applications.table.reviewedBy"),
      visibility: "xl",
      cell: (application) =>
        application.reviewedBy ? (
          <div className="flex flex-col space-y-1">
            <div className="text-sm text-gray-900 dark:text-gray-100">
              {application.reviewedBy}
            </div>
            <div className="text-xs text-gray-600 dark:text-gray-400">
              {application.reviewDate
                ? formatDate(application.reviewDate)
                : t("tenants.applications.table.notAvailable")}
            </div>
          </div>
        ) : (
          <span className="text-gray-400">
            {t("tenants.applications.table.notReviewed")}
          </span>
        ),
    },
    {
      id: "actions",
      header: t("tenants.applications.table.actions"),
      align: "right",
      cell: (application) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="h-8 w-8 p-0 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              <MoreHorizontal className="h-4 w-4 text-gray-500 dark:text-gray-400" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>
              {t("tenants.applications.table.actions")}
            </DropdownMenuLabel>
            <DropdownMenuItem asChild>
              <Link
                href={
                  application.source === "application"
                    ? `/dashboard/applications/${application.id}`
                    : `/dashboard/tenants/${application.id}`
                }
              >
                <Eye className="h-4 w-4 me-2" />
                {t("tenants.applications.actions.viewDetails")}
              </Link>
            </DropdownMenuItem>
            {mapStatusToFilter(application.status) === "pending" && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => handleStatusChange(application, "approve")}
                >
                  <Check className="h-4 w-4 me-2" />
                  {t("tenants.applications.actions.approve")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => handleStatusChange(application, "reject")}
                >
                  <X className="h-4 w-4 me-2" />
                  {t("tenants.applications.actions.reject")}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("tenants.applications.header.title")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("tenants.applications.header.subtitle")}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchApplications}
          disabled={loading}
          className="w-full sm:w-auto"
        >
          <RefreshCw
            className={`h-4 w-4 ${loading ? "animate-spin" : ""} sm:me-2`}
          />
          <span className="hidden sm:inline">
            {t("tenants.applications.actions.refresh")}
          </span>
          <span className="sm:hidden">
            {t("tenants.applications.actions.refresh")}
          </span>
        </Button>
      </div>

      <Card className="gap-2">
        <CardHeader>
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-2">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-50 dark:bg-blue-900/30 rounded-lg border border-blue-100 dark:border-blue-800">
                <FileText className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {t("tenants.applications.list.title", {
                    values: { count: paginationTotal },
                  })}
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {t("common.showing", { defaultValue: "Showing" })} {rangeFrom}
                  -{rangeTo} {t("common.of", { defaultValue: "of" })}{" "}
                  {paginationTotal}
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-col lg:flex-row lg:items-center gap-4 p-4 bg-gray-50/50 dark:bg-gray-800/50 rounded-lg border border-gray-200/60 dark:border-gray-700/60">
            <div className="flex-1 min-w-0">
              <GlobalSearch
                placeholder={t(
                  "tenants.applications.filters.searchPlaceholder",
                )}
                initialValue={filters.search}
                debounceDelay={300}
                onSearch={handleSearch}
                isLoading={isSearching}
                className="w-full"
                ariaLabel={t("tenants.applications.filters.searchPlaceholder")}
              />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Select
                value={filters.status}
                onValueChange={handleStatusFilterChange}
              >
                <SelectTrigger className="w-[180px] h-10 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                  <SelectValue
                    placeholder={t(
                      "tenants.applications.filters.statusPlaceholder",
                    )}
                  />
                </SelectTrigger>
                <SelectContent>
                  {statusOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {hasActiveFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setFilters((prev) => ({
                      ...prev,
                      search: "",
                      status: "all",
                      page: 1,
                    }))
                  }
                  className="h-10 px-3 text-gray-500 hover:text-gray-700"
                >
                  <X className="h-4 w-4 me-1" />
                  {t("properties.filters.clear", { defaultValue: "Clear" })}
                </Button>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent>
          <DataTable<ApplicationRow>
            columns={applicationColumns}
            data={paginatedApplications}
            loading={loading}
            error={
              error
                ? {
                    message: error,
                    icon: <AlertCircle className="h-8 w-8 text-red-500" />,
                    onRetry: fetchApplications,
                    retryLabel: t("errors.ui.tryAgain", { defaultValue: "Try again" }),
                  }
                : null
            }
            getRowKey={(application) => application.id}
            emptyState={{
              icon: <FileText className="h-8 w-8 text-gray-400" />,
              title: t("tenants.applications.empty.title"),
              description:
                filters.search || filters.status !== "all"
                  ? t("tenants.applications.empty.noMatches")
                  : t("tenants.applications.empty.noApplications"),
            }}
          />

          {paginationTotal > 0 && (
            <GlobalPagination
              currentPage={currentPage}
              totalPages={totalPages}
              totalItems={paginationTotal}
              pageSize={filters.limit}
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
    </div>
  );
}
