"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { FileIcon, FileText } from "lucide-react";
import type { Message } from "./types";
import { getInitials } from "./normalize";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

interface MessageThreadProps {
  messages: Message[];
  loading: boolean;
  userId: string;
  formatTimestamp: (date: Date) => string;
}

export function MessageThread({
  messages,
  loading,
  userId,
  formatTimestamp,
}: MessageThreadProps) {
  const { t } = useLocalizationContext();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  if (loading) {
    return (
      <div className="flex-1 space-y-4">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className={cn("flex gap-3", i % 2 === 0 ? "justify-end" : "")}
          >
            {i % 2 !== 0 && <Skeleton className="h-7 w-7 rounded-full" />}
            <Skeleton className="h-12 w-52 rounded-2xl" />
          </div>
        ))}
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <p className="text-muted-foreground text-center text-sm">
          {t("messages.chat.emptyThread", { defaultValue: "No messages yet. Say hello!" })}
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-3">
      {messages.map((message, index) => {
        const isOwn = message.senderId === userId;
        const prev = messages[index - 1];
        const next = messages[index + 1];
        const showAvatar = !prev || prev.senderId !== message.senderId;
        const showTimestamp = !next || next.senderId !== message.senderId;

        return (
          <div
            key={message.id}
            className={cn(
              "flex gap-2 group",
              isOwn ? "justify-end" : "justify-start"
            )}
          >
            {!isOwn && (
              <div className="shrink-0">
                {showAvatar ? (
                  <Avatar className="h-7 w-7">
                    {message.senderAvatar ? (
                      <AvatarImage
                        src={message.senderAvatar}
                        alt={message.senderName || "User"}
                      />
                    ) : null}
                    <AvatarFallback className="bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-300 text-xs font-semibold">
                      {getInitials(message.senderName || "?")}
                    </AvatarFallback>
                  </Avatar>
                ) : (
                  <div className="h-7 w-7" />
                )}
              </div>
            )}

            <div
              className={cn(
                "flex flex-col gap-0.5 max-w-[75%]",
                isOwn ? "items-end" : "items-start"
              )}
            >
              {message.content && (
                <div
                  className={cn(
                    "rounded-2xl px-3.5 py-2 wrap-break-word shadow-sm",
                    isOwn
                      ? "bg-blue-600 text-white rounded-ee-md"
                      : "bg-card border border-border/50 rounded-es-md",
                    message.isDeleted && "opacity-60"
                  )}
                >
                  {message.isDeleted ? (
                    <p className="italic text-xs">[Message deleted]</p>
                  ) : (
                    <p className="text-sm whitespace-pre-wrap leading-relaxed">
                      {message.content}
                    </p>
                  )}
                </div>
              )}

              {!message.isDeleted && message.attachments.length > 0 && (
                <div
                  className={cn(
                    "flex flex-wrap gap-1.5 mt-1",
                    isOwn ? "justify-end" : "justify-start"
                  )}
                >
                  {message.attachments.map((att) => {
                    if (att.fileType === "image") {
                      return (
                        <a
                          key={att.id}
                          href={att.fileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block h-32 w-32 rounded-lg overflow-hidden bg-muted border border-border/50"
                        >
                          <img
                            src={att.fileUrl}
                            alt={att.fileName}
                            className="h-full w-full object-cover"
                          />
                        </a>
                      );
                    }
                    const Icon =
                      att.fileType === "pdf" ? FileText : FileIcon;
                    return (
                      <a
                        key={att.id}
                        href={att.fileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={cn(
                          "flex items-center gap-2 px-3 py-2 rounded-lg border text-xs max-w-[240px]",
                          isOwn
                            ? "bg-blue-600 text-white border-blue-700"
                            : "bg-card border-border/50"
                        )}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        <span className="truncate">{att.fileName}</span>
                      </a>
                    );
                  })}
                </div>
              )}

              {showTimestamp && (
                <span className="text-[10px] text-muted-foreground/70 px-1">
                  {formatTimestamp(new Date(message.createdAt))}
                  {isOwn && message.status === "read" && (
                    <span className="ms-1.5 text-blue-600 dark:text-blue-400 font-medium">
                      Seen
                    </span>
                  )}
                </span>
              )}
            </div>
          </div>
        );
      })}
      <div ref={endRef} />
    </div>
  );
}
