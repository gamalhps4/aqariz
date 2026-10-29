/**
 * PropertyPro - Company Info Defaults
 * Shared default company information for PDF generation
 * Provides consistent fallback values across the application
 */

import { InvoiceCompanyInfo } from "@/lib/invoice/invoice-shared";
import { ReceiptCompanyInfo } from "@/lib/invoice/receipt-renderer";

/**
 * What a PDF falls back to when the office's details are unavailable: nothing.
 * This used to be a made-up US company ("123 Business Avenue …, +1 (555)
 * 123-4567"), printed on the invoices and receipts of every office that had
 * not filled in its branding. The renderers leave blank fields out.
 */
export const DEFAULT_COMPANY_INFO: InvoiceCompanyInfo = {
  name: "",
  address: "",
  phone: "",
  email: "",
  website: "",
};

/**
 * Default company information for receipts
 * Uses the same values as invoice defaults for consistency
 */
export const DEFAULT_RECEIPT_COMPANY_INFO: ReceiptCompanyInfo = {
  name: DEFAULT_COMPANY_INFO.name,
  address: DEFAULT_COMPANY_INFO.address,
  phone: DEFAULT_COMPANY_INFO.phone,
  email: DEFAULT_COMPANY_INFO.email,
  website: DEFAULT_COMPANY_INFO.website,
};

/**
 * Merge user-provided company info with defaults
 * Ensures all required fields are present
 */
export function mergeWithDefaults(
  userInfo?: Partial<InvoiceCompanyInfo>
): InvoiceCompanyInfo {
  if (!userInfo) {
    return { ...DEFAULT_COMPANY_INFO };
  }

  return {
    name: userInfo.name || DEFAULT_COMPANY_INFO.name,
    address: userInfo.address || DEFAULT_COMPANY_INFO.address,
    phone: userInfo.phone || DEFAULT_COMPANY_INFO.phone,
    email: userInfo.email || DEFAULT_COMPANY_INFO.email,
    website: userInfo.website || DEFAULT_COMPANY_INFO.website,
    logo: userInfo.logo,
    vatNumber: userInfo.vatNumber || undefined,
  };
}

/**
 * Merge user-provided receipt company info with defaults
 */
export function mergeReceiptCompanyWithDefaults(
  userInfo?: Partial<ReceiptCompanyInfo>
): ReceiptCompanyInfo {
  if (!userInfo) {
    return { ...DEFAULT_RECEIPT_COMPANY_INFO };
  }

  return {
    name: userInfo.name || DEFAULT_RECEIPT_COMPANY_INFO.name,
    address: userInfo.address || DEFAULT_RECEIPT_COMPANY_INFO.address,
    phone: userInfo.phone || DEFAULT_RECEIPT_COMPANY_INFO.phone,
    email: userInfo.email || DEFAULT_RECEIPT_COMPANY_INFO.email,
    website: userInfo.website || DEFAULT_RECEIPT_COMPANY_INFO.website,
    logo: userInfo.logo,
    vatNumber: userInfo.vatNumber || undefined,
  };
}

