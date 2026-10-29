"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
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
import { Checkbox } from "@/components/ui/checkbox";
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
  FormDescription,
} from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  FileText,
  DollarSign,
  Home,
  User,
  Settings,
  Plus,
  X,
  File,
  Trash2,
  AlertCircle,
  Building,
} from "lucide-react";
import {
  LeaseFormData,
  LeaseResponse,
  leaseService,
} from "@/lib/services/lease.service";
import { PaymentMethod } from "@/types";
import { leasePaymentSyncService } from "@/lib/services/lease-payment-sync.service";
import { FileUpload } from "@/components/ui/file-upload";
import { FormDatePicker } from "@/components/ui/date-picker";
import { businessDay } from "@/lib/dates/business-day";

// Enhanced validation schema for unified property-unit model with payment configuration
const leaseFormSchema = z
  .object({
    propertyId: z.string().min(1, "Property is required"),
    unitId: z.string().min(1, "Unit is required"),
    tenantId: z.string().min(1, "Tenant is required"),
    startDate: z.string().min(1, "Start date is required"),
    endDate: z.string().min(1, "End date is required"),
    status: z
      .enum(["draft", "pending", "active", "expired", "terminated"])
      .optional(),
    terms: z.object({
      rentAmount: z.number().min(1, "Rent amount must be greater than 0"),
      securityDeposit: z.number().min(0, "Security deposit must be positive"),
      lateFee: z.number().min(0, "Late fee must be positive"),
      petDeposit: z.number().min(0, "Pet deposit must be positive").optional(),
      utilities: z.array(z.string()).default([]),
      restrictions: z.array(z.string()).default([]),
      paymentConfig: z
        .object({
          rentDueDay: z.number().min(1).max(31).default(1),
          lateFeeConfig: z
            .object({
              enabled: z.boolean().default(false),
              gracePeriodDays: z.number().min(0).max(30).default(5),
              feeType: z.enum(["fixed", "percentage"]).default("fixed"),
              feeAmount: z.number().min(0).default(0),
              maxFeeAmount: z.number().min(0).optional(),
              compoundDaily: z.boolean().default(false),
              notificationDays: z.array(z.number()).default([3, 7, 14]),
            })
            .default({}),
          acceptedPaymentMethods: z
            .array(z.nativeEnum(PaymentMethod))
            .default([PaymentMethod.BANK_TRANSFER, PaymentMethod.CREDIT_CARD]),
          autoCreatePayments: z.boolean().default(true),
          autoGenerateInvoices: z.boolean().default(true),
          autoEmailInvoices: z.boolean().default(true),
          prorationEnabled: z.boolean().default(true),
          advancePaymentMonths: z.number().min(0).max(12).default(0),
        })
        .optional(),
    }),
    documents: z.array(z.string()).default([]).optional(),
    renewalOptions: z
      .object({
        available: z.boolean().default(false),
        terms: z.string().optional(),
      })
      .optional(),
    notes: z.string().optional(),
  })
  .refine((data) => new Date(data.endDate) > new Date(data.startDate), {
    message: "End date must be after start date",
    path: ["endDate"],
  });

// Input (pre-parse: `.default()` fields optional) vs output (post-parse) types
// diverge, so useForm needs both to satisfy zodResolver's Resolver typing.
type LeaseFormInput = z.input<typeof leaseFormSchema>;
type LeaseFormValues = z.output<typeof leaseFormSchema>;

/**
 * Lease.terms is stored as Json in Prisma and legitimately carries a
 * paymentConfig block; the shared LeaseResponse interface omits it, so the
 * initial data is typed here to match what the API actually returns.
 */
interface InitialPaymentConfig {
  rentDueDay?: number;
  lateFeeConfig?: {
    enabled?: boolean;
    gracePeriodDays?: number;
    feeType?: "fixed" | "percentage";
    feeAmount?: number;
    maxFeeAmount?: number;
    compoundDaily?: boolean;
    notificationDays?: number[];
  };
  acceptedPaymentMethods?: PaymentMethod[];
  autoCreatePayments?: boolean;
  autoGenerateInvoices?: boolean;
  autoEmailInvoices?: boolean;
  prorationEnabled?: boolean;
  advancePaymentMonths?: number;
}

type LeaseFormInitialData = Partial<Omit<LeaseResponse, "terms">> & {
  terms?: LeaseResponse["terms"] & { paymentConfig?: InitialPaymentConfig };
};

/** What the form submits: LeaseFormData plus the paymentConfig the form edits. */
type LeaseSubmitData = Omit<LeaseFormData, "terms" | "status"> & {
  status?: LeaseFormValues["status"];
  terms: LeaseFormValues["terms"];
};

