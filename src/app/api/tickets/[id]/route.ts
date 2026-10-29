/**
 * PropertyPro - Individual Ticket API Routes
 * GET, PUT operations for individual ticket management
 */

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import { ticketAllows, ticketIdentityIds } from "@/lib/db/scopes";
import { Prisma } from "@/generated/prisma/client";
import { UserRole, TicketStatus } from "@/types";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  parseRequestBody,
  isValidObjectId,
  withAccessAndDB,
} from "@/lib/api-utils";

const TICKET_READ_ACCESS = {
  roles: [UserRole.OWNER, UserRole.TENANT],
  permissions: [
    "maintenance_view",
    "maintenance_management",
    "maintenance_assign",
    "work_orders",
  ],
  match: "any" as const,
};

const TICKET_WRITE_ACCESS = {
  roles: [UserRole.TENANT],
  permissions: [
    "maintenance_create",
    "maintenance_management",
    "maintenance_assign",
    "work_orders",
  ],
  match: "any" as const,
};

const USER_CARD_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  avatar: true,
} as const;

function propertyWithAddress(
  property: Record<string, unknown> | null | undefined
) {
  if (!property) return null;
  return {
    ...property,
    address: {
      street: property.addressStreet,
      city: property.addressCity,
      state: property.addressState,
      zipCode: property.addressZipCode,
      country: property.addressCountry,
    },
  };
}

async function loadTicketProperty(
  propertyId: string | null,
  options: { includeUnits?: boolean } = {}
) {
  if (!propertyId) return null;
  const property = await db.property.findFirst({
    where: { id: propertyId },
    select: {
      id: true,
      name: true,
      addressStreet: true,
      addressCity: true,
      addressState: true,
      addressZipCode: true,
      addressCountry: true,
      ...(options.includeUnits ? { units: true } : {}),
    },
  });
  return propertyWithAddress(property as never);
}

async function populateCommentUsers(comments: unknown) {
  const list = Array.isArray(comments) ? (comments as any[]) : [];
  const userIds = [
    ...new Set(
      list
        .map((comment) => comment?.userId)
        .filter((id): id is string => typeof id === "string")
    ),
  ];
  if (userIds.length === 0) return list;
  const users = await db.user.findMany({
    where: { id: { in: userIds } },
    select: { ...USER_CARD_SELECT, role: true },
  });
  const userMap = new Map(users.map((row) => [row.id, row]));
  return list.map((comment) => ({
    ...comment,
    userId:
      typeof comment?.userId === "string"
        ? userMap.get(comment.userId) ?? comment.userId
        : comment?.userId,
  }));
}

// ============================================================================
// GET /api/tickets/[id] - Get ticket details
// ============================================================================

export const GET = withAccessAndDB(TICKET_READ_ACCESS)(async (
  user: AuthenticatedAccessUser,
  request: NextRequest,
  {
    params,
    tenantProfile,
  }: { params: Promise<{ id: string }>; tenantProfile?: any },
) => {
  try {
    const { id } = await params;

    if (!isValidObjectId(id)) {
      return createErrorResponse("Invalid ticket ID", 400);
    }

    const ticket = await db.ticket.findFirst({
      where: { id },
      include: {
        tenant: { select: { ...USER_CARD_SELECT, phone: true } },
        assignedTo: { select: USER_CARD_SELECT },
      },
    });

    if (!ticket) {
      return createErrorResponse("Ticket not found", 404);
    }

    if (!ticketAllows(user, ticketIdentityIds(user, tenantProfile), ticket)) {
      return createErrorResponse("Forbidden", 403);
    }

    const [property, comments, creator] = await Promise.all([
      loadTicketProperty(ticket.propertyId, { includeUnits: true }),
      populateCommentUsers(ticket.comments),
      db.user.findFirst({
        where: { id: ticket.createdByUserId },
        select: USER_CARD_SELECT,
      }),
    ]);

    const transformed = {
      ...ticket,
      comments,
      tenantId: ticket.tenant ?? ticket.tenantId,
      propertyId: property,
      assignedTo: ticket.assignedTo ?? null,
      createdBy: {
        userId: creator ?? null,
        role: ticket.createdByRole,
      },
      tenant: ticket.tenant ?? {},
      property: property ?? null,
      assignedUser: ticket.assignedTo ?? null,
    };

    return createSuccessResponse(transformed, "Ticket fetched successfully");
  } catch (error) {
    return handleApiError(error);
  }
});

