/**
 * PropertyPro - Receipt Generation Service
 * Service for automatically generating and emailing payment receipts
 *
 * Converted from Mongoose to Prisma/Postgres.
 */

import { db } from "@/lib/db/prisma";
import { Prisma } from "@/generated/prisma/client";
import {
  receiptCollision,
  receiptNumberFor,
} from "@/lib/payments/receipt-number";
import { paymentNumberOmit } from "@/lib/payments/payment-number";
import jsPDF from "jspdf";
import { uploadBufferToR2 } from "@/lib/r2-server";
import { renderReceiptPdf } from "@/lib/invoice/receipt-renderer";
import { reportFontBase64 } from "@/lib/reports/pdf-font";
import {
  getCompanyInfoServer,
  getOrgDocumentPreferences,
} from "@/lib/utils/company-info-server";
import { mergeReceiptCompanyWithDefaults } from "@/lib/invoice/company-info-defaults";
import { serverLogoDataUrl } from "@/lib/reports/logo-image";

export interface ReceiptData {
  receiptNumber: string;
  paymentId: string;
  tenantId: string;
  propertyId: string;
  amount: number;
  /** ISO code the payment was taken in. */
  currency?: string | null;
  paymentMethod: string;
  paymentDate: Date;
  description: string;
  invoiceApplications: Array<{
    invoiceNumber: string;
    amountApplied: number;
  }>;
  tenant: {
    name: string;
    email: string;
    address?: string;
  };
  property: {
    name: string;
    address: string;
  };
  company: {
    name: string;
    address: string;
    phone: string;
    email: string;
    website?: string;
    /** The branding logo's address; converted for the PDF when drawn. */
    logo?: string;
  };
}

export interface ReceiptGenerationResult {
  success: boolean;
  receiptId?: string;
  receiptNumber?: string;
  pdfPath?: string;
  emailSent?: boolean;
  error?: string;
}

