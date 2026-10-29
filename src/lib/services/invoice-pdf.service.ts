/**
 * PropertyPro - Invoice PDF Service
 * Shared helpers for generating invoice PDFs server-side
 */

import jsPDF from "jspdf";
import { IInvoice } from "@/types";
import { db } from "@/lib/db/prisma";
import { renderInvoicePdf } from "@/lib/invoice/pdf-renderer";
import {
  getCompanyInfoServer,
  getOrgDocumentPreferences,
} from "@/lib/utils/company-info-server";
import type { PdfLanguage } from "@/lib/invoice/pdf-i18n";
import { normalizeInvoiceForPrint } from "@/lib/invoice/invoice-shared";
import { getOrgSystemSettings } from "@/lib/services/system-settings";
import { uploadBufferToR2 } from "@/lib/r2-server";
import { reportFontBase64 } from "@/lib/reports/pdf-font";
import { serverLogoDataUrl } from "@/lib/reports/logo-image";
import { invoicePhase0Omit } from "@/lib/invoice/phase0-columns";

export type InvoiceLike = IInvoice & { tenantId?: any; propertyId?: any };

export async function generateInvoicePdfBuffer(
  invoiceInput: InvoiceLike,
  currencyCodeOverride?: string,
  /** The reader's language; the office's display language when omitted. */
  lang?: PdfLanguage,
): Promise<Buffer> {
  const invoice = invoiceInput as IInvoice & {
    tenantId?: any;
    propertyId?: any;
  };

  // Fetch company info from display settings
  const [companyInfo, preferences] = await Promise.all([
    getCompanyInfoServer(),
    getOrgDocumentPreferences(),
  ]);
  let currencyCode: string | undefined = currencyCodeOverride;
  try {
    if (!currencyCode) {
      const systemSettings = await getOrgSystemSettings();
      currencyCode = systemSettings?.payment?.currency || undefined;
    }
  } catch {
    currencyCode = undefined;
  }

  // The logo converted here, where the hosts it may come from are checked;
  // the renderer only draws what it is handed.
  const normalized = normalizeInvoiceForPrint(invoice, {
    companyInfo: companyInfo
      ? { ...companyInfo, logo: await serverLogoDataUrl(companyInfo.logo) }
      : undefined,
    currencyCode,
  });

  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });
  // Embedded so an Arabic tenant, building or office name prints.
  await renderInvoicePdf(pdf, normalized, {
    fontBase64: reportFontBase64(),
    lang: lang ?? preferences.language,
    dateFormat: preferences.dateFormat,
  });

  return Buffer.from(pdf.output("arraybuffer"));
}

// ============================================================================
// RENDER + STORE (R2)
// ============================================================================

const invoicePdfInclude = {
  tenant: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
    },
  },
  property: {
    select: {
      id: true,
      name: true,
      addressStreet: true,
      addressCity: true,
      addressState: true,
      addressZipCode: true,
      addressCountry: true,
    },
  },
  lease: {
    select: { id: true, startDate: true, endDate: true, terms: true },
  },
} as const;

/** Rebuild the populated shape the PDF renderer expects (Mongoose-era). */
export function toPopulatedInvoice(invoice: any) {
  const { tenant, property, lease, ...rest } = invoice;
  return {
    ...rest,
    tenantId: tenant ?? rest.tenantId,
    propertyId: property
      ? {
          id: property.id,
          name: property.name,
          address: {
            street: property.addressStreet,
            city: property.addressCity,
            state: property.addressState,
            zipCode: property.addressZipCode,
            country: property.addressCountry,
          },
        }
      : rest.propertyId,
    leaseId: lease ?? rest.leaseId,
  };
}

export interface StoredInvoicePdfResult {
  success: boolean;
  /** R2 object key the PDF was stored under (org/{orgId}/PropertyPro/invoices/…). */
  pdfPath?: string;
  invoiceNumber?: string;
  error?: string;
}

/**
 * Render an invoice PDF, upload it to R2, and persist the real storage key on
 * the invoice (`pdfGenerated` + `pdfPath`).
 *
 * The DB row is only updated after a successful upload, so `pdfPath` can never
 * reference a file that does not exist; a failed upload (including R2 being
 * unconfigured) returns `{ success: false }` and leaves the invoice untouched.
 */
export async function renderAndStoreInvoicePdf(
  invoiceId: string
): Promise<StoredInvoicePdfResult> {
  const invoice = await db.invoice.findFirst({
    where: { id: invoiceId, deletedAt: null },
    // The buyer a tax invoice names and their VAT number, once the database
    // has them (phase0-columns.ts).
    omit: await invoicePhase0Omit(),
    include: invoicePdfInclude,
  });

  if (!invoice) {
    return { success: false, error: "Invoice not found" };
  }

  const pdfBuffer = await generateInvoicePdfBuffer(
    toPopulatedInvoice(invoice) as any
  );

  const upload = await uploadBufferToR2(
    pdfBuffer,
    `PropertyPro/invoices/${invoice.invoiceNumber}.pdf`,
    "application/pdf",
    { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber }
  );

  if (!upload.success || !upload.objectKey) {
    return {
      success: false,
      invoiceNumber: invoice.invoiceNumber,
      error: upload.error ?? "Failed to upload invoice PDF",
    };
  }

  await db.invoice.update({
    where: { id: invoice.id },
    data: {
      pdfGenerated: true,
      pdfPath: upload.objectKey,
    },
  });

  return {
    success: true,
    pdfPath: upload.objectKey,
    invoiceNumber: invoice.invoiceNumber,
  };
}
