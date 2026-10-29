"use client";

import { FormDatePicker } from "@/components/ui/date-picker";
import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
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
import {
  Form,
  FormControl,
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
import {
  ArrowLeft,
  User,
  Briefcase,
  Phone,
  FileText,
  Key,
  Calendar as CalendarIcon,
} from "lucide-react";
import Link from "next/link";
import { AvatarUpload } from "@/components/ui/avatar-upload";
import { LoadingSpinner } from "@/components/ui/loading-state";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { joinFullName } from "@/lib/full-name";
import { personEmail } from "@/lib/validations";
import { personErrorText } from "@/lib/person-error-text";
import { businessDay, pickedDay } from "@/lib/dates/business-day";

// Tenant form validation schema
const createTenantSchema = (
  t: (key: string, options?: { defaultValue?: string }) => string,
) =>
  z.object({
    // The scope's tenant record: one name field, what kind of party they are,
    // and the number that identifies them. Date of birth, SSN, employment and
    // credit score are gone — US rental-screening data this office never
    // collects, and the screening workflow that does keeps its own form.
    fullName: z
      .string()
      .trim()
      .min(
        1,
        t("tenants.form.validation.fullNameRequired", {
          defaultValue: "Full name is required",
        }),
      )
      .max(160),
    entityType: z.enum(["individual", "company"]),
    idNumber: z.string().trim().max(60).optional(),
    // Optional, as on the Add Tenant form: most tenants are recorded without
    // one, and requiring it here meant a tenant saved that way could never be
    // edited again.
    email: personEmail(t("tenants.form.validation.emailInvalid")),
    phone: z.string().min(1, t("tenants.form.validation.phoneRequired")),
    avatar: z.string().optional(),

    // Tenant Status
    tenantStatus: z
      .enum(
        [
          "application_submitted",
          "under_review",
          "approved",
          "active",
          "inactive",
          "moved_out",
          "terminated",
        ],
        {
          errorMap: () => ({
            message: t("tenants.form.validation.tenantStatusInvalid"),
          }),
        }
      )
      .default("application_submitted"),

    // Personal Information

    // Emergency Contact (All Optional)
    emergencyContactName: z.string().optional(),
    emergencyContactRelationship: z.string().optional(),
    emergencyContactPhone: z.string().optional(),
    emergencyContactEmail: z
      .string()
      .email(t("tenants.form.validation.emailInvalid"))
      .optional()
      .or(z.literal("")),

    // Additional Information
    moveInDate: z
      .string()
      .optional()
      .transform((val) => {
        if (!val || val.trim() === "") return undefined;
        return val.trim();
      })
      .refine(
        (val) => {
          if (!val) return true; // Allow empty/undefined values

          const date = new Date(val);
          if (isNaN(date.getTime())) return false;

          // Allow move-in dates from 5 years ago to 5 years in the future
          const fiveYearsAgo = new Date();
          fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5);

          const fiveYearsFromNow = new Date();
          fiveYearsFromNow.setFullYear(fiveYearsFromNow.getFullYear() + 5);

          return date >= fiveYearsAgo && date <= fiveYearsFromNow;
        },
        {
          message: t("tenants.form.validation.moveInDateRange"),
        }
      ),
    notes: z.string().optional(),
  });

