"use client";

import React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Clock,
  MapPin,
  Users,
  Calendar,
  Edit,
  Trash2,
  Copy,
  Mail,
  MoreVertical,
  User,
  Building2,
  AlertTriangle,
  CheckCircle,
  XCircle,
} from "lucide-react";
import { IEvent, EventType, EventStatus, EventPriority } from "@/types";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { formatDate, formatTime } from "@/lib/utils/formatting";

interface EventDetailsDialogProps {
  event: IEvent;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit?: (event: IEvent) => void;
  onDelete?: (eventId: string) => void;
  onDuplicate?: (event: IEvent) => void;
  onSendReminder?: (event: IEvent) => void;
}

const eventTypeColors = {
  [EventType.LEASE_RENEWAL]: "#3b82f6",
  [EventType.PROPERTY_INSPECTION]: "#10b981",
  [EventType.MAINTENANCE_APPOINTMENT]: "#f59e0b",
  [EventType.PROPERTY_SHOWING]: "#8b5cf6",
  [EventType.TENANT_MEETING]: "#6366f1",
  [EventType.RENT_COLLECTION]: "#059669",
  [EventType.MOVE_IN]: "#06b6d4",
  [EventType.MOVE_OUT]: "#ef4444",
  [EventType.GENERAL]: "#6b7280",
};

const eventStatusIcons = {
  [EventStatus.SCHEDULED]: Clock,
  [EventStatus.CONFIRMED]: CheckCircle,
  [EventStatus.IN_PROGRESS]: AlertTriangle,
  [EventStatus.COMPLETED]: CheckCircle,
  [EventStatus.CANCELLED]: XCircle,
  [EventStatus.RESCHEDULED]: Clock,
};

const getStatusColor = (status: EventStatus) => {
  switch (status) {
    case EventStatus.SCHEDULED:
      return "bg-blue-100 text-blue-800 border-blue-200";
    case EventStatus.CONFIRMED:
      return "bg-green-100 text-green-800 border-green-200";
    case EventStatus.IN_PROGRESS:
      return "bg-yellow-100 text-yellow-800 border-yellow-200";
    case EventStatus.COMPLETED:
      return "bg-emerald-100 text-emerald-800 border-emerald-200";
    case EventStatus.CANCELLED:
      return "bg-red-100 text-red-800 border-red-200";
    case EventStatus.RESCHEDULED:
      return "bg-orange-100 text-orange-800 border-orange-200";
    default:
      return "bg-gray-100 text-gray-800 border-gray-200";
  }
};

const getPriorityColor = (priority: EventPriority) => {
  switch (priority) {
    case EventPriority.HIGH:
      return "bg-red-100 text-red-800 border-red-200";
    case EventPriority.MEDIUM:
      return "bg-yellow-100 text-yellow-800 border-yellow-200";
    case EventPriority.LOW:
      return "bg-green-100 text-green-800 border-green-200";
    default:
      return "bg-gray-100 text-gray-800 border-gray-200";
  }
};

