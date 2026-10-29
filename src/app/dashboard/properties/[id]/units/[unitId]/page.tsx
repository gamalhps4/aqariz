"use client";

import Link from "next/link";
import Image from "@/components/ui/app-image";
import { toast } from "sonner";
import { PropertyStatus } from "@/types";
import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Building2,
  ArrowLeft,
  Edit,
  MoreHorizontal,
  MapPin,
  DollarSign,
  Bed,
  Bath,
  Square,
  Calendar,
  User,
  FileText,
  Camera,
  Settings,
  Home,
  Car,
  Zap,
  Wifi,
  Thermometer,
  Droplets,
  Shield,
  CheckCircle,
  XCircle,
  AlertCircle,
  Plus,
  Trash2,
  ExternalLink,
  Download,
  Clock,
} from "lucide-react";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { unitService } from "@/lib/services/unit.service";
import { propertyService } from "@/lib/services/property.service";
import { ImageUpload, type UploadedImage } from "@/components/ui/image-upload";
import { FileUpload } from "@/components/ui/file-upload";
import { transformAPIDataToForm } from "@/lib/utils/unit-transformer";
import { formatDisplayDate } from "@/lib/utils/formatting";
import {
  usePropertyCategories,
  usePropertyTypeLabel,
} from "@/hooks/use-property-categories";
import {
  UnitArchiveDialog,
  useCanArchiveUnits,
} from "@/components/properties/UnitArchiveDialog";

interface UnitDetails {
  _id: string;
  unitNumber: string;
  unitType: "apartment" | "studio" | "penthouse" | "loft" | "room";
  floor?: number;
  bedrooms: number;
  bathrooms: number;
  squareFootage: number;
  rentAmount: number;
  securityDeposit: number;
  status: PropertyStatus;

  // Features
  balcony?: boolean;
  patio?: boolean;
  garden?: boolean;
  dishwasher?: boolean;
  inUnitLaundry?: boolean;
  hardwoodFloors?: boolean;
  fireplace?: boolean;
  walkInClosets?: boolean;
  centralAir?: boolean;
  ceilingFans?: boolean;

  // Nested objects
  appliances?: {
    refrigerator?: boolean;
    stove?: boolean;
    oven?: boolean;
    microwave?: boolean;
    dishwasher?: boolean;
    washer?: boolean;
    dryer?: boolean;
    washerDryerHookups?: boolean;
  };

  parking?: {
    included?: boolean;
    spaces?: number;
    type?: "garage" | "covered" | "open" | "street";
    gated?: boolean;
    assigned?: boolean;
  };

  utilities?: {
    electricity?: "included" | "tenant" | "shared";
    water?: "included" | "tenant" | "shared";
    gas?: "included" | "tenant" | "shared";
    internet?: "included" | "tenant" | "shared";
    cable?: "included" | "tenant" | "shared";
    heating?: "included" | "tenant" | "shared";
    cooling?: "included" | "tenant" | "shared";
    trash?: "included" | "tenant" | "shared";
    sewer?: "included" | "tenant" | "shared";
  };

