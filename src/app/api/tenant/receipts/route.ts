/**
 * PropertyPro - Tenant Receipts API
 * Handles fetching and managing payment receipts for tenants
 */

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import { Prisma } from "@/generated/prisma/client";
import {
  AuthenticatedAccessUser,
  createSuccessResponse as createApiSuccessResponse,
  createErrorResponse as createApiErrorResponse,
  withPermissionAndDB,
} from "@/lib/api-utils";
import { paymentScope, withScope } from "@/lib/db/scopes";
import {
  receiptCollision,
  receiptNumberFor,
} from "@/lib/payments/receipt-number";
import { paymentNumbersAvailable } from "@/lib/payments/payment-number";
import { gatewayColumnsOmit } from "@/lib/payments/gateway-columns";
import { gatewayReferenceOf } from "@/lib/payments/gateway-reference";
import { postAfterCommit } from "@/lib/accounting/hooks";

// NOTE: PaymentReceipt has no `deletedAt` column, but the client's soft-delete
// filter lists it — name `deletedAt: undefined` in list-read wheres to opt out
// (Prisma strips undefined args; the filter only checks for the key).
type PaymentReceiptListWhere = Prisma.PaymentReceiptWhereInput & {
  deletedAt?: undefined;
};

const propertyRefSelect = {
  id: true,
  name: true,
  addressStreet: true,
  addressCity: true,
  addressState: true,
  addressZipCode: true,
} as const;

/** Rebuild the populated `propertyId` shape ({ name, address }). */
function mapPropertyRef(property: {
  id: string;
  name: string;
  addressStreet: string;
  addressCity: string;
  addressState: string;
  addressZipCode: string;
}) {
  return {
    id: property.id,
    name: property.name,
    address: {
      street: property.addressStreet,
      city: property.addressCity,
      state: property.addressState,
      zipCode: property.addressZipCode,
    },
  };
}

// ============================================================================
// GET - Fetch tenant's payment receipts
// ============================================================================

