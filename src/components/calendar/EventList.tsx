"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Calendar,
  Clock,
  MapPin,
  Users,
  MoreVertical,
  Edit,
  Trash2,
  Eye,
  CheckCircle,
  XCircle,
  AlertCircle,
  Search,
  Filter,
  RefreshCw,
  Plus,
} from "lucide-react";
import { toast } from "sonner";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { formatDate, formatTime } from "@/lib/utils/formatting";
import { IEvent, EventType, EventStatus, EventPriority } from "@/types";
import { EventListSkeleton } from "./EventListSkeleton";
import { businessDayEnd, businessDayStart, businessPresetRange } from "@/lib/dates/business-day";

interface EventListProps {
  onEventEdit?: (event: IEvent) => void;
  onEventView?: (event: IEvent) => void;
  onEventCreate?: () => void;
  className?: string;
}

interface EventFilters {
  search: string;
  type: EventType | "all";
  status: EventStatus | "all";
  priority: EventPriority | "all";
  dateRange: "all" | "today" | "week" | "month";
}

function getStatusLabel(t: (key: string) => string, status: EventStatus) {
  switch (status) {
    case EventStatus.SCHEDULED:
      return t("calendar.status.scheduled");
    case EventStatus.CONFIRMED:
      return t("calendar.status.confirmed");
    case EventStatus.IN_PROGRESS:
      return t("calendar.status.inProgress");
    case EventStatus.COMPLETED:
      return t("calendar.status.completed");
    case EventStatus.CANCELLED:
      return t("calendar.status.cancelled");
    case EventStatus.RESCHEDULED:
      return t("calendar.status.rescheduled");
    default:
      return String(status).replace(/_/g, " ");
  }
}

function getPriorityLabel(t: (key: string) => string, priority: EventPriority) {
  switch (priority) {
    case EventPriority.HIGH:
      return t("calendar.priority.high");
    case EventPriority.MEDIUM:
      return t("calendar.priority.medium");
    case EventPriority.LOW:
      return t("calendar.priority.low");
    case EventPriority.URGENT:
      return t("calendar.priority.urgent");
    default:
      return String(priority).replace(/_/g, " ");
  }
}

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

const eventStatusColors = {
  [EventStatus.SCHEDULED]: "bg-blue-100 text-blue-800",
  [EventStatus.CONFIRMED]: "bg-green-100 text-green-800",
  [EventStatus.IN_PROGRESS]: "bg-yellow-100 text-yellow-800",
  [EventStatus.COMPLETED]: "bg-emerald-100 text-emerald-800",
  [EventStatus.CANCELLED]: "bg-red-100 text-red-800",
  [EventStatus.RESCHEDULED]: "bg-purple-100 text-purple-800",
};

const priorityColors = {
  [EventPriority.LOW]: "bg-gray-100 text-gray-800",
  [EventPriority.MEDIUM]: "bg-blue-100 text-blue-800",
  [EventPriority.HIGH]: "bg-orange-100 text-orange-800",
  [EventPriority.URGENT]: "bg-red-100 text-red-800",
};

