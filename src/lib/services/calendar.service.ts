/**
 * PropertyPro - Calendar Service
 * Service for managing calendar events and scheduling
 */

import { db } from "@/lib/db/prisma";
import { Prisma } from "@/generated/prisma/client";
import type { Event as EventRow } from "@/generated/prisma/client";
import { requireOrgId } from "@/lib/tenancy/context";
import {
  IEventLocation,
  EventType,
  EventStatus,
  EventPriority,
  RecurrenceType,
  IEventRecurrence,
  UserRole,
} from "@/types";

/** One attendee entry inside the Event.attendees Json column. */
export interface EventAttendeeRecord {
  userId: string;
  email: string;
  name: string;
  role: string;
  status: "pending" | "accepted" | "declined" | "tentative";
  responseAt?: string | Date;
  respondedAt?: string | Date;
  notes?: string;
  invitedAt?: string | Date;
  invitationToken?: string;
}

/** One reminder entry inside the Event.reminders Json column. */
export interface EventReminderRecord {
  type: "email";
  minutesBefore: number;
  sent: boolean;
}

/** An event row plus the populated fields the API responses expose. */
export type CalendarEventRecord = EventRow & Record<string, any>;

export interface CreateEventParams {
  title: string;
  description?: string;
  type: EventType;
  priority?: EventPriority;
  startDate: Date;
  endDate: Date;
  allDay?: boolean;
  timezone?: string;
  location?: IEventLocation;
  propertyId?: string;
  unitNumber?: string;
  organizer: string;
  attendeeIds?: string[];
  tenantId?: string;
  leaseId?: string;
  maintenanceRequestId?: string;
  recurrence?: IEventRecurrence;
  reminderMinutes?: number[];
  notes?: string;
  metadata?: Record<string, any>;
}

export interface UpdateEventParams extends Partial<CreateEventParams> {
  status?: EventStatus;
}

export interface EventQueryParams {
  startDate?: Date;
  endDate?: Date;
  type?: EventType;
  status?: EventStatus;
  priority?: EventPriority;
  organizer?: string;
  attendeeId?: string;
  propertyId?: string;
  tenantId?: string;
  search?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  /**
   * The caller's building rule (lib/db/event-scope.ts), AND-ed onto the
   * query so a requested building or attendee narrows it and never
   * replaces it.
   */
  visibility?: Prisma.EventWhereInput;
}

export interface CalendarViewParams {
  startDate: Date;
  endDate: Date;
  userId?: string;
  propertyIds?: string[];
  eventTypes?: EventType[];
  includeRecurring?: boolean;
}

const ORGANIZER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
} as const;

const PROPERTY_SELECT = {
  id: true,
  name: true,
  addressStreet: true,
  addressCity: true,
  addressState: true,
  addressZipCode: true,
  addressCountry: true,
} as const;

// Event.propertyId is a plain string column (no relation), so only the
// organizer can be included; properties are batch-loaded separately.
const EVENT_INCLUDE = {
  organizer: { select: ORGANIZER_SELECT },
} as const;

export function readAttendees(event: {
  attendees: unknown;
}): EventAttendeeRecord[] {
  return Array.isArray(event.attendees)
    ? (event.attendees as EventAttendeeRecord[])
    : [];
}

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

async function loadTenantRefs(tenantIds: Array<string | null>) {
  const ids = [...new Set(tenantIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return new Map<string, Record<string, unknown>>();
  const tenants = await db.tenant.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      userId: true,
      user: { select: ORGANIZER_SELECT },
    },
  });
  return new Map(
    tenants.map((tenant) => [
      tenant.id,
      { id: tenant.id, userId: tenant.user ?? tenant.userId } as Record<
        string,
        unknown
      >,
    ])
  );
}

async function loadPropertyRefs(propertyIds: Array<string | null>) {
  const ids = [
    ...new Set(propertyIds.filter((id): id is string => Boolean(id))),
  ];
  if (ids.length === 0) return new Map<string, Record<string, unknown>>();
  const properties = await db.property.findMany({
    where: { id: { in: ids } },
    select: PROPERTY_SELECT,
  });
  return new Map(
    properties.map((property) => [
      property.id,
      propertyWithAddress(property as never) as Record<string, unknown>,
    ])
  );
}

async function loadEventRefMaps(
  events: Array<{ tenantId: string | null; propertyId: string | null }>
) {
  const [tenantMap, propertyMap] = await Promise.all([
    loadTenantRefs(events.map((event) => event.tenantId)),
    loadPropertyRefs(events.map((event) => event.propertyId)),
  ]);
  return { tenantMap, propertyMap };
}

