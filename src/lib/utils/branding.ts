/**
 * PropertyPro - Branding color utilities
 * Shared helpers for applying dynamic branding colors as CSS variables.
 * Extracted from the former BrandingProvider so the global SettingsProvider
 * stays lean and the logic is reusable/testable.
 */

export interface BrandingColors {
  primaryColor: string;
  secondaryColor: string;
}

/** Convert a hex color (#RRGGBB) to an "r, g, b" string. Falls back to default blue. */
export function hexToRgb(hex: string): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (result) {
    const r = parseInt(result[1], 16);
    const g = parseInt(result[2], 16);
    const b = parseInt(result[3], 16);
    return `${r}, ${g}, ${b}`;
  }
  return "59, 130, 246"; // Default blue
}

/** Convert a hex color (#RRGGBB) to HSL components, or null if it can't be parsed. */
export function hexToHsl(
  hex: string,
): { h: number; s: number; l: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return null;

  const r = parseInt(result[1], 16) / 255;
  const g = parseInt(result[2], 16) / 255;
  const b = parseInt(result[3], 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

/**
 * Apply branding colors to the document root as CSS custom properties.
 * Safe to call on the client only; no-ops when document is unavailable.
 */
export function applyBrandingCssVariables(branding: BrandingColors): void {
  if (typeof document === "undefined") return;

  const root = document.documentElement;

  // Primary color + its rgb form
  root.style.setProperty("--primary", branding.primaryColor);
  root.style.setProperty("--primary-rgb", hexToRgb(branding.primaryColor));

  // Lighter / darker variations derived from HSL
  const hsl = hexToHsl(branding.primaryColor);
  if (hsl) {
    root.style.setProperty(
      "--primary-light",
      `hsl(${hsl.h}, ${hsl.s}%, ${Math.min(hsl.l + 10, 95)}%)`,
    );
    root.style.setProperty(
      "--primary-dark",
      `hsl(${hsl.h}, ${hsl.s}%, ${Math.max(hsl.l - 10, 5)}%)`,
    );
    root.style.setProperty("--sidebar-primary", branding.primaryColor);
    root.style.setProperty("--ring", branding.primaryColor);
    root.style.setProperty("--chart-1", branding.primaryColor);
  }

  // Secondary brand color
  root.style.setProperty("--secondary-brand", branding.secondaryColor);
}
