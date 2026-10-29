/**
 * PropertyPro - Support Tickets API Routes
 * CRUD operations for support ticket management
 */

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import {
  applyScope,
  propertyScope,
  ticketAllows,
  ticketIdentityIds,
  ticketScope,
  withScope,
} from "@/lib/db/scopes";
import { Prisma } from "@/generated/prisma/client";
import { UserRole, TicketStatus } from "@/types";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  parsePaginationParams,
  parseRequestBody,
  createPaginationInfo,
  withAccessAndDB,
} from "@/lib/api-utils";
import {
  ticketSchema,
  paginationSchema,
  validateSchema,
} from "@/lib/validations";

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

async function loadTicketProperties(propertyIds: Array<string | null>) {
  const ids = [...new Set(propertyIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return new Map<string, Record<string, unknown>>();
  const properties = await db.property.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      name: true,
      addressStreet: true,
      addressCity: true,
      addressState: true,
      addressZipCode: true,
      addressCountry: true,
    },
  });
  return new Map(
    properties.map((property) => [
      property.id,
      propertyWithAddress(property as never) as Record<string, unknown>,
    ])
  );
}

async function loadUsersById(userIds: Array<string | null | undefined>) {
  const ids = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return new Map<string, Record<string, unknown>>();
  const users = await db.user.findMany({
    where: { id: { in: ids } },
    select: USER_CARD_SELECT,
  });
  return new Map(users.map((row) => [row.id, row as Record<string, unknown>]));
}

// ============================================================================
// GET /api/tickets - Get all tickets with pagination and filtering
// ============================================================================

export const GET = withAccessAndDB(TICKET_READ_ACCESS)(async (
  user: AuthenticatedAccessUser,
  request: NextRequest,
  context?: { tenantProfile?: any },
) => {
  try {
    const { searchParams } = new URL(request.url);
    const paginationParams = parsePaginationParams(searchParams);

    const filterParams = {
      ...paginationParams,
      status: searchParams.get("status") ?? undefined,
      priority: searchParams.get("priority") ?? undefined,
      category: searchParams.get("category") ?? undefined,
      propertyId: searchParams.get("propertyId") ?? undefined,
      assignedTo: searchParams.get("assignedTo") ?? undefined,
    };

    const validation = validateSchema(paginationSchema, paginationParams);
    if (!validation.success) {
      return createErrorResponse(validation.errors.join(", "), 400);
    }

    const where: Prisma.TicketWhereInput = {};

    // A ticket's tenantId may hold the User id or the Tenant profile id, so
    // this scope keys on both. See lib/db/scopes.ts.
    applyScope(
      where,
      ticketScope(user, ticketIdentityIds(user, context?.tenantProfile)),
    );

    if (filterParams.status) {
      where.status = filterParams.status;
    }
    if (filterParams.priority) {
      where.priority = filterParams.priority;
    }
    if (filterParams.category) {
      where.category = filterParams.category;
    }
    if (filterParams.propertyId) {
      where.propertyId = filterParams.propertyId;
    }
    if (filterParams.assignedTo) {
      where.assignedToId = filterParams.assignedTo;
    }

    if (filterParams.search) {
      where.OR = [
        { title: { contains: filterParams.search, mode: "insensitive" } },
        { description: { contains: filterParams.search, mode: "insensitive" } },
        {
          ticketNumber: { contains: filterParams.search, mode: "insensitive" },
        },
      ];
    }

    const { page = 1, limit = 12, sortBy, sortOrder } = paginationParams;
    const skip = (page - 1) * limit;

    const orderBy: Record<string, "asc" | "desc"> = sortBy
      ? { [sortBy]: sortOrder === "asc" ? "asc" : "desc" }
      : { createdAt: "desc" };

    const [tickets, total] = await Promise.all([
      db.ticket.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        include: {
          tenant: { select: USER_CARD_SELECT },
          assignedTo: { select: USER_CARD_SELECT },
        },
      }),
      db.ticket.count({ where }),
    ]);

    const [propertyMap, creatorMap] = await Promise.all([
      loadTicketProperties(tickets.map((ticket) => ticket.propertyId)),
      loadUsersById(tickets.map((ticket) => ticket.createdByUserId)),
    ]);

    const pagination = createPaginationInfo(page, limit, total);

    const transformedData = tickets.map((ticket) => {
      const property = ticket.propertyId
        ? propertyMap.get(ticket.propertyId) ?? null
        : null;

      return {
        ...ticket,
        tenantId: ticket.tenant ?? ticket.tenantId,
        propertyId: property,
        assignedTo: ticket.assignedTo ?? null,
        createdBy: {
          userId: creatorMap.get(ticket.createdByUserId) ?? null,
          role: ticket.createdByRole,
        },
        tenant: ticket.tenant || {},
        property: property || null,
        assignedUser: ticket.assignedTo || null,
      };
    });

    return createSuccessResponse(
      transformedData,
      "Tickets fetched successfully",
      pagination,
    );
  } catch (error) {
    return handleApiError(error);
  }
});

