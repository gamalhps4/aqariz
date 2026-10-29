"use client";

import Link from "next/link";
import { ReportExportButton } from "@/components/reports/export-button";
import { toast } from "sonner";
import Image from "@/components/ui/app-image";
import { useSession } from "@/lib/auth-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlobalSearch } from "@/components/ui/global-search";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect, useCallback, useMemo } from "react";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { DataTable, DataTableColumn } from "@/components/ui/data-table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CategorySelectItems } from "@/components/properties/category-select-items";
import { usePropertyCategories } from "@/hooks/use-property-categories";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Building2,
  Plus,
  MoreHorizontal,
  Edit,
  Eye,
  MapPin,
  Users,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  XCircle,
  Grid3X3,
  List,
  Rows3,
  X,
  Trash2,
} from "lucide-react";
import {
  propertyService,
  PropertyResponse,
  PropertyQueryParams,
} from "@/lib/services/property.service";
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
import { PropertyStatus } from "@/types";
import PropertyStats from "@/components/properties/PropertyStats";
import { GlobalPagination } from "@/components/ui/global-pagination";
import { PropertyRowCard } from "@/components/properties/PropertyRowCard";
import { useViewPreferencesStore } from "@/stores/view-preferences.store";
import { getFeaturedImage, hasPropertyImages } from "@/lib/utils/image-utils";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { formatDisplayDate } from "@/lib/utils/formatting";
import { useAuthorization } from "@/hooks/useAuthorization";
import { hasAllPermissions } from "@/lib/permissions-manager";
import { APP_CURRENCY } from "@/lib/regional/region";
// import { formatCurrency } from "@/lib/api-utils";

interface PropertyCardProps {
  property: PropertyResponse;
  onEdit: (property: PropertyResponse) => void;
  onDelete: (property: PropertyResponse) => void;
  onView: (property: PropertyResponse) => void;
  onStatusChange: (property: PropertyResponse, status: PropertyStatus) => void;
  deleteLoading: boolean;
}