export const GET = withPermissionAndDB("payment_history")(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const { searchParams } = new URL(request.url);
      const page = parseInt(searchParams.get("page") || "1");
      const limit = parseInt(searchParams.get("limit") || "12");
      const startDate = searchParams.get("startDate");
      const endDate = searchParams.get("endDate");

      const paymentWhere: Prisma.PaymentWhereInput = { tenantId: user.id };

      if (startDate || endDate) {
        const paidDate: Prisma.DateTimeNullableFilter = {};
        if (startDate) {
          paidDate.gte = new Date(startDate);
        }
        if (endDate) {
          paidDate.lte = new Date(endDate);
        }
        paymentWhere.paidDate = paidDate;
      }

      const payments = await db.payment.findMany({
        where: paymentWhere,
        select: { id: true },
      });
      const paymentIds = payments.map((payment) => payment.id);
      const receiptWhere: PaymentReceiptListWhere = {
        paymentId: { in: paymentIds },
        deletedAt: undefined,
      };
      const skip = (page - 1) * limit;

      const receiptRows = await db.paymentReceipt.findMany({
        where: receiptWhere,
        include: {
          payment: {
            select: {
              id: true,
              // Its number is the receipt's number (receipt-number.ts).
              number: await paymentNumbersAvailable(),
              amount: true,
              type: true,
              dueDate: true,
              paidDate: true,
              propertyId: true,
              property: { select: propertyRefSelect },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      });

      // Rebuild the populated `paymentId` shape (with nested `propertyId`)
      const receipts = receiptRows.map((receipt) => ({
        ...receipt,
        // The payment's own number — what every screen and statement prints
        // for this receipt. One stored under an older scheme stays readable.
        receiptNumber: receiptNumberFor(
          receipt.paymentId,
          receipt.receiptNumber,
          (receipt.payment as { number?: number | null } | null)?.number,
        ),
        storedReceiptNumber: receipt.receiptNumber,
        paymentId: receipt.payment
          ? {
              ...receipt.payment,
              propertyId: receipt.payment.property
                ? mapPropertyRef(receipt.payment.property)
                : receipt.payment.propertyId,
              property: undefined,
            }
          : receipt.paymentId,
        payment: undefined,
      }));

      const total = await db.paymentReceipt.count({ where: receiptWhere });
      const totalPages = Math.ceil(total / limit);

      return createApiSuccessResponse<{
        receipts: typeof receipts;
        pagination: {
          page: number;
          limit: number;
          total: number;
          totalPages: number;
        };
      }>(
        {
          receipts,
          pagination: {
            page,
            limit,
            total,
            totalPages,
          },
        },
        "Receipts fetched successfully"
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to fetch receipts";

      return createApiErrorResponse(errorMessage, 500, errorMessage);
    }
  }
);

// ============================================================================
// POST - Generate a new receipt (typically used by system after payment)
// ============================================================================

export const POST = withPermissionAndDB([
  "payment_processing",
  "financial_management",
])(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const body = await request.json();
      const { paymentId, emailSent = false } = body;

      if (!paymentId) {
        return createApiErrorResponse(
          "Payment ID is required",
          400,
          "Payment ID is required"
        );
      }

      // Scoped: the id arrives in the body, so a caller narrowed to some
      // buildings cannot issue a receipt for a payment in another.
      const payment = await db.payment.findFirst({
        where: withScope({ id: paymentId }, paymentScope(user)),
        omit: {
          number: !(await paymentNumbersAvailable()),
          ...(await gatewayColumnsOmit()),
        },
        include: {
          property: { select: propertyRefSelect },
          tenant: { select: { id: true, name: true, email: true } },
        },
      });

      if (!payment) {
        return createApiErrorResponse(
          "Payment not found",
          404,
          "Payment not found"
        );
      }

      const existingWhere: PaymentReceiptListWhere = {
        paymentId,
        deletedAt: undefined,
      };
      const existingReceipt = await db.paymentReceipt.findFirst({
        where: existingWhere,
      });
      if (existingReceipt) {
        return createApiErrorResponse(
          "Receipt already exists for this payment",
          409,
          "Receipt already exists for this payment"
        );
      }

      // The payment's own number (RCP-000123) — the receipt voucher number
      // every screen and statement prints. Receipts used to be numbered by
      // month here (202610-0001), a second number for the same payment.
      const receiptNumber = receiptNumberFor(payment.id, null, payment.number);
      const generatedDate = new Date();
      const downloadUrl = `/api/tenant/receipts/${paymentId}/download`;

      const createReceipt = (number: string) =>
        db.paymentReceipt.create({
          data: {
            organizationId: user.organizationId!,
            paymentId,
            tenantId: payment.tenantId,
            propertyId: payment.propertyId,
            receiptNumber: number,
            amount: payment.amount,
            paymentMethod: payment.paymentMethod ?? "other",
            // Any gateway's reference (lib/payments/gateway-reference.ts).
            transactionId: gatewayReferenceOf(payment)?.id ?? undefined,
            paidDate: payment.paidDate ?? generatedDate,
            description:
              payment.description ??
              `Payment for ${payment.type.replace("_", " ")}`,
            emailSent,
            receiptData: { generatedDate: generatedDate.toISOString(), downloadUrl },
          },
        });

      // A payment not numbered yet is numbered from its id, which a receipt
      // stored under an older scheme can already hold: then a suffix, as the
      // receipt service does, rather than no receipt at all.
      let receipt: Awaited<ReturnType<typeof createReceipt>> | null = null;
      for (let attempt = 0; attempt < 5 && !receipt; attempt += 1) {
        try {
          receipt = await createReceipt(
            attempt === 0 ? receiptNumber : `${receiptNumber}-${attempt + 1}`,
          );
        } catch (error) {
          const collision = receiptCollision(error);
          if (collision === "payment") {
            return createApiErrorResponse(
              "Receipt already exists for this payment",
              409,
              "Receipt already exists for this payment",
            );
          }
          if (collision !== "number") throw error;
        }
      }
      if (!receipt) {
        return createApiErrorResponse(
          "Could not number the receipt",
          500,
          "Could not number the receipt",
        );
      }

      // A payment not numbered yet is posted under its receipt's number.
      postAfterCommit("payment", paymentId, { userId: user.id });

      // Rebuild the populated `paymentId` response shape
      const responseReceipt = {
        ...receipt,
        paymentId: {
          id: payment.id,
          amount: payment.amount,
          type: payment.type,
          dueDate: payment.dueDate,
          paidDate: payment.paidDate,
          propertyId: payment.property
            ? mapPropertyRef(payment.property)
            : payment.propertyId,
          tenantId: payment.tenant ?? payment.tenantId,
        },
      };

      return createApiSuccessResponse<typeof responseReceipt>(
        responseReceipt,
        "Receipt generated successfully"
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to generate receipt";

      return createApiErrorResponse(errorMessage, 500, errorMessage);
    }
  }
);
