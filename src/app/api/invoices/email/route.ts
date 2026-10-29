/**
 * PropertyPro - Invoice Email API Route
 * Send lease invoice PDFs via email
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { dbIdSchema, validateSchema } from "@/lib/validations";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  withPermissionAndDB,
  parseRequestBody,
} from "@/lib/api-utils";
import { INVOICE_BULK_EDIT_PERMISSIONS } from "@/lib/finance-permissions";

const invoiceEmailSchema = z
  .object({
    leaseId: dbIdSchema.optional(),
    invoiceId: dbIdSchema.optional(),
    // Each of these defaults from the invoice when left out: the tenant's own
    // address, and a subject and message in the sender's language. Callers
    // that sent only the invoice id used to be refused outright.
    to: z.string().email("Invalid email address").optional(),
    subject: z.string().min(1).max(500).optional(),
    message: z.string().min(1).max(10000).optional(),
    invoiceNumber: z.string().max(100).optional(),
    /** The sender's interface language — the attachment is written in it. */
    lang: z.enum(APP_LANGUAGES).optional(),
  })
  .refine((data) => data.leaseId || data.invoiceId, {
    message: "Either leaseId or invoiceId is required",
    path: ["leaseId"],
  });
import { EmailService } from "@/lib/email-service";
import { db } from "@/lib/db/prisma";
import { invoiceScope, leaseScope } from "@/lib/db/scopes";
import { buildInvoiceEmailHtml } from "@/lib/templates/invoice-email-template";
import { generateInvoicePdfBuffer } from "@/lib/services/invoice-pdf.service";
import { DEFAULT_CURRENCY } from "@/lib/regional/region";
import { pdfLabel } from "@/lib/invoice/pdf-i18n";
import { getOrgDisplayLanguage } from "@/lib/utils/company-info-server";
import { getCompanyInfoServer } from "@/lib/utils/company-info-server";
import { buildPrintableInvoiceFromLease } from "@/lib/invoice/invoice-builders";
import { invoicePhase0Omit } from "@/lib/invoice/phase0-columns";
import { formatCurrency } from "@/lib/utils/formatting";
import { APP_LANGUAGES } from "@/lib/i18n/languages";

const tenantContactSelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
} as const;

const propertyNameAddressSelect = {
  id: true,
  name: true,
  addressStreet: true,
  addressCity: true,
  addressState: true,
  addressZipCode: true,
  addressCountry: true,
} as const;

function buildAddress(property: {
  addressStreet: string;
  addressCity: string;
  addressState: string;
  addressZipCode: string;
  addressCountry: string;
}) {
  return {
    street: property.addressStreet,
    city: property.addressCity,
    state: property.addressState,
    zipCode: property.addressZipCode,
    country: property.addressCountry,
  };
}

/** Restore the Mongoose populated shape (tenantId/propertyId as documents). */
function withPopulatedRefs<
  T extends {
    tenant?: any;
    property?: any;
    tenantId?: unknown;
    propertyId?: unknown;
  },
>(row: T) {
  const { tenant, property, ...rest } = row;
  return {
    ...rest,
    tenantId: tenant ?? rest.tenantId ?? null,
    propertyId: property
      ? { id: property.id, name: property.name, address: buildAddress(property) }
      : (rest.propertyId ?? null),
  };
}

// ============================================================================
// POST /api/invoices/email - Send invoice PDF via email
// ============================================================================

