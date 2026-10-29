"use client";

/**
 * Left rail of the console inbox. Deliberately the same read as the tenant
 * dashboard's conversation list — avatar, name, preview, relative time, unread
 * dot — so an operator who knows one knows the other.
 */

import { formatDistanceToNow } from "date-fns";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  initialsOf,
  TOPIC_CLASS,
  TOPIC_LABEL,
  type InboxListItem,
} from "./types";

interface InboxListProps {
  messages: InboxListItem[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  emptyLabel: string;
}

export function InboxList({
  messages,
  loading,
  selectedId,
  onSelect,
  emptyLabel,
}: InboxListProps) {
  const { t } = useLocalizationContext();
  if (loading) {
    return (
      <div className="space-y-2 px-2">
        {[1, 2, 3, 4, 5, 6].map((row) => (
          <Skeleton key={row} className="h-[68px] w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("platform.inbox.listEmpty", { defaultValue: "Messages sent from the public contact page land here." })}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-0.5 px-2">
      {messages.map((message) => {
        const isSelected = message.id === selectedId;
        const timestamp = message.lastReplyAt || message.createdAt;

        return (
          <button
            key={message.id}
            type="button"
            onClick={() => onSelect(message.id)}
            className={cn(
              "flex w-full items-start gap-3 rounded-lg px-2 py-2.5 text-start transition-colors",
              isSelected
                ? "bg-blue-50 dark:bg-blue-950/30"
                : "hover:bg-accent/50",
            )}
          >
            <Avatar className="mt-0.5 h-10 w-10 shrink-0">
              <AvatarFallback className="bg-blue-100 text-sm font-semibold text-blue-600 dark:bg-blue-900 dark:text-blue-300">
                {initialsOf(message.name)}
              </AvatarFallback>
            </Avatar>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p
                  className={cn(
                    "truncate text-sm",
                    message.isRead ? "font-medium" : "font-bold",
                  )}
                >
                  {message.name}
                </p>
                {message.isStarred && (
                  <Star className="size-3.5 shrink-0 fill-amber-400 text-amber-400" />
                )}
                <span className="ms-auto shrink-0 text-[11px] text-muted-foreground">
                  {formatDistanceToNow(new Date(timestamp), {
                    addSuffix: false,
                  }).replace("about ", "")}
                </span>
              </div>

              <p
                className={cn(
                  "mt-0.5 truncate text-xs",
                  message.isRead
                    ? "text-muted-foreground"
                    : "font-medium text-foreground",
                )}
              >
                {message.subject}
              </p>

              <div className="mt-1.5 flex items-center gap-1.5">
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-medium",
                    TOPIC_CLASS[message.topic],
                  )}
                >
                  {TOPIC_LABEL[message.topic]}
                </span>
                {message.replyCount > 0 && (
                  <span className="text-[10px] text-muted-foreground">
                    {message.replyCount}{" "}
                    {message.replyCount === 1 ? "reply" : "replies"}
                  </span>
                )}
                {!message.isRead && (
                  <span className="ms-auto size-2.5 shrink-0 rounded-full bg-blue-600" />
                )}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
