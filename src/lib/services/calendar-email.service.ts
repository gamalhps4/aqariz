/**
 * PropertyPro - Calendar Email Service
 * Handles email notifications for calendar events including invitations, reminders, and RSVP tracking
 */

import { EmailService } from "@/lib/email-service";
import { LocationType } from "@/types";
import type { IEventLocation } from "@/types";
import { db } from "@/lib/db/prisma";
import { Prisma } from "@/generated/prisma/client";
import type { Event as EventRow, User as UserRow } from "@/generated/prisma/client";
import {
  createCalendarInvitationToken,
  runWithCalendarInvitationContext,
  verifyCalendarInvitationToken,
} from "@/lib/calendar/invitation-token";
import {
  EventAttendeeRecord,
  readAttendees,
} from "@/lib/services/calendar.service";

/** The minimal event shape the email flows need (a Prisma row qualifies). */
export type CalendarEmailEvent = Pick<
  EventRow,
  "id" | "title" | "type" | "startDate"
> & {
  description?: string | null;
  endDate?: Date | string | null;
  allDay?: boolean;
  location?: unknown;
  attendees?: unknown;
  reminders?: unknown;
  [key: string]: any;
};

/** The minimal user shape the email flows need (a Prisma row qualifies). */
export type CalendarEmailUser = Pick<UserRow, "id" | "email"> & {
  firstName?: string | null;
  lastName?: string | null;
  [key: string]: any;
};

export interface EventInvitation {
  eventId: string;
  attendeeId: string;
  email: string;
  name: string;
  token: string;
  status: "pending" | "accepted" | "declined" | "tentative";
  sentAt: Date;
  respondedAt?: Date;
}

export interface ReminderSchedule {
  eventId: string;
  attendeeId: string;
  reminderType: "1_hour" | "1_day" | "1_week";
  scheduledFor: Date;
  sent: boolean;
  sentAt?: Date;
}

export interface EmailDispatchResult {
  success: boolean;
  sent: number;
  failed: number;
  errors: string[];
}

export class CalendarEmailService {
  private emailService: EmailService;

  constructor() {
    this.emailService = new EmailService();
  }

  /**
   * Format event location for email display
   */
  private formatLocationForEmail(
    location?: IEventLocation | null
  ): string | undefined {
    if (!location) return undefined;

    if (location.type === LocationType.PHYSICAL && location.address) {
      return location.address;
    }

    if (location.type === LocationType.ONLINE) {
      if (location.meetingLink) {
        return location.meetingLink;
      }
      if (location.platform) {
        return `Online Meeting (${location.platform.replace("_", " ")})${
          location.meetingId ? ` - ID: ${location.meetingId}` : ""
        }`;
      }
      return "Online Meeting";
    }

    return undefined;
  }

  /**
   * Send event invitations to all attendees
   */
  async sendEventInvitations(
    event: CalendarEmailEvent,
    organizer: CalendarEmailUser,
    attendeeIds: string[]
  ): Promise<EmailDispatchResult> {
    try {
      const attendees = await this.findUsersByIds(attendeeIds);

      if (attendees.length === 0) {
        return this.finalizeDispatchResult(this.createDispatchResult());
      }

      const organizerName = this.getFullName(organizer);
      const eventDetails = {
        ...this.buildEventEmailDetails(event),
        organizer: organizerName,
      };

      return this.dispatchEmails(
        attendees,
        async (attendee) => {
          const invitationToken = this.generateInvitationToken(
            String(event.id),
            String(attendee.id)
          );

          const emailSent = await this.emailService.sendEventInvitation(
            attendee.email,
            this.getFullName(attendee),
            eventDetails,
            invitationToken
          );

          if (!emailSent) {
            return false;
          }

          // Mark the attendee's Json entry as invited (pending) on the event
          await this.updateEventAttendee(String(event.id), attendee.id, {
            status: "pending",
            invitedAt: new Date().toISOString(),
            invitationToken,
          });

          return true;
        },
        (attendee) => `Failed to send invitation to ${attendee.email}`
      );
    } catch (error) {
      return this.failureDispatchResult(
        attendeeIds.length,
        "Failed to send invitations",
        error
      );
    }
  }