function PropertyCard({
  property,
  onEdit,
  onDelete,
  onView,
  onStatusChange,
  deleteLoading,
}: PropertyCardProps) {
  const { t, formatCurrency, formatDate } = useLocalizationContext();
  const { labelFor: categoryLabelFor } = usePropertyCategories("property");

  const getStatusColor = (status?: PropertyStatus) => {
    switch (status) {
      case PropertyStatus.AVAILABLE:
        return "bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 border-green-200 dark:border-green-700";
      case PropertyStatus.OCCUPIED:
        return "bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 border-blue-200 dark:border-blue-700";
      case PropertyStatus.MAINTENANCE:
        return "bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200 border-yellow-200 dark:border-yellow-700";
      case PropertyStatus.UNAVAILABLE:
        return "bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200 border-red-200 dark:border-red-700";
      default:
        return "bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 border-gray-200 dark:border-gray-600";
    }
  };

  const getStatusLabel = (status?: PropertyStatus) => {
    switch (status) {
      case PropertyStatus.AVAILABLE:
        return t("properties.status.available");
      case PropertyStatus.OCCUPIED:
        return t("properties.status.occupied");
      case PropertyStatus.MAINTENANCE:
        return t("properties.status.maintenance");
      case PropertyStatus.UNAVAILABLE:
        return t("properties.status.unavailable");
      default:
        return t("properties.status.unknown");
    }
  };

  // Categories are organization-defined now, so their names come from the
  // catalogue rather than a translation key that only exists for the six
  // types that used to be hard-coded.
  const getTypeLabel = (type?: string) => {
    if (!type) return t("properties.type.unknown");
    return categoryLabelFor(type);
  };

  // Every branch rendered the same icon; with an open-ended category list
  // there is nothing left to switch on.
  const getTypeIcon = (_type?: string) => <Building2 className="h-4 w-4" />;

  // Safe image handling using utility functions
  const hasImage = hasPropertyImages(property);
  const featuredImage = getFeaturedImage(property);
  const propertyStatus = property?.status as PropertyStatus | undefined;
  const statusLabel = getStatusLabel(propertyStatus);
  const propertyType = property?.type as string | undefined;
  const propertyName = property?.name ?? t("properties.row.unknownProperty");
  const addressParts = [
    property?.address?.street,
    property?.address?.city,
    property?.address?.state,
  ].filter(Boolean);
  const displayAddress =
    [addressParts.join(", "), property?.address?.zipCode]
      .filter(Boolean)
      .join(" ") || t("properties.row.addressUnavailable");
  const totalUnits =
    typeof property?.totalUnits === "number" ? property?.totalUnits : 0;

  // Get unit statistics for multi-unit properties
  const unitStats = getUnitStats(property?.units);
  const rentRange = getRentRange(property?.units, formatCurrency);

  return (
    <Card className="group hover:shadow-lg transition-all duration-200 overflow-hidden border border-gray-200 dark:border-gray-700 shadow-sm bg-white dark:bg-gray-800 p-0 gap-0 rounded-lg">
      {/* Featured Image */}
      <div className="relative h-48 overflow-hidden bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-700 dark:to-gray-800 rounded-t-lg m-0 p-0">
        {hasImage ? (
          <Image
            src={featuredImage!}
            alt={propertyName}
            fill
            className="object-cover object-center w-full h-full group-hover:scale-105 transition-transform duration-300 m-0 p-0"
            sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
            priority={false}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-700 dark:to-gray-600">
            <Building2 className="h-16 w-16 text-gray-400 dark:text-gray-500" />
          </div>
        )}

        {/* Status Badge */}
        <div className="absolute top-3 start-3">
          <span
            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${getStatusColor(
              propertyStatus,
            )}`}
          >
            {statusLabel}
          </span>
        </div>

        {/* Type Badge */}
        <div className="absolute top-3 end-3">
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-white/90 dark:bg-gray-800/90 text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-600">
            {getTypeIcon(propertyType)}
            <span className="ms-1">{getTypeLabel(propertyType)}</span>
          </span>
        </div>

        {/* Overlay Actions */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors duration-200 flex items-center justify-center opacity-0 group-hover:opacity-100">
          <div className="flex space-x-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onView(property)}
              className="bg-white/90 hover:bg-white text-gray-900"
            >
              <Eye className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onEdit(property)}
              className="bg-white/90 hover:bg-white text-gray-900"
            >
              <Edit className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Card Content */}
      <CardContent className="p-4">
        {/* Property Name & Description */}
        <div className="mb-3">
          <div className="flex items-center gap-2 mb-1">
            <h3
              className={`font-semibold text-lg line-clamp-1 ${
                property.deletedAt
                  ? "text-gray-400 dark:text-gray-500 line-through"
                  : "text-gray-900 dark:text-gray-100"
              }`}
            >
              {propertyName}
            </h3>
            {property.deletedAt && (
              <span className="px-2 py-1 text-xs bg-red-100 text-red-800 rounded-full">
                {t("properties.labels.deleted")}
              </span>
            )}
          </div>
          {property?.description && (
            <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-1">
              {property.description}
            </p>
          )}
          {property.deletedAt && (
            <p className="text-xs text-red-500 mt-1">
              {t("properties.labels.deletedWithDate", {
                values: { date: formatDate(property.deletedAt) },
              })}
            </p>
          )}
        </div>

        {/* Location */}
        <div className="flex items-center text-sm text-gray-600 dark:text-gray-400 mb-3">
          <MapPin className="h-4 w-4 me-1 flex-shrink-0" />
          <span className="line-clamp-1">{displayAddress}</span>
        </div>

        {/* Unit Information - Consistent for all properties */}
        <div className="mb-4 p-2.5 bg-gray-50 dark:bg-gray-700/50 rounded-lg border border-gray-200 dark:border-gray-600">
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="text-xs font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">
              {property?.isMultiUnit && totalUnits > 1 ? (
                <>
                  {totalUnits} {t("properties.labels.units")}
                </>
              ) : (
                t("properties.labels.unit")
              )}
            </span>
            {/* Unit Status Badges - Single line with smaller text */}
            <div className="flex items-center gap-1 text-[10px]">
              {property?.isMultiUnit ? (
                <>
                  {unitStats.available > 0 && (
                    <span className="inline-flex items-center px-1.5 py-0.5 bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-300 rounded font-medium whitespace-nowrap">
                      {unitStats.available} {t("properties.units.available")}
                    </span>
                  )}
                  {unitStats.occupied > 0 && (
                    <span className="inline-flex items-center px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 rounded font-medium whitespace-nowrap">
                      {unitStats.occupied} {t("properties.units.occupied")}
                    </span>
                  )}
                  {unitStats.maintenance > 0 && (
                    <span className="inline-flex items-center px-1.5 py-0.5 bg-yellow-100 dark:bg-yellow-900/50 text-yellow-700 dark:text-yellow-300 rounded font-medium whitespace-nowrap">
                      {unitStats.maintenance}{" "}
                      {t("properties.units.maintenance")}
                    </span>
                  )}
                </>
              ) : (
                <span className="inline-flex items-center px-1.5 py-0.5 bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-300 rounded font-medium whitespace-nowrap">
                  {getStatusLabel(propertyStatus)}
                </span>
              )}
            </div>
          </div>
          {property?.isMultiUnit && unitStats.types.length > 0 ? (
            <div className="text-[10px] text-gray-600 dark:text-gray-400">
              {t("properties.labels.types")}:{" "}
              {unitStats.types
                .map((type) =>
                  t(`properties.unitType.${type}`, { defaultValue: type }),
                )
                .join(", ")}
            </div>
          ) : (
            <div className="text-[10px] text-gray-600 dark:text-gray-400">
              {t("properties.labels.types")}: {getTypeLabel(propertyType)}
            </div>
          )}
        </div>

        {/* Rent & Owner */}
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <div className="flex items-center text-lg font-semibold text-gray-900 dark:text-gray-100">
              <span>{rentRange || t("properties.labels.unknown")}</span>
              <span className="text-sm font-normal text-gray-600 dark:text-gray-400 ms-1">
                {t("properties.labels.perMonth")}
              </span>
            </div>
            {property?.isMultiUnit && unitStats.available > 0 ? (
              <span className="text-xs text-green-600 dark:text-green-400 font-medium mt-1">
                {t("properties.units.availableCount", {
                  values: { count: unitStats.available },
                })}
              </span>
            ) : (
              !property?.isMultiUnit && (
                <span className="text-xs text-green-600 dark:text-green-400 font-medium mt-1">
                  {t("properties.labels.singleUnit")}
                </span>
              )
            )}
          </div>

          {/* Actions Menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>
                {t("properties.menu.actions")}
              </DropdownMenuLabel>
              <DropdownMenuItem onClick={() => onView(property)}>
                <Eye className="h-4 w-4 me-2" />
                {t("properties.menu.viewDetails")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onEdit(property)}>
                <Edit className="h-4 w-4 me-2" />
                {t("properties.menu.editProperty")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {!property.deletedAt ? (
                <DropdownMenuItem
                  onClick={() => onDelete(property)}
                  className="text-red-600 focus:text-red-600"
                  disabled={deleteLoading || isPropertyOccupied(property)}
                >
                  <Trash2 className="h-4 w-4 me-2" />
                  {t("properties.menu.deleteProperty")}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem disabled className="text-gray-400">
                  <Trash2 className="h-4 w-4 me-2" />
                  {t("properties.menu.alreadyDeleted")}
                </DropdownMenuItem>
              )}
              {property.status !== PropertyStatus.AVAILABLE && (
                <DropdownMenuItem
                  onClick={() =>
                    onStatusChange(property, PropertyStatus.AVAILABLE)
                  }
                >
                  <CheckCircle className="h-4 w-4 me-2 text-green-600" />
                  {t("properties.menu.markAvailable")}
                </DropdownMenuItem>
              )}
              {property.status !== PropertyStatus.OCCUPIED && (
                <DropdownMenuItem
                  onClick={() =>
                    onStatusChange(property, PropertyStatus.OCCUPIED)
                  }
                >
                  <Users className="h-4 w-4 me-2 text-blue-600" />
                  {t("properties.menu.markOccupied")}
                </DropdownMenuItem>
              )}
              {property.status !== PropertyStatus.MAINTENANCE && (
                <DropdownMenuItem
                  onClick={() =>
                    onStatusChange(property, PropertyStatus.MAINTENANCE)
                  }
                >
                  <AlertCircle className="h-4 w-4 me-2 text-yellow-600" />
                  {t("properties.menu.markMaintenance")}
                </DropdownMenuItem>
              )}
              {property.status !== PropertyStatus.UNAVAILABLE && (
                <DropdownMenuItem
                  onClick={() =>
                    onStatusChange(property, PropertyStatus.UNAVAILABLE)
                  }
                >
                  <XCircle className="h-4 w-4 me-2 text-red-600" />
                  {t("properties.menu.markUnavailable")}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

// Helper function to get unit statistics
const getUnitStats = (units?: PropertyResponse["units"]) => {
  if (!units || units.length === 0) {
    return { available: 0, occupied: 0, maintenance: 0, total: 0, types: [] };
  }

  const stats = {
    available: 0,
    occupied: 0,
    maintenance: 0,
    total: units.length,
    types: [] as string[],
  };

  const typeSet = new Set<string>();

  units.forEach((unit) => {
    switch (unit.status) {
      case PropertyStatus.AVAILABLE:
        stats.available++;
        break;
      case PropertyStatus.OCCUPIED:
        stats.occupied++;
        break;
      case PropertyStatus.MAINTENANCE:
        stats.maintenance++;
        break;
    }
    typeSet.add(unit.unitType);
  });

  stats.types = Array.from(typeSet);
  return stats;
};

// Helper function to get rent range for multi-unit properties
const getRentRange = (
  units?: PropertyResponse["units"],
  formatCurrency?: (amount: number) => string,
) => {
  if (!units || units.length === 0) return null;

  const rents = units.map((unit) => unit.rentAmount ?? 0);
  const minRent = Math.min(...rents);
  const maxRent = Math.max(...rents);

  const format = formatCurrency
    ? formatCurrency
    : (amount: number) =>
        new Intl.NumberFormat(undefined, {
          style: "currency",
          currency: APP_CURRENCY,
        }).format(amount);

  if (minRent === maxRent) {
    return format(minRent);
  }

  return `${format(minRent)} - ${format(maxRent)}`;
};

// Helper to determine if a property is occupied
const isPropertyOccupied = (property: PropertyResponse) => {
  if (!property) return false;
  if (property.isMultiUnit) {
    return (property.units || []).some(
      (u) =>
        u.status === PropertyStatus.OCCUPIED ||
        !!u.currentTenantId ||
        !!u.currentLeaseId,
    );
  }
  return property.status === PropertyStatus.OCCUPIED;
};

export default function PropertiesPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t, formatCurrency } = useLocalizationContext();
  const [properties, setProperties] = useState<PropertyResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState<string | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [propertyToDelete, setPropertyToDelete] =
    useState<PropertyResponse | null>(null);
  const viewMode = useViewPreferencesStore((state) => state.propertiesView);
  const setViewMode = useViewPreferencesStore(
    (state) => state.setPropertiesView,
  );

  // Bulk selection state
  const [selectedProperties, setSelectedProperties] = useState<string[]>([]);
  const [bulkDeleteLoading, setBulkDeleteLoading] = useState(false);
  // Several buildings leave every list at once, so the delete is confirmed
  // first — it used to run on the click.
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  // What DELETE /api/properties asks for: an administrator holding both
  // rights. Nobody else is offered a button the server would refuse.
  const { isAdmin, permissions } = useAuthorization();
  const canBulkDelete =
    isAdmin && hasAllPermissions(permissions, ["property_delete", "bulk_operations"]);

  // Filter and pagination state
  const [filters, setFilters] = useState<PropertyQueryParams>({
    page: parseInt(searchParams.get("page") || "1"),
    limit: parseInt(searchParams.get("limit") || "12"),
    sortBy: "createdAt",
    sortOrder: "desc",
  });

  const [pagination, setPagination] = useState({
    page: 1,
    limit: 10,
    total: 0,
    pages: 0,
    hasNext: false,
    hasPrev: false,
  });

  const fetchProperties = useCallback(async () => {
    try {
      if (!filters.search) {
        setLoading(true);
      }
      setIsSearching(true);
      setError(null);

      const response = await propertyService.getProperties(filters);
      setProperties(response.data);
      setPagination(response.pagination);
    } catch {
      const fallbackMessage = t("properties.error.fetchFailed");
      setError(fallbackMessage);
      toast.error(fallbackMessage);
    } finally {
      setLoading(false);
      setIsSearching(false);
    }
  }, [filters, session?.user?.role, t]);

  useEffect(() => {
    fetchProperties();
  }, [fetchProperties]);

  // Show/hide bulk actions based on selection - handled inline now

  // Memoized calculations for better performance
  const isAllSelected = useMemo(() => {
    return (
      selectedProperties.length === properties.length && properties.length > 0
    );
  }, [selectedProperties.length, properties.length]);

  const hasActiveFilters = useMemo(() => {
    return !!(
      filters.search ||
      filters.type ||
      filters.status ||
      filters.unitType
    );
  }, [filters.search, filters.type, filters.status, filters.unitType]);

  const propertiesRangeFrom =
    pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.limit + 1;
  const propertiesRangeTo =
    pagination.total === 0
      ? 0
      : Math.min(pagination.page * pagination.limit, pagination.total);

  const handleSearch = (search: string) => {
    setFilters((prev) => ({ ...prev, search, page: 1 }));
  };

  const handleFilterChange = (
    key: keyof PropertyQueryParams,
    value: string | number | undefined,
  ) => {
    setFilters((prev) => ({ ...prev, [key]: value, page: 1 }));
  };

  const handlePageChange = (page: number) => {
    setFilters((prev) => ({ ...prev, page }));
  };
  const handlePageSizeChange = (size: number) => {
    const params = new URLSearchParams(Array.from(searchParams.entries()));
    params.set("limit", size.toString());
    params.set("page", "1");
    router.push(`/dashboard/properties?${params.toString()}`);
    setFilters((prev) => ({ ...prev, limit: size, page: 1 }));
  };

  // DISABLED: Delete functionality temporarily disabled
  const handleDeleteClick = (property: PropertyResponse) => {
    if (isPropertyOccupied(property)) {
      toast.error(t("properties.list.toasts.occupied", { defaultValue: "A building with occupied units cannot be deleted" }));
      return;
    }
    setPropertyToDelete(property);
    setShowDeleteDialog(true);
  };

  // DISABLED: Delete functionality temporarily disabled
  const handleDeleteConfirm = async () => {
    if (!propertyToDelete) return;

    // Check if property is already deleted
    if (propertyToDelete.deletedAt) {
      toast.error(t("properties.list.toasts.alreadyDeleted", { defaultValue: "This building has already been deleted" }));
      setShowDeleteDialog(false);
      setPropertyToDelete(null);
      return;
    }

    try {
      setDeleteLoading(propertyToDelete._id);
      await propertyService.deleteProperty(propertyToDelete._id);

      // Show success message
      toast.success(t("properties.list.toasts.deleted", { defaultValue: "Building deleted" }));

      // Refresh the list
      await fetchProperties();
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : t("properties.list.toasts.deleteFailed", { defaultValue: "Could not delete the building" });
      toast.error(message);
    } finally {
      setDeleteLoading(null);
      setShowDeleteDialog(false);
      setPropertyToDelete(null);
    }
  };

  // DISABLED: Delete functionality temporarily disabled
  const handleDeleteCancel = () => {
    setShowDeleteDialog(false);
    setPropertyToDelete(null);
  };

  const handleSelectProperty = (propertyId: string, checked: boolean) => {
    if (checked) {
      setSelectedProperties((prev) => [...prev, propertyId]);
    } else {
      setSelectedProperties((prev) => prev.filter((id) => id !== propertyId));
    }
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedProperties(properties.map((p) => p._id));
    } else {
      setSelectedProperties([]);
    }
  };

  // Runs from the bulk delete's confirmation dialog.
  const handleBulkDelete = async () => {
    if (selectedProperties.length === 0) return;

    // Filter out already deleted and occupied properties
    const deletableProperties = selectedProperties.filter((id) => {
      const property = properties.find((p) => p._id === id);
      return property && !property.deletedAt && !isPropertyOccupied(property);
    });

    if (deletableProperties.length === 0) {
      toast.error(
        t("properties.bulk.toasts.nothingDeletable", {
          defaultValue:
            "None of the selected buildings can be deleted: they are let, or already in the archive.",
        }),
      );
      setBulkDeleteOpen(false);
      return;
    }

    if (deletableProperties.length < selectedProperties.length) {
      const skipped = selectedProperties.filter((id) => {
        const p = properties.find((x) => x._id === id);
        return !p || p.deletedAt || isPropertyOccupied(p);
      });
      const alreadyDeletedCount = skipped.filter((id) => {
        const p = properties.find((x) => x._id === id);
        return p && !!p.deletedAt;
      }).length;
      const occupiedCount = skipped.filter((id) => {
        const p = properties.find((x) => x._id === id);
        return p && isPropertyOccupied(p);
      }).length;
      if (alreadyDeletedCount > 0) {
        toast.warning(
          t("properties.bulk.toasts.skippedArchived", {
            defaultValue:
              "{count} of them are already in the archive and were skipped.",
            values: { count: alreadyDeletedCount },
          }),
        );
      }
      if (occupiedCount > 0) {
        toast.warning(
          t("properties.bulk.toasts.skippedOccupied", {
            defaultValue: "{count} of them are let and were skipped.",
            values: { count: occupiedCount },
          }),
        );
      }
    }

    try {
      setBulkDeleteLoading(true);

      const result =
        await propertyService.bulkDeleteProperties(deletableProperties);

      toast.success(
        t("properties.bulk.toasts.archived", {
          defaultValue:
            "{count} buildings were moved to the archive, where they can be restored.",
          values: {
            count: result.modifiedCount ?? deletableProperties.length,
          },
        }),
      );
      // A building with a contract in force stays, as with a single delete.
      const withContracts =
        (result as { skippedWithContracts?: number }).skippedWithContracts ?? 0;
      if (withContracts > 0) {
        toast.warning(
          t("properties.bulk.toasts.skippedContracts", {
            defaultValue:
              "{count} of them have a contract in force and were skipped.",
            values: { count: withContracts },
          }),
        );
      }
      setSelectedProperties([]);
      setBulkDeleteOpen(false);
      await fetchProperties();
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : t("properties.list.toasts.bulkDeleteFailed", { defaultValue: "Could not delete the selected buildings" });
      toast.error(message);
    } finally {
      setBulkDeleteLoading(false);
    }
  };

  const handleStatusChange = async (id: string, status: PropertyStatus) => {
    try {
      await propertyService.updatePropertyStatus(id, status);

      // Show success message
      toast.success(t("properties.toasts.statusUpdate.success"));

      // Refresh the list
      await fetchProperties();
    } catch {
      toast.error(t("properties.toasts.statusUpdate.error"));
    }
  };

  const getStatusBadgeVariant = (status: PropertyStatus) => {
    switch (status) {
      case PropertyStatus.AVAILABLE:
        return "default";
      case PropertyStatus.OCCUPIED:
        return "secondary";
      case PropertyStatus.MAINTENANCE:
        return "destructive";
      case PropertyStatus.UNAVAILABLE:
        return "outline";
      default:
        return "default";
    }
  };

  // Define columns for the DataTable
  const propertyColumns: DataTableColumn<PropertyResponse>[] = [
    {
      id: "property",
      sortKey: "name",
      header: t("properties.table.property"),
      cell: (property) => (
        <div className="flex items-center space-x-3">
          <div className="relative w-10 h-10 rounded-lg overflow-hidden bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-700 dark:to-gray-800 flex-shrink-0">
            {hasPropertyImages(property) ? (
              <Image
                src={getFeaturedImage(property)!}
                alt={property.name}
                fill
                className="object-cover object-center w-full h-full m-0 p-0"
                sizes="40px"
                priority={false}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-700 dark:to-gray-600">
                <Building2 className="h-5 w-5 text-gray-400 dark:text-gray-500" />
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-medium text-gray-900 dark:text-gray-100">
              <Link
                href={`/dashboard/properties/${property._id}`}
                className={`hover:text-blue-600 dark:hover:text-blue-400 transition-colors ${
                  property.deletedAt ? "line-through text-gray-400" : ""
                }`}
              >
                {property.name}
              </Link>
              {property.deletedAt && (
                <span className="ms-2 px-2 py-1 text-xs bg-red-100 text-red-800 rounded-full">
                  Deleted
                </span>
              )}
            </div>
            <div className="text-sm text-gray-500 dark:text-gray-400 truncate">
              ID: {property._id.slice(-6)}
              {property.deletedAt && (
                <span className="ms-2 text-red-500">
                  ({t("properties.list.deletedOn", {
                    defaultValue: "Deleted {date}",
                    values: { date: formatDisplayDate(property.deletedAt) },
                  })})
                </span>
              )}
            </div>
          </div>
        </div>
      ),
      className: "min-w-[200px]",
    },
    {
      id: "status",
      header: t("properties.table.status"),
      cell: (property) => (
        <div className="flex flex-col space-y-1">
          <Badge
            variant={getStatusBadgeVariant(property.status)}
            className="w-fit"
          >
            {property?.status
              ? t(`properties.status.${property.status.toLowerCase()}`)
              : t("properties.status.unknown")}
          </Badge>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {property?.type
              ? t(`properties.type.${property.type.toLowerCase()}`)
              : t("properties.type.unknown")}
          </span>
        </div>
      ),
    },
    {
      id: "contact",
      header: t("properties.table.contact"),
      visibility: "md",
      cell: (property) => (
        <div className="flex flex-col space-y-1">
          <div className="flex items-center text-sm text-gray-900 dark:text-gray-100">
            <MapPin className="h-3 w-3 me-1 text-gray-400 dark:text-gray-500" />
            {[property?.address?.city, property?.address?.state]
              .filter(Boolean)
              .join(", ") || t("properties.labels.locationUnavailable")}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            {property?.address?.street ?? ""}
          </div>
        </div>
      ),
    },
    {
      id: "units",
      header: t("properties.table.units"),
      visibility: "lg",
      cell: (property) => (
        <div className="flex flex-col space-y-1">
          <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
            {property.isMultiUnit && (property.totalUnits ?? 0) > 1
              ? `${property.totalUnits ?? 0} Units`
              : "Unit"}
          </div>
          <div className="flex items-center space-x-2 text-xs">
            {property.isMultiUnit ? (
              (() => {
                const unitStats = getUnitStats(property?.units);
                return (
                  <>
                    {unitStats.available > 0 && (
                      <span className="text-green-600 dark:text-green-400">
                        {unitStats.available} available
                      </span>
                    )}
                    {unitStats.occupied > 0 && (
                      <span className="text-blue-600 dark:text-blue-400">
                        {unitStats.occupied} occupied
                      </span>
                    )}
                  </>
                );
              })()
            ) : (
              <span className="text-green-600 dark:text-green-400">
                {property?.status === PropertyStatus.AVAILABLE
                  ? "available"
                  : property?.status?.toLowerCase() || "unknown"}
              </span>
            )}
          </div>
        </div>
      ),
    },
    {
      id: "rent",
      header: t("properties.table.rent"),
      visibility: "md",
      cell: (property) => (
        <div className="flex flex-col space-y-1">
          <div className="font-medium text-gray-900 dark:text-gray-100">
            {getRentRange(property?.units, formatCurrency) ||
              t("properties.labels.unknown")}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            {t("properties.labels.perMonth")}
          </div>
        </div>
      ),
    },
    {
      id: "owner",
      header: t("properties.table.owner"),
      visibility: "xl",
      cell: (property) => (
        <div className="flex flex-col space-y-1">
          <div className="text-sm text-gray-900 dark:text-gray-100">
            {property.ownerId?.firstName ?? ""}{" "}
            {property.ownerId?.lastName ?? ""}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            {t("properties.table.propertyOwner")}
          </div>
        </div>
      ),
    },
    {
      id: "actions",
      header: t("properties.table.actions"),
      align: "right",
      cell: (property) => (
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
              {t("properties.menu.actions")}
            </DropdownMenuLabel>
            <DropdownMenuItem asChild>
              <Link href={`/dashboard/properties/${property?._id ?? ""}`}>
                <Eye className="me-2 h-4 w-4" />
                {t("properties.menu.viewDetails")}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={`/dashboard/properties/${property?._id ?? ""}/edit`}>
                <Edit className="me-2 h-4 w-4" />
                {t("properties.menu.editProperty")}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => handleDeleteClick(property)}
              className="text-red-600 focus:text-red-600"
              disabled={
                deleteLoading === property._id ||
                !!property.deletedAt ||
                isPropertyOccupied(property)
              }
            >
              <Trash2 className="me-2 h-4 w-4" />
              {property.deletedAt
                ? t("properties.menu.alreadyDeleted")
                : t("properties.menu.deleteProperty")}
            </DropdownMenuItem>
            {property.status !== PropertyStatus.AVAILABLE && (
              <DropdownMenuItem
                onClick={() =>
                  handleStatusChange(property._id, PropertyStatus.AVAILABLE)
                }
              >
                <CheckCircle className="me-2 h-4 w-4 text-green-600" />
                {t("properties.menu.markAvailable")}
              </DropdownMenuItem>
            )}
            {property.status !== PropertyStatus.OCCUPIED && (
              <DropdownMenuItem
                onClick={() =>
                  handleStatusChange(property._id, PropertyStatus.OCCUPIED)
                }
              >
                <Users className="me-2 h-4 w-4 text-blue-600" />
                {t("properties.menu.markOccupied")}
              </DropdownMenuItem>
            )}
            {property.status !== PropertyStatus.MAINTENANCE && (
              <DropdownMenuItem
                onClick={() =>
                  handleStatusChange(property._id, PropertyStatus.MAINTENANCE)
                }
              >
                <AlertCircle className="me-2 h-4 w-4 text-yellow-600" />
                {t("properties.menu.markMaintenance")}
              </DropdownMenuItem>
            )}
            {property.status !== PropertyStatus.UNAVAILABLE && (
              <DropdownMenuItem
                onClick={() =>
                  handleStatusChange(property._id, PropertyStatus.UNAVAILABLE)
                }
              >
                <XCircle className="me-2 h-4 w-4 text-red-600" />
                {t("properties.menu.markUnavailable")}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  if (!session) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">
            {t("properties.accessDenied.title")}
          </h2>
          <p className="text-gray-600">
            {t("properties.accessDenied.description")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("properties.header.title")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("properties.header.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2 sm:space-x-2">
          {/* The file carries the list as filtered — every filter on the
              bar, and the order — see the export branch in /api/properties. */}
          <ReportExportButton
            endpoint="/api/properties"
            params={(() => {
              const params = new URLSearchParams();
              if (filters.search) params.set("search", String(filters.search));
              if (filters.status) params.set("status", String(filters.status));
              if (filters.type) params.set("type", String(filters.type));
              if (filters.unitType) params.set("unitType", String(filters.unitType));
              if (filters.sortBy) params.set("sortBy", String(filters.sortBy));
              if (filters.sortOrder) params.set("sortOrder", String(filters.sortOrder));
              return params;
            })()}
            disabled={loading}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={fetchProperties}
            disabled={loading}
            className="flex-1 sm:flex-none"
          >
            <RefreshCw
              className={`h-4 w-4 ${loading ? "animate-spin" : ""} sm:me-2`}
            />
            <span className="hidden sm:inline">
              {t("properties.actions.refresh")}
            </span>
          </Button>
          <Link
            href="/dashboard/properties/new"
            className="flex-1 sm:flex-none"
          >
            <Button className="w-full sm:w-auto" size="sm">
              <Plus className="h-4 w-4 sm:me-2" />
              <span className="hidden sm:inline">
                {t("properties.actions.addProperty.full")}
              </span>
              <span className="sm:hidden">
                {t("properties.actions.addProperty.short")}
              </span>
            </Button>
          </Link>
        </div>
      </div>

      {/* Property Statistics */}
      <PropertyStats properties={properties} totalCount={pagination.total} />

      {/* Properties Display with Integrated Filters */}
      <Card className="gap-2">
        <CardHeader>
          {/* Main Header */}
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-2">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-50 dark:bg-blue-900/30 rounded-lg border border-blue-100 dark:border-blue-800">
                <Building2 className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {t("properties.header.title")}
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {t("properties.pagination.summary", {
                    values: {
                      from: propertiesRangeFrom,
                      to: propertiesRangeTo,
                      total: pagination.total,
                    },
                  })}
                </p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              {/* Bulk Actions */}
              {selectedProperties.length > 0 && (
                <div className="flex items-center gap-2 p-2 bg-blue-50 dark:bg-blue-900/30 rounded-lg border border-blue-100 dark:border-blue-800">
                  <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
                    {t("properties.bulk.selected", {
                      values: { count: selectedProperties.length },
                    })}
                  </span>
                  {canBulkDelete && (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => setBulkDeleteOpen(true)}
                      disabled={bulkDeleteLoading}
                      className="h-8"
                    >
                      <Trash2 className="h-4 w-4 me-1" />
                      {t("properties.bulk.delete", {
                        defaultValue: "Delete ({count})",
                        values: { count: selectedProperties.length },
                      })}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSelectedProperties([])}
                    className="h-8"
                  >
                    {t("properties.filters.clear")}
                  </Button>
                </div>
              )}

              {/* View Mode Toggle */}
              <div className="flex items-center border rounded-lg p-1 w-full sm:w-auto">
                <Button
                  variant={viewMode === "grid" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setViewMode("grid")}
                  className="h-8 flex-1 sm:flex-none sm:px-3"
                >
                  <Grid3X3 className="h-4 w-4" />
                  <span className="ms-1 sm:hidden">
                    {t("properties.view.grid")}
                  </span>
                </Button>
                <Button
                  variant={viewMode === "rows" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setViewMode("rows")}
                  className="h-8 flex-1 sm:flex-none sm:px-3"
                >
                  <Rows3 className="h-4 w-4" />
                  <span className="ms-1 sm:hidden">
                    {t("properties.view.rows")}
                  </span>
                </Button>
                <Button
                  variant={viewMode === "list" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setViewMode("list")}
                  className="h-8 flex-1 sm:flex-none sm:px-3"
                >
                  <List className="h-4 w-4" />
                  <span className="ms-1 sm:hidden">
                    {t("properties.view.list")}
                  </span>
                </Button>
              </div>
            </div>
          </div>

          {/* Integrated Filters Bar */}
          <div className="flex flex-col lg:flex-row lg:items-center gap-4 p-4 bg-gray-50/50 dark:bg-gray-800/50 rounded-lg border border-gray-200/60 dark:border-gray-700/60">
            {/* Search */}
            <div className="flex-1 min-w-0">
              <GlobalSearch
                placeholder={t("properties.filters.search.placeholder")}
                initialValue={filters.search || ""}
                debounceDelay={300}
                onSearch={handleSearch}
                isLoading={isSearching}
                className="w-full"
                ariaLabel={t("properties.list.searchAria", { defaultValue: "Search buildings" })}
              />
            </div>

            {/* Filter Controls */}
            <div className="flex flex-wrap items-center gap-3">
              {/* Property Type */}
              <Select
                value={filters.type || "all"}
                onValueChange={(value) =>
                  handleFilterChange(
                    "type",
                    value === "all" ? undefined : value,
                  )
                }
              >
                <SelectTrigger className="w-[140px] h-10 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                  <SelectValue placeholder={t("properties.filters.type.all")} />
                </SelectTrigger>
                <SelectContent>
                  <CategorySelectItems
                    kind="property"
                    allValue="all"
                    allLabel={t("properties.filters.type.all")}
                  />
                </SelectContent>
              </Select>

              {/* Status */}
              <Select
                value={filters.status || "all"}
                onValueChange={(value) =>
                  handleFilterChange(
                    "status",
                    value === "all" ? undefined : value,
                  )
                }
              >
                <SelectTrigger className="w-[140px] h-10 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                  <SelectValue
                    placeholder={t("properties.filters.status.all")}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t("properties.filters.status.all")}
                  </SelectItem>
                  {Object.values(PropertyStatus).map((status) => (
                    <SelectItem key={status} value={status}>
                      {t(`properties.status.${status}`, {
                        defaultValue:
                          status.charAt(0).toUpperCase() + status.slice(1),
                      })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Sort */}
              <Select
                value={`${filters.sortBy}-${filters.sortOrder}`}
                onValueChange={(value) => {
                  const [sortBy, sortOrder] = value.split("-");
                  setFilters((prev) => ({
                    ...prev,
                    sortBy: sortBy as
                      | "name"
                      | "rentAmount"
                      | "createdAt"
                      | "squareFootage",
                    sortOrder: sortOrder as "asc" | "desc",
                  }));
                }}
              >
                <SelectTrigger className="w-[140px] h-10 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                  <SelectValue
                    placeholder={t("properties.filters.sort.placeholder")}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="createdAt-desc">
                    {t("properties.filters.sort.createdAt.desc")}
                  </SelectItem>
                  <SelectItem value="createdAt-asc">
                    {t("properties.filters.sort.createdAt.asc")}
                  </SelectItem>
                  <SelectItem value="name-asc">
                    {t("properties.filters.sort.name.asc")}
                  </SelectItem>
                  <SelectItem value="name-desc">
                    {t("properties.filters.sort.name.desc")}
                  </SelectItem>
                  <SelectItem value="rentAmount-desc">
                    {t("properties.filters.sort.rentAmount.desc")}
                  </SelectItem>
                  <SelectItem value="rentAmount-asc">
                    {t("properties.filters.sort.rentAmount.asc")}
                  </SelectItem>
                </SelectContent>
              </Select>

              {/* Unit Type Filter */}
              <Select
                value={filters.unitType || "all"}
                onValueChange={(value) =>
                  handleFilterChange(
                    "unitType",
                    value === "all" ? undefined : value,
                  )
                }
              >
                <SelectTrigger className="w-[140px] h-10 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                  <SelectValue
                    placeholder={t("properties.filters.unitType.placeholder")}
                  />
                </SelectTrigger>
                <SelectContent>
                  <CategorySelectItems
                    kind="unit"
                    allValue="all"
                    allLabel={t("properties.filters.unitType.all")}
                  />
                </SelectContent>
              </Select>

              {/* Clear Filters */}
              {hasActiveFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setFilters({
                      page: 1,
                      limit: 10,
                      sortBy: "createdAt",
                      sortOrder: "desc",
                    })
                  }
                  className="h-10 px-3 text-gray-500 hover:text-gray-700"
                >
                  <X className="h-4 w-4 me-1" />
                  {t("properties.filters.clear")}
                </Button>
              )}
            </div>
          </div>
        </CardHeader>

        {/* Content */}
        <CardContent>
          {loading ? (
            viewMode === "grid" ? (
              /* Grid Loading Skeleton */
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Card key={i} className="overflow-hidden p-0">
                    <div className="relative">
                      <div className="h-48 w-full bg-gray-200 animate-pulse" />
                      <div className="absolute top-2 end-2">
                        <div className="h-6 w-16 bg-gray-300 rounded animate-pulse" />
                      </div>
                    </div>
                    <CardContent className="p-4">
                      <div className="space-y-2">
                        <div className="h-6 w-3/4 bg-gray-200 rounded animate-pulse" />
                        <div className="h-4 w-full bg-gray-200 rounded animate-pulse" />
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="space-y-1">
                          <div className="h-4 w-12 bg-gray-200 rounded animate-pulse" />
                          <div className="h-6 w-20 bg-gray-200 rounded animate-pulse" />
                        </div>
                        <div className="h-8 w-8 bg-gray-200 rounded animate-pulse" />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : viewMode === "rows" ? (
              /* Rows Loading Skeleton */
              <div className="space-y-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Card key={i} className="overflow-hidden py-0">
                    <CardContent className="p-0">
                      <div className="flex items-center h-20">
                        <div className="w-32 h-20 bg-gray-200 animate-pulse flex-shrink-0" />
                        <div className="flex-1 px-4 py-3 space-y-2">
                          <div className="h-5 w-1/3 bg-gray-200 rounded animate-pulse" />
                          <div className="h-4 w-1/2 bg-gray-200 rounded animate-pulse" />
                        </div>
                        <div className="px-4 space-y-2">
                          <div className="h-4 w-16 bg-gray-200 rounded animate-pulse" />
                          <div className="h-4 w-12 bg-gray-200 rounded animate-pulse" />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              /* Table Loading Skeleton */
              <div className="space-y-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div
                    key={i}
                    className="flex items-center space-x-4 py-4 border-b border-gray-100"
                  >
                    <div className="w-4 h-4 bg-gray-200 rounded animate-pulse" />
                    <div className="w-10 h-10 bg-gray-200 rounded animate-pulse" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 w-1/4 bg-gray-200 rounded animate-pulse" />
                      <div className="h-3 w-1/3 bg-gray-200 rounded animate-pulse" />
                    </div>
                    <div className="w-16 h-4 bg-gray-200 rounded animate-pulse" />
                    <div className="w-20 h-4 bg-gray-200 rounded animate-pulse" />
                    <div className="w-24 h-4 bg-gray-200 rounded animate-pulse" />
                    <div className="w-8 h-8 bg-gray-200 rounded animate-pulse" />
                  </div>
                ))}
              </div>
            )
          ) : error ? (
            <div className="flex items-center justify-center py-16">
              <AlertCircle className="h-8 w-8 text-red-500" />
              <span className="ms-2 text-red-600">{error}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={fetchProperties}
                className="ms-4"
              >
                {t("maintenance.emergency.retry", { defaultValue: "Try again" })}
              </Button>
            </div>
          ) : properties.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <div className="flex items-center justify-center">
                <Building2 className="h-8 w-8 text-gray-400" />
                <span className="ms-2 text-gray-600">
                  {t("properties.empty.title")}
                </span>
              </div>
              <Link href="/dashboard/properties/new">
                <Button size="sm">
                  <Plus className="h-4 w-4 me-2" />
                  {t("properties.empty.addFirst")}
                </Button>
              </Link>
            </div>
          ) : viewMode === "grid" ? (
            /* Grid View */
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6">
                {properties.map((property) => (
                  <PropertyCard
                    key={property._id}
                    property={property}
                    onEdit={(property) =>
                      router.push(`/dashboard/properties/${property._id}/edit`)
                    }
                    onDelete={handleDeleteClick}
                    onView={(property) =>
                      router.push(`/dashboard/properties/${property._id}`)
                    }
                    onStatusChange={(property, status) =>
                      handleStatusChange(property._id, status)
                    }
                    deleteLoading={deleteLoading === property._id}
                  />
                ))}
              </div>
              {pagination.total > 0 && (
                <GlobalPagination
                  currentPage={filters.page || 1}
                  totalPages={Math.max(
                    1,
                    Math.ceil(pagination.total / (filters.limit ?? 12)),
                  )}
                  totalItems={pagination.total}
                  pageSize={filters.limit ?? 12}
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
                  disabled={loading || isSearching}
                />
              )}
            </>
          ) : viewMode === "rows" ? (
            /* Row View */
            <>
              <div className="space-y-4">
                {properties.map((property) => (
                  <PropertyRowCard
                    key={property._id}
                    property={property}
                    onEdit={(property) =>
                      router.push(`/dashboard/properties/${property._id}/edit`)
                    }
                    onDelete={handleDeleteClick}
                    onView={(property) =>
                      router.push(`/dashboard/properties/${property._id}`)
                    }
                    onStatusChange={(property, status) =>
                      handleStatusChange(property._id, status)
                    }
                    deleteLoading={deleteLoading === property._id}
                  />
                ))}
              </div>
              {pagination.total > 0 && (
                <GlobalPagination
                  currentPage={filters.page || 1}
                  totalPages={Math.max(
                    1,
                    Math.ceil(pagination.total / (filters.limit ?? 12)),
                  )}
                  totalItems={pagination.total}
                  pageSize={filters.limit ?? 12}
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
                  disabled={loading || isSearching}
                />
              )}
            </>
          ) : (
            /* List View - Table using DataTable component */
            <>
              <DataTable<PropertyResponse>
                columns={propertyColumns}
                data={properties}
                loading={loading}
                getRowKey={(property) => property._id}
                // The header and the sort menu are one order, applied by the
                // API across every page. It orders by name or by date added
                // only, so the other headers stay plain; a third click goes
                // back to the menu's default, newest first.
                sort={{
                  key: filters.sortBy ?? null,
                  direction: filters.sortOrder ?? "desc",
                  onSortChange: (key, direction) =>
                    setFilters((prev) => ({
                      ...prev,
                      sortBy: key === "name" ? "name" : "createdAt",
                      sortOrder: key ? direction : "desc",
                      page: 1,
                    })),
                }}
                selection={{
                  enabled: true,
                  selectedIds: selectedProperties,
                  onSelectAll: handleSelectAll,
                  onSelectRow: (id, checked) =>
                    handleSelectProperty(id, checked),
                  getRowId: (property) => property._id,
                  isRowDisabled: (property) => !!property.deletedAt,
                  selectAllLabel: t("properties.table.selectAll"),
                  selectRowLabel: (property) =>
                    t("properties.table.selectProperty", {
                      values: {
                        name:
                          property.name || t("properties.row.unknownProperty"),
                      },
                    }),
                }}
                emptyState={{
                  icon: <Building2 className="h-8 w-8 text-gray-400" />,
                  title: t("properties.empty.title"),
                  action: (
                    <Link href="/dashboard/properties/new">
                      <Button variant="outline" size="sm">
                        <Plus className="h-4 w-4 me-2" />
                        {t("properties.empty.addFirst")}
                      </Button>
                    </Link>
                  ),
                }}
              />
              {pagination.total > 0 && (
                <GlobalPagination
                  currentPage={filters.page || 1}
                  totalPages={Math.max(
                    1,
                    Math.ceil(pagination.total / (filters.limit ?? 12)),
                  )}
                  totalItems={pagination.total}
                  pageSize={filters.limit ?? 12}
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
                  disabled={loading || isSearching}
                />
              )}
            </>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("properties.bulk.deleteTitle", {
                defaultValue: "Delete {count} buildings?",
                values: { count: selectedProperties.length },
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("properties.bulk.deleteDescription", {
                defaultValue:
                  "They move to the Archive, where they can be restored. Buildings that are let or have a contract in force are skipped.",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkDeleteLoading}>
              {t("properties.deleteDialog.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void handleBulkDelete();
              }}
              disabled={bulkDeleteLoading}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
            >
              {bulkDeleteLoading
                ? t("properties.deleteDialog.deleting")
                : t("properties.bulk.deleteConfirm", {
                    defaultValue: "Delete buildings",
                  })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("properties.deleteDialog.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("properties.deleteDialog.description", {
                values: {
                  name:
                    propertyToDelete?.name ||
                    t("properties.row.unknownProperty"),
                },
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={handleDeleteCancel}
              disabled={deleteLoading === propertyToDelete?._id}
            >
              {t("properties.deleteDialog.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={deleteLoading === propertyToDelete?._id}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
            >
              {deleteLoading === propertyToDelete?._id
                ? t("properties.deleteDialog.deleting")
                : t("properties.deleteDialog.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
