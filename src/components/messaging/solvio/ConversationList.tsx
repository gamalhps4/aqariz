"use client";

import { useMemo, useState } from "react";
import { Search, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import type { Conversation } from "./types";
import { getInitials } from "./normalize";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

/** "5 min ago", "yesterday" — in the reader's language. */
function relativeTime(date: Date, language: string): string {
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ["second", 60],
    ["minute", 60],
    ["hour", 24],
    ["day", 7],
    ["week", 4.35],
    ["month", 12],
    ["year", Number.POSITIVE_INFINITY],
  ];
  let value = seconds;
  for (const [unit, size] of steps) {
    if (Math.abs(value) < size) {
      try {
        return new Intl.RelativeTimeFormat(language, {
          numeric: "auto",
          style: "short",
        }).format(Math.round(value), unit);
      } catch {
        return date.toLocaleDateString();
      }
    }
    value /= size;
  }
  return date.toLocaleDateString();
}

type FilterTab = "all" | "unread" | "groups";

interface ConversationListProps {
  userId: string;
  conversations: Conversation[];
  loading?: boolean;
  onSelectConversation: (conversationId: string) => void;
  selectedConversationId?: string | null;
}

export function ConversationList({
  userId,
  conversations,
  loading = false,
  onSelectConversation,
  selectedConversationId,
}: ConversationListProps) {
  const { t, language } = useLocalizationContext();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<FilterTab>("all");

  const filteredConversations = useMemo(() => {
    let filtered = conversations;

    switch (activeTab) {
      case "unread":
        filtered = filtered.filter(
          (c) => c.unreadCount && c.unreadCount > 0
        );
        break;
      case "groups":
        filtered = filtered.filter(
          (c) => c.type === "group" || (c.participants?.length || 0) > 2
        );
        break;
      default:
        break;
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((conversation) => {
        const others = conversation.participants.filter(
          (p) => p.id !== userId
        );
        return others.some((p) => p.name?.toLowerCase().includes(query));
      });
    }

    return filtered;
  }, [conversations, searchQuery, userId, activeTab]);

  const tabs: { key: FilterTab; label: string }[] = [
    { key: "all", label: t("messages.chat.filter.all", { defaultValue: "All" }) },
    { key: "unread", label: t("messages.chat.filter.unread", { defaultValue: "Unread" }) },
    { key: "groups", label: t("messages.chat.filter.groups", { defaultValue: "Groups" }) },
  ];

  if (loading) {
    return (
      <div className="space-y-2 px-2">
        <Skeleton className="h-9 w-full rounded-lg" />
        <div className="flex gap-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-7 w-16 rounded-full" />
          ))}
        </div>
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-16 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Search */}
      <div className="relative px-2">
        <Search className="absolute start-4.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          type="text"
          placeholder={t("messages.interface.searchPlaceholder", { defaultValue: "Search conversations..." })}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="ps-9 h-9 bg-muted/50 border-none rounded-full text-sm placeholder:text-muted-foreground/70"
        />
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1.5 px-2 pb-1">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              "px-3 py-1 rounded-full text-xs font-medium transition-colors whitespace-nowrap",
              activeTab === tab.key
                ? "bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300"
                : "text-muted-foreground hover:bg-muted/60"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* List */}
      {filteredConversations.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center px-4">
          <p className="text-sm text-muted-foreground">
            {searchQuery
              ? t("messages.interface.empty.noConversations", { defaultValue: "No conversations found" })
              : activeTab === "unread"
              ? t("messages.chat.empty.unread", { defaultValue: "No unread messages" })
              : activeTab === "groups"
              ? t("messages.chat.empty.groups", { defaultValue: "No group conversations" })
              : t("messages.chat.empty.none", { defaultValue: "No conversations yet" })}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {searchQuery
              ? t("messages.interface.empty.tryDifferentSearch", { defaultValue: "Try a different search term" })
              : t("messages.interface.empty.startNewConversation", { defaultValue: "Start a new conversation" })}
          </p>
        </div>
      ) : (
        filteredConversations.map((conversation) => {
          const others = conversation.participants.filter(
            (p) => p.id !== userId
          );
          const first = others[0];
          const isGroup =
            conversation.type === "group" ||
            (conversation.participants?.length || 0) > 2;
          const hasUnread = conversation.unreadCount > 0;
          const lastContent = conversation.lastMessage?.content || "";
          const lastIsSelf = conversation.lastMessage?.senderId === userId;

          return (
            <div
              key={conversation.id}
              className={cn(
                "flex items-center gap-3 px-2 py-2 rounded-lg cursor-pointer transition-all",
                selectedConversationId === conversation.id
                  ? "bg-blue-50 dark:bg-blue-950/30"
                  : "hover:bg-accent/50"
              )}
              onClick={() => onSelectConversation(conversation.id)}
            >
              {/* Avatar */}
              <div className="relative h-12 w-12 shrink-0">
                <Avatar className="h-12 w-12">
                  {isGroup ? (
                    <AvatarFallback className="bg-purple-100 dark:bg-purple-900 text-purple-600 dark:text-purple-300">
                      <Users className="h-5 w-5" />
                    </AvatarFallback>
                  ) : first?.avatar ? (
                    <AvatarImage src={first.avatar} alt={first.name} />
                  ) : null}
                  {!isGroup && (
                    <AvatarFallback className="bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-300 font-semibold text-sm">
                      {getInitials(first?.name || "?")}
                    </AvatarFallback>
                  )}
                </Avatar>
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <p
                    className={cn(
                      "text-sm truncate",
                      hasUnread ? "font-bold" : "font-medium"
                    )}
                  >
                    {others.length > 0
                      ? others.map((p) => p.name).join(", ")
                      : t("messages.interface.labels.unknownConversation", { defaultValue: "Unknown Conversation" })}
                  </p>
                </div>

                <div className="flex items-center gap-1.5 mt-0.5">
                  <p
                    className={cn(
                      "text-xs truncate flex-1",
                      hasUnread
                        ? "text-foreground font-medium"
                        : "text-muted-foreground"
                    )}
                  >
                    {lastContent ? (
                      <>
                        {lastIsSelf && (
                          <span className="font-medium">
                            {t("messages.chat.youPrefix", { defaultValue: "You: " })}
                          </span>
                        )}
                        {lastContent}
                      </>
                    ) : (
                      <span className="italic">
                        {t("messages.interface.empty.noMessagesYet", { defaultValue: "No messages yet" })}
                      </span>
                    )}
                  </p>
                  {conversation.lastActivityAt && (
                    <span className="text-[11px] text-muted-foreground whitespace-nowrap shrink-0">
                      · {relativeTime(new Date(conversation.lastActivityAt), language)}
                    </span>
                  )}
                </div>
              </div>

              {hasUnread && (
                <div className="shrink-0">
                  <div className="h-3 w-3 rounded-full bg-blue-600" />
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
