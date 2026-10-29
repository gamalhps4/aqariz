"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useSession } from "@/lib/auth-client";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  AnalyticsCard,
  AnalyticsCardGrid,
} from "@/components/analytics/AnalyticsCard";
import DocumentManagement, {
  TenantDocument,
  TenantLeaseSummary,
  normalizeTenantDocument,
} from "@/components/tenant/DocumentManagement";
import TenantDocumentUploadDialog from "@/components/tenant/TenantDocumentUploadDialog";
import {
  RefreshCw,
  Upload,
  Loader2,
  FileText,
  X,
  Search,
  Folder,
} from "lucide-react";
import { showSimpleError, showSimpleSuccess } from "@/lib/toast-notifications";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { GlobalSearch } from "@/components/ui/global-search";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { useAuthorization } from "@/hooks/useAuthorization";

export default function LeasesDocumentsPage() {
  const { t } = useLocalizationContext();
  const { data: session, status } = useSession();
  const { isTenant } = useAuthorization();
  const [documents, setDocuments] = useState<TenantDocument[]>([]);
  const [leases, setLeases] = useState<TenantLeaseSummary[]>([]);
  const [documentsLoading, setDocumentsLoading] = useState(true);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [propertyFilter, setPropertyFilter] = useState("all");
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    if (status === "loading") {
      return;
    }

    if (!session?.user) {
      redirect("/auth/signin");
      return;
    }

    if (!isTenant) {
      redirect("/dashboard/leases");
    }
  }, [session, status, isTenant]);

  const fetchLeases = useCallback(async () => {
    try {
      const response = await fetch("/api/tenant/dashboard");
      const payload = await response.json();

      if (!response.ok || !payload?.success) {
        throw new Error(
          payload?.message ??
            t("leases.documents.toasts.fetchLeaseDetailsError", {
              defaultValue: "Failed to load lease details",
            })
        );
      }

      setLeases(payload?.data?.allLeases ?? []);
    } catch (error) {
      showSimpleError(
        t("leases.documents.toasts.loadErrorTitle", { defaultValue: "Load Error" }),
        error instanceof Error
          ? error.message
          : t("leases.documents.toasts.fetchLeaseDetailsError", {
              defaultValue: "Failed to load lease details",
            })
      );
    }
  }, [t]);

  const fetchDocuments = useCallback(async () => {
    try {
      setDocumentsLoading(true);

      const response = await fetch("/api/tenant/documents");
      const payload = await response.json();

      if (!response.ok || !payload?.success) {
        throw new Error(
          payload?.message ??
            t("leases.documents.toasts.fetchDocumentsError", {
              defaultValue: "Failed to load documents",
            })
        );
      }

      const normalized: TenantDocument[] = (payload?.data?.documents ?? []).map(
        normalizeTenantDocument
      );

      setDocuments(normalized);
      return true;
    } catch (error) {
      showSimpleError(
        t("leases.documents.toasts.loadErrorTitle", { defaultValue: "Load Error" }),
        error instanceof Error
          ? error.message
          : t("leases.documents.toasts.fetchDocumentsError", {
              defaultValue: "Failed to load documents",
            })
      );
      return false;
    } finally {
      setDocumentsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (status !== "authenticated" || !session?.user || !isTenant) {
      return;
    }

    void fetchLeases();
    void fetchDocuments();
  }, [status, session?.user, isTenant, fetchLeases, fetchDocuments]);

  const handleRefresh = useCallback(async () => {
    const success = await fetchDocuments();
    if (success) {
      showSimpleSuccess(
        t("leases.documents.toasts.updatedTitle", { defaultValue: "Updated" }),
        t("leases.documents.toasts.updatedDescription", {
          defaultValue: "Documents updated",
        })
      );
    }
  }, [fetchDocuments, t]);

  const handleOpenUpload = useCallback(() => {
    setUploadDialogOpen(true);
  }, []);

  const handleUploadComplete = useCallback(
    async () => fetchDocuments(),
    [fetchDocuments]
  );

  const typeOptions = Array.from(
    new Set(
      documents
        .map((d) => (d.type ?? "").toString())
        .filter((v) => v?.trim().length > 0)
    )
  ).sort();
  const categoryOptions = Array.from(
    new Set(
      documents
        .map((d) => (d.category ?? "").toString())
        .filter((v) => v?.trim().length > 0)
    )
  ).sort();
  const propertyOptions = Array.from(
    new Set(
      documents
        .map((d) => (d.propertyName ?? "").toString())
        .filter((v) => v?.trim().length > 0)
    )
  ).sort();

  const filteredDocuments = documents.filter((document) => {
    const matchesSearch = [
      document.name,
      document.description ?? "",
      document.propertyName ?? "",
    ]
      .filter(Boolean)
      .map((v) => String(v).toLowerCase())
      .some((v) => v.includes(searchTerm.toLowerCase()));

    const matchesType = typeFilter === "all" || document.type === typeFilter;
    const matchesCategory =
      categoryFilter === "all" || document.category === categoryFilter;
    const matchesProperty =
      propertyFilter === "all" || document.propertyName === propertyFilter;

    return matchesSearch && matchesType && matchesCategory && matchesProperty;
  });

  const totalSizeBytes = documents.reduce(
    (acc, document) => acc + (document.fileSize ?? 0),
    0
  );

  const formatFileSize = (bytes: number) => {
    if (!bytes || bytes <= 0) {
      return "0 Bytes";
    }

    const units = ["Bytes", "KB", "MB", "GB", "TB"] as const;
    const index = Math.min(
      Math.floor(Math.log(bytes) / Math.log(1024)),
      units.length - 1
    );
    const size = bytes / Math.pow(1024, index);
    return `${size.toFixed(size >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
  };

  const recentUploads = documents.filter((document) => {
    if (!document.uploadedAt) return false;
    const uploadedDate = new Date(document.uploadedAt);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    return uploadedDate >= cutoff;
  }).length;

  const handleSearch = useCallback((value: string) => {
    setIsSearching(true);
    setSearchTerm(value);
    setTimeout(() => setIsSearching(false), 100);
  }, []);

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-24 w-24 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-50 dark:bg-blue-900/30 rounded-lg border border-blue-100 dark:border-blue-800">
            <FileText className="h-5 w-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {t("leases.documents.header.title", { defaultValue: "Documents" })}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t("leases.documents.header.subtitle", {
                defaultValue: "Access and manage your lease-related documents",
              })}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={handleRefresh}
            disabled={documentsLoading}
          >
            {documentsLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            {t("leases.actions.refresh", { defaultValue: "Refresh" })}
          </Button>
          <Button size="sm" className="gap-2" onClick={handleOpenUpload}>
            <Upload className="h-4 w-4" />
            {t("leases.documents.actions.uploadDocument", {
              defaultValue: "Upload Document",
            })}
          </Button>
        </div>
      </div>

      <AnalyticsCardGrid className="md:grid-cols-2 lg:grid-cols-4">
        <AnalyticsCard
          title={t("leases.documents.summary.totalDocuments", {
            defaultValue: "Total Documents",
          })}
          value={documentsLoading ? "..." : documents.length}
          description={t("leases.documents.summary.totalSize", {
            defaultValue: "{size} total size",
            values: { size: formatFileSize(totalSizeBytes) },
          })}
          icon={FileText}
          iconColor="primary"
        />
        <AnalyticsCard
          title={t("leases.documents.summary.filteredResults", {
            defaultValue: "Filtered Results",
          })}
          value={documentsLoading ? "..." : filteredDocuments.length}
          description={t("leases.documents.summary.matchingDocuments", {
            defaultValue: "Matching your current filters",
          })}
          icon={Search}
          iconColor="info"
        />
        <AnalyticsCard
          title={t("leases.documents.summary.categories", {
            defaultValue: "Categories",
          })}
          value={documentsLoading ? "..." : categoryOptions.length}
          description={t("leases.documents.summary.availableCategories", {
            defaultValue: "Available document categories",
          })}
          icon={Folder}
          iconColor="warning"
        />
        <AnalyticsCard
          title={t("leases.documents.summary.recentUploads", {
            defaultValue: "Recent Uploads",
          })}
          value={documentsLoading ? "..." : recentUploads}
          description={t("leases.documents.summary.last30Days", {
            defaultValue: "Last 30 days",
          })}
          icon={Upload}
          iconColor="success"
        />
      </AnalyticsCardGrid>

      <Card className="gap-2">
        <CardHeader>
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-2">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-50 dark:bg-blue-900/30 rounded-lg border border-blue-100 dark:border-blue-800">
                <FileText className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {t("leases.documents.header.title", { defaultValue: "Documents" })}
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {t("leases.documents.header.subtitle", {
                    defaultValue: "Access and manage your lease-related documents",
                  })}
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-col lg:flex-row lg:items-center gap-4 p-4 bg-gray-50/50 dark:bg-gray-800/50 rounded-lg border border-gray-200/60 dark:border-gray-700/60">
            <GlobalSearch
              placeholder={t("leases.documents.filters.searchPlaceholder", {
                defaultValue: "Search documents...",
              })}
              initialValue={searchTerm}
              debounceDelay={300}
              onSearch={handleSearch}
              isLoading={isSearching}
              className="flex-1 min-w-0"
              ariaLabel={t("leases.documents.filters.searchAriaLabel", {
                defaultValue: "Search documents",
              })}
            />

            <div className="flex flex-wrap items-center gap-3">
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="w-[160px] h-10 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                  <SelectValue
                    placeholder={t("leases.documents.filters.categoryPlaceholder", {
                      defaultValue: "Category",
                    })}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t("leases.documents.filters.allCategories", {
                      defaultValue: "All Categories",
                    })}
                  </SelectItem>
                  {categoryOptions.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="w-[160px] h-10 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                  <SelectValue
                    placeholder={t("leases.documents.filters.typePlaceholder", {
                      defaultValue: "Type",
                    })}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t("leases.documents.filters.allTypes", {
                      defaultValue: "All Types",
                    })}
                  </SelectItem>
                  {typeOptions.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={propertyFilter} onValueChange={setPropertyFilter}>
                <SelectTrigger className="w-[160px] h-10 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                  <SelectValue
                    placeholder={t("leases.documents.filters.propertyPlaceholder", {
                      defaultValue: "Property",
                    })}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t("leases.documents.filters.allProperties", {
                      defaultValue: "All Properties",
                    })}
                  </SelectItem>
                  {propertyOptions.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {(searchTerm ||
                categoryFilter !== "all" ||
                typeFilter !== "all" ||
                propertyFilter !== "all") && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSearchTerm("");
                    setCategoryFilter("all");
                    setTypeFilter("all");
                    setPropertyFilter("all");
                  }}
                  className="h-10 px-3 text-gray-500 hover:text-gray-700"
                >
                  <X className="h-4 w-4 me-1" />
                  {t("leases.filters.clear", { defaultValue: "Clear" })}
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <DocumentManagement
            documents={filteredDocuments}
            leases={leases}
            loading={documentsLoading}
            showFilters={false}
            showSummary={false}
          />
        </CardContent>
      </Card>

      <TenantDocumentUploadDialog
        open={uploadDialogOpen}
        onOpenChange={setUploadDialogOpen}
        onUploadComplete={async (_uploadedDocuments, summary) => {
          const refreshed = await handleUploadComplete();
          if (!summary) {
            return;
          }
          const message =
            summary?.message ??
            (summary.total === 1
              ? t("leases.documents.toasts.uploadSummarySingular", {
                  defaultValue: "Uploaded {uploaded} of {total} document",
                  values: {
                    uploaded: summary.uploaded,
                    total: summary.total,
                  },
                })
              : t("leases.documents.toasts.uploadSummaryPlural", {
                  defaultValue: "Uploaded {uploaded} of {total} documents",
                  values: {
                    uploaded: summary.uploaded,
                    total: summary.total,
                  },
                }));
          if (refreshed !== false) {
            showSimpleSuccess(
              t("leases.documents.toasts.uploadCompleteTitle", {
                defaultValue: "Upload Complete",
              }),
              message
            );
          }
        }}
      />
    </div>
  );
}
