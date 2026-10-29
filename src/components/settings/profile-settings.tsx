"use client";

import { z } from "zod";
import { useState, useEffect } from "react";
import { useSession } from "@/lib/auth-client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { isValidPhoneNumber } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import { logClientError, logClientWarn } from "@/utils/logger";
import { useUserAvatar } from "@/components/providers/UserAvatarProvider";
import { ProfileSettingsSkeleton } from "@/components/settings/profile-skeleton";
import { Upload, User, Calendar } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { useOwnRoleName } from "@/hooks/useGroupNames";
import { formatDisplayDate } from "@/lib/utils/formatting";
import { businessDay } from "@/lib/dates/business-day";

const createProfileSchema = (t: (key: string) => string) =>
  z.object({
    firstName: z
      .string()
      .min(1, t("settings.profile.validation.firstNameRequired"))
      .max(50, t("settings.profile.validation.firstNameTooLong")),
    lastName: z
      .string()
      .min(1, t("settings.profile.validation.lastNameRequired"))
      .max(50, t("settings.profile.validation.lastNameTooLong")),
    email: z.string().email(t("settings.profile.validation.invalidEmail")),
    phone: z
      .string()
      .optional()
      .refine(
        (phone) => {
          if (!phone || phone.trim() === "") return true;
          return isValidPhoneNumber(phone);
        },
        {
          message: t("settings.profile.validation.invalidPhone"),
        },
      ),
    bio: z
      .string()
      .max(500, t("settings.profile.validation.bioTooLong"))
      .optional(),
    location: z
      .string()
      .max(100, t("settings.profile.validation.locationTooLong"))
      .optional(),
    city: z
      .string()
      .max(50, t("settings.profile.validation.cityTooLong"))
      .optional(),
    website: z
      .string()
      .optional()
      .refine(
        (website) => {
          if (!website || website.trim() === "") return true;
          try {
            new URL(website);
            return true;
          } catch {
            return false;
          }
        },
        {
          message: t("settings.profile.validation.invalidWebsite"),
        },
      ),
    address: z
      .string()
      .max(200, t("settings.profile.validation.addressTooLong"))
      .optional(),
    jobTitle: z
      .string()
      .max(100, t("settings.profile.validation.jobTitleTooLong"))
      .optional(),
    company: z
      .string()
      .max(100, t("settings.profile.validation.companyTooLong"))
      .optional(),
    dateOfBirth: z.string().optional(),
    gender: z.enum(["male", "female", "other", "prefer_not_to_say"]).optional(),
    emergencyContact: z
      .object({
        name: z
          .string()
          .max(
            100,
            t("settings.profile.validation.emergencyContactNameTooLong"),
          )
          .optional(),
        phone: z.string().optional(),
        relationship: z
          .string()
          .max(50, t("settings.profile.validation.relationshipTooLong"))
          .optional(),
      })
      .optional(),
    socialLinks: z
      .object({
        linkedin: z
          .string()
          .url(t("settings.profile.validation.invalidLinkedIn"))
          .optional()
          .or(z.literal("")),
        twitter: z
          .string()
          .url(t("settings.profile.validation.invalidTwitter"))
          .optional()
          .or(z.literal("")),
        facebook: z
          .string()
          .url(t("settings.profile.validation.invalidFacebook"))
          .optional()
          .or(z.literal("")),
        instagram: z
          .string()
          .url(t("settings.profile.validation.invalidInstagram"))
          .optional()
          .or(z.literal("")),
      })
      .optional(),
    preferences: z
      .object({
        preferredContactMethod: z.enum(["email", "phone", "sms"]).optional(),
        language: z.string().optional(),
        timezone: z.string().optional(),
      })
      .optional(),
  });

type ProfileFormData = z.infer<ReturnType<typeof createProfileSchema>>;

interface ProfileSettingsProps {
  user: any;
  onUpdate: (data: any) => void;
  onAlert: (type: "success" | "error" | "info", message: string) => void;
}

