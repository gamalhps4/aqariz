import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format address object to string
 */
export function formatAddress(address: any): string {
  if (typeof address === "string") {
    return address;
  }

  if (!address || typeof address !== "object") {
    return "Address not available";
  }

  const { street, city, state, zipCode, country } = address;

  if (!street || !city || !state || !zipCode) {
    return "Incomplete address";
  }

  return `${street}, ${city}, ${state} ${zipCode}${country ? `, ${country}` : ""}`;
}

/**
 * Validates phone number format
 * Accepts various formats like:
 * - +1 (897) 183-5932
 * - +8801857526232
 * - (555) 123-4567
 * - 555-123-4567
 * - 555.123.4567
 * - 5551234567
 */
export function isValidPhoneNumber(phone: string): boolean {
  if (!phone || typeof phone !== "string") return false;

  // Remove all non-digit characters except + at the beginning
  const cleaned = phone.replace(/[^\d+]/g, "");

  // Check if it starts with + and has 10-15 digits after
  if (cleaned.startsWith("+")) {
    const digits = cleaned.slice(1);
    return /^\d{10,15}$/.test(digits);
  }

  // For numbers without country code, expect 10-11 digits
  return /^\d{10,11}$/.test(cleaned);
}

/**
 * Normalizes phone number by removing formatting characters
 * but keeping the + for international numbers
 */
export function normalizePhoneNumber(phone: string): string {
  if (!phone) return "";

  // Keep + at the beginning if present, remove all other non-digits
  if (phone.startsWith("+")) {
    return "+" + phone.slice(1).replace(/\D/g, "");
  }

  return phone.replace(/\D/g, "");
}

/**
 * Formats a date string or Date object to a readable format
 */
export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return "N/A";

  try {
    const dateObj = typeof date === "string" ? new Date(date) : date;

    if (isNaN(dateObj.getTime())) {
      return "Invalid Date";
    }

    return dateObj.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch (error) {
    return "Invalid Date";
  }
}