function toPopulatedEvent(
  event: Record<string, any>,
  refs: {
    tenantMap?: Map<string, Record<string, unknown>>;
    propertyMap?: Map<string, Record<string, unknown>>;
  }
): CalendarEventRecord {
  const property =
    event.propertyId && refs.propertyMap
      ? refs.propertyMap.get(event.propertyId) ?? null
      : null;
  const tenantRef =
    event.tenantId && refs.tenantMap
      ? refs.tenantMap.get(event.tenantId) ?? null
      : null;
  return {
    ...event,
    propertyId: property ?? event.propertyId,
    tenantId: tenantRef ?? event.tenantId,
  } as unknown as CalendarEventRecord;
}

export class CalendarService {
  // Create a new event
  async createEvent(
    params: CreateEventParams,
    createdBy: string
  ): Promise<CalendarEventRecord> {
    const {
      attendeeIds = [],
      reminderMinutes = [15], // Default 15 minutes reminder
      recurrence,
      organizer,
      ...eventData
    } = params;

    // Prepare attendees (Json column) — attendeeIds kept in sync alongside
    const attendees: EventAttendeeRecord[] = attendeeIds.map((userId) => ({
      userId,
      email: "", // Will be populated by the API
      name: "", // Will be populated by the API
      role: UserRole.TENANT, // Default role, will be updated
      status: "pending",
    }));

    // Prepare reminders
    const reminders: EventReminderRecord[] = reminderMinutes.map((minutes) => ({
      type: "email",
      minutesBefore: minutes,
      sent: false,
    }));

    // Clean up empty string fields that should be null for reference columns
    const cleanedEventData = { ...eventData };
    if (cleanedEventData.propertyId === "") delete cleanedEventData.propertyId;
    if (cleanedEventData.tenantId === "") delete cleanedEventData.tenantId;
    if (cleanedEventData.leaseId === "") delete cleanedEventData.leaseId;
    if (cleanedEventData.maintenanceRequestId === "")
      delete cleanedEventData.maintenanceRequestId;

    const isRecurring = !!recurrence && recurrence.type !== RecurrenceType.NONE;

    // Create event
    const event = await db.event.create({
      data: {
        title: cleanedEventData.title,
        description: cleanedEventData.description,
        type: cleanedEventData.type,
        priority: cleanedEventData.priority ?? undefined,
        startDate: cleanedEventData.startDate,
        endDate: cleanedEventData.endDate,
        allDay: cleanedEventData.allDay ?? undefined,
        timezone: cleanedEventData.timezone ?? undefined,
        location:
          (cleanedEventData.location as unknown as Prisma.InputJsonValue) ??
          undefined,
        propertyId: cleanedEventData.propertyId ?? null,
        unitNumber: cleanedEventData.unitNumber ?? null,
        organizerId: organizer,
        attendees: attendees as unknown as Prisma.InputJsonValue,
        attendeeIds,
        tenantId: cleanedEventData.tenantId ?? null,
        leaseId: cleanedEventData.leaseId ?? null,
        maintenanceRequestId: cleanedEventData.maintenanceRequestId ?? null,
        recurrence: (recurrence as unknown as Prisma.InputJsonValue) ?? undefined,
        isRecurring,
        reminders: reminders as unknown as Prisma.InputJsonValue,
        metadata: (cleanedEventData.metadata as Prisma.InputJsonValue) ?? undefined,
        notes: cleanedEventData.notes ?? null,
        createdById: createdBy,
        organizationId: requireOrgId(),
      },
      include: EVENT_INCLUDE,
    });

    // Generate recurring events if needed
    if (isRecurring && recurrence) {
      await this.generateRecurringEvents(event, recurrence);
    }

    const refs = await loadEventRefMaps([event]);
    return toPopulatedEvent(event, refs);
  }