// Sending an invoice to the tenant is part of working on it.
export const POST = withPermissionAndDB([...INVOICE_BULK_EDIT_PERMISSIONS])(async (
  user: AuthenticatedAccessUser,
  request: NextRequest
) => {
  try {
    const { success, data: body, error } = await parseRequestBody(request);
    if (!success) {
      return createErrorResponse(error!, 400);
    }

    const validation = validateSchema(invoiceEmailSchema, body);
    if (!validation.success) {
      return createErrorResponse(validation.errors.join(", "), 400);
    }
    const { leaseId, invoiceId, invoiceNumber, lang: askedLang } =
      validation.data;
    // The attachment and the message are written in the sender's language,
    // else the office's.
    const lang = askedLang ?? (await getOrgDisplayLanguage());

    // Find the lease to verify it exists and get additional context
    // Scoped: this route emails an invoice to a tenant, so both the lease
    // and the invoice must be ones this caller may reach. Without it, an id
    // from the request body was enough to send someone else's bill.
    const leaseRow = leaseId
      ? await db.lease.findFirst({
          where: { id: leaseId, ...leaseScope(user) },
          include: {
            tenant: { select: tenantContactSelect },
            property: { select: propertyNameAddressSelect },
          },
        })
      : null;

    if (leaseId && !leaseRow) {
      return createErrorResponse("Lease not found", 404);
    }

    const lease = leaseRow ? withPopulatedRefs(leaseRow) : null;

    let invoice: any = null;

    if (invoiceId) {
      const invoiceRow = await db.invoice.findFirst({
        where: { id: invoiceId, ...invoiceScope(user) },
        // The buyer an owner's or a customer's invoice names, its VAT number.
        omit: await invoicePhase0Omit(),
        include: {
          tenant: { select: tenantContactSelect },
          property: { select: propertyNameAddressSelect },
        },
      });

      if (!invoiceRow) {
        return createErrorResponse("Invoice not found", 404);
      }
      invoice = withPopulatedRefs(invoiceRow);
    } else if (leaseId) {
      const invoiceRow = await db.invoice.findFirst({
        where: { leaseId, ...invoiceScope(user) },
        orderBy: { issueDate: "desc" },
        include: {
          tenant: { select: tenantContactSelect },
          property: { select: propertyNameAddressSelect },
        },
      });
      invoice = invoiceRow ? withPopulatedRefs(invoiceRow) : null;
    }

    // Initialize email service
    const emailService = new EmailService();

    // Generate PDF using the email service
    let pdfBuffer: Buffer;
    let fileName = `invoice_${Date.now()}.pdf`;
    let printable: any | null = null;

    // Fetch company info from display settings
    const companyInfo = await getCompanyInfoServer();

    // The contract's own currency first — it is what the rent is in. Then the
    // sender's display settings, then the system's; the last resort was US
    // dollars, and is now the market's currency.
    let currencyCode: string = (lease as any)?.currency || DEFAULT_CURRENCY;
    try {
      const ds = await db.displaySettings.findFirst({
        where: { userId: user.id },
      });
      if ((lease as any)?.currency) {
        // Already set from the contract.
      } else if (ds?.currency) {
        currencyCode = ds.currency;
      } else {
        const systemSettings = await db.systemSettings.findFirst({
          where: { isActive: true },
        });
        currencyCode =
          (systemSettings?.payment as any)?.currency || currencyCode;
      }
    } catch {}

    if (invoice) {
      pdfBuffer = await generateInvoicePdfBuffer(
        invoice as any,
        currencyCode,
        lang
      );
      fileName = `${invoice.invoiceNumber || invoice.id}.pdf`;
    } else {
      // Build invoice from lease data using shared builder
      const invoiceData = buildPrintableInvoiceFromLease(lease as any, {
        invoiceNumber,
        issueDate: new Date(),
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        companyInfo: companyInfo || undefined,
      });
      printable = invoiceData;

      // Generate PDF using shared service (same as invoice path)
      pdfBuffer = await generateInvoicePdfBuffer(
        invoiceData as any,
        currencyCode,
        lang
      );
      fileName = `${invoiceNumber || `invoice_${Date.now()}`}.pdf`;
    }

    // Who it goes to and what it says, from the request or the invoice: its
    // tenant, or the owner it is to.
    const customerUserId = (invoice as { customerUserId?: string | null } | null)
      ?.customerUserId;
    const ownerEmail = customerUserId
      ? (
          await db.user.findFirst({
            where: { id: customerUserId, deletedAt: undefined },
            select: { email: true },
          })
        )?.email
      : null;
    const recipient =
      validation.data.to ||
      (invoice as any)?.tenantId?.email ||
      ownerEmail ||
      (lease as any)?.tenantId?.email;
    if (!recipient) {
      return createErrorResponse(
        pdfLabel(lang, "leases.invoiceEmail.noEmail", "This tenant has no email address on file."),
        400,
      );
    }
    const number = String(
      invoiceNumber || (invoice as any)?.invoiceNumber || "",
    );
    const to = recipient;
    const subject =
      validation.data.subject ||
      pdfLabel(lang, "leases.invoiceEmail.subjectDefault", "Invoice {number}", {
        number,
      });
    const message =
      validation.data.message ||
      pdfLabel(
        lang,
        "leases.invoiceEmail.messageDefault",
        "Please find attached your invoice {number}.",
        { number },
      );

    // Prepare email content
    const invoiceTenant = (invoice as any)?.tenantId;
    const invoiceProperty = (invoice as any)?.propertyId;
    const leaseTenant = (lease as any)?.tenantId;
    const leaseProperty = (lease as any)?.propertyId;

    const tenantName = invoiceTenant
      ? `${invoiceTenant.firstName || ""} ${
          invoiceTenant.lastName || ""
        }`.trim() ||
        invoiceTenant.email ||
        "Tenant"
      : leaseTenant
      ? `${leaseTenant.firstName || ""} ${leaseTenant.lastName || ""}`.trim()
      : "Tenant";

    const propertyName =
      invoiceProperty?.name || leaseProperty?.name || "Property";

    // currencyCode already resolved above

    // Compute amount due and due date where available for richer email content
    let amountDue: number | undefined = undefined;
    let dueDate: Date | undefined = undefined;
    if (invoice) {
      amountDue = Number(
        invoice.balanceRemaining ?? invoice.totalAmount ?? invoice.subtotal ?? 0
      );
      dueDate = invoice.dueDate ? new Date(invoice.dueDate) : undefined;
    } else if (printable) {
      amountDue = Number(
        printable.balanceRemaining ??
          printable.totalAmount ??
          printable.subtotal ??
          0
      );
      dueDate = printable.dueDate ? new Date(printable.dueDate) : undefined;
    }

    // Add formatted amount to the message body if not already present
    const formattedAmount =
      typeof amountDue === "number"
        ? formatCurrency(amountDue, currencyCode)
        : undefined;
    const enhancedMessage =
      formattedAmount && message && !message.includes(formattedAmount)
        ? `${message}\n\n${pdfLabel(lang, "leases.invoiceEmail.totalLine", "Amount due: {amount}", { amount: formattedAmount })}`
        : message;

    const emailContent = buildInvoiceEmailHtml({
      message: enhancedMessage,
      propertyName,
      tenantName,
      invoiceNumber: number || undefined,
      amountDue,
      dueDate,
      currencyCode,
      companyName: companyInfo?.name,
      lang,
    });

    // Send email with PDF attachment
    const emailSent = await emailService.sendEmailWithAttachments(
      to,
      {
        subject,
        html: emailContent,
        text: message, // Fallback text version
      },
      [
        {
          filename: fileName,
          content: pdfBuffer,
          contentType: "application/pdf",
        },
      ]
    );

    if (emailSent) {
      return createSuccessResponse(
        {
          message: "Invoice email sent successfully",
          to,
          subject,
          fileName,
          leaseId,
          invoiceId,
          sentAt: new Date().toISOString(),
        },
        "Invoice emailed successfully"
      );
    } else {
      return createErrorResponse("Failed to send email", 500);
    }
  } catch (error) {
    console.error("Failed to send invoice email:", error);
    return handleApiError(error, "Failed to send invoice email");
  }
});
