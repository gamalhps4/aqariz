"use client";

import { z } from "zod";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { useRouter } from "next/navigation";
import React, { useState, useEffect } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Settings, AlertTriangle } from "lucide-react";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

const MAINTENANCE_CATEGORIES = [
  "Plumbing",
  "Electrical",
  "HVAC",
  "Appliances",
  "Flooring",
  "Painting",
  "Roofing",
  "Windows",
  "Doors",
  "Landscaping",
  "Pest Control",
  "Cleaning",
  "Security",
  "General Repair",
  "Emergency",
  "Other",
] as const;

// Validation schema creator function that accepts translation function
const createTenantMaintenanceSchema = (t: (key: string) => string) =>
  z.object({
    title: z
      .string()
      .min(1, t("maintenance.tenant.form.validation.titleRequired"))
      .max(100, t("maintenance.tenant.form.validation.titleTooLong")),
    description: z
      .string()
      .min(10, t("maintenance.tenant.form.validation.descriptionMin")),
    category: z.enum(MAINTENANCE_CATEGORIES),
    priority: z.enum(["low", "medium", "high", "emergency"]),
    leaseId: z
      .string()
      .min(1, t("maintenance.tenant.form.validation.leaseRequired")),
    unitId: z.string().optional(),
    contactPhone: z
      .string()
      .trim()
      .optional()
      .refine(
        (value) => !value || value.length >= 7,
        t("maintenance.tenant.form.validation.contactPhoneMin")
      )
      .refine(
        (value) => !value || value.length <= 20,
        t("maintenance.tenant.form.validation.contactPhoneMax")
      ),
  });

type TenantMaintenanceFormData = z.infer<
  ReturnType<typeof createTenantMaintenanceSchema>
>;

interface Lease {
  _id: string;
  propertyId?: {
    _id: string;
    name: string;
    address: string;
    units?: Array<{
      _id: string;
      unitNumber: string;
      unitType: string;
    }>;
  } | null;
  unitId?: string;
  startDate: string;
  endDate: string;
  status: string;
}

interface TenantMaintenanceRequestFormProps {
  onSuccess?: () => void;
  onCancel?: () => void;
  isLoading?: boolean;
}

