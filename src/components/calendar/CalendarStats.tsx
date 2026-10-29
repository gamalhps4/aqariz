"use client";

import React, { useState, useEffect } from "react";
import {
  AnalyticsCard,
  AnalyticsCardGrid,
} from "@/components/analytics/AnalyticsCard";
import { CalendarDays, Clock, TrendingUp, Users } from "lucide-react";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

interface CalendarStatsData {
  totalEvents: number;
  upcomingEvents: number;
  todayEvents: number;
  pendingRSVPs: number;
  eventsByType: Record<string, number>;
  eventsByStatus: Record<string, number>;
}

const defaultStats: CalendarStatsData = {
  totalEvents: 0,
  upcomingEvents: 0,
  todayEvents: 0,
  pendingRSVPs: 0,
  eventsByType: {},
  eventsByStatus: {},
};

export function CalendarStats() {
  const { t } = useLocalizationContext();
  const [stats, setStats] = useState<CalendarStatsData>(defaultStats);
  const isMountedRef = React.useRef(true);

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
          setStats(result?.data ?? defaultStats);
        }
      }
    } catch (error) {
      console.error("Failed to load calendar stats:", error);
    }
  };

  return (
    <AnalyticsCardGrid className="md:grid-cols-2 lg:grid-cols-4">
      <AnalyticsCard
        title={t("calendar.stats.total", { defaultValue: "All events" })}
        value={stats.totalEvents}
        icon={CalendarDays}
        iconColor="primary"
      />
      <AnalyticsCard
        title={t("calendar.stats.upcoming", { defaultValue: "Upcoming" })}
        value={stats.upcomingEvents}
        icon={Clock}
        iconColor="success"
      />
      <AnalyticsCard
        title={t("calendar.stats.today", { defaultValue: "Today" })}
        value={stats.todayEvents}
        icon={TrendingUp}
        iconColor="warning"
      />
      <AnalyticsCard
        title={t("calendar.stats.pendingRsvp", { defaultValue: "Awaiting replies" })}
        value={stats.pendingRSVPs}
        icon={Users}
        iconColor="info"
      />
    </AnalyticsCardGrid>
  );
}
