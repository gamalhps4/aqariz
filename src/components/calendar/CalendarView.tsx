"use client";

import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import listPlugin from "@fullcalendar/list";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CalendarViewSkeleton } from "./CalendarViewSkeleton";
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  MapPin,
  AlertCircle,
  CheckCircle,
  XCircle,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { formatISO } from "date-fns";
import { EventForm } from "./EventForm";
import { CalendarSettings } from "./CalendarSettings";
import { GoogleCalendarSync } from "./GoogleCalendarSync";
import { IEvent, EventType, EventStatus, EventPriority } from "@/types";
import { useViewPreferencesStore } from "@/stores/view-preferences.store";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

interface CalendarViewProps {
  userId?: string;
  propertyIds?: string[];
  onEventClick?: (event: IEvent) => void;
  onCreateEvent?: (dateInfo?: {
    start: Date;
    end: Date;
    allDay: boolean;
  }) => void;
  className?: string;
  defaultView?: "dayGridMonth" | "timeGridWeek" | "timeGridDay" | "listWeek";
  height?: string | number;
  editable?: boolean;
  selectable?: boolean;
  showToolbar?: boolean;
  showFilters?: boolean;
  showSettings?: boolean;
}

interface CalendarData {
  events: IEvent[];
  eventsByDate: Record<string, IEvent[]>;
  stats: {
    totalEvents: number;
    eventsByType: Record<string, number>;
    eventsByStatus: Record<string, number>;
    upcomingEvents: number;
    pastEvents: number;
  };
}

interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end?: string;
  allDay?: boolean;
  backgroundColor?: string;
  borderColor?: string;
  textColor?: string;
  extendedProps: {
    type: EventType;
    status: EventStatus;
    priority: EventPriority;
    description?: string;
    location?: any;
    attendees?: any[];
    organizer?: any;
    propertyId?: string;
    tenantId?: string;
    originalEvent: IEvent;
  };
}

interface CalendarFilters {
  eventTypes: EventType[];
  eventStatuses: EventStatus[];
  propertyIds: string[];
  dateRange: {
    start: Date | null;
    end: Date | null;
  };
  searchQuery: string;
}

const eventTypeColors = {
  [EventType.LEASE_RENEWAL]: "#3b82f6", // Blue
  [EventType.PROPERTY_INSPECTION]: "#10b981", // Emerald
  [EventType.MAINTENANCE_APPOINTMENT]: "#f59e0b", // Amber
  [EventType.PROPERTY_SHOWING]: "#8b5cf6", // Violet
  [EventType.TENANT_MEETING]: "#6366f1", // Indigo
  [EventType.RENT_COLLECTION]: "#059669", // Emerald-600
  [EventType.MOVE_IN]: "#06b6d4", // Cyan
  [EventType.MOVE_OUT]: "#ef4444", // Red
  [EventType.GENERAL]: "#6b7280", // Gray
};

function getPlatformLabel(t: (key: string) => string, platform?: string) {
  switch (platform) {
    case "ZOOM":
      return t("calendar.platform.zoom");
    case "GOOGLE_MEET":
      return t("calendar.platform.googleMeet");
    case "MICROSOFT_TEAMS":
      return t("calendar.platform.microsoftTeams");
    case "WEBEX":
      return t("calendar.platform.webex");
    case "OTHER":
      return t("calendar.platform.other");
    default:
      return platform ? platform.replace(/_/g, " ") : "";
  }
}

const eventStatusIcons = {
  [EventStatus.SCHEDULED]: Clock,
  [EventStatus.CONFIRMED]: CheckCircle,
  [EventStatus.IN_PROGRESS]: AlertCircle,
  [EventStatus.COMPLETED]: CheckCircle,
  [EventStatus.CANCELLED]: XCircle,
  [EventStatus.RESCHEDULED]: Clock,
};

