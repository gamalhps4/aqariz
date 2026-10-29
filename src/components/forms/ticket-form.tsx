"use client";

import { z } from "zod";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { useState, useEffect, useMemo } from "react";
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
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  ImageUpload,
  UploadedImage,
} from "@/components/ui/image-upload";
import {
  Ticket,
  Building2,
  Paperclip,
  Loader2,
  User,
  Shield,
  Info,
} from "lucide-react";
import { TicketPriority, TicketCategory } from "@/types";
import { Badge } from "@/components/ui/badge";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { roleDisplayName } from "@/lib/role-display";

const createTicketFormSchema = (isTenantView: boolean) =>
  z.object({
    title: z.string().min(1, "Title is required").max(200, "Title too long"),
    description: z
      .string()
      .min(10, "Description must be at least 10 characters")
      .max(3000, "Description too long"),
    category: z.nativeEnum(TicketCategory),
    priority: z.nativeEnum(TicketPriority),
    propertyId: isTenantView
      ? z.string().optional()
      : z.string().min(1, "Property is required"),
    unitId: z.string().optional(),
    tenantId: isTenantView
      ? z.string().optional()
      : z.string().min(1, "No tenant found for selected property/unit"),
    attachments: z.array(z.string()).optional(),
  });

type TicketFormData = z.infer<ReturnType<typeof createTicketFormSchema>>;

interface Property {
  id: string;
  name: string;
  address: string;
  isMultiUnit?: boolean;
  units?: Array<{
    _id: string;
    unitNumber: string;
    unitType: string;
    status: string;
  }>;
}

interface LeaseInfo {
  propertyId: string;
  unitId?: string;
  tenantId: string;
  tenantName: string;
  tenantEmail: string;
}

interface CreatedByInfo {
  userId: string;
  role: string;
  name: string;
}

interface TicketFormProps {
  onSubmit: (data: TicketFormData) => Promise<void>;
  isLoading?: boolean;
  initialData?: Partial<TicketFormData>;
  isTenantView?: boolean;
  submitLabel?: string;
  submitDisabled?: boolean;
  properties?: Property[];
  leases?: LeaseInfo[];
  createdBy?: CreatedByInfo;
}

const categoryValues = [
  { value: TicketCategory.BILLING, key: "tickets.category.billing" },
  { value: TicketCategory.LEASE, key: "tickets.category.lease" },
  { value: TicketCategory.MAINTENANCE, key: "tickets.category.maintenance" },
  { value: TicketCategory.NOISE_COMPLAINT, key: "tickets.category.noiseComplaint" },
  { value: TicketCategory.SAFETY, key: "tickets.category.safety" },
  { value: TicketCategory.GENERAL, key: "tickets.category.general" },
  { value: TicketCategory.SUGGESTION, key: "tickets.category.suggestion" },
  { value: TicketCategory.OTHER, key: "tickets.category.other" },
];

const priorityValues = [
  { value: TicketPriority.LOW, key: "tickets.priority.low", descKey: "tickets.form.priorityLowDesc", color: "text-green-600" },
  { value: TicketPriority.MEDIUM, key: "tickets.priority.medium", descKey: "tickets.form.priorityMediumDesc", color: "text-yellow-600" },
  { value: TicketPriority.HIGH, key: "tickets.priority.high", descKey: "tickets.form.priorityHighDesc", color: "text-orange-600" },
  { value: TicketPriority.URGENT, key: "tickets.priority.urgent", descKey: "tickets.form.priorityUrgentDesc", color: "text-red-600" },
];