interface LeaseFormProps {
  initialData?: LeaseFormInitialData;
  onSubmit: (
    data: LeaseSubmitData
  ) => Promise<void | { _id?: string; id?: string }>;
  onCancel: () => void;
  isLoading?: boolean;
  mode?: "create" | "edit";
}

const UTILITY_OPTIONS = [
  "electricity",
  "gas",
  "water",
  "sewer",
  "trash",
  "internet",
  "cable",
  "heating",
  "cooling",
  "landscaping",
];

const COMMON_RESTRICTIONS = [
  "No smoking",
  "No pets",
  "No subletting",
  "No parties",
  "Quiet hours 10 PM - 8 AM",
  "Maximum occupancy",
  "No alterations without permission",
];

export function LeaseForm({
  initialData,
  onSubmit,
  onCancel,
  isLoading = false,
  mode = "create",
}: LeaseFormProps) {
  const [properties, setProperties] = useState<any[]>([]);
  const [availableUnits, setAvailableUnits] = useState<any[]>([]);
  const [tenants, setTenants] = useState<any[]>([]);
  const [selectedUnit, setSelectedUnit] = useState<any>(null);
  const [loadingData, setLoadingData] = useState(true);
  const [loadingUnits, setLoadingUnits] = useState(false);
  const [customUtility, setCustomUtility] = useState("");
  const [customRestriction, setCustomRestriction] = useState("");
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  const form = useForm<LeaseFormInput, unknown, LeaseFormValues>({
    resolver: zodResolver(leaseFormSchema),
    defaultValues: {
      propertyId: initialData?.propertyId?._id || "",
      unitId: initialData?.unitId || "",
      tenantId: initialData?.tenantId?._id || "",
      startDate: initialData?.startDate
        ? businessDay(initialData.startDate)
        : "",
      endDate: initialData?.endDate ? businessDay(initialData.endDate) : "",
      status: (initialData?.status as LeaseFormValues["status"]) || "draft",
      terms: {
        rentAmount: initialData?.terms?.rentAmount || 0,
        securityDeposit: initialData?.terms?.securityDeposit || 0,
        lateFee: initialData?.terms?.lateFee || 0,
        petDeposit: initialData?.terms?.petDeposit || 0,
        utilities: initialData?.terms?.utilities || [],
        restrictions: initialData?.terms?.restrictions || [],
        paymentConfig: {
          rentDueDay: initialData?.terms?.paymentConfig?.rentDueDay || 1,
          lateFeeConfig: {
            enabled:
              initialData?.terms?.paymentConfig?.lateFeeConfig?.enabled ||
              false,
            gracePeriodDays:
              initialData?.terms?.paymentConfig?.lateFeeConfig
                ?.gracePeriodDays || 5,
            feeType:
              initialData?.terms?.paymentConfig?.lateFeeConfig?.feeType ||
              "fixed",
            feeAmount:
              initialData?.terms?.paymentConfig?.lateFeeConfig?.feeAmount || 0,
            maxFeeAmount:
              initialData?.terms?.paymentConfig?.lateFeeConfig?.maxFeeAmount ||
              0,
            compoundDaily:
              initialData?.terms?.paymentConfig?.lateFeeConfig?.compoundDaily ||
              false,
            notificationDays: initialData?.terms?.paymentConfig?.lateFeeConfig
              ?.notificationDays || [3, 7, 14],
          },
          acceptedPaymentMethods: initialData?.terms?.paymentConfig
            ?.acceptedPaymentMethods || [
            PaymentMethod.BANK_TRANSFER,
            PaymentMethod.CREDIT_CARD,
          ],
          autoCreatePayments:
            initialData?.terms?.paymentConfig?.autoCreatePayments ?? true,
          autoGenerateInvoices:
            initialData?.terms?.paymentConfig?.autoGenerateInvoices ?? true,
          autoEmailInvoices:
            initialData?.terms?.paymentConfig?.autoEmailInvoices ?? true,
          prorationEnabled:
            initialData?.terms?.paymentConfig?.prorationEnabled ?? true,
          advancePaymentMonths:
            initialData?.terms?.paymentConfig?.advancePaymentMonths || 0,
        },
      },
      documents: initialData?.documents || [],
      renewalOptions: {
        available: initialData?.renewalOptions?.available || false,
        terms: initialData?.renewalOptions?.terms || "",
      },
      notes: initialData?.notes || "",
    },
  });

  useEffect(() => {
    fetchFormData();
  }, []);

  // Watch for property changes to load available units
  const selectedPropertyId = form.watch("propertyId");
  const selectedUnitId = form.watch("unitId");

  useEffect(() => {
    if (selectedPropertyId) {
      fetchAvailableUnits(selectedPropertyId);
      // Reset unit selection when property changes
      form.setValue("unitId", "");
      setSelectedUnit(null);
    } else {
      setAvailableUnits([]);
      setSelectedUnit(null);
    }
  }, [selectedPropertyId, form]);

  // Watch for unit changes to auto-populate financial terms and utilities
  useEffect(() => {
    if (selectedUnitId && availableUnits.length > 0) {
      const unit = availableUnits.find((u) => u._id === selectedUnitId);
      if (unit) {
        setSelectedUnit(unit);
        // Auto-populate rent amount and security deposit from unit
        if (mode === "create") {
          form.setValue("terms.rentAmount", unit.rentAmount || 0);
          form.setValue("terms.securityDeposit", unit.securityDeposit || 0);

          // Auto-populate utilities based on unit configuration
          if (unit.utilities) {
            const includedUtilities = Object.entries(unit.utilities)
              .filter(([_, status]) => status === "included")
              .map(([utility, _]) => utility);
            form.setValue("terms.utilities", includedUtilities);
          }
        }
      }
    } else {
      setSelectedUnit(null);
    }
  }, [selectedUnitId, availableUnits, form, mode]);

  const fetchFormData = async () => {
    try {
      setLoadingData(true);

      // Fetch properties and tenants
      const [propertiesRes, tenantsRes] = await Promise.all([
        fetch("/api/properties?status=available&limit=100"),
        fetch("/api/users?role=tenant&limit=100"),
      ]);

      if (propertiesRes.ok) {
        const propertiesData = await propertiesRes.json();
        // Fix: The API returns { success: true, data: [...], pagination: {...} }
        setProperties(propertiesData.data || []);
      }

      if (tenantsRes.ok) {
        const tenantsData = await tenantsRes.json();
        // Fix: The API returns { success: true, data: { users: [...], pagination: {...} } }
        const tenantsList = tenantsData.data?.users || [];
        setTenants(Array.isArray(tenantsList) ? tenantsList : []);
      } else {
        setTenants([]);
        toast.error("Failed to load tenants");
      }
    } catch (error) {
      toast.error("Failed to load form data");
    } finally {
      setLoadingData(false);
    }
  };

  const fetchAvailableUnits = async (propertyId: string) => {
    try {
      setLoadingUnits(true);
      const response = await leaseService.getAvailableUnits(propertyId);
      setAvailableUnits(response);
    } catch (error) {
      toast.error("Failed to load available units");
      setAvailableUnits([]);
    } finally {
      setLoadingUnits(false);
    }
  };

  const handleSubmit = async (data: LeaseFormValues) => {
    try {
      setIsUploading(true);

      const formData: LeaseSubmitData = {
        ...data,
        terms: {
          ...data.terms,
          petDeposit: data.terms.petDeposit || 0,
        },
      };

      // First submit the lease data
      const result = (await onSubmit(formData)) as
        | { _id?: string; id?: string }
        | undefined;

      // Get the lease ID - either from edit mode or from the result of create
      const leaseId =
        mode === "edit" ? initialData?._id : result?._id || result?.id;

      // If auto-create payments is enabled and this is a new lease, create comprehensive payment system
      if (
        mode === "create" &&
        leaseId &&
        data.terms.paymentConfig?.autoCreatePayments
      ) {
        try {
          // Use the enhanced lease payment sync service for comprehensive setup
          const syncResult =
            await leasePaymentSyncService.setupLeasePaymentSystem(leaseId, {
              autoGenerateInvoices:
                data.terms.paymentConfig?.autoGenerateInvoices ?? true,
              autoEmailInvoices:
                data.terms.paymentConfig?.autoEmailInvoices ?? true,
              updateLeaseStatus: true,
              notifyTenant: true,
              createRecurringPayments: true,
            });

          if (syncResult.success) {
            toast.success(
              `Lease created successfully! ${syncResult.paymentsCreated} payments created, ${syncResult.invoicesGenerated} invoices generated.`
            );
          } else {
            toast.warning(
              `Lease created but some payment setup issues occurred: ${syncResult.errors.join(
                ", "
              )}`
            );
          }
        } catch (paymentError) {
          console.error("Payment setup error:", paymentError);
          toast.warning("Lease created but payment system setup failed");
        }
      }

      // If there are files to upload, upload them after lease creation/update
      if (uploadedFiles.length > 0) {
        try {
          const leaseService = (await import("@/lib/services/lease.service"))
            .leaseService;

          if (leaseId) {
            await leaseService.uploadDocuments(leaseId, uploadedFiles, {
              type: "lease",
              category: "lease",
              description: "Lease documents",
            });
            setUploadedFiles([]);
            toast.success("Documents uploaded successfully!");
          } else {
            toast.error("Could not upload documents - lease ID not found");
          }
        } catch (uploadError) {
          toast.error("Lease saved but document upload failed");
        }
      }
    } catch (error) {
      // Error handling is done in the calling component
    } finally {
      setIsUploading(false);
    }
  };

  const handleFileUpload = (files: File[]) => {
    setUploadedFiles((prev) => [...prev, ...files]);
  };

  const handleFileRemove = (index: number) => {
    setUploadedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const removeDocument = (url: string) => {
    const currentDocuments = form.getValues("documents") || [];
    form.setValue(
      "documents",
      currentDocuments.filter((doc) => doc !== url)
    );
  };

  const addCustomUtility = () => {
    if (customUtility.trim()) {
      const currentUtilities = form.getValues("terms.utilities") ?? [];
      if (!currentUtilities.includes(customUtility.trim())) {
        form.setValue("terms.utilities", [
          ...currentUtilities,
          customUtility.trim(),
        ]);
      }
      setCustomUtility("");
    }
  };

  const removeUtility = (utility: string) => {
    const currentUtilities = form.getValues("terms.utilities") ?? [];
    form.setValue(
      "terms.utilities",
      currentUtilities.filter((u) => u !== utility)
    );
  };

  const addCustomRestriction = () => {
    if (customRestriction.trim()) {
      const currentRestrictions = form.getValues("terms.restrictions") ?? [];
      if (!currentRestrictions.includes(customRestriction.trim())) {
        form.setValue("terms.restrictions", [
          ...currentRestrictions,
          customRestriction.trim(),
        ]);
      }
      setCustomRestriction("");
    }
  };

  const removeRestriction = (restriction: string) => {
    const currentRestrictions = form.getValues("terms.restrictions") ?? [];
    form.setValue(
      "terms.restrictions",
      currentRestrictions.filter((r) => r !== restriction)
    );
  };

  const toggleUtility = (utility: string) => {
    const currentUtilities = form.getValues("terms.utilities") ?? [];
    if (currentUtilities.includes(utility)) {
      removeUtility(utility);
    } else {
      form.setValue("terms.utilities", [...currentUtilities, utility]);
    }
  };

  const toggleRestriction = (restriction: string) => {
    const currentRestrictions = form.getValues("terms.restrictions") ?? [];
    if (currentRestrictions.includes(restriction)) {
      removeRestriction(restriction);
    } else {
      form.setValue("terms.restrictions", [
        ...currentRestrictions,
        restriction,
      ]);
    }
  };

  if (loadingData) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading form data...</p>
        </div>
      </div>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
        {/* Basic Information */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Basic Information
            </CardTitle>
            <CardDescription>
              Select the property and tenant for this lease
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="propertyId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Property</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a property" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {properties.map((property) => (
                          <SelectItem key={property._id} value={property._id}>
                            <div className="flex items-center gap-2">
                              <Home className="h-4 w-4" />
                              <span>{property.name}</span>
                              <span className="text-muted-foreground">
                                - {property.address.street}
                              </span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="unitId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Unit</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                      disabled={!selectedPropertyId || loadingUnits}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue
                            placeholder={
                              !selectedPropertyId
                                ? "Select a property first"
                                : loadingUnits
                                ? "Loading units..."
                                : "Select a unit"
                            }
                          />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {availableUnits.length > 0 ? (
                          availableUnits.map((unit) => (
                            <SelectItem key={unit._id} value={unit._id}>
                              <div className="flex flex-col gap-1 py-1">
                                <div className="flex items-center gap-2">
                                  <Building className="h-4 w-4" />
                                  <span className="font-medium">
                                    Unit {unit.unitNumber}
                                  </span>
                                  <span className="text-muted-foreground">
                                    ({unit.unitType})
                                  </span>
                                  {unit.floor && (
                                    <span className="text-muted-foreground">
                                      Floor {unit.floor}
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                                  <span>
                                    {unit.bedrooms}BR/{unit.bathrooms}BA
                                  </span>
                                  <span>{unit.squareFootage} sq ft</span>
                                  <span className="font-medium text-green-600">
                                    ${unit.rentAmount}/mo
                                  </span>
                                </div>
                                {(unit.balcony ||
                                  unit.patio ||
                                  unit.garden ||
                                  unit.parking?.included) && (
                                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                    {unit.balcony && <span>Balcony</span>}
                                    {unit.patio && <span>Patio</span>}
                                    {unit.garden && <span>Garden</span>}
                                    {unit.parking?.included && (
                                      <span>Parking</span>
                                    )}
                                  </div>
                                )}
                              </div>
                            </SelectItem>
                          ))
                        ) : (
                          <SelectItem value="no-units" disabled>
                            No available units in this property
                          </SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="tenantId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tenant</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a tenant" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {Array.isArray(tenants) && tenants.length > 0 ? (
                          tenants.map((tenant) => (
                            <SelectItem key={tenant._id} value={tenant._id}>
                              <div className="flex items-center gap-2">
                                <User className="h-4 w-4" />
                                <span>
                                  {tenant.firstName} {tenant.lastName}
                                </span>
                                <span className="text-muted-foreground">
                                  - {tenant.email}
                                </span>
                              </div>
                            </SelectItem>
                          ))
                        ) : (
                          <SelectItem value="no-tenants" disabled>
                            No tenants available
                          </SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Selected Unit Information */}
            {selectedUnit && (
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <h4 className="font-medium text-blue-900 mb-2">
                  Selected Unit Details
                </h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <span className="text-blue-600 font-medium">Unit:</span>
                    <p className="text-blue-800">
                      {selectedUnit.unitNumber} ({selectedUnit.unitType})
                    </p>
                  </div>
                  <div>
                    <span className="text-blue-600 font-medium">Size:</span>
                    <p className="text-blue-800">
                      {selectedUnit.bedrooms}BR/{selectedUnit.bathrooms}BA
                    </p>
                  </div>
                  <div>
                    <span className="text-blue-600 font-medium">Area:</span>
                    <p className="text-blue-800">
                      {selectedUnit.squareFootage} sq ft
                    </p>
                  </div>
                  <div>
                    <span className="text-blue-600 font-medium">Rent:</span>
                    <p className="text-blue-800 font-medium">
                      ${selectedUnit.rentAmount}/month
                    </p>
                  </div>
                  {(selectedUnit.balcony ||
                    selectedUnit.patio ||
                    selectedUnit.garden ||
                    selectedUnit.parking?.included) && (
                    <div className="col-span-2 md:col-span-4">
                      <span className="text-blue-600 font-medium">
                        Features:
                      </span>
                      <div className="flex flex-wrap gap-2 mt-1">
                        {selectedUnit.balcony && (
                          <Badge variant="secondary" className="text-xs">
                            Balcony
                          </Badge>
                        )}
                        {selectedUnit.patio && (
                          <Badge variant="secondary" className="text-xs">
                            Patio
                          </Badge>
                        )}
                        {selectedUnit.garden && (
                          <Badge variant="secondary" className="text-xs">
                            Garden
                          </Badge>
                        )}
                        {selectedUnit.parking?.included && (
                          <Badge variant="secondary" className="text-xs">
                            Parking ({selectedUnit.parking.spaces || 1} space
                            {selectedUnit.parking.spaces !== 1 ? "s" : ""})
                          </Badge>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <FormField
                control={form.control}
                name="startDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Start Date</FormLabel>
                    <FormControl>
                      <FormDatePicker
                        value={field.value ? new Date(field.value) : undefined}
                        onChange={(date) => {
                          if (date) {
                            // Format date as YYYY-MM-DD without timezone conversion
                            const year = date.getFullYear();
                            const month = String(date.getMonth() + 1).padStart(2, '0');
                            const day = String(date.getDate()).padStart(2, '0');
                            field.onChange(`${year}-${month}-${day}`);
                          } else {
                            field.onChange("");
                          }
                        }}
                        placeholder="Select lease start date"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="endDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>End Date</FormLabel>
                    <FormControl>
                      <FormDatePicker
                        value={field.value ? new Date(field.value) : undefined}
                        onChange={(date) => {
                          if (date) {
                            // Format date as YYYY-MM-DD without timezone conversion
                            const year = date.getFullYear();
                            const month = String(date.getMonth() + 1).padStart(2, '0');
                            const day = String(date.getDate()).padStart(2, '0');
                            field.onChange(`${year}-${month}-${day}`);
                          } else {
                            field.onChange("");
                          }
                        }}
                        placeholder="Select lease end date"
                        disabled={(date) => {
                          const startDate = form.watch("startDate");
                          return startDate
                            ? date <= new Date(startDate)
                            : date < new Date();
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select status" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="draft">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-gray-400"></div>
                            Draft
                          </div>
                        </SelectItem>
                        <SelectItem value="pending">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-yellow-400"></div>
                            Pending Signature
                          </div>
                        </SelectItem>
                        <SelectItem value="active">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-green-400"></div>
                            Active
                          </div>
                        </SelectItem>
                        <SelectItem value="expired">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-red-400"></div>
                            Expired
                          </div>
                        </SelectItem>
                        <SelectItem value="terminated">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-red-600"></div>
                            Terminated
                          </div>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </CardContent>
        </Card>

        {/* Financial Terms */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5" />
              Financial Terms
            </CardTitle>
            <CardDescription>
              Set the rent amount and other financial terms
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="terms.rentAmount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Monthly Rent</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        {...field}
                        onChange={(e) =>
                          field.onChange(parseFloat(e.target.value) || 0)
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="terms.securityDeposit"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Security Deposit</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        {...field}
                        onChange={(e) =>
                          field.onChange(parseFloat(e.target.value) || 0)
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="terms.lateFee"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Late Fee</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        {...field}
                        onChange={(e) =>
                          field.onChange(parseFloat(e.target.value) || 0)
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="terms.petDeposit"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Pet Deposit (Optional)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        {...field}
                        onChange={(e) =>
                          field.onChange(parseFloat(e.target.value) || 0)
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </CardContent>
        </Card>

        {/* Payment Configuration */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5" />
              Payment Configuration
            </CardTitle>
            <CardDescription>
              Configure payment schedules, late fees, and payment methods
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Payment Schedule Settings */}
            <div className="space-y-4">
              <h4 className="text-sm font-medium">Payment Schedule</h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <FormField
                  control={form.control}
                  name="terms.paymentConfig.rentDueDay"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Rent Due Day</FormLabel>
                      <Select
                        onValueChange={(value) =>
                          field.onChange(parseInt(value))
                        }
                        defaultValue={field.value?.toString()}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select day" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {Array.from({ length: 31 }, (_, i) => i + 1).map(
                            (day) => (
                              <SelectItem key={day} value={day.toString()}>
                                {day}
                              </SelectItem>
                            )
                          )}
                        </SelectContent>
                      </Select>
                      <FormDescription>
                        Day of the month when rent is due
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="terms.paymentConfig.autoCreatePayments"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                      <div className="space-y-1 leading-none">
                        <FormLabel>Auto-create Payments</FormLabel>
                        <FormDescription>
                          Automatically generate recurring rent payments
                        </FormDescription>
                      </div>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="terms.paymentConfig.autoGenerateInvoices"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                      <div className="space-y-1 leading-none">
                        <FormLabel>Auto-Generate Invoices</FormLabel>
                        <FormDescription>
                          Automatically generate invoices when payments are
                          created
                        </FormDescription>
                      </div>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="terms.paymentConfig.autoEmailInvoices"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                      <div className="space-y-1 leading-none">
                        <FormLabel>Auto-Email Invoices</FormLabel>
                        <FormDescription>
                          Automatically email invoices to tenants when generated
                        </FormDescription>
                      </div>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="terms.paymentConfig.prorationEnabled"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                      <div className="space-y-1 leading-none">
                        <FormLabel>Enable Proration</FormLabel>
                        <FormDescription>
                          Prorate first and last month rent
                        </FormDescription>
                      </div>
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="terms.paymentConfig.advancePaymentMonths"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Advance Payment Months</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min="0"
                        max="12"
                        placeholder="0"
                        {...field}
                        onChange={(e) =>
                          field.onChange(parseInt(e.target.value) || 0)
                        }
                      />
                    </FormControl>
                    <FormDescription>
                      Number of months to collect in advance (0 for none)
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <Separator />

            {/* Late Fee Configuration */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-medium">Late Fee Configuration</h4>
                <FormField
                  control={form.control}
                  name="terms.paymentConfig.lateFeeConfig.enabled"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <span className="text-sm text-muted-foreground">
                  Enable late fees
                </span>
              </div>

              {form.watch("terms.paymentConfig.lateFeeConfig.enabled") && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 border rounded-lg bg-gray-50">
                  <FormField
                    control={form.control}
                    name="terms.paymentConfig.lateFeeConfig.gracePeriodDays"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Grace Period (Days)</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min="0"
                            max="30"
                            {...field}
                            onChange={(e) =>
                              field.onChange(parseInt(e.target.value) || 0)
                            }
                          />
                        </FormControl>
                        <FormDescription>
                          Days after due date before late fee applies
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="terms.paymentConfig.lateFeeConfig.feeType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Fee Type</FormLabel>
                        <Select
                          onValueChange={field.onChange}
                          defaultValue={field.value}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select fee type" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="fixed">Fixed Amount</SelectItem>
                            <SelectItem value="percentage">
                              Percentage
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="terms.paymentConfig.lateFeeConfig.feeAmount"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          {form.watch(
                            "terms.paymentConfig.lateFeeConfig.feeType"
                          ) === "percentage"
                            ? "Fee Percentage"
                            : "Fee Amount"}
                        </FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="0.00"
                            {...field}
                            onChange={(e) =>
                              field.onChange(parseFloat(e.target.value) || 0)
                            }
                          />
                        </FormControl>
                        <FormDescription>
                          {form.watch(
                            "terms.paymentConfig.lateFeeConfig.feeType"
                          ) === "percentage"
                            ? "Percentage of rent amount"
                            : "Fixed dollar amount"}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {form.watch("terms.paymentConfig.lateFeeConfig.feeType") ===
                    "percentage" && (
                    <FormField
                      control={form.control}
                      name="terms.paymentConfig.lateFeeConfig.maxFeeAmount"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Maximum Fee Amount</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              placeholder="0.00"
                              {...field}
                              onChange={(e) =>
                                field.onChange(parseFloat(e.target.value) || 0)
                              }
                            />
                          </FormControl>
                          <FormDescription>
                            Maximum late fee amount (optional)
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}

                  <FormField
                    control={form.control}
                    name="terms.paymentConfig.lateFeeConfig.compoundDaily"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel>Compound Daily</FormLabel>
                          <FormDescription>
                            Apply late fee for each day overdue
                          </FormDescription>
                        </div>
                      </FormItem>
                    )}
                  />
                </div>
              )}
            </div>

            <Separator />

            {/* Payment Methods */}
            <div className="space-y-4">
              <h4 className="text-sm font-medium">Accepted Payment Methods</h4>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {Object.values(PaymentMethod).map((method) => (
                  <div key={method} className="flex items-center space-x-2">
                    <Checkbox
                      id={method}
                      checked={(
                        form.watch(
                          "terms.paymentConfig.acceptedPaymentMethods"
                        ) ?? []
                      ).includes(method)}
                      onCheckedChange={(checked) => {
                        const currentMethods =
                          form.getValues(
                            "terms.paymentConfig.acceptedPaymentMethods"
                          ) ?? [];
                        if (checked) {
                          form.setValue(
                            "terms.paymentConfig.acceptedPaymentMethods",
                            [...currentMethods, method]
                          );
                        } else {
                          form.setValue(
                            "terms.paymentConfig.acceptedPaymentMethods",
                            currentMethods.filter((m) => m !== method)
                          );
                        }
                      }}
                    />
                    <label
                      htmlFor={method}
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 capitalize"
                    >
                      {method.replace(/_/g, " ")}
                    </label>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Utilities */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              Utilities Included
            </CardTitle>
            <CardDescription>
              Select which utilities are included in the rent
              {selectedUnit?.utilities && (
                <span className="block mt-1 text-blue-600 text-sm">
                  Unit has predefined utility settings - you can override them
                  below
                </span>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Unit Utilities Information */}
            {selectedUnit?.utilities && (
              <div className="p-3 bg-gray-50 border rounded-lg">
                <h4 className="text-sm font-medium text-gray-700 mb-2">
                  Unit Utility Configuration:
                </h4>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm">
                  {Object.entries(selectedUnit.utilities).map(
                    ([utility, status]) => (
                      <div key={utility} className="flex items-center gap-2">
                        <span className="capitalize">{utility}:</span>
                        <Badge
                          variant={
                            status === "included"
                              ? "default"
                              : status === "tenant"
                              ? "secondary"
                              : "outline"
                          }
                          className="text-xs"
                        >
                          {String(status)}
                        </Badge>
                      </div>
                    )
                  )}
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {UTILITY_OPTIONS.map((utility) => (
                <div key={utility} className="flex items-center space-x-2">
                  <Checkbox
                    id={utility}
                    checked={(form.watch("terms.utilities") ?? []).includes(utility)}
                    onCheckedChange={() => toggleUtility(utility)}
                  />
                  <label
                    htmlFor={utility}
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 capitalize"
                  >
                    {utility}
                  </label>
                </div>
              ))}
            </div>

            {/* Custom Utility */}
            <div className="flex gap-2">
              <Input
                placeholder="Add custom utility"
                value={customUtility}
                onChange={(e) => setCustomUtility(e.target.value)}
                onKeyPress={(e) =>
                  e.key === "Enter" && (e.preventDefault(), addCustomUtility())
                }
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addCustomUtility}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>

            {/* Selected Utilities */}
            {(form.watch("terms.utilities") ?? []).length > 0 && (
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Selected Utilities:
                </label>
                <div className="flex flex-wrap gap-2">
                  {(form.watch("terms.utilities") ?? []).map((utility) => (
                    <Badge
                      key={utility}
                      variant="secondary"
                      className="flex items-center gap-1"
                    >
                      {utility}
                      <X
                        className="h-3 w-3 cursor-pointer"
                        onClick={() => removeUtility(utility)}
                      />
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Restrictions */}
        <Card>
          <CardHeader>
            <CardTitle>Lease Restrictions</CardTitle>
            <CardDescription>
              Add any restrictions or rules for the lease
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {COMMON_RESTRICTIONS.map((restriction) => (
                <div key={restriction} className="flex items-center space-x-2">
                  <Checkbox
                    id={restriction}
                    checked={(form.watch("terms.restrictions") ?? []).includes(restriction)}
                    onCheckedChange={() => toggleRestriction(restriction)}
                  />
                  <label
                    htmlFor={restriction}
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                  >
                    {restriction}
                  </label>
                </div>
              ))}
            </div>

            {/* Custom Restriction */}
            <div className="flex gap-2">
              <Input
                placeholder="Add custom restriction"
                value={customRestriction}
                onChange={(e) => setCustomRestriction(e.target.value)}
                onKeyPress={(e) =>
                  e.key === "Enter" &&
                  (e.preventDefault(), addCustomRestriction())
                }
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addCustomRestriction}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>

            {/* Selected Restrictions */}
            {(form.watch("terms.restrictions") ?? []).length > 0 && (
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Selected Restrictions:
                </label>
                <div className="flex flex-wrap gap-2">
                  {(form.watch("terms.restrictions") ?? []).map((restriction) => (
                    <Badge
                      key={restriction}
                      variant="secondary"
                      className="flex items-center gap-1"
                    >
                      {restriction}
                      <X
                        className="h-3 w-3 cursor-pointer"
                        onClick={() => removeRestriction(restriction)}
                      />
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Renewal Options */}
        <Card>
          <CardHeader>
            <CardTitle>Renewal Options</CardTitle>
            <CardDescription>Configure lease renewal options</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField
              control={form.control}
              name="renewalOptions.available"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel>Allow lease renewal</FormLabel>
                    <FormDescription>
                      Enable automatic renewal options for this lease
                    </FormDescription>
                  </div>
                </FormItem>
              )}
            />

            {form.watch("renewalOptions.available") && (
              <FormField
                control={form.control}
                name="renewalOptions.terms"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Renewal Terms</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Describe the renewal terms and conditions..."
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      Specify any special terms or conditions for lease renewal
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
          </CardContent>
        </Card>

        {/* Documents */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Documents
            </CardTitle>
            <CardDescription>
              Upload lease documents (PDF, images, etc.)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Existing Documents */}
            {form.watch("documents") && form.watch("documents")!.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium">Existing Documents</h4>
                <div className="grid grid-cols-1 gap-2">
                  {form.watch("documents")!.map((url, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between p-3 border rounded-lg"
                    >
                      <div className="flex items-center gap-2">
                        <File className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm truncate">
                          {url.split("/").pop() || url}
                        </span>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeDocument(url)}
                        className="text-red-600 hover:text-red-700"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* File Upload */}
            <div className="space-y-2">
              <h4 className="text-sm font-medium">Upload New Documents</h4>
              <FileUpload
                onFilesSelected={handleFileUpload}
                onFileRemove={handleFileRemove}
                acceptedFileTypes={[
                  ".pdf",
                  ".jpg",
                  ".jpeg",
                  ".png",
                  ".gif",
                  ".webp",
                  ".doc",
                  ".docx",
                ]}
                maxFileSize={10}
                maxFiles={10}
              />
              {uploadedFiles.length > 0 && (
                <div className="mt-2">
                  <p className="text-sm text-muted-foreground">
                    {uploadedFiles.length} file(s) ready to upload
                  </p>
                </div>
              )}
            </div>

            {uploadedFiles.length > 0 && (
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-blue-600 mt-0.5" />
                  <div className="text-sm text-blue-800">
                    <p className="font-medium">
                      Files will be uploaded when you save the lease
                    </p>
                    <p className="text-blue-600">
                      Make sure to save the form to upload the selected
                      documents.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Notes */}
        <Card>
          <CardHeader>
            <CardTitle>Additional Notes</CardTitle>
            <CardDescription>
              Add any additional notes or comments about this lease
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <Textarea
                      placeholder="Add any additional notes..."
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Unit-specific notes */}
            {selectedUnit?.notes && (
              <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                <h4 className="text-sm font-medium text-yellow-800 mb-1">
                  Unit Notes:
                </h4>
                <p className="text-sm text-yellow-700">{selectedUnit.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Form Actions */}
        <div className="flex items-center justify-end gap-4">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={isLoading || isUploading}>
            {isLoading || isUploading
              ? isUploading
                ? "Uploading documents..."
                : "Saving..."
              : mode === "create"
              ? "Create Lease"
              : "Update Lease"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