const eventStatusColors = {
  [EventStatus.SCHEDULED]: "#6b7280", // Gray
  [EventStatus.CONFIRMED]: "#10b981", // Emerald
  [EventStatus.IN_PROGRESS]: "#f59e0b", // Amber
  [EventStatus.COMPLETED]: "#059669", // Emerald-600
  [EventStatus.CANCELLED]: "#ef4444", // Red
  [EventStatus.RESCHEDULED]: "#8b5cf6", // Violet
};

export default function CalendarView({
  userId,
  propertyIds = [],
  onEventClick,
  onCreateEvent,
  className,
  defaultView = "dayGridMonth",
  height = "auto",
  editable = true,
  selectable = true,
  showToolbar = true,
  showFilters = true,
  showSettings = true,
}: CalendarViewProps) {
  const { t } = useLocalizationContext();

  const eventTypeLabelsMemo = useMemo(
    () => ({
      [EventType.LEASE_RENEWAL]: t("calendar.settings.events.typeLeaseRenewal"),
      [EventType.PROPERTY_INSPECTION]: t(
        "calendar.settings.events.typePropertyInspection",
      ),
      [EventType.MAINTENANCE_APPOINTMENT]: t(
        "calendar.settings.events.typeMaintenance",
      ),
      [EventType.PROPERTY_SHOWING]: t(
        "calendar.settings.events.typePropertyShowing",
      ),
      [EventType.TENANT_MEETING]: t(
        "calendar.settings.events.typeTenantMeeting",
      ),
      [EventType.RENT_COLLECTION]: t(
        "calendar.settings.events.typeRentCollection",
      ),
      [EventType.MOVE_IN]: t("calendar.settings.events.typeMoveIn"),
      [EventType.MOVE_OUT]: t("calendar.settings.events.typeMoveOut"),
      [EventType.GENERAL]: t("calendar.settings.events.typeGeneral"),
    }),
    [t],
  );

  // Refs
  const calendarRef = useRef<FullCalendar>(null);
  const isMountedRef = useRef(true);

  // State - Use Zustand store for view preference
  const currentView = useViewPreferencesStore((state) => state.calendarView);
  const setCurrentView = useViewPreferencesStore(
    (state) => state.setCalendarView,
  );
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);

  // Use ref to track last fetch params to prevent infinite loops
  const lastFetchParamsRef = useRef<string>("");
  const fetchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [showEventDialog, setShowEventDialog] = useState(false);
  const [showEventForm, setShowEventForm] = useState(false);
  const [showSettingsDialog, setShowSettingsDialog] = useState(false);
  const [showGoogleSync, setShowGoogleSync] = useState(false);
  const [editingEvent, setEditingEvent] = useState<IEvent | null>(null);

  // Filters
  const [filters, setFilters] = useState<CalendarFilters>({
    eventTypes: [],
    eventStatuses: [],
    propertyIds: [],
    dateRange: { start: null, end: null },
    searchQuery: "",
  });

  // Update filters when propertyIds prop changes
  useEffect(() => {
    setFilters((prev) => {
      // Only update if propertyIds actually changed
      if (JSON.stringify(prev.propertyIds) !== JSON.stringify(propertyIds)) {
        return {
          ...prev,
          propertyIds: propertyIds,
        };
      }
      return prev;
    });
  }, [propertyIds]);

  // Cleanup timeout on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (fetchTimeoutRef.current) {
        clearTimeout(fetchTimeoutRef.current);
      }
    };
  }, []);

  // Calendar settings
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
    firstDay: 0, // Sunday
  });

  // Convert IEvent to CalendarEvent format
  const convertToCalendarEvent = useCallback((event: IEvent): CalendarEvent => {
    return {
      id: event._id?.toString() ?? "",
      title: event.title,
      start: formatISO(new Date(event.startDate)),
      end: event.endDate ? formatISO(new Date(event.endDate)) : undefined,
      allDay: event.allDay ?? false,
      backgroundColor: eventTypeColors[event.type],
      borderColor: eventStatusColors[event.status],
      textColor: "#ffffff",
      extendedProps: {
        type: event.type,
        status: event.status,
        priority: event.priority,
        description: event.description,
        location: event.location,
        attendees: event.attendees,
        organizer: event.organizer,
        propertyId: event.propertyId?.toString(),
        tenantId: event.tenantId?.toString(),
        originalEvent: event,
      },
    };
  }, []);

  // Fetch events from API
  const fetchEvents = useCallback(
    async (start: Date, end: Date) => {
      // Create a unique key for this fetch request
      const fetchKey = `${formatISO(start)}-${formatISO(end)}-${JSON.stringify({
        types: filters.eventTypes,
        statuses: filters.eventStatuses,
        properties: filters.propertyIds,
        search: filters.searchQuery,
      })}`;

      // Prevent duplicate calls
      if (fetchKey === lastFetchParamsRef.current) {
        return;
      }

      // Clear any existing timeout
      if (fetchTimeoutRef.current) {
        clearTimeout(fetchTimeoutRef.current);
      }

      // Debounce the fetch call
      fetchTimeoutRef.current = setTimeout(async () => {
        // Check if component is still mounted
        if (!isMountedRef.current) {
          return;
        }

        lastFetchParamsRef.current = fetchKey;
        setLoading(true);

        try {
          const params = new URLSearchParams({
            startDate: formatISO(start),
            endDate: formatISO(end),
          });

          // Apply filters
          if (filters.eventTypes.length > 0) {
            filters.eventTypes.forEach((type) => params.append("type", type));
          }
          if (filters.eventStatuses.length > 0) {
            filters.eventStatuses.forEach((status) =>
              params.append("status", status),
            );
          }
          if (filters.propertyIds.length > 0) {
            filters.propertyIds.forEach((id) =>
              params.append("propertyId", id),
            );
          }
          if (filters.searchQuery) {
            params.append("search", filters.searchQuery);
          }

          const response = await fetch(`/api/calendar/events?${params}`);
          if (!response.ok) {
            throw new Error("Failed to fetch events");
          }

          const result = await response.json();

          // Check if component is still mounted before updating state
          if (!isMountedRef.current) {
            return;
          }

          const calendarEvents = (result?.data?.events ?? []).map(
            (event: IEvent) => convertToCalendarEvent(event),
          );
          setEvents(calendarEvents);
        } catch (error) {
          console.error("Error fetching events:", error);
          if (isMountedRef.current) {
            toast.error(t("calendar.toast.loadFailed"));
          }
        } finally {
          if (isMountedRef.current) {
            setLoading(false);
          }
        }
      }, 300); // Increased debounce to 300ms to prevent rapid calls
    },
    [
      filters.eventTypes,
      filters.eventStatuses,
      filters.propertyIds,
      filters.searchQuery,
      // Removed convertToCalendarEvent from dependencies to prevent infinite loops
      // Removed filters.dateRange as it's not used in the function
    ],
  );

  // Event handlers
  const handleEventClick = useCallback(
    (clickInfo: any) => {
      const event = clickInfo.event;
      const originalEvent = event.extendedProps.originalEvent;
      // Only call the parent's event click handler
      onEventClick?.(originalEvent);
    },
    [onEventClick],
  );

  const handleDateSelect = useCallback(
    (selectInfo: any) => {
      if (!selectable) return;

      const { start, end, allDay } = selectInfo;

      if (onCreateEvent) {
        // Use external event creation handler with date info
        onCreateEvent({ start, end, allDay });
      } else {
        // Use internal event creation modal
        setEditingEvent({
          startDate: start,
          endDate: end,
          allDay,
        } as IEvent);
        setShowEventForm(true);
      }
    },
    [selectable, onCreateEvent],
  );

  const handleEventDrop = useCallback(
    async (dropInfo: any) => {
      if (!editable) return;

      const event = dropInfo.event;
      const originalEvent = event.extendedProps.originalEvent;

      try {
        const updatedEvent = {
          ...originalEvent,
          startDate: event.start,
          endDate: event.end,
        };

        const eventId = originalEvent._id ?? event.id;
        const response = await fetch(`/api/calendar/events/${eventId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updatedEvent),
        });

        if (!response.ok) {
          throw new Error("Failed to update event");
        }

        toast.success(t("calendar.toast.eventUpdated"));
        // Refresh events
        const calendarApi = calendarRef.current?.getApi();
        if (calendarApi) {
          const view = calendarApi.view;
          fetchEvents(view.activeStart, view.activeEnd);
        }
      } catch (error) {
        console.error("Error updating event:", error);
        toast.error(t("calendar.toast.updateEventFailed"));
        dropInfo.revert();
      }
    },
    [editable, fetchEvents],
  );

  const handleEventResize = useCallback(
    async (resizeInfo: any) => {
      if (!editable) return;

      const event = resizeInfo.event;
      const originalEvent = event.extendedProps.originalEvent;

      try {
        const updatedEvent = {
          ...originalEvent,
          startDate: event.start,
          endDate: event.end,
        };

        const eventId = originalEvent._id ?? event.id;
        const response = await fetch(`/api/calendar/events/${eventId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updatedEvent),
        });

        if (!response.ok) {
          throw new Error("Failed to update event");
        }

        toast.success(t("calendar.toast.eventUpdated"));
      } catch (error) {
        console.error("Error updating event:", error);
        toast.error(t("calendar.toast.updateEventFailed"));
        resizeInfo.revert();
      }
    },
    [editable],
  );

  const handleDatesSet = useCallback(
    (dateInfo: any) => {
      fetchEvents(dateInfo.start, dateInfo.end);
    },
    [fetchEvents],
  );

  // Calendar navigation
  const navigateCalendar = useCallback((action: "prev" | "next" | "today") => {
    const calendarApi = calendarRef.current?.getApi();
    if (calendarApi) {
      switch (action) {
        case "prev":
          calendarApi.prev();
          break;
        case "next":
          calendarApi.next();
          break;
        case "today":
          calendarApi.today();
          break;
      }
    }
  }, []);

  const changeView = useCallback((view: string) => {
    const calendarApi = calendarRef.current?.getApi();
    if (calendarApi) {
      calendarApi.changeView(view);
      setCurrentView(view as any);
    }
  }, []);

  // Event CRUD operations
  const createEvent = useCallback(
    async (eventData: any) => {
      try {
        const response = await fetch("/api/calendar/events", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(eventData),
        });

        if (!response.ok) {
          throw new Error("Failed to create event");
        }

        const result = await response.json();
        toast.success(t("calendar.toast.eventCreated"));

        // Refresh events
        const calendarApi = calendarRef.current?.getApi();
        if (calendarApi) {
          const view = calendarApi.view;
          fetchEvents(view.activeStart, view.activeEnd);
        }

        setShowEventForm(false);
        setEditingEvent(null);
        return result?.data;
      } catch (error) {
        console.error("Error creating event:", error);
        toast.error(t("calendar.toast.createEventFailed"));
        throw error;
      }
    },
    [fetchEvents],
  );

  const updateEvent = useCallback(
    async (eventId: string, eventData: any) => {
      try {
        const response = await fetch(`/api/calendar/events/${eventId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(eventData),
        });

        if (!response.ok) {
          throw new Error("Failed to update event");
        }

        const result = await response.json();
        toast.success(t("calendar.toast.eventUpdated"));

        // Refresh events
        const calendarApi = calendarRef.current?.getApi();
        if (calendarApi) {
          const view = calendarApi.view;
          fetchEvents(view.activeStart, view.activeEnd);
        }

        setShowEventForm(false);
        setEditingEvent(null);
        return result?.data;
      } catch (error) {
        console.error("Error updating event:", error);
        toast.error(t("calendar.toast.updateEventFailed"));
        throw error;
      }
    },
    [fetchEvents],
  );

  // DISABLED: Delete functionality temporarily disabled
  // const deleteEvent = useCallback(
  //   async (eventId: string) => {
  //     try {
  //       const response = await fetch(`/api/calendar/events/${eventId}`, {
  //         method: "DELETE",
  //       });

  //       if (!response.ok) {
  //         throw new Error("Failed to delete event");
  //       }

  //       toast.success("Event deleted successfully");

  //       // Refresh events
  //       const calendarApi = calendarRef.current?.getApi();
  //       if (calendarApi) {
  //         const view = calendarApi.view;
  //         fetchEvents(view.activeStart, view.activeEnd);
  //       }
  //     } catch (error) {
  //       console.error("Error deleting event:", error);
  //       toast.error("Failed to delete event");
  //       throw error;
  //     }
  //   },
  //   [fetchEvents]
  // );

  // Utility functions
  const getEventTypeLabel = (type: EventType) => {
    return eventTypeLabelsMemo[type] ?? type.replace(/_/g, " ");
  };

  const getStatusColor = (status: EventStatus) => {
    switch (status) {
      case EventStatus.SCHEDULED:
        return "bg-blue-100 text-blue-800";
      case EventStatus.CONFIRMED:
        return "bg-green-100 text-green-800";
      case EventStatus.IN_PROGRESS:
        return "bg-yellow-100 text-yellow-800";
      case EventStatus.COMPLETED:
        return "bg-emerald-100 text-emerald-800";
      case EventStatus.CANCELLED:
        return "bg-red-100 text-red-800";
      case EventStatus.RESCHEDULED:
        return "bg-orange-100 text-orange-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  // Filter functions
  const applyFilters = useCallback((newFilters: Partial<CalendarFilters>) => {
    setFilters((prev) => ({ ...prev, ...newFilters }));
  }, []);

  const clearFilters = useCallback(() => {
    setFilters((prev) => ({
      eventTypes: [],
      eventStatuses: [],
      propertyIds: prev.propertyIds, // Keep current propertyIds
      dateRange: { start: null, end: null },
      searchQuery: "",
    }));
  }, []);

  if (loading) {
    return <CalendarViewSkeleton />;
  }

  return (
    <div className={`space-y-4 ${className}`}>
      <Card>
        {/* Header */}
        {showToolbar && (
          <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center justify-between">
            <div className="space-y-1">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                {t("calendar.header.title")}
              </h2>
              <p className="text-gray-600 dark:text-gray-400">
                {t("calendar.header.subtitleAdmin")}
              </p>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              {/* View Selector */}
              <Select value={currentView} onValueChange={changeView}>
                <SelectTrigger className="w-40 border-gray-200 dark:border-gray-700 focus:border-blue-500 focus:ring-blue-500/20 bg-white dark:bg-gray-800">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-gray-200 dark:border-gray-700">
                  <SelectItem value="dayGridMonth">
                    {t("calendar.settings.display.viewMonth")}
                  </SelectItem>
                  <SelectItem value="timeGridWeek">
                    {t("calendar.settings.display.viewWeek")}
                  </SelectItem>
                  <SelectItem value="timeGridDay">
                    {t("calendar.settings.display.viewDay")}
                  </SelectItem>
                  <SelectItem value="listWeek">
                    {t("calendar.settings.display.viewAgenda")}
                  </SelectItem>
                </SelectContent>
              </Select>

              {/* Navigation */}
              <div className="flex items-center gap-1 bg-gray-50 dark:bg-gray-800 rounded-lg p-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigateCalendar("prev")}
                  className="h-8 w-8 p-0 hover:bg-white dark:hover:bg-gray-700 rounded-md"
                >
                  <ChevronLeft className="h-4 w-4 rtl:-scale-x-100" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigateCalendar("today")}
                  className="h-8 px-3 hover:bg-white dark:hover:bg-gray-700 rounded-md font-medium"
                >
                  {t("calendar.nav.today")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigateCalendar("next")}
                  className="h-8 w-8 p-0 hover:bg-white dark:hover:bg-gray-700 rounded-md"
                >
                  <ChevronRight className="h-4 w-4 rtl:-scale-x-100" />
                </Button>
              </div>
            </div>
          </CardHeader>
        )}
        {/* Main Calendar */}

        <CardContent>
          <div className="calendar-container bg-white dark:bg-gray-900">
            <FullCalendar
              ref={calendarRef}
              plugins={[
                dayGridPlugin,
                timeGridPlugin,
                interactionPlugin,
                listPlugin,
              ]}
              initialView={defaultView}
              headerToolbar={false} // We handle toolbar ourselves
              height={height}
              events={events}
              editable={editable}
              selectable={selectable}
              selectMirror={true}
              dayMaxEvents={true}
              weekends={calendarSettings.weekends}
              businessHours={calendarSettings.businessHours}
              slotDuration={calendarSettings.slotDuration}
              snapDuration={calendarSettings.snapDuration}
              firstDay={calendarSettings.firstDay}
              timeZone={calendarSettings.timezone}
              // Event handlers
              eventClick={handleEventClick}
              select={handleDateSelect}
              eventDrop={handleEventDrop}
              eventResize={handleEventResize}
              datesSet={handleDatesSet}
              // Styling
              eventDisplay="block"
              eventBackgroundColor="transparent"
              eventBorderColor="transparent"
              eventTextColor="#ffffff"
              // Custom event content
              eventContent={(eventInfo) => {
                const { event } = eventInfo;
                const { status } = event.extendedProps;
                const StatusIcon =
                  eventStatusIcons[status as EventStatus] || Clock;

                return (
                  <div className="fc-event-content p-1 rounded text-xs">
                    <div className="flex items-center gap-1">
                      <StatusIcon className="h-3 w-3 flex-shrink-0" />
                      <span className="truncate font-medium">
                        {event.title}
                      </span>
                    </div>
                    {event.extendedProps.location && (
                      <div className="flex items-center gap-1 mt-1 opacity-90">
                        <MapPin className="h-2 w-2 flex-shrink-0" />
                        <span className="truncate text-xs">
                          {typeof event.extendedProps.location === "string"
                            ? event.extendedProps.location
                            : event.extendedProps.location.type === "physical"
                              ? event.extendedProps.location.address
                              : event.extendedProps.location.platform
                                ? `${t("calendar.details.onlineMeeting")} (${getPlatformLabel(
                                    t,
                                    event.extendedProps.location.platform,
                                  )})`
                                : t("calendar.details.onlineMeeting")}
                        </span>
                      </div>
                    )}
                  </div>
                );
              }}
            />
          </div>
        </CardContent>
      </Card>

      {/* Event Form Dialog */}
      <Dialog open={showEventForm} onOpenChange={setShowEventForm}>
        <DialogContent className="max-w-5xl w-[95vw] max-h-[80vh] md:max-h-[75vh] lg:max-h-[70vh] overflow-y-auto md:overflow-y-visible lg:overflow-y-visible">
          <DialogHeader className="pb-4">
            <DialogTitle className="text-lg font-semibold">
              {editingEvent?._id
                ? t("calendar.eventForm.editTitle")
                : t("calendar.eventForm.createTitle")}
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              {editingEvent?._id
                ? t("calendar.eventForm.editDescription")
                : t("calendar.eventForm.createDescription")}
            </DialogDescription>
          </DialogHeader>
          <EventForm
            initialData={
              editingEvent
                ? {
                    ...editingEvent,
                    propertyId: editingEvent.propertyId?.toString(),
                    tenantId: editingEvent.tenantId?.toString(),
                    leaseId: editingEvent.leaseId?.toString(),
                    maintenanceRequestId:
                      editingEvent.maintenanceRequestId?.toString(),
                  }
                : undefined
            }
            onSubmit={
              editingEvent?._id
                ? (data) => updateEvent(editingEvent._id.toString(), data)
                : createEvent
            }
            onCancel={() => {
              setShowEventForm(false);
              setEditingEvent(null);
            }}
            loading={loading}
          />
        </DialogContent>
      </Dialog>

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

      {/* Loading Overlay */}
      {loading && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4 animate-spin" />
            <span>{t("calendar.loading.events")}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// Add CSS for FullCalendar styling
const calendarStyles = `
  .calendar-container .fc {
    font-family: inherit;
    --fc-border-color: #e5e7eb;
    --fc-today-bg-color: #eff6ff;
  }

  .dark .calendar-container .fc {
    --fc-border-color: #374151;
    --fc-today-bg-color: #1e3a8a;
  }

  .calendar-container .fc-toolbar {
    margin-bottom: 1rem;
  }

  .calendar-container .fc-button {
    background: #3b82f6;
    border-color: #3b82f6;
    color: white;
    border-radius: 0.5rem;
    font-weight: 500;
    padding: 0.5rem 1rem;
    transition: all 0.2s ease;
  }

  .calendar-container .fc-button:hover {
    background: #2563eb;
    border-color: #2563eb;
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
  }

  .calendar-container .fc-button:disabled {
    background: #f3f4f6;
    border-color: #e5e7eb;
    color: #9ca3af;
    transform: none;
    box-shadow: none;
  }

  .calendar-container .fc-event {
    border-radius: 0.5rem;
    border: none;
    font-size: 0.75rem;
    font-weight: 500;
    padding: 0.25rem 0.5rem;
    margin: 2px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    transition: all 0.2s ease;
  }

  .calendar-container .fc-event:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  }

  .calendar-container .fc-daygrid-event {
    margin: 2px 3px;
    border-radius: 0.375rem;
  }

  .calendar-container .fc-timegrid-event {
    border-radius: 0.375rem;
    margin: 1px;
  }

  .calendar-container .fc-day-today {
    background: var(--fc-today-bg-color) !important;
    border-color: #3b82f6 !important;
  }

  .calendar-container .fc-col-header-cell {
    background: #f8fafc;
    border-color: #e2e8f0;
    font-weight: 600;
    color: #475569;
    padding: 0.75rem 0.5rem;
    font-size: 0.875rem;
  }

  .dark .calendar-container .fc-col-header-cell {
    background: #1e293b;
    color: #cbd5e1;
    border-color: #334155;
  }

  .calendar-container .fc-scrollgrid {
    border-color: var(--fc-border-color);
    border-radius: 0.75rem;
    overflow: hidden;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  }

  .calendar-container .fc-scrollgrid td,
  .calendar-container .fc-scrollgrid th {
    border-color: var(--fc-border-color);
  }

  .calendar-container .fc-daygrid-day {
    background: white;
    transition: background-color 0.2s ease;
  }

  .dark .calendar-container .fc-daygrid-day {
    background: #111827;
  }

  .calendar-container .fc-daygrid-day:hover {
    background: #f8fafc;
  }

  .dark .calendar-container .fc-daygrid-day:hover {
    background: #1f2937;
  }

  .calendar-container .fc-daygrid-day-number {
    color: #374151;
    font-weight: 500;
    padding: 0.5rem;
    font-size: 0.875rem;
  }

  .dark .calendar-container .fc-daygrid-day-number {
    color: #d1d5db;
  }

  .calendar-container .fc-day-other .fc-daygrid-day-number {
    color: #9ca3af;
  }

  .dark .calendar-container .fc-day-other .fc-daygrid-day-number {
    color: #6b7280;
  }
`;

// Inject styles
if (typeof document !== "undefined") {
  const styleElement = document.createElement("style");
  styleElement.textContent = calendarStyles;
  document.head.appendChild(styleElement);
}
