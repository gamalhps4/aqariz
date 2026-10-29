/**
 * PropertyPro - Formatting Utilities
 * Centralized formatting functions with localization support
 */

import { localizationService } from "@/lib/services/localization.service";

// ============================================================================
// CURRENCY FORMATTING
// ============================================================================

export function formatCurrency(
  amount: number = 0,
  currencyCode?: string,
  options?: {
    showSymbol?: boolean;
    showCode?: boolean;
    minimumFractionDigits?: number;
    maximumFractionDigits?: number;
  }
): string {
  return localizationService.formatCurrency(amount, currencyCode, options);
}

export function formatCurrencyCompact(
  amount: number,
  currencyCode?: string
): string {
  if (amount >= 1000000) {
    return (
      formatCurrency(amount / 1000000, currencyCode, {
        maximumFractionDigits: 1,
      }) + "M"
    );
  }
  if (amount >= 1000) {
    return (
      formatCurrency(amount / 1000, currencyCode, {
        maximumFractionDigits: 1,
      }) + "K"
    );
  }
  return formatCurrency(amount, currencyCode);
}

export function formatCurrencyRange(
  minAmount: number,
  maxAmount: number,
  currencyCode?: string
): string {
  return `${formatCurrency(minAmount, currencyCode)} - ${formatCurrency(
    maxAmount,
    currencyCode
  )}`;
}

// ============================================================================
// DATE & TIME FORMATTING
// ============================================================================

export function formatDate(
  date: Date | string,
  options?: {
    format?: "short" | "medium" | "long" | "full";
    localeCode?: string;
  }
): string {
  return localizationService.formatDate(date, options);
}

export function formatTime(
  date: Date | string,
  options?: {
    format?: "12h" | "24h";
    showSeconds?: boolean;
    localeCode?: string;
  }
): string {
  return localizationService.formatTime(date, options);
}

/**
 * A date for the screen, in the language the app is shown in — "1 Sept 2026",
 * "١ سبتمبر ٢٠٢٦" — or "—" when there is none. `toLocaleDateString()` with no
 * locale follows the browser instead of the office's setting, so an English
 * browser showed a Saudi office "9/1/2026", which reads as 9 January. Unlike
 * `formatDate`, a missing or invalid value never throws.
 */
export function formatDisplayDate(
  value: Date | string | number | null | undefined,
): string {
  if (value === null || value === undefined || value === "") return "—";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : localizationService.formatDate(date);
}

/** `formatDisplayDate` with the time of day. */
export function formatDisplayDateTime(
  value: Date | string | number | null | undefined,
): string {
  if (value === null || value === undefined || value === "") return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return `${localizationService.formatDate(date)} ${localizationService.formatTime(date)}`;
}

export function formatDateTime(
  date: Date | string,
  options?: {
    dateFormat?: "short" | "medium" | "long" | "full";
    timeFormat?: "12h" | "24h";
    showSeconds?: boolean;
    localeCode?: string;
  }
): string {
  const {
    dateFormat = "medium",
    timeFormat,
    showSeconds = false,
    localeCode,
  } = options || {};

  const formattedDate = formatDate(date, { format: dateFormat, localeCode });
  const formattedTime = formatTime(date, {
    format: timeFormat,
    showSeconds,
    localeCode,
  });

  return `${formattedDate} ${formattedTime}`;
}

export function formatRelativeTime(date: Date | string): string {
  const now = new Date();
  const targetDate = typeof date === "string" ? new Date(date) : date;
  const diffInMs = now.getTime() - targetDate.getTime();
  const diffInMinutes = Math.floor(diffInMs / (1000 * 60));
  const diffInHours = Math.floor(diffInMinutes / 60);
  const diffInDays = Math.floor(diffInHours / 24);

  if (diffInMinutes < 1) return "Just now";
  if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
  if (diffInHours < 24) return `${diffInHours}h ago`;
  if (diffInDays < 7) return `${diffInDays}d ago`;
  if (diffInDays < 30) return `${Math.floor(diffInDays / 7)}w ago`;
  if (diffInDays < 365) return `${Math.floor(diffInDays / 30)}mo ago`;
  return `${Math.floor(diffInDays / 365)}y ago`;
}

