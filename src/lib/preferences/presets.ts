/**
 * PropertyPro - Appearance preset colors
 *
 * Quick-pick primary colors for the Preferences drawer. A preset simply sets
 * `branding.primaryColor`, which the SettingsProvider applies to the `--primary`
 * family of CSS variables. PropertyPro uses hex CSS variables, so presets are hex.
 */

export type PresetKey =
  | "default"
  | "cyan"
  | "purple"
  | "black"
  | "orange"
  | "red";

export interface PresetColor {
  key: PresetKey;
  name: string;
  /** Primary color applied to branding.primaryColor */
  hex: string;
}

export const PRESET_COLORS: PresetColor[] = [
  { key: "default", name: "Blue", hex: "#2563EB" },
  { key: "cyan", name: "Cyan", hex: "#06B6D4" },
  { key: "purple", name: "Purple", hex: "#7C3AED" },
  { key: "black", name: "Black", hex: "#111827" },
  { key: "orange", name: "Orange", hex: "#F59E0B" },
  { key: "red", name: "Red", hex: "#EF4444" },
];

export const DEFAULT_PRESET_HEX = PRESET_COLORS[0].hex;

/** Normalize a hex string for comparison (#abc -> #aabbcc, lowercase). */
export function normalizeHex(hex?: string): string {
  if (!hex) return "";
  let value = hex.trim().toLowerCase();
  if (/^#([0-9a-f]{3})$/.test(value)) {
    value = `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`;
  }
  return value;
}

/** Find which preset (if any) matches the given primary color. */
export function matchPreset(primaryColor?: string): PresetKey | null {
  const target = normalizeHex(primaryColor);
  const match = PRESET_COLORS.find((p) => normalizeHex(p.hex) === target);
  return match ? match.key : null;
}
