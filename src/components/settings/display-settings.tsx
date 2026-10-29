"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Form } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Palette,
  Sun,
  Moon,
  Monitor,
  RotateCcw,
  Save,
  Loader2,
  AlertCircle,
  Globe2,
} from "lucide-react";
import { z } from "zod";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { BrandingSection } from "./branding-section";
import { useSettings } from "@/components/providers/SettingsProvider";
import { clearCompanyInfoCache } from "@/lib/utils/company-info";
import { APP_LANGUAGES } from "@/lib/i18n/languages";
import { APP_CURRENCY } from "@/lib/regional/region";
import { logClientError, logClientInfo, logClientWarn } from "@/utils/logger";

// Simplified schema to match the current UI and backend schema
const formDisplaySettingsSchema = z.object({
  theme: z.enum(["light", "dark", "system"]),
  language: z.string(),
  currency: z.string(),
  branding: z
    .object({
      logoLight: z.string(),
      logoDark: z.string(),
      favicon: z.string(),
      primaryColor: z.string().regex(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/),
      secondaryColor: z.string().regex(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/),
      companyName: z.string().optional(),
      companyAddress: z.string().optional(),
      commercialRegistration: z.string().optional(),
      taxNumber: z.string().optional(),
      r2: z
        .object({
          logoLight: z
            .object({
              objectKey: z.string().optional(),
              format: z.string().optional(),
              width: z.number().optional(),
              height: z.number().optional(),
              bytes: z.number().optional(),
              optimizedUrls: z.record(z.string()).optional(),
            })
            .optional(),
          logoDark: z
            .object({
              objectKey: z.string().optional(),
              format: z.string().optional(),
              width: z.number().optional(),
              height: z.number().optional(),
              bytes: z.number().optional(),
              optimizedUrls: z.record(z.string()).optional(),
            })
            .optional(),
          favicon: z
            .object({
              objectKey: z.string().optional(),
              format: z.string().optional(),
              width: z.number().optional(),
              height: z.number().optional(),
              bytes: z.number().optional(),
              optimizedUrls: z.record(z.string()).optional(),
            })
            .optional(),
        })
        .optional(),
    })
    .optional(),
});

type DisplayFormData = z.infer<typeof formDisplaySettingsSchema>;

interface DisplaySettingsProps {
  settings: any;
  onUpdate: (data: any) => void;
  onAlert: (type: "success" | "error" | "info", message: string) => void;
}

// Enhanced state management interface
interface DisplaySettingsState {
  isLoading: boolean;
  isSaving: boolean;
  hasUnsavedChanges: boolean;
  lastSaved: Date | null;
  validationErrors: Record<string, string>;
  previewMode: boolean;
  uploadProgress: number;
}