// ============================================================================
// PUT /api/tickets/[id] - Update ticket
// ============================================================================

const UPDATABLE_TICKET_FIELDS = [
  "title",
  "description",
  "category",
  "priority",
  "status",
  "attachments",
  "propertyId",
  "unitId",
  "resolvedAt",
  "closedAt",
] as const;

export const PUT = withAccessAndDB(TICKET_WRITE_ACCESS)(async (
  user: AuthenticatedAccessUser,
  request: NextRequest,
  {
    params,
    tenantProfile,
  }: { params: Promise<{ id: string }>; tenantProfile?: any },
) => {
  try {
    const { id } = await params;

    if (!isValidObjectId(id)) {
      return createErrorResponse("Invalid ticket ID", 400);
    }

    const ticket = await db.ticket.findFirst({ where: { id } });
    if (!ticket) {
      return createErrorResponse("Ticket not found", 404);
    }

    if (user.isTenant) {
      if (!ticketAllows(user, ticketIdentityIds(user, tenantProfile), ticket)) {
        return createErrorResponse("Forbidden", 403);
      }
      if (ticket.status !== TicketStatus.OPEN) {
        return createErrorResponse("Only open tickets can be modified", 400);
      }
    }

    const body = await parseRequestBody(request);
    if (!body.success) {
      return createErrorResponse(body.error ?? "Invalid request body", 400);
    }

    const updates = body.data;
    const protectedFields = [
      "_id",
      "id",
      "ticketNumber",
      "tenantId",
      "createdAt",
      "updatedAt",
    ];
    protectedFields.forEach((field) => delete updates[field]);

    if (user.isTenant) {
      const allowedTenantFields = [
        "title",
        "description",
        "category",
        "priority",
        "attachments",
      ];
      Object.keys(updates).forEach((key) => {
        if (!allowedTenantFields.includes(key)) {
          delete updates[key];
        }
      });
    }

    // Stamp resolution/closure timestamps on status transitions (old hook rule)
    if (updates.status) {
      if (
        updates.status === TicketStatus.RESOLVED &&
        ticket.status !== TicketStatus.RESOLVED
      ) {
        updates.resolvedAt = new Date();
      }
      if (
        updates.status === TicketStatus.CLOSED &&
        ticket.status !== TicketStatus.CLOSED
      ) {
        updates.closedAt = new Date();
      }
    }

    const data: Record<string, unknown> = {};
    for (const field of UPDATABLE_TICKET_FIELDS) {
      if (updates[field] !== undefined) {
        data[field] = updates[field];
      }
    }
    if (updates.assignedTo !== undefined) {
      data.assignedToId = updates.assignedTo;
    }

    const updated = await db.ticket.update({
      where: { id },
      data: data as Prisma.TicketUpdateInput,
      include: {
        tenant: { select: USER_CARD_SELECT },
        assignedTo: { select: USER_CARD_SELECT },
      },
    });

    const property = await loadTicketProperty(updated.propertyId);

    const updatedTicket = {
      ...updated,
      tenantId: updated.tenant ?? updated.tenantId,
      propertyId: property,
      assignedTo: updated.assignedTo ?? null,
      tenant: undefined,
    };

    return createSuccessResponse(updatedTicket, "Ticket updated successfully");
  } catch (error) {
    return handleApiError(error);
  }
});