export function EventDetailsDialog({
  event,
  open,
  onOpenChange,
  onEdit,
  onDelete,
  onDuplicate,
  onSendReminder,
}: EventDetailsDialogProps) {
  const [showDeleteDialog, setShowDeleteDialog] = React.useState(false);
  const StatusIcon = eventStatusIcons[event.status];
  const { t } = useLocalizationContext();

  const formatEventTime = (event: IEvent) => {
    if (event.allDay) return t("calendar.details.allDay");
    const start = formatTime(new Date(event.startDate));
    const end = event.endDate ? formatTime(new Date(event.endDate)) : "";
    return end ? `${start} - ${end}` : start;
  };

  const getEventTypeLabel = (type: EventType) => {
    switch (type) {
      case EventType.GENERAL:
        return t("calendar.settings.events.typeGeneral");
      case EventType.PROPERTY_SHOWING:
        return t("calendar.settings.events.typePropertyShowing");
      case EventType.PROPERTY_INSPECTION:
        return t("calendar.settings.events.typePropertyInspection");
      case EventType.MAINTENANCE_APPOINTMENT:
        return t("calendar.settings.events.typeMaintenance");
      case EventType.TENANT_MEETING:
        return t("calendar.settings.events.typeTenantMeeting");
      case EventType.LEASE_RENEWAL:
        return t("calendar.settings.events.typeLeaseRenewal");
      case EventType.RENT_COLLECTION:
        return t("calendar.settings.events.typeRentCollection");
      case EventType.MOVE_IN:
        return t("calendar.settings.events.typeMoveIn");
      case EventType.MOVE_OUT:
        return t("calendar.settings.events.typeMoveOut");
      default:
        return String(type).replace(/_/g, " ");
    }
  };

  const getStatusLabel = (status: EventStatus) => {
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
  };

  const getPlatformLabel = (platform?: string) => {
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
        return platform ? platform.replace("_", " ") : "";
    }
  };

  const handleDelete = () => {
    if (onDelete) {
      onDelete(event._id.toString());
    }
    setShowDeleteDialog(false);
    onOpenChange(false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <DialogTitle className="text-xl font-semibold pe-8">
                  {event.title}
                </DialogTitle>
                <DialogDescription asChild>
                  <div className="mt-1 flex items-center gap-2">
                    <span
                      className="w-3 h-3 rounded-full inline-block"
                      style={{ backgroundColor: eventTypeColors[event.type] }}
                    />
                    <span className="text-sm">
                      {getEventTypeLabel(event.type)}
                    </span>
                  </div>
                </DialogDescription>
              </div>

              {/* Only show action menu if user has edit/delete permissions */}
              {(onEdit || onDelete || onDuplicate || onSendReminder) && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {onEdit && (
                      <DropdownMenuItem onClick={() => onEdit(event)}>
                        <Edit className="h-4 w-4 me-2" />
                        {t("calendar.actions.editEvent")}
                      </DropdownMenuItem>
                    )}
                    {onDuplicate && (
                      <DropdownMenuItem onClick={() => onDuplicate(event)}>
                        <Copy className="h-4 w-4 me-2" />
                        {t("calendar.actions.duplicateEvent")}
                      </DropdownMenuItem>
                    )}
                    {onSendReminder && (
                      <DropdownMenuItem onClick={() => onSendReminder(event)}>
                        <Mail className="h-4 w-4 me-2" />
                        {t("calendar.actions.sendReminder")}
                      </DropdownMenuItem>
                    )}
                    {onDelete && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => setShowDeleteDialog(true)}
                          className="text-red-600 focus:text-red-600"
                        >
                          <Trash2 className="h-4 w-4 me-2" />
                          {t("calendar.actions.delete")}
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </DialogHeader>

          <div className="space-y-6">
            {/* Status and Priority */}
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <StatusIcon className="h-4 w-4" />
                <Badge className={getStatusColor(event.status)}>
                  {getStatusLabel(event.status)}
                </Badge>
              </div>
              <Badge className={getPriorityColor(event.priority)}>
                {t(
                  event.priority === EventPriority.HIGH
                    ? "calendar.priority.high"
                    : event.priority === EventPriority.MEDIUM
                    ? "calendar.priority.medium"
                    : event.priority === EventPriority.LOW
                    ? "calendar.priority.low"
                    : "calendar.priority.urgent"
                )}
              </Badge>
            </div>

            {/* Date and Time */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Calendar className="h-4 w-4" />
                  {t("calendar.details.date")}
                </div>
                <p className="text-sm text-muted-foreground">
                  {formatDate(new Date(event.startDate), { format: "long" })}
                </p>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Clock className="h-4 w-4" />
                  {t("calendar.details.time")}
                </div>
                <p className="text-sm text-muted-foreground">
                  {formatEventTime(event)}
                </p>
              </div>
            </div>

            {/* Location */}
            {event.location && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <MapPin className="h-4 w-4" />
                  {t("calendar.details.location")}
                </div>
                <div className="text-sm text-muted-foreground">
                  {event.location.type === "physical" ? (
                    <div>
                      <p>{event.location.address}</p>
                      {event.unitNumber && (
                        <p className="text-xs text-muted-foreground">
                          {t("calendar.details.unit")} {event.unitNumber}
                        </p>
                      )}
                    </div>
                  ) : (
                    <div>
                      <p className="font-medium">
                        {t("calendar.details.onlineMeeting")}
                      </p>
                      {event.location.platform && (
                        <p className="text-xs">
                          {t("calendar.details.platform")}:{" "}
                          {getPlatformLabel(event.location.platform)}
                        </p>
                      )}
                      {event.location.meetingLink && (
                        <a
                          href={event.location.meetingLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:text-blue-800 underline break-all"
                        >
                          {event.location.meetingLink}
                        </a>
                      )}
                      {event.location.meetingId && (
                        <p className="text-xs">
                          {t("calendar.details.meetingId")}:{" "}
                          {event.location.meetingId}
                        </p>
                      )}
                      {event.location.passcode && (
                        <p className="text-xs">
                          {t("calendar.details.passcode")}:{" "}
                          {event.location.passcode}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Property Information */}
            {event.propertyId && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Building2 className="h-4 w-4" />
                  {t("calendar.details.property")}
                </div>
                <p className="text-sm text-muted-foreground">
                  {t("calendar.details.property")} ID:{" "}
                  {event.propertyId.toString()}
                  {event.unitNumber &&
                    ` - ${t("calendar.details.unit")} ${event.unitNumber}`}
                </p>
              </div>
            )}

            {/* Description */}
            {event.description && (
              <div className="space-y-2">
                <div className="text-sm font-medium">
                  {t("calendar.details.description")}
                </div>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                  {event.description}
                </p>
              </div>
            )}

            {/* Attendees */}
            {event.attendees && event.attendees.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Users className="h-4 w-4" />
                  {t("calendar.details.attendees")} ({event.attendees.length})
                </div>
                <div className="space-y-2">
                  {event.attendees.map((attendee, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between p-2 rounded-lg border"
                    >
                      <div className="flex items-center gap-2">
                        <User className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <p className="text-sm font-medium">{attendee.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {attendee.email}
                          </p>
                        </div>
                      </div>
                      <Badge variant="outline" className="text-xs">
                        {attendee.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Notes */}
            {event.notes && (
              <div className="space-y-2">
                <div className="text-sm font-medium">
                  {t("calendar.details.notes")}
                </div>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                  {event.notes}
                </p>
              </div>
            )}

            {/* Metadata */}
            <Separator />
            <div className="text-xs text-muted-foreground">
              <p>
                {t("calendar.details.created")}:{" "}
                {formatDate(new Date(event.createdAt), { format: "medium" })}{" "}
                {t("calendar.word.at")} {formatTime(new Date(event.createdAt))}
              </p>
              {event.updatedAt && (
                <p>
                  {t("calendar.details.updated")}:{" "}
                  {formatDate(new Date(event.updatedAt), { format: "medium" })}{" "}
                  {t("calendar.word.at")}{" "}
                  {formatTime(new Date(event.updatedAt))}
                </p>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("calendar.confirm.deleteTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("calendar.confirm.deleteDescription", { title: event.title } as any)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-red-600 hover:bg-red-700"
            >
              {t("calendar.actions.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
