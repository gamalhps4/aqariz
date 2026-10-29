/**
 * PropertyPro - Branding hook (compatibility shim)
 *
 * Branding is now owned by the global SettingsProvider (single source of truth).
 * This module keeps the `useBranding` API stable for existing consumers
 * (display-settings, branding-section) so they read/write branding through the
 * unified provider without churn.
 */

"use client";

import { useMemo } from "react";
import {
  useSettings,
  type BrandingSettings,
} from "@/components/providers/SettingsProvider";

interface BrandingContextType {
  branding: BrandingSettings;
  updateBranding: (newBranding: Partial<BrandingSettings>) => void;
  isLoading: boolean;
}

export const useBranding = (): BrandingContextType => {
  const { settings, updateSettings, isLoading } = useSettings();

  return useMemo(
    () => ({
      branding: settings.branding,
      isLoading,
      // Branding edits here are live previews (e.g. color picker); apply in-tab
      // only. Persisted saves broadcast via updateSettings in the settings form.
      updateBranding: (newBranding: Partial<BrandingSettings>) =>
        updateSettings(
          { branding: { ...settings.branding, ...newBranding } },
          { broadcast: false },
        ),
    }),
    [settings.branding, updateSettings, isLoading],
  );
};

export type { BrandingSettings };