  /**
   * Send event invitations to external email addresses (non-registered users)
   */
  async sendEventInvitationsToEmails(
    event: CalendarEmailEvent,
    organizer: CalendarEmailUser,
    emailAddresses: string[]
  ): Promise<EmailDispatchResult> {
    try {
      if (emailAddresses.length === 0) {
        return this.finalizeDispatchResult(this.createDispatchResult());
      }

      const organizerName = this.getFullName(organizer);
      const eventDetails = {
        ...this.buildEventEmailDetails(event),
        organizer: organizerName,
      };

      return this.dispatchEmails(
        emailAddresses,
        async (email) => {
          const invitationToken = this.generateExternalInvitationToken(
            String(event.id),
            email
          );

          return this.emailService.sendEventInvitation(
            email,
            this.getNameFromEmail(email),
            eventDetails,
            invitationToken
          );
        },
        (email) => `Failed to send invitation to ${email}`
      );
    } catch (error) {
      return this.failureDispatchResult(
        emailAddresses.length,
        "Failed to send invitations",
        error
      );
    }
  }

  /**
   * Send event reminders to attendees
   */
  async sendEventReminders(
    event: CalendarEmailEvent,
    reminderType: "1_hour" | "1_day" | "1_week"
  ): Promise<EmailDispatchResult> {
    try {
      const attendees = await this.loadAttendeeUsers(event, (attendee) =>
        ["accepted", "tentative"].includes(attendee.status)
      );

      if (attendees.length === 0) {
        return this.finalizeDispatchResult(this.createDispatchResult());
      }

      const eventDetails = this.buildEventEmailDetails(event);

      return this.dispatchEmails(
        attendees,
        (attendee) =>
          this.emailService.sendEventReminder(
            attendee.email,
            this.getFullName(attendee),
            eventDetails,
            reminderType
          ),
        (attendee) => `Failed to send reminder to ${attendee.email}`
      );
    } catch (error) {
      return this.failureDispatchResult(
        readAttendees(event as { attendees: unknown }).length,
        "Failed to send event reminders",
        error
      );
    }
  }

  /**
   * Send event cancellation notifications
   */
  async sendEventCancellation(
    event: CalendarEmailEvent,
    organizer: CalendarEmailUser,
    reason?: string
  ): Promise<EmailDispatchResult> {
    try {
      const attendees = await this.loadAttendeeUsers(event);

      if (attendees.length === 0) {
        return this.finalizeDispatchResult(this.createDispatchResult());
      }

      const organizerName = this.getFullName(organizer);
      const cancellationDetails = {
        title: event.title,
        startDate: new Date(event.startDate),
        location: this.formatLocationForEmail(
          event.location as IEventLocation | null
        ),
        organizer: organizerName,
        reason,
      };

      return this.dispatchEmails(
        attendees,
        (attendee) =>
          this.emailService.sendEventCancellation(
            attendee.email,
            this.getFullName(attendee),
            cancellationDetails
          ),
        (attendee) => `Failed to send cancellation to ${attendee.email}`
      );
    } catch (error) {
      return this.failureDispatchResult(
        readAttendees(event as { attendees: unknown }).length,
        "Failed to send event cancellations",
        error
      );
    }
  }

  /**
   * Send event update notifications
   */
  async sendEventUpdate(
    event: CalendarEmailEvent,
    organizer: CalendarEmailUser,
    changes: string[]
  ): Promise<EmailDispatchResult> {
    try {
      const attendees = await this.loadAttendeeUsers(event);

      if (attendees.length === 0) {
        return this.finalizeDispatchResult(this.createDispatchResult());
      }

      const organizerName = this.getFullName(organizer);
      const updateDetails = {
        title: event.title,
        startDate: new Date(event.startDate),
        endDate: event.endDate ? new Date(event.endDate) : undefined,
        location: this.formatLocationForEmail(
          event.location as IEventLocation | null
        ),
        organizer: organizerName,
        allDay: event.allDay,
      };

      return this.dispatchEmails(
        attendees,
        (attendee) =>
          this.emailService.sendEventUpdate(
            attendee.email,
            this.getFullName(attendee),
            updateDetails,
            changes
          ),
        (attendee) => `Failed to send update to ${attendee.email}`
      );
    } catch (error) {
      return this.failureDispatchResult(
        readAttendees(event as { attendees: unknown }).length,
        "Failed to send event updates",
        error
      );
    }
  }