  // Update an event
  async updateEvent(
    eventId: string,
    params: UpdateEventParams,
    updatedBy: string
  ): Promise<CalendarEventRecord | null> {
    const event = await db.event.findFirst({
      where: { id: eventId, deletedAt: null },
    });
    if (!event) return null;

    const {
      attendeeIds,
      reminderMinutes,
      recurrence,
      organizer,
      location,
      metadata,
      ...rest
    } = params;

    const data: Record<string, unknown> = {};
    const scalarFields = [
      "title",
      "description",
      "type",
      "status",
      "priority",
      "startDate",
      "endDate",
      "allDay",
      "timezone",
      "propertyId",
      "unitNumber",
      "tenantId",
      "leaseId",
      "maintenanceRequestId",
      "notes",
    ] as const;
    for (const field of scalarFields) {
      const value = (rest as Record<string, unknown>)[field];
      if (value !== undefined) data[field] = value;
    }
    if (organizer !== undefined) data.organizerId = organizer;
    if (location !== undefined) data.location = location;
    if (metadata !== undefined) data.metadata = metadata;
    if (recurrence !== undefined) data.recurrence = recurrence;

    // Keep the attendees Json and attendeeIds column in sync: retain the
    // existing entry (with its RSVP state) for ids that stay, add pending
    // entries for new ids.
    if (attendeeIds !== undefined) {
      const existing = readAttendees(event);
      const nextAttendees: EventAttendeeRecord[] = attendeeIds.map(
        (userId) =>
          existing.find((attendee) => String(attendee.userId) === userId) ?? {
            userId,
            email: "",
            name: "",
            role: UserRole.TENANT,
            status: "pending",
          }
      );
      data.attendees = nextAttendees as unknown as Prisma.InputJsonValue;
      data.attendeeIds = attendeeIds;
    }

    if (reminderMinutes !== undefined) {
      data.reminders = reminderMinutes.map((minutes) => ({
        type: "email",
        minutesBefore: minutes,
        sent: false,
      })) as unknown as Prisma.InputJsonValue;
    }

    data.updatedById = updatedBy;

    const updated = await db.event.update({
      where: { id: eventId },
      data: data as Prisma.EventUpdateInput,
      include: EVENT_INCLUDE,
    });

    const refs = await loadEventRefMaps([updated]);
    return toPopulatedEvent(updated, refs);
  }

  // Delete an event (soft delete)
  async deleteEvent(eventId: string): Promise<boolean> {
    const result = await db.event.updateMany({
      where: { id: eventId },
      data: { deletedAt: new Date() },
    });
    return result.count > 0;
  }

