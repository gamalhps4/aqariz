/**
 * PropertyPro - Calendar RSVP API
 * Handle RSVP responses for calendar event invitations
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import {
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  parseRequestBody,
} from "@/lib/api-utils";
import { calendarEmailService } from "@/lib/services/calendar-email.service";
import { readAttendees } from "@/lib/services/calendar.service";
import { z } from "zod";
import { runWithCalendarInvitationContext } from "@/lib/calendar/invitation-token";

// ============================================================================
// VALIDATION SCHEMAS
// ============================================================================

const rsvpSchema = z.object({
  token: z.string().min(1, "Token is required"),
  response: z.enum(["accepted", "declined", "tentative"]),
  message: z.string().optional(),
});

const rsvpQuerySchema = z.object({
  token: z.string().min(1, "Token is required"),
  response: z.enum(["accepted", "declined", "tentative"]).optional(),
});

// ============================================================================
// GET /api/calendar/rsvp - Get RSVP details from token
// ============================================================================
export const GET = async (request: NextRequest) => {
  try {
    const { searchParams } = new URL(request.url);
    const queryParams = Object.fromEntries(searchParams.entries());

    // Validate query parameters
    const validation = rsvpQuerySchema.safeParse(queryParams);
    if (!validation.success) {
      return createErrorResponse(
        `Invalid query parameters: ${validation.error.errors
          .map((e) => e.message)
          .join(", ")}`,
        400,
      );
    }

    const { token, response } = validation.data;

    return await runWithCalendarInvitationContext(token, async (payload) => {
      if (response) {
        const result = await calendarEmailService.processRSVP(token, response);

        if (!result.success) {
          return createErrorResponse(
            result.error || "Failed to process RSVP",
            400,
          );
        }

        return createSuccessResponse(
          {
            event: result.event,
            attendee: result.attendee,
            response,
            message: "RSVP processed successfully",
          },
          "RSVP processed successfully",
        );
      }

      const { eventId, attendeeId, email, external } = payload;

      const event = await db.event.findFirst({
        where: { id: eventId, deletedAt: null },
        include: {
          organizer: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
        },
      });
      if (!event) {
        return createErrorResponse("Event not found", 400);
      }

      // Handle external users (not registered in system)
      if (external) {
        return createSuccessResponse(
          {
            event: {
              id: event.id,
              title: event.title,
              description: event.description,
              startDate: event.startDate,
              endDate: event.endDate,
              location: event.location,
              type: event.type,
              allDay: event.allDay,
              organizer: event.organizer,
            },
            attendee: {
              email: email,
              firstName: email!.split("@")[0],
              lastName: "",
              isExternal: true,
            },
            currentResponse: "pending", // External users start as pending
            respondedAt: null,
            isExternal: true,
          },
          "RSVP details retrieved successfully",
        );
      }

      // Handle registered users
      const attendee = await db.user.findFirst({ where: { id: attendeeId } });
      if (!attendee) {
        return createErrorResponse("Attendee not found", 400);
      }

      // Find attendee in event (attendees is a Json column)
      const eventAttendee = readAttendees(event).find(
        (a) => String(a.userId) === attendeeId,
      );

      if (!eventAttendee) {
        return createErrorResponse("Attendee not found in event", 400);
      }

      return createSuccessResponse(
        {
          event: {
            id: event.id,
            title: event.title,
            description: event.description,
            startDate: event.startDate,
            endDate: event.endDate,
            location: event.location,
            type: event.type,
            allDay: event.allDay,
            organizer: event.organizer,
          },
          attendee: {
            id: attendee.id,
            firstName: attendee.firstName,
            lastName: attendee.lastName,
            email: attendee.email,
            isExternal: false,
          },
          currentResponse: eventAttendee.status,
          respondedAt: eventAttendee.responseAt ?? eventAttendee.respondedAt ?? null,
          isExternal: false,
        },
        "RSVP details retrieved successfully",
      );
    });
  } catch (error) {
    return handleApiError(error);
  }
};

// ============================================================================
// POST /api/calendar/rsvp - Process RSVP response
// ============================================================================
export const POST = async (request: NextRequest) => {
  try {
    const { success, data: body, error } = await parseRequestBody(request);
    if (!success) {
      return createErrorResponse(error ?? "Invalid request body", 400);
    }

    // Validate request body
    const validation = rsvpSchema.safeParse(body);
    if (!validation.success) {
      return createErrorResponse(
        `Validation failed: ${validation.error.errors
          .map((e) => e.message)
          .join(", ")}`,
        400,
      );
    }

    const { token, response, message } = validation.data;

    return await runWithCalendarInvitationContext(token, async () => {
      const result = await calendarEmailService.processRSVP(token, response);

      if (!result.success) {
        return createErrorResponse(
          result.error || "Failed to process RSVP",
          400,
        );
      }

      if (
        message &&
        result.event &&
        result.attendee &&
        "id" in result.attendee
      ) {
        // Store the message on the attendee's Json entry within the event
        await calendarEmailService.updateEventAttendee(
          result.event.id,
          String(result.attendee.id),
          { notes: message },
        );
      }

      return createSuccessResponse(
        {
          event: result.event,
          attendee: result.attendee,
          response,
          message: "RSVP processed successfully",
        },
        "RSVP processed successfully",
      );
    });
  } catch (error) {
    return handleApiError(error);
  }
};

// ============================================================================
// PUT /api/calendar/rsvp - Update existing RSVP response
// ============================================================================
export const PUT = async (request: NextRequest) => {
  try {
    const { success, data: body, error } = await parseRequestBody(request);
    if (!success) {
      return createErrorResponse(error ?? "Invalid request body", 400);
    }

    // Validate request body
    const validation = rsvpSchema.safeParse(body);
    if (!validation.success) {
      return createErrorResponse(
        `Validation failed: ${validation.error.errors
          .map((e) => e.message)
          .join(", ")}`,
        400,
      );
    }

    const { token, response, message } = validation.data;

    return await runWithCalendarInvitationContext(token, async () => {
      const result = await calendarEmailService.processRSVP(token, response);

      if (!result.success) {
        return createErrorResponse(
          result.error || "Failed to process RSVP",
          400,
        );
      }

      if (
        message &&
        result.event &&
        result.attendee &&
        !result.isExternal &&
        "id" in result.attendee
      ) {
        // Store the message on the attendee's Json entry within the event
        await calendarEmailService.updateEventAttendee(
          result.event.id,
          String(result.attendee.id),
          { notes: message },
        );
      }

      return createSuccessResponse(
        {
          event: result.event,
          attendee: result.attendee,
          isExternal: result.isExternal,
          email: result.email,
          response,
          message: "RSVP updated successfully",
        },
        "RSVP updated successfully",
      );
    });
  } catch (error) {
    return handleApiError(error);
  }
};

// ============================================================================
// Helper function to send bulk invitations
// ============================================================================
export async function sendEventInvitations(
  eventId: string,
  organizerId: string,
  attendeeIds: string[],
) {
  try {
    const event = await db.event.findFirst({
      where: { id: eventId, deletedAt: null },
    });
    const organizer = await db.user.findFirst({ where: { id: organizerId } });

    if (!event || !organizer) {
      throw new Error("Event or organizer not found");
    }

    const result = await calendarEmailService.sendEventInvitations(
      event,
      organizer,
      attendeeIds,
    );

    return result;
  } catch (error) {
    console.error("Failed to send event invitations:", error);
    return {
      success: false,
      sent: 0,
      failed: attendeeIds.length,
      errors: [error instanceof Error ? error.message : "Unknown error"],
    };
  }
}

// ============================================================================
// Helper function to send event reminders
// ============================================================================
export async function sendEventReminders(
  eventId: string,
  reminderType: "1_hour" | "1_day" | "1_week",
) {
  try {
    const event = await db.event.findFirst({
      where: { id: eventId, deletedAt: null },
    });

    if (!event) {
      throw new Error("Event not found");
    }

    const result = await calendarEmailService.sendEventReminders(
      event,
      reminderType,
    );
    return result;
  } catch (error) {
    console.error("Failed to send event reminders:", error);
    return { success: false, sent: 0, failed: 0 };
  }
}
