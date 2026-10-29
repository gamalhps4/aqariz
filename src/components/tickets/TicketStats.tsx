"use client";

import { useMemo } from "react";
import { Ticket, AlertCircle, Clock, CheckCircle2 } from "lucide-react";
import {
  AnalyticsCard,
  AnalyticsCardGrid,
} from "@/components/analytics/AnalyticsCard";
import { TicketStatus } from "@/types";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

interface TicketItem {
  _id: string;
  status: TicketStatus;
}

interface TicketStatsProps {
  tickets: TicketItem[];
}

export default function TicketStats({ tickets }: TicketStatsProps) {
  const { t } = useLocalizationContext();

  const stats = useMemo(() => {
    if (!tickets.length) {
      return {
        total: 0,
        open: 0,
        inProgress: 0,
        resolved: 0,
      };
    }

    return {
      total: tickets.length,
      open: tickets.filter((t) => t.status === TicketStatus.OPEN).length,
      inProgress: tickets.filter((t) => t.status === TicketStatus.IN_PROGRESS).length,
      resolved: tickets.filter((t) => t.status === TicketStatus.RESOLVED).length,
    };
  }, [tickets]);

  return (
    <AnalyticsCardGrid className="grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
      <AnalyticsCard
        title={t("tickets.stats.total")}
        value={stats.total}
        description={t("tickets.stats.totalDesc")}
        icon={Ticket}
        iconColor="primary"
      />

      <AnalyticsCard
        title={t("tickets.stats.open")}
        value={stats.open}
        description={t("tickets.stats.openDesc")}
        icon={AlertCircle}
        iconColor="warning"
      />

      <AnalyticsCard
        title={t("tickets.stats.inProgress")}
        value={stats.inProgress}
        description={t("tickets.stats.inProgressDesc")}
        icon={Clock}
        iconColor="info"
      />

      <AnalyticsCard
        title={t("tickets.stats.resolved")}
        value={stats.resolved}
        description={t("tickets.stats.resolvedDesc")}
        icon={CheckCircle2}
        iconColor="success"
      />
    </AnalyticsCardGrid>
  );
}
