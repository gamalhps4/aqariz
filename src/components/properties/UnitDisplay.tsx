"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Bed,
  Bath,
  Square,
  MapPin,
  Edit,
  Car,
  Wifi,
  Droplets,
  Zap,
  Calendar,
  User,
  Building,
  Layers,
  Trash2,
} from "lucide-react";
import { PropertyStatus } from "@/types";
import { EditUnitDialog } from "./EditUnitDialog";
import UnitDetailsModal from "./UnitDetailsModal";
import type { IEmbeddedUnit as Unit } from "@/types";
import { useLocalization } from "@/hooks/use-localization";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { usePropertyCategories } from "@/hooks/use-property-categories";
import {
  UnitArchiveDialog,
  useCanArchiveUnits,
} from "./UnitArchiveDialog";

interface EnhancedUnitDisplayProps {
  units: Unit[];
  propertyId: string;
  onDeleteUnit?: (unitId: string) => void;
  onAddUnit: () => void;
  /** "Add multiple units"; the button shows only when this is given. */
  onBulkAddUnits?: () => void;
  onUnitsChange: (() => void) | (() => Promise<void>); // Callback to refresh units after edit
  isLoading?: boolean;
}

const getStatusColor = (status: PropertyStatus) => {
  switch (status) {
    case "available":
      return "bg-green-100 text-green-800 border-green-200 dark:bg-green-950/30 dark:text-green-400 dark:border-green-800";
    case "occupied":
      return "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-800";
    case "maintenance":
      return "bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-950/30 dark:text-yellow-400 dark:border-yellow-800";
    case "unavailable":
      return "bg-red-100 text-red-800 border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-800";
    default:
      return "bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-950/30 dark:text-gray-400 dark:border-gray-800";
  }
};

const getStatusIcon = (status: PropertyStatus) => {
  switch (status) {
    case "available":
      return "🟢";
    case "occupied":
      return "🔵";
    case "maintenance":
      return "🟡";
    case "unavailable":
      return "🔴";
    default:
      return "⚪";
  }
};

