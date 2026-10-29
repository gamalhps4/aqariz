/**
 * PropertyPro - Invoice PDF Generation API
 * Generate and download PDF invoices
 */

import { NextRequest, NextResponse } from "next/server";
import { isReportLanguage } from "@/lib/reports/labels";
import { db } from "@/lib/db/prisma";
import { invoiceScope } from "@/lib/db/scopes";
import {
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  withPermissionAndDB,
  isValidObjectId,
  type AuthenticatedAccessUser,
} from "@/lib/api-utils";
import { INVOICE_READ_PERMISSIONS } from "@/lib/finance-permissions";
import {
  generateInvoicePdfBuffer,
  renderAndStoreInvoicePdf,
} from "@/lib/services/invoice-pdf.service";
import { invoicePhase0Omit } from "@/lib/invoice/phase0-columns";

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
function toPopulatedInvoice(invoice: any) {
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

// ============================================================================
// GET /api/invoices/[id]/pdf - Generate and download invoice PDF
// ============================================================================
async function downloadInvoicePdf(
  user: AuthenticatedAccessUser,
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!isValidObjectId(id)) {
      return createErrorResponse("Invalid invoice ID", 400);
    }

    // Scoped: an invoice outside this caller's buildings does not resolve,
    // so the PDF is never rendered for one.
    const invoice = await db.invoice.findFirst({
      where: { id, ...invoiceScope(user) },
      // A tax invoice names its buyer and their VAT number; a credit note,
      // the invoice it corrects.
      omit: await invoicePhase0Omit(),
      include: invoicePdfInclude,
    });

    if (!invoice) {
      return createErrorResponse("Invoice not found", 404);
    }

    // Generate the PDF using the same design used in the lease module
    // In the language the download was asked for (`?lang=`), else the
    // office's own.
    const asked = request.nextUrl.searchParams.get("lang");
    const pdfData = await generateInvoicePdfBuffer(
      toPopulatedInvoice(invoice) as any,
      undefined,
      isReportLanguage(asked) ? asked : undefined,
    );

    // Mark the PDF as generated. Do NOT touch pdfPath here: this route streams
    // a freshly rendered PDF, and pdfPath holds the real R2 storage key written
    // by the store path — overwriting it with a fabricated value would orphan
    // the stored file.
    await db.invoice.update({
      where: { id: invoice.id },
      data: {
        pdfGenerated: true,
      },
    });

    return new NextResponse(new Uint8Array(pdfData), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="invoice-${invoice.invoiceNumber}.pdf"`,
      },
    });
  } catch (error) {
    return handleApiError(error, "Failed to generate PDF");
  }
}

// ============================================================================
// POST /api/invoices/[id]/pdf - Generate PDF and save to server
// ============================================================================
async function generateInvoicePdf(
  user: AuthenticatedAccessUser,
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!isValidObjectId(id)) {
      return createErrorResponse("Invalid invoice ID", 400);
    }

    // Render the PDF, upload it to R2, and persist the real storage key.
    // (A fabricated "/uploads/invoices/…" path used to be stored here without
    // any file being written.)
    const stored = await renderAndStoreInvoicePdf(id);

    if (!stored.success || !stored.pdfPath) {
      if (stored.error === "Invoice not found") {
        return createErrorResponse("Invoice not found", 404);
      }
      return createErrorResponse(
        stored.error ?? "Failed to generate PDF",
        503
      );
    }

    return createSuccessResponse(
      {
        pdfPath: stored.pdfPath,
        pdfGenerated: true,
        downloadUrl: `/api/invoices/${id}/pdf`,
      },
      "PDF generated successfully"
    );
  } catch (error) {
    return handleApiError(error, "Failed to generate PDF");
  }
}

// The invoice itself, printed: part of viewing it, not an export of a list.
const invoicePdfPermissions = [...INVOICE_READ_PERMISSIONS];

export const GET = withPermissionAndDB(invoicePdfPermissions)(
  async (user: AuthenticatedAccessUser, request: NextRequest, context: any) =>
    downloadInvoicePdf(user, request, context),
);
export const POST = withPermissionAndDB(invoicePdfPermissions)(
  async (user: AuthenticatedAccessUser, request: NextRequest, context: any) =>
    generateInvoicePdf(user, request, context),
);