export default function TenantMaintenanceRequestForm({
  onSuccess,
  onCancel,
  isLoading = false,
}: TenantMaintenanceRequestFormProps) {
  const router = useRouter();
  const { t } = useLocalizationContext();
  const [leases, setLeases] = useState<Lease[]>([]);
  const [loadingLeases, setLoadingLeases] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const effectiveSubmitting = submitting || isLoading;

  const form = useForm<TenantMaintenanceFormData>({
    resolver: zodResolver(createTenantMaintenanceSchema(t)),
    defaultValues: {
      title: "",
      description: "",
      category: "Other",
      priority: "medium",
      leaseId: "",
      unitId: "",
      contactPhone: "",
    },
  });

  const watchedLeaseId = form.watch("leaseId");
  const selectedLease = leases.find((lease) => lease._id === watchedLeaseId);

  // Format address helper function
  const formatAddress = (address: any) => {
    if (!address) return t("maintenance.tenant.form.lease.addressNotAvailable");
    if (typeof address === "string") return address;
    if (typeof address === "object") {
      const { street, city, state, zipCode } = address;
      return `${street || ""}, ${city || ""}, ${state || ""} ${zipCode || ""}`
        .replace(/,\s*,/g, ",")
        .replace(/^\s*,\s*|\s*,\s*$/g, "");
    }
    return "Address not available";
  };

  // Fetch tenant's leases
  useEffect(() => {
    fetchTenantLeases();
  }, []);

  const fetchTenantLeases = async () => {
    try {
      setLoadingLeases(true);
      const response = await fetch("/api/tenant/dashboard");
      const data = await response.json();

      if (data.success) {
        setLeases(data.data.allLeases || []);

        // Auto-select the current lease if there's only one
        if (data.data.allLeases?.length === 1) {
          form.setValue("leaseId", data.data.allLeases[0]._id);
        }
      } else {
        toast.error(t("maintenance.tenant.form.toasts.fetchError"));
      }
    } catch (error) {
      console.error("Error fetching leases:", error);
      toast.error(t("maintenance.tenant.form.toasts.fetchError"));
    } finally {
      setLoadingLeases(false);
    }
  };

  const handleSubmit = async (data: TenantMaintenanceFormData) => {
    toast.info(t("maintenance.tenant.form.toasts.processing"));

    try {
      setSubmitting(true);

      const selectedLease = leases.find((lease) => lease._id === data.leaseId);
      if (!selectedLease) {
        toast.error(t("maintenance.tenant.form.toasts.selectValidLease"));
        return;
      }

      const contactPhone = data.contactPhone?.trim() || undefined;

      const normalizeId = (value: unknown): string | undefined => {
        if (!value || value === "") return undefined;
        if (typeof value === "string") return value;
        if (typeof value === "object") {
          const objectValue = value as {
            _id?: unknown;
            toString?: () => string;
          };
          if (typeof objectValue._id === "string") {
            return objectValue._id;
          }
          if (
            objectValue._id &&
            typeof (objectValue._id as { toString?: () => string }).toString ===
              "function"
          ) {
            return (objectValue._id as { toString: () => string }).toString();
          }
        }
        return undefined;
      };

      const resolvedPropertyId = normalizeId(selectedLease.propertyId);
      const resolvedUnitId = normalizeId(data.unitId || selectedLease.unitId);

      const requestBody: Record<string, unknown> = {
        title: data.title,
        description: data.description,
        category: data.category,
        priority: data.priority,
        leaseId: data.leaseId,
        ...(resolvedPropertyId ? { propertyId: resolvedPropertyId } : {}),
        ...(resolvedUnitId ? { unitId: resolvedUnitId } : {}),
        ...(contactPhone ? { contactPhone } : {}),
      };

      const response = await fetch("/api/tenant/maintenance", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      await response.json();

      toast.success(t("maintenance.tenant.form.toasts.submitSuccess"));
      form.reset({
        title: "",
        description: "",
        category: data.category,
        priority: data.priority,
        leaseId: data.leaseId,
        unitId: "",
        contactPhone: "",
      });

      if (onSuccess) {
        onSuccess();
      } else {
        router.push("/dashboard/maintenance/my-requests");
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("maintenance.tenant.form.toasts.submitError")
      );
    } finally {
      setSubmitting(false);
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "emergency":
        return "destructive";
      case "high":
        return "destructive";
      case "medium":
        return "default";
      case "low":
        return "secondary";
      default:
        return "default";
    }
  };

  if (loadingLeases) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin" />
          <span className="ms-2">{t("maintenance.tenant.form.loading")}</span>
        </CardContent>
      </Card>
    );
  }

  if (leases.length === 0) {
    return (
      <Card>
        <CardContent className="text-center py-8">
          <AlertTriangle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">
            {t("maintenance.tenant.form.noLeases.title")}
          </h3>
          <p className="text-muted-foreground">
            {t("maintenance.tenant.form.noLeases.description")}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Settings className="h-5 w-5" />
          {t("maintenance.tenant.form.card.title")}
        </CardTitle>
        <CardDescription>
          {t("maintenance.tenant.form.card.description")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(handleSubmit)}
            className="space-y-6"
          >
            {/* Lease Selection */}
            <FormField
              control={form.control}
              name="leaseId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t("maintenance.tenant.form.lease.label")}
                  </FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue
                          placeholder={t(
                            "maintenance.tenant.form.lease.placeholder"
                          )}
                        />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {leases.map((lease) => (
                        <SelectItem key={lease._id} value={lease._id}>
                          <div className="flex flex-col">
                            <span className="font-medium">
                              {lease.propertyId?.name ||
                                t(
                                  "maintenance.tenant.form.lease.propertyNotAvailable"
                                )}
                            </span>
                            <span className="text-sm text-muted-foreground">
                              {formatAddress(lease.propertyId?.address)}
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

            {/* Unit Selection (if property has multiple units) */}
            {selectedLease?.propertyId?.units &&
              selectedLease.propertyId.units.length > 1 && (
                <FormField
                  control={form.control}
                  name="unitId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {t("maintenance.tenant.form.unit.label")}
                      </FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue
                              placeholder={t(
                                "maintenance.tenant.form.unit.placeholder"
                              )}
                            />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {selectedLease.propertyId?.units?.map((unit) => (
                            <SelectItem key={unit._id} value={unit._id}>
                              Unit {unit.unitNumber} ({unit.unitType})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

            {/* Title */}
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t("maintenance.tenant.form.title.label")}
                  </FormLabel>
                  <FormControl>
                    <Input
                      placeholder={t(
                        "maintenance.tenant.form.title.placeholder"
                      )}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Category and Priority */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t("maintenance.tenant.form.category.label")}
                    </FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {MAINTENANCE_CATEGORIES.map((category) => (
                          <SelectItem key={category} value={category}>
                            {t(
                              `maintenance.categories.${
                                category.charAt(0).toLowerCase() +
                                category.slice(1).replace(/\s+/g, "")
                              }`
                            )}
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
                name="priority"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t("maintenance.tenant.form.priority.label")}
                    </FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="low">
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary">
                              {t("maintenance.tenant.form.priority.low")}
                            </Badge>
                            <span>
                              {t("maintenance.tenant.form.priority.lowDesc")}
                            </span>
                          </div>
                        </SelectItem>
                        <SelectItem value="medium">
                          <div className="flex items-center gap-2">
                            <Badge variant="default">
                              {t("maintenance.tenant.form.priority.medium")}
                            </Badge>
                            <span>
                              {t("maintenance.tenant.form.priority.mediumDesc")}
                            </span>
                          </div>
                        </SelectItem>
                        <SelectItem value="high">
                          <div className="flex items-center gap-2">
                            <Badge variant="destructive">
                              {t("maintenance.tenant.form.priority.high")}
                            </Badge>
                            <span>
                              {t("maintenance.tenant.form.priority.highDesc")}
                            </span>
                          </div>
                        </SelectItem>
                        <SelectItem value="emergency">
                          <div className="flex items-center gap-2">
                            <Badge variant="destructive">
                              {t("maintenance.tenant.form.priority.emergency")}
                            </Badge>
                            <span>
                              {t(
                                "maintenance.tenant.form.priority.emergencyDesc"
                              )}
                            </span>
                          </div>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Description */}
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t("maintenance.tenant.form.description.label")}
                  </FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder={t(
                        "maintenance.tenant.form.description.placeholder"
                      )}
                      className="min-h-[100px]"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    {t("maintenance.tenant.form.description.description")}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Contact Phone */}
            <FormField
              control={form.control}
              name="contactPhone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t("maintenance.tenant.form.contactPhone.label")}
                  </FormLabel>
                  <FormControl>
                    <Input
                      placeholder={t(
                        "maintenance.tenant.form.contactPhone.placeholder"
                      )}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    {t("maintenance.tenant.form.contactPhone.description")}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Submit Buttons */}
            <div className="flex gap-4">
              <Button
                type="submit"
                disabled={
                  effectiveSubmitting || loadingLeases || !selectedLease
                }
                className="flex-1 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-medium py-2.5 px-4 rounded-lg transition-all duration-200 shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {effectiveSubmitting ? (
                  <>
                    <Loader2 className="me-2 h-4 w-4 animate-spin" />
                    {t("maintenance.tenant.form.buttons.submitting")}
                  </>
                ) : (
                  t("maintenance.tenant.form.buttons.submit")
                )}
              </Button>
              {onCancel && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={onCancel}
                  disabled={effectiveSubmitting || loadingLeases}
                >
                  {t("maintenance.tenant.form.buttons.cancel")}
                </Button>
              )}
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
