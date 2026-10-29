"use client";

import { z } from "zod";
import { toast } from "sonner";
import { format } from "date-fns";
import { useForm } from "react-hook-form";
import { useState, useEffect, useMemo, useRef } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { ImageUpload } from "@/components/ui/image-upload";
import { FormDateTimePicker } from "@/components/ui/date-time-picker";
import {
  SearchableSelect,
  type SearchableSelectOption,
} from "@/components/ui/searchable-select";
import {
  Wrench,
  AlertTriangle,
  Building2,
  User,
  Image as ImageIcon,
} from "lucide-react";
import { MaintenancePriority } from "@/types";
import { useGroupNames } from "@/hooks/useGroupNames";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

// Form validation schema
const maintenanceRequestFormSchema = z.object({
  title: z.string().min(1, "Title is required").max(100, "Title too long"),
  description: z
    .string()
    .min(10, "Description must be at least 10 characters")
    .max(1000, "Description too long"),
  category: z.string().min(1, "Category is required"),
  priority: z.nativeEnum(MaintenancePriority),
  propertyId: z.string().min(1, "Property is required"),
  unitId: z.string().optional(),
  tenantId: z.string().min(1, "Tenant is required"),
  assignedTo: z.string().optional(),
  estimatedCost: z.number().min(0, "Cost cannot be negative").optional(),
  scheduledDate: z
    .string()
    .optional()
    .refine((date) => {
      if (!date) return true;
      return !isNaN(Date.parse(date));
    }, "Invalid date format"),
  images: z.array(z.string()).optional(),
});

type MaintenanceRequestFormData = z.infer<typeof maintenanceRequestFormSchema>;

interface MaintenanceRequestFormProps {
  onSubmit: (data: MaintenanceRequestFormData) => void;
  isLoading?: boolean;
  initialData?: Partial<MaintenanceRequestFormData>;
  isTenantView?: boolean;
  showPropertyTenantSection?: boolean;
  showAssignmentSchedulingSection?: boolean;
  submitLabel?: string;
  submitDisabled?: boolean;
  properties?: Array<{
    id: string;
    name: string;
    address: string;
    isMultiUnit?: boolean;
    units?: Array<{
      _id: string;
      unitNumber: string;
      unitType: string;
      status: string;
      currentTenantId?: string;
      currentLeaseId?: string;
    }>;
  }>;
  tenants?: Array<{
    id: string;
    name: string;
    email: string;
    phone?: string;
    avatar?: string;
    unitNumber?: string;
    unitType?: string;
    leaseStatus?: string;
    propertyName?: string;
  }>;
  technicians?: Array<{
    id: string;
    name: string;
    email: string;
    role?: string;
    specialties?: string[];
  }>;
}

const maintenanceCategories = [
  { key: "plumbing", value: "Plumbing" },
  { key: "electrical", value: "Electrical" },
  { key: "hvac", value: "HVAC" },
  { key: "appliances", value: "Appliances" },
  { key: "flooring", value: "Flooring" },
  { key: "painting", value: "Painting" },
  { key: "roofing", value: "Roofing" },
  { key: "windows", value: "Windows" },
  { key: "doors", value: "Doors" },
  { key: "landscaping", value: "Landscaping" },
  { key: "cleaning", value: "Cleaning" },
  { key: "pestControl", value: "Pest Control" },
  { key: "security", value: "Security" },
  { key: "generalRepair", value: "General Repair" },
  { key: "emergency", value: "Emergency" },
  { key: "other", value: "Other" },
];

