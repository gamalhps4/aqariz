"use client";

import {
  X,
  MoreVertical,
  Edit,
  DollarSign,
  Home,
  MapPin,
  Calendar,
  Bed,
  Bath,
  Car,
  Wifi,
  Zap,
  Droplets,
  Thermometer,
  Camera,
  User,
  FileText,
  Building2,
  Trash2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PropertyStatus } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import React, { useState, useEffect } from "react";
import { FileUpload } from "@/components/ui/file-upload";
import { unitService } from "@/lib/services/unit.service";
import propertyService from "@/lib/services/property.service";
import { EditUnitDialog } from "@/components/properties/EditUnitDialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { usePropertyCategories } from "@/hooks/use-property-categories";
import {
  UnitArchiveDialog,
  useCanArchiveUnits,
} from "@/components/properties/UnitArchiveDialog";

interface UnitDetails {
  id: string;
  unitNumber: string;
  unitType: string;
  bedrooms: number;
  bathrooms: number;
  squareFootage: number;
  rentAmount: number;
  securityDeposit: number;
  status: PropertyStatus;
  floor?: string;
  balcony: boolean;
  patio: boolean;
  garden: boolean;
  parking: {
    included: boolean;
    spaces?: number;
    type?: string;
  };
  utilities: {
    electricity: boolean;
    water: boolean;
    gas: boolean;
    internet: boolean;
    heating: boolean;
    cooling: boolean;
  };
  images: string[];
  notes?: string;
  availableFrom?: string;
  lastRenovated?: string;
  currentTenantId?: string;
  currentLeaseId?: string;
  attachments?: Array<{
    fileName: string;
    fileUrl: string;
    fileSize: number;
    fileType: string;
    uploadedAt?: string;
    uploadedBy?: string;
  }>;
}

interface PropertyInfo {
  id: string;
  name: string;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    zipCode?: string;
  };
  type: string;
}

interface UnitDetailsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  propertyId: string;
  unitId: string;
  onUnitUpdated?: () => void;
  onUnitDeleted?: () => void;
}

