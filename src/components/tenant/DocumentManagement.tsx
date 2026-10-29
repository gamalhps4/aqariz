/**
 * PropertyPro - Document Management Component
 * Comprehensive document management for lease agreements and related files
 */

"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  FileText,
  Download,
  Eye,
  MoreHorizontal,
  Search,
  Calendar,
  Building2,
  Upload,
  Folder,
  File,
  FileIcon,
  Image as ImageIcon,
  RefreshCw,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { GlobalPagination } from "@/components/ui/global-pagination";
import { SortableTableHead, useTableSort } from "@/components/ui/sortable-table";
import {
  LocalizationContextType,
  useLocalizationContext,
} from "@/components/providers/LocalizationProvider";

export interface TenantDocument {
  _id: string;
  name: string;
  description?: string;
  type?: string;
  category?: string;
  fileUrl?: string;
  fileSize?: number;
  mimeType?: string;
  uploadedAt?: string;
  updatedAt?: string;
  leaseId?: string;
  propertyId?: string;
  propertyName?: string;
  tags?: string[];
  status?: string;
}

export interface TenantLeaseSummary {
  _id: string;
  propertyId?: {
    _id: string;
    name?: string;
  };
  propertyName?: string;
}

type RawTenantDocument = {
  _id?: string;
  id?: string;
  name?: string;
  originalName?: string;
  description?: string;
  metadata?: {
    description?: string;
    type?: string;
    category?: string;
  } & Record<string, unknown>;
  type?: string;
  category?: string;
  fileUrl?: string;
  fileSize?: number;
  mimeType?: string;
  uploadedAt?: string;
  createdAt?: string;
  updatedAt?: string;
  versions?: Array<{
    fileUrl?: string;
    fileSize?: number;
    mimeType?: string;
    uploadedAt?: string;
  }>;
  leaseId?: string | { _id?: string };
  propertyId?: string | { _id?: string; name?: string };
  propertyName?: string;
  tags?: string[];
  status?: string;
};

export const normalizeTenantDocument = (
  input: RawTenantDocument | null | undefined
): TenantDocument => {
  const doc = (input ?? {}) as RawTenantDocument;

  const latestVersion = Array.isArray(doc.versions)
    ? doc.versions[doc.versions.length - 1]
    : undefined;

  const leaseId =
    typeof doc.leaseId === "object" ? doc.leaseId?._id : doc?.leaseId;

  const propertyId =
    typeof doc.propertyId === "object" ? doc.propertyId?._id : doc?.propertyId;

  const propertyName =
    doc.propertyName ??
    (typeof doc.propertyId === "object" ? doc.propertyId?.name : undefined);

  return {
    _id: doc._id ?? String(doc.id ?? ""),
    name: doc.name ?? doc.originalName ?? "Untitled Document",
    description: doc.description ?? doc.metadata?.description ?? "",
    type: doc.type ?? doc.metadata?.type ?? "other",
    category: doc.category ?? doc.metadata?.category ?? "general",
    fileUrl: doc.fileUrl ?? latestVersion?.fileUrl ?? "",
    fileSize: doc.fileSize ?? latestVersion?.fileSize ?? 0,
    mimeType: doc.mimeType ?? latestVersion?.mimeType ?? "application/pdf",
    uploadedAt:
      doc.uploadedAt ??
      doc.createdAt ??
      latestVersion?.uploadedAt ??
      doc.updatedAt,
    updatedAt: doc.updatedAt,
    leaseId: leaseId ? String(leaseId) : undefined,
    propertyId: propertyId ? String(propertyId) : undefined,
    propertyName,
    tags: Array.isArray(doc.tags) ? doc.tags : [],
    status: doc.status ?? "active",
  };
};

interface DocumentManagementProps {
  documents?: TenantDocument[];
  loading?: boolean;
  leases?: TenantLeaseSummary[];
  className?: string;
  autoFetch?: boolean;
  onDocumentsFetch?: (documents: TenantDocument[]) => void;
  showFilters?: boolean;
  showSummary?: boolean;
}

type DocumentAction = "preview" | "download";

