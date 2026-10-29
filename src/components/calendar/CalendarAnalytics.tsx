"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EventType, EventStatus } from "@/types";
import { Skeleton } from "@/components/ui/skeleton";
import React, { useState, useEffect, useMemo } from "react";
import { AlertCircle, CheckCircle, Info } from "lucide-react";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

interface CalendarStats {
  totalEvents: number;
  upcomingEvents: number;
  todayEvents: number;
  pendingRSVPs: number;
  eventsByType: Record<string, number>;
  eventsByStatus: Record<string, number>;
}

export function CalendarAnalytics() {
  const [stats, setStats] = useState<CalendarStats | null>(null);
  const [loading, setLoading] = useState(true);
  const isMountedRef = React.useRef(true);
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

  const getStatusLabel = (status: string) => {
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

  useEffect(() => {
    isMountedRef.current = true;
    loadStats();
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const loadStats = async () => {
    try {
      const response = await fetch("/api/calendar/stats");
      if (response.ok && isMountedRef.current) {
        const result = await response.json();
        if (isMountedRef.current) {
          setStats(result?.data ?? null);
        }
      }
    } catch (error) {
      console.error("Failed to load calendar stats:", error);
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  };

  const getStatusColor = (status: string) => {
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

  const getTypeColor = (type: string) => {
    const colors: Record<string, string> = {
      [EventType.LEASE_RENEWAL]: "bg-blue-500",
      [EventType.PROPERTY_INSPECTION]: "bg-green-500",
      [EventType.MAINTENANCE_APPOINTMENT]: "bg-orange-500",
      [EventType.PROPERTY_SHOWING]: "bg-purple-500",
      [EventType.TENANT_MEETING]: "bg-indigo-500",
      [EventType.RENT_COLLECTION]: "bg-emerald-500",
      [EventType.MOVE_IN]: "bg-cyan-500",
      [EventType.MOVE_OUT]: "bg-red-500",
      [EventType.GENERAL]: "bg-gray-500",
    };
    return colors[type] ?? "bg-gray-500";
  };

  if (loading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Event Types Distribution Skeleton */}
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-4 w-48" />
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Skeleton className="w-3 h-3 rounded-full" />
                    <Skeleton className="h-4 w-24" />
                  </div>
                  <Skeleton className="h-5 w-8 rounded-full" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Event Status Distribution Skeleton */}
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-4 w-40" />
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-4 w-4" />
                    <Skeleton className="h-4 w-20" />
                  </div>
                  <Skeleton className="h-5 w-8 rounded-full" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!stats) {
    return null;
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Event Types Distribution */}
      <Card className="gap-3">
        <CardHeader>
          <CardTitle>{t("calendar.analytics.types.title")}</CardTitle>
          <CardDescription>
            {t("calendar.analytics.types.description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {Object.entries(stats.eventsByType).map(([type, count]) => (
              <div key={type} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div
                    className={`w-3 h-3 rounded-full ${getTypeColor(type)}`}
                  />
                  <span className="text-sm font-medium">
                    {eventTypeLabelsMemo[type as EventType] ||
                      type.replace(/_/g, " ")}
                  </span>
                </div>
                <Badge variant="secondary">{count}</Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Event Status Distribution */}
      <Card className="gap-3">
        <CardHeader>
          <CardTitle>{t("calendar.analytics.status.title")}</CardTitle>
          <CardDescription>
            {t("calendar.analytics.status.description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {Object.entries(stats.eventsByStatus).map(([status, count]) => (
              <div key={status} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {status === EventStatus.COMPLETED && (
                    <CheckCircle className="h-4 w-4 text-green-500" />
                  )}
                  {status === EventStatus.CANCELLED && (
                    <AlertCircle className="h-4 w-4 text-red-500" />
                  )}
                  {![EventStatus.COMPLETED, EventStatus.CANCELLED].includes(
                    status as EventStatus,
                  ) && <Info className="h-4 w-4 text-blue-500" />}
                  <span className="text-sm font-medium">
                    {getStatusLabel(status)}
                  </span>
                </div>
                <Badge className={getStatusColor(status)}>{count}</Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
