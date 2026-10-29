export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import {
  UserRole,
  EventType,
  EventStatus,
  EventPriority,
  LocationType,
  OnlinePlatform,
  RecurrenceType,
} from "@/types";
import {
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  withAccessAndDB,
  withPermissionAndDB,
  parseRequestBody,
} from "@/lib/api-utils";
import type {
  AccessRequirement,
  AuthenticatedAccessUser,
} from "@/lib/api-utils";
import {
  calendarService,
  CreateEventParams,
} from "@/lib/services/calendar.service";
import { calendarEmailService } from "@/lib/services/calendar-email.service";
import { eventScope } from "@/lib/db/event-scope";
// import { googleCalendarService } from "@/lib/services/google-calendar.service";
import { db } from "@/lib/db/prisma";
import { z } from "zod";

// ============================================================================
// VALIDATION SCHEMAS
// ============================================================================

const createEventSchema = z
  .object({
    title: z.string().min(1, "Title is required").max(200, "Title too long"),
    description: z.string().max(2000, "Description too long").optional(),
    type: z.nativeEnum(EventType),
    priority: z.nativeEnum(EventPriority).optional(),
    startDate: z.string().transform((str) => new Date(str)),
    endDate: z.string().transform((str) => new Date(str)),
    allDay: z.boolean().optional(),
    timezone: z.string().optional(),
    location: z
      .object({
        type: z.nativeEnum(LocationType),
        address: z.string().optional(),
        platform: z.nativeEnum(OnlinePlatform).optional(),
        meetingLink: z.string().url().optional().or(z.literal("")),
        meetingId: z.string().optional(),
        passcode: z.string().optional(),
      })
      .optional(),
    propertyId: z
      .string()
      .optional()
      .transform((str) =>
        str === "" || str === null || str === undefined ? undefined : str,
      ),
    unitNumber: z.string().optional(),
    attendeeIds: z.array(z.string()).optional(),
    attendeeEmails: z.string().optional(),
    tenantId: z
      .string()
      .optional()
      .transform((str) =>
        str === "" || str === null || str === undefined ? undefined : str,
      ),
    leaseId: z
      .string()
      .optional()
      .transform((str) =>
        str === "" || str === null || str === undefined ? undefined : str,
      ),
    maintenanceRequestId: z
      .string()
      .optional()
      .transform((str) =>
        str === "" || str === null || str === undefined ? undefined : str,
      ),
    reminderMinutes: z.array(z.number()).optional(),
    notes: z.string().optional(),
    metadata: z.record(z.any()).optional(),
    recurrence: z
      .object({
        type: z.nativeEnum(RecurrenceType),
        interval: z.number().min(1),
        endDate: z
          .string()
          .transform((str) => new Date(str))
          .optional(),
        occurrences: z.number().min(1).optional(),
        daysOfWeek: z.array(z.number().min(0).max(6)).optional(),
        dayOfMonth: z.number().min(1).max(31).optional(),
      })
      .optional(),
  })
  .refine((data) => data.endDate >= data.startDate, {
    message: "End date must be after start date",
    path: ["endDate"],
  })
  .refine(
    (data) => {
      if (data.location?.type === LocationType.PHYSICAL) {
        return data.location.address && data.location.address.trim().length > 0;
      }
      return true;
    },
    {
      message: "Address is required for physical locations",
      path: ["location", "address"],
    },
  )
  .refine(
    (data) => {
      if (data.location?.type === LocationType.ONLINE) {
        return (
          data.location.platform &&
          data.location.meetingLink &&
          data.location.meetingLink.trim().length > 0
        );
      }
      return true;
    },
    {
      message: "Platform and meeting link are required for online events",
      path: ["location", "meetingLink"],
    },
  );

const querySchema = z.object({
  startDate: z
    .string()
    .transform((str) => new Date(str))
    .optional(),
  endDate: z
    .string()
    .transform((str) => new Date(str))
    .optional(),
  type: z.nativeEnum(EventType).optional(),
  status: z.nativeEnum(EventStatus).optional(),
  priority: z.nativeEnum(EventPriority).optional(),
  organizer: z.string().optional(),
  attendeeId: z.string().optional(),
  propertyId: z.string().optional(),
  tenantId: z.string().optional(),
  search: z.string().optional(),
  page: z
    .string()
    .transform((str) => parseInt(str, 10))
    .optional(),
  limit: z
    .string()
    .transform((str) => parseInt(str, 10))
    .optional(),
  sortBy: z.string().optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
});