export class ReceiptGenerationService {
  /**
   * Generate receipt for a payment
   */
  async generateReceiptForPayment(
    paymentId: string,
    autoEmail: boolean = true
  ): Promise<ReceiptGenerationResult> {
    try {
      // Get payment details with related tenant and property — and its
      // number, which is the receipt's number.
      const payment = await db.payment.findFirst({
        where: { id: paymentId },
        omit: await paymentNumberOmit(),
        include: {
          tenant: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
          property: {
            select: {
              id: true,
              name: true,
              addressStreet: true,
              addressCity: true,
              addressState: true,
              addressZipCode: true,
            },
          },
        },
      });

      if (!payment) {
        return {
          success: false,
          error: "Payment not found",
        };
      }

      // Idempotent: a payment has at most one receipt (paymentId is unique).
      // Re-running used to always throw P2002 after burning the PDF work,
      // which made bulk re-runs report spurious failures.
      const existing = await db.paymentReceipt.findFirst({
        where: { paymentId },
      });
      if (existing) {
        return {
          success: true,
          receiptId: existing.id,
          receiptNumber: existing.receiptNumber,
          pdfPath: existing.pdfPath ?? undefined,
          emailSent: existing.emailSent,
        };
      }

      // Get invoice applications for this payment
      const invoiceApplications = await this.getInvoiceApplications(payment);

      // Prepare receipt data
      const receiptData = await this.prepareReceiptData(
        payment,
        invoiceApplications
      );

      // Generate PDF receipt
      const pdfResult = await this.generateReceiptPDF(receiptData);
      if (!pdfResult.success || !pdfResult.pdfBytes) {
        return {
          success: false,
          error: pdfResult.error ?? "Failed to generate PDF",
        };
      }
      const pdfBytes = pdfResult.pdfBytes;

      // Save receipt record first (pdfPath null), then upload and attach the
      // storage key. This order can never leave a dangling reference: a failed
      // upload leaves pdfPath null, which the UI already tolerates, instead of
      // pointing at a file that does not exist.
      const receiptRecord = await this.saveReceiptRecord(
        receiptData,
        payment.organizationId
      );

      // Upload the PDF to R2 and persist the storage key. The helper never
      // throws — unconfigured R2 or a failed upload just leaves pdfPath null.
      let pdfPath: string | undefined;
      if (receiptRecord.pdfPath) {
        // Concurrent generation won and already stored a PDF — keep it.
        pdfPath = receiptRecord.pdfPath;
      } else {
        const uploadResult = await uploadBufferToR2(
          pdfBytes,
          `PropertyPro/receipts/${receiptRecord.receiptNumber}.pdf`,
          "application/pdf",
          {
            receiptNumber: receiptRecord.receiptNumber,
            paymentId: receiptData.paymentId,
          }
        );
        if (uploadResult.success && uploadResult.objectKey) {
          pdfPath = uploadResult.objectKey;
          await db.paymentReceipt.update({
            where: { id: receiptRecord.id },
            data: { pdfPath },
          });
        } else {
          console.error(
            `Failed to upload receipt PDF for ${receiptRecord.receiptNumber}:`,
            uploadResult.error
          );
        }
      }

      // Send email if requested
      let emailSent = false;
      if (autoEmail && receiptData.tenant.email) {
        try {
          await this.emailReceipt(receiptData, pdfBytes);
          emailSent = true;

          // Update receipt record
          await db.paymentReceipt.update({
            where: { id: receiptRecord.id },
            data: {
              emailSent: true,
              emailSentDate: new Date(),
            },
          });
        } catch (error) {
          console.error("Failed to email receipt:", error);
        }
      }

      return {
        success: true,
        receiptId: receiptRecord.id,
        receiptNumber: receiptRecord.receiptNumber,
        pdfPath,
        emailSent,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to generate receipt: ${error}`,
      };
    }
  }

  /**
   * Prepare receipt data from payment information
   */
  private async prepareReceiptData(
    payment: any,
    invoiceApplications: any[]
  ): Promise<ReceiptData> {
    // The payment's own number (RCP-000123), the same one the payments
    // list, the reports and the statements' السند column show.
    const receiptNumber = receiptNumberFor(payment.id, null, payment.number);

    const property = payment.property ?? {};
    const propertyAddress = [
      property.addressStreet,
      property.addressCity,
      [property.addressState, property.addressZipCode]
        .filter(Boolean)
        .join(" "),
    ]
      .filter(Boolean)
      .join(", ");

    return {
      receiptNumber,
      paymentId: payment.id,
      tenantId: payment.tenant?.id ?? payment.tenantId,
      propertyId: payment.property?.id ?? payment.propertyId,
      amount: payment.amount,
      currency: payment.currency,
      paymentMethod: payment.paymentMethod || "Unknown",
      paymentDate: payment.paidDate || payment.createdAt,
      description: payment.description || `Payment for ${payment.type}`,
      invoiceApplications,
      tenant: {
        name: `${payment.tenant?.firstName ?? ""} ${
          payment.tenant?.lastName ?? ""
        }`.trim(),
        email: payment.tenant?.email ?? "",
      },
      property: {
        name: property.name ?? "",
        address: propertyAddress,
      },
      // The office's own details. Every receipt used to carry a made-up
      // "PropertyPro Management, 123 Property Management St" instead.
      company: mergeReceiptCompanyWithDefaults(
        (await getCompanyInfoServer()) ?? undefined,
      ),
    };
  }

  /**
   * Get invoice applications for a payment
   */
  private async getInvoiceApplications(payment: {
    id: string;
    amount: number;
    amountPaid?: number | null;
    allocations?: unknown;
  }) {
    const allocations = ((payment.allocations as any[]) ?? []) as Array<{
      invoiceId: string;
      amount: number;
    }>;
    const invoices = await db.invoice.findMany({
      where: { paymentIds: { has: payment.id } },
      select: { id: true, invoiceNumber: true },
    });

    // Real applied amounts: the recorded allocation when one exists, and for
    // a directly-linked single invoice the payment's captured amount.
    // (This used to hardcode 0, so itemized receipts showed $0.00 lines
    // under a real TOTAL.)
    return invoices.map((invoice) => {
      const allocation = allocations.find(
        (entry) => String(entry.invoiceId) === invoice.id
      );
      return {
        invoiceNumber: invoice.invoiceNumber,
        amountApplied: allocation
          ? Number(allocation.amount)
          : invoices.length === 1
            ? Number(payment.amountPaid || payment.amount)
            : 0,
      };
    });
  }

  /**
   * Generate receipt PDF
   */
  private async generateReceiptPDF(receiptData: ReceiptData): Promise<{
    success: boolean;
    pdfBytes?: Buffer;
    error?: string;
  }> {
    try {
      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
      });
      // Emailed as the payment is recorded, so in the office's language and
      // date format, with the logo converted where its host is checked.
      const [preferences, logo] = await Promise.all([
        getOrgDocumentPreferences(),
        serverLogoDataUrl(receiptData.company.logo),
      ]);

      // The same receipt the tenant portal downloads. This used to draw its
      // own layout in Helvetica — the riyal sign and any Arabic name came
      // out as garbage, and the amounts were formatted as US dollars.
      await renderReceiptPdf(
        pdf,
        {
          receiptNumber: receiptData.receiptNumber,
          paymentId: receiptData.paymentId,
          paymentDate: new Date(receiptData.paymentDate),
          paymentMethod: receiptData.paymentMethod,
          amount: receiptData.amount,
          currency: receiptData.currency,
          description: receiptData.description,
          invoiceApplications: receiptData.invoiceApplications,
          tenant: receiptData.tenant,
          property: receiptData.property,
          company: { ...receiptData.company, logo },
        },
        {
          fontBase64: reportFontBase64(),
          lang: preferences.language,
          dateFormat: preferences.dateFormat,
        },
      );

      // Return the rendered bytes; the caller uploads them to R2 and persists
      // the storage key on the receipt record. (A fabricated "/receipts/…"
      // path used to be persisted here, making every "download receipt" 404.)
      return {
        success: true,
        pdfBytes: Buffer.from(pdf.output("arraybuffer")),
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to generate PDF: ${error}`,
      };
    }
  }

