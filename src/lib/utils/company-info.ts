/**
 * PropertyPro - Company Info Utility
 * Fetch company information from display settings for invoices and documents
 */

import { InvoiceCompanyInfo } from "@/lib/invoice/invoice-shared";
import { pickDocumentLogo } from "@/lib/invoice/logo-utils";

export interface CompanyInfo extends InvoiceCompanyInfo {
  name: string;
  address: string;
  phone: string;
  email: string;
  website?: string;
  logo?: string;
  primaryColor?: string;
}

// Cache for company info (client-side only)
let companyInfoCache: CompanyInfo | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache
let pendingRequest: Promise<CompanyInfo | null> | null = null;

/**
 * Fetch company information from display settings (client-side)
 * Results are cached for 5 minutes to prevent excessive API calls
 */
export async function getCompanyInfo(): Promise<CompanyInfo | null> {
  // Return cached data if still valid
  if (companyInfoCache && Date.now() - cacheTimestamp < CACHE_TTL) {
    return companyInfoCache;
  }

  // If a request is already in flight, wait for it
  if (pendingRequest) {
    return pendingRequest;
  }

  // Create a new request
  pendingRequest = fetchCompanyInfo();

  try {
    const result = await pendingRequest;
    return result;
  } finally {
    pendingRequest = null;
  }
}

/**
 * Clear the company info cache (useful when settings are updated)
 */
export function clearCompanyInfoCache(): void {
  companyInfoCache = null;
  cacheTimestamp = 0;
}

async function fetchCompanyInfo(): Promise<CompanyInfo | null> {
  try {
    // Fetch display settings for branding info
    const displayResponse = await fetch("/api/settings/display");
    if (!displayResponse.ok) {
      console.error("Failed to fetch display settings");
      return null;
    }

    const displayData = await displayResponse.json();
    const displaySettings =
      displayData?.data?.settings || displayData?.settings;
    // The name the office signed up with, sent when branding has none.
    const organizationName: string | undefined =
      displayData?.data?.metadata?.organizationName ||
      displayData?.metadata?.organizationName;

    // Fetch profile settings for contact info
    const profileResponse = await fetch("/api/settings/profile");
    const profileData = await profileResponse.json();
    const profileSettings =
      profileData?.data?.settings || profileData?.settings;

    const branding = displaySettings?.branding ?? {};
    const companyName: string | undefined =
      branding.companyName || organizationName;
    const companyAddress: string | undefined = branding.companyAddress;

    if (!companyName && !companyAddress) {
      return null;
    }

    const result: CompanyInfo = {
      name: companyName || "",
      address: companyAddress || "",
      phone: profileSettings?.phone || "",
      email: profileSettings?.email || "",
      website: profileSettings?.website || "",
      // The office's own logo — never the app's placeholder artwork.
      logo: pickDocumentLogo(branding),
      primaryColor: branding.primaryColor || undefined,
      // Its VAT registration number: what makes an invoice a tax invoice.
      vatNumber: branding.taxNumber?.trim() || undefined,
    };

    // Update cache
    companyInfoCache = result;
    cacheTimestamp = Date.now();

    return result;
  } catch (error) {
    console.error("Error fetching company info:", error);
    return null;
  }
}

/**
 * Get default company info (fallback)
 */
export function getDefaultCompanyInfo(): CompanyInfo {
  return {
    name: "PropertyPro",
    address: "",
    phone: "",
    email: "",
    website: "",
    logo: "/images/logo-light.png",
  };
}

// NOTE: `getCompanyInfoServer` lives in `./company-info-server` because it
// reaches into server-only code. This module is imported by client components,
// so it must not pull in any server-only transitive imports.