export function DisplaySettings({
  settings,
  onUpdate,
  onAlert,
}: DisplaySettingsProps) {
  // Enhanced state management
  const [state, setState] = useState<DisplaySettingsState>({
    isLoading: false,
    isSaving: false,
    hasUnsavedChanges: false,
    lastSaved: null,
    validationErrors: {},
    previewMode: false,
    uploadProgress: 0,
  });

  const { setTheme } = useTheme();
  const { updateSettings } = useSettings();
  const localization = useLocalizationContext();
  const translate = localization.t;
  const {
    currentCurrency,
    setCurrency: setLocalizationCurrency,
    t,
  } = localization;
  const lastSyncedCurrencyRef = useRef<string | null>(null);

  const languageOptions = useMemo(() => {
    // The shipped languages only (lib/i18n/languages), Arabic first.
    const allowedOrder: readonly string[] = APP_LANGUAGES;
    const map = new Map<
      string,
      { code: string; label: string; nativeLabel: string }
    >();
    // The secondary label is the language's name in the reader's language
    // ("الإنجليزية" under "English" for an Arabic reader), not always English.
    let names: Intl.DisplayNames | null = null;
    try {
      names = new Intl.DisplayNames([localization.language], { type: "language" });
    } catch {
      names = null;
    }
    for (const locale of localization.allLocales) {
      const langCode = locale.code.split("-")[0].toLowerCase();
      if (allowedOrder.includes(langCode) && !map.has(langCode)) {
        map.set(langCode, {
          code: langCode,
          label: names?.of(langCode) ?? locale.name,
          nativeLabel: locale.nativeName,
        });
      }
    }
    return allowedOrder
      .filter((code) => map.has(code))
      .map((code) => map.get(code)!);
  }, [localization.allLocales, localization.language]);

  // The app works in riyal only (lib/regional/region), so the currency is
  // shown, not chosen: its name in the reader's language ("ريال سعودي").
  const currencyName = useMemo(() => {
    try {
      return (
        new Intl.DisplayNames([localization.language], { type: "currency" }).of(
          APP_CURRENCY,
        ) ?? APP_CURRENCY
      );
    } catch {
      return APP_CURRENCY;
    }
  }, [localization.language]);

  // Update state helper
  const updateState = useCallback((updates: Partial<DisplaySettingsState>) => {
    setState((prev) => ({ ...prev, ...updates }));
  }, []);

  const form = useForm<DisplayFormData>({
    resolver: zodResolver(formDisplaySettingsSchema),
    mode: "onChange",
    defaultValues: {
      theme: (settings?.theme as "light" | "dark" | "system") || "system",
      language:
        (settings?.language as string | undefined) ||
        localization.language ||
        "en",
      currency: APP_CURRENCY,
      branding: settings?.branding
        ? {
            logoLight: settings.branding.logoLight || "/images/logo-light.png",
            logoDark: settings.branding.logoDark || "/images/logo-dark.png",
            favicon: settings.branding.favicon || "/favicon.ico",
            primaryColor: settings.branding.primaryColor || "#3B82F6",
            secondaryColor: settings.branding.secondaryColor || "#64748B",
            companyName: settings.branding.companyName || "",
            companyAddress: settings.branding.companyAddress || "",
            commercialRegistration:
              settings.branding.commercialRegistration || "",
            taxNumber: settings.branding.taxNumber || "",
            r2: settings.branding.r2 || {},
          }
        : {
            logoLight: "/images/logo-light.png",
            logoDark: "/images/logo-dark.png",
            favicon: "/favicon.ico",
            primaryColor: "#3B82F6",
            secondaryColor: "#64748B",
            companyName: "",
            companyAddress: "",
            commercialRegistration: "",
            taxNumber: "",
            r2: {},
          },
    },
  });

  const watchedValues = form.watch();

  useEffect(() => {
    const settingsCurrency = settings?.currency;
    if (!settingsCurrency) return;

    if (lastSyncedCurrencyRef.current === settingsCurrency) {
      return;
    }

    lastSyncedCurrencyRef.current = settingsCurrency;

    if (settingsCurrency !== currentCurrency) {
      setLocalizationCurrency(settingsCurrency);
    }
  }, [settings?.currency, currentCurrency, setLocalizationCurrency]);

  useEffect(() => {
    const activeCurrency = currentCurrency;
    if (!activeCurrency) return;

    if (form.getValues("currency") !== activeCurrency) {
      form.setValue("currency", activeCurrency, {
        shouldDirty: false,
        shouldValidate: false,
        shouldTouch: false,
      });
    }
  }, [currentCurrency, form]);

  // Enhanced form submission with better error handling and state management
  const onSubmit = useCallback(
    async (data: DisplayFormData) => {
      logClientInfo("Display settings submission started", data);
      try {
        updateState({ isSaving: true, validationErrors: {} });

        // Validate data before submission
        const validation = formDisplaySettingsSchema.safeParse(data);
        if (!validation.success) {
          const errors: Record<string, string> = {};
          validation.error.errors.forEach((error) => {
            if (error.path.length > 0) {
              errors[error.path.join(".")] = error.message;
            }
          });
          updateState({ validationErrors: errors });
          onAlert(
            "error",
            translate("settings.display.fixErrors", {
              defaultValue: "Fix the highlighted fields before saving",
            }),
          );
          return;
        }

        // Update theme immediately for better UX
        setTheme(data.theme);

        logClientInfo("Sending display settings update request");
        const response = await fetch("/api/settings/display", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(data),
        });

        logClientInfo("Display settings response status", response.status);

        if (!response.ok) {
          const errorData = await response.json();
          logClientError("Display settings API error:", errorData);
          throw new Error(
            errorData?.error || "Failed to update display settings",
          );
        }

        const result = await response.json();
        logClientInfo("Display settings API success:", result);

        const updatedSettings =
          result?.data?.settings ?? result?.settings ?? result?.data;

        // Update state and notify parent - but don't cause form reload
        updateState({
          hasUnsavedChanges: false,
          lastSaved: new Date(),
          validationErrors: {},
        });

        // Reset the form with server-confirmed values so UI reflects DB data
        if (updatedSettings) {
          try {
            form.reset(updatedSettings as any);
          } catch (resetErr) {
            logClientWarn(
              "Form reset failed; continuing with local state",
              resetErr,
            );
          }

          // Push fresh settings to the global SettingsProvider: applies branding
          // colors/logo/favicon, currency and language instantly in this tab and
          // broadcasts to other open tabs.
          updateSettings(updatedSettings);

          // Branding (company name/logo) may have changed: drop the cached
          // company info so invoice/receipt previews refetch fresh values
          // instead of serving up-to-5-min-stale data.
          clearCompanyInfoCache();

          // Notify parent with fresh display settings only
          logClientInfo("Triggering display settings parent update");
          onUpdate(updatedSettings);
        }

        onAlert(
          "success",
          translate("settings.display.saved", {
            defaultValue: "Display settings saved",
          }),
        );
      } catch (error) {
        logClientError("Display settings update error:", error);
        onAlert(
          "error",
          error instanceof Error
            ? error.message
            : translate("errors.ui.saveFailed", {
                defaultValue: "Could not save. Try again.",
              }),
        );
      } finally {
        updateState({ isSaving: false });
      }
    },
    [updateState, setTheme, onUpdate, onAlert, updateSettings, translate, form],
  );

  // Track form changes for unsaved changes detection
  useEffect(() => {
    const subscription = form.watch((_, { name, type }) => {
      if (type === "change" && name) {
        updateState({ hasUnsavedChanges: true });
      }
    });
    return () => subscription.unsubscribe();
  }, [form, updateState]);

  // Disable auto-save to prevent unwanted form reloads
  // Auto-save functionality is disabled to prevent form reload issues
  // Users must manually save their changes using the Save button

  // No longer need to fetch system settings for branding - it's now part of display settings

  const handleThemeChange = (newTheme: "light" | "dark" | "system") => {
    form.setValue("theme", newTheme, {
      shouldValidate: false,
      shouldDirty: true,
      shouldTouch: false,
    });
    setTheme(newTheme);
    updateState({ hasUnsavedChanges: true });
  };

  const getThemeIcon = (themeValue: string) => {
    switch (themeValue) {
      case "light":
        return <Sun className="h-4 w-4" />;
      case "dark":
        return <Moon className="h-4 w-4" />;
      default:
        return <Monitor className="h-4 w-4" />;
    }
  };

  return (
    <Form {...form}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          form.handleSubmit(onSubmit)(e);
        }}
        className="space-y-6"
      >
        {/* 1. Identity — Branding & Logos (with Company Info) */}
        <BrandingSection
          form={form}
          onAlert={onAlert}
          disabled={state.isSaving}
          onFormChange={() => updateState({ hasUnsavedChanges: true })}
        />

        {/* 2. Regional — Language & Currency grouped under one card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Globe2 className="h-5 w-5" />
              {t("settings.display.localization.title")}
            </CardTitle>
            <CardDescription>
              {t("settings.display.localization.description")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Language */}
            <div className="space-y-2">
              <Label htmlFor="language">
                {t("settings.display.language.label")}
              </Label>
              <Select
                value={form.watch("language")}
                onValueChange={(value) => {
                  form.setValue("language", value, {
                    shouldValidate: false,
                    shouldDirty: true,
                    shouldTouch: false,
                  });

                  const selectedLocale = localization.allLocales.find(
                    (locale) =>
                      locale.code.toLowerCase() === value.toLowerCase() ||
                      locale.code
                        .toLowerCase()
                        .startsWith(`${value.toLowerCase()}-`),
                  );

                  if (selectedLocale) {
                    localization.setLocale(selectedLocale.code);
                  }

                  updateState({ hasUnsavedChanges: true });
                }}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={t("settings.display.language.placeholder")}
                  />
                </SelectTrigger>
                <SelectContent className="max-h-60">
                  {languageOptions.map((option) => (
                    <SelectItem key={option.code} value={option.code}>
                      <div className="flex flex-col items-start">
                        <span className="font-medium">{option.nativeLabel}</span>
                        {option.nativeLabel !== option.label && (
                          <span className="text-xs text-muted-foreground">
                            {option.label}
                          </span>
                        )}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {t("settings.display.language.helper")}
              </p>
            </div>

            <div className="border-t border-border" />

            {/* Currency */}
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="currency">
                  {t("settings.display.currency.label")}
                </Label>
                <div
                  id="currency"
                  className="flex h-10 items-center gap-2 rounded-md border border-input bg-muted/50 px-3 text-sm"
                >
                  <span className="font-medium">{currencyName}</span>
                  <span className="text-muted-foreground" dir="ltr">
                    ({APP_CURRENCY})
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("settings.display.currency.fixedNote")}
                </p>
              </div>

              {/* Currency Preview */}
              <div className="p-4 bg-muted rounded-lg">
                <div className="text-sm text-muted-foreground mb-2">
                  {t("settings.display.currency.previewLabel")}
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm">
                      {t("settings.display.currency.preview.rent")}
                    </span>
                    <span className="font-medium">
                      {localization.formatCurrency(1500)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm">
                      {t("settings.display.currency.preview.deposit")}
                    </span>
                    <span className="font-medium">
                      {localization.formatCurrency(3000)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm">
                      {t("settings.display.currency.preview.maintenance")}
                    </span>
                    <span className="font-medium">
                      {localization.formatCurrency(250)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Currency Info */}
              {localization.currency && (
                <div className="p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg border border-blue-200 dark:border-blue-800">
                  <div className="text-sm">
                    <div className="font-medium text-blue-900 dark:text-blue-100 mb-1">
                      {t("settings.display.currency.details.title")}
                    </div>
                    <div className="text-blue-700 dark:text-blue-300 space-y-1">
                      <div>
                        {t("settings.display.currency.details.symbol")}{" "}
                        <span className="font-mono">
                          {localization.currency.symbol}
                        </span>
                      </div>
                      <div>
                        {t("settings.display.currency.details.decimals")}{" "}
                        {localization.currency.decimals}
                      </div>
                      <div>
                        {t("settings.display.currency.details.position")}{" "}
                        {localization.currency.symbolPosition === "before"
                          ? t("settings.display.currency.details.before")
                          : t("settings.display.currency.details.after")}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* 3. Interface — Theme preference */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Palette className="h-5 w-5" />
              {t("settings.display.theme.title")}
            </CardTitle>
            <CardDescription>
              {t("settings.display.theme.description")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <Label>{t("settings.display.theme.label")}</Label>
              <div className="grid grid-cols-3 gap-3">
                {["light", "dark", "system"].map((themeOption) => (
                  <button
                    key={themeOption}
                    type="button"
                    onClick={() =>
                      handleThemeChange(
                        themeOption as "light" | "dark" | "system",
                      )
                    }
                    className={`flex items-center gap-2 p-3 rounded-lg border transition-colors ${
                      watchedValues.theme === themeOption
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-accent"
                    }`}
                  >
                    {getThemeIcon(themeOption)}
                    <span className="capitalize">{themeOption}</span>
                    {watchedValues.theme === themeOption && (
                      <Badge variant="secondary" className="ms-auto text-xs">
                        {t("settings.display.theme.badgeActive")}
                      </Badge>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Save Button with Enhanced State */}
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-4">
            {state.hasUnsavedChanges && (
              <Badge variant="outline" className="text-orange-600">
                <AlertCircle className="h-3 w-3 me-1" />
                {t("settings.display.footer.unsavedChanges")}
              </Badge>
            )}
            {state.lastSaved && (
              <span className="text-sm text-muted-foreground">
                {t("settings.display.footer.lastSaved")}{" "}
                {state.lastSaved.toLocaleTimeString()}
              </span>
            )}
          </div>

          <div className="flex gap-2">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      form.reset();
                      updateState({ hasUnsavedChanges: false });
                    }}
                    disabled={state.isSaving || !state.hasUnsavedChanges}
                  >
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {t("settings.display.footer.resetTooltip")}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <Button
              type="submit"
              size="sm"
              disabled={state.isSaving || !state.hasUnsavedChanges}
              className="min-w-[140px]"
            >
              {state.isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 me-2 animate-spin" />
                  {t("common.saving")}
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 me-2" />
                  {t("settings.display.footer.saveButton")}
                </>
              )}
            </Button>
          </div>
        </div>
      </form>
    </Form>
  );
}