type EnrichedDocument = TenantDocument & {
  propertyLabel: string;
  typeValue: string;
  categoryValue: string;
};

const typeLabelMap: Record<string, string> = {
  lease: "Lease",
  receipt: "Receipt",
  notice: "Notice",
  insurance: "Insurance",
  identification: "Identification",
  income: "Income",
  maintenance: "Maintenance",
  inspection: "Inspection",
  other: "Other",
};

const categoryLabelMap: Record<string, string> = {
  lease: "Lease",
  payments: "Payments",
  maintenance: "Maintenance",
  insurance: "Insurance",
  identification: "Identification",
  notices: "Notices",
  general: "General",
};

const toTitleCase = (value: string) =>
  value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());

const formatFileSize = (bytes?: number) => {
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

const getDocumentIcon = (document: TenantDocument) => {
  const mime = (document.mimeType ?? "").toLowerCase();
  const extension = document.fileUrl?.split(".").pop()?.toLowerCase() ?? "";

  if (mime.includes("pdf") || extension === "pdf") {
    return <FileIcon className="h-4 w-4 text-red-500" />;
  }

  if (
    mime.includes("image") ||
    ["jpg", "jpeg", "png", "gif", "webp"].includes(extension)
  ) {
    return <ImageIcon className="h-4 w-4 text-blue-500" />;
  }

  return <File className="h-4 w-4 text-gray-500" />;
};

/** The words on a document's type badge, which its column sorts by. */
const typeLabel = (typeValue: string, t: LocalizationContextType["t"]) => {
  const normalized = typeValue || "other";
  const label =
    normalized === "identification" ? "ID" : typeLabelMap[normalized] ?? typeLabelMap.other;
  return normalized === "identification"
    ? t("leases.documents.types.identificationShort", { defaultValue: label })
    : t(`leases.documents.types.${normalized}`, { defaultValue: label });
};

const getTypeBadge = (
  typeValue: string,
  t: LocalizationContextType["t"]
) => {
  const normalized = typeValue || "other";

  const badgeVariants: Record<
    string,
    "default" | "secondary" | "outline" | "destructive"
  > = {
    lease: "default",
    notice: "destructive",
    maintenance: "secondary",
    insurance: "secondary",
    receipt: "outline",
    identification: "outline",
    income: "outline",
    inspection: "outline",
    other: "secondary",
  };

  return (
    <Badge variant={badgeVariants[normalized] ?? badgeVariants.other}>
      {typeLabel(normalized, t)}
    </Badge>
  );
};

export default function DocumentManagement({
  documents,
  loading,
  leases = [],
  className,
  autoFetch,
  onDocumentsFetch,
  showFilters = true,
  showSummary = true,
}: DocumentManagementProps) {
  const { t, formatDate } = useLocalizationContext();
  const shouldAutoFetch = autoFetch ?? documents === undefined;

  const [internalDocuments, setInternalDocuments] = useState<TenantDocument[]>(
    []
  );
  const [internalLoading, setInternalLoading] =
    useState<boolean>(shouldAutoFetch);
  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [propertyFilter, setPropertyFilter] = useState("all");
  const [selectedDocument, setSelectedDocument] =
    useState<EnrichedDocument | null>(null);
  const [showPreviewDialog, setShowPreviewDialog] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);

  const fetchDocuments = useCallback(async () => {
    try {
      setInternalLoading(true);
      const response = await fetch("/api/tenant/documents");
      const payload = await response.json();

      if (!response.ok || !payload?.success) {
        throw new Error(payload?.message ?? t("errors.ui.loadFailed", { defaultValue: "Could not load this. Try again." }));
      }

      const normalized: TenantDocument[] = (payload?.data?.documents ?? []).map(
        normalizeTenantDocument
      );

      setInternalDocuments(normalized);
      onDocumentsFetch?.(normalized);
    } catch (error) {
      console.error("Error fetching tenant documents:", error);
      toast.error(
        t("leases.documents.toasts.fetchDocumentsError", {
          defaultValue: "Failed to load documents",
        })
      );
    } finally {
      setInternalLoading(false);
    }
  }, [onDocumentsFetch, t]);

  const formatLocalizedDate = useCallback(
    (value?: string) => {
      if (!value) {
        return t("leases.documents.labels.notAvailable", { defaultValue: "—" });
      }

      const date = new Date(value);
      if (Number.isNaN(date.getTime())) {
        return t("leases.documents.labels.notAvailable", { defaultValue: "—" });
      }

      return formatDate(date, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    },
    [formatDate, t]
  );

  useEffect(() => {
    if (shouldAutoFetch) {
      fetchDocuments();
    }
  }, [shouldAutoFetch, fetchDocuments]);

  const isLoading = shouldAutoFetch ? internalLoading : loading ?? false;
  const sourceDocuments = useMemo<TenantDocument[]>(
    () => (shouldAutoFetch ? internalDocuments : documents ?? []),
    [shouldAutoFetch, internalDocuments, documents]
  );

  const propertyLookup = useMemo(() => {
    const map = new Map<string, string>();

    leases.forEach((lease) => {
      const propertyId = lease.propertyId?._id;
      const propertyName = lease.propertyName ?? lease.propertyId?.name ?? "";

      if (lease._id && propertyName) {
        map.set(lease._id, propertyName);
      }

      if (propertyId && propertyName) {
        map.set(propertyId, propertyName);
      }
    });

    return map;
  }, [leases]);

  const resolvePropertyName = useCallback(
    (document: TenantDocument) => {
      if (document.propertyName) {
        return document.propertyName;
      }

      if (document.propertyId && propertyLookup.has(document.propertyId)) {
        return propertyLookup.get(document.propertyId)!;
      }

      if (document.leaseId && propertyLookup.has(document.leaseId)) {
        return propertyLookup.get(document.leaseId)!;
      }

      return "";
    },
    [propertyLookup]
  );

  const enrichedDocuments = useMemo<EnrichedDocument[]>(
    () =>
      sourceDocuments.map((document) => {
        const propertyLabel = resolvePropertyName(document);
        const typeValue = document.type ?? "other";
        const categoryValue = document.category ?? "general";

        return {
          ...document,
          propertyLabel,
          typeValue,
          categoryValue,
        };
      }),
    [sourceDocuments, resolvePropertyName]
  );

  const filteredDocuments = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();

    return enrichedDocuments.filter((document) => {
      const matchesSearch =
        search.length === 0 ||
        document.name.toLowerCase().includes(search) ||
        (document.description ?? "").toLowerCase().includes(search) ||
        document.propertyLabel.toLowerCase().includes(search) ||
        (document.tags ?? []).some((tag) => tag.toLowerCase().includes(search));

      const matchesType =
        typeFilter === "all" || document.typeValue === typeFilter;

      const matchesCategory =
        categoryFilter === "all" || document.categoryValue === categoryFilter;

      const matchesProperty =
        propertyFilter === "all" || document.propertyLabel === propertyFilter;

      return matchesSearch && matchesType && matchesCategory && matchesProperty;
    });
  }, [
    enrichedDocuments,
    searchTerm,
    typeFilter,
    categoryFilter,
    propertyFilter,
  ]);
  // The whole filtered list sorts, then pages; a new order starts on its
  // first page.
  const sorted = useTableSort(filteredDocuments, {
    name: (document) => document.name,
    type: (document) => typeLabel(document.typeValue, t),
    property: (document) => document.propertyLabel || null,
    uploaded: (document) => (document.uploadedAt ? new Date(document.uploadedAt) : null),
    size: (document) => document.fileSize ?? null,
  });
  const sort = {
    ...sorted,
    toggle: (column: string) => {
      sorted.toggle(column);
      setCurrentPage(1);
    },
  };
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const sortedDocuments = sorted.rows;
  const visibleDocuments = useMemo(
    () => sortedDocuments.slice(startIndex, endIndex),
    [sortedDocuments, startIndex, endIndex]
  );
  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(filteredDocuments.length / pageSize));
    if (currentPage > totalPages) {
      setCurrentPage(1);
    }
  }, [filteredDocuments, pageSize, currentPage]);
  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };
  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setCurrentPage(1);
  };

  const totalFileSize = useMemo(
    () =>
      sourceDocuments.reduce(
        (acc, document) => acc + (document.fileSize ?? 0),
        0
      ),
    [sourceDocuments]
  );

  const recentUploads = useMemo(
    () =>
      sourceDocuments.filter((document) => {
        if (!document.uploadedAt) return false;
        const uploadedDate = new Date(document.uploadedAt);
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 30);
        return uploadedDate >= cutoff;
      }).length,
    [sourceDocuments]
  );

  const categoryCounts = useMemo(() => {
    return sourceDocuments.reduce((acc, document) => {
      const category = document.category ?? "general";
      acc[category] = (acc[category] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  }, [sourceDocuments]);

  const topCategories = useMemo(() => {
    return Object.entries(categoryCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2);
  }, [categoryCounts]);

  const typeOptions = useMemo(() => {
    const set = new Set<string>();
    enrichedDocuments.forEach((document) => {
      if (document.typeValue) {
        set.add(document.typeValue);
      }
    });
    return Array.from(set.values()).sort();
  }, [enrichedDocuments]);

  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    enrichedDocuments.forEach((document) => {
      if (document.categoryValue) {
        set.add(document.categoryValue);
      }
    });
    return Array.from(set.values()).sort();
  }, [enrichedDocuments]);

  const propertyOptions = useMemo(() => {
    const set = new Set<string>();
    enrichedDocuments.forEach((document) => {
      if (document.propertyLabel) {
        set.add(document.propertyLabel);
      }
    });
    return Array.from(set.values()).sort();
  }, [enrichedDocuments]);

  const handleDocumentAction = useCallback(
    (action: DocumentAction, document: EnrichedDocument) => {
      switch (action) {
        case "download": {
          const downloadUrl = `/api/tenant/documents/${document._id}/download`;
          window.open(downloadUrl, "_blank", "noopener,noreferrer");
          break;
        }
        case "preview": {
          setSelectedDocument(document);
          setShowPreviewDialog(true);
          break;
        }
        default: {
          console.warn("Unknown document action:", action);
        }
      }
    },
    []
  );

  const summaryCategoryCards: Array<[string, number]> =
    topCategories.length > 0
      ? topCategories
      : [["general", categoryCounts.general ?? 0]];

  return (
    <div className={`space-y-6 ${className ?? ""}`}>
      {/* Summary Cards */}
      {showSummary && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                {t("leases.documents.summary.totalDocuments", {
                  defaultValue: "Total Documents",
                })}
              </CardTitle>
              <FileText className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <>
                  <Skeleton className="h-8 w-16" />
                  <Skeleton className="h-3 w-32 mt-2" />
                </>
              ) : (
                <>
                  <div className="text-2xl font-bold">
                    {filteredDocuments.length}/{sourceDocuments.length}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("leases.documents.summary.totalSize", {
                      defaultValue: "{size} total size",
                      values: { size: formatFileSize(totalFileSize) },
                    })}
                  </p>
                </>
              )}
            </CardContent>
          </Card>

          {summaryCategoryCards.map(([category, count]) => (
            <Card key={category}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  {t(`leases.documents.categories.${category}`, {
                    defaultValue:
                      categoryLabelMap[category] ?? toTitleCase(category),
                  })}
                </CardTitle>
                <Folder className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <Skeleton className="h-8 w-16" />
                ) : (
                  <div className="text-2xl font-bold">{count}</div>
                )}
                <p className="text-xs text-muted-foreground">
                  {t("leases.documents.summary.documentsInCategory", {
                    defaultValue: "Documents in category",
                  })}
                </p>
              </CardContent>
            </Card>
          ))}

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                {t("leases.documents.summary.recentUploads", {
                  defaultValue: "Recent Uploads",
                })}
              </CardTitle>
              <Upload className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <div className="text-2xl font-bold">{recentUploads}</div>
              )}
              <p className="text-xs text-muted-foreground">
                {t("leases.documents.summary.last30Days", {
                  defaultValue: "Last 30 days",
                })}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      {showFilters && (
        <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
          <div className="flex flex-1 flex-col gap-4 sm:flex-row sm:items-center sm:space-x-2">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute start-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t("leases.documents.filters.searchPlaceholder", {
                  defaultValue: "Search documents...",
                })}
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                className="ps-8"
              />
            </div>

            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-full sm:w-40">
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
                    {t(`leases.documents.categories.${option}`, {
                      defaultValue: categoryLabelMap[option] ?? toTitleCase(option),
                    })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-full sm:w-40">
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
                    {t(`leases.documents.types.${option}`, {
                      defaultValue: typeLabelMap[option] ?? toTitleCase(option),
                    })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={propertyFilter} onValueChange={setPropertyFilter}>
              <SelectTrigger className="w-full sm:w-40">
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
          </div>

          {shouldAutoFetch && (
            <Button
              variant="outline"
              size="sm"
              onClick={fetchDocuments}
              disabled={internalLoading}
              className="gap-2"
            >
              <RefreshCw
                className={`h-4 w-4 ${internalLoading ? "animate-spin" : ""}`}
              />
              {t("leases.actions.refresh", { defaultValue: "Refresh" })}
            </Button>
          )}
        </div>
      )}

      {/* Documents Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            {t("leases.documents.table.title", {
              defaultValue: "Documents ({count})",
              values: { count: filteredDocuments.length },
            })}
          </CardTitle>
          <CardDescription>
            {t("leases.documents.table.subtitle", {
              defaultValue: "Access and manage all your lease-related documents",
            })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-12 w-full" />
              ))}
            </div>
          ) : filteredDocuments.length === 0 ? (
            <div className="text-center py-8">
              <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">
                {t("leases.documents.empty.title", {
                  defaultValue: "No Documents Found",
                })}
              </h3>
              <p className="text-muted-foreground">
                {t("leases.documents.empty.description", {
                  defaultValue: "No documents match your current filters.",
                })}
              </p>
            </div>
          ) : (
            <>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <SortableTableHead sort={sort} column="name">
                        {t("leases.documents.table.columns.document", {
                          defaultValue: "Document",
                        })}
                      </SortableTableHead>
                      <SortableTableHead sort={sort} column="type">
                        {t("leases.documents.table.columns.type", {
                          defaultValue: "Type",
                        })}
                      </SortableTableHead>
                      <SortableTableHead sort={sort} column="property">
                        {t("leases.documents.table.columns.property", {
                          defaultValue: "Property",
                        })}
                      </SortableTableHead>
                      <SortableTableHead sort={sort} column="uploaded">
                        {t("leases.documents.table.columns.uploadDate", {
                          defaultValue: "Upload Date",
                        })}
                      </SortableTableHead>
                      <SortableTableHead sort={sort} column="size">
                        {t("leases.documents.table.columns.size", {
                          defaultValue: "Size",
                        })}
                      </SortableTableHead>
                      <TableHead className="text-end">
                        {t("leases.documents.table.columns.actions", {
                          defaultValue: "Actions",
                        })}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleDocuments.map((document) => (
                      <TableRow key={document._id}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            {getDocumentIcon(document)}
                            <div>
                              <div className="font-medium">{document.name}</div>
                              {document.description && (
                                <div className="text-sm text-muted-foreground">
                                  {document.description}
                                </div>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>{getTypeBadge(document.typeValue, t)}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Building2 className="h-3 w-3 text-muted-foreground" />
                            {document.propertyLabel ||
                              t("leases.documents.labels.notAvailable", {
                                defaultValue: "—",
                              })}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Calendar className="h-3 w-3 text-muted-foreground" />
                            {formatLocalizedDate(document.uploadedAt)}
                          </div>
                        </TableCell>
                        <TableCell>{formatFileSize(document.fileSize)}</TableCell>
                        <TableCell className="text-end">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" className="h-8 w-8 p-0">
                                <span className="sr-only">
                                  {t("leases.documents.actions.openMenu", {
                                    defaultValue: "Open menu",
                                  })}
                                </span>
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={() =>
                                  handleDocumentAction("preview", document)
                                }
                              >
                                <Eye className="me-2 h-4 w-4" />
                                {t("leases.documents.actions.preview", {
                                  defaultValue: "Preview",
                                })}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() =>
                                  handleDocumentAction("download", document)
                                }
                              >
                                <Download className="me-2 h-4 w-4" />
                                {t("leases.documents.actions.download", {
                                  defaultValue: "Download",
                                })}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <GlobalPagination
                currentPage={currentPage}
                totalPages={Math.max(
                  1,
                  Math.ceil(filteredDocuments.length / pageSize)
                )}
                totalItems={filteredDocuments.length}
                pageSize={pageSize}
                onPageChange={handlePageChange}
                onPageSizeChange={handlePageSizeChange}
                showingLabel={t("common.showing", { defaultValue: "Showing" })}
                previousLabel={t("common.previous", { defaultValue: "Previous" })}
                nextLabel={t("common.next", { defaultValue: "Next" })}
                pageLabel={t("common.page", { defaultValue: "Page" })}
                ofLabel={t("common.of", { defaultValue: "of" })}
              itemsPerPageLabel={t("common.perPage", { defaultValue: "per page" })}
            />
          </>
          )}
        </CardContent>
      </Card>

      {/* Document Preview Dialog */}
      <Dialog
        open={showPreviewDialog}
        onOpenChange={(open) => {
          setShowPreviewDialog(open);
          if (!open) {
            setSelectedDocument(null);
          }
        }}
      >
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              {t("leases.documents.preview.title", {
                defaultValue: "Document Preview",
              })}
            </DialogTitle>
            <DialogDescription className="break-all">
              {selectedDocument?.description ??
                t("leases.documents.preview.description", {
                  defaultValue: "Review document details",
                })}
            </DialogDescription>
          </DialogHeader>

          {selectedDocument && (
            <div className="space-y-4">
              <div className="rounded-lg border bg-muted/40 p-4">
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className="text-lg font-semibold break-all line-clamp-2"
                      title={selectedDocument.name}
                    >
                      {selectedDocument.name}
                    </span>
                    {getTypeBadge(selectedDocument.typeValue, t)}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4" />
                      {selectedDocument.propertyLabel ||
                        t("leases.documents.labels.notAvailable", {
                          defaultValue: "—",
                        })}
                    </div>
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4" />
                      {t("leases.documents.preview.uploadedOn", {
                        defaultValue: "Uploaded {date}",
                        values: {
                          date: formatLocalizedDate(selectedDocument.uploadedAt),
                        },
                      })}
                    </div>
                    <div className="flex items-center gap-2">
                      <File className="h-4 w-4" />
                      {formatFileSize(selectedDocument.fileSize)}
                    </div>
                    {selectedDocument.status && (
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4" />
                        {t("leases.documents.preview.status", {
                          defaultValue: "Status: {status}",
                          values: { status: toTitleCase(selectedDocument.status) },
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    const fallbackUrl = `/api/tenant/documents/${selectedDocument._id}/download`;
                    const rawUrl = selectedDocument.fileUrl ?? "";

                    if (rawUrl.length > 0) {
                      try {
                        const resolvedUrl = new URL(
                          rawUrl,
                          window.location.origin
                        );
                        const protocol = resolvedUrl.protocol.toLowerCase();
                        const isHttpProtocol =
                          protocol === "http:" || protocol === "https:";
                        const isSameOrigin =
                          resolvedUrl.origin === window.location.origin;

                        if (isHttpProtocol && !isSameOrigin) {
                          window.open(
                            resolvedUrl.href,
                            "_blank",
                            "noopener,noreferrer"
                          );
                          return;
                        }
                      } catch (error) {
                        // If the URL cannot be parsed we fall back to the download route
                      }
                    }

                    window.open(fallbackUrl, "_blank", "noopener,noreferrer");
                  }}
                >
                  <Eye className="me-2 h-4 w-4" />
                  {t("leases.documents.actions.openDocument", {
                    defaultValue: "Open Document",
                  })}
                </Button>
                <Button
                  onClick={() =>
                    handleDocumentAction("download", selectedDocument)
                  }
                >
                  <Download className="me-2 h-4 w-4" />
                  {t("leases.documents.actions.download", {
                    defaultValue: "Download",
                  })}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setShowPreviewDialog(false)}
                >
                  {t("leases.documents.actions.close", { defaultValue: "Close" })}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