export function formatDateRange(
  startDate: Date | string,
  endDate: Date | string,
  options?: {
    format?: "short" | "medium" | "long" | "full";
    localeCode?: string;
  }
): string {
  const start = formatDate(startDate, options);
  const end = formatDate(endDate, options);
  return `${start} - ${end}`;
}

// ============================================================================
// NUMBER FORMATTING
// ============================================================================

export function formatNumber(
  number: number,
  options?: {
    minimumFractionDigits?: number;
    maximumFractionDigits?: number;
    localeCode?: string;
  }
): string {
  return localizationService.formatNumber(number, options);
}

export function formatPercentage(
  value: number,
  options?: {
    minimumFractionDigits?: number;
    maximumFractionDigits?: number;
    localeCode?: string;
  }
): string {
  return localizationService.formatPercentage(value, options);
}

export function formatFileSize(bytes: number): string {
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  if (bytes === 0) return "0 Bytes";

  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = bytes / Math.pow(1024, i);

  return `${formatNumber(size, { maximumFractionDigits: 1 })} ${sizes[i]}`;
}

export function formatPhoneNumber(
  phoneNumber: string,
  countryCode?: string
): string {
  // Remove all non-digit characters
  const cleaned = phoneNumber.replace(/\D/g, "");

  // Default to US format
  if (!countryCode || countryCode === "US") {
    if (cleaned.length === 10) {
      return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(
        6
      )}`;
    }
    if (cleaned.length === 11 && cleaned[0] === "1") {
      return `+1 (${cleaned.slice(1, 4)}) ${cleaned.slice(
        4,
        7
      )}-${cleaned.slice(7)}`;
    }
  }

  // For other countries, return as-is with country code if available
  return phoneNumber;
}

// ============================================================================
// PROPERTY-SPECIFIC FORMATTING
// ============================================================================

export function formatArea(
  area: number,
  unit: "sqft" | "sqm" = "sqft"
): string {
  const formattedArea = formatNumber(area, { maximumFractionDigits: 0 });
  return `${formattedArea} ${unit}`;
}

export function formatRentPerSqft(
  rent: number,
  area: number,
  currencyCode?: string
): string {
  const pricePerSqft = rent / area;
  return `${formatCurrency(pricePerSqft, currencyCode, {
    maximumFractionDigits: 2,
  })}/sqft`;
}

export function formatOccupancyRate(occupied: number, total: number): string {
  if (total === 0) return "0%";
  const rate = (occupied / total) * 100;
  return formatPercentage(rate);
}

export function formatCapRate(noi: number, propertyValue: number): string {
  if (propertyValue === 0) return "0%";
  const capRate = (noi / propertyValue) * 100;
  return formatPercentage(capRate, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  });
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

export function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (remainingMinutes === 0) {
    return `${hours}h`;
  }

  return `${hours}h ${remainingMinutes}m`;
}

export function formatAddress(address: {
  street?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  country?: string;
}): string {
  const parts = [];

  if (address.street) parts.push(address.street);
  if (address.city) parts.push(address.city);
  if (address.state) parts.push(address.state);
  if (address.zipCode) parts.push(address.zipCode);
  if (address.country && address.country !== "US") parts.push(address.country);

  return parts.join(", ");
}

export function formatInitials(firstName: string, lastName: string): string {
  const first = firstName?.charAt(0)?.toUpperCase() || "";
  const last = lastName?.charAt(0)?.toUpperCase() || "";
  return `${first}${last}`;
}

export function formatFullName(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`.trim();
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3)}...`;
}

export function formatSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

export function isValidPhoneNumber(phone: string): boolean {
  const phoneRegex = /^\+?[\d\s\-\(\)]{10,}$/;
  return phoneRegex.test(phone);
}

export function isValidZipCode(
  zipCode: string,
  countryCode: string = "US"
): boolean {
  if (countryCode === "US") {
    return /^\d{5}(-\d{4})?$/.test(zipCode);
  }
  // Add other country validations as needed
  return zipCode.length >= 3;
}