export default function UnitDetailsModal({
  open,
  onOpenChange,
  propertyId,
  unitId,
  onUnitUpdated,
  onUnitDeleted,
}: UnitDetailsModalProps) {
  const { t, formatCurrency, formatNumber, formatDate } =
    useLocalizationContext();
  const { labelFor: unitTypeLabel } = usePropertyCategories("unit", { activeOnly: false });
  const canArchiveUnits = useCanArchiveUnits();

  const [unit, setUnit] = useState<UnitDetails | null>(null);
  const [property, setProperty] = useState<PropertyInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [lease, setLease] = useState<any | null>(null);
  const [uploadingDocs, setUploadingDocs] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);

  useEffect(() => {
    if (open && propertyId && unitId) {
      fetchUnitDetails();
      fetchPropertyDetails();
    }
  }, [open, propertyId, unitId]);

  const fetchUnitDetails = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/properties/${propertyId}/units/${unitId}`
      );
      if (!response.ok) {
        throw new Error(t("properties.unitDetails.errors.fetchUnit"));
      }
      const data = await response.json();
      const leaseId = data?.currentLeaseId
        ? data.currentLeaseId.toString()
        : undefined;
      setUnit({ ...data, currentLeaseId: leaseId });
      if (leaseId) {
        await fetchLeaseDetails(leaseId);
      } else {
        setLease(null);
      }
    } catch (error) {
      setError(t("properties.unitDetails.errors.loadUnit"));
    } finally {
      setLoading(false);
    }
  };

  const fetchLeaseDetails = async (leaseId: string) => {
    try {
      const response = await fetch(`/api/leases/${leaseId}`);
      const result = await response.json();
      if (result?.success) {
        setLease(result.data);
      } else {
        setLease(null);
      }
    } catch (e) {
      setLease(null);
    }
  };

  const fetchPropertyDetails = async () => {
    try {
      const response = await fetch(`/api/properties/${propertyId}`);
      if (!response.ok) {
        throw new Error(t("properties.unitDetails.errors.fetchProperty"));
      }
      const data = await response.json();
      setProperty(data?.data ?? data);
    } catch (error) {}
  };

  const handleUnitDocumentsUpload = async (files: File[]) => {
    if (!unit) return;
    try {
      setUploadingDocs(true);
      const uploaded = await propertyService.uploadAttachments(files);
      const newAttachments = [...(unit.attachments || []), ...uploaded];
      const updated = await unitService.updateUnitAttachments(
        propertyId,
        unitId,
        newAttachments
      );
      setUnit({
        ...unit,
        attachments: updated.attachments || unit.attachments || [],
      });
    } catch (e) {
    } finally {
      setUploadingDocs(false);
    }
  };

  const getStatusColor = (status: PropertyStatus) => {
    switch (status) {
      case PropertyStatus.AVAILABLE:
        return "bg-green-100 text-green-800 dark:bg-green-950/30 dark:text-green-400";
      case PropertyStatus.OCCUPIED:
        return "bg-blue-100 text-blue-800 dark:bg-blue-950/30 dark:text-blue-400";
      case PropertyStatus.MAINTENANCE:
        return "bg-yellow-100 text-yellow-800 dark:bg-yellow-950/30 dark:text-yellow-400";
      case PropertyStatus.UNAVAILABLE:
        return "bg-red-100 text-red-800 dark:bg-red-950/30 dark:text-red-400";
      default:
        return "bg-gray-100 text-gray-800 dark:bg-gray-950/30 dark:text-gray-400";
    }
  };

  const getStatusIcon = (status: PropertyStatus) => {
    switch (status) {
      case PropertyStatus.AVAILABLE:
        return "🟢";
      case PropertyStatus.OCCUPIED:
        return "🔵";
      case PropertyStatus.MAINTENANCE:
        return "🟡";
      case PropertyStatus.UNAVAILABLE:
        return "🔴";
      default:
        return "⚪";
    }
  };

  // Handle unit update from edit dialog
  const handleUnitUpdated = () => {
    setEditDialogOpen(false);
    fetchUnitDetails(); // Refresh unit details
    onUnitUpdated?.(); // Notify parent component
  };

  // Convert unit to the format expected by EditUnitDialog
  const getUnitForEdit = () => {
    if (!unit) return null;
    return {
      _id: unitId,
      unitNumber: unit.unitNumber,
      unitType: unit.unitType,
      floor: unit.floor ? parseInt(unit.floor) : undefined,
      bedrooms: unit.bedrooms,
      bathrooms: unit.bathrooms,
      squareFootage: unit.squareFootage,
      rentAmount: unit.rentAmount,
      securityDeposit: unit.securityDeposit,
      status: unit.status,
      balcony: unit.balcony,
      patio: unit.patio,
      garden: unit.garden,
      parking: unit.parking,
      utilities: unit.utilities,
      images: unit.images,
      notes: unit.notes,
      availableFrom: unit.availableFrom,
      lastRenovated: unit.lastRenovated,
      currentTenantId: unit.currentTenantId,
      currentLeaseId: unit.currentLeaseId,
    };
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
      />

      {/* Modal Content */}
      <div className="relative bg-white dark:bg-gray-900 rounded-lg shadow-2xl w-[96vw] max-w-[1400px] h-[68vh] max-h-[750px] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b dark:border-gray-800 bg-white dark:bg-gray-900">
          <div>
            {loading ? (
              <div className="space-y-2">
                <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded animate-pulse w-48" />
                <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse w-64" />
              </div>
            ) : unit && property ? (
              <>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                  {t("properties.unitDetails.header.title", {
                    values: { unitNumber: unit.unitNumber },
                  })}
                </h2>
                <p className="text-gray-600 dark:text-gray-400">
                  {property?.name}
                  {property?.address?.city && property?.address?.state && (
                    <>
                      {" "}
                      • {property.address.city}, {property.address.state}
                    </>
                  )}
                </p>
              </>
            ) : null}
          </div>

          <div className="flex items-center space-x-3">
            {unit && (
              <Badge className={`${getStatusColor(unit.status)} border`}>
                {getStatusIcon(unit.status)}
                <span className="ms-1">
                  {t(`properties.status.${unit.status}`)}
                </span>
              </Badge>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setEditDialogOpen(true)}>
                  <Edit className="me-2 h-4 w-4" />
                  {t("properties.units.actions.editUnit")}
                </DropdownMenuItem>
                {canArchiveUnits && onUnitDeleted && unit && (
                  <>
                    <DropdownMenuSeparator />
                    <UnitArchiveDialog
                      propertyId={propertyId}
                      unitId={unitId}
                      unitNumber={unit.unitNumber}
                      onArchived={() => onUnitDeleted()}
                    >
                      <DropdownMenuItem
                        className="text-red-600 focus:text-red-600"
                        onSelect={(e) => e.preventDefault()}
                      >
                        <Trash2 className="me-2 h-4 w-4" />
                        {t("properties.units.archive.trigger", {
                          defaultValue: "Delete unit",
                        })}
                      </DropdownMenuItem>
                    </UnitArchiveDialog>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="h-8 w-8 p-0"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Card key={i} className="p-2">
                    <CardContent className="p-6">
                      <div className="space-y-3">
                        <div className="h-4 bg-gray-200 rounded animate-pulse w-full" />
                        <div className="h-8 bg-gray-200 rounded animate-pulse w-24" />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ) : error ? (
            <div className="text-center py-12">
              <p className="text-red-600 mb-4">{error}</p>
              <Button onClick={fetchUnitDetails} variant="outline">
                {t("properties.unitDetails.errors.retryButton")}
              </Button>
            </div>
          ) : unit && property ? (
            <Tabs
              value={activeTab}
              onValueChange={setActiveTab}
              className="space-y-3"
            >
              <TabsList className="grid w-full grid-cols-5">
                <TabsTrigger value="overview">
                  {t("properties.unitDetails.tabs.overview")}
                </TabsTrigger>
                <TabsTrigger value="features">
                  {t("properties.unitDetails.tabs.features")}
                </TabsTrigger>
                <TabsTrigger value="tenant">
                  {t("properties.unitDetails.tabs.tenant")}
                </TabsTrigger>
                <TabsTrigger value="documents">
                  {t("properties.unitDetails.tabs.documents")}
                </TabsTrigger>
                <TabsTrigger value="images">
                  {t("properties.unitDetails.tabs.images")}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="space-y-3">
                {/* Quick Stats */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <Card className="shadow-sm hover:shadow-md transition-shadow p-2">
                    <CardContent className="p-2">
                      <div className="flex items-center space-x-3">
                        <div className="p-3 bg-green-100 dark:bg-green-950/30 rounded-lg">
                          <DollarSign className="h-6 w-6 text-green-600 dark:text-green-400" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">
                            {t("properties.unitDetails.stats.monthlyRent")}
                          </p>
                          <p className="text-lg font-bold text-gray-900 dark:text-gray-100">
                            {formatCurrency(unit.rentAmount)}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="shadow-sm hover:shadow-md transition-shadow p-2">
                    <CardContent className="p-2">
                      <div className="flex items-center space-x-3">
                        <div className="p-3 bg-blue-100 dark:bg-blue-950/30 rounded-lg">
                          <DollarSign className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">
                            {t("properties.unitDetails.stats.securityDeposit")}
                          </p>
                          <p className="text-lg font-bold text-gray-900 dark:text-gray-100">
                            {formatCurrency(unit.securityDeposit)}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="shadow-sm hover:shadow-md transition-shadow p-2">
                    <CardContent className="p-2">
                      <div className="flex items-center space-x-3">
                        <div className="p-3 bg-purple-100 rounded-lg">
                          <Home className="h-6 w-6 text-purple-600" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-600 mb-1">
                            {t("properties.unitDetails.stats.squareFootage")}
                          </p>
                          <p className="text-lg font-bold text-gray-900">
                            {formatNumber(unit.squareFootage)}{" "}
                            {t("properties.labels.squareFeetUnit")}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="shadow-sm hover:shadow-md transition-shadow p-2">
                    <CardContent className="p-2">
                      <div className="flex items-center space-x-3">
                        <div className="p-3 bg-orange-100 rounded-lg">
                          <Home className="h-6 w-6 text-orange-600" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-600 mb-1">
                            {t("properties.unitDetails.stats.unitType")}
                          </p>
                          <p className="text-lg font-bold text-gray-900 capitalize">
                            {unitTypeLabel(unit.unitType)}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Unit Details Grid */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                  {/* Basic Information */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center space-x-2">
                        <Building2 className="h-5 w-5" />
                        <span>
                          {t(
                            "properties.unitDetails.sections.basicInformation"
                          )}
                        </span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="text-sm font-medium text-gray-600">
                            {t("properties.unitDetails.fields.unitNumber")}
                          </p>
                          <p className="text-lg font-semibold">
                            {unit.unitNumber}
                          </p>
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-600">
                            {t("properties.unitDetails.fields.floor")}
                          </p>
                          <p className="text-lg font-semibold">
                            {unit.floor ||
                              t("properties.unitDetails.common.notAvailable")}
                          </p>
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-600">
                            {t("properties.unitDetails.fields.bedrooms")}
                          </p>
                          <p className="text-lg font-semibold flex items-center">
                            <Bed className="h-4 w-4 me-1" />
                            {unit.bedrooms}
                          </p>
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-600">
                            {t("properties.unitDetails.fields.bathrooms")}
                          </p>
                          <p className="text-lg font-semibold flex items-center">
                            <Bath className="h-4 w-4 me-1" />
                            {unit.bathrooms}
                          </p>
                        </div>
                      </div>

                      {unit.availableFrom && (
                        <div>
                          <p className="text-sm font-medium text-gray-600">
                            {t("properties.unitDetails.fields.availableFrom")}
                          </p>
                          <p className="text-lg font-semibold flex items-center">
                            <Calendar className="h-4 w-4 me-1" />
                            {formatDate(unit.availableFrom)}
                          </p>
                        </div>
                      )}

                      {unit.lastRenovated && (
                        <div>
                          <p className="text-sm font-medium text-gray-600">
                            {t("properties.unitDetails.fields.lastRenovated")}
                          </p>
                          <p className="text-lg font-semibold">
                            {formatDate(unit.lastRenovated)}
                          </p>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {/* Property Information */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center space-x-2">
                        <MapPin className="h-5 w-5" />
                        <span>
                          {t(
                            "properties.unitDetails.sections.propertyInformation"
                          )}
                        </span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div>
                        <p className="text-sm font-medium text-gray-600">
                          {t("properties.unitDetails.fields.propertyName")}
                        </p>
                        <p className="text-lg font-semibold">
                          {property?.name}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-600">
                          {t("properties.unitDetails.fields.address")}
                        </p>
                        {property?.address ? (
                          <>
                            <p className="text-lg font-semibold">
                              {property.address.street ||
                                t(
                                  "properties.unitDetails.address.notAvailable"
                                )}
                            </p>
                            <p className="text-sm text-gray-600">
                              {[
                                property.address.city,
                                property.address.state,
                                property.address.zipCode,
                              ]
                                .filter(Boolean)
                                .join(", ") ||
                                t(
                                  "properties.unitDetails.address.locationNotAvailable"
                                )}
                            </p>
                          </>
                        ) : (
                          <p className="text-lg font-semibold text-gray-400">
                            {t("properties.unitDetails.address.notAvailable")}
                          </p>
                        )}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-600">
                          {t("properties.unitDetails.fields.propertyType")}
                        </p>
                        <p className="text-lg font-semibold capitalize">
                          {property?.type
                            ? t(`properties.type.${property.type}`)
                            : t("properties.labels.unknown")}
                        </p>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Additional Details */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center space-x-2">
                        <FileText className="h-5 w-5" />
                        <span>
                          {t(
                            "properties.unitDetails.sections.additionalDetails"
                          )}
                        </span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div>
                        <p className="text-sm font-medium text-gray-600">
                          {t("properties.unitDetails.fields.status")}
                        </p>
                        <Badge
                          className={`${getStatusColor(unit.status)} mt-1`}
                        >
                          {getStatusIcon(unit.status)}
                          <span className="ms-1">
                            {t(`properties.status.${unit.status}`)}
                          </span>
                        </Badge>
                      </div>

                      {unit.notes && (
                        <div>
                          <p className="text-sm font-medium text-gray-600">
                            {t("properties.unitDetails.fields.notes")}
                          </p>
                          <p className="text-sm text-gray-700 mt-1">
                            {unit.notes}
                          </p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>

              <TabsContent value="images" className="space-y-3">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center space-x-2">
                      <Camera className="h-5 w-5" />
                      <span>
                        {t("properties.unitDetails.sections.unitImages")}
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {unit.images?.length > 0 ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                        {unit.images.map((image, index) => (
                          <div
                            key={index}
                            className="relative aspect-video rounded-lg overflow-hidden border bg-muted"
                          >
                            <img
                              src={image}
                              alt={t("properties.unitDetails.images.alt", {
                                values: {
                                  unitNumber: unit.unitNumber,
                                  index: index + 1,
                                },
                              })}
                              className="w-full h-full object-cover hover:scale-105 transition-transform cursor-pointer"
                            />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-12">
                        <Camera className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">
                          {t("properties.images.empty.title")}
                        </h3>
                        <p className="text-gray-500 dark:text-gray-400">
                          {t("properties.images.empty.description")}
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="features" className="space-y-3">
                <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-6">
                  {/* Unit Features */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center space-x-2">
                        <Home className="h-5 w-5" />
                        <span>
                          {t("properties.unitDetails.sections.unitFeatures")}
                        </span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">
                          {t("properties.units.features.balcony")}
                        </span>
                        <span
                          className={
                            unit.balcony ? "text-green-600" : "text-gray-400"
                          }
                        >
                          {unit.balcony ? "✓" : "✗"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">
                          {t("properties.units.features.patio")}
                        </span>
                        <span
                          className={
                            unit.patio ? "text-green-600" : "text-gray-400"
                          }
                        >
                          {unit.patio ? "✓" : "✗"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">
                          {t("properties.units.features.garden")}
                        </span>
                        <span
                          className={
                            unit.garden ? "text-green-600" : "text-gray-400"
                          }
                        >
                          {unit.garden ? "✓" : "✗"}
                        </span>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Parking */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center space-x-2">
                        <Car className="h-5 w-5" />
                        <span>
                          {t("properties.unitDetails.sections.parking")}
                        </span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">
                          {t("properties.units.parking.included")}
                        </span>
                        <span
                          className={
                            unit.parking.included
                              ? "text-green-600"
                              : "text-gray-400"
                          }
                        >
                          {unit.parking.included ? "✓" : "✗"}
                        </span>
                      </div>
                      {unit.parking.spaces && (
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">
                            {t("properties.units.parking.spaces")}
                          </span>
                          <span className="text-sm font-semibold">
                            {unit.parking.spaces}
                          </span>
                        </div>
                      )}
                      {unit.parking.type && (
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">
                            {t("properties.unitDetails.parking.type.labelShort")}
                          </span>
                          <span className="text-sm font-semibold capitalize">
                            {t(
                              `properties.units.parking.type.${unit.parking.type}`
                            )}
                          </span>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {/* Utilities */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center space-x-2">
                        <Droplets className="h-5 w-5" />
                        <span>
                          {t("properties.unitDetails.sections.utilities")}
                        </span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-2 gap-4">
                        {[
                          {
                            key: "electricity",
                            label: t("properties.units.utilities.electricity"),
                            icon: Zap,
                          },
                          {
                            key: "water",
                            label: t("properties.units.utilities.water"),
                            icon: Droplets,
                          },
                          {
                            key: "gas",
                            label: t("properties.units.utilities.gas"),
                            icon: Thermometer,
                          },
                          {
                            key: "internet",
                            label: t("properties.units.utilities.internet"),
                            icon: Wifi,
                          },
                          {
                            key: "heating",
                            label: t("properties.units.utilities.heating"),
                            icon: Thermometer,
                          },
                          {
                            key: "cooling",
                            label: t("properties.units.utilities.cooling"),
                            icon: Thermometer,
                          },
                        ].map(({ key, label, icon: Icon }) => (
                          <div
                            key={key}
                            className="flex items-center space-x-2"
                          >
                            <Icon className="h-4 w-4 text-gray-500" />
                            <span className="text-sm font-medium">{label}</span>
                            <span
                              className={
                                unit.utilities[
                                  key as keyof typeof unit.utilities
                                ]
                                  ? "text-green-600"
                                  : "text-gray-400"
                              }
                            >
                              {unit.utilities[
                                key as keyof typeof unit.utilities
                              ]
                                ? "✓"
                                : "✗"}
                            </span>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>

              <TabsContent value="tenant" className="space-y-3">
                {unit.status === PropertyStatus.OCCUPIED ? (
                  <div className="grid gap-6 md:grid-cols-2">
                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center space-x-2">
                          <User className="h-5 w-5" />
                          <span>
                            {t("properties.unitDetails.sections.currentTenant")}
                          </span>
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        {lease ? (
                          <div className="space-y-4">
                            <div className="flex items-center space-x-3">
                              <User className="h-8 w-8 text-gray-500" />
                              <div>
                                <div className="text-lg font-semibold">
                                  {lease?.tenantId
                                    ? `${
                                        lease.tenantId.firstName ??
                                        t("leases.labels.unknownFirstName")
                                      } ${
                                        lease.tenantId.lastName ??
                                        t("leases.labels.unknownLastName")
                                      }`
                                    : t("leases.labels.unknownTenant")}
                                </div>
                                <div className="text-sm text-gray-500">
                                  {t("tenants.details.tenantId")}:{" "}
                                  {lease?.tenantId?._id?.toString() ??
                                    t("tenants.labels.notAvailable")}
                                </div>
                              </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                              <div className="flex items-center justify-between">
                                <span className="text-sm font-medium">
                                  {t("leases.details.tenant.email")}
                                </span>
                                <span className="text-sm">
                                  {lease?.tenantId?.email ??
                                    t("leases.labels.noEmail")}
                                </span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-sm font-medium">
                                  {t("leases.details.tenant.phone")}
                                </span>
                                <span className="text-sm">
                                  {lease?.tenantId?.phone ??
                                    t("tenants.labels.notAvailable")}
                                </span>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="text-center py-8">
                            <User className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                            <p className="text-gray-600">
                              {t("properties.unitDetails.tenant.placeholder")}
                            </p>
                            <p className="text-sm text-gray-500 mt-2">
                              {t(
                                "properties.unitDetails.tenant.integrationRequired"
                              )}
                            </p>
                          </div>
                        )}
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center space-x-2">
                          <FileText className="h-5 w-5" />
                          <span>
                            {t(
                              "properties.unitDetails.sections.leaseInformation"
                            )}
                          </span>
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        {lease ? (
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium">
                                {t("leases.table.status")}
                              </span>
                              <span className="text-sm font-semibold">
                                {t(`leases.status.${lease?.status}`)}
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium">
                                {t("leases.table.startDate")}
                              </span>
                              <span className="text-sm font-semibold">
                                {lease?.startDate
                                  ? formatDate(lease.startDate)
                                  : t("leases.details.common.notAvailable")}
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium">
                                {t("leases.table.endDate")}
                              </span>
                              <span className="text-sm font-semibold">
                                {lease?.endDate
                                  ? formatDate(lease.endDate)
                                  : t("leases.details.common.notAvailable")}
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium">
                                {t("leases.details.financial.monthlyRent")}
                              </span>
                              <span className="text-sm font-semibold">
                                {typeof lease?.terms?.rentAmount === "number"
                                  ? formatCurrency(lease.terms.rentAmount)
                                  : t("leases.details.common.notAvailable")}
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium">
                                {t("leases.details.financial.securityDeposit")}
                              </span>
                              <span className="text-sm font-semibold">
                                {typeof lease?.terms?.securityDeposit ===
                                "number"
                                  ? formatCurrency(lease.terms.securityDeposit)
                                  : t("leases.details.common.notAvailable")}
                              </span>
                            </div>
                          </div>
                        ) : (
                          <div className="text-center py-8">
                            <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                            <p className="text-gray-600">
                              {t("properties.unitDetails.lease.placeholder")}
                            </p>
                            <p className="text-sm text-gray-500 mt-2">
                              {t(
                                "properties.unitDetails.lease.integrationRequired"
                              )}
                            </p>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </div>
                ) : (
                  <Card>
                    <CardContent className="text-center py-12">
                      <User className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                      <h3 className="text-lg font-semibold text-gray-600 mb-2">
                        {t("properties.unitDetails.tenant.emptyState.title")}
                      </h3>
                      <p className="text-gray-500">
                        {t(
                          "properties.unitDetails.tenant.emptyState.description",
                          {
                            values: {
                              status: t(`properties.status.${unit.status}`),
                            },
                          }
                        )}
                      </p>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              <TabsContent value="documents" className="space-y-3">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center space-x-2">
                      <FileText className="h-5 w-5" />
                      <span>
                        {t("properties.unitDetails.sections.unitDocuments")}
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <FileUpload
                      onFilesSelected={handleUnitDocumentsUpload}
                      acceptedFileTypes={[
                        ".pdf",
                        ".doc",
                        ".docx",
                        ".xls",
                        ".xlsx",
                        ".txt",
                        ".csv",
                        ".jpg",
                        ".jpeg",
                        ".png",
                        ".gif",
                        ".webp",
                      ]}
                      maxFileSize={10}
                      maxFiles={5}
                      disabled={uploadingDocs}
                    />

                    {Array.isArray(unit.attachments) &&
                    unit.attachments.length > 0 ? (
                      <div className="space-y-3">
                        {unit.attachments.map((att, idx) => (
                          <div
                            key={idx}
                            className="flex items-center justify-between"
                          >
                            <a
                              href={att.fileUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm font-medium text-blue-600 hover:underline"
                            >
                              {att.fileName}
                            </a>
                            <span className="text-xs text-gray-500">
                              {att.fileType}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-8">
                        <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                        <h3 className="text-lg font-semibold text-gray-600 mb-2">
                          {t(
                            "properties.unitDetails.documents.emptyState.title"
                          )}
                        </h3>
                        <p className="text-gray-500">
                          {t(
                            "properties.unitDetails.documents.emptyState.description"
                          )}
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          ) : null}
        </div>
      </div>

      {/* Edit Unit Dialog */}
      <EditUnitDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        propertyId={propertyId}
        unit={getUnitForEdit() as any}
        onUnitUpdated={handleUnitUpdated}
      />
    </div>
  );
}
