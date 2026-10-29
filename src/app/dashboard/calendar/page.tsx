"use client";

import { useSession } from "@/lib/auth-client";
import FullCalendar from "@fullcalendar/react";
import { useSearchParams } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Calendar,
  MoreVertical,
  Settings,
  Download,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { IEvent } from "@/types";
import { EventForm } from "@/components/calendar/EventForm";
import { EventList } from "@/components/calendar/EventList";
import CalendarView from "@/components/calendar/CalendarView";
import { CalendarStats } from "@/components/calendar/CalendarStats";
import React, { useState, useEffect, useRef, Suspense } from "react";
import { CalendarSettings } from "@/components/calendar/CalendarSettings";
import { CalendarAnalytics } from "@/components/calendar/CalendarAnalytics";
import { EventDetailsDialog } from "@/components/calendar/EventDetailsDialog";
import { GoogleCalendarSync } from "@/components/calendar/GoogleCalendarSync";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { useAuthorization } from "@/hooks/useAuthorization";

export default function CalendarPage() {
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const { isTenant } = useAuthorization();
  const { t } = useLocalizationContext();

  const [selectedEvent, setSelectedEvent] = useState<IEvent | null>(null);
  const [showEventForm, setShowEventForm] = useState(false);
  const [showEventDetails, setShowEventDetails] = useState(false);
  const [eventToEdit, setEventToEdit] = useState<IEvent | null>(null);
  const [activeTab, setActiveTab] = useState("calendar");
  const [showGoogleSync, setShowGoogleSync] = useState(false);
  const [showSettingsDialog, setShowSettingsDialog] = useState(false);
  const [calendarSettings, setCalendarSettings] = useState({
    weekends: true,
    businessHours: {
      startTime: "09:00",
      endTime: "17:00",
    },
    defaultEventDuration: "01:00",
    slotDuration: "00:30",
    snapDuration: "00:15",
    timezone: "local",
    firstDay: 0,
  });
  const calendarRef = useRef<FullCalendar | null>(null);

  const canCreateEvents = !isTenant; // Only admin and manager can create events

  // Handle URL parameters for success/error messages
  useEffect(() => {
    const success = searchParams.get("success");
    const error = searchParams.get("error");

    if (success === "google_connected") {
      toast.success(t("calendar.toast.googleConnected"));
    } else if (error === "oauth_failed") {
      toast.error(t("calendar.toast.oauthFailed"));
    } else if (error === "token_exchange_failed") {
      toast.error(t("calendar.toast.tokenExchangeFailed"));
    } else if (error === "callback_failed") {
      toast.error(t("calendar.toast.callbackFailed"));
    }

    // Clean up URL parameters
    if (success || error) {
      const url = new URL(window.location.href);
      url.searchParams.delete("success");
      url.searchParams.delete("error");
      window.history.replaceState({}, "", url.toString());
    }
  }, [searchParams, t]);

  const fetchEvents = async (start: Date, end: Date) => {
    // Fetch events for the specified date range
  };

  const handleEventClick = (event: IEvent) => {
    setSelectedEvent(event);
    setShowEventDetails(true);
  };

  const handleCreateEvent = (dateInfo?: {
    start: Date;
    end: Date;
    allDay: boolean;
  }) => {
    // Prevent tenants from creating events
    if (isTenant) {
      toast.error(t("calendar.toast.noCreatePermission"), {
        description: t("calendar.toast.noCreatePermissionDesc"),
      });
      return;
    }

    if (dateInfo) {
      // Pre-populate form with selected date/time
      setEventToEdit({
        startDate: dateInfo.start,
        endDate: dateInfo.end,
        allDay: dateInfo.allDay,
      } as IEvent);
    } else {
      setEventToEdit(null);
    }
    setShowEventForm(true);
  };

  const handleEventEdit = (event: IEvent) => {
    // Prevent tenants from editing events
    if (isTenant) {
      toast.error(t("calendar.toast.noEditPermission"), {
        description: t("calendar.toast.noEditPermissionDesc"),
      });
      return;
    }

    setEventToEdit(event);
    setShowEventForm(true);
  };

  const handleEventView = (event: IEvent) => {
    setSelectedEvent(event);
    setShowEventDetails(true);
  };

  const handleEventDelete = async (event: IEvent) => {
    // Prevent tenants from deleting events
    if (isTenant) {
      toast.error(t("calendar.toast.noDeletePermission"), {
        description: t("calendar.toast.noDeletePermissionDesc"),
      });
      return;
    }

    try {
      const response = await fetch(`/api/calendar/events/${event._id}`, {
        method: "DELETE",
      });

      if (response.ok) {
        toast.success(t("calendar.toast.eventDeleted"));
        setShowEventDetails(false);
        setSelectedEvent(null);
        // Refresh the page to update all views
        window.location.reload();
      } else {
        toast.error(t("calendar.toast.deleteEventFailed"));
      }
    } catch {
      toast.error(t("calendar.toast.deleteEventFailed"));
    }
  };

  return (
    <div className="space-y-6 p-6 bg-gray-50/30 dark:bg-gray-900/30 min-h-screen">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("calendar.header.title")}
            {isTenant && (
              <span className="ms-3 text-sm font-normal text-gray-500 dark:text-gray-400">
                {t("calendar.header.viewOnly")}
              </span>
            )}
          </h1>
          <p className="text-sm text-muted-foreground">
            {isTenant
              ? t("calendar.header.subtitleTenant")
              : t("calendar.header.subtitleAdmin")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Only show New Event button for admin and manager */}
          {canCreateEvents && (
            <Button
              size="sm"
              onClick={() => handleCreateEvent()}
              className="bg-blue-600 hover:bg-blue-700 text-white shadow-lg hover:shadow-xl transition-all duration-200 border-0"
            >
              <Calendar className="h-4 w-4 me-2" />
              {t("calendar.header.newEvent")}
            </Button>
          )}
          {/* Only show action menu for admin and manager */}
          {canCreateEvents && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="border-gray-200 dark:border-gray-700"
              >
                <DropdownMenuLabel className="text-gray-900 dark:text-gray-100">
                  {t("calendar.header.calendarOptions")}
                </DropdownMenuLabel>
                <DropdownMenuSeparator className="bg-gray-200 dark:bg-gray-700" />
                <DropdownMenuItem
                  onClick={() => setShowSettingsDialog(true)}
                  className="hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  <Settings className="h-4 w-4 me-2" />
                  {t("calendar.header.settings")}
                </DropdownMenuItem>
                {/* <DropdownMenuItem
                onClick={() => setShowGoogleSync(true)}
                className="hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                <RefreshCw className="h-4 w-4 me-2" />
                Google Calendar
              </DropdownMenuItem> */}
                <DropdownMenuSeparator className="bg-gray-200 dark:bg-gray-700" />
                <DropdownMenuItem className="hover:bg-gray-50 dark:hover:bg-gray-800">
                  <Download className="h-4 w-4 me-2" />
                  {t("calendar.header.export")}
                </DropdownMenuItem>
                <DropdownMenuItem className="hover:bg-gray-50 dark:hover:bg-gray-800">
                  <Upload className="h-4 w-4 me-2" />
                  {t("calendar.header.import")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* Quick Stats */}
      <Suspense fallback={<div>{t("calendar.loading.stats")}</div>}>
        <CalendarStats />
      </Suspense>

      {/* Main Content */}
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="space-y-8"
      >
        <TabsList className="grid w-full grid-cols-3 bg-gray-100 dark:bg-gray-800 p-1 rounded-xl border-0">
          <TabsTrigger
            value="calendar"
            className="rounded-lg data-[state=active]:bg-white dark:data-[state=active]:bg-gray-700 data-[state=active]:shadow-sm font-medium transition-all duration-200"
          >
            {t("calendar.tabs.calendarView")}
          </TabsTrigger>
          <TabsTrigger
            value="events"
            className="rounded-lg data-[state=active]:bg-white dark:data-[state=active]:bg-gray-700 data-[state=active]:shadow-sm font-medium transition-all duration-200"
          >
            {t("calendar.tabs.eventList")}
          </TabsTrigger>
          <TabsTrigger
            value="analytics"
            className="rounded-lg data-[state=active]:bg-white dark:data-[state=active]:bg-gray-700 data-[state=active]:shadow-sm font-medium transition-all duration-200"
          >
            {t("calendar.tabs.analytics")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="calendar" className="space-y-4 mt-4">
          <CalendarView
            onEventClick={handleEventClick}
            onCreateEvent={canCreateEvents ? handleCreateEvent : undefined}
            editable={canCreateEvents}
            selectable={canCreateEvents}
            className="min-h-[600px]"
          />
        </TabsContent>

        <TabsContent value="events" className="space-y-4 mt-4">
          <EventList
            onEventEdit={canCreateEvents ? handleEventEdit : undefined}
            onEventView={handleEventView}
            onEventCreate={
              canCreateEvents ? () => handleCreateEvent() : undefined
            }
          />
        </TabsContent>

        <TabsContent value="analytics" className="space-y-4 mt-4">
          <Suspense
            fallback={
              <div className="flex items-center justify-center py-12">
                <div className="text-gray-500">
                  {t("calendar.loading.analytics")}
                </div>
              </div>
            }
          >
            <CalendarAnalytics />
          </Suspense>
        </TabsContent>
      </Tabs>

      {/* Event Form Modal */}
      {showEventForm && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-4xl h-[90vh] border-0 shadow-2xl bg-white dark:bg-gray-900 flex flex-col">
            <CardHeader className="border-b border-gray-100 dark:border-gray-800">
              <CardTitle className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                {eventToEdit?._id
                  ? t("calendar.eventForm.editTitle")
                  : t("calendar.eventForm.createTitle")}
              </CardTitle>
              <CardDescription className="text-gray-600 dark:text-gray-400">
                {eventToEdit?._id
                  ? t("calendar.eventForm.editDescription")
                  : t("calendar.eventForm.createDescription")}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex-1 overflow-hidden p-6">
              <EventForm
                initialData={
                  eventToEdit
                    ? {
                        title: eventToEdit.title,
                        description: eventToEdit.description,
                        type: eventToEdit.type,
                        priority: eventToEdit.priority,
                        startDate: new Date(eventToEdit.startDate),
                        startTime: new Date(eventToEdit.startDate)
                          .toTimeString()
                          .slice(0, 5),
                        endDate: new Date(eventToEdit.endDate),
                        endTime: new Date(eventToEdit.endDate)
                          .toTimeString()
                          .slice(0, 5),
                        allDay: eventToEdit.allDay,
                        locationType: eventToEdit.location?.type,
                        locationAddress: eventToEdit.location?.address,
                        onlinePlatform: eventToEdit.location?.platform,
                        meetingLink: eventToEdit.location?.meetingLink,
                        meetingId: eventToEdit.location?.meetingId,
                        passcode: eventToEdit.location?.passcode,
                        unitNumber: eventToEdit.unitNumber,
                        propertyId: eventToEdit.propertyId?.toString(),
                        tenantId: eventToEdit.tenantId?.toString(),
                        leaseId: eventToEdit.leaseId?.toString(),
                        maintenanceRequestId:
                          eventToEdit.maintenanceRequestId?.toString(),
                        attendeeEmails:
                          eventToEdit.attendees
                            ?.filter((attendee) => attendee.email)
                            .map((attendee) => attendee.email)
                            .join(", ") || "",
                        notes: eventToEdit.notes,
                      }
                    : undefined
                }
                onSubmit={async (data) => {
                  // Determine if this is an edit or create operation based on _id presence
                  const eventId =
                    eventToEdit?._id ||
                    (eventToEdit as IEvent & { id?: string })?.id;

                  const isEditOperation = !!eventId;

                  try {
                    if (isEditOperation && !eventId) {
                      toast.error(t("calendar.toast.invalidEventId"));
                      return;
                    }

                    const url = isEditOperation
                      ? `/api/calendar/events/${eventId}`
                      : "/api/calendar/events";
                    const method = isEditOperation ? "PUT" : "POST";

                    const response = await fetch(url, {
                      method,
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(data),
                    });

                    if (response.ok) {
                      toast.success(
                        isEditOperation
                          ? t("calendar.toast.eventUpdated")
                          : t("calendar.toast.eventCreated"),
                      );
                      setShowEventForm(false);
                      setEventToEdit(null);
                      // Refresh calendar
                      window.location.reload();
                    } else {
                      const result = await response.json();
                      toast.error(
                        result?.error ||
                          (isEditOperation
                            ? t("calendar.toast.updateEventFailed")
                            : t("calendar.toast.createEventFailed")),
                      );
                    }
                  } catch {
                    toast.error(
                      isEditOperation
                        ? t("calendar.toast.updateEventFailed")
                        : t("calendar.toast.createEventFailed"),
                    );
                  }
                }}
                onCancel={() => {
                  setShowEventForm(false);
                  setEventToEdit(null);
                }}
                loading={false}
              />
            </CardContent>
          </Card>
        </div>
      )}

      {/* Event Details Dialog */}
      {selectedEvent && (
        <EventDetailsDialog
          event={selectedEvent}
          open={showEventDetails}
          onOpenChange={setShowEventDetails}
          onEdit={canCreateEvents ? handleEventEdit : undefined}
          onDelete={
            canCreateEvents
              ? () => {
                  if (selectedEvent) {
                    handleEventDelete(selectedEvent);
                  }
                }
              : undefined
          }
          onDuplicate={
            canCreateEvents
              ? (event: IEvent) => {
                  // Create a copy of the event for duplication
                  const eventCopy = {
                    title: `${event.title} ${t("calendar.actions.copySuffix")}`,
                    description: event.description,
                    type: event.type,
                    priority: event.priority,
                    startDate: event.startDate,
                    endDate: event.endDate,
                    allDay: event.allDay,
                    location: event.location,
                    unitNumber: event.unitNumber,
                    propertyId: event.propertyId,
                    tenantId: event.tenantId,
                    leaseId: event.leaseId,
                    maintenanceRequestId: event.maintenanceRequestId,
                    notes: event.notes,
                  } as IEvent;
                  setEventToEdit(eventCopy);
                  setShowEventForm(true);
                  setShowEventDetails(false);
                }
              : undefined
          }
        />
      )}

      {/* Calendar Settings Dialog */}
      <CalendarSettings
        open={showSettingsDialog}
        onOpenChange={setShowSettingsDialog}
        settings={calendarSettings}
        onSettingsChange={setCalendarSettings}
      />

      {/* Google Calendar Sync Dialog */}
      <GoogleCalendarSync
        open={showGoogleSync}
        onOpenChange={setShowGoogleSync}
        onSyncComplete={() => {
          // Refresh events after sync
          const calendarApi = calendarRef.current?.getApi();
          if (calendarApi) {
            const view = calendarApi.view;
            fetchEvents(view.activeStart, view.activeEnd);
          }
        }}
      />
    </div>
  );
}
