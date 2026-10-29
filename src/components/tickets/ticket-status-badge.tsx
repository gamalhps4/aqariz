"use client";

import { Badge } from "@/components/ui/badge";
import { TicketStatus, TicketPriority } from "@/types";
import { cn } from "@/lib/utils";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

const statusStyles: Record<TicketStatus, string> = {
  [TicketStatus.OPEN]:
    "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800",
  [TicketStatus.IN_PROGRESS]:
    "bg-yellow-100 text-yellow-700 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-400 dark:border-yellow-800",
  [TicketStatus.RESOLVED]:
    "bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800",
  [TicketStatus.CLOSED]:
    "bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-900/30 dark:text-gray-400 dark:border-gray-800",
};

const statusKeys: Record<TicketStatus, string> = {
  [TicketStatus.OPEN]: "tickets.status.open",
  [TicketStatus.IN_PROGRESS]: "tickets.status.inProgress",
  [TicketStatus.RESOLVED]: "tickets.status.resolved",
  [TicketStatus.CLOSED]: "tickets.status.closed",
};

const priorityStyles: Record<TicketPriority, string> = {
  [TicketPriority.LOW]:
    "bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800",
  [TicketPriority.MEDIUM]:
    "bg-yellow-100 text-yellow-700 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-400 dark:border-yellow-800",
  [TicketPriority.HIGH]:
    "bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-400 dark:border-orange-800",
  [TicketPriority.URGENT]:
    "bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800",
};

const priorityKeys: Record<TicketPriority, string> = {
  [TicketPriority.LOW]: "tickets.priority.low",
  [TicketPriority.MEDIUM]: "tickets.priority.medium",
  [TicketPriority.HIGH]: "tickets.priority.high",
  [TicketPriority.URGENT]: "tickets.priority.urgent",
};

export function TicketStatusBadge({ status }: { status: TicketStatus }) {
  const { t } = useLocalizationContext();
  const style = statusStyles[status] || statusStyles[TicketStatus.OPEN];
  const key = statusKeys[status] || statusKeys[TicketStatus.OPEN];
  return (
    <Badge variant="outline" className={cn("text-xs font-medium", style)}>
      {t(key)}
    </Badge>
  );
}

export function TicketPriorityBadge({ priority }: { priority: TicketPriority }) {
  const { t } = useLocalizationContext();
  const style = priorityStyles[priority] || priorityStyles[TicketPriority.MEDIUM];
  const key = priorityKeys[priority] || priorityKeys[TicketPriority.MEDIUM];
  return (
    <Badge variant="outline" className={cn("text-xs font-medium", style)}>
      {t(key)}
    </Badge>
  );
}