export default function EditTenantPage() {
  const { t } = useLocalizationContext();
  const router = useRouter();
  const params = useParams();
  const tenantId = params.id as string;

  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [avatarUrl, setAvatarUrl] = useState<string>("");

  const tenantSchema = createTenantSchema(t);
  type TenantFormData = z.infer<typeof tenantSchema>;

  const form = useForm({
    resolver: zodResolver(tenantSchema),
    defaultValues: {
      tenantStatus: "application_submitted",
    },
  });

  useEffect(() => {
    fetchTenant();
  }, [tenantId]);

  const fetchTenant = async () => {
    try {
      setIsLoadingData(true);
      const response = await fetch(`/api/tenants/${tenantId}`);

      if (!response.ok) {
        throw new Error("Failed to fetch tenant");
      }

      const data = await response.json();
      const tenant = data?.data;

      if (!tenant) {
        throw new Error("Tenant data missing");
      }

      setAvatarUrl(tenant.avatar || "");

      // Populate form with existing data
      const emergencyContact = Array.isArray(tenant.emergencyContacts)
        ? tenant.emergencyContacts[0] || {}
        : {};

      form.reset({
        fullName: joinFullName(tenant),
        entityType:
          tenant.entityType === "company" ? "company" : "individual",
        idNumber: tenant.idNumber || "",
        email: tenant.email || "",
        phone: tenant.phone || "",
        avatar: tenant.avatar || "",
        tenantStatus: tenant.tenantStatus || "application_submitted",
        emergencyContactName: emergencyContact.name || "",
        emergencyContactRelationship: emergencyContact.relationship || "",
        emergencyContactPhone: emergencyContact.phone || "",
        emergencyContactEmail: emergencyContact.email || "",
        moveInDate: tenant.moveInDate
          ? businessDay(tenant.moveInDate)
          : "",
        notes: tenant.applicationNotes || "",
      });
    } catch (error) {
      toast.error(t("tenants.details.error.fetchFailed"));
    } finally {
      setIsLoadingData(false);
    }
  };

  const handleAvatarUploaded = (url: string) => {
    setAvatarUrl(url);
    form.setValue("avatar", url);
  };

  const handleAvatarRemoved = () => {
    setAvatarUrl("");
    form.setValue("avatar", "");
  };

  const onSubmit = async (data: TenantFormData) => {
    setIsLoading(true);
    try {
      // Update tenant user directly with all data
      const tenantData = {
        // The API splits this back into firstName/lastName.
        fullName: data.fullName,
        entityType: data.entityType,
        idNumber: data.idNumber || null,
        // Blank is "no email"; the API stores it as none.
        email: data.email?.trim() ?? "",
        phone: data.phone,
        avatar: avatarUrl || undefined,
        tenantStatus: data.tenantStatus,
        emergencyContacts:
          data.emergencyContactName?.trim()
            ? [
                {
                  name: data.emergencyContactName,
                  relationship: data.emergencyContactRelationship || "",
                  phone: data.emergencyContactPhone || "",
                  email: data.emergencyContactEmail || "",
                },
              ]
            : [],
        moveInDate: data.moveInDate || undefined,
        applicationNotes: data.notes || undefined,
      };

      const response = await fetch(`/api/tenants/${tenantId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(tenantData),
      });

      const result = await response.json().catch(() => null);

      if (!response.ok) {
        // Name and email refusals arrive as codes, said in the reader's
        // language; anything else falls back to the server's text.
        throw new Error(
          personErrorText(t, result, t("tenants.toasts.updateError")),
        );
      }

      toast.success(t("tenants.toasts.updateSuccess"));
      router.push("/dashboard/tenants");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("tenants.toasts.updateError")
      );
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoadingData) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <LoadingSpinner
          message={t("tenants.form.loadingTenantData")}
          size="lg"
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20 p-4 md:p-6">
      <div className="container mx-auto max-w-5xl space-y-8">
        {/* Enhanced Header */}
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              {t("tenants.editTenant.title")}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t("tenants.editTenant.subtitle")}
            </p>
          </div>
          <Link href="/dashboard/tenants">
            <Button
              variant="ghost"
              size="sm"
              className="hover:bg-accent/50 transition-colors border-2"
            >
              <ArrowLeft className="h-4 w-4 me-2 rtl:-scale-x-100" />
              {t("tenants.form.actions.backToTenants")}
            </Button>
          </Link>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
            {/* Modern Grid Layout */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Avatar Upload - Enhanced Card */}
              <div className="lg:col-span-4">
                <Card className="h-fit shadow-lg hover:shadow-xl transition-all duration-300 bg-card/95 backdrop-blur-sm">
                  <CardHeader className="text-center pb-4">
                    <CardTitle className="flex items-center justify-center gap-2 text-xl">
                      <User className="h-6 w-6 text-primary" />
                      {t("tenants.form.sections.avatar.title")}
                    </CardTitle>
                    <CardDescription className="text-base">
                      {t("tenants.form.sections.avatar.description")}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex justify-center pb-8">
                    <AvatarUpload
                      currentAvatar={avatarUrl}
                      onAvatarUploaded={handleAvatarUploaded}
                      onAvatarRemoved={handleAvatarRemoved}
                      disabled={isLoading}
                      userInitials={
                        `${form.watch("fullName")?.trim()?.[0] || ""}${
                          form
                            .watch("fullName")
                            ?.trim()
                            ?.split(/\s+/)?.[1]?.[0] || ""
                        }`.toUpperCase() || "U"
                      }
                    />
                  </CardContent>
                </Card>
              </div>

              {/* Personal Information - Enhanced Large Card */}
              <div className="lg:col-span-8">
                <Card className="h-fit shadow-lg hover:shadow-xl transition-all duration-300 bg-card/95 backdrop-blur-sm">
                  <CardHeader className="pb-6">
                    <CardTitle className="flex items-center gap-3 text-xl">
                      <User className="h-6 w-6 text-primary" />
                      {t("tenants.form.sections.personalInfo.title")}
                    </CardTitle>
                    <CardDescription className="text-base">
                      {t("tenants.form.sections.personalInfo.description")}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {/* One name field, as the contract prints it. The API
                          splits it back into the legacy first/last columns. */}
                      <FormField
                        control={form.control}
                        name="fullName"
                        render={({ field }) => (
                          <FormItem className="space-y-3 md:col-span-2">
                            <FormLabel className="text-sm font-semibold text-foreground">
                              {t("tenants.form.fields.fullName.label", {
                                defaultValue: "Full name",
                              })}
                            </FormLabel>
                            <FormControl>
                              <Input
                                placeholder={t(
                                  "tenants.form.fields.fullName.placeholder",
                                  { defaultValue: "Full name as on the ID" },
                                )}
                                className="h-11 border-2 border-border/60 focus:border-primary/60 focus:ring-2 focus:ring-primary/20 bg-background/50 transition-all duration-200"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="entityType"
                        render={({ field }) => (
                          <FormItem className="space-y-3">
                            <FormLabel className="text-sm font-semibold text-foreground">
                              {t("tenants.form.fields.entityType.label", {
                                defaultValue: "Entity type",
                              })}
                            </FormLabel>
                            <Select
                              onValueChange={field.onChange}
                              value={field.value}
                            >
                              <FormControl>
                                <SelectTrigger className="h-11 border-2 border-border/60 focus:border-primary/60 focus:ring-2 focus:ring-primary/20 bg-background/50 transition-all duration-200">
                                  <SelectValue />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="individual">
                                  {t("tenants.form.fields.entityType.individual", {
                                    defaultValue: "Individual",
                                  })}
                                </SelectItem>
                                <SelectItem value="company">
                                  {t("tenants.form.fields.entityType.company", {
                                    defaultValue: "Company",
                                  })}
                                </SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      {/* National ID for a person, Commercial Registration
                          number for a company — one field either way. */}
                      <FormField
                        control={form.control}
                        name="idNumber"
                        render={({ field }) => (
                          <FormItem className="space-y-3">
                            <FormLabel className="text-sm font-semibold text-foreground">
                              {form.watch("entityType") === "company"
                                ? t("tenants.form.fields.idNumber.company", {
                                    defaultValue: "Commercial Registration no.",
                                  })
                                : t("tenants.form.fields.idNumber.individual", {
                                    defaultValue: "ID number",
                                  })}
                            </FormLabel>
                            <FormControl>
                              <Input className="h-11 border-2 border-border/60 focus:border-primary/60 focus:ring-2 focus:ring-primary/20 bg-background/50 transition-all duration-200" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="email"
                        render={({ field }) => (
                          <FormItem className="space-y-3">
                            <FormLabel className="text-sm font-semibold text-foreground">
                              {t("tenants.form.fields.email.label")}
                              <span className="ms-1 text-xs font-normal text-muted-foreground">
                                {t("tenants.form.fields.email.optional", {
                                  defaultValue: "(optional)",
                                })}
                              </span>
                            </FormLabel>
                            <FormControl>
                              <Input
                                type="email"
                                placeholder={t(
                                  "tenants.form.fields.email.placeholder"
                                )}
                                className="h-11 border-2 border-border/60 focus:border-primary/60 focus:ring-2 focus:ring-primary/20 bg-background/50 transition-all duration-200"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="phone"
                        render={({ field }) => (
                          <FormItem className="space-y-3">
                            <FormLabel className="text-sm font-semibold text-foreground">
                              {t("tenants.form.fields.phone.label")}
                            </FormLabel>
                            <FormControl>
                              <Input
                                placeholder={t(
                                  "tenants.form.fields.phone.placeholder"
                                )}
                                className="h-11 border-2 border-border/60 focus:border-primary/60 focus:ring-2 focus:ring-primary/20 bg-background/50 transition-all duration-200"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Account Setup - Enhanced Medium Card */}
              <div className="lg:col-span-6">
                <Card className="h-fit shadow-lg hover:shadow-xl transition-all duration-300 bg-card/95 backdrop-blur-sm">
                  <CardHeader className="pb-6">
                    <CardTitle className="flex items-center gap-3 text-xl">
                      <Key className="h-6 w-6 text-primary" />
                      {t("tenants.form.sections.accountSetup.title")}
                    </CardTitle>
                    <CardDescription className="text-base">
                      {t("tenants.form.sections.accountSetup.description")}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="grid grid-cols-1 gap-6">
                      <FormField
                        control={form.control}
                        name="tenantStatus"
                        render={({ field }) => (
                          <FormItem className="space-y-3">
                            <FormLabel className="text-sm font-semibold text-foreground">
                              {t("tenants.form.fields.tenantStatus.label")}
                            </FormLabel>
                            <Select
                              onValueChange={field.onChange}
                              value={field.value}
                            >
                              <FormControl>
                                <SelectTrigger className="h-11 border-2 border-border/60 focus:border-primary/60 focus:ring-2 focus:ring-primary/20 bg-background/50 transition-all duration-200">
                                  <SelectValue
                                    placeholder={t(
                                      "tenants.form.fields.tenantStatus.placeholder"
                                    )}
                                  />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="application_submitted">
                                  {t("tenants.status.applicationSubmitted")}
                                </SelectItem>
                                <SelectItem value="under_review">
                                  {t("tenants.status.underReview")}
                                </SelectItem>
                                <SelectItem value="approved">
                                  {t("tenants.status.approved")}
                                </SelectItem>
                                <SelectItem value="active">
                                  {t("tenants.status.active")}
                                </SelectItem>
                                <SelectItem value="inactive">
                                  {t("tenants.status.inactive")}
                                </SelectItem>
                                <SelectItem value="moved_out">
                                  {t("tenants.status.movedOut")}
                                </SelectItem>
                                <SelectItem value="terminated">
                                  {t("tenants.status.terminated")}
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
              </div>

              {/* Employment Information - Enhanced Medium Card */}
              <div className="lg:col-span-6">
                <Card className="h-fit shadow-lg hover:shadow-xl transition-all duration-300 bg-card/95 backdrop-blur-sm">
                  <CardHeader className="pb-6">
                    <CardTitle className="flex items-center gap-3 text-xl">
                      <Briefcase className="h-6 w-6 text-primary" />
                      {t("tenants.form.sections.employment.title")}
                    </CardTitle>
                    <CardDescription className="text-base">
                      {t("tenants.form.sections.employment.description")}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="grid grid-cols-1 gap-6">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Emergency Contact - Enhanced Medium Card */}
              <div className="lg:col-span-7">
                <Card className="h-fit shadow-lg hover:shadow-xl transition-all duration-300 bg-card/95 backdrop-blur-sm">
                  <CardHeader className="pb-6">
                    <CardTitle className="flex items-center gap-3 text-xl">
                      <Phone className="h-6 w-6 text-primary" />
                      {t("tenants.form.sections.emergencyContact.title")}
                    </CardTitle>
                    <CardDescription className="text-base">
                      {t("tenants.form.sections.emergencyContact.description")}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <FormField
                        control={form.control}
                        name="emergencyContactName"
                        render={({ field }) => (
                          <FormItem className="space-y-3">
                            <FormLabel className="text-sm font-semibold text-muted-foreground">
                              {t(
                                "tenants.form.fields.emergencyContactName.label"
                              )}
                            </FormLabel>
                            <FormControl>
                              <Input
                                placeholder={t(
                                  "tenants.form.fields.emergencyContactName.placeholder"
                                )}
                                className="h-11 border-2 border-border/60 focus:border-primary/60 focus:ring-2 focus:ring-primary/20 bg-background/50 transition-all duration-200"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="emergencyContactRelationship"
                        render={({ field }) => (
                          <FormItem className="space-y-3">
                            <FormLabel className="text-sm font-semibold text-muted-foreground">
                              {t(
                                "tenants.form.fields.emergencyContactRelationship.label"
                              )}
                            </FormLabel>
                            <FormControl>
                              <Select
                                onValueChange={field.onChange}
                                defaultValue={field.value}
                              >
                                <SelectTrigger className="h-11 border-2 border-border/60 focus:border-primary/60 focus:ring-2 focus:ring-primary/20 bg-background/50 transition-all duration-200">
                                  <SelectValue
                                    placeholder={t(
                                      "tenants.form.fields.emergencyContactRelationship.placeholder"
                                    )}
                                  />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="spouse">
                                    {t(
                                      "tenants.form.fields.emergencyContactRelationship.spouse"
                                    )}
                                  </SelectItem>
                                  <SelectItem value="parent">
                                    {t(
                                      "tenants.form.fields.emergencyContactRelationship.parent"
                                    )}
                                  </SelectItem>
                                  <SelectItem value="sibling">
                                    {t(
                                      "tenants.form.fields.emergencyContactRelationship.sibling"
                                    )}
                                  </SelectItem>
                                  <SelectItem value="child">
                                    {t(
                                      "tenants.form.fields.emergencyContactRelationship.child"
                                    )}
                                  </SelectItem>
                                  <SelectItem value="friend">
                                    {t(
                                      "tenants.form.fields.emergencyContactRelationship.friend"
                                    )}
                                  </SelectItem>
                                  <SelectItem value="other">
                                    {t(
                                      "tenants.form.fields.emergencyContactRelationship.other"
                                    )}
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="emergencyContactPhone"
                        render={({ field }) => (
                          <FormItem className="space-y-3">
                            <FormLabel className="text-sm font-semibold text-muted-foreground">
                              {t(
                                "tenants.form.fields.emergencyContactPhone.label"
                              )}
                            </FormLabel>
                            <FormControl>
                              <Input
                                placeholder={t(
                                  "tenants.form.fields.emergencyContactPhone.placeholder"
                                )}
                                className="h-11 border-2 border-border/60 focus:border-primary/60 focus:ring-2 focus:ring-primary/20 bg-background/50 transition-all duration-200"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="emergencyContactEmail"
                        render={({ field }) => (
                          <FormItem className="space-y-3">
                            <FormLabel className="text-sm font-semibold text-muted-foreground">
                              {t(
                                "tenants.form.fields.emergencyContactEmail.label"
                              )}
                            </FormLabel>
                            <FormControl>
                              <Input
                                type="email"
                                placeholder={t(
                                  "tenants.form.fields.emergencyContactEmail.placeholder"
                                )}
                                className="h-11 border-2 border-border/60 focus:border-primary/60 focus:ring-2 focus:ring-primary/20 bg-background/50 transition-all duration-200"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Additional Information - Enhanced Small Card */}
              <div className="lg:col-span-5">
                <Card className="h-fit shadow-lg hover:shadow-xl transition-all duration-300 bg-card/95 backdrop-blur-sm">
                  <CardHeader className="pb-6">
                    <CardTitle className="flex items-center gap-3 text-xl">
                      <FileText className="h-6 w-6 text-primary" />
                      {t("tenants.form.sections.additionalInfo.title")}
                    </CardTitle>
                    <CardDescription className="text-base">
                      {t("tenants.form.sections.additionalInfo.description")}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <FormField
                      control={form.control}
                      name="moveInDate"
                      render={({ field }) => (
                        <FormItem className="space-y-3">
                          <FormLabel className="text-sm font-semibold text-muted-foreground">
                            {t("tenants.form.fields.moveInDate.label")}
                          </FormLabel>
                          <FormControl>
                            <FormDatePicker
                              value={
                                field.value ? new Date(field.value) : undefined
                              }
                              onChange={(date) =>
                                field.onChange(
                                  date ? pickedDay(date) : undefined
                                )
                              }
                              placeholder={t(
                                "tenants.form.fields.moveInDate.placeholder"
                              )}
                              disabled={(date) => {
                                const fiveYearsAgo = new Date();
                                fiveYearsAgo.setFullYear(
                                  fiveYearsAgo.getFullYear() - 5
                                );
                                const fiveYearsFromNow = new Date();
                                fiveYearsFromNow.setFullYear(
                                  fiveYearsFromNow.getFullYear() + 5
                                );
                                return (
                                  date < fiveYearsAgo || date > fiveYearsFromNow
                                );
                              }}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </CardContent>
                </Card>
              </div>

              {/* Notes - Enhanced Full Width Card */}
              <div className="lg:col-span-12">
                <Card className="h-fit shadow-lg hover:shadow-xl transition-all duration-300 bg-card/95 backdrop-blur-sm">
                  <CardHeader className="pb-6">
                    <CardTitle className="flex items-center gap-3 text-xl">
                      <FileText className="h-6 w-6 text-primary" />
                      {t("tenants.form.sections.notes.title")}
                    </CardTitle>
                    <CardDescription className="text-base">
                      {t("tenants.form.sections.notes.description")}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <FormField
                      control={form.control}
                      name="notes"
                      render={({ field }) => (
                        <FormItem className="space-y-3">
                          <FormLabel className="text-sm font-semibold text-muted-foreground">
                            {t("tenants.form.fields.notes.label")}
                          </FormLabel>
                          <FormControl>
                            <Textarea
                              placeholder={t(
                                "tenants.form.fields.notes.placeholder"
                              )}
                              className="min-h-[120px] border-2 border-border/60 focus:border-primary/60 focus:ring-2 focus:ring-primary/20 bg-background/50 transition-all duration-200 resize-none"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </CardContent>
                </Card>
              </div>
            </div>

            {/* Enhanced Form Actions */}
            <div className="flex items-center justify-between pt-8">
              <div className="text-sm text-muted-foreground">
                {t("tenants.form.actions.requiredFields")}
              </div>
              <div className="flex items-center gap-4">
                <Link href="/dashboard/tenants">
                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    className="h-12 px-8 border-2 hover:bg-accent/50 transition-all duration-200"
                  >
                    {t("tenants.form.actions.cancel")}
                  </Button>
                </Link>
                <Button
                  type="submit"
                  disabled={isLoading}
                  size="lg"
                  className="h-12 px-8 bg-gradient-to-r from-primary to-primary/90 hover:from-primary/90 hover:to-primary/80 shadow-lg hover:shadow-xl transition-all duration-200"
                >
                  {isLoading ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white me-2"></div>
                      {t("tenants.form.actions.updating")}
                    </>
                  ) : (
                    t("tenants.form.actions.update")
                  )}
                </Button>
              </div>
            </div>
          </form>
        </Form>
      </div>
    </div>
  );
}
