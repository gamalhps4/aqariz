"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import Image from "@/components/ui/app-image";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useState, useEffect, useCallback } from "react";
import { GlobalSearch } from "@/components/ui/global-search";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CategorySelectItems } from "@/components/properties/category-select-items";
import {
  Building2,
  Plus,
  Eye,
  MapPin,
  Bed,
  Bath,
  Square,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  Grid3X3,
  List,
  Rows3,
  MoreHorizontal,
  X,
  Home,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PropertyStatus, PropertyType } from "@/types";
import {
  propertyService,
  AvailableUnitResponse,
  PropertyQueryParams,
} from "@/lib/services/property.service";
import UnitStats from "@/components/properties/UnitStats";
import { GlobalPagination } from "@/components/ui/global-pagination";
import UnitDetailsModal from "@/components/properties/UnitDetailsModal";
import { useViewPreferencesStore } from "@/stores/view-preferences.store";
import { getFeaturedImage, hasPropertyImages } from "@/lib/utils/image-utils";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { SortableTableHead, serverTableSort } from "@/components/ui/sortable-table";
import { usePropertyCategories } from "@/hooks/use-property-categories";

interface UnitCardProps {
  unit: AvailableUnitResponse;
  onViewDetails: (propertyId: string, unitId: string) => void;
}