const CALENDAR_READ_ACCESS: AccessRequirement = {
  roles: [UserRole.TENANT],
  permissions: ["property_management"],
  match: "any",
};

// ============================================================================
// GET /api/calendar/events - Get events with filtering
// ============================================================================
export const GET = withAccessAndDB(CALENDAR_READ_ACCESS)(async (
  user: AuthenticatedAccessUser,
  request: NextRequest,
) => {
  try {
    const { searchParams } = new URL(request.url);
    const queryParams = Object.fromEntries(searchParams.entries());

    // Validate query parameters
    const validation = querySchema.safeParse(queryParams);
    if (!validation.success) {
      return createErrorResponse(
        `Invalid query parameters: ${validation.error.errors
          .map((e) => e.message)
          .join(", ")}`,
        400,
      );
    }

    const params = validation.data;

    // Calendar visibility is attendance, not ownership — a rule of its own,
    // and passed to the event service as a filter rather than a Prisma
    // `where`, so it lives here rather than in lib/db/scopes.ts.
    if (user.isTenant) {
      params.attendeeId = user.id.toString();
    }

    // An employee limited to some buildings sees those buildings' events and
    // their own invitations — see lib/db/event-scope.ts.
    const result = await calendarService.getEvents({
      ...params,
      visibility: eventScope(user),
    });

    return createSuccessResponse(result, "Events retrieved successfully");
  } catch (error) {
    return handleApiError(error);
  }
});

