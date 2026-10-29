"use client";

import { z } from "zod";
import { useForm } from "react-hook-form";
import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { zodResolver } from "@hookform/resolvers/zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertTriangle,
  Zap,
  Phone,
  Clock,
  Upload,
  X,
  CheckCircle,
} from "lucide-react";
import { toast } from "sonner";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

// Emergency-specific validation schema
const emergencyRequestSchema = z.object({
  title: z.string().min(1, "Title is required").max(200, "Title too long"),
  description: z
    .string()
    .min(10, "Description must be at least 10 characters")
    .max(2000, "Description too long"),
  emergencyType: z.enum([
    "water_leak",
    "electrical_hazard",
    "gas_leak",
    "security_breach",
    "fire_hazard",
    "structural_damage",
    "hvac_failure",
    "other",
  ]),
  category: z.enum([
    "Emergency",
    "Plumbing",
    "Electrical",
    "HVAC",
    "Security",
    "Other",
  ]),
  propertyId: z.string().min(1, "Property is required"),
  tenantId: z.string().min(1, "Tenant is required"),
  contactPhone: z.string().optional(),
  immediateAction: z.string().optional(),
  safetyRisk: z.enum(["low", "medium", "high", "critical"]),
  images: z.array(z.string()).optional(),
});

type EmergencyRequestFormData = z.infer<typeof emergencyRequestSchema>;

interface Property {
  id: string;
  name: string;
  address: string;
}

interface Tenant {
  id: string;
  name: string;
  email: string;
  phone: string;
  propertyName?: string;
}

interface EmergencyRequestFormProps {
  onSubmit: (data: EmergencyRequestFormData) => Promise<void>;
  isLoading?: boolean;
  properties?: Property[];
  tenants?: Tenant[];
  initialData?: Partial<EmergencyRequestFormData>;
}

const emergencyTypes = [
  {
    value: "water_leak",
    key: "waterLeak",
    label: "Water Leak",
    icon: "💧",
    severity: "high",
  },
  {
    value: "electrical_hazard",
    key: "electricalHazard",
    label: "Electrical Hazard",
    icon: "⚡",
    severity: "critical",
  },
  {
    value: "gas_leak",
    key: "gasLeak",
    label: "Gas Leak",
    icon: "🔥",
    severity: "critical",
  },
  {
    value: "security_breach",
    key: "securityBreach",
    label: "Security Breach",
    icon: "🔒",
    severity: "high",
  },
  {
    value: "fire_hazard",
    key: "fireHazard",
    label: "Fire Hazard",
    icon: "🔥",
    severity: "critical",
  },
  {
    value: "structural_damage",
    key: "structuralDamage",
    label: "Structural Damage",
    icon: "🏗️",
    severity: "high",
  },
  {
    value: "hvac_failure",
    key: "hvacFailure",
    label: "HVAC Failure",
    icon: "❄️",
    severity: "medium",
  },
  {
    value: "other",
    key: "other",
    label: "Other Emergency",
    icon: "⚠️",
    severity: "medium",
  },
];

const safetyRiskLevels = [
  {
    value: "low",
    key: "low",
    label: "Low Risk",
    color: "text-green-600",
    bg: "bg-green-50",
  },
  {
    value: "medium",
    key: "medium",
    label: "Medium Risk",
    color: "text-yellow-600",
    bg: "bg-yellow-50",
  },
  {
    value: "high",
    key: "high",
    label: "High Risk",
    color: "text-orange-600",
    bg: "bg-orange-50",
  },
  {
    value: "critical",
    key: "critical",
    label: "Critical Risk",
    color: "text-red-600",
    bg: "bg-red-50",
  },
];

