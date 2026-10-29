/**
 * PropertyPro - Payment Receipt API
 * API endpoint for generating and downloading payment receipts
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { isReportLanguage } from "@/lib/reports/labels";
import { db } from "@/lib/db/prisma";
import { PaymentStatus } from "@/types";
import {
  AuthenticatedAccessUser,
  createErrorResponse,
  withPermissionAndDB,
  isValidObjectId,
} from "@/lib/api-utils";
import { generateReceiptPdfBuffer } from "@/lib/services/receipt-pdf.service";
import { receiptNumberFor } from "@/lib/payments/receipt-number";
import { paymentNumberOmit } from "@/lib/payments/payment-number";

// ============================================================================
// GET /api/tenant/payments/[id]/receipt - Download payment receipt
// ============================================================================

export const GET = withPermissionAndDB("payment_portal")(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
  ) => {
    try {
      const { id } = await context.params;

      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid payment ID", 400);
      }

      // Find the payment and verify it belongs to this tenant
      const payment = await db.payment.findFirst({
        where: { id, tenantId: user.id },
        // Its number is the receipt's number (receipt-number.ts).
        omit: await paymentNumberOmit(),
        include: {
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
          tenant: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
          receipt: { select: { receiptNumber: true } },
        },
      });

      if (!payment) {
        return createErrorResponse("Payment not found", 404);
      }

      // Only allow receipt download for completed payments
      if (payment.status !== PaymentStatus.PAID) {
        return createErrorResponse(
          "Receipt only available for completed payments",
          400
        );
      }

      // Generate PDF receipt using shared service (expects the populated
      // Mongoose-era shape: tenantId/propertyId as objects)
      const pdfBuffer = await generateReceiptPdfBuffer({
        _id: payment.id,
        // The payment's own number — the same number the payments list and
        // the owner's statement print.
        receiptNumber: receiptNumberFor(
          payment.id,
          payment.receipt?.receiptNumber,
          payment.number,
        ),
        amount: payment.amount,
        currency: payment.currency,
        paymentMethod: payment.paymentMethod ?? undefined,
        paidDate: payment.paidDate ?? undefined,
        createdAt: payment.createdAt,
        description: payment.description ?? undefined,
        type: payment.type,
        tenantId: payment.tenant
          ? {
              _id: payment.tenant.id,
              firstName: payment.tenant.firstName,
              lastName: payment.tenant.lastName,
              email: payment.tenant.email ?? undefined,
            }
          : undefined,
        propertyId: payment.property
          ? {
              _id: payment.property.id,
              name: payment.property.name,
              address: {
                street: payment.property.addressStreet,
                city: payment.property.addressCity,
                state: payment.property.addressState,
                zipCode: payment.property.addressZipCode,
              },
            }
          : undefined,
      }, {
        // `?lang=` when the portal asks for one, else the office's language.
        lang: (() => {
          const asked = request.nextUrl.searchParams.get("lang");
          return isReportLanguage(asked) ? asked : undefined;
        })(),
      });

      // Return the PDF as a blob
      return new Response(new Uint8Array(pdfBuffer), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="receipt-${id}.pdf"`,
        },
      });
    } catch (error) {
      return createErrorResponse(
        error instanceof Error ? error.message : "Failed to generate receipt",
        500
      );
    }
  }
);