// ============================================================================
// POST /api/calendar/events - Create a new event
// ============================================================================
export const POST = withPermissionAndDB("property_management")(async (
  user: AuthenticatedAccessUser,
  request: NextRequest,
) => {
  try {
    const { success, data: body, error } = await parseRequestBody(request);
    if (!success) {
      return createErrorResponse(error ?? "Invalid request body", 400);
    }

    // Validate request body
    const validation = createEventSchema.safeParse(body);
    if (!validation.success) {
      return createErrorResponse(
        `Validation failed: ${validation.error.errors
          .map((e) => e.message)
          .join(", ")}`,
        400,
      );
    }

    const validatedData = validation.data;

    // Process attendee emails if provided
    let finalAttendeeIds = validatedData.attendeeIds ?? [];
    let externalAttendeeEmails: string[] = [];

    if (validatedData.attendeeEmails && validatedData.attendeeEmails.trim()) {
      try {
        // Parse comma-separated emails
        const emails = validatedData.attendeeEmails
          .split(",")
          .map((email) => email.trim())
          .filter((email) => email.length > 0);

        if (emails.length > 0) {
          // Look up users by email
          const attendeeUsers = await db.user.findMany({
            where: { email: { in: emails }, isActive: true },
          });

          // Add found user IDs to attendeeIds
          const foundUserIds = attendeeUsers.map((user) => user.id);
          finalAttendeeIds = [...finalAttendeeIds, ...foundUserIds];

          // Log which emails were found/not found
          const foundEmails = attendeeUsers.map((user) => user.email);
          const notFoundEmails = emails.filter(
            (email) => !foundEmails.includes(email),
          );

          // Store external emails for later processing
          externalAttendeeEmails = notFoundEmails;
        }
      } catch (emailProcessingError) {
        console.error(
          "Error processing attendee emails:",
          emailProcessingError,
        );
      }
    }

    // Prepare event data for creation
    const eventData: CreateEventParams = {
      title: validatedData.title,
      description: validatedData.description,
      type: validatedData.type,
      priority: validatedData.priority,
      startDate: validatedData.startDate,
      endDate: validatedData.endDate,
      allDay: validatedData.allDay,
      timezone: validatedData.timezone,
      location: validatedData.location,
      propertyId: validatedData.propertyId,
      unitNumber: validatedData.unitNumber,
      organizer: user.id.toString(),
      attendeeIds: finalAttendeeIds,
      tenantId: validatedData.tenantId,
      leaseId: validatedData.leaseId,
      maintenanceRequestId: validatedData.maintenanceRequestId,
      recurrence: validatedData.recurrence,
      reminderMinutes: validatedData.reminderMinutes,
      notes: validatedData.notes,
      metadata: validatedData.metadata,
    };

    // Create the event
    const event = await calendarService.createEvent(
      eventData,
      user.id.toString(),
    );

    // Send email invitations to attendees
    if (finalAttendeeIds && finalAttendeeIds.length > 0) {
      try {
        const organizer = await db.user.findFirst({ where: { id: user.id } });
        if (organizer) {
          const invitationResult =
            await calendarEmailService.sendEventInvitations(
              event,
              organizer,
              finalAttendeeIds,
            );

          if (invitationResult.errors.length > 0) {
            console.warn("Email invitation errors:", invitationResult.errors);
          }
        }
      } catch (emailError) {
        console.error("Failed to send email invitations:", emailError);
        // Don't fail the event creation if email sending fails
      }
    }

    // Send email invitations to external attendees (not in system)
    if (externalAttendeeEmails && externalAttendeeEmails.length > 0) {
      try {
        const organizer = await db.user.findFirst({ where: { id: user.id } });
        if (organizer) {
          const externalInvitationResult =
            await calendarEmailService.sendEventInvitationsToEmails(
              event,
              organizer,
              externalAttendeeEmails,
            );

          if (externalInvitationResult.errors.length > 0) {
            console.warn(
              "External email invitation errors:",
              externalInvitationResult.errors,
            );
          }
        }
      } catch (externalEmailError) {
        console.error(
          "Failed to send external email invitations:",
          externalEmailError,
        );
        // Don't fail the event creation if external email sending fails
      }
    }

    // Sync with Google Calendar if user is connected
    // TODO: Re-enable when google-calendar.service is implemented
    /*
      try {
        const userWithIntegration = await User.findById(user.id);
        const googleIntegration =
          userWithIntegration?.integrations?.googleCalendar;

        if (googleIntegration?.connected && googleIntegration.accessToken) {
          // Set up Google Calendar service with user's tokens
          googleCalendarService.setCredentials({
            access_token: googleIntegration.accessToken,
            refresh_token: googleIntegration.refreshToken,
            expiry_date: googleIntegration.expiryDate?.getTime(),
          });

          // Export the event to Google Calendar
          const selectedCalendarId =
            googleIntegration.selectedCalendarId || "primary";
          const exportResult = await googleCalendarService.exportEvents(
            selectedCalendarId,
            [event]
          );

          if (exportResult.exported > 0) {
            // Event successfully synced to Google Calendar
          } else if (exportResult.errors.length > 0) {
            console.warn("Google Calendar sync errors:", exportResult.errors);
          }
        }
      } catch (googleError) {
        console.error("Failed to sync with Google Calendar:", googleError);
        // Don't fail the event creation if Google sync fails
      }
      */

    return NextResponse.json(
      {
        success: true,
        data: event,
        message: "Event created successfully",
      },
      { status: 201 },
    );
  } catch (error) {
    return handleApiError(error);
  }
});

// ============================================================================
// Helper function to get events for calendar view
// ============================================================================
export async function getCalendarEvents(
  startDate: Date,
  endDate: Date,
  userId?: string,
  propertyIds?: string[],
  eventTypes?: EventType[],
) {
  return await calendarService.getCalendarView({
    startDate,
    endDate,
    userId,
    propertyIds,
    eventTypes,
    includeRecurring: true,
  });
}

// ============================================================================
// Helper function to create automatic events
// ============================================================================
export async function createAutomaticEvent(params: {
  type: EventType;
  title: string;
  description?: string;
  startDate: Date;
  endDate: Date;
  propertyId?: string;
  tenantId?: string;
  leaseId?: string;
  maintenanceRequestId?: string;
  organizer: string;
  priority?: EventPriority;
  reminderMinutes?: number[];
}) {
  try {
    const event = await calendarService.createEvent(params, params.organizer);
    return { success: true, event };
  } catch (error) {
    console.error("Failed to create automatic event:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// ============================================================================
// Helper function to get upcoming events for dashboard
// ============================================================================
export async function getUpcomingEventsForUser(
  userId: string,
  limit: number = 5,
) {
  try {
    const events = await calendarService.getUpcomingEvents(userId, limit);
    return { success: true, events };
  } catch (error) {
    console.error("Failed to get upcoming events:", error);
    return { success: false, events: [] };
  }
}
