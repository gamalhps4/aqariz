/**
 * PropertyPro - Tenant Tickets API Routes
 * Simplified ticket creation endpoint for tenants
 */

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import { Prisma } from "@/generated/prisma/client";
import { TicketStatus } from "@/types";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  parseRequestBody,
  createPaginationInfo,
  parsePaginationParams,
  withPermissionAndDB,
} from "@/lib/api-utils";
import { ticketSchema, validateSchema } from "@/lib/validations";

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

/**
 * Generate the next per-organization ticket number ("TKT-00001", …).
 * Counts every ticket in the org (soft-deleted included, so numbers are never
 * reused) — mirrors the old Mongoose pre-save hook.
 */
async function generateTicketNumber(): Promise<string> {
  const count = await db.ticket.count({ where: { deletedAt: undefined } });
  return `TKT-${String(count + 1).padStart(5, "0")}`;
}

// ============================================================================
// GET /api/tenant/tickets - Get tenant's own tickets
// ============================================================================

export const GET = withPermissionAndDB("maintenance_requests")(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const { searchParams } = new URL(request.url);
      const paginationParams = parsePaginationParams(searchParams);

      const where: Prisma.TicketWhereInput = {
        tenantId: user.id,
      };

      const status = searchParams.get("status");
      if (status) {
        where.status = status;
      }

      const category = searchParams.get("category");
      if (category) {
        where.category = category;
      }

      if (paginationParams.search) {
        where.OR = [
          { title: { contains: paginationParams.search, mode: "insensitive" } },
          {
            description: {
              contains: paginationParams.search,
              mode: "insensitive",
            },
          },
          {
            ticketNumber: {
              contains: paginationParams.search,
              mode: "insensitive",
            },
          },
        ];
      }

      const { page = 1, limit = 12 } = paginationParams;
      const skip = (page - 1) * limit;

      const [tickets, total] = await Promise.all([
        db.ticket.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip,
          take: limit,
          include: {
            assignedTo: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                avatar: true,
              },
            },
          },
        }),
        db.ticket.count({ where }),
      ]);

      // Ticket.propertyId is a plain column (no relation) — resolve the
      // populated `propertyId` shape with a batched lookup.
      const propertyIds = [
        ...new Set(
          tickets
            .map((ticket) => ticket.propertyId)
            .filter((value): value is string => Boolean(value))
        ),
      ];
      const properties = propertyIds.length
        ? await db.property.findMany({
            where: { id: { in: propertyIds } },
            select: propertyRefSelect,
          })
        : [];
      const propertyMap = new Map(
        properties.map((property) => [property.id, mapPropertyRef(property)])
      );

      const mappedTickets = tickets.map((ticket) => ({
        ...ticket,
        propertyId: ticket.propertyId
          ? propertyMap.get(ticket.propertyId) ?? null
          : ticket.propertyId,
      }));

      const pagination = createPaginationInfo(page, limit, total);

      return createSuccessResponse(
        mappedTickets,
        "Tickets fetched successfully",
        pagination
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);

// ============================================================================
// POST /api/tenant/tickets - Create ticket as tenant
// ============================================================================

export const POST = withPermissionAndDB("maintenance_requests")(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const body = await parseRequestBody(request);
      if (!body.success) {
        return createErrorResponse(body.error!, 400);
      }

      const ticketData = {
        ...body.data,
        tenantId: user.id,
        createdBy: {
          userId: user.id,
          role: user.originalRole,
        },
      };

      const validation = validateSchema(ticketSchema, ticketData);
      if (!validation.success) {
        return createErrorResponse(validation.errors.join(", "), 400);
      }

      const validated = validation.data!;
      const createData: Prisma.TicketUncheckedCreateInput = {
        organizationId: user.organizationId!,
        tenantId: validated.tenantId,
        propertyId: validated.propertyId,
        unitId: validated.unitId,
        assignedToId: validated.assignedTo,
        createdByUserId: validated.createdBy.userId,
        createdByRole: validated.createdBy.role,
        title: validated.title,
        description: validated.description,
        category: validated.category,
        priority: validated.priority,
        attachments: validated.attachments,
        status: TicketStatus.OPEN,
      };

      let ticket;
      try {
        ticket = await db.ticket.create({
          data: { ...createData, ticketNumber: await generateTicketNumber() },
        });
      } catch (createError: any) {
        // Unique [organizationId, ticketNumber] race — regenerate and retry once
        if (createError?.code === "P2002") {
          ticket = await db.ticket.create({
            data: { ...createData, ticketNumber: await generateTicketNumber() },
          });
        } else {
          throw createError;
        }
      }

      // Rebuild the populated response shape
      const [ticketTenant, ticketProperty] = await Promise.all([
        db.user.findFirst({
          where: { id: ticket.tenantId },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            avatar: true,
          },
        }),
        ticket.propertyId
          ? db.property.findFirst({
              where: { id: ticket.propertyId },
              select: propertyRefSelect,
            })
          : Promise.resolve(null),
      ]);

      const creator =
        ticket.createdByUserId === ticket.tenantId
          ? ticketTenant
          : await db.user.findFirst({
              where: { id: ticket.createdByUserId },
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                avatar: true,
              },
            });

      const populated = {
        ...ticket,
        tenantId: ticketTenant ?? ticket.tenantId,
        propertyId: ticket.propertyId
          ? ticketProperty
            ? mapPropertyRef(ticketProperty)
            : null
          : ticket.propertyId,
        createdBy: {
          userId: creator ?? ticket.createdByUserId,
          role: ticket.createdByRole,
        },
      };

      return createSuccessResponse(populated, "Ticket created successfully");
    } catch (error) {
      return handleApiError(error);
    }
  }
);