// ============================================================================
// POST /api/tickets - Create a new ticket
// ============================================================================

/**
 * Ticket numbers are "TKT-%05d" scoped to the organization: count + 1, padded.
 * A concurrent create can collide on the [organizationId, ticketNumber] unique
 * index (P2002) — retry once with a fresh count.
 */
async function createTicketWithNumber(data: Prisma.TicketUncheckedCreateInput) {
  const attempt = async () => {
    const count = await db.ticket.count();
    const ticketNumber = `TKT-${String(count + 1).padStart(5, "0")}`;
    return db.ticket.create({ data: { ...data, ticketNumber } });
  };

  try {
    return await attempt();
  } catch (error: any) {
    if (error?.code === "P2002") {
      return await attempt();
    }
    throw error;
  }
}

export const POST = withAccessAndDB(TICKET_WRITE_ACCESS)(async (
  user: AuthenticatedAccessUser,
  request: NextRequest,
  context?: { tenantProfile?: any },
) => {
  try {
    const body = await parseRequestBody(request);
    if (!body.success) {
      return createErrorResponse(body.error ?? "Invalid request body", 400);
    }

    const validation = validateSchema(ticketSchema, body.data);
    if (!validation.success) {
      return createErrorResponse(validation.errors.join(", "), 400);
    }

    const data = validation.data;

    if (user.isTenant) {
      data.tenantId = user.id;
    }

    data.createdBy = {
      userId: user.id,
      role: user.originalRole,
    };

    const tenant = await db.user.findFirst({ where: { id: data.tenantId } });
    if (!tenant) {
      return createErrorResponse("Tenant not found", 404);
    }

    // The whole row, building included: for an owner or a narrowed employee
    // the rule is keyed on the building, and handed half a row it refused
    // every one of them.
    if (
      !ticketAllows(
        user,
        ticketIdentityIds(user, context?.tenantProfile),
        { tenantId: data.tenantId, propertyId: data.propertyId },
      )
    ) {
      return createErrorResponse("Forbidden", 403);
    }

    if (data.propertyId) {
      // Scoped: a tenant files on a building they hold a lease in, and a
      // narrowed employee on one they were given.
      const property = await db.property.findFirst({
        where: withScope({ id: data.propertyId }, propertyScope(user)),
      });
      if (!property) {
        return createErrorResponse("Property not found", 404);
      }
    }

    if (data.assignedTo) {
      const assignee = await db.user.findFirst({
        where: { id: data.assignedTo },
      });
      if (!assignee) {
        return createErrorResponse("Assigned user not found", 404);
      }
    }

    const ticket = await createTicketWithNumber({
      tenantId: data.tenantId,
      propertyId: data.propertyId ?? null,
      unitId: data.unitId ?? null,
      assignedToId: data.assignedTo ?? null,
      createdByUserId: data.createdBy.userId,
      createdByRole: data.createdBy.role,
      title: data.title,
      description: data.description,
      category: data.category,
      priority: data.priority,
      attachments: data.attachments,
      status: TicketStatus.OPEN,
      organizationId: user.organizationId!,
    });

    const created = await db.ticket.findFirst({
      where: { id: ticket.id },
      include: {
        tenant: { select: USER_CARD_SELECT },
        assignedTo: { select: USER_CARD_SELECT },
      },
    });

    const [propertyMap, creatorMap] = await Promise.all([
      loadTicketProperties([created?.propertyId ?? null]),
      loadUsersById([created?.createdByUserId]),
    ]);

    const populated = created
      ? {
          ...created,
          tenantId: created.tenant ?? created.tenantId,
          propertyId: created.propertyId
            ? propertyMap.get(created.propertyId) ?? null
            : null,
          assignedTo: created.assignedTo ?? null,
          createdBy: {
            userId: creatorMap.get(created.createdByUserId) ?? null,
            role: created.createdByRole,
          },
          tenant: undefined,
        }
      : null;

    return createSuccessResponse(populated, "Ticket created successfully");
  } catch (error) {
    return handleApiError(error);
  }
});
