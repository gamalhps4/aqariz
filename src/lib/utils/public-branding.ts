/**
 * PropertyPro - Public Branding (server-side)
 *
 * Resolves the admin's branding (logo, favicon, colors, company name) WITHOUT
 * authentication. Shared by the public branding API and the PWA manifest so the
 * install name/icon and login page all read from a single source.
 */

import { cache } from "react";
import { db } from "@/lib/db/prisma";
import { resolveGlobalDisplayOwnerId } from "@/lib/utils/global-display-owner";
import { getPlatformSettings } from "@/lib/platform/settings";

export interface PublicBranding {
  logoLight: string;
  logoDark: string;
  favicon: string;
  primaryColor: string;
  secondaryColor: string;
  companyName: string;
}

export const DEFAULT_PUBLIC_BRANDING: PublicBranding = {
  logoLight: "/images/logo-light.png",
  logoDark: "/images/logo-dark.png",
  favicon: "/favicon.ico",
  primaryColor: "#3B82F6",
  secondaryColor: "#64748B",
  companyName: "PropertyPro",
};

/**
 * What the platform's own settings say (Super Admin → Settings): the site
 * name, logos and favicon the console sets. The fallback under an office's
 * branding, and the whole branding where there is no office — the marketing
 * site, sign-in, the console. Before, those fell to the hard-coded
 * "PropertyPro" and /favicon.ico, so saving them in the console changed
 * nothing anyone saw.
 */
async function platformBranding(): Promise<PublicBranding> {
  try {
    const { general } = await getPlatformSettings();
    return {
      ...DEFAULT_PUBLIC_BRANDING,
      logoLight: general.logoLight || DEFAULT_PUBLIC_BRANDING.logoLight,
      logoDark: general.logoDark || DEFAULT_PUBLIC_BRANDING.logoDark,
      favicon: general.favicon || DEFAULT_PUBLIC_BRANDING.favicon,
      companyName: general.platformName?.trim() || DEFAULT_PUBLIC_BRANDING.companyName,
    };
  } catch {
    return DEFAULT_PUBLIC_BRANDING;
  }
}

/**
 * Get the public branding for the request: the office's own (its oldest
 * active admin's display settings) where the request belongs to an office,
 * each field it left empty taken from the platform's settings; the
 * platform's alone everywhere else. Always resolves, so callers (metadata,
 * manifest, login page) never throw.
 *
 * Wrapped in React `cache` so the multiple per-request callers (layout
 * metadata + viewport, manifest) share a single DB read.
 */
export const getPublicBranding = cache(async (): Promise<PublicBranding> => {
  const platform = await platformBranding();
  try {
    // Resolve the organization's branding owner (oldest active admin, custom
    // admin roles included) so the login page, PWA manifest, favicon and the
    // in-app UI all read the exact same branding document.
    const ownerId = await resolveGlobalDisplayOwnerId();
    if (!ownerId) return platform;

    const displaySettings = await db.displaySettings.findFirst({
      where: { userId: ownerId, isActive: true },
    });

    const branding = displaySettings?.branding as
      | Record<string, string | undefined>
      | null
      | undefined;
    if (!branding) return platform;

    // The appearance form saves its defaults with everything else
    // ("/favicon.ico", "PropertyPro"), so a value equal to the default is
    // one the office never chose, and the platform's shows through.
    const own = (field: keyof PublicBranding) => {
      const value = branding[field]?.trim();
      return value && value !== DEFAULT_PUBLIC_BRANDING[field] ? value : "";
    };
    return {
      logoLight: own("logoLight") || platform.logoLight,
      logoDark: own("logoDark") || platform.logoDark,
      // Always the platform's: offices do not choose the browser icon (the
      // client's call), and one an office saved earlier is ignored.
      favicon: platform.favicon,
      primaryColor: branding.primaryColor || platform.primaryColor,
      secondaryColor: branding.secondaryColor || platform.secondaryColor,
      companyName: own("companyName") || platform.companyName,
    };
  } catch (error) {
    console.error("getPublicBranding error:", error);
    return platform;
  }
});