export function ProfileSettings({
  user,
  onUpdate,
  onAlert,
}: ProfileSettingsProps) {
  const { t } = useLocalizationContext();
  const { update: updateSession } = useSession();
  // This is the signed-in person's own profile: their role by its name, in
  // their language — a group's stored key ("group_2") said nothing.
  const ownRoleName = useOwnRoleName();
  const { avatarUrl, setAvatarUrl } = useUserAvatar();
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [avatarKey, setAvatarKey] = useState(Date.now());

  useEffect(() => {
    if (user?.avatar) {
      setAvatarUrl(user.avatar);
    }
  }, [user?.avatar, setAvatarUrl]);

  // Helper function to format date for HTML date input
  const formatDateForInput = (date: any): string => {
    if (!date) return "";

    try {
      // Handle different date formats
      let dateObj: Date;

      if (date instanceof Date) {
        dateObj = date;
      } else if (typeof date === "string") {
        dateObj = new Date(date);
      } else {
        return "";
      }

      // Check if date is valid
      if (isNaN(dateObj.getTime())) {
        return "";
      }

      // Format as YYYY-MM-DD for HTML date input
      return businessDay(dateObj);
    } catch (error) {
      logClientWarn("Error formatting date:", error);
      return "";
    }
  };

  // Create default values from user data
  const getDefaultValues = (userData: any): ProfileFormData => ({
    firstName: userData?.firstName || "",
    lastName: userData?.lastName || "",
    email: userData?.email || "",
    phone: userData?.phone || "",
    bio: userData?.bio || "",
    location: userData?.location || "",
    city: userData?.city || "",
    website: userData?.website || "",
    address: userData?.address || "",
    jobTitle: userData?.jobTitle || "",
    company: userData?.company || "",
    dateOfBirth: formatDateForInput(userData?.dateOfBirth),
    gender: userData?.gender || undefined,
    emergencyContact: {
      name: userData?.emergencyContact?.name || "",
      phone: userData?.emergencyContact?.phone || "",
      relationship: userData?.emergencyContact?.relationship || "",
    },
    socialLinks: {
      linkedin: userData?.socialLinks?.linkedin || "",
      twitter: userData?.socialLinks?.twitter || "",
      facebook: userData?.socialLinks?.facebook || "",
      instagram: userData?.socialLinks?.instagram || "",
    },
    preferences: {
      preferredContactMethod:
        userData?.preferences?.preferredContactMethod || "email",
      language: userData?.preferences?.language || "en",
      timezone: userData?.preferences?.timezone || "America/New_York",
    },
  });

  const form = useForm<ProfileFormData>({
    resolver: zodResolver(createProfileSchema(t)),
    defaultValues: getDefaultValues(user),
    mode: "onChange",
  });

  // Update form when user data changes
  useEffect(() => {
    if (user && Object.keys(user).length > 0) {
      const formData = getDefaultValues(user);

      // Use setTimeout to ensure form reset happens after component is fully mounted
      setTimeout(() => {
        // Reset form first
        form.reset(formData);

        // Then set individual values to ensure they're properly set
        Object.entries(formData).forEach(([key, value]) => {
          if (value !== undefined && value !== null && value !== "") {
            form.setValue(key as keyof ProfileFormData, value, {
              shouldValidate: false,
              shouldDirty: false,
              shouldTouch: false,
            });
          }
        });

        form.clearErrors();
      }, 100); // Increased timeout to ensure proper mounting
    }
  }, [user, form]);

  const onSubmit = async (data: ProfileFormData) => {
    try {
      setIsLoading(true);

      // Helper function to validate and clean URL
      const cleanUrl = (url?: string) => {
        if (!url || url.trim() === "") return "";
        const trimmed = url.trim();
        // If it doesn't start with http/https, add https://
        if (
          trimmed &&
          !trimmed.startsWith("http://") &&
          !trimmed.startsWith("https://")
        ) {
          return `https://${trimmed}`;
        }
        return trimmed;
      };

      // Prepare data for the profile settings API
      const profileData = {
        firstName: data.firstName?.trim(),
        lastName: data.lastName?.trim(),
        email: data.email?.trim(),
        phone: data.phone?.trim() || undefined,
        bio: data.bio?.trim() || undefined,
        location: data.location?.trim() || undefined,
        city: data.city?.trim() || undefined,
        website: cleanUrl(data.website) || undefined,
        address: data.address?.trim() || undefined,
        jobTitle: data.jobTitle?.trim() || undefined,
        company: data.company?.trim() || undefined,
        // Convert dateOfBirth to ISO string if provided
        dateOfBirth: data.dateOfBirth?.trim()
          ? new Date(data.dateOfBirth.trim()).toISOString()
          : undefined,
        gender: data.gender || undefined,
        // Keep emergencyContact as object (ProfileSettings model expects this format)
        emergencyContact: data.emergencyContact?.name?.trim()
          ? {
              name: data.emergencyContact.name.trim(),
              phone: data.emergencyContact.phone?.trim() || "",
              relationship: data.emergencyContact.relationship?.trim() || "",
            }
          : undefined,
        // Clean social links URLs
        socialLinks: {
          linkedin: cleanUrl(data.socialLinks?.linkedin) || undefined,
          twitter: cleanUrl(data.socialLinks?.twitter) || undefined,
          facebook: cleanUrl(data.socialLinks?.facebook) || undefined,
          instagram: cleanUrl(data.socialLinks?.instagram) || undefined,
        },
        preferences: data.preferences,
      };

      // Remove undefined values and empty objects to avoid validation issues
      const cleanData = Object.fromEntries(
        Object.entries(profileData).filter(([_, value]) => {
          if (value === undefined || value === null || value === "")
            return false;
          if (typeof value === "object" && value !== null) {
            // For objects, check if they have any non-undefined values
            const hasValues = Object.values(value).some(
              (v) => v !== undefined && v !== null && v !== "",
            );
            return hasValues;
          }
          return true;
        }),
      );

      // Prepare payload for core user profile update (main User model)
      const userProfileData: Record<string, any> = {
        firstName: profileData.firstName,
        lastName: profileData.lastName,
        email: profileData.email,
        phone: profileData.phone,
        bio: profileData.bio,
        location: profileData.location,
        city: profileData.city,
        website: profileData.website,
        address: profileData.address,
      };

      const cleanUserProfileData = Object.fromEntries(
        Object.entries(userProfileData).filter(([_, value]) => {
          return value !== undefined && value !== null && value !== "";
        }),
      );

      const normalizedCurrentEmail = String(user?.email || "")
        .trim()
        .toLowerCase();
      const normalizedNextEmail =
        typeof cleanUserProfileData.email === "string"
          ? cleanUserProfileData.email.trim().toLowerCase()
          : "";

      // Avoid sending unchanged email to prevent unnecessary uniqueness checks.
      if (
        normalizedNextEmail &&
        normalizedNextEmail === normalizedCurrentEmail
      ) {
        delete cleanUserProfileData.email;
      }

      const [settingsResponse, userProfileResponse] = await Promise.all([
        fetch("/api/settings/profile", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(cleanData),
        }),
        fetch("/api/user/profile", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(cleanUserProfileData),
        }),
      ]);

      if (!settingsResponse.ok) {
        const errorData = await settingsResponse.json().catch(() => null);
        throw new Error(
          errorData?.error ||
            errorData?.message ||
            t("settings.profile.toast.settingsUpdateFailed"),
        );
      }

      if (!userProfileResponse.ok) {
        const errorData = await userProfileResponse.json().catch(() => null);
        throw new Error(
          errorData?.error ||
            errorData?.message ||
            t("settings.profile.toast.accountUpdateFailed"),
        );
      }

      const settingsResult = await settingsResponse.json();
      const userResult = await userProfileResponse.json();

      const updatedSettings =
        settingsResult?.data?.settings ??
        settingsResult?.settings ??
        settingsResult?.data ??
        settingsResult;

      const updatedUser =
        userResult?.data?.user ??
        userResult?.user ??
        userResult?.data ??
        userResult;

      if (!updatedSettings || typeof updatedSettings !== "object") {
        throw new Error(t("settings.profile.toast.unexpectedSettingsResponse"));
      }

      if (!updatedUser || typeof updatedUser !== "object") {
        throw new Error(t("settings.profile.toast.unexpectedUserResponse"));
      }

      // Merge existing user data with latest user profile and settings
      const mergedUserData = {
        ...user,
        ...updatedUser,
        ...updatedSettings,
      };

      form.reset(getDefaultValues(mergedUserData));

      // Update global avatar state so header/sidebar update immediately
      if (mergedUserData.avatar || mergedUserData.image) {
        setAvatarUrl(mergedUserData.avatar || mergedUserData.image);
      }

      onUpdate(mergedUserData);
      onAlert("success", t("settings.profile.toast.updateSuccess"));

      // Refresh the auth session so header/sidebar use latest name & avatar
      try {
        await updateSession();
      } catch (sessionError) {
        logClientWarn(
          "Failed to refresh session after profile update:",
          sessionError,
        );
      }
    } catch (error) {
      logClientError("Profile update error:", error);
      onAlert(
        "error",
        error instanceof Error
          ? error.message
          : t("settings.profile.toast.updateFailed"),
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleAvatarUpload = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith("image/")) {
      onAlert("error", t("settings.profile.toast.selectImageFile"));
      return;
    }

    // Validate file size (5MB max)
    if (file.size > 5 * 1024 * 1024) {
      onAlert("error", t("settings.profile.toast.imageSizeLimit"));
      return;
    }

    try {
      setIsUploading(true);

      // Upload to R2 first
      const formData = new FormData();
      formData.append("files", file);
      formData.append("folder", "PropertyPro/avatars");
      formData.append("quality", "85");
      formData.append("maxWidth", "400");
      formData.append("maxHeight", "400");

      const uploadResponse = await fetch("/api/upload/images", {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      const uploadResult = await uploadResponse.json();

      if (!uploadResponse.ok || !uploadResult?.success) {
        const errorMessage =
          uploadResult?.error ||
          uploadResult?.details?.join(", ") ||
          "Failed to upload image";
        console.error("Upload error:", uploadResult);
        throw new Error(errorMessage);
      }

      if (!uploadResult?.images?.[0]?.url) {
        throw new Error("Invalid upload response from R2");
      }

      const avatarUrl = uploadResult.images[0].url;

      // Update user avatar with R2 URL
      const updateResponse = await fetch("/api/user/avatar", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ avatar: avatarUrl }),
      });

      if (!updateResponse.ok) {
        const errorText = await updateResponse.text();
        logClientError(
          "Avatar update error:",
          updateResponse.status,
          errorText,
        );
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = { error: errorText };
        }
        throw new Error(
          errorData?.error ||
            `Failed to update avatar: ${updateResponse.status}`,
        );
      }

      const result = await updateResponse.json();

      // Validate response structure
      if (!result?.success || !result?.data?.user) {
        throw new Error("Invalid response from server");
      }

      // Update global avatar state so header/sidebar update immediately
      setAvatarUrl(avatarUrl);

      // Update avatar key to force re-render
      setAvatarKey(Date.now());

      // Pass the complete updated user object to onUpdate
      onUpdate(result?.data?.user);
      onAlert("success", t("settings.profile.toast.avatarUpdateSuccess"));
    } catch (error) {
      onAlert(
        "error",
        error instanceof Error
          ? error.message
          : t("settings.profile.toast.uploadFailed"),
      );
    } finally {
      setIsUploading(false);
    }
  };

  if (!user) {
    return <ProfileSettingsSkeleton />;
  }

  return (
    <div className="space-y-6">
      {/* Avatar Section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            {t("settings.profile.avatar.title")}
          </CardTitle>
          <CardDescription>
            {t("settings.profile.avatar.description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-6">
            <Avatar className="h-20 w-20" key={avatarKey}>
              <AvatarImage
                src={avatarUrl || user?.avatar || user?.image || ""}
                alt={user?.name || `${user?.firstName} ${user?.lastName}`}
              />
              <AvatarFallback className="text-lg">
                {user?.firstName?.[0] || "N"}
                {user?.lastName?.[0] || "S"}
              </AvatarFallback>
            </Avatar>
            <div className="space-y-2">
              <Label htmlFor="avatar-upload" className="cursor-pointer">
                <Button
                  variant="outline"
                  disabled={isUploading}
                  className="cursor-pointer"
                  asChild
                >
                  <span>
                    <Upload className="h-4 w-4 me-2" />
                    {isUploading
                      ? t("settings.profile.avatar.uploading")
                      : t("settings.profile.avatar.uploadPhoto")}
                  </span>
                </Button>
              </Label>
              <input
                id="avatar-upload"
                type="file"
                accept="image/*"
                onChange={handleAvatarUpload}
                className="hidden"
              />
              <p className="text-sm text-muted-foreground">
                {t("settings.profile.avatar.fileTypes")}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Single Unified Form */}
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {/* Basic Information */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              {t("settings.profile.basicInfo.title")}
            </CardTitle>
            <CardDescription>
              {t("settings.profile.basicInfo.description")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="firstName">
                  {t("settings.profile.basicInfo.firstName")}
                </Label>
                <Input
                  id="firstName"
                  {...form.register("firstName")}
                  error={form.formState.errors.firstName?.message}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">
                  {t("settings.profile.basicInfo.lastName")}
                </Label>
                <Input
                  id="lastName"
                  {...form.register("lastName")}
                  error={form.formState.errors.lastName?.message}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">
                {t("settings.profile.basicInfo.email")}
              </Label>
              <Input
                id="email"
                type="email"
                {...form.register("email")}
                error={form.formState.errors.email?.message}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">
                {t("settings.profile.basicInfo.phone")}
              </Label>
              <Input
                id="phone"
                type="tel"
                placeholder={t("settings.profile.basicInfo.phonePlaceholder")}
                {...form.register("phone")}
                error={form.formState.errors.phone?.message}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="bio">{t("settings.profile.basicInfo.bio")}</Label>
              <Textarea
                id="bio"
                placeholder={t("settings.profile.basicInfo.bioPlaceholder")}
                {...form.register("bio")}
                error={form.formState.errors.bio?.message}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="location">
                  {t("settings.profile.basicInfo.location")}
                </Label>
                <Input
                  id="location"
                  placeholder={t(
                    "settings.profile.basicInfo.locationPlaceholder",
                  )}
                  {...form.register("location")}
                  error={form.formState.errors.location?.message}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="city">
                  {t("settings.profile.basicInfo.city")}
                </Label>
                <Input
                  id="city"
                  placeholder={t("settings.profile.basicInfo.cityPlaceholder")}
                  {...form.register("city")}
                  error={form.formState.errors.city?.message}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="website">
                {t("settings.profile.basicInfo.website")}
              </Label>
              <Input
                id="website"
                type="url"
                placeholder={t("settings.profile.basicInfo.websitePlaceholder")}
                {...form.register("website")}
                error={form.formState.errors.website?.message}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="address">
                {t("settings.profile.basicInfo.address")}
              </Label>
              <Controller
                name="address"
                control={form.control}
                render={({ field }) => (
                  <Input
                    id="address"
                    placeholder={t(
                      "settings.profile.basicInfo.addressPlaceholder",
                    )}
                    {...field}
                    value={field.value || ""}
                    error={form.formState.errors.address?.message}
                  />
                )}
              />
            </div>

            {/* Professional Information */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="jobTitle">
                  {t("settings.profile.basicInfo.jobTitle")}
                </Label>
                <Input
                  id="jobTitle"
                  placeholder={t(
                    "settings.profile.basicInfo.jobTitlePlaceholder",
                  )}
                  {...form.register("jobTitle")}
                  error={form.formState.errors.jobTitle?.message}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="company">
                  {t("settings.profile.basicInfo.company")}
                </Label>
                <Input
                  id="company"
                  placeholder={t(
                    "settings.profile.basicInfo.companyPlaceholder",
                  )}
                  {...form.register("company")}
                  error={form.formState.errors.company?.message}
                />
              </div>
            </div>

            {/* Personal Information */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="dateOfBirth">
                  {t("settings.profile.basicInfo.dateOfBirth")}
                </Label>
                <Input
                  id="dateOfBirth"
                  type="date"
                  {...form.register("dateOfBirth")}
                  error={form.formState.errors.dateOfBirth?.message}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="gender">
                  {t("settings.profile.basicInfo.gender")}
                </Label>
                <Controller
                  name="gender"
                  control={form.control}
                  render={({ field }) => (
                    <select
                      id="gender"
                      {...field}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <option value="">
                        {t("settings.profile.basicInfo.genderSelect")}
                      </option>
                      <option value="male">
                        {t("settings.profile.basicInfo.genderMale")}
                      </option>
                      <option value="female">
                        {t("settings.profile.basicInfo.genderFemale")}
                      </option>
                      <option value="other">
                        {t("settings.profile.basicInfo.genderOther")}
                      </option>
                      <option value="prefer_not_to_say">
                        {t("settings.profile.basicInfo.genderPreferNotToSay")}
                      </option>
                    </select>
                  )}
                />
              </div>
            </div>

            <Separator />
          </CardContent>
        </Card>

        {/* Emergency Contact */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              {t("settings.profile.emergencyContact.title")}
            </CardTitle>
            <CardDescription>
              {t("settings.profile.emergencyContact.description")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="emergencyContact.name">
                  {t("settings.profile.emergencyContact.name")}
                </Label>
                <Input
                  id="emergencyContact.name"
                  placeholder={t(
                    "settings.profile.emergencyContact.namePlaceholder",
                  )}
                  {...form.register("emergencyContact.name")}
                  error={form.formState.errors.emergencyContact?.name?.message}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="emergencyContact.relationship">
                  {t("settings.profile.emergencyContact.relationship")}
                </Label>
                <Input
                  id="emergencyContact.relationship"
                  placeholder={t(
                    "settings.profile.emergencyContact.relationshipPlaceholder",
                  )}
                  {...form.register("emergencyContact.relationship")}
                  error={
                    form.formState.errors.emergencyContact?.relationship
                      ?.message
                  }
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="emergencyContact.phone">
                {t("settings.profile.emergencyContact.phone")}
              </Label>
              <Input
                id="emergencyContact.phone"
                type="tel"
                placeholder={t(
                  "settings.profile.emergencyContact.phonePlaceholder",
                )}
                {...form.register("emergencyContact.phone")}
                error={form.formState.errors.emergencyContact?.phone?.message}
              />
            </div>
          </CardContent>
        </Card>

        {/* Social Links */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              {t("settings.profile.socialLinks.title")}
            </CardTitle>
            <CardDescription>
              {t("settings.profile.socialLinks.description")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="socialLinks.linkedin">
                  {t("settings.profile.socialLinks.linkedin")}
                </Label>
                <Input
                  id="socialLinks.linkedin"
                  type="url"
                  placeholder={t(
                    "settings.profile.socialLinks.linkedinPlaceholder",
                  )}
                  {...form.register("socialLinks.linkedin")}
                  error={form.formState.errors.socialLinks?.linkedin?.message}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="socialLinks.twitter">
                  {t("settings.profile.socialLinks.twitter")}
                </Label>
                <Input
                  id="socialLinks.twitter"
                  type="url"
                  placeholder={t(
                    "settings.profile.socialLinks.twitterPlaceholder",
                  )}
                  {...form.register("socialLinks.twitter")}
                  error={form.formState.errors.socialLinks?.twitter?.message}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="socialLinks.facebook">
                  {t("settings.profile.socialLinks.facebook")}
                </Label>
                <Input
                  id="socialLinks.facebook"
                  type="url"
                  placeholder={t(
                    "settings.profile.socialLinks.facebookPlaceholder",
                  )}
                  {...form.register("socialLinks.facebook")}
                  error={form.formState.errors.socialLinks?.facebook?.message}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="socialLinks.instagram">
                  {t("settings.profile.socialLinks.instagram")}
                </Label>
                <Input
                  id="socialLinks.instagram"
                  type="url"
                  placeholder={t(
                    "settings.profile.socialLinks.instagramPlaceholder",
                  )}
                  {...form.register("socialLinks.instagram")}
                  error={form.formState.errors.socialLinks?.instagram?.message}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Form Actions */}
        <div className="flex justify-end gap-3">
          <Button
            size="sm"
            type="button"
            variant="outline"
            onClick={() => form.reset()}
            disabled={isLoading}
          >
            {t("settings.profile.actions.reset")}
          </Button>
          <Button size="sm" type="submit" disabled={isLoading}>
            {isLoading
              ? t("settings.profile.actions.saving")
              : t("settings.profile.actions.save")}
          </Button>
        </div>
      </form>

      {/* Account Information */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            {t("settings.profile.accountInfo.title")}
          </CardTitle>
          <CardDescription>
            {t("settings.profile.accountInfo.description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex items-center gap-3">
              <User className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">
                  {t("settings.profile.accountInfo.role")}
                </p>
                <Badge variant="secondary" className="mt-1">
                  {ownRoleName}
                </Badge>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">
                  {t("settings.profile.accountInfo.memberSince")}
                </p>
                <p className="text-sm text-muted-foreground">
                  {user?.createdAt
                    ? formatDisplayDate(user.createdAt)
                    : t("settings.profile.accountInfo.notAvailable")}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