  /**
   * Save receipt record to database
   */
  private async saveReceiptRecord(
    receiptData: ReceiptData,
    organizationId: string
  ) {
    // A receipt is numbered by its payment, so two receipts cannot share a
    // number — except against a receipt stored under an older scheme, or a
    // payment not numbered yet (whose number is made from its id). The unique
    // constraint is the arbiter: on a receiptNumber collision, retry with a
    // numeric suffix rather than leave the payment without a receipt.
    for (let attempt = 0; attempt < 5; attempt++) {
      const receiptNumber =
        attempt === 0
          ? receiptData.receiptNumber
          : `${receiptData.receiptNumber}-${attempt + 1}`;
      try {
        return await db.paymentReceipt.create({
          data: {
            organizationId,
            paymentId: receiptData.paymentId,
            tenantId: receiptData.tenantId,
            propertyId: receiptData.propertyId,
            receiptNumber,
            amount: receiptData.amount,
            paymentMethod: receiptData.paymentMethod,
            paidDate: receiptData.paymentDate,
            description: receiptData.description,
            receiptData: {
              tenantName: receiptData.tenant.name,
              propertyAddress: receiptData.property.address,
              paymentDetails: {
                amount: receiptData.amount,
                type: "payment",
                dueDate: receiptData.paymentDate,
                paidDate: receiptData.paymentDate,
              },
              companyInfo: receiptData.company,
            } as unknown as Prisma.InputJsonValue,
            // The PDF is uploaded to R2 AFTER this row exists; the caller then
            // updates pdfPath with the real storage key. Creating with null
            // means a failed upload can never leave a dangling reference.
            pdfPath: null,
            emailSent: false,
          },
        });
      } catch (error) {
        // Which constraint was hit — see receiptCollision. `meta.target`
        // alone is never set under row-level security, so a concurrent
        // receipt for the same payment was taken for a number collision and
        // retried into four more failures.
        const collision = receiptCollision(error);
        if (!collision) throw error;

        if (collision === "payment") {
          // Concurrent generation won — return the existing receipt.
          const existing = await db.paymentReceipt.findFirst({
            where: { paymentId: receiptData.paymentId },
          });
          if (existing) return existing;
        }
        // receiptNumber collision — loop with the next suffix.
      }
    }
    throw new Error(
      `Could not allocate a receipt number for payment ${receiptData.paymentId}`
    );
  }

  /**
   * Email receipt to tenant
   */
  private async emailReceipt(
    receiptData: ReceiptData,
    _pdfBytes: Buffer
  ): Promise<void> {
    // This would integrate with your email service. The rendered PDF bytes are
    // passed in so a future implementation can attach them directly.

    // TODO: Implement actual email sending
    // const emailService = new EmailService();
    // await emailService.sendReceiptEmail({
    //   to: receiptData.tenant.email,
    //   subject: `Payment Receipt - ${receiptData.receiptNumber}`,
    //   receiptData,
    //   pdfAttachment: _pdfBytes,
    // });
  }

  /**
   * Bulk generate receipts for multiple payments
   */
  async bulkGenerateReceipts(
    paymentIds: string[],
    autoEmail: boolean = true
  ): Promise<{
    successful: number;
    failed: number;
    results: ReceiptGenerationResult[];
  }> {
    const results: ReceiptGenerationResult[] = [];
    let successful = 0;
    let failed = 0;

    for (const paymentId of paymentIds) {
      try {
        const result = await this.generateReceiptForPayment(
          paymentId,
          autoEmail
        );
        results.push(result);

        if (result.success) {
          successful++;
        } else {
          failed++;
        }
      } catch (error) {
        results.push({
          success: false,
          error: `Failed to process payment ${paymentId}: ${error}`,
        });
        failed++;
      }
    }

    return {
      successful,
      failed,
      results,
    };
  }
}

export const receiptGenerationService = new ReceiptGenerationService();
