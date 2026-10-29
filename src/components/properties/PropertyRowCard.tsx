"use client";

import React from "react";
import Image from "@/components/ui/app-image";
import Link from "next/link";
import {
  Building2,
  MapPin,
  Eye,
  Edit,
  MoreHorizontal,
  Trash2,
  Users,
  AlertCircle,
  XCircle,
  CheckCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PropertyStatus, PropertyType } from "@/types";
import { PropertyResponse } from "@/lib/services/property.service";
import { getFeaturedImage, hasPropertyImages } from "@/lib/utils/image-utils";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

interface PropertyRowCardProps {
  property: PropertyResponse;
  onEdit?: (property: PropertyResponse) => void;
  onDelete?: (property: PropertyResponse) => void;
  onView?: (property: PropertyResponse) => void;
  onStatusChange?: (property: PropertyResponse, status: PropertyStatus) => void;
  deleteLoading?: boolean;
  showActions?: boolean;
}

export function PropertyRowCard({
  property,
  onEdit,
  onDelete,
  onView,
  onStatusChange,
  deleteLoading = false,
  showActions = true,
}: PropertyRowCardProps) {
  const { t, formatCurrency: formatCurrencyLocalized } =
    useLocalizationContext();

  // Safe image handling using utility functions
  const hasImage = hasPropertyImages(property);
  const featuredImage = getFeaturedImage(property);
  const propertyStatus = property?.status as PropertyStatus | undefined;
  const propertyType = property?.type as PropertyType | undefined;
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
  const propertyId = property?._id ?? "";

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

  const getTypeIcon = (type?: PropertyType) => {
    switch (type) {
      case PropertyType.HOUSE:
        return "🏠";
      case PropertyType.APARTMENT:
        return "🏢";
      case PropertyType.CONDO:
        return "🏘️";
      case PropertyType.TOWNHOUSE:
        return "🏘️";
      case PropertyType.COMMERCIAL:
        return "🏢";
      default:
        return "🏠";
    }
  };

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
  const getRentRange = (units?: PropertyResponse["units"]) => {
    if (!units || units.length === 0) return null;

    const rents = units.map((unit) => unit.rentAmount);
    const minRent = Math.min(...rents);
    const maxRent = Math.max(...rents);

    if (minRent === maxRent) {
      return formatCurrencyLocalized(minRent);
    }

    return `${formatCurrencyLocalized(minRent)} - ${formatCurrencyLocalized(
      maxRent
    )}`;
  };

  // Get unit statistics for multi-unit properties
  const unitStats = getUnitStats(property?.units);
  const rentRange = getRentRange(property?.units);

  return (
    <Card className="group hover:shadow-md transition-all duration-200 overflow-hidden border border-gray-200 dark:border-gray-700 shadow-sm bg-white dark:bg-gray-800 p-0 gap-0 rounded-lg">
      <CardContent className="p-0">
        <div className="flex items-center h-24 sm:h-20">
          {/* Property Image */}
          <div className="relative w-24 h-24 sm:w-32 sm:h-20 flex-shrink-0 overflow-hidden bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-700 dark:to-gray-800 rounded-s-lg m-0 p-0">
            {hasImage ? (
              <Image
                src={featuredImage!}
                alt={propertyName}
                fill
                className="object-cover object-center w-full h-full group-hover:scale-105 transition-transform duration-300 m-0 p-0"
                sizes="(max-width: 640px) 96px, 128px"
                priority={false}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-700 dark:to-gray-600">
                <Building2 className="h-6 w-6 sm:h-8 sm:w-8 text-gray-400 dark:text-gray-500" />
              </div>
            )}

            {/* Status Badge */}
            <div className="absolute top-1 start-1">
              <span
                className={`inline-flex items-center px-1 py-0.5 sm:px-1.5 rounded text-xs font-medium border ${getStatusColor(
                  propertyStatus
                )}`}
              >
                <span className="hidden sm:inline">
                  {propertyStatus
                    ? t(`properties.status.${propertyStatus.toLowerCase()}`)
                    : t("properties.status.unknown")}
                </span>
                <span className="sm:hidden">
                  {propertyStatus
                    ? t(`properties.status.${propertyStatus.toLowerCase()}`)
                        .charAt(0)
                        .toUpperCase()
                    : "?"}
                </span>
              </span>
            </div>

            {/* Type Badge */}
            <div className="absolute top-1 end-1">
              <span className="inline-flex items-center px-1 py-0.5 sm:px-1.5 rounded text-xs font-medium bg-white/90 dark:bg-gray-800/90 text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-600">
                {getTypeIcon(propertyType)}
              </span>
            </div>
          </div>

          {/* Property Information */}
          <div className="flex-1 px-2 sm:px-4 py-3 min-w-0">
            {/* Mobile Layout */}
            <div className="sm:hidden">
              <div className="flex justify-between items-start mb-2">
                <div className="flex-1 min-w-0 me-2">
                  <h3 className="font-semibold text-sm text-gray-900 dark:text-gray-100 truncate">
                    {onView ? (
                      <button
                        onClick={() => onView(property)}
                        className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors text-start"
                      >
                        {propertyName}
                      </button>
                    ) : (
                      <Link
                        href={`/dashboard/properties/${propertyId}`}
                        className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                      >
                        {propertyName}
                      </Link>
                    )}
                  </h3>
                  <div className="flex items-center text-xs text-gray-600 dark:text-gray-400">
                    <MapPin className="h-3 w-3 me-1 flex-shrink-0" />
                    <span className="truncate">{displayAddress}</span>
                  </div>
                </div>
                <div className="flex flex-col items-end">
                  <div className="flex items-center text-sm font-semibold text-gray-900 dark:text-gray-100">
                    <span>
                      {rentRange || t("properties.labels.unknown")}
                    </span>
                  </div>
                  {property?.isMultiUnit && unitStats.available > 0 ? (
                    <span className="text-xs text-green-600 dark:text-green-400 font-medium">
                      {t("properties.units.availableCount", {
                        values: { count: unitStats.available },
                      })}
                    </span>
                  ) : (
                    !property?.isMultiUnit && (
                      <span className="text-xs text-green-600 dark:text-green-400 font-medium">
                        {t("properties.labels.singleUnit")}
                      </span>
                    )
                  )}
                </div>
              </div>
              <div className="flex items-center justify-end">
                {showActions && (onEdit || onDelete || onView) && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                        <MoreHorizontal className="h-3 w-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel>
                        {t("properties.menu.actions")}
                      </DropdownMenuLabel>
                      {onView && (
                        <DropdownMenuItem onClick={() => onView(property)}>
                          <Eye className="h-4 w-4 me-2" />
                          {t("properties.menu.viewDetails")}
                        </DropdownMenuItem>
                      )}
                      {onEdit && (
                        <DropdownMenuItem onClick={() => onEdit(property)}>
                          <Edit className="h-4 w-4 me-2" />
                          {t("properties.menu.editProperty")}
                        </DropdownMenuItem>
                      )}
                      {(onDelete || onStatusChange) && <DropdownMenuSeparator />}
                      {onDelete && (
                        <DropdownMenuItem
                          onClick={() => onDelete(property)}
                          className="text-red-600 focus:text-red-600"
                          disabled={deleteLoading || !!property.deletedAt}
                        >
                          <Trash2 className="h-4 w-4 me-2" />
                          {property.deletedAt
                            ? t("properties.menu.alreadyDeleted")
                            : t("properties.menu.deleteProperty")}
                        </DropdownMenuItem>
                      )}
                      {onStatusChange &&
                        property.status !== PropertyStatus.AVAILABLE && (
                          <DropdownMenuItem
                            onClick={() =>
                              onStatusChange(property, PropertyStatus.AVAILABLE)
                            }
                          >
                            <CheckCircle className="h-4 w-4 me-2 text-green-600" />
                            {t("properties.menu.markAvailable")}
                          </DropdownMenuItem>
                        )}
                      {onStatusChange &&
                        property.status !== PropertyStatus.OCCUPIED && (
                          <DropdownMenuItem
                            onClick={() =>
                              onStatusChange(property, PropertyStatus.OCCUPIED)
                            }
                          >
                            <Users className="h-4 w-4 me-2 text-blue-600" />
                            {t("properties.menu.markOccupied")}
                          </DropdownMenuItem>
                        )}
                      {onStatusChange &&
                        property.status !== PropertyStatus.MAINTENANCE && (
                          <DropdownMenuItem
                            onClick={() =>
                              onStatusChange(property, PropertyStatus.MAINTENANCE)
                            }
                          >
                            <AlertCircle className="h-4 w-4 me-2 text-yellow-600" />
                            {t("properties.menu.markMaintenance")}
                          </DropdownMenuItem>
                        )}
                      {onStatusChange &&
                        property.status !== PropertyStatus.UNAVAILABLE && (
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
                )}
              </div>
            </div>

            {/* Desktop Layout */}
            <div className="hidden sm:flex items-center justify-between h-full">
              {/* Left Section - Name and Location */}
              <div className="flex-1 min-w-0 me-4">
                <h3 className="font-semibold text-base text-gray-900 dark:text-gray-100 truncate mb-1">
                  {onView ? (
                    <button
                      onClick={() => onView(property)}
                      className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors text-start"
                    >
                      {propertyName}
                    </button>
                  ) : (
                    <Link
                      href={`/dashboard/properties/${propertyId}`}
                      className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                    >
                      {propertyName}
                    </Link>
                  )}
                </h3>
                <div className="flex items-center text-sm text-gray-600 dark:text-gray-400">
                  <MapPin className="h-3 w-3 me-1 flex-shrink-0" />
                  <span className="truncate">{displayAddress}</span>
                </div>
              </div>

              {/* Right Section - Rent and Actions */}
              <div className="flex items-center space-x-4">
                <div className="flex flex-col items-end">
                  <div className="flex items-center text-lg font-semibold text-gray-900 dark:text-gray-100">
                    <span>
                      {rentRange || t("properties.labels.unknown")}
                    </span>
                    <span className="text-sm font-normal text-gray-600 dark:text-gray-400 ms-1">
                      {t("properties.labels.perMonth")}
                    </span>
                  </div>
                  <div className="flex items-center space-x-2 text-xs text-gray-600 dark:text-gray-400 mt-1">
                    {property?.isMultiUnit ? (
                      <>
                        <span>
                          {property?.totalUnits ?? 0}{" "}
                          {t("properties.labels.units")}
                        </span>
                        {unitStats.available > 0 && (
                          <span className="text-green-600 dark:text-green-400 font-medium">
                            {t("properties.units.availableCount", {
                              values: { count: unitStats.available },
                            })}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-green-600 dark:text-green-400 font-medium">
                        {t("properties.labels.singleUnit")}
                      </span>
                    )}
                  </div>
                </div>

                {/* Actions Menu */}
                {showActions && (onEdit || onDelete || onView) && (
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
                      {onView && (
                        <DropdownMenuItem onClick={() => onView(property)}>
                          <Eye className="h-4 w-4 me-2" />
                          {t("properties.menu.viewDetails")}
                        </DropdownMenuItem>
                      )}
                      {onEdit && (
                        <DropdownMenuItem onClick={() => onEdit(property)}>
                          <Edit className="h-4 w-4 me-2" />
                          {t("properties.menu.editProperty")}
                        </DropdownMenuItem>
                      )}
                      {(onDelete || onStatusChange) && <DropdownMenuSeparator />}
                      {onDelete && (
                        <DropdownMenuItem
                          onClick={() => onDelete(property)}
                          className="text-red-600 focus:text-red-600"
                          disabled={deleteLoading || !!property.deletedAt}
                        >
                          <Trash2 className="h-4 w-4 me-2" />
                          {property.deletedAt
                            ? t("properties.menu.alreadyDeleted")
                            : t("properties.menu.deleteProperty")}
                        </DropdownMenuItem>
                      )}
                      {onStatusChange &&
                        property.status !== PropertyStatus.AVAILABLE && (
                          <DropdownMenuItem
                            onClick={() =>
                              onStatusChange(property, PropertyStatus.AVAILABLE)
                            }
                          >
                            <CheckCircle className="h-4 w-4 me-2 text-green-600" />
                            {t("properties.menu.markAvailable")}
                          </DropdownMenuItem>
                        )}
                      {onStatusChange &&
                        property.status !== PropertyStatus.OCCUPIED && (
                          <DropdownMenuItem
                            onClick={() =>
                              onStatusChange(property, PropertyStatus.OCCUPIED)
                            }
                          >
                            <Users className="h-4 w-4 me-2 text-blue-600" />
                            {t("properties.menu.markOccupied")}
                          </DropdownMenuItem>
                        )}
                      {onStatusChange &&
                        property.status !== PropertyStatus.MAINTENANCE && (
                          <DropdownMenuItem
                            onClick={() =>
                              onStatusChange(property, PropertyStatus.MAINTENANCE)
                            }
                          >
                            <AlertCircle className="h-4 w-4 me-2 text-yellow-600" />
                            {t("properties.menu.markMaintenance")}
                          </DropdownMenuItem>
                        )}
                      {onStatusChange &&
                        property.status !== PropertyStatus.UNAVAILABLE && (
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
                )}
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default PropertyRowCard;