  notes?: string;
  images?: string[];
  availableFrom?: string;
  lastRenovated?: string;
  currentTenantId?: string;
  currentLeaseId?: string;
  attachments?: Array<{
    fileName: string;
    fileUrl: string;
    fileSize: number;
    fileType: string;
    uploadedAt?: string | Date;
    uploadedBy?: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

interface PropertyInfo {
  _id: string;
  name: string;
  description?: string;
  type: string;
  address: {
    street: string;
    city: string;
    state: string;
    zipCode: string;
    country: string;
  };
  images: string[];
  amenities: Array<{
    name: string;
    category: string;
    description?: string;
  }>;
  yearBuilt?: number;
  owner?: {
    firstName: string;
    lastName: string;
    email: string;
  };
  manager?: {
    firstName: string;
    lastName: string;
    email: string;
  };
}

export default function UnitDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const propertyId = params.id as string;
  const unitId = params.unitId as string;
  const canArchiveUnits = useCanArchiveUnits();
  const { t, formatCurrency: formatCurrencyLocalized } =
    useLocalizationContext();
  const { labelFor: unitTypeLabel } = usePropertyCategories("unit", { activeOnly: false });
  const propertyTypeLabel = usePropertyTypeLabel();

  const [unit, setUnit] = useState<UnitDetails | null>(null);
  const [property, setProperty] = useState<PropertyInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [lease, setLease] = useState<any | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [isUploadingDocs, setIsUploadingDocs] = useState(false);
  const [showDocUpload, setShowDocUpload] = useState(false);

  useEffect(() => {
    fetchUnitDetails();
    fetchPropertyDetails();
  }, [propertyId, unitId]);

  const fetchUnitDetails = async () => {
    try {
      setLoading(true);
      const response = await fetch(
        `/api/properties/${propertyId}/units/${unitId}`
      );
      if (!response.ok) {
        throw new Error("Failed to fetch unit details");
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
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : t("properties.unitDetails.loadFailed", { defaultValue: "Could not load the unit" });
      setError(message);
      toast.error(message);
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
    } catch {
      setLease(null);
    }
  };

  const fetchPropertyDetails = async () => {
    try {
      const response = await fetch(`/api/properties/${propertyId}`);
      if (!response.ok) {
        throw new Error("Failed to fetch property details");
      }
      const data = await response.json();
      const propertyData = data?.data;

      if (!propertyData) {
        throw new Error("Property data missing");
      }

      setProperty(propertyData);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : t("properties.edit.loadFailed", { defaultValue: "Could not load the building" });
      toast.error(message);
    }
  };

  const handleStatusChange = async (newStatus: PropertyStatus) => {
    if (!unit) return;

    try {
      const response = await fetch(
        `/api/properties/${propertyId}/units/${unitId}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ...unit,
            status: newStatus,
          }),
        }
      );

      if (!response.ok) {
        throw new Error("Failed to update unit status");
      }

      const data = await response.json();
      setUnit(data);
      toast.success(
        t("properties.unitDetails.toasts.statusUpdate.success", {
          values: { status: newStatus },
        })
      );
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : t("properties.unitDetails.toasts.statusUpdate.error")
      );
    }
  };

  const handleImagesUploaded = async (newImages: UploadedImage[]) => {
    if (!unit) return;

    try {
      setIsUploading(true);
      const imageUrls = newImages.map((img) => img.url);
      const updatedImages = [...(unit.images || []), ...imageUrls];

      // Convert current API data to form format to preserve all fields
      const formData = transformAPIDataToForm(unit as any);
      formData.images = updatedImages;

      await unitService.updateUnit(propertyId, unitId, formData);

      setUnit({ ...unit, images: updatedImages });
      toast.success(t("properties.unitDetails.toasts.imagesUpdate.success"));
      setShowUpload(false);
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : t("properties.unitDetails.toasts.statusUpdate.error")
      );
    } finally {
      setIsUploading(false);
    }
  };

  const handleDocumentsUploaded = async (files: File[]) => {
    if (!unit) return;

    try {
      setIsUploadingDocs(true);
      const newAttachments = await propertyService.uploadAttachments(files);
      const updatedAttachments = [
        ...(unit.attachments || []),
        ...newAttachments,
      ];

      const formData = transformAPIDataToForm(unit as any);
      formData.attachments = updatedAttachments;

      await unitService.updateUnit(propertyId, unitId, formData);

      setUnit({ ...unit, attachments: updatedAttachments });
      toast.success(t("properties.unitDetails.toasts.documentsUpdate.success"));
      setShowDocUpload(false);
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : t("properties.unitDetails.toasts.documentsUpdate.error")
      );
    } finally {
      setIsUploadingDocs(false);
    }
  };

  const handleDeleteDocument = async (index: number) => {
    if (!unit || !unit.attachments) return;

    try {
      const updatedAttachments = [...unit.attachments];
      updatedAttachments.splice(index, 1);

      const formData = transformAPIDataToForm(unit as any);
      formData.attachments = updatedAttachments;

      await unitService.updateUnit(propertyId, unitId, formData);

      setUnit({ ...unit, attachments: updatedAttachments });
      toast.success(t("properties.unitDetails.toasts.documentsUpdate.success"));
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : t("properties.unitDetails.toasts.documentsUpdate.error")
      );
    }
  };

  const getStatusColor = (status: PropertyStatus) => {
    switch (status) {
      case PropertyStatus.AVAILABLE:
        return "bg-green-100 text-green-800 border-green-200 dark:bg-green-950/30 dark:text-green-400 dark:border-green-800";
      case PropertyStatus.OCCUPIED:
        return "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-800";
      case PropertyStatus.MAINTENANCE:
        return "bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-950/30 dark:text-yellow-400 dark:border-yellow-800";
      case PropertyStatus.UNAVAILABLE:
        return "bg-red-100 text-red-800 border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-800";
      default:
        return "bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-950/30 dark:text-gray-400 dark:border-gray-800";
    }
  };

  const getStatusIcon = (status: PropertyStatus) => {
    switch (status) {
      case PropertyStatus.AVAILABLE:
        return <CheckCircle className="h-4 w-4" />;
      case PropertyStatus.OCCUPIED:
        return <User className="h-4 w-4" />;
      case PropertyStatus.MAINTENANCE:
        return <Settings className="h-4 w-4" />;
      case PropertyStatus.UNAVAILABLE:
        return <XCircle className="h-4 w-4" />;
      default:
        return <Clock className="h-4 w-4" />;
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center space-x-4">
          <div className="h-8 w-8 bg-muted rounded animate-pulse" />
          <div className="h-8 bg-muted rounded animate-pulse w-64" />
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <div className="h-6 bg-muted rounded animate-pulse w-32" />
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="h-4 bg-muted rounded animate-pulse w-full" />
                  <div className="h-4 bg-muted rounded animate-pulse w-3/4" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (error || !unit) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 text-red-500 dark:text-red-400 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
            {error || t("properties.unitDetails.error.notFound")}
          </h3>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            {t("properties.unitDetails.error.notFoundDescription")}
          </p>
          <Button onClick={() => router.back()}>
            <ArrowLeft className="h-4 w-4 me-2 rtl:-scale-x-100" />
            {t("properties.unitDetails.error.goBack")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {t("properties.unitDetails.header.title", {
                values: { unitNumber: unit.unitNumber },
              })}
            </h1>
            <p className="text-sm text-muted-foreground">
              {property?.name} • {property?.address.city},{" "}
              {property?.address.state}
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <Badge className={`${getStatusColor(unit.status)} border`}>
            {getStatusIcon(unit.status)}
            <span className="ms-1">
              {t(`properties.status.${unit.status}`)}
            </span>
          </Badge>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link href={`/dashboard/properties/${propertyId}/edit`}>
                  <Edit className="h-4 w-4 me-2" />
                  {t("properties.unitDetails.actions.editUnit")}
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href={`/dashboard/properties/${propertyId}`}>
                  <Building2 className="h-4 w-4 me-2" />
                  {t("properties.unitDetails.actions.viewProperty")}
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => handleStatusChange(PropertyStatus.AVAILABLE)}
              >
                <CheckCircle className="h-4 w-4 me-2" />
                {t("properties.unitDetails.actions.markAvailable")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleStatusChange(PropertyStatus.OCCUPIED)}
              >
                <User className="h-4 w-4 me-2" />
                {t("properties.unitDetails.actions.markOccupied")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleStatusChange(PropertyStatus.MAINTENANCE)}
              >
                <Settings className="h-4 w-4 me-2" />
                {t("properties.unitDetails.actions.markMaintenance")}
              </DropdownMenuItem>
              {canArchiveUnits && (
                <>
                  <DropdownMenuSeparator />
                  <UnitArchiveDialog
                    propertyId={propertyId}
                    unitId={unitId}
                    unitNumber={unit.unitNumber}
                    onArchived={() =>
                      router.push(`/dashboard/properties/${propertyId}`)
                    }
                  >
                    <DropdownMenuItem
                      onSelect={(event) => event.preventDefault()}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="h-4 w-4 me-2" />
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
            onClick={() => router.back()}
            className=""
          >
            <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" />
            {t("properties.unitDetails.actions.backToUnits")}
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="space-y-4"
      >
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="overview">
            {t("properties.unitDetails.tabs.overview")}
          </TabsTrigger>
          <TabsTrigger value="features">
            {t("properties.unitDetails.tabs.features")}
          </TabsTrigger>
          <TabsTrigger value="images">
            {t("properties.unitDetails.tabs.images")}
          </TabsTrigger>
          <TabsTrigger value="tenant">
            {t("properties.unitDetails.tabs.tenant")}
          </TabsTrigger>
          <TabsTrigger value="documents">
            {t("properties.unitDetails.tabs.documents")}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="space-y-4">
          {/* Quick Stats */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card className="p-2">
              <CardContent className="p-2">
                <div className="flex items-center space-x-2">
                  <DollarSign className="h-5 w-5 text-green-600 dark:text-green-400" />
                  <div>
                    <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
                      {t("properties.unitDetails.stats.monthlyRent")}
                    </p>
                    <p className="text-xl font-bold text-gray-900 dark:text-gray-100">
                      {formatCurrencyLocalized(unit.rentAmount)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="p-2">
              <CardContent className="p-2">
                <div className="flex items-center space-x-2">
                  <Shield className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                  <div>
                    <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
                      {t("properties.unitDetails.stats.securityDeposit")}
                    </p>
                    <p className="text-xl font-bold text-gray-900 dark:text-gray-100">
                      {formatCurrencyLocalized(unit.securityDeposit)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="p-2">
              <CardContent className="p-2">
                <div className="flex items-center space-x-2">
                  <Square className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                  <div>
                    <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
                      {t("properties.unitDetails.stats.squareFootage")}
                    </p>
                    <p className="text-xl font-bold text-gray-900 dark:text-gray-100">
                      {unit.squareFootage.toLocaleString()}{" "}
                      {t("properties.labels.squareFeetUnit", { defaultValue: "m²" })}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="p-2">
              <CardContent className="p-2">
                <div className="flex items-center space-x-2">
                  <Home className="h-5 w-5 text-orange-600 dark:text-orange-400" />
                  <div>
                    <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
                      {t("properties.unitDetails.stats.unitType")}
                    </p>
                    <p className="text-xl font-bold text-gray-900 dark:text-gray-100 capitalize">
                      {unitTypeLabel(unit.unitType)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Unit Details Grid */}
          <div className="grid gap-6 md:grid-cols-2">
            {/* Basic Information */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Building2 className="h-5 w-5" />
                  <span>
                    {t("properties.unitDetails.sections.basicInformation")}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
                      {t("properties.unitDetails.fields.unitNumber")}
                    </p>
                    <p className="text-lg font-semibold">{unit.unitNumber}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
                      {t("properties.unitDetails.fields.floor")}
                    </p>
                    <p className="text-lg font-semibold">
                      {unit.floor ||
                        t("properties.unitDetails.common.notAvailable")}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
                      {t("properties.unitDetails.fields.bedrooms")}
                    </p>
                    <p className="text-lg font-semibold flex items-center">
                      <Bed className="h-4 w-4 me-1" />
                      {unit.bedrooms}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
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
                    <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
                      {t("properties.unitDetails.fields.availableFrom")}
                    </p>
                    <p className="text-lg font-semibold flex items-center">
                      <Calendar className="h-4 w-4 me-1" />
                      {formatDisplayDate(unit.availableFrom)}
                    </p>
                  </div>
                )}

                {unit.lastRenovated && (
                  <div>
                    <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
                      {t("properties.unitDetails.fields.lastRenovated")}
                    </p>
                    <p className="text-lg font-semibold">
                      {formatDisplayDate(unit.lastRenovated)}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Property Information */}
            {property && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center space-x-2">
                    <MapPin className="h-5 w-5" />
                    <span>
                      {t("properties.unitDetails.sections.propertyInformation")}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
                      {t("properties.unitDetails.fields.propertyName")}
                    </p>
                    <p className="text-lg font-semibold">{property.name}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
                      {t("properties.unitDetails.fields.address")}
                    </p>
                    <p className="text-sm text-gray-900 dark:text-gray-100">
                      {property.address.street}
                      <br />
                      {property.address.city}, {property.address.state}{" "}
                      {property.address.zipCode}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
                      {t("properties.unitDetails.fields.propertyType")}
                    </p>
                    <p className="text-lg font-semibold capitalize">
                      {propertyTypeLabel(property.type)}
                    </p>
                  </div>
                  {property.yearBuilt && (
                    <div>
                      <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
                        {t("properties.unitDetails.fields.yearBuilt")}
                      </p>
                      <p className="text-lg font-semibold">
                        {property.yearBuilt}
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>

          {/* Notes */}
          {unit.notes && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <FileText className="h-5 w-5" />
                  <span>{t("properties.unitDetails.sections.notes")}</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                  {unit.notes}
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="images" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="flex items-center space-x-2">
                <Camera className="h-5 w-5" />
                <span>{t("properties.unitDetails.sections.unitImages")}</span>
              </CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowUpload(!showUpload)}
              >
                {showUpload
                  ? t("common.cancel")
                  : t("properties.unitDetails.actions.addImages")}
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              {showUpload && (
                <div className="mb-6 pb-6 border-b">
                  <ImageUpload
                    onImagesUploaded={handleImagesUploaded}
                    disabled={isUploading}
                  />
                </div>
              )}

              {(unit.images?.length ?? 0) > 0 ? (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                  {(unit.images ?? []).map((image, index) => (
                    <div
                      key={index}
                      className="relative aspect-video rounded-lg overflow-hidden bg-muted border"
                    >
                      <Image
                        src={image}
                        alt={`Unit ${unit.unitNumber} - Image ${index + 1}`}
                        fill
                        className="object-cover hover:scale-105 transition-transform duration-200"
                      />
                    </div>
                  ))}
                </div>
              ) : (
                !showUpload && (
                  <div className="text-center py-16">
                    <Camera className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">
                      {t("properties.images.empty.title")}
                    </h3>
                    <p className="text-gray-500 dark:text-gray-400">
                      {t("properties.images.empty.description")}
                    </p>
                    <Button
                      variant="outline"
                      className="mt-4"
                      onClick={() => setShowUpload(true)}
                    >
                      <Plus className="h-4 w-4 me-2" />
                      {t("properties.unitDetails.actions.addImages")}
                    </Button>
                  </div>
                )
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="features" className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
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
              <CardContent className="space-y-3">
                {[
                  {
                    key: "balcony",
                    label: t("properties.unitDetails.features.balcony"),
                    icon: Building2,
                  },
                  {
                    key: "patio",
                    label: t("properties.unitDetails.features.patio"),
                    icon: Building2,
                  },
                  {
                    key: "garden",
                    label: t("properties.unitDetails.features.garden"),
                    icon: Building2,
                  },
                  {
                    key: "hardwoodFloors",
                    label: t("properties.unitDetails.features.hardwoodFloors"),
                    icon: Home,
                  },
                  {
                    key: "fireplace",
                    label: t("properties.unitDetails.features.fireplace"),
                    icon: Home,
                  },
                  {
                    key: "walkInClosets",
                    label: t("properties.unitDetails.features.walkInClosets"),
                    icon: Home,
                  },
                  {
                    key: "centralAir",
                    label: t("properties.unitDetails.features.centralAir"),
                    icon: Thermometer,
                  },
                  {
                    key: "ceilingFans",
                    label: t("properties.unitDetails.features.ceilingFans"),
                    icon: Thermometer,
                  },
                ].map(({ key, label, icon: Icon }) => (
                  <div key={key} className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Icon className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                      <span className="text-sm">{label}</span>
                    </div>
                    {unit[key as keyof UnitDetails] ? (
                      <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
                    ) : (
                      <XCircle className="h-4 w-4 text-gray-300 dark:text-gray-600" />
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Appliances */}
            {unit.appliances && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center space-x-2">
                    <Zap className="h-5 w-5" />
                    <span>
                      {t("properties.unitDetails.sections.appliances")}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {[
                    {
                      key: "refrigerator",
                      label: t(
                        "properties.unitDetails.appliances.refrigerator"
                      ),
                    },
                    {
                      key: "stove",
                      label: t("properties.unitDetails.appliances.stove"),
                    },
                    {
                      key: "oven",
                      label: t("properties.unitDetails.appliances.oven"),
                    },
                    {
                      key: "microwave",
                      label: t("properties.unitDetails.appliances.microwave"),
                    },
                    {
                      key: "dishwasher",
                      label: t("properties.unitDetails.appliances.dishwasher"),
                    },
                    {
                      key: "washer",
                      label: t("properties.unitDetails.appliances.washer"),
                    },
                    {
                      key: "dryer",
                      label: t("properties.unitDetails.appliances.dryer"),
                    },
                    {
                      key: "washerDryerHookups",
                      label: t(
                        "properties.unitDetails.appliances.washerDryerHookups"
                      ),
                    },
                  ].map(({ key, label }) => (
                    <div
                      key={key}
                      className="flex items-center justify-between"
                    >
                      <span className="text-sm">{label}</span>
                      {unit.appliances?.[
                        key as keyof typeof unit.appliances
                      ] ? (
                        <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
                      ) : (
                        <XCircle className="h-4 w-4 text-gray-300 dark:text-gray-600" />
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Parking */}
            {unit.parking && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center space-x-2">
                    <Car className="h-5 w-5" />
                    <span>{t("properties.unitDetails.sections.parking")}</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm">
                      {t("properties.unitDetails.parking.parkingIncluded")}
                    </span>
                    {unit.parking.included ? (
                      <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
                    ) : (
                      <XCircle className="h-4 w-4 text-gray-300 dark:text-gray-600" />
                    )}
                  </div>
                  {unit.parking.spaces && (
                    <div>
                      <span className="text-sm font-medium">
                        {t("properties.unitDetails.parking.spaces.label")}:{" "}
                      </span>
                      <span className="text-sm">{unit.parking.spaces}</span>
                    </div>
                  )}
                  {unit.parking.type && (
                    <div>
                      <span className="text-sm font-medium">
                        {t("properties.unitDetails.parking.type.labelShort")}:{" "}
                      </span>
                      <span className="text-sm capitalize">
                        {t(`properties.units.parking.type.${unit.parking.type}`, {
                          defaultValue: unit.parking.type,
                        })}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-sm">
                      {t("properties.unitDetails.parking.gated")}
                    </span>
                    {unit.parking.gated ? (
                      <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
                    ) : (
                      <XCircle className="h-4 w-4 text-gray-300 dark:text-gray-600" />
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">
                      {t("properties.unitDetails.parking.assigned")}
                    </span>
                    {unit.parking.assigned ? (
                      <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
                    ) : (
                      <XCircle className="h-4 w-4 text-gray-300 dark:text-gray-600" />
                    )}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Utilities */}
          {unit.utilities && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Droplets className="h-5 w-5" />
                  <span>{t("properties.unitDetails.sections.utilities")}</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {[
                    {
                      key: "electricity",
                      label: t("properties.unitDetails.utilities.electricity"),
                      icon: Zap,
                    },
                    {
                      key: "water",
                      label: t("properties.unitDetails.utilities.water"),
                      icon: Droplets,
                    },
                    {
                      key: "gas",
                      label: t("properties.unitDetails.utilities.gas"),
                      icon: Thermometer,
                    },
                    {
                      key: "internet",
                      label: t("properties.unitDetails.utilities.internet"),
                      icon: Wifi,
                    },
                    {
                      key: "cable",
                      label: t("properties.unitDetails.utilities.cable"),
                      icon: Wifi,
                    },
                    {
                      key: "heating",
                      label: t("properties.unitDetails.utilities.heating"),
                      icon: Thermometer,
                    },
                    {
                      key: "cooling",
                      label: t("properties.unitDetails.utilities.cooling"),
                      icon: Thermometer,
                    },
                    {
                      key: "trash",
                      label: t("properties.unitDetails.utilities.trash"),
                      icon: Home,
                    },
                    {
                      key: "sewer",
                      label: t("properties.unitDetails.utilities.sewer"),
                      icon: Droplets,
                    },
                  ].map(({ key, label, icon: Icon }) => {
                    const value =
                      unit.utilities?.[key as keyof typeof unit.utilities];
                    const getUtilityColor = (val: string) => {
                      switch (val) {
                        case "included":
                          return "text-green-600 bg-green-50 border-green-200 dark:text-green-400 dark:bg-green-950/30 dark:border-green-800";
                        case "tenant":
                          return "text-red-600 bg-red-50 border-red-200 dark:text-red-400 dark:bg-red-950/30 dark:border-red-800";
                        case "shared":
                          return "text-yellow-600 bg-yellow-50 border-yellow-200 dark:text-yellow-400 dark:bg-yellow-950/30 dark:border-yellow-800";
                        default:
                          return "text-gray-600 bg-gray-50 border-gray-200 dark:text-gray-400 dark:bg-gray-950/30 dark:border-gray-800";
                      }
                    };

                    return (
                      <div
                        key={key}
                        className="flex items-center justify-between p-3 rounded-lg border"
                      >
                        <div className="flex items-center space-x-2">
                          <Icon className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                          <span className="text-sm font-medium">{label}</span>
                        </div>
                        {value && (
                          <Badge
                            className={`${getUtilityColor(
                              value
                            )} border text-xs`}
                          >
                            {t(
                              `properties.unitDetails.utilities.status.${value}`
                            )}
                          </Badge>
                        )}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="tenant" className="space-y-6">
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
                        <User className="h-8 w-8 text-gray-500 dark:text-gray-400" />
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
                          <div className="text-sm text-gray-500 dark:text-gray-400">
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
                      <User className="h-12 w-12 text-gray-400 dark:text-gray-600 mx-auto mb-4" />
                      <p className="text-gray-600 dark:text-gray-400">
                        {t("properties.unitDetails.tenant.placeholder")}
                      </p>
                      <p className="text-sm text-gray-500 dark:text-gray-500 mt-2">
                        {t("properties.unitDetails.tenant.integrationRequired")}
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
                      {t("properties.unitDetails.sections.leaseInformation")}
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
                            ? formatDisplayDate(lease.startDate)
                            : t("leases.details.common.notAvailable")}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">
                          {t("leases.table.endDate")}
                        </span>
                        <span className="text-sm font-semibold">
                          {lease?.endDate
                            ? formatDisplayDate(lease.endDate)
                            : t("leases.details.common.notAvailable")}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">
                          {t("leases.details.financial.monthlyRent")}
                        </span>
                        <span className="text-sm font-semibold">
                          {typeof lease?.terms?.rentAmount === "number"
                            ? formatCurrencyLocalized(lease.terms.rentAmount)
                            : t("leases.details.common.notAvailable")}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">
                          {t("leases.details.financial.securityDeposit")}
                        </span>
                        <span className="text-sm font-semibold">
                          {typeof lease?.terms?.securityDeposit === "number"
                            ? formatCurrencyLocalized(
                                lease.terms.securityDeposit
                              )
                            : t("leases.details.common.notAvailable")}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <FileText className="h-12 w-12 text-gray-400 dark:text-gray-600 mx-auto mb-4" />
                      <p className="text-gray-600 dark:text-gray-400">
                        {t("properties.unitDetails.lease.placeholder")}
                      </p>
                      <p className="text-sm text-gray-500 dark:text-gray-500 mt-2">
                        {t("properties.unitDetails.lease.integrationRequired")}
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          ) : (
            <Card>
              <CardContent className="text-center py-16">
                <User className="h-16 w-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
                  {t("properties.unitDetails.tenant.noTenant")}
                </h3>
                <p className="text-gray-600 dark:text-gray-400 mb-6">
                  {t("properties.unitDetails.tenant.statusDescription", {
                    values: { status: unit.status.toLowerCase() },
                  })}
                </p>
                <div className="flex justify-center space-x-4">
                  <Button>
                    <User className="h-4 w-4 me-2" />
                    {t("properties.unitDetails.actions.addTenant")}
                  </Button>
                  <Button variant="outline">
                    <FileText className="h-4 w-4 me-2" />
                    {t("properties.unitDetails.actions.createLease")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="documents" className="space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="flex items-center space-x-2">
                <FileText className="h-5 w-5" />
                <span>
                  {t("properties.unitDetails.sections.unitDocuments")}
                </span>
              </CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowDocUpload(!showDocUpload)}
              >
                {showDocUpload
                  ? t("common.cancel")
                  : t("properties.unitDetails.actions.uploadDocuments")}
              </Button>
            </CardHeader>
            <CardContent className="space-y-6">
              {showDocUpload && (
                <div className="mb-8 pb-8 border-b">
                  <FileUpload
                    onFilesSelected={handleDocumentsUploaded}
                    disabled={isUploadingDocs}
                  />
                </div>
              )}

              {(unit.attachments?.length ?? 0) > 0 ? (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {(unit.attachments ?? []).map((doc, index) => (
                    <Card
                      key={index}
                      className="p-4 hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-center space-x-3 truncate">
                          <div className="p-2 bg-blue-100 dark:bg-blue-950/30 rounded-lg">
                            <FileText className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                          </div>
                          <div className="truncate">
                            <p
                              className="font-medium truncate"
                              title={doc.fileName}
                            >
                              {doc.fileName}
                            </p>
                            <p className="text-xs text-muted-foreground uppercase">
                              {doc.fileType.split("/")[1] || "File"} •{" "}
                              {(doc.fileSize / 1024 / 1024).toFixed(2)} MB
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center space-x-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            asChild
                          >
                            <a
                              href={doc.fileUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <Download className="h-4 w-4" />
                            </a>
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-red-500 hover:text-red-600"
                            onClick={() => handleDeleteDocument(index)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                      {doc.uploadedAt && (
                        <div className="mt-3 pt-3 border-t flex items-center justify-between text-xs text-muted-foreground">
                          <span className="flex items-center">
                            <Clock className="h-3 w-3 me-1" />
                            {formatDisplayDate(doc.uploadedAt)}
                          </span>
                        </div>
                      )}
                    </Card>
                  ))}
                </div>
              ) : (
                !showDocUpload && (
                  <div className="text-center py-16">
                    <FileText className="h-16 w-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
                      {t("properties.unitDetails.documents.noDocuments")}
                    </h3>
                    <p className="text-gray-600 dark:text-gray-400 mb-6">
                      {t("properties.unitDetails.documents.uploadDescription")}
                    </p>
                    <Button onClick={() => setShowDocUpload(true)}>
                      <FileText className="h-4 w-4 me-2" />
                      {t("properties.unitDetails.actions.uploadDocuments")}
                    </Button>
                  </div>
                )
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
