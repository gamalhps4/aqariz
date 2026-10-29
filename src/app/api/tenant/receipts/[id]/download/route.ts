import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/prisma";
import { Prisma } from "@/generated/prisma/client";
import { AuthenticatedAccessUser, withPermissionAndDB } from "@/lib/api-utils";
import { createPresignedDownloadUrl } from "@/lib/r2-server";
import { gatewayReferenceSelect } from "@/lib/payments/gateway-columns";
import { gatewayReferenceOf } from "@/lib/payments/gateway-reference";

// PaymentReceipt has no `deletedAt` column, but the client's soft-delete
// filter lists it — name `deletedAt: undefined` in list-read wheres to opt out
// (Prisma strips undefined args; the filter only checks for the key).
type PaymentReceiptListWhere = Prisma.PaymentReceiptWhereInput & {
  deletedAt?: undefined;
};

export const GET = withPermissionAndDB("payment_history")(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
  ) => {
    try {
      const { id } = await context.params;

      const receiptWhere: PaymentReceiptListWhere = {
        id,
        deletedAt: undefined,
      };
      const receipt = await db.paymentReceipt.findFirst({
        where: receiptWhere,
        include: {
          payment: {
            select: {
              id: true,
              amount: true,
              type: true,
              dueDate: true,
              paidDate: true,
              propertyId: true,
              tenantId: true,
              stripePaymentIntentId: true,
              ...(await gatewayReferenceSelect()),
            },
          },
        },
      });

      if (!receipt) {
        return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
      }

      if (receipt.payment?.tenantId !== user.id) {
        return NextResponse.json(
          { error: "Access denied. Receipt does not belong to you." },
          { status: 403 }
        );
      }

      // The stored value is the R2 object key written at generation time
      // (org/{orgId}/PropertyPro/receipts/{receiptNumber}.pdf). Null means the
      // PDF was never stored (e.g. R2 unconfigured when the receipt was
      // generated) — that is a 404, not a fabricated file.
      if (!receipt.pdfPath) {
        return NextResponse.json(
          { error: "Receipt PDF is not available" },
          { status: 404 }
        );
      }

      // Redirect to a short-lived presigned URL instead of proxying the bytes.
      // The helper enforces that the key belongs to the active organization.
      const presigned = await createPresignedDownloadUrl(receipt.pdfPath, {
        fileName: `receipt-${receipt.receiptNumber}.pdf`,
      });

      if (!presigned.success || !presigned.url) {
        return NextResponse.json(
          { error: "Receipt file storage is not available" },
          { status: 503 }
        );
      }

      return NextResponse.redirect(presigned.url, 302);
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error ? error.message : "Failed to download receipt",
        },
        { status: 500 }
      );
    }
  }
);

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/* TODO: Implement PDF generation once pdfkit is installed
async function generateReceiptPDF(receipt: any): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50 });
      const chunks: Buffer[] = [];

      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));

      const payment = receipt.paymentId;
      const property = payment.propertyId;
      const tenant = payment.tenantId;

      // Header
      doc.fontSize(20).text("PAYMENT RECEIPT", 50, 50, { align: "center" });
      doc
        .fontSize(12)
        .text(`Receipt #${receipt.receiptNumber}`, 50, 80, { align: "center" });

      // Company Info (you can customize this)
      doc.fontSize(14).text("PropertyPro", 50, 120);
      doc.fontSize(10).text("Property Management Services", 50, 140);
      doc.text("Email: support@PropertyPro.com", 50, 155);

      // Receipt Details Box
      doc.rect(50, 180, 500, 120).stroke();
      doc.fontSize(12).text("Receipt Details", 60, 190);

      doc.fontSize(10);
      doc.text(`Receipt Number: ${receipt.receiptNumber}`, 60, 210);
      doc.text(
        `Generated Date: ${new Date(
          receipt.generatedDate
        ).toLocaleDateString()}`,
        60,
        225
      );
      doc.text(
        `Payment Date: ${new Date(payment.paidDate).toLocaleDateString()}`,
        60,
        240
      );
      doc.text(
        `Due Date: ${new Date(payment.dueDate).toLocaleDateString()}`,
        60,
        255
      );

      // Any gateway's reference (lib/payments/gateway-reference.ts).
      const transactionId = gatewayReferenceOf(payment)?.id;
      if (transactionId) {
        doc.text(`Transaction ID: ${transactionId}`, 60, 270);
      }

      // Tenant Information
      doc.rect(50, 320, 240, 100).stroke();
      doc.fontSize(12).text("Tenant Information", 60, 330);
      doc.fontSize(10);
      doc.text(`Name: ${tenant.name}`, 60, 350);
      doc.text(`Email: ${tenant.email}`, 60, 365);

      // Property Information
      doc.rect(310, 320, 240, 100).stroke();
      doc.fontSize(12).text("Property Information", 320, 330);
      doc.fontSize(10);
      doc.text(`Property: ${property.name}`, 320, 350);
      doc.text(`Address: ${property.address.street}`, 320, 365);
      doc.text(
        `${property.address.city}, ${property.address.state} ${property.address.zipCode}`,
        320,
        380
      );

      // Payment Details
      doc.rect(50, 440, 500, 80).stroke();
      doc.fontSize(12).text("Payment Details", 60, 450);

      doc.fontSize(10);
      doc.text(
        `Payment Type: ${payment.type.replace("_", " ").toUpperCase()}`,
        60,
        470
      );
      doc.text(`Amount Paid: ${formatCurrency(payment.amount)}`, 60, 485);
      doc.text(`Payment Method: Credit Card`, 60, 500);

      // Total Amount (highlighted)
      doc.rect(350, 460, 180, 40).fillAndStroke("#f0f0f0", "#000000");
      doc.fillColor("#000000");
      doc.fontSize(14).text("TOTAL PAID", 360, 470);
      doc.fontSize(16).text(formatCurrency(payment.amount), 360, 485);

      // Footer
      doc.fontSize(8).fillColor("#666666");
      doc.text(
        "This is an official receipt for your payment. Please keep this for your records.",
        50,
        560,
        {
          align: "center",
        }
      );
      doc.text(
        "For questions about this receipt, please contact your property manager.",
        50,
        575,
        {
          align: "center",
        }
      );

      // Watermark (optional)
      doc.fontSize(60).fillColor("#f0f0f0").text("PAID", 200, 300, {
        rotate: 45,
        align: "center",
      });

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}
*/