export function EnhancedUnitDisplay({
  units,
  propertyId,
  onDeleteUnit,
  onAddUnit,
  onBulkAddUnits,
  onUnitsChange,
  isLoading = false,
}: EnhancedUnitDisplayProps) {
  const { t, formatCurrency, formatNumber, formatDate } = useLocalization();
  const { labelFor: unitTypeLabel } = usePropertyCategories("unit", { activeOnly: false });
  const canArchiveUnits = useCanArchiveUnits();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [selectedUnit, setSelectedUnit] = useState<Unit | null>(null);
  const [detailsModalOpen, setDetailsModalOpen] = useState(false);
  const [selectedUnitForDetails, setSelectedUnitForDetails] =
    useState<Unit | null>(null);

  const handleEditUnit = (unit: Unit) => {
    setSelectedUnit(unit);
    setEditDialogOpen(true);
  };

  const handleViewUnitDetails = (unit: Unit) => {
    setSelectedUnitForDetails(unit);
    setDetailsModalOpen(true);
  };

  const handleUnitUpdated = () => {
    onUnitsChange();
    setEditDialogOpen(false);
    setSelectedUnit(null);
  };

  // Filter units based on search and filters
  const filteredUnits = units.filter((unit) => {
    const matchesSearch = unit.unitNumber
      .toLowerCase()
      .includes(searchTerm.toLowerCase());
    const matchesStatus =
      statusFilter === "all" || unit.status === statusFilter;
    const matchesType = typeFilter === "all" || unit.unitType === typeFilter;

    return matchesSearch && matchesStatus && matchesType;
  });

  const unitTypes = Array.from(new Set(units.map((unit) => unit.unitType)));

  return (
    <div className="space-y-6">
      {/* Header with Search and Filters */}
      <Card className="border-blue-100 dark:border-gray-700 p-2">
        <CardHeader className="p-2 gap-0">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center p-0">
              <Building className="h-5 w-5 me-2 text-blue-600" />
              {t("properties.units.list.title")} (
              {t("properties.units.list.summary", {
                values: {
                  filtered: filteredUnits.length,
                  total: units.length,
                },
              })}
              )
            </CardTitle>
            <div className="flex flex-wrap gap-2">
              {onBulkAddUnits && (
                <Button variant="outline" onClick={onBulkAddUnits}>
                  <Layers className="h-4 w-4 me-2" />
                  {t("properties.units.bulk.action")}
                </Button>
              )}
              <Button
                onClick={onAddUnit}
                className="bg-blue-600 hover:bg-blue-700"
              >
                <Building className="h-4 w-4 me-2" />
                {t("properties.units.actions.addUnit")}
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Units Grid */}
      {filteredUnits.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Building className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              {units.length === 0
                ? t("properties.units.empty.noUnitsAdded.title")
                : t("properties.units.empty.noUnitsFound.title")}
            </h3>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              {units.length === 0
                ? t("properties.units.empty.noUnitsAdded.description")
                : t("properties.units.empty.noUnitsFound.description")}
            </p>
            {units.length === 0 && (
              <div className="flex flex-wrap justify-center gap-2">
                <Button
                  onClick={onAddUnit}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  <Building className="h-4 w-4 me-2" />
                  {t("properties.units.actions.addFirstUnit")}
                </Button>
                {onBulkAddUnits && (
                  <Button variant="outline" onClick={onBulkAddUnits}>
                    <Layers className="h-4 w-4 me-2" />
                    {t("properties.units.bulk.action")}
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredUnits
            .filter((unit) => unit?.unitNumber)
            .map((unit) => (
              <Card
                key={unit._id?.toString()}
                className="border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-500 hover:shadow-lg transition-all duration-200 cursor-pointer"
                onClick={() => handleViewUnitDetails(unit)}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <span className="text-2xl">
                        {getStatusIcon(unit.status)}
                      </span>
                      <div>
                        <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                          {t("properties.units.card.unitTitle", {
                            values: { unitNumber: unit.unitNumber },
                          })}
                        </h3>
                        {unit.floor != null && (
                          <p className="text-sm text-gray-600 dark:text-gray-400 flex items-center">
                            <MapPin className="h-3 w-3 me-1" />
                            {t("properties.units.card.floor", {
                              values: { floor: unit.floor },
                            })}
                          </p>
                        )}
                      </div>
                    </div>
                    <Badge className={getStatusColor(unit.status)}>
                      {t(`properties.status.${unit.status}`)}
                    </Badge>
                  </div>
                </CardHeader>

                <CardContent className="space-y-4">
                  {/* Unit Type */}
                  <div className="flex items-center justify-between">
                    <Badge variant="outline" className="capitalize">
                      {unitTypeLabel(unit.unitType)}
                    </Badge>
                    <div className="text-end">
                      <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                        {formatCurrency(unit.rentAmount)}
                      </div>
                      <div className="text-xs text-gray-600 dark:text-gray-400">
                        {t("properties.labels.perMonth")}
                      </div>
                    </div>
                  </div>

                  {/* Unit Details */}
                  <div className="grid grid-cols-3 gap-3 py-3 border-t border-gray-100 dark:border-gray-800">
                    <div className="text-center">
                      <div className="flex items-center justify-center mb-1">
                        <Bed className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                      </div>
                      <div className="text-lg font-semibold">
                        {formatNumber(unit.bedrooms)}
                      </div>
                      <div className="text-xs text-gray-600 dark:text-gray-400">
                        {t("properties.units.card.beds")}
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="flex items-center justify-center mb-1">
                        <Bath className="h-4 w-4 text-green-600 dark:text-green-400" />
                      </div>
                      <div className="text-lg font-semibold">
                        {formatNumber(unit.bathrooms)}
                      </div>
                      <div className="text-xs text-gray-600 dark:text-gray-400">
                        {t("properties.units.card.baths")}
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="flex items-center justify-center mb-1">
                        <Square className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                      </div>
                      <div className="text-lg font-semibold">
                        {formatNumber(unit.squareFootage)}
                      </div>
                      <div className="text-xs text-gray-600 dark:text-gray-400">
                        {t("properties.labels.squareFeetUnit")}
                      </div>
                    </div>
                  </div>

                  {/* Features */}
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-1">
                      {unit.balcony && (
                        <Badge variant="secondary" className="text-xs">
                          {t("properties.units.features.balcony")}
                        </Badge>
                      )}
                      {unit.patio && (
                        <Badge variant="secondary" className="text-xs">
                          {t("properties.units.features.patio")}
                        </Badge>
                      )}
                      {unit.garden && (
                        <Badge variant="secondary" className="text-xs">
                          {t("properties.units.features.garden")}
                        </Badge>
                      )}
                      {unit.parking?.included && (
                        <Badge variant="secondary" className="text-xs">
                          <Car className="h-3 w-3 me-1" />
                          {t("properties.units.features.parking")}
                        </Badge>
                      )}
                    </div>

                    {/* Utilities */}
                    <div className="flex flex-wrap gap-1">
                      {unit.utilities?.internet === "included" && (
                        <Badge variant="outline" className="text-xs">
                          <Wifi className="h-3 w-3 me-1" />
                          {t("properties.units.utilities.internet")}
                        </Badge>
                      )}
                      {unit.utilities?.water === "included" && (
                        <Badge variant="outline" className="text-xs">
                          <Droplets className="h-3 w-3 me-1" />
                          {t("properties.units.utilities.water")}
                        </Badge>
                      )}
                      {unit.utilities?.electricity === "included" && (
                        <Badge variant="outline" className="text-xs">
                          <Zap className="h-3 w-3 me-1" />
                          {t("properties.units.utilities.electricity")}
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* Tenant Info */}
                  {unit.status === "occupied" && unit.currentTenantId && (
                    <div className="bg-blue-50 dark:bg-blue-950/30 p-3 rounded-lg border border-blue-100 dark:border-blue-800">
                      <div className="flex items-center text-sm text-blue-700 dark:text-blue-400">
                        <User className="h-4 w-4 me-2" />
                        <span className="font-medium">
                          {t("properties.status.occupied")}
                        </span>
                      </div>
                      {unit.currentLeaseId && (
                        <div className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                          {t("properties.units.tenant.activeLeaseOnFile")}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Available Date */}
                  {unit.status === "available" && unit.availableFrom && (
                    <div className="bg-green-50 dark:bg-green-950/30 p-3 rounded-lg border border-green-100 dark:border-green-800">
                      <div className="flex items-center text-sm text-green-700 dark:text-green-400">
                        <Calendar className="h-4 w-4 me-2" />
                        <span className="font-medium">
                          {t("properties.units.card.availableFrom", {
                            values: {
                              date: formatDate(new Date(unit.availableFrom)),
                            },
                          })}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex gap-2 pt-3 border-t border-gray-100 dark:border-gray-800">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleEditUnit(unit);
                      }}
                      className="flex-1"
                    >
                      <Edit className="h-4 w-4 me-2" />
                      {t("properties.units.actions.editUnit")}
                    </Button>
                    {canArchiveUnits && unit._id && (
                      <UnitArchiveDialog
                        propertyId={propertyId}
                        unitId={String(unit._id)}
                        unitNumber={unit.unitNumber}
                        onArchived={async () => {
                          onDeleteUnit?.(String(unit._id));
                          await onUnitsChange();
                        }}
                      >
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={(e) => e.stopPropagation()}
                          className="text-red-600 border-red-200 hover:bg-red-50"
                          aria-label={t("properties.units.archive.trigger", {
                            defaultValue: "Delete unit",
                          })}
                          title={t("properties.units.archive.trigger", {
                            defaultValue: "Delete unit",
                          })}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </UnitArchiveDialog>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
        </div>
      )}

      {/* Edit Unit Dialog */}
      <EditUnitDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        propertyId={propertyId}
        unit={selectedUnit}
        onUnitUpdated={handleUnitUpdated}
      />

      {/* Unit Details Modal */}
      {selectedUnitForDetails?._id && (
        <UnitDetailsModal
          open={detailsModalOpen}
          onOpenChange={setDetailsModalOpen}
          propertyId={propertyId}
          unitId={selectedUnitForDetails._id.toString()}
          onUnitUpdated={onUnitsChange}
          onUnitDeleted={() => {
            if (selectedUnitForDetails?._id) {
              onDeleteUnit?.(selectedUnitForDetails._id.toString());
            }
            setDetailsModalOpen(false);
            setSelectedUnitForDetails(null);
            // The unit is in the archive now; the list must stop showing it.
            void onUnitsChange();
          }}
        />
      )}
    </div>
  );
}