function UnitCard({ unit, onViewDetails }: UnitCardProps) {
  const { t, formatCurrency: formatCurrencyLocalized } =
    useLocalizationContext();
  const { labelFor: unitTypeLabel } = usePropertyCategories("unit", { activeOnly: false });

  // Safe image handling using utility functions
  const hasImage = hasPropertyImages(unit);
  const featuredImage = getFeaturedImage(unit);

  return (
    <Card className="group hover:shadow-lg py-0 gap-0 transition-all duration-200 overflow-hidden border-0 shadow-sm">
      {/* Featured Image */}
      <div className="relative h-48 overflow-hidden bg-gray-100 dark:bg-gray-800">
        {hasImage ? (
          <Image
            src={featuredImage!}
            alt={`${unit.name} - Unit ${unit.unitNumber}`}
            fill
            className="object-cover group-hover:scale-105 transition-transform duration-300"
            sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-800 dark:to-gray-900">
            <Building2 className="h-16 w-16 text-gray-400 dark:text-gray-600" />
          </div>
        )}

        {/* Status Badge */}
        <div className="absolute top-3 start-3">
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border bg-green-100 dark:bg-green-950/30 text-green-800 dark:text-green-300 border-green-200 dark:border-green-800">
            <CheckCircle className="h-3 w-3 me-1" />
            {t("properties.available.card.available")}
          </span>
        </div>

        {/* Unit Type Badge */}
        <div className="absolute top-3 end-3">
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-950/30 text-blue-800 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
            <Home className="h-3 w-3 me-1" />
            <span>
              {unitTypeLabel(unit.unitType)}
            </span>
          </span>
        </div>

        {/* Overlay Actions */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors duration-200 flex items-center justify-center opacity-0 group-hover:opacity-100">
          <div className="flex space-x-2">
            <Link
              href={`/dashboard/properties/${unit._id}/units/${unit.unitId}`}
            >
              <Button
                size="sm"
                variant="secondary"
                className="bg-white/90 hover:bg-white text-gray-900"
              >
                <Eye className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </div>

      {/* Card Content */}
      <CardContent className="p-4">
        {/* Property & Unit Name */}
        <div className="mb-3">
          <h3 className="font-semibold text-lg text-gray-900 dark:text-gray-100 mb-1 line-clamp-1">
            {unit.name} - {t("properties.available.card.unit")}{" "}
            {unit.unitNumber}
          </h3>
          {unit.description && (
            <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2">
              {unit.description}
            </p>
          )}
        </div>

        {/* Location */}
        <div className="flex items-center text-sm text-gray-600 dark:text-gray-400 mb-3">
          <MapPin className="h-4 w-4 me-1 flex-shrink-0" />
          <span className="line-clamp-1">
            {unit.address.city}, {unit.address.state}
          </span>
        </div>

        {/* Unit Details */}
        <div className="flex items-center justify-between text-sm text-gray-600 dark:text-gray-400 mb-4">
          <div className="flex items-center space-x-4">
            <div className="flex items-center">
              <Bed className="h-4 w-4 me-1" />
              <span>{unit.bedrooms}</span>
            </div>
            <div className="flex items-center">
              <Bath className="h-4 w-4 me-1" />
              <span>{unit.bathrooms}</span>
            </div>
            <div className="flex items-center">
              <Square className="h-4 w-4 me-1" />
              <span>
                {unit.squareFootage.toLocaleString()} {t("properties.labels.squareFeetUnit", { defaultValue: "m²" })}
              </span>
            </div>
          </div>
        </div>

        {/* Floor Info */}
        {unit.floor != null && (
          <div className="flex items-center text-sm text-gray-600 dark:text-gray-400 mb-3">
            <span className="text-xs bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">
              {t("properties.available.card.floor", {
                values: { floor: unit.floor },
              })}
            </span>
          </div>
        )}

        {/* Rent & Actions */}
        <div className="flex items-center justify-between">
          <div className="flex items-center text-lg font-semibold text-gray-900 dark:text-gray-100">
            <span>{formatCurrencyLocalized(unit.rentAmount)}</span>
            <span className="text-sm font-normal text-gray-600 dark:text-gray-400 ms-1">
              {t("properties.available.card.perMonth")}
            </span>
          </div>

          {/* Actions Menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => onViewDetails(unit._id, unit.unitId)}
              >
                <Eye className="h-4 w-4 me-2" />
                {t("properties.available.menu.viewUnitDetails")}
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href={`/dashboard/properties/${unit._id}`}>
                  <Building2 className="h-4 w-4 me-2" />
                  {t("properties.available.menu.viewProperty")}
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AvailablePropertiesPage() {
  const { t, formatCurrency: formatCurrencyLocalized } =
    useLocalizationContext();
  const { labelFor: unitTypeLabel } = usePropertyCategories("unit", { activeOnly: false });
  const router = useRouter();
  const searchParams = useSearchParams();

  const [availableUnits, setAvailableUnits] = useState<AvailableUnitResponse[]>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const viewMode = useViewPreferencesStore(
    (state) => state.availablePropertiesView,
  );
  const setViewMode = useViewPreferencesStore(
    (state) => state.setAvailablePropertiesView,
  );

  // Unit Details Dialog State
  const [selectedUnit, setSelectedUnit] = useState<{
    propertyId: string;
    unitId: string;
  } | null>(null);
  const [unitDetailsOpen, setUnitDetailsOpen] = useState(false);

  // Filter states
  const [filters, setFilters] = useState<PropertyQueryParams>({
    page: parseInt(searchParams.get("page") || "1"),
    limit: parseInt(searchParams.get("limit") || "12"),
    sortBy: "createdAt",
    sortOrder: "desc",
    search: "",
  });

  const [pagination, setPagination] = useState({
    page: 1,
    limit: 10,
    total: 0,
    pages: 0,
    hasNext: false,
    hasPrev: false,
  });

  const fetchAvailableUnits = useCallback(async () => {
    try {
      if (!filters.search) {
        setLoading(true);
      }
      setIsSearching(true);
      setError(null);
      const response = await propertyService.getAllUnits({
        ...filters,
        status: PropertyStatus.AVAILABLE,
      });
      setAvailableUnits(response.data);
      setPagination(response.pagination);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : t("properties.available.loadFailed", { defaultValue: "Could not load the available units" });
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
      setIsSearching(false);
    }
  }, [filters]);

  useEffect(() => {
    fetchAvailableUnits();
  }, [fetchAvailableUnits]);

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
  // The headers order the whole list through /api/units, not the page on
  // screen. Location has no order there, so its header stays plain; a third
  // click goes back to the default, newest first.
  const headerSort = serverTableSort(
    { key: filters.sortBy ?? null, direction: filters.sortOrder === "asc" ? "asc" : "desc" },
    (key, direction) =>
      setFilters((prev) => ({
        ...prev,
        sortBy: key ? (key as PropertyQueryParams["sortBy"]) : "createdAt",
        sortOrder: key ? direction : "desc",
        page: 1,
      })),
  );
  const handlePageSizeChange = (size: number) => {
    setFilters((prev) => ({ ...prev, limit: size, page: 1 }));
  };

  // Handle opening unit details dialog
  const handleViewUnitDetails = (propertyId: string, unitId: string) => {
    setSelectedUnit({ propertyId, unitId });
    setUnitDetailsOpen(true);
  };

  // Handle unit updates
  const handleUnitUpdated = () => {
    fetchAvailableUnits();
  };

  // Handle unit deletion
  const handleUnitDeleted = () => {
    fetchAvailableUnits();
    setUnitDetailsOpen(false);
    setSelectedUnit(null);
  };

  const pageSize = filters.limit ?? 12;
  const currentPage = filters.page || 1;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("properties.available.header.title")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("properties.available.header.subtitle")}
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchAvailableUnits}
            disabled={loading}
          >
            <RefreshCw
              className={`h-4 w-4 me-2 ${loading ? "animate-spin" : ""}`}
            />
            {t("properties.available.actions.refresh")}
          </Button>
          <Link href="/dashboard/properties/new">
            <Button size="sm">
              <Plus className="h-4 w-4 me-2" />
              {t("properties.available.actions.addProperty")}
            </Button>
          </Link>
        </div>
      </div>

      {/* Unit Statistics */}
      <UnitStats units={availableUnits} variant="available" />

      {/* Available Units with Integrated Filters */}
      <Card className="gap-3">
        <CardHeader>
          {/* Main Header */}
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-50 dark:bg-green-900/30 rounded-lg border border-green-100 dark:border-green-800">
                <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {t("properties.available.card.title")}
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {t("properties.available.card.subtitle")}
                </p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              {/* View Mode Toggle */}
              <div className="flex items-center border rounded-lg p-1 w-full sm:w-auto">
                <Button
                  variant={viewMode === "grid" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setViewMode("grid")}
                  className="h-8 flex-1 sm:flex-none sm:px-3"
                >
                  <Grid3X3 className="h-4 w-4" />
                  <span className="ms-1 sm:hidden">{t("properties.view.grid", { defaultValue: "Grid" })}</span>
                </Button>
                <Button
                  variant={viewMode === "rows" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setViewMode("rows")}
                  className="h-8 flex-1 sm:flex-none sm:px-3"
                >
                  <Rows3 className="h-4 w-4" />
                  <span className="ms-1 sm:hidden">{t("properties.view.rows", { defaultValue: "Rows" })}</span>
                </Button>
                <Button
                  variant={viewMode === "list" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setViewMode("list")}
                  className="h-8 flex-1 sm:flex-none sm:px-3"
                >
                  <List className="h-4 w-4" />
                  <span className="ms-1 sm:hidden">{t("properties.view.list", { defaultValue: "List" })}</span>
                </Button>
              </div>
            </div>
          </div>

          {/* Integrated Filters Bar */}
          <div className="flex flex-col lg:flex-row lg:items-center gap-4 p-4 bg-gray-50/50 dark:bg-gray-800/50 rounded-lg border border-gray-200/60 dark:border-gray-700/60">
            {/* Search */}
            <div className="flex-1 min-w-0">
              <GlobalSearch
                placeholder={t(
                  "properties.available.filters.search.placeholder",
                )}
                initialValue={filters.search || ""}
                debounceDelay={300}
                onSearch={handleSearch}
                isLoading={isSearching}
                className="w-full"
                ariaLabel={t("properties.available.searchAria", { defaultValue: "Search available units" })}
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
                  <SelectValue
                    placeholder={t("properties.available.filters.type.all")}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t("properties.available.filters.type.all")}
                  </SelectItem>
                  {Object.values(PropertyType).map((type) => (
                    <SelectItem key={type} value={type}>
                      {type.charAt(0).toUpperCase() + type.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Bedrooms */}
              <Select
                value={filters.bedrooms?.toString() || "all"}
                onValueChange={(value) =>
                  handleFilterChange(
                    "bedrooms",
                    value === "all" ? undefined : parseInt(value),
                  )
                }
              >
                <SelectTrigger className="w-[120px] h-10 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                  <SelectValue
                    placeholder={t("properties.available.filters.bedrooms.any")}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t("properties.available.filters.bedrooms.any")}
                  </SelectItem>
                  <SelectItem value="1">
                    {t("properties.available.filters.bedrooms.one")}
                  </SelectItem>
                  <SelectItem value="2">
                    {t("properties.available.filters.bedrooms.two")}
                  </SelectItem>
                  <SelectItem value="3">
                    {t("properties.available.filters.bedrooms.three")}
                  </SelectItem>
                  <SelectItem value="4">
                    {t("properties.available.filters.bedrooms.four")}
                  </SelectItem>
                  <SelectItem value="5">
                    {t("properties.available.filters.bedrooms.fivePlus")}
                  </SelectItem>
                </SelectContent>
              </Select>

              {/* Bathrooms */}
              <Select
                value={filters.bathrooms?.toString() || "all"}
                onValueChange={(value) =>
                  handleFilterChange(
                    "bathrooms",
                    value === "all" ? undefined : parseInt(value),
                  )
                }
              >
                <SelectTrigger className="w-[120px] h-10 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                  <SelectValue
                    placeholder={t(
                      "properties.available.filters.bathrooms.any",
                    )}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t("properties.available.filters.bathrooms.any")}
                  </SelectItem>
                  <SelectItem value="1">
                    {t("properties.available.filters.bathrooms.one")}
                  </SelectItem>
                  <SelectItem value="2">
                    {t("properties.available.filters.bathrooms.two")}
                  </SelectItem>
                  <SelectItem value="3">
                    {t("properties.available.filters.bathrooms.three")}
                  </SelectItem>
                  <SelectItem value="4">
                    {t("properties.available.filters.bathrooms.fourPlus")}
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
                    placeholder={t("properties.available.filters.unitType.all")}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t("properties.available.filters.unitType.all")}
                  </SelectItem>
                  <CategorySelectItems kind="unit" />
                </SelectContent>
              </Select>

              {/* Clear Filters */}
              {(filters.search ||
                filters.type ||
                filters.bedrooms ||
                filters.bathrooms ||
                filters.minRent ||
                filters.maxRent ||
                filters.unitType) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setFilters({
                      page: 1,
                      limit: 10,
                      sortBy: "createdAt",
                      sortOrder: "desc",
                      search: "",
                    })
                  }
                  className="h-10 px-3 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                >
                  <X className="h-4 w-4 me-1" />
                  {t("properties.available.filters.clear")}
                </Button>
              )}
            </div>
          </div>
        </CardHeader>

        {/* Content */}
        <CardContent>
          {loading ? (
            viewMode === "grid" ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Card key={i} className="overflow-hidden py-0 gap-0">
                    <Skeleton className="h-48 w-full" />
                    <CardContent className="p-4 space-y-3">
                      <div className="space-y-2">
                        <Skeleton className="h-6 w-3/4" />
                        <Skeleton className="h-4 w-full" />
                      </div>
                      <div className="flex items-center gap-1">
                        <Skeleton className="h-4 w-4" />
                        <Skeleton className="h-4 w-32" />
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-1">
                          <Skeleton className="h-4 w-4" />
                          <Skeleton className="h-4 w-4" />
                        </div>
                        <div className="flex items-center gap-1">
                          <Skeleton className="h-4 w-4" />
                          <Skeleton className="h-4 w-4" />
                        </div>
                        <div className="flex items-center gap-1">
                          <Skeleton className="h-4 w-4" />
                          <Skeleton className="h-4 w-16" />
                        </div>
                      </div>
                      <Skeleton className="h-6 w-16" />
                      <div className="flex items-center justify-between pt-1">
                        <div className="flex items-center gap-1">
                          <Skeleton className="h-6 w-20" />
                          <Skeleton className="h-4 w-8" />
                        </div>
                        <Skeleton className="h-8 w-8" />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : viewMode === "rows" ? (
              <div className="space-y-3">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Card key={i} className="overflow-hidden py-0 gap-0">
                    <Skeleton className="h-48 w-full" />
                    <CardContent className="p-4 space-y-3">
                      <div className="space-y-2">
                        <Skeleton className="h-6 w-3/4" />
                        <Skeleton className="h-4 w-full" />
                      </div>
                      <div className="flex items-center gap-1">
                        <Skeleton className="h-4 w-4" />
                        <Skeleton className="h-4 w-32" />
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-1">
                          <Skeleton className="h-4 w-4" />
                          <Skeleton className="h-4 w-4" />
                        </div>
                        <div className="flex items-center gap-1">
                          <Skeleton className="h-4 w-4" />
                          <Skeleton className="h-4 w-4" />
                        </div>
                        <div className="flex items-center gap-1">
                          <Skeleton className="h-4 w-4" />
                          <Skeleton className="h-4 w-16" />
                        </div>
                      </div>
                      <Skeleton className="h-6 w-16" />
                      <div className="flex items-center justify-between pt-1">
                        <div className="flex items-center gap-1">
                          <Skeleton className="h-6 w-20" />
                          <Skeleton className="h-4 w-8" />
                        </div>
                        <Skeleton className="h-8 w-8" />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                <Table>
                  <TableHeader className="bg-gray-50/50 dark:bg-gray-800/50">
                    <TableRow className="border-b border-gray-200 dark:border-gray-700">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <TableHead key={i} className="py-3 px-4">
                          <Skeleton className="h-4 w-24" />
                        </TableHead>
                      ))}
                      <TableHead className="text-end py-3 px-6">
                        <Skeleton className="h-4 w-24" />
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Array.from({ length: 8 }).map((_, rowIndex) => (
                      <TableRow
                        key={rowIndex}
                        className="border-b border-gray-100 dark:border-gray-800"
                      >
                        <TableCell className="py-4 px-6">
                          <div className="flex items-center space-x-3">
                            <Skeleton className="h-10 w-10 rounded-lg" />
                            <div className="space-y-1">
                              <Skeleton className="h-4 w-24" />
                              <Skeleton className="h-3 w-16" />
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="py-4 px-4">
                          <div className="space-y-1">
                            <Skeleton className="h-4 w-28" />
                            <Skeleton className="h-3 w-16" />
                          </div>
                        </TableCell>
                        <TableCell className="py-4 px-4">
                          <div className="space-y-1">
                            <div className="flex items-center gap-1">
                              <Skeleton className="h-3 w-3" />
                              <Skeleton className="h-3 w-32" />
                            </div>
                            <Skeleton className="h-3 w-24" />
                          </div>
                        </TableCell>
                        <TableCell className="py-4 px-4">
                          <div className="space-y-1">
                            <div className="flex items-center gap-3">
                              <Skeleton className="h-3 w-6" />
                              <Skeleton className="h-3 w-6" />
                            </div>
                            <Skeleton className="h-3 w-16" />
                          </div>
                        </TableCell>
                        <TableCell className="py-4 px-4">
                          <Skeleton className="h-4 w-20" />
                        </TableCell>
                        <TableCell className="text-end py-4 px-6">
                          <Skeleton className="h-8 w-8" />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )
          ) : error ? (
            <div className="flex items-center justify-center">
              <AlertCircle className="h-8 w-8 text-red-500 dark:text-red-400" />
              <span className="ms-2 text-red-600 dark:text-red-400">
                {error}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={fetchAvailableUnits}
                className="ms-4"
              >
                {t("properties.available.error.tryAgain")}
              </Button>
            </div>
          ) : !loading && availableUnits.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 space-y-3">
              <Building2 className="h-12 w-12 text-muted-foreground" />
              <h3 className="text-lg font-semibold">
                {t("properties.available.empty.title")}
              </h3>
              <p className="text-muted-foreground text-center">
                {t("properties.available.empty.noneAvailable", {
                  defaultValue:
                    "Get started by adding a property with available units.",
                })}
              </p>
              <Link href="/dashboard/properties/new">
                <Button>
                  <Plus className="h-4 w-4 me-2" />
                  {t("properties.available.empty.addProperty")}
                </Button>
              </Link>
            </div>
          ) : viewMode === "grid" ? (
            /* Grid View */
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {availableUnits.map((unit) => (
                <UnitCard
                  key={`${unit._id}-${unit.unitId}`}
                  unit={unit}
                  onViewDetails={handleViewUnitDetails}
                />
              ))}
            </div>
          ) : viewMode === "rows" ? (
            /* Row View */
            <div className="space-y-3">
              {availableUnits.map((unit) => (
                <UnitCard
                  key={`${unit._id}-${unit.unitId}`}
                  unit={unit}
                  onViewDetails={handleViewUnitDetails}
                />
              ))}
            </div>
          ) : (
            /* List View - Table */
            <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
              <Table>
                <TableHeader className="bg-gray-50/50 dark:bg-gray-800/50">
                  <TableRow className="border-b border-gray-200 dark:border-gray-700">
                    <SortableTableHead sort={headerSort} column="unitNumber" className="text-start font-medium text-gray-700 dark:text-gray-300 py-3 px-6">
                      {t("properties.available.table.unit")}
                    </SortableTableHead>
                    <SortableTableHead sort={headerSort} column="name" className="text-start font-medium text-gray-700 dark:text-gray-300 py-3 px-4">
                      {t("properties.available.table.property")}
                    </SortableTableHead>
                    <TableHead className="text-start font-medium text-gray-700 dark:text-gray-300 py-3 px-4">
                      {t("properties.available.table.location")}
                    </TableHead>
                    {/* The area, the one figure here the API orders by. */}
                    <SortableTableHead sort={headerSort} column="squareFootage" className="text-start font-medium text-gray-700 dark:text-gray-300 py-3 px-4">
                      {t("properties.available.table.details")}
                    </SortableTableHead>
                    <SortableTableHead sort={headerSort} column="rentAmount" className="text-start font-medium text-gray-700 dark:text-gray-300 py-3 px-4">
                      {t("properties.available.table.rent")}
                    </SortableTableHead>
                    <TableHead className="text-end font-medium text-gray-700 dark:text-gray-300 py-3 px-6">
                      {t("properties.available.table.actions")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {availableUnits.map((unit, index) => (
                    <TableRow
                      key={`${unit._id}-${unit.unitId}`}
                      className={`border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition-colors ${
                        index % 2 === 0
                          ? "bg-white dark:bg-gray-900/20"
                          : "bg-gray-50/20 dark:bg-gray-800/20"
                      }`}
                    >
                      <TableCell className="py-4 px-6">
                        <div className="flex items-center space-x-3">
                          <div className="relative w-10 h-10 rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-800 flex-shrink-0">
                            {hasPropertyImages(unit) ? (
                              <Image
                                src={getFeaturedImage(unit)!}
                                alt={`${unit.name} - Unit ${unit.unitNumber}`}
                                fill
                                className="object-cover"
                                sizes="40px"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-800 dark:to-gray-900">
                                <Building2 className="h-5 w-5 text-gray-400 dark:text-gray-600" />
                              </div>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="font-medium text-gray-900 dark:text-gray-100">
                              <Link
                                href={`/dashboard/properties/${unit._id}/units/${unit.unitId}`}
                                className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                              >
                                {t("properties.available.card.unit")}{" "}
                                {unit.unitNumber}
                              </Link>
                            </div>
                            <div className="text-sm text-gray-500 dark:text-gray-400 truncate">
                              {unitTypeLabel(unit.unitType)}
                              {unit.floor != null &&
                                ` • ${t("properties.available.card.floor", {
                                  values: { floor: unit.floor },
                                })}`}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="py-4 px-4">
                        <div className="flex flex-col space-y-1">
                          <div className="font-medium text-gray-900 dark:text-gray-100">
                            <Link
                              href={`/dashboard/properties/${unit._id}`}
                              className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                            >
                              {unit.name}
                            </Link>
                          </div>
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            {unit.type.charAt(0).toUpperCase() +
                              unit.type.slice(1)}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="py-4 px-4">
                        <div className="flex flex-col space-y-1">
                          <div className="flex items-center text-sm text-gray-900 dark:text-gray-100">
                            <MapPin className="h-3 w-3 me-1 text-gray-400 dark:text-gray-500" />
                            {unit.address.city}, {unit.address.state}
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            {unit.address.street}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="py-4 px-4">
                        <div className="flex flex-col space-y-1">
                          <div className="flex items-center space-x-3 text-sm text-gray-900 dark:text-gray-100">
                            <div className="flex items-center">
                              <Bed className="h-3 w-3 me-1 text-gray-400 dark:text-gray-500" />
                              {unit.bedrooms}
                            </div>
                            <div className="flex items-center">
                              <Bath className="h-3 w-3 me-1 text-gray-400 dark:text-gray-500" />
                              {unit.bathrooms}
                            </div>
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            {unit.squareFootage.toLocaleString()}{" "}
                            {t("properties.available.table.squareFeet")}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="py-4 px-4">
                        <div className="flex flex-col space-y-1">
                          <div className="font-medium text-gray-900 dark:text-gray-100">
                            {formatCurrencyLocalized(unit.rentAmount)}
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            {t("properties.available.table.perMonth")}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-end py-4 px-6">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0 hover:bg-gray-100 transition-colors"
                            >
                              <MoreHorizontal className="h-4 w-4 text-gray-500" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() =>
                                handleViewUnitDetails(unit._id, unit.unitId)
                              }
                            >
                              <Eye className="h-4 w-4 me-2" />
                              {t("properties.available.menu.viewUnitDetails")}
                            </DropdownMenuItem>
                            <DropdownMenuItem asChild>
                              <Link href={`/dashboard/properties/${unit._id}`}>
                                <Building2 className="h-4 w-4 me-2" />
                                {t("properties.available.menu.viewProperty")}
                              </Link>
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
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
              onPageSizeChange={(size) => {
                const params = new URLSearchParams(
                  Array.from(searchParams.entries()),
                );
                params.set("limit", size.toString());
                params.set("page", "1");
                router.push(
                  `/dashboard/properties/available?${params.toString()}`,
                );
                setFilters((prev) => ({ ...prev, limit: size, page: 1 }));
              }}
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

      {/* Unit Details Modal */}
      {selectedUnit && (
        <UnitDetailsModal
          open={unitDetailsOpen}
          onOpenChange={setUnitDetailsOpen}
          propertyId={selectedUnit.propertyId}
          unitId={selectedUnit.unitId}
          onUnitUpdated={handleUnitUpdated}
          onUnitDeleted={handleUnitDeleted}
        />
      )}
    </div>
  );
}