  /**
   * Process RSVP response
   */
  async processRSVP(
    token: string,
    response: "accepted" | "declined" | "tentative"
  ): Promise<{
    success: boolean;
    event?: EventRow;
    attendee?:
      | UserRow
      | {
          email: string;
          firstName: string;
          lastName: string;
          isExternal: boolean;
        };
    isExternal?: boolean;
    email?: string;
    error?: string;
  }> {
    try {
      const tokenData = this.decodeInvitationTokenEnhanced(token);
      return await runWithCalendarInvitationContext(token, async () => {
        const event = await db.event.findFirst({
          where: { id: tokenData.eventId, deletedAt: null },
        });
        if (!event) {
          return { success: false, error: "Event not found" };
        }

        if (tokenData.external) {
          if (!tokenData.email) {
            return { success: false, error: "Invalid token: missing email" };
          }

          await this.emailService.sendRSVPConfirmation(
            tokenData.email,
            this.getNameFromEmail(tokenData.email),
            {
              title: event.title,
              startDate: new Date(event.startDate),
              location: this.formatLocationForEmail(
                event.location as IEventLocation | null
              ),
            },
            response,
          );

          return {
            success: true,
            event,
            attendee: {
              email: tokenData.email,
              firstName: this.getNameFromEmail(tokenData.email),
              lastName: "",
              isExternal: true,
            },
            isExternal: true,
            email: tokenData.email,
          };
        }

        const attendee = await db.user.findFirst({
          where: { id: tokenData.attendeeId },
        });
        if (!attendee) {
          return { success: false, error: "Attendee not found" };
        }

        // Record the response on the attendee's Json entry within the event
        await this.updateEventAttendee(
          tokenData.eventId,
          String(tokenData.attendeeId),
          {
            status: response,
            respondedAt: new Date().toISOString(),
            responseAt: new Date().toISOString(),
          }
        );

        // An attendee with no email address responded through a link someone
        // forwarded them; there is nowhere to send the confirmation, and the
        // response above is already recorded.
        if (!attendee.email) {
          return { success: true };
        }

        await this.emailService.sendRSVPConfirmation(
          attendee.email,
          this.getFullName(attendee),
          {
            title: event.title,
            startDate: new Date(event.startDate),
            location: this.formatLocationForEmail(
              event.location as IEventLocation | null
            ),
          },
          response,
        );

        return { success: true, event, attendee };
      });
    } catch (error) {
      return { success: false, error: this.toErrorMessage(error) };
    }
  }

  /**
   * Patch one attendee entry inside the event's attendees Json column.
   */
  async updateEventAttendee(
    eventId: string,
    userId: string,
    patch: Partial<EventAttendeeRecord> & Record<string, unknown>
  ): Promise<boolean> {
    const event = await db.event.findFirst({ where: { id: eventId } });
    if (!event) return false;

    const attendees = readAttendees(event);
    const index = attendees.findIndex(
      (attendee) => String(attendee.userId) === userId
    );
    if (index === -1) return false;

    const nextAttendees = [...attendees];
    nextAttendees[index] = { ...nextAttendees[index], ...patch };

    await db.event.update({
      where: { id: eventId },
      data: { attendees: nextAttendees as unknown as Prisma.InputJsonValue },
    });

    return true;
  }

  /**
   * Generate invitation token
   */
  private buildEventEmailDetails(event: CalendarEmailEvent) {
    return {
      title: event.title,
      description: event.description ?? undefined,
      startDate: new Date(event.startDate),
      endDate: event.endDate ? new Date(event.endDate) : undefined,
      location: this.formatLocationForEmail(
        event.location as IEventLocation | null
      ),
      type: event.type,
      allDay: event.allDay,
    };
  }

  private getFullName(user: CalendarEmailUser): string {
    const name = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
    return name || user.email || "Guest";
  }

  private getNameFromEmail(email: string): string {
    const [name] = email.split("@");
    return name || email;
  }

  private createDispatchResult(): EmailDispatchResult {
    return {
      success: true,
      sent: 0,
      failed: 0,
      errors: [],
    };
  }

  private finalizeDispatchResult(
    result: EmailDispatchResult
  ): EmailDispatchResult {
    result.success = result.failed === 0;
    return result;
  }

