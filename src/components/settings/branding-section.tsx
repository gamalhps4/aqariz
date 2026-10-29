"use client";

import { useState } from "react";
import { UseFormReturn } from "react-hook-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { LogoUpload } from "./logo-upload";
import {
  Image as ImageIcon,
  RotateCcw,
  Palette,
  Info,
  Building2,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { isR2Url } from "@/lib/r2";
import {
  useBranding,
  type BrandingSettings,
} from "@/components/providers/BrandingProvider";
import { logClientError, logClientWarn } from "@/utils/logger";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

interface BrandingSectionProps {
  form: UseFormReturn<any>;
  onAlert: (type: "success" | "error" | "info", message: string) => void;
  disabled?: boolean;
  onFormChange?: () => void;
}

export function BrandingSection({
  form,
  onAlert,
  disabled = false,
  onFormChange,
}: BrandingSectionProps) {
  const [useDialog, setUseDialog] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const { updateBranding } = useBranding();
  const { t } = useLocalizationContext();

  // Handle logo upload
  const handleLogoUpload = async (
    variant: "logoLight" | "logoDark",
    result: {
      url: string;
      publicId?: string;
      objectKey?: string;
      metadata?: any;
      optimizedUrls?: Record<string, string>;
    },
  ) => {
    try {
      // Update the URL without triggering form reload
      form.setValue(`branding.${variant}`, result.url, {
        shouldValidate: false,
        shouldDirty: true,
        shouldTouch: false,
      });

      // Update R2 metadata if available
      if (result.objectKey) {
        form.setValue(
          `branding.r2.${variant}`,
          {
            objectKey: result.objectKey,
            format: result.metadata?.format,
            width: result.metadata?.width,
            height: result.metadata?.height,
            bytes: result.metadata?.bytes,
            optimizedUrls: result.optimizedUrls || {},
          },
          {
            shouldValidate: false,
            shouldDirty: true,
            shouldTouch: false,
          },
        );
      }

      // Live in-tab preview (sidebar logo) before the change is saved
      updateBranding({ [variant]: result.url } as Partial<BrandingSettings>);

      // Mark form as having unsaved changes without triggering validation
      onFormChange?.();

      onAlert(
        "success",
        variant === "logoLight"
          ? t("settings.display.branding.toast.lightLogoUploaded")
          : t("settings.display.branding.toast.darkLogoUploaded"),
      );
    } catch (error) {
      logClientError("Logo upload error:", error);
      onAlert("error", t("settings.display.branding.toast.uploadFailed"));
    }
  };

  // Handle logo removal
  const handleLogoRemove = async (variant: "logoLight" | "logoDark") => {
    try {
      const currentUrl = form.getValues(`branding.${variant}`);
      const currentR2Data = form.getValues(`branding.r2.${variant}`);

      // If it's an R2 URL, attempt to delete from R2
      if (isR2Url(currentUrl) && currentR2Data?.objectKey) {
        try {
          const response = await fetch(
            `/api/upload/branding?objectKey=${encodeURIComponent(
              currentR2Data.objectKey,
            )}`,
            { method: "DELETE" },
          );

          if (!response.ok) {
            logClientWarn(
              "Failed to delete from R2, continuing with local removal",
            );
          }
        } catch (error) {
          logClientWarn("R2 deletion failed:", error);
        }
      }

      // Reset to default
      const defaultUrls = {
        logoLight: "/images/logo-light.png",
        logoDark: "/images/logo-dark.png",
      };

      form.setValue(`branding.${variant}`, defaultUrls[variant]);
      form.setValue(`branding.r2.${variant}`, undefined);

      // Live in-tab preview of the reverted asset before saving
      updateBranding({
        [variant]: defaultUrls[variant],
      } as Partial<BrandingSettings>);

      // Mark form as having unsaved changes
      form.trigger();

      onAlert(
        "success",
        variant === "logoLight"
          ? t("settings.display.branding.toast.lightLogoRemoved")
          : t("settings.display.branding.toast.darkLogoRemoved"),
      );
    } catch (error) {
      logClientError("Logo removal error:", error);
      onAlert("error", t("settings.display.branding.toast.removeFailed"));
    }
  };

  // Reset all branding to defaults
  const handleResetBranding = async () => {
    setIsResetting(true);
    try {
      const currentBranding = form.getValues("branding");

      // Attempt to delete R2 assets
      const deletionPromises = [];

      if (currentBranding?.r2?.logoLight?.objectKey) {
        deletionPromises.push(
          fetch(
            `/api/upload/branding?objectKey=${encodeURIComponent(
              currentBranding.r2.logoLight.objectKey,
            )}`,
            {
              method: "DELETE",
            },
          ).catch((error) =>
            logClientWarn("Logo light deletion failed:", error),
          ),
        );
      }

      if (currentBranding?.r2?.logoDark?.objectKey) {
        deletionPromises.push(
          fetch(
            `/api/upload/branding?objectKey=${encodeURIComponent(
              currentBranding.r2.logoDark.objectKey,
            )}`,
            {
              method: "DELETE",
            },
          ).catch((error) =>
            logClientWarn("Logo dark deletion failed:", error),
          ),
        );
      }

      if (currentBranding?.r2?.favicon?.objectKey) {
        deletionPromises.push(
          fetch(
            `/api/upload/branding?objectKey=${encodeURIComponent(
              currentBranding.r2.favicon.objectKey,
            )}`,
            {
              method: "DELETE",
            },
          ).catch((error) => logClientWarn("Favicon deletion failed:", error)),
        );
      }

      // Wait for deletions (but don't fail if they don't work)
      await Promise.allSettled(deletionPromises);

      // Reset to defaults
      form.setValue("branding", {
        logoLight: "/images/logo-light.png",
        logoDark: "/images/logo-dark.png",
        favicon: "/favicon.ico",
        primaryColor: "#3B82F6",
        secondaryColor: "#64748B",
        companyName: "",
        commercialRegistration: "",
        taxNumber: "",
        companyAddress: "",
        r2: {},
      });

      // Live in-tab preview of the reset before saving
      updateBranding({
        logoLight: "/images/logo-light.png",
        logoDark: "/images/logo-dark.png",
        favicon: "/favicon.ico",
        primaryColor: "#3B82F6",
        secondaryColor: "#64748B",
      });

      // Mark form as having unsaved changes
      form.trigger();

      onAlert("success", t("settings.display.branding.toast.resetSuccess"));
    } catch (error) {
      logClientError("Reset branding error:", error);
      onAlert("error", t("settings.display.branding.toast.resetFailed"));
    } finally {
      setIsResetting(false);
    }
  };

  // Handle color changes with immediate branding update
  const handleColorChange = (
    colorType: "primaryColor" | "secondaryColor",
    value: string,
  ) => {
    // Update form
    form.setValue(`branding.${colorType}`, value, {
      shouldValidate: true,
      shouldDirty: true,
      shouldTouch: true,
    });

    // Immediately update branding context for real-time preview
    updateBranding({
      [colorType]: value,
    });

    // Mark form as having unsaved changes
    onFormChange?.();
  };

  // Get current values for previews
  const logoLight = form.watch("branding.logoLight");
  const logoDark = form.watch("branding.logoDark");
  const primaryColor = form.watch("branding.primaryColor");
  const secondaryColor = form.watch("branding.secondaryColor");
  const companyName = form.watch("branding.companyName");
  const companyAddress = form.watch("branding.companyAddress");

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <ImageIcon className="h-5 w-5" />
              {t("settings.display.branding.title")}
              <div className="flex items-center gap-3">
                <label className="text-xs text-muted-foreground">
                  {t("settings.display.branding.dialogToggle")}
                </label>
                <Switch
                  checked={useDialog}
                  onCheckedChange={setUseDialog}
                  disabled={disabled}
                />
              </div>
            </CardTitle>
            <CardDescription>
              {t("settings.display.branding.description")}
            </CardDescription>
          </div>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={disabled || isResetting}
                    >
                      <RotateCcw className="h-4 w-4 me-2" />
                      {t("settings.display.branding.resetButton")}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        {t("settings.display.branding.resetDialog.title")}
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        {t("settings.display.branding.resetDialog.description")}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>
                        {t("settings.display.branding.resetDialog.cancel")}
                      </AlertDialogCancel>
                      <AlertDialogAction onClick={handleResetBranding}>
                        {t("settings.display.branding.resetDialog.confirm")}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </TooltipTrigger>
              <TooltipContent>
                <p>{t("settings.display.branding.resetTooltip")}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Logo Upload Section. No browser icon: that is the platform's,
            set in the Super Admin console — offices do not choose it. */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Light Theme Logo */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium">
                {t("settings.display.branding.lightLogo.label")}
              </label>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger>
                    <Info className="h-3 w-3 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{t("settings.display.branding.lightLogo.tooltip")}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <LogoUpload
              type="logo"
              variant="light"
              currentUrl={logoLight}
              onUpload={(result) => handleLogoUpload("logoLight", result)}
              onRemove={() => handleLogoRemove("logoLight")}
              onError={(error) => onAlert("error", error)}
              disabled={disabled}
              openInDialog={useDialog}
              dialogTitle={t("settings.display.branding.lightLogo.dialogTitle")}
            />
          </div>

          {/* Dark Theme Logo */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium">
                {t("settings.display.branding.darkLogo.label")}
              </label>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger>
                    <Info className="h-3 w-3 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{t("settings.display.branding.darkLogo.tooltip")}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <LogoUpload
              type="logo"
              variant="dark"
              currentUrl={logoDark}
              onUpload={(result) => handleLogoUpload("logoDark", result)}
              onRemove={() => handleLogoRemove("logoDark")}
              onError={(error) => onAlert("error", error)}
              disabled={disabled}
              openInDialog={useDialog}
              dialogTitle={t("settings.display.branding.darkLogo.dialogTitle")}
            />
          </div>

        </div>

        {/* Brand Colors */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Palette className="h-4 w-4" />
            <h3 className="text-sm font-medium">
              {t("settings.display.branding.colors.title")}
            </h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <FormField
              control={form.control}
              name="branding.primaryColor"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t("settings.display.branding.colors.primary")}
                  </FormLabel>
                  <div className="flex items-center gap-3">
                    <div
                      className="w-12 h-10 rounded border border-gray-300 cursor-pointer"
                      style={{ backgroundColor: field.value }}
                      onClick={() => {
                        const input = document.getElementById(
                          "primary-color-picker",
                        ) as HTMLInputElement;
                        input?.click();
                      }}
                    />
                    <input
                      id="primary-color-picker"
                      type="color"
                      value={field.value}
                      onChange={(e) =>
                        handleColorChange("primaryColor", e.target.value)
                      }
                      className="sr-only"
                      disabled={disabled}
                    />
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="#3B82F6"
                        className="font-mono"
                        disabled={disabled}
                        onChange={(e) =>
                          handleColorChange("primaryColor", e.target.value)
                        }
                      />
                    </FormControl>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="branding.secondaryColor"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t("settings.display.branding.colors.secondary")}
                  </FormLabel>
                  <div className="flex items-center gap-3">
                    <div
                      className="w-12 h-10 rounded border border-gray-300 cursor-pointer"
                      style={{ backgroundColor: field.value }}
                      onClick={() => {
                        const input = document.getElementById(
                          "secondary-color-picker",
                        ) as HTMLInputElement;
                        input?.click();
                      }}
                    />
                    <input
                      id="secondary-color-picker"
                      type="color"
                      value={field.value}
                      onChange={(e) =>
                        handleColorChange("secondaryColor", e.target.value)
                      }
                      className="sr-only"
                      disabled={disabled}
                    />
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="#64748B"
                        className="font-mono"
                        disabled={disabled}
                        onChange={(e) =>
                          handleColorChange("secondaryColor", e.target.value)
                        }
                      />
                    </FormControl>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>

        {/* Color Preview */}
        <div className="p-4 rounded-lg bg-gradient-to-r from-gray-50 to-gray-100 dark:from-gray-800 dark:to-gray-900 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_6px_18px_rgba(15,23,42,0.025)] dark:shadow-none">
          <h4 className="text-sm font-medium mb-3">
            {t("settings.display.branding.colors.previewTitle")}
          </h4>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div
                className="w-6 h-6 rounded"
                style={{ backgroundColor: primaryColor }}
              />
              <span className="text-sm">
                {t("settings.display.branding.colors.previewPrimary")}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div
                className="w-6 h-6 rounded"
                style={{ backgroundColor: secondaryColor }}
              />
              <span className="text-sm">
                {t("settings.display.branding.colors.previewSecondary")}
              </span>
            </div>
          </div>
        </div>

        {/* Company Information */}
        <div className="space-y-4 pt-4 border-t">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            <h3 className="text-sm font-medium">
              {t("settings.display.branding.company.title")}
            </h3>
          </div>
          <p className="text-sm text-muted-foreground">
            {t("settings.display.branding.company.description")}
          </p>

          <div className="space-y-4">
            <FormField
              control={form.control}
              name="branding.companyName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t("settings.display.branding.company.nameLabel")}
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder={t(
                        "settings.display.branding.company.namePlaceholder",
                      )}
                      disabled={disabled}
                      onChange={(e) => {
                        field.onChange(e);
                        onFormChange?.();
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Printed above every exported statement PDF — the details that
                make an owner's statement a business record rather than a
                spreadsheet. See lib/reports/letterhead.ts. */}
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="branding.commercialRegistration"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t("settings.display.branding.company.crLabel", {
                        defaultValue: "Commercial registration",
                      })}
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="1009034239"
                        disabled={disabled}
                        onChange={(e) => {
                          field.onChange(e);
                          onFormChange?.();
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="branding.taxNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t("settings.display.branding.company.vatLabel", {
                        defaultValue: "VAT number",
                      })}
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="300000000000003"
                        disabled={disabled}
                        onChange={(e) => {
                          field.onChange(e);
                          onFormChange?.();
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="branding.companyAddress"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t("settings.display.branding.company.addressLabel")}
                  </FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      placeholder={t(
                        "settings.display.branding.company.addressPlaceholder",
                      )}
                      disabled={disabled}
                      rows={3}
                      onChange={(e) => {
                        field.onChange(e);
                        onFormChange?.();
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          {/* Company Info Preview */}
          {(companyName || companyAddress) && (
            <div className="p-4 bg-muted rounded-lg">
              <div className="text-sm text-muted-foreground mb-2">
                {t("settings.display.branding.company.invoicePreview")}
              </div>
              <div className="space-y-1">
                {companyName && (
                  <div className="font-semibold text-base">{companyName}</div>
                )}
                {companyAddress && (
                  <div className="text-sm whitespace-pre-line">
                    {companyAddress}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
