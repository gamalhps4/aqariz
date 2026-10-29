/**
 * PropertyPro - Tenant Payments API
 * API endpoints for tenant payment management
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import { Prisma } from "@/generated/prisma/client";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  withPermissionAndDB,
  parsePaginationParams,
} from "@/lib/api-utils";
import { paymentNumberOmit } from "@/lib/payments/payment-number";
import { formatPaymentNumber } from "@/lib/payments/receipt-number";

const propertyRefSelect = {
  id: true,
  name: true,
  type: true,
  addressStreet: true,
  addressCity: true,
  addressState: true,
  addressZipCode: true,
} as const;

const invoicePropertyRefSelect = {
  id: true,
  name: true,
  addressStreet: true,
  addressCity: true,
  addressState: true,
  addressZipCode: true,
} as const;

/** Rebuild the populated `propertyId` shape ({ name, address, [type] }). */
function mapPropertyRef(property: {
  id: string;
  name: string;
  type?: string;
  addressStreet: string;
  addressCity: string;
  addressState: string;
  addressZipCode: string;
}) {
  const { addressStreet, addressCity, addressState, addressZipCode, ...rest } =
    property;
  return {
    ...rest,
    address: {
      street: addressStreet,
      city: addressCity,
      state: addressState,
      zipCode: addressZipCode,
    },
  };
}

// ============================================================================
// GET /api/tenant/payments - Get tenant's payments
// ============================================================================

export const GET = withPermissionAndDB("payment_portal")(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    context?: { tenantProfile?: any }
  ) => {
    try {
      const { searchParams } = new URL(request.url);

      // Parse pagination parameters
      const { page = 1, limit = 12 } = parsePaginationParams(searchParams);

      // Get filters
      const status = searchParams.get("status");
      const type = searchParams.get("type");
      const startDate = searchParams.get("startDate");
      const endDate = searchParams.get("endDate");

      const tenant = context?.tenantProfile;
      if (!tenant) {
        return createErrorResponse("Tenant profile unavailable", 500);
      }

      // Build query — tenant self-service: only the signed-in tenant's payments
      const where: Prisma.PaymentWhereInput = { tenantId: user.id };

      if (status && status !== "all") {
        // Handle multiple statuses separated by comma
        const statusArray = status.split(",").map((s) => s.trim());
        if (statusArray.length > 1) {
          where.status = { in: statusArray };
        } else {
          where.status = status;
        }
      }

      if (type && type !== "all") {
        where.type = type;
      }

      if (startDate || endDate) {
        const createdAt: Prisma.DateTimeFilter = {};
        if (startDate) createdAt.gte = new Date(startDate);
        if (endDate) createdAt.lte = new Date(endDate);
        where.createdAt = createdAt;
      }

      // Get payments with pagination and related data — with the payment
      // number (RCP-000123), which is the receipt's, once the database has it.
      const payments = await db.payment.findMany({
        where,
        omit: await paymentNumberOmit(),
        include: {
          property: { select: propertyRefSelect },
          lease: {
            select: { id: true, terms: true, startDate: true, endDate: true },
          },
          invoice: {
            select: {
              id: true,
              invoiceNumber: true,
              issueDate: true,
              dueDate: true,
              status: true,
              subtotal: true,
              taxAmount: true,
              totalAmount: true,
              amountPaid: true,
              balanceRemaining: true,
              notes: true,
              lineItems: true,
              propertyId: true,
              tenantId: true,
              property: { select: invoicePropertyRefSelect },
              tenant: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  email: true,
                },
              },
            },
          },
        },
        orderBy: [{ dueDate: "desc" }, { createdAt: "desc" }],
        take: limit,
        skip: (page - 1) * limit,
      });

      // Rebuild the populated response shapes the client reads
      const plainPayments = payments.map((payment) => ({
        ...payment,
        paymentNumber: formatPaymentNumber(
          (payment as { number?: number | null }).number,
        ),
        propertyId: payment.property
          ? mapPropertyRef(payment.property)
          : payment.propertyId,
        leaseId: payment.lease ?? payment.leaseId,
        invoiceId: payment.invoice
          ? {
              ...payment.invoice,
              propertyId: payment.invoice.property
                ? mapPropertyRef(payment.invoice.property)
                : payment.invoice.propertyId,
              tenantId: payment.invoice.tenant ?? payment.invoice.tenantId,
              property: undefined,
              tenant: undefined,
            }
          : payment.invoiceId,
        property: undefined,
        lease: undefined,
        invoice: undefined,
      }));

      const totalPayments = await db.payment.count({ where });
      const totalPages = Math.ceil(totalPayments / limit);

      return createSuccessResponse({
        payments: plainPayments,
        pagination: {
          page,
          limit,
          total: totalPayments,
          pages: totalPages,
        },
      });
    } catch (error) {
      return handleApiError(error, "Failed to fetch payments");
    }
  }
);