  private failureDispatchResult(
    failed: number,
    message: string,
    error?: unknown
  ): EmailDispatchResult {
    const reason = error
      ? `${message}: ${this.toErrorMessage(error)}`
      : message;

    return {
      success: false,
      sent: 0,
      failed,
      errors: [reason],
    };
  }

  private toErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message) {
      return error.message;
    }

    if (typeof error === "string") {
      return error;
    }

    return "Unexpected error";
  }

  /**
   * The users among these ids that can actually receive email.
   *
   * A person's email is optional — an owner or tenant recorded by phone and
   * national ID alone has none and never logs in — so the address is filtered
   * out in the query AND narrowed in the type, which is what lets every
   * dispatch below treat `user.email` as a string. Someone with no address is
   * not a failed send; they were never a recipient.
   */
  private async findUsersByIds(
    ids: Array<string | null | undefined>
  ): Promise<Array<UserRow & { email: string }>> {
    const normalizedIds = [
      ...new Set(
        ids
          .filter((id): id is string => Boolean(id))
          .map((id) => String(id))
      ),
    ];

    if (normalizedIds.length === 0) {
      return [];
    }

    const rows = await db.user.findMany({
      where: { id: { in: normalizedIds }, email: { not: null } },
    });
    return rows.filter(
      (row): row is UserRow & { email: string } => row.email !== null
    );
  }

  /** Emailable attendees only — see `findUsersByIds`. */
  private async loadAttendeeUsers(
    event: CalendarEmailEvent,
    predicate?: (attendee: EventAttendeeRecord) => boolean
  ): Promise<Array<UserRow & { email: string }>> {
    const ids = readAttendees(event as { attendees: unknown })
      .filter((attendee) => (predicate ? predicate(attendee) : true))
      .map((attendee) => String(attendee.userId));

    return this.findUsersByIds(ids);
  }

  private async dispatchEmails<T>(
    items: T[],
    sender: (item: T) => Promise<boolean>,
    failureMessage: (item: T) => string
  ): Promise<EmailDispatchResult> {
    const outcome = this.createDispatchResult();

    for (const item of items) {
      const failure = failureMessage(item);

      try {
        const delivered = await sender(item);

        if (delivered) {
          outcome.sent += 1;
        } else {
          outcome.failed += 1;
          outcome.errors.push(failure);
        }
      } catch (error) {
        outcome.failed += 1;
        outcome.errors.push(`${failure}: ${this.toErrorMessage(error)}`);
      }
    }

    return this.finalizeDispatchResult(outcome);
  }

  private generateInvitationToken(eventId: string, attendeeId: string): string {
    return createCalendarInvitationToken({ eventId, attendeeId });
  }

  /**
   * Generate invitation token for external users
   */
  private generateExternalInvitationToken(
    eventId: string,
    email: string
  ): string {
    return createCalendarInvitationToken({ eventId, email, external: true });
  }

  /**
   * Decode invitation token (legacy - for registered users only)
   */
  private decodeInvitationToken(token: string): {
    eventId: string;
    attendeeId: string;
  } {
    try {
      const payload = JSON.parse(Buffer.from(token, "base64").toString());
      return { eventId: payload.eventId, attendeeId: payload.attendeeId };
    } catch (error) {
      throw new Error("Invalid token format");
    }
  }

  /**
   * Enhanced token decoder that handles both registered and external users
   */
  private decodeInvitationTokenEnhanced(token: string): {
    eventId: string;
    attendeeId?: string;
    email?: string;
    external?: boolean;
    timestamp: number;
    organizationId: string;
  } {
    return verifyCalendarInvitationToken(token);
  }

  /**
   * Schedule automatic reminders for an event
   */
  async scheduleEventReminders(event: CalendarEmailEvent): Promise<void> {
    const eventStart = new Date(event.startDate);
    const now = new Date();

    const reminders = Array.isArray(event.reminders)
      ? (event.reminders as Array<{ minutesBefore: number }>)
      : [];

    // Schedule reminders based on event.reminders configuration
    for (const reminder of reminders) {
      const reminderTime = new Date(
        eventStart.getTime() - reminder.minutesBefore * 60 * 1000
      );

      if (reminderTime <= now) {
        continue;
      }

      // Hook for integrating a background scheduler.
    }
  }
}

// Export singleton instance
export const calendarEmailService = new CalendarEmailService();