export function TicketForm({
  onSubmit,
  isLoading = false,
  initialData,
  isTenantView = false,
  submitLabel,
  submitDisabled = false,
  properties = [],
  leases = [],
  createdBy,
}: TicketFormProps) {
  const { t, language } = useLocalizationContext();
  const [uploadedAttachments, setUploadedAttachments] = useState<string[]>(
    initialData?.attachments || []
  );

  const form = useForm<TicketFormData>({
    resolver: zodResolver(createTicketFormSchema(isTenantView)),
    defaultValues: {
      title: initialData?.title || "",
      description: initialData?.description || "",
      category: initialData?.category || undefined,
      priority: initialData?.priority || TicketPriority.MEDIUM,
      propertyId: initialData?.propertyId || "",
      unitId: initialData?.unitId || "",
      tenantId: initialData?.tenantId || "",
      attachments: initialData?.attachments || [],
    },
  });

  const watchedPropertyId = form.watch("propertyId");
  const watchedUnitId = form.watch("unitId");
  const watchedPriority = form.watch("priority");

  const selectedProperty = properties.find((p) => p.id === watchedPropertyId);
  const availableUnits = selectedProperty?.units || [];

  const selectedPriority = priorityValues.find((p) => p.value === watchedPriority);

  // Auto-detect tenant from lease based on selected property + unit
  const detectedTenant = useMemo(() => {
    if (isTenantView || !watchedPropertyId) return null;

    const matching = leases.filter((l) => {
      if (l.propertyId !== watchedPropertyId) return false;
      // If unit is selected, match by unit too
      if (watchedUnitId && l.unitId) return l.unitId === watchedUnitId;
      // If no unit selected but property has units, don't match yet
      if (!watchedUnitId && availableUnits.length > 0) return false;
      return true;
    });

    return matching.length === 1 ? matching[0] : matching.length > 0 ? matching[0] : null;
  }, [watchedPropertyId, watchedUnitId, leases, isTenantView, availableUnits.length]);

  // Auto-set tenantId when tenant is detected from lease
  useEffect(() => {
    if (!isTenantView) {
      if (detectedTenant) {
        form.setValue("tenantId", detectedTenant.tenantId, { shouldValidate: true });
      } else if (watchedPropertyId) {
        form.setValue("tenantId", "", { shouldValidate: true });
      }
    }
  }, [detectedTenant, isTenantView, form, watchedPropertyId]);

  const handleFormSubmit = async (data: TicketFormData) => {
    try {
      await onSubmit({
        ...data,
        attachments: uploadedAttachments,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : t("tickets.new.createError");
      toast.error(errorMessage);
    }
  };

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(handleFormSubmit)}
        className="space-y-6"
      >
        {/* Created By Info */}
        {createdBy && (
          <Card className="border-0 shadow-lg bg-white/70 dark:bg-gray-900/70 backdrop-blur-sm">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-blue-500" />
                {t("tickets.form.createdBy")}
              </CardTitle>
              <CardDescription>
                {t("tickets.form.createdByDesc")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{createdBy.name}</span>
                  <Badge variant="secondary" className="capitalize">
                    {roleDisplayName(createdBy.role, { language, t })}
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Ticket Details */}
        <Card className="border-0 shadow-lg bg-white/70 dark:bg-gray-900/70 backdrop-blur-sm">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2">
              <Ticket className="h-5 w-5 text-blue-500" />
              {t("tickets.form.details")}
            </CardTitle>
            <CardDescription>
              {t("tickets.form.detailsDesc")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Title */}
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("tickets.form.subject")} *</FormLabel>
                  <FormControl>
                    <Input
                      placeholder={t("tickets.form.subjectPlaceholder")}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Description */}
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("tickets.form.description")} *</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder={t("tickets.form.descriptionPlaceholder")}
                      rows={5}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    {t("tickets.form.characters").replace("{count}", String(field.value?.length || 0))}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Category & Priority */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("tickets.form.category")} *</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={t("tickets.form.selectCategory")} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {categoryValues.map((cat) => (
                          <SelectItem key={cat.value} value={cat.value}>
                            {t(cat.key)}
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
                    <FormLabel>{t("tickets.form.priority")} *</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={t("tickets.form.selectPriority")} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {priorityValues.map((p) => (
                          <SelectItem key={p.value} value={p.value}>
                            <span className={p.color}>{t(p.key)}</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {selectedPriority && (
                      <FormDescription className={selectedPriority.color}>
                        {t(selectedPriority.descKey)}
                      </FormDescription>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </CardContent>
        </Card>

        {/* Property Selection */}
        {properties.length > 0 && (
          <Card className="border-0 shadow-lg bg-white/70 dark:bg-gray-900/70 backdrop-blur-sm">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5 text-blue-500" />
                {t("tickets.form.propertyInfo")}
              </CardTitle>
              <CardDescription>
                {isTenantView
                  ? t("tickets.form.propertyInfoDescTenant")
                  : t("tickets.form.propertyInfoDescAdmin") + " *"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="propertyId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {t("tickets.form.property")} {!isTenantView && "*"}
                      </FormLabel>
                      <Select
                        onValueChange={(value) => {
                          field.onChange(value);
                          form.setValue("unitId", "");
                          form.setValue("tenantId", "");
                        }}
                        defaultValue={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder={t("tickets.form.selectProperty")} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {properties.map((property) => (
                            <SelectItem key={property.id} value={property.id}>
                              {property.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {availableUnits.length > 0 && (
                  <FormField
                    control={form.control}
                    name="unitId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("tickets.form.unit")} {!isTenantView && "*"}</FormLabel>
                        <Select
                          onValueChange={field.onChange}
                          defaultValue={field.value}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder={t("tickets.form.selectUnit")} />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {availableUnits.map((unit) => (
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
              </div>

              {/* Auto-detected tenant display (admin/manager only) */}
              {!isTenantView && watchedPropertyId && (
                <div className="mt-4">
                  {detectedTenant ? (
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800">
                      <User className="h-5 w-5 text-green-600" />
                      <div>
                        <p className="text-sm font-medium text-green-800 dark:text-green-300">
                          {t("tickets.form.tenant").replace("{name}", detectedTenant.tenantName)}
                        </p>
                        <p className="text-xs text-green-600 dark:text-green-400">
                          {detectedTenant.tenantEmail}
                        </p>
                      </div>
                      <Badge variant="outline" className="ms-auto text-green-700 border-green-300">
                        {t("tickets.form.autoDetected")}
                      </Badge>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
                      <Info className="h-5 w-5 text-amber-600" />
                      <p className="text-sm text-amber-700 dark:text-amber-300">
                        {availableUnits.length > 0 && !watchedUnitId
                          ? t("tickets.form.selectUnitPrompt")
                          : t("tickets.form.noLeaseForProperty")}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Hidden tenantId field for validation */}
              <FormField
                control={form.control}
                name="tenantId"
                render={() => (
                  <FormItem className="hidden">
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>
        )}

        {/* Attachments */}
        <Card className="border-0 shadow-lg bg-white/70 dark:bg-gray-900/70 backdrop-blur-sm">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2">
              <Paperclip className="h-5 w-5 text-blue-500" />
              {t("tickets.form.attachments")}
            </CardTitle>
            <CardDescription>
              {t("tickets.form.attachmentsDesc")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ImageUpload
              onImagesUploaded={(newImages: UploadedImage[]) => {
                const updated = [
                  ...uploadedAttachments,
                  ...newImages.map((img) => img.url),
                ];
                setUploadedAttachments(updated);
                form.setValue("attachments", updated);
              }}
              maxFiles={10}
            />
          </CardContent>
        </Card>

        {/* Submit */}
        <div className="flex justify-end gap-3">
          <Button
            type="submit"
            disabled={isLoading || submitDisabled}
            className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white min-w-[160px]"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 me-2 animate-spin" />
                {t("tickets.new.submitting")}
              </>
            ) : (
              submitLabel ?? t("tickets.new.submitLabel", { defaultValue: "Submit Ticket" })
            )}
          </Button>
        </div>
      </form>
    </Form>
  );
}