export function MaintenanceRequestForm({
  onSubmit,
  isLoading = false,
  initialData,
  isTenantView = false,
  showPropertyTenantSection,
  showAssignmentSchedulingSection,
  submitLabel,
  submitDisabled = false,
  properties = [],
  tenants = [],
  technicians = [],
}: MaintenanceRequestFormProps) {
  const { t } = useLocalizationContext();
  const { roleName } = useGroupNames();
  const getDisplayUnitStatus = (unit: {
    status: string;
    currentTenantId?: string;
    currentLeaseId?: string;
  }) => {
    const normalizedStatus = (unit.status || "").toLowerCase();
    if (
      normalizedStatus === "occupied" &&
      (!unit.currentTenantId || !unit.currentLeaseId)
    ) {
      return t("maintenance.form.unit.statusNeedsSync", {
        defaultValue: "needs sync",
      });
    }

    return unit.status;
  };
  const maintenanceCategoryOptions = useMemo<SearchableSelectOption[]>(
    () =>
      maintenanceCategories.map((category) => ({
        value: category.value,
        label: t(`maintenance.categories.${category.key}`),
      })),
    [t]
  );
  const propertyOptions = useMemo<SearchableSelectOption[]>(
    () =>
      properties.map((property) => ({
        value: property.id,
        label: property.name,
        subtitle: property.address,
        badge: property.isMultiUnit
          ? t("maintenance.form.property.multiUnit")
          : undefined,
      })),
    [properties, t]
  );
  const technicianOptions = useMemo<SearchableSelectOption[]>(
    () => [
      {
        value: "UNASSIGNED",
        label: t("maintenance.form.assignedTo.unassigned"),
      },
      ...technicians.map((tech) => ({
        value: tech.id,
        label: tech.name,
        subtitle: tech.email,
        // The technician's role by its name, not a group's stored key.
        badge: tech.role ? roleName(tech.role) : undefined,
      })),
    ],
    [technicians, t, roleName]
  );
  const [hasInitialized, setHasInitialized] = useState(false);
  const [uploadedImages, setUploadedImages] = useState<
    { url: string; publicId: string }[]
  >((initialData?.images || []).map((url) => ({ url, publicId: "" })));

  const [availableUnits, setAvailableUnits] = useState<
    Array<{
      _id: string;
      unitNumber: string;
      unitType: string;
      status: string;
      currentTenantId?: string;
      currentLeaseId?: string;
    }>
  >([]);

  const [filteredTenants, setFilteredTenants] = useState<
    Array<{
      id: string;
      name: string;
      email: string;
      phone?: string;
      avatar?: string;
      unitNumber?: string;
      unitType?: string;
      leaseStatus?: string;
      propertyName?: string;
    }>
  >([]);

  const [loadingTenants, setLoadingTenants] = useState(false);
  const unitOptions = useMemo<SearchableSelectOption[]>(
    () =>
      availableUnits.map((unit) => ({
        value: unit._id,
        label: `Unit ${unit.unitNumber}`,
        subtitle: `${unit.unitType} • ${getDisplayUnitStatus(unit)}`,
      })),
    [availableUnits, t]
  );
  const tenantOptions = useMemo<SearchableSelectOption[]>(
    () =>
      filteredTenants.map((tenant) => ({
        value: tenant.id,
        label: tenant.name,
        subtitle: tenant.email,
        badge: tenant.unitNumber
          ? `Unit ${tenant.unitNumber}${
              tenant.unitType ? ` (${tenant.unitType})` : ""
            }`
          : tenant.leaseStatus
          ? `${tenant.leaseStatus} ${t("maintenance.form.tenant.lease")}`
          : undefined,
      })),
    [filteredTenants, t]
  );

  const form = useForm<MaintenanceRequestFormData>({
    resolver: zodResolver(maintenanceRequestFormSchema),
    defaultValues: {
      title: initialData?.title || "",
      description: initialData?.description || "",
      category: initialData?.category || "",
      priority: initialData?.priority || MaintenancePriority.MEDIUM,
      propertyId: initialData?.propertyId || "",
      unitId: initialData?.unitId || "",
      tenantId: initialData?.tenantId || "",
      assignedTo: initialData?.assignedTo || "",
      estimatedCost: initialData?.estimatedCost || undefined,
      scheduledDate: initialData?.scheduledDate || "",
      images: initialData?.images || [],
    },
  });

  const watchedPriority = form.watch("priority");
  const watchedCategory = form.watch("category");
  const watchedPropertyId = form.watch("propertyId");
  const watchedUnitId = form.watch("unitId");

  useEffect(() => {
    if (!initialData) {
      return;
    }

    if (initialData.propertyId) {
      form.setValue("propertyId", initialData.propertyId);
    }

    if (initialData.unitId !== undefined) {
      form.setValue("unitId", initialData.unitId || "");
    }

    if (initialData.tenantId) {
      form.setValue("tenantId", initialData.tenantId);
    }
  }, [
    form,
    initialData?.propertyId,
    initialData?.tenantId,
    initialData?.unitId,
  ]);

  const [prevPropertyId, setPrevPropertyId] = useState<string | undefined>(
    undefined
  );
  const [prevUnitId, setPrevUnitId] = useState<string | undefined>(undefined);
  const tenantFetchKeyRef = useRef<string | null>(null);

  // Function to fetch tenants for a specific property
  const fetchPropertyTenants = async (propertyId: string, unitId?: string) => {
    const requestKey = `${propertyId}:${unitId || "all"}`;
    if (tenantFetchKeyRef.current === requestKey) {
      return;
    }

    tenantFetchKeyRef.current = requestKey;

    try {
      setLoadingTenants(true);
      const url = new URL(
        `/api/properties/${propertyId}/tenants`,
        window.location.origin
      );
      if (unitId) {
        url.searchParams.set("unitId", unitId);
      }
      url.searchParams.set("status", "active");

      const response = await fetch(url.toString());

      if (response.ok) {
        const data = await response.json();
        // Handle both possible response structures
        const apiTenants = data?.data?.tenants || data?.tenants || [];

        // Map API response to expected format
        let mappedTenants = apiTenants
          .filter((tenant: any) => tenant && (tenant.id || tenant._id)) // Filter out invalid entries
          .map((tenant: any) => ({
            id: tenant.id || tenant._id,
            name:
              `${tenant.firstName || ""} ${tenant.lastName || ""}`.trim() ||
              "Unknown Tenant",
            email: tenant.email || "",
            phone: tenant.phone || "",
            avatar: tenant.avatar,
            unitNumber: tenant.unit?.unitNumber,
            unitType: tenant.unit?.type,
            leaseStatus: tenant.lease?.status,
            propertyName: undefined, // Not needed since we're filtering by property
          }));

        // Ensure currently selected tenant remains available in the dropdown
        const currentTenantId =
          form.getValues("tenantId") || initialData?.tenantId || "";
        if (
          currentTenantId &&
          !mappedTenants.some((t: any) => t.id === currentTenantId)
        ) {
          const fallbackTenant = tenants.find((t) => t.id === currentTenantId);
          if (fallbackTenant) {
            mappedTenants = [{ ...fallbackTenant }, ...mappedTenants];
          }
        }

        setFilteredTenants(mappedTenants);

        // Show success message if tenants found
        if (mappedTenants.length > 0) {
          toast.success(
            t("maintenance.form.toasts.tenantsFound", {
              values: { count: mappedTenants.length },
            }),
            { id: `maintenance-tenants-found-${requestKey}` }
          );
        } else {
          const selectedProperty = properties.find((p) => p.id === propertyId);
          const selectedUnit = unitId
            ? selectedProperty?.units?.find((unit) => unit._id === unitId)
            : undefined;
          const isOccupiedWithoutActiveLease = Boolean(
            unitId &&
              selectedUnit &&
              selectedUnit.status?.toLowerCase() === "occupied" &&
              (!selectedUnit.currentTenantId || !selectedUnit.currentLeaseId)
          );

          setFilteredTenants([]);

          toast.info(
            isOccupiedWithoutActiveLease
              ? t("maintenance.form.toasts.occupiedUnitNoActiveTenant", {
                  defaultValue:
                    "This unit is marked occupied, but no active lease-linked tenant was found.",
                })
              : unitId
              ? t("maintenance.form.toasts.noTenantsFoundForUnit", {
                  defaultValue: "No active tenant found for the selected unit.",
                })
              : t("maintenance.form.toasts.noTenantsFoundForProperty", {
                  defaultValue:
                    "No active tenants found for the selected property.",
                }),
            {
              id: `maintenance-no-tenants-${requestKey}`,
            }
          );
        }
      } else {
        console.error("Failed to fetch property tenants:", response.status);
        // Fall back to showing all tenants
        setFilteredTenants(tenants);
        toast.error(t("maintenance.form.toasts.loadTenantsFailed"), {
          id: `maintenance-tenants-load-failed-${requestKey}`,
        });
      }
    } catch (error) {
      console.error("Error fetching property tenants:", error);
      // Fall back to showing all tenants
      setFilteredTenants(tenants);
      toast.error(t("maintenance.form.toasts.loadTenantsError"), {
        id: `maintenance-tenants-load-error-${requestKey}`,
      });
    } finally {
      setLoadingTenants(false);
    }
  };

  // Initialize filtered tenants - always show all tenants initially
  useEffect(() => {
    // Always show all tenants when tenants list changes
    // Property-specific filtering will override this when a property is selected
    setFilteredTenants(tenants);
  }, [tenants]);

  // Update available units and filter tenants when property changes
  useEffect(() => {
    if (watchedPropertyId) {
      const selectedProperty = properties.find(
        (p) => p.id === watchedPropertyId
      );

      // Handle units for multi-unit properties
      if (selectedProperty?.isMultiUnit && selectedProperty.units) {
        setAvailableUnits(selectedProperty.units);
      } else {
        setAvailableUnits([]);
        form.setValue("unitId", ""); // Clear unit selection for single-unit properties
      }

      // Note: Tenant fetching is handled by the dedicated effect below to avoid duplicate calls

      // Clear tenant selection only when property actually changes after initial load
      if (
        hasInitialized &&
        prevPropertyId &&
        prevPropertyId !== watchedPropertyId
      ) {
        form.setValue("tenantId", "");
      }
      setPrevPropertyId(watchedPropertyId);
    } else {
      tenantFetchKeyRef.current = null;
      setAvailableUnits([]);
      setFilteredTenants(tenants); // Show all tenants when no property is selected
      form.setValue("unitId", "");
      if (hasInitialized) {
        form.setValue("tenantId", "");
      }
    }
  }, [
    watchedPropertyId,
    properties,
    // form, // Removed form from dependencies to prevent infinite loops
    tenants,
    hasInitialized,
    prevPropertyId,
  ]);

  // Update tenant filtering when unit changes
  useEffect(() => {
    if (!isTenantView) {
      if (watchedPropertyId && watchedUnitId) {
        fetchPropertyTenants(watchedPropertyId, watchedUnitId);
        if (hasInitialized && prevUnitId && prevUnitId !== watchedUnitId) {
          form.setValue("tenantId", "");
        }
        setPrevUnitId(watchedUnitId);
      } else if (watchedPropertyId) {
        fetchPropertyTenants(watchedPropertyId);
      }
    }
  }, [
    watchedUnitId,
    watchedPropertyId,
    hasInitialized,
    prevUnitId,
    isTenantView,
  ]);

  // Mark initialized after first render so default values don't trigger clearing
  useEffect(() => {
    if (!hasInitialized) {
      setHasInitialized(true);
    }
  }, [hasInitialized]);

  const handleFormSubmit = (data: MaintenanceRequestFormData) => {
    try {
      // Enhanced validation with better error messages
      if (!data.title?.trim()) {
        toast.error(t("maintenance.form.validation.titleRequired"));
        form.setFocus("title");
        return;
      }

      if (!data.description?.trim()) {
        toast.error(t("maintenance.form.validation.descriptionRequired"));
        form.setFocus("description");
        return;
      }

      if (!data.propertyId) {
        toast.error(t("maintenance.form.validation.propertyRequired"));
        form.setFocus("propertyId");
        return;
      }

      if (!data.tenantId) {
        toast.error(t("maintenance.form.validation.tenantRequired"));
        form.setFocus("tenantId");
        return;
      }

      if (!data.category) {
        toast.error(t("maintenance.form.validation.categoryRequired"));
        form.setFocus("category");
        return;
      }

      // Check if property has units but no unit is selected
      const selectedProperty = properties.find((p) => p.id === data.propertyId);
      if (
        selectedProperty?.isMultiUnit &&
        selectedProperty.units &&
        selectedProperty.units.length > 0 &&
        !data.unitId
      ) {
        toast.error(t("maintenance.form.validation.unitRequired"));
        form.setFocus("unitId");
        return;
      }

      const formattedData = {
        ...data,
        images: uploadedImages.map((img) => img.url),
        // Convert scheduledDate to ISO string if provided
        scheduledDate: data.scheduledDate
          ? new Date(data.scheduledDate).toISOString()
          : undefined,
      };
      onSubmit(formattedData);
    } catch (error) {
      console.error("Form submission error:", error);
      toast.error(t("maintenance.form.validation.submitError"));
    }
  };

  return (
    <div className="w-full space-y-8">
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(handleFormSubmit)}
          className="space-y-8"
        >
          {/* Request Details */}
          <Card className="border-0 shadow-lg bg-white/70 dark:bg-gray-900/70 backdrop-blur-sm">
            <CardHeader className="pb-6">
              <CardTitle className="flex items-center gap-3 text-xl">
                <div className="p-2 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 text-white">
                  <Wrench className="h-5 w-5" />
                </div>
                {t("maintenance.form.requestDetails.title")}
              </CardTitle>
              <CardDescription className="text-base">
                {t("maintenance.form.requestDetails.description")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                      {t("maintenance.form.title.label")}
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder={t("maintenance.form.title.placeholder")}
                        className="h-11 border-gray-200 dark:border-gray-700 focus:border-blue-500 focus:ring-blue-500/20 transition-all duration-200"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage className="text-red-500 text-sm" />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField
                  control={form.control}
                  name="category"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                        {t("maintenance.form.category.label")}
                      </FormLabel>
                      <FormControl>
                        <SearchableSelect
                          value={field.value || ""}
                          onValueChange={field.onChange}
                          options={maintenanceCategoryOptions}
                          placeholder={t(
                            "maintenance.form.category.placeholder"
                          )}
                          searchPlaceholder={t(
                            "maintenance.form.category.searchPlaceholder",
                            {
                              defaultValue: "Search categories...",
                            }
                          )}
                          emptyMessage={t(
                            "maintenance.form.category.emptyMessage",
                            {
                              defaultValue: "No category found.",
                            }
                          )}
                          triggerClassName="h-11 border-gray-200 dark:border-gray-700 focus:border-blue-500 focus:ring-blue-500/20 transition-all duration-200"
                        />
                      </FormControl>
                      <FormMessage className="text-red-500 text-sm" />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="priority"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                        {t("maintenance.form.priority.label")}
                      </FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value || undefined}
                      >
                        <FormControl>
                          <SelectTrigger className="h-11 border-gray-200 dark:border-gray-700 focus:border-blue-500 focus:ring-blue-500/20 transition-all duration-200">
                            <SelectValue
                              placeholder={t(
                                "maintenance.form.priority.placeholder"
                              )}
                            />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value={MaintenancePriority.EMERGENCY}>
                            <div className="flex items-center">
                              <AlertTriangle className="h-4 w-4 me-2 text-red-500" />
                              {t("maintenance.form.priority.emergency")}
                            </div>
                          </SelectItem>
                          <SelectItem value={MaintenancePriority.HIGH}>
                            <div className="flex items-center">
                              <div className="h-2 w-2 rounded-full bg-orange-500 me-2" />
                              {t("maintenance.form.priority.high")}
                            </div>
                          </SelectItem>
                          <SelectItem value={MaintenancePriority.MEDIUM}>
                            <div className="flex items-center">
                              <div className="h-2 w-2 rounded-full bg-yellow-500 me-2" />
                              {t("maintenance.form.priority.medium")}
                            </div>
                          </SelectItem>
                          <SelectItem value={MaintenancePriority.LOW}>
                            <div className="flex items-center">
                              <div className="h-2 w-2 rounded-full bg-green-500 me-2" />
                              {t("maintenance.form.priority.low")}
                            </div>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage className="text-red-500 text-sm" />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                      {t("maintenance.form.description.label")}
                    </FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder={t(
                          "maintenance.form.description.placeholder"
                        )}
                        className="resize-none border-gray-200 dark:border-gray-700 focus:border-blue-500 focus:ring-blue-500/20 transition-all duration-200"
                        rows={4}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage className="text-red-500 text-sm" />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          {(showPropertyTenantSection ?? !isTenantView) && (
            <Card className="border-0 shadow-lg bg-white/70 dark:bg-gray-900/70 backdrop-blur-sm">
              <CardHeader className="pb-6">
                <CardTitle className="flex items-center gap-3 text-xl">
                  <div className="p-2 rounded-lg bg-gradient-to-br from-green-500 to-emerald-600 text-white">
                    <Building2 className="h-5 w-5" />
                  </div>
                  {t("maintenance.form.propertyTenant.title")}
                </CardTitle>
                <CardDescription className="text-base">
                  {t("maintenance.form.propertyTenant.description")}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div
                  className={`grid gap-6 ${
                    availableUnits.length > 0
                      ? "grid-cols-1 md:grid-cols-3"
                      : "grid-cols-1 md:grid-cols-2"
                  }`}
                >
                  <FormField
                    control={form.control}
                    name="propertyId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                          {t("maintenance.form.property.label")}
                        </FormLabel>
                        <FormControl>
                          <SearchableSelect
                            value={field.value || ""}
                            onValueChange={field.onChange}
                            options={propertyOptions}
                            placeholder={t(
                              "maintenance.form.property.placeholder"
                            )}
                            searchPlaceholder={t(
                              "maintenance.form.property.searchPlaceholder",
                              {
                                defaultValue: "Search properties...",
                              }
                            )}
                            emptyMessage={t(
                              "maintenance.form.property.emptyMessage",
                              {
                                defaultValue: "No property found.",
                              }
                            )}
                            triggerClassName="h-11 border-gray-200 dark:border-gray-700 focus:border-blue-500 focus:ring-blue-500/20 transition-all duration-200"
                          />
                        </FormControl>
                        <FormMessage className="text-red-500 text-sm" />
                      </FormItem>
                    )}
                  />

                  {/* Unit Selection - Only show for multi-unit properties */}
                  {availableUnits.length > 0 && (
                    <FormField
                      control={form.control}
                      name="unitId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            {t("maintenance.form.unit.label")}
                          </FormLabel>
                          <FormControl>
                            <SearchableSelect
                              value={field.value || ""}
                              onValueChange={field.onChange}
                              options={unitOptions}
                              placeholder={t("maintenance.form.unit.placeholder")}
                              searchPlaceholder={t(
                                "maintenance.form.unit.searchPlaceholder",
                                {
                                  defaultValue: "Search units...",
                                }
                              )}
                              emptyMessage={t(
                                "maintenance.form.unit.emptyMessage",
                                {
                                  defaultValue: "No unit found.",
                                }
                              )}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}

                  <FormField
                    control={form.control}
                    name="tenantId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                          {t("maintenance.form.tenant.label")}
                        </FormLabel>
                        <FormControl>
                          <SearchableSelect
                            value={field.value || ""}
                            onValueChange={field.onChange}
                            options={tenantOptions}
                            placeholder={t("maintenance.form.tenant.placeholder")}
                            searchPlaceholder={t(
                              "maintenance.form.tenant.searchPlaceholder",
                              {
                                defaultValue: "Search tenants...",
                              }
                            )}
                            emptyMessage={
                              loadingTenants
                                ? t("maintenance.form.tenant.loading")
                                : watchedUnitId
                                ? t(
                                    "maintenance.form.tenant.noTenantsForUnit",
                                    {
                                      defaultValue:
                                        "No tenants found for the selected unit",
                                    }
                                  )
                                : watchedPropertyId
                                ? t(
                                    "maintenance.form.tenant.noTenantsForProperty"
                                  )
                                : tenants.length > 0
                                ? t(
                                    "maintenance.form.tenant.noTenantsAvailable"
                                  )
                                : t("maintenance.form.tenant.loading")
                            }
                            disabled={loadingTenants}
                            triggerClassName="h-11 border-gray-200 dark:border-gray-700 focus:border-blue-500 focus:ring-blue-500/20 transition-all duration-200"
                          />
                        </FormControl>
                        <FormMessage className="text-red-500 text-sm" />
                      </FormItem>
                    )}
                  />
                </div>
              </CardContent>
            </Card>
          )}

          {(showAssignmentSchedulingSection ?? !isTenantView) && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <User className="h-5 w-5" />
                  {t("maintenance.form.assignment.title")}
                </CardTitle>
                <CardDescription>
                  {t("maintenance.form.assignment.description")}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <FormField
                    control={form.control}
                    name="assignedTo"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          {t("maintenance.form.assignedTo.label")}
                        </FormLabel>
                        <FormControl>
                          <SearchableSelect
                            value={field.value || "UNASSIGNED"}
                            onValueChange={(value) =>
                              field.onChange(value === "UNASSIGNED" ? "" : value)
                            }
                            options={technicianOptions}
                            placeholder={t(
                              "maintenance.form.assignedTo.placeholder"
                            )}
                            searchPlaceholder={t(
                              "maintenance.form.assignedTo.searchPlaceholder",
                              {
                                defaultValue: "Search technicians...",
                              }
                            )}
                            emptyMessage={t(
                              "maintenance.form.assignedTo.emptyMessage",
                              {
                                defaultValue: "No technician found.",
                              }
                            )}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="estimatedCost"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          {t("maintenance.form.estimatedCost.label")}
                        </FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            step="0.01"
                            placeholder={t(
                              "maintenance.form.estimatedCost.placeholder"
                            )}
                            {...field}
                            onChange={(e) =>
                              field.onChange(
                                parseFloat(e.target.value) || undefined
                              )
                            }
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="scheduledDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          {t("maintenance.form.scheduledDate.label")}
                        </FormLabel>
                        <FormControl>
                          <FormDateTimePicker
                            value={
                              field.value ? new Date(field.value) : undefined
                            }
                            onChange={(date) => {
                              if (date) {
                                const formattedValue = format(
                                  date,
                                  "yyyy-MM-dd'T'HH:mm"
                                );
                                field.onChange(formattedValue);
                              } else {
                                field.onChange("");
                              }
                            }}
                            placeholder={t(
                              "maintenance.form.scheduledDate.placeholder"
                            )}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </CardContent>
            </Card>
          )}

          {/* Image Upload */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ImageIcon className="h-5 w-5" />
                {t("maintenance.form.photos.title")}
              </CardTitle>
              <CardDescription>
                {t("maintenance.form.photos.description")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ImageUpload
                onImagesUploaded={(newImages) => {
                  const updatedImages = [...uploadedImages, ...newImages];
                  setUploadedImages(updatedImages);
                  form.setValue(
                    "images",
                    updatedImages.map((img) => img.url)
                  );
                }}
                onImagesRemoved={(removedImages) => {
                  const updatedImages = uploadedImages.filter(
                    (img) =>
                      !removedImages.some(
                        (removed) => removed.publicId === img.publicId
                      )
                  );
                  setUploadedImages(updatedImages);
                  form.setValue(
                    "images",
                    updatedImages.map((img) => img.url)
                  );
                }}
                existingImages={uploadedImages}
                maxFiles={10}
                folder="PropertyPro/maintenance"
                quality="auto"
              />
            </CardContent>
          </Card>

          {/* Submit Button */}
          <Card className="border-0 shadow-lg bg-white/70 dark:bg-gray-900/70 backdrop-blur-sm">
            <CardContent className="pt-6">
              <div className="flex justify-end space-x-4">
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 px-6 border-gray-300 hover:bg-gray-50 hover:border-gray-400 transition-all duration-200"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    window.history.back();
                  }}
                >
                  {t("maintenance.form.buttons.cancel")}
                </Button>
                <Button
                  type="submit"
                  disabled={isLoading || submitDisabled}
                  className="h-11 px-8 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-semibold shadow-lg hover:shadow-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isLoading
                    ? t("maintenance.form.buttons.submitting")
                    : submitLabel ||
                      (initialData
                        ? t("maintenance.form.buttons.updateRequest")
                        : t("maintenance.form.buttons.submitRequest"))}
                </Button>
              </div>
            </CardContent>
          </Card>
        </form>
      </Form>
    </div>
  );
}