export function EmergencyRequestForm({
  onSubmit,
  isLoading = false,
  properties = [],
  tenants = [],
  initialData,
}: EmergencyRequestFormProps) {
  const { t } = useLocalizationContext();
  const [uploadedImages, setUploadedImages] = useState<string[]>([]);
  const [uploadingImages, setUploadingImages] = useState(false);

  const form = useForm<EmergencyRequestFormData>({
    resolver: zodResolver(emergencyRequestSchema),
    defaultValues: {
      title: "",
      description: "",
      emergencyType: "other",
      category: "Emergency",
      propertyId: "",
      tenantId: "",
      contactPhone: "",
      immediateAction: "",
      safetyRisk: "medium",
      images: [],
      ...initialData,
    },
  });

  const selectedEmergencyType = form.watch("emergencyType");

  // Auto-set category based on emergency type
  useEffect(() => {
    const typeToCategory: Record<string, string> = {
      water_leak: "Plumbing",
      electrical_hazard: "Electrical",
      gas_leak: "Plumbing",
      security_breach: "Security",
      fire_hazard: "Emergency",
      structural_damage: "Emergency",
      hvac_failure: "HVAC",
      other: "Emergency",
    };

    if (selectedEmergencyType && typeToCategory[selectedEmergencyType]) {
      form.setValue("category", typeToCategory[selectedEmergencyType] as any);
    }
  }, [selectedEmergencyType, form]);

  const handleImageUpload = async (files: FileList) => {
    if (files.length === 0) return;

    setUploadingImages(true);
    const newImages: string[] = [];

    try {
      for (const file of Array.from(files)) {
        if (file.size > 5 * 1024 * 1024) {
          toast.error(`File ${file.name} is too large. Maximum size is 5MB.`);
          continue;
        }

        if (!file.type.startsWith("image/")) {
          toast.error(`File ${file.name} is not an image.`);
          continue;
        }

        // Create FormData for upload
        const formData = new FormData();
        formData.append("file", file);
        formData.append("upload_preset", "property_images");

        // Upload to R2
        const response = await fetch("/api/upload/image", {
          method: "POST",
          body: formData,
        });

        if (response.ok) {
          const result = await response.json();
          newImages.push(result.secure_url);
        } else {
          toast.error(`Failed to upload ${file.name}`);
        }
      }

      const updatedImages = [...uploadedImages, ...newImages];
      setUploadedImages(updatedImages);
      form.setValue("images", updatedImages);

      if (newImages.length > 0) {
        toast.success(`Uploaded ${newImages.length} image(s) successfully`);
      }
    } catch (error) {
      toast.error(t("maintenance.emergency.form.uploadFailed", { defaultValue: "Could not upload the photos" }));
    } finally {
      setUploadingImages(false);
    }
  };

  const removeImage = (index: number) => {
    const updatedImages = uploadedImages.filter((_, i) => i !== index);
    setUploadedImages(updatedImages);
    form.setValue("images", updatedImages);
  };

  const handleFormSubmit = async (data: EmergencyRequestFormData) => {
    try {
      await onSubmit({
        ...data,
        images: uploadedImages,
      });
    } catch (error) {
      // Error handling is done in the parent component
    }
  };

  const selectedType = emergencyTypes.find(
    (type) => type.value === selectedEmergencyType
  );

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Emergency Alert */}
      <Alert className="border-red-200 bg-red-50">
        <AlertTriangle className="h-4 w-4 text-red-600" />
        <AlertDescription className="text-red-800">
          {t("maintenance.emergency.form.emergencyDetails.alert")}
        </AlertDescription>
      </Alert>

      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(handleFormSubmit)}
          className="space-y-6"
        >
          {/* Emergency Type and Safety Risk */}
          <Card className="border-red-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-red-700">
                <Zap className="h-5 w-5" />
                {t("maintenance.emergency.form.emergencyDetails.title")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="emergencyType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {t("maintenance.emergency.form.emergencyType.label")}
                      </FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue
                              placeholder={t(
                                "maintenance.emergency.form.emergencyType.placeholder"
                              )}
                            />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {emergencyTypes.map((type) => (
                            <SelectItem key={type.value} value={type.value}>
                              <div className="flex items-center gap-2">
                                <span>{type.icon}</span>
                                <span>
                                  {t(
                                    `maintenance.emergency.form.emergencyTypes.${type.key}`
                                  )}
                                </span>
                                <span
                                  className={`text-xs px-2 py-1 rounded ${
                                    type.severity === "critical"
                                      ? "bg-red-100 text-red-700"
                                      : type.severity === "high"
                                      ? "bg-orange-100 text-orange-700"
                                      : "bg-yellow-100 text-yellow-700"
                                  }`}
                                >
                                  {type.severity}
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
                  name="safetyRisk"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {t("maintenance.emergency.form.safetyRisk.label")}
                      </FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue
                              placeholder={t(
                                "maintenance.emergency.form.safetyRisk.placeholder"
                              )}
                            />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {safetyRiskLevels.map((risk) => (
                            <SelectItem key={risk.value} value={risk.value}>
                              <div
                                className={`flex items-center gap-2 px-2 py-1 rounded ${risk.bg}`}
                              >
                                <span className={risk.color}>●</span>
                                <span className={risk.color}>
                                  {t(
                                    `maintenance.emergency.form.safetyRisk.${risk.key}`
                                  )}
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
              </div>

              {selectedType && (
                <div
                  className={`p-3 rounded-lg ${
                    selectedType.severity === "critical"
                      ? "bg-red-50 border border-red-200"
                      : selectedType.severity === "high"
                      ? "bg-orange-50 border border-orange-200"
                      : "bg-yellow-50 border border-yellow-200"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{selectedType.icon}</span>
                    <span className="font-medium">
                      {t(
                        `maintenance.emergency.form.emergencyTypes.${selectedType.key}`
                      )}
                    </span>
                    <span
                      className={`text-xs px-2 py-1 rounded ${
                        selectedType.severity === "critical"
                          ? "bg-red-100 text-red-700"
                          : selectedType.severity === "high"
                          ? "bg-orange-100 text-orange-700"
                          : "bg-yellow-100 text-yellow-700"
                      }`}
                    >
                      {t("maintenance.emergency.form.severity", {
                        defaultValue: "{level} priority",
                        values: {
                          level: t(`exports.value.${selectedType.severity}`, {
                            defaultValue: selectedType.severity,
                          }),
                        },
                      })}
                    </span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Request Details */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5" />
                {t("maintenance.emergency.form.emergencyDetails.title")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t("maintenance.emergency.form.title.label")}
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder={t(
                          "maintenance.emergency.form.title.placeholder"
                        )}
                        {...field}
                        className="border-red-200 focus:border-red-400"
                      />
                    </FormControl>
                    <FormDescription>
                      {t(
                        "maintenance.emergency.form.emergencyDetails.description"
                      )}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t("maintenance.emergency.form.description.label")}
                    </FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder={t(
                          "maintenance.emergency.form.description.placeholder"
                        )}
                        className="min-h-[120px] border-red-200 focus:border-red-400"
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      {t("maintenance.emergency.form.description.description")}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="immediateAction"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t("maintenance.emergency.form.immediateAction.label")}
                    </FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder={t(
                          "maintenance.emergency.form.immediateAction.placeholder"
                        )}
                        className="min-h-[80px]"
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      {t(
                        "maintenance.emergency.form.immediateAction.description"
                      )}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          {/* Property and Contact Information */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Phone className="h-5 w-5" />
                {t("maintenance.emergency.form.contactInfo.title")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="propertyId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {t("maintenance.emergency.form.property.label")}
                      </FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue
                              placeholder={t(
                                "maintenance.emergency.form.property.placeholder"
                              )}
                            />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {properties.map((property) => (
                            <SelectItem key={property.id} value={property.id}>
                              <div>
                                <div className="font-medium">
                                  {property.name}
                                </div>
                                <div className="text-sm text-muted-foreground">
                                  {property.address}
                                </div>
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
                  name="tenantId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {t("maintenance.emergency.form.tenant.label")}
                      </FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue
                              placeholder={t(
                                "maintenance.emergency.form.tenant.placeholder"
                              )}
                            />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {tenants.map((tenant) => (
                            <SelectItem key={tenant.id} value={tenant.id}>
                              <div>
                                <div className="font-medium">{tenant.name}</div>
                                <div className="text-sm text-muted-foreground">
                                  {tenant.email} • {tenant.phone}
                                </div>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="contactPhone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t("maintenance.emergency.form.contactPhone.label")}
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder={t(
                          "maintenance.emergency.form.contactPhone.placeholder"
                        )}
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      {t("maintenance.emergency.form.contactPhone.description")}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          {/* Image Upload */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Upload className="h-5 w-5" />
                {t("maintenance.emergency.form.photos.title")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="border-2 border-dashed border-red-200 rounded-lg p-6 text-center">
                <input
                  type="file"
                  multiple
                  accept="image/*"
                  onChange={(e) =>
                    e.target.files && handleImageUpload(e.target.files)
                  }
                  className="hidden"
                  id="emergency-images"
                  disabled={uploadingImages}
                />
                <label
                  htmlFor="emergency-images"
                  className="cursor-pointer flex flex-col items-center gap-2"
                >
                  <Upload className="h-8 w-8 text-red-400" />
                  <div className="text-sm">
                    {t("maintenance.emergency.form.photos.description")}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t("maintenance.emergency.form.photos.limit", {
                      defaultValue: "PNG, JPG up to 5MB each",
                    })}
                  </div>
                </label>
              </div>

              {uploadingImages && (
                <div className="text-center text-sm text-muted-foreground">
                  {t("maintenance.emergency.form.buttons.submitting")}
                </div>
              )}

              {uploadedImages.length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {uploadedImages.map((image, index) => (
                    <div key={index} className="relative group">
                      <img
                        src={image}
                        alt={`Emergency photo ${index + 1}`}
                        className="w-full h-24 object-cover rounded-lg border"
                      />
                      <button
                        type="button"
                        onClick={() => removeImage(index)}
                        className="absolute -top-2 -end-2 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Submit Button */}
          <Card className="border-red-200 bg-red-50">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock className="h-5 w-5 text-red-600" />
                  <div>
                    <div className="font-medium text-red-700">
                      {t("maintenance.emergency.form.emergencyDetails.title")}
                    </div>
                    <div className="text-sm text-red-600">
                      {t("maintenance.emergency.form.emergencyDetails.alert")}
                    </div>
                  </div>
                </div>
                <Button
                  type="submit"
                  disabled={isLoading}
                  className="bg-red-600 hover:bg-red-700 text-white px-8"
                >
                  {isLoading ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white me-2" />
                      {t("maintenance.emergency.form.buttons.submitting")}
                    </>
                  ) : (
                    <>
                      <CheckCircle className="me-2 h-4 w-4" />
                      {t("maintenance.emergency.form.buttons.submit")}
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </form>
      </Form>
    </div>
  );
}