  // Get events with filtering and pagination
  async getEvents(params: EventQueryParams): Promise<{
    events: CalendarEventRecord[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const {
      startDate,
      endDate,
      type,
      status,
      priority,
      organizer,
      attendeeId,
      propertyId,
      tenantId,
      search,
      page = 1,
      limit = 20,
      sortBy = "startDate",
      sortOrder = "asc",
      visibility,
    } = params;

    // Build query - explicitly filter for non-deleted events
    const where: Prisma.EventWhereInput = { deletedAt: null };
    if (visibility && Object.keys(visibility).length > 0) {
      where.AND = [visibility];
    }

    if (startDate || endDate) {
      where.startDate = {
        ...(startDate ? { gte: startDate } : {}),
        ...(endDate ? { lte: endDate } : {}),
      };
    }

    if (type) where.type = type;
    if (status) where.status = status;
    if (priority) where.priority = priority;
    if (organizer) where.organizerId = organizer;
    if (propertyId) where.propertyId = propertyId;
    if (tenantId) where.tenantId = tenantId;
    if (attendeeId) where.attendeeIds = { has: attendeeId };

    // Add search functionality
    if (search) {
      where.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
        { notes: { contains: search, mode: "insensitive" } },
      ];
    }

    // Execute query with pagination
    const skip = (page - 1) * limit;
    const orderBy = { [sortBy]: sortOrder } as Record<string, "asc" | "desc">;

    const [events, total] = await Promise.all([
      db.event.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        include: EVENT_INCLUDE,
      }),
      db.event.count({ where }),
    ]);

    const refs = await loadEventRefMaps(events);

    return {
      events: events.map((event) => toPopulatedEvent(event, refs)),
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  // Get calendar view with events for a specific date range
  async getCalendarView(
    params: CalendarViewParams
  ): Promise<CalendarEventRecord[]> {
    const {
      startDate,
      endDate,
      userId,
      propertyIds = [],
      eventTypes = [],
      includeRecurring = true,
    } = params;

    const andClauses: Prisma.EventWhereInput[] = [
      {
        OR: [
          { startDate: { gte: startDate, lte: endDate } },
          { endDate: { gte: startDate, lte: endDate } },
          { startDate: { lte: startDate }, endDate: { gte: endDate } },
        ],
      },
    ];

    if (userId) {
      // "My events": organized by the user or attended by the user
      andClauses.push({
        OR: [{ organizerId: userId }, { attendeeIds: { has: userId } }],
      });
    }

    const where: Prisma.EventWhereInput = {
      deletedAt: null,
      AND: andClauses,
    };

    if (propertyIds.length > 0) {
      where.propertyId = { in: propertyIds };
    }

    if (eventTypes.length > 0) {
      where.type = { in: eventTypes };
    }

    if (!includeRecurring) {
      where.parentEventId = null;
    }

    const events = await db.event.findMany({
      where,
      orderBy: { startDate: "asc" },
      include: EVENT_INCLUDE,
    });

    const refs = await loadEventRefMaps(events);
    return events.map((event) => toPopulatedEvent(event, refs));
  }

  // Generate recurring events
  private async generateRecurringEvents(
    parentEvent: EventRow,
    recurrence: IEventRecurrence
  ): Promise<void> {
    const { type, interval, endDate, occurrences } = recurrence;

    if (type === RecurrenceType.NONE) return;

    const instances: Prisma.EventCreateManyInput[] = [];
    const currentDate = new Date(parentEvent.startDate);
    let count = 0;
    const maxOccurrences = occurrences || 100; // Limit to prevent infinite loops

    while (count < maxOccurrences) {
      // Calculate next occurrence
      switch (type) {
        case RecurrenceType.DAILY:
          currentDate.setDate(currentDate.getDate() + interval);
          break;
        case RecurrenceType.WEEKLY:
          currentDate.setDate(currentDate.getDate() + 7 * interval);
          break;
        case RecurrenceType.MONTHLY:
          currentDate.setMonth(currentDate.getMonth() + interval);
          break;
        case RecurrenceType.YEARLY:
          currentDate.setFullYear(currentDate.getFullYear() + interval);
          break;
        default:
          return;
      }

      // Check if we've reached the end date
      if (endDate && currentDate > endDate) break;

      // Calculate end date for this occurrence
      const duration =
        parentEvent.endDate.getTime() - parentEvent.startDate.getTime();
      const occurrenceEndDate = new Date(currentDate.getTime() + duration);

      // Create recurring event instance
      instances.push({
        organizationId: parentEvent.organizationId,
        title: parentEvent.title,
        description: parentEvent.description,
        type: parentEvent.type,
        status: parentEvent.status,
        priority: parentEvent.priority,
        startDate: new Date(currentDate),
        endDate: occurrenceEndDate,
        allDay: parentEvent.allDay,
        timezone: parentEvent.timezone,
        location: (parentEvent.location as Prisma.InputJsonValue) ?? undefined,
        propertyId: parentEvent.propertyId,
        unitNumber: parentEvent.unitNumber,
        organizerId: parentEvent.organizerId,
        attendees: (parentEvent.attendees as Prisma.InputJsonValue) ?? [],
        attendeeIds: parentEvent.attendeeIds,
        tenantId: parentEvent.tenantId,
        leaseId: parentEvent.leaseId,
        maintenanceRequestId: parentEvent.maintenanceRequestId,
        parentEventId: parentEvent.id,
        isRecurring: false, // Individual instances are not recurring
        recurrence: undefined, // Remove recurrence from instances
        reminders: (parentEvent.reminders as Prisma.InputJsonValue) ?? [],
        metadata: (parentEvent.metadata as Prisma.InputJsonValue) ?? {},
        attachments: parentEvent.attachments,
        notes: parentEvent.notes,
        createdById: parentEvent.createdById,
      });
      count++;
    }

    // Bulk insert recurring events
    if (instances.length > 0) {
      await db.event.createMany({ data: instances });
    }
  }

  // Get upcoming events for a user
  async getUpcomingEvents(
    userId: string,
    limit: number = 10
  ): Promise<CalendarEventRecord[]> {
    const now = new Date();
    const where: Prisma.EventWhereInput = {
      deletedAt: null,
      startDate: { gte: now },
      // "My events": organized by the user or attended by the user
      OR: [{ organizerId: userId }, { attendeeIds: { has: userId } }],
    };

    const events = await db.event.findMany({
      where,
      orderBy: { startDate: "asc" },
      take: limit,
      include: EVENT_INCLUDE,
    });

    const refs = await loadEventRefMaps(events);
    return events.map((event) => toPopulatedEvent(event, refs));
  }

  // Update attendee response (mutates the attendees Json entry for the user)
  async updateAttendeeResponse(
    eventId: string,
    userId: string,
    status: "accepted" | "declined" | "tentative",
    notes?: string
  ): Promise<boolean> {
    const event = await db.event.findFirst({
      where: { id: eventId, deletedAt: null },
    });
    if (!event) return false;

    const attendees = readAttendees(event);
    const index = attendees.findIndex(
      (attendee) => String(attendee.userId) === userId
    );
    if (index === -1) return false;

    const nextAttendees = [...attendees];
    nextAttendees[index] = {
      ...nextAttendees[index],
      status,
      responseAt: new Date().toISOString(),
      notes,
    };

    await db.event.update({
      where: { id: eventId },
      data: { attendees: nextAttendees as unknown as Prisma.InputJsonValue },
    });

    return true;
  }
}

export const calendarService = new CalendarService();
