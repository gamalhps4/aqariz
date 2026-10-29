/**
 * PropertyPro - Tenant Invoices API
 * API endpoint for tenants to view their invoices
 */

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import { Prisma } from "@/generated/prisma/client";
import { UserRole } from "@/types";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  handleApiError,
  withPermissionAndDB,
} from "@/lib/api-utils";

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

// GET /api/tenant/invoices - Get tenant's invoices
export const GET = withPermissionAndDB("payment_history", {
  roles: [UserRole.TENANT],
})(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const { searchParams } = new URL(request.url);
      const page = parseInt(searchParams.get("page") || "1");
      const limit = parseInt(searchParams.get("limit") || "12");
      const status = searchParams.get("status");
      const sortBy = searchParams.get("sortBy") || "dueDate";
      const sortOrder = searchParams.get("sortOrder") || "desc";

      const where: Prisma.InvoiceWhereInput = {
        tenantId: user.id,
        deletedAt: null,
      };

      if (status && status !== "all") {
        where.status = status;
      }

      const skip = (page - 1) * limit;
      const orderBy = {
        [sortBy]: sortOrder === "asc" ? "asc" : "desc",
      } as Prisma.InvoiceOrderByWithRelationInput;

      const [invoices, total, summarySource] = await Promise.all([
        db.invoice.findMany({
          where,
          include: {
            property: { select: propertyRefSelect },
            lease: { select: { id: true, startDate: true, endDate: true } },
          },
          orderBy,
          skip,
          take: limit,
        }),
        db.invoice.count({ where }),
        db.invoice.findMany({
          where,
          select: {
            status: true,
            totalAmount: true,
            amountPaid: true,
            balanceRemaining: true,
          },
        }),
      ]);

      const pages = Math.ceil(total / limit);
      const hasNext = page < pages;
      const hasPrev = page > 1;

      const now = new Date();
      const enrichedInvoices = invoices.map((invoice) => {
        let daysOverdue: number | undefined = undefined;
        if (invoice.status === "overdue" && invoice.dueDate) {
          const diffTime = now.getTime() - new Date(invoice.dueDate).getTime();
          daysOverdue = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        }
        return {
          ...invoice,
          propertyId: invoice.property
            ? mapPropertyRef(invoice.property)
            : invoice.propertyId,
          leaseId: invoice.lease ?? invoice.leaseId,
          property: undefined,
          lease: undefined,
          daysOverdue,
        };
      });

      const summary = {
        total: total,
        totalAmount: summarySource.reduce(
          (sum, inv) => sum + (inv.totalAmount || 0),
          0
        ),
        amountPaid: summarySource.reduce(
          (sum, inv) => sum + (inv.amountPaid || 0),
          0
        ),
        balanceRemaining: summarySource.reduce(
          (sum, inv) => sum + (inv.balanceRemaining || 0),
          0
        ),
        byStatus: {
          scheduled: summarySource.filter((inv) => inv.status === "scheduled")
            .length,
          issued: summarySource.filter((inv) => inv.status === "issued").length,
          partial: summarySource.filter((inv) => inv.status === "partial").length,
          paid: summarySource.filter((inv) => inv.status === "paid").length,
          overdue: summarySource.filter((inv) => inv.status === "overdue").length,
          cancelled: summarySource.filter((inv) => inv.status === "cancelled")
            .length,
        },
      };

      return createSuccessResponse(
        {
          invoices: enrichedInvoices,
          pagination: {
            page,
            limit,
            total,
            pages,
            hasNext,
            hasPrev,
          },
          summary,
        },
        "Invoices retrieved successfully"
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);