export function EventList({
  onEventEdit,
  onEventView,
  onEventCreate,
  className,
}: EventListProps) {
  const { t } = useLocalizationContext();
  const [events, setEvents] = useState<IEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<EventFilters>({
    search: "",
    type: "all",
    status: "all",
    priority: "all",
    dateRange: "all",
  });
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [eventToDelete, setEventToDelete] = useState<IEvent | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

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

  // Add refs to prevent memory leaks and duplicate calls
  const isMountedRef = React.useRef(true);
  const loadTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);

  const loadEvents = useCallback(async () => {
    // Clear any existing timeout
    if (loadTimeoutRef.current) {
      clearTimeout(loadTimeoutRef.current);
    }

    // Debounce the load call
    loadTimeoutRef.current = setTimeout(async () => {
      if (!isMountedRef.current) {
        return;
      }

      try {
        setLoading(true);
        const params = new URLSearchParams();

        if (filters.type !== "all") params.append("type", filters.type);
        if (filters.status !== "all") params.append("status", filters.status);
        if (filters.priority !== "all")
          params.append("priority", filters.priority);
        if (filters.search) params.append("search", filters.search);

        // Add date range filters
        if (filters.dateRange !== "all") {
          // Today, this week (from its Sunday) or this month — the days on the
          // office's calendar, whatever zone the browser is set to.
          const { from, to } = businessPresetRange(filters.dateRange);

          params.append("startDate", businessDayStart(from).toISOString());
          params.append("endDate", businessDayEnd(to).toISOString());
        }

        // Add pagination to get more events
        params.append("limit", "100"); // Get up to 100 events

        const response = await fetch(
          `/api/calendar/events?${params.toString()}`,
        );

        if (!isMountedRef.current) {
          return;
        }

        if (response.ok) {
          const result = await response.json();

          // Handle different response structures
          let eventsData = [];
          if (result?.data?.events) {
            // Paginated response structure
            eventsData = result.data.events;
          } else if (Array.isArray(result?.data)) {
            // Direct array in data
            eventsData = result.data;
          } else if (Array.isArray(result)) {
            // Direct array response
            eventsData = result;
          } else if (result.events) {
            // Events property
            eventsData = result.events;
          }

          if (isMountedRef.current) {
            setEvents(Array.isArray(eventsData) ? eventsData : []);
          }
        } else {
          if (isMountedRef.current) {
            toast.error(
              t("calendar.toast.loadFailed") ||
                t("calendar.toast.updateEventFailed"),
            );
            setEvents([]);
          }
        }
      } catch (error) {
        console.error("Error loading events:", error);
        if (isMountedRef.current) {
          toast.error(
            t("calendar.toast.loadFailed") ||
              t("calendar.toast.updateEventFailed"),
          );
          setEvents([]);
        }
      } finally {
        if (isMountedRef.current) {
          setLoading(false);
        }
      }
    }, 250); // 250ms debounce
  }, [
    filters.search,
    filters.type,
    filters.status,
    filters.priority,
    filters.dateRange,
    t,
  ]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  // Cleanup effect
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (loadTimeoutRef.current) {
        clearTimeout(loadTimeoutRef.current);
      }
    };
  }, []);

  const handleStatusChange = async (
    eventId: string,
    newStatus: EventStatus,
  ) => {
    try {
      setActionLoading(eventId);
      const response = await fetch(`/api/calendar/events/${eventId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });

      if (response.ok) {
        toast.success(t("calendar.toast.eventUpdated"));
        loadEvents();
      } else {
        toast.error(t("calendar.toast.updateEventFailed"));
      }
    } catch (error) {
      console.error("Error updating event status:", error);
      toast.error(t("calendar.toast.updateEventFailed"));
    } finally {
      setActionLoading(null);
    }
  };

  // DISABLED: Delete functionality temporarily disabled
  // const handleDeleteEvent = async () => {
  //   if (!eventToDelete) return;

  //   try {
  //     setActionLoading(eventToDelete._id.toString());
  //     const response = await fetch(
  //       `/api/calendar/events/${eventToDelete._id}`,
  //       {
  //         method: "DELETE",
  //       }
  //     );

  //     if (response.ok) {
  //       toast.success("Event deleted successfully");
  //       loadEvents();
  //       setDeleteDialogOpen(false);
  //       setEventToDelete(null);
  //     } else {
  //       toast.error("Failed to delete event");
  //     }
  //   } catch (error) {
  //     console.error("Error deleting event:", error);
  //     toast.error("Failed to delete event");
  //   } finally {
  //     setActionLoading(null);
  //   }
  // };

  const filteredEvents = (Array.isArray(events) ? events : []).filter(
    (event) => {
      if (filters.search) {
        const searchLower = filters.search.toLowerCase();
        const locationText = event.location
          ? event.location.type === "physical"
            ? (event.location.address ?? "")
            : (event.location.meetingLink ?? "")
          : "";

        return (
          event.title.toLowerCase().includes(searchLower) ||
          event.description?.toLowerCase().includes(searchLower) ||
          locationText.toLowerCase().includes(searchLower)
        );
      }
      return true;
    },
  );

  const getStatusIcon = (status: EventStatus) => {
    switch (status) {
      case EventStatus.COMPLETED:
        return <CheckCircle className="h-4 w-4" />;
      case EventStatus.CANCELLED:
        return <XCircle className="h-4 w-4" />;
      case EventStatus.IN_PROGRESS:
        return <AlertCircle className="h-4 w-4" />;
      default:
        return <Clock className="h-4 w-4" />;
    }
  };

  if (loading) {
    return <EventListSkeleton />;
  }

  return (
    <div className={`space-y-6 ${className}`}>
      <Card>
        {/* Header and Filters */}
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <h2 className="text-2xl font-bold">{t("calendar.list.title")}</h2>
              <p className="text-muted-foreground">
                {t("calendar.list.subtitle")}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={loadEvents} variant="outline" size="sm">
                <RefreshCw className="h-4 w-4 me-2" />
                {t("calendar.actions.refresh")}
              </Button>
              {onEventCreate && (
                <Button onClick={onEventCreate} size="sm">
                  <Plus className="h-4 w-4 me-2" />
                  {t("calendar.header.newEvent")}
                </Button>
              )}
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <Search className="absolute start-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={t("calendar.filters.searchPlaceholder")}
                  value={filters.search}
                  onChange={(e) =>
                    setFilters((prev) => ({ ...prev, search: e.target.value }))
                  }
                  className="ps-10"
                />
              </div>
            </div>

            <Select
              value={filters.type}
              onValueChange={(value) =>
                setFilters((prev) => ({
                  ...prev,
                  type: value as EventType | "all",
                }))
              }
            >
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder={t("calendar.filters.type")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  {t("calendar.filters.allTypes")}
                </SelectItem>
                {Object.entries(eventTypeLabelsMemo).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={filters.status}
              onValueChange={(value) =>
                setFilters((prev) => ({
                  ...prev,
                  status: value as EventStatus | "all",
                }))
              }
            >
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder={t("calendar.filters.status")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  {t("calendar.filters.allStatus")}
                </SelectItem>
                {Object.values(EventStatus).map((status) => (
                  <SelectItem key={status} value={status}>
                    {getStatusLabel(t, status as EventStatus)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={filters.dateRange}
              onValueChange={(value) =>
                setFilters((prev) => ({ ...prev, dateRange: value as any }))
              }
            >
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder={t("calendar.filters.dateRange")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  {t("calendar.filters.allTime")}
                </SelectItem>
                <SelectItem value="today">
                  {t("calendar.filters.today")}
                </SelectItem>
                <SelectItem value="week">
                  {t("calendar.filters.week")}
                </SelectItem>
                <SelectItem value="month">
                  {t("calendar.filters.month")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>

        {/* Events List */}
        <CardContent className="space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="h-6 w-6 animate-spin me-2" />
              <span>{t("calendar.loading.events")}</span>
            </div>
          ) : filteredEvents.length === 0 ? (
            <Card>
              <CardContent className="text-center">
                <Calendar className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p className="text-muted-foreground">
                  {t("calendar.empty.noEvents")}
                </p>
                <p className="text-sm text-muted-foreground">
                  {t("calendar.empty.tryAdjustFilters")}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {filteredEvents.map((event) => (
                <Card
                  key={event._id.toString()}
                  className="hover:shadow-md transition-shadow"
                >
                  <CardContent>
                    <div className="flex items-start justify-between">
                      <div className="flex-1 space-y-3">
                        {/* Event Header */}
                        <div className="flex items-start gap-3">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <h3 className="font-semibold text-lg">
                                {event.title}
                              </h3>
                              <Badge
                                className={eventStatusColors[event.status]}
                              >
                                {getStatusIcon(event.status)}
                                <span className="ms-1">
                                  {getStatusLabel(t, event.status)}
                                </span>
                              </Badge>
                              <Badge
                                variant="outline"
                                className={priorityColors[event.priority]}
                              >
                                {getPriorityLabel(t, event.priority)}
                              </Badge>
                            </div>
                            <p className="text-sm text-muted-foreground mb-2">
                              {eventTypeLabelsMemo[event.type]}
                            </p>
                            {event.description && (
                              <p className="text-sm text-muted-foreground line-clamp-2">
                                {event.description}
                              </p>
                            )}
                          </div>
                        </div>

                        {/* Event Details */}
                        <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                          <div className="flex items-center gap-1">
                            <Clock className="h-4 w-4" />
                            <span>
                              {formatDate(new Date(event.startDate), {
                                format: "medium",
                              })}{" "}
                              {t("calendar.word.at")}{" "}
                              {formatTime(new Date(event.startDate))}
                              {event.endDate && (
                                <span>
                                  {" "}
                                  - {formatTime(new Date(event.endDate))}
                                </span>
                              )}
                            </span>
                          </div>

                          {event.location && (
                            <div className="flex items-center gap-1">
                              <MapPin className="h-4 w-4" />
                              <span>
                                {event.location.type === "physical"
                                  ? event.location.address
                                  : event.location.platform
                                    ? `${t(
                                        "calendar.details.onlineMeeting",
                                      )} (${getPlatformLabel(
                                        t,
                                        event.location.platform,
                                      )})`
                                    : t("calendar.details.onlineMeeting")}
                              </span>
                            </div>
                          )}

                          {event.attendees && event.attendees.length > 0 && (
                            <div className="flex items-center gap-1">
                              <Users className="h-4 w-4" />
                              <span>
                                {event.attendees.length}{" "}
                                {t("calendar.details.attendees")}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Actions */}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={actionLoading === event._id.toString()}
                          >
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel>
                            {t("calendar.actions.actions")}
                          </DropdownMenuLabel>
                          <DropdownMenuSeparator />

                          {onEventView && (
                            <DropdownMenuItem
                              onClick={() => onEventView(event)}
                            >
                              <Eye className="h-4 w-4 me-2" />
                              {t("calendar.actions.viewDetails")}
                            </DropdownMenuItem>
                          )}

                          {onEventEdit && (
                            <DropdownMenuItem
                              onClick={() => onEventEdit(event)}
                            >
                              <Edit className="h-4 w-4 me-2" />
                              {t("calendar.actions.editEvent")}
                            </DropdownMenuItem>
                          )}

                          <DropdownMenuSeparator />

                          {/* Status Actions */}
                          {event.status === EventStatus.SCHEDULED && (
                            <DropdownMenuItem
                              onClick={() =>
                                handleStatusChange(
                                  event._id.toString(),
                                  EventStatus.CONFIRMED,
                                )
                              }
                            >
                              <CheckCircle className="h-4 w-4 me-2" />
                              {t("calendar.actions.confirm")}
                            </DropdownMenuItem>
                          )}

                          {[
                            EventStatus.SCHEDULED,
                            EventStatus.CONFIRMED,
                          ].includes(event.status) && (
                            <DropdownMenuItem
                              onClick={() =>
                                handleStatusChange(
                                  event._id.toString(),
                                  EventStatus.IN_PROGRESS,
                                )
                              }
                            >
                              <AlertCircle className="h-4 w-4 me-2" />
                              {t("calendar.actions.startEvent")}
                            </DropdownMenuItem>
                          )}

                          {event.status === EventStatus.IN_PROGRESS && (
                            <DropdownMenuItem
                              onClick={() =>
                                handleStatusChange(
                                  event._id.toString(),
                                  EventStatus.COMPLETED,
                                )
                              }
                            >
                              <CheckCircle className="h-4 w-4 me-2" />
                              {t("calendar.actions.complete")}
                            </DropdownMenuItem>
                          )}

                          {![
                            EventStatus.COMPLETED,
                            EventStatus.CANCELLED,
                          ].includes(event.status) && (
                            <DropdownMenuItem
                              onClick={() =>
                                handleStatusChange(
                                  event._id.toString(),
                                  EventStatus.CANCELLED,
                                )
                              }
                              className="text-red-600"
                            >
                              <XCircle className="h-4 w-4 me-2" />
                              {t("calendar.actions.cancel")}
                            </DropdownMenuItem>
                          )}

                          {/* DISABLED: Delete functionality temporarily disabled */}
                          {/* <DropdownMenuSeparator />

                        <DropdownMenuItem
                          onClick={() => {
                            setEventToDelete(event);
                            setDeleteDialogOpen(true);
                          }}
                          className="text-red-600"
                        >
                          <Trash2 className="h-4 w-4 me-2" />
                          Delete
                        </DropdownMenuItem> */}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* DISABLED: Delete functionality temporarily disabled */}
      {/* <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Event</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{eventToDelete?.title}"? This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteEvent}
              className="bg-red-600 hover:bg-red-700"
              disabled={actionLoading !== null}
            >
              {actionLoading ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog> */}
    </div>
  );
}
