"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ChevronRight,
  Download,
  FileIcon,
  FileText,
  Image as ImageIcon,
  Link as LinkIcon,
  MessageSquare,
  Plus,
  Users,
  Video,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import NewConversationDialog from "@/components/messaging/NewConversationDialog";
import { toast } from "sonner";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { ConversationList } from "./ConversationList";
import { MessageInput } from "./MessageInput";
import { MessageThread } from "./MessageThread";
import { useConversations, useMessages } from "./hooks";
import { getInitials } from "./normalize";
import type { Message } from "./types";

type RightPanelView = "profile" | "media";
type MediaTab = "media" | "files" | "links";

interface MessagesClientProps {
  userId: string;
}

export function MessagesClient({ userId }: MessagesClientProps) {
  const { t, formatDate, formatTime, language } = useLocalizationContext();

  const [selectedConversationId, setSelectedConversationId] = useState<
    string | null
  >(null);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [rightPanelView, setRightPanelView] =
    useState<RightPanelView>("profile");
  const [mediaTab, setMediaTab] = useState<MediaTab>("media");

  const { conversations, loading: conversationsLoading, refresh: refreshConversations } =
    useConversations(userId);
  const {
    messages,
    loading: messagesLoading,
    appendMessage,
  } = useMessages(selectedConversationId, userId);

  const selectedConversation = useMemo(
    () => conversations.find((c) => c.id === selectedConversationId) ?? null,
    [conversations, selectedConversationId]
  );

  // Auto-select first conversation
  useEffect(() => {
    if (conversationsLoading) return;
    if (conversations.length === 0) {
      if (selectedConversationId) setSelectedConversationId(null);
      return;
    }
    const stillExists =
      selectedConversationId &&
      conversations.some((c) => c.id === selectedConversationId);
    if (!stillExists) {
      setSelectedConversationId(conversations[0].id);
    }
  }, [conversations, conversationsLoading, selectedConversationId]);

  // Reset right panel on conversation change
  useEffect(() => {
    setRightPanelView("profile");
    setMediaTab("media");
  }, [selectedConversationId]);

  const otherParticipant = useMemo(() => {
    if (!selectedConversation) return null;
    return (
      selectedConversation.participants.find((p) => p.id !== userId) ?? null
    );
  }, [selectedConversation, userId]);

  const isGroupChat = useMemo(() => {
    if (!selectedConversation) return false;
    return (
      selectedConversation.type === "group" ||
      (selectedConversation.participants?.length || 0) > 2
    );
  }, [selectedConversation]);

  // Attachments & links derived from loaded messages
  const { mediaItems, fileItems, linkItems } = useMemo(() => {
    const allAttachments: { attachment: Message["attachments"][0]; message: Message }[] = [];
    for (const msg of messages) {
      if (msg.isDeleted) continue;
      for (const att of msg.attachments) {
        allAttachments.push({ attachment: att, message: msg });
      }
    }
    allAttachments.sort(
      (a, b) =>
        new Date(b.attachment.createdAt).getTime() -
        new Date(a.attachment.createdAt).getTime()
    );

    const media = allAttachments.filter(
      (i) => i.attachment.fileType === "image" || i.attachment.fileType === "video"
    );
    const files = allAttachments.filter(
      (i) => i.attachment.fileType !== "image" && i.attachment.fileType !== "video"
    );

    const links: { url: string; message: Message }[] = [];
    const urlRegex = /https?:\/\/[^\s]+/g;
    for (const msg of messages) {
      if (msg.isDeleted || !msg.content) continue;
      const matches = msg.content.match(urlRegex);
      if (matches) {
        for (const url of matches) {
          links.push({ url, message: msg });
        }
      }
    }

    return { mediaItems: media, fileItems: files, linkItems: links };
  }, [messages]);

  function groupByMonth<T extends { message: Message }>(items: T[]) {
    const groups: Record<string, T[]> = {};
    for (const item of items) {
      const key = new Intl.DateTimeFormat(language, {
        month: "long",
        year: "numeric",
      }).format(new Date(item.message.createdAt));
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    }
    return groups;
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  // The time alone within a day, the date and time after that. (Intl
  // options passed to formatDate were ignored, so every message showed only
  // its date — today's included.)
  const formatTimestamp = useCallback(
    (date: Date) => {
      const diffHours = (Date.now() - date.getTime()) / (1000 * 60 * 60);
      if (diffHours < 24) {
        return formatTime(date);
      }
      return `${formatDate(date)} ${formatTime(date)}`;
    },
    [formatDate, formatTime]
  );

  const handleCreateConversation = async (data: {
    type: "individual" | "group";
    name?: string;
    description?: string;
    participants: string[];
    propertyId?: string;
  }) => {
    try {
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(
          errorText || `Failed to create conversation (${res.status})`
        );
      }
      const payload = await res.json();
      const created =
        payload.data?.conversation ||
        payload.conversation ||
        payload.data ||
        payload;
      const createdId = created?._id || created?.id || null;
      toast.success(
        t("messages.toasts.conversationCreated", {
          defaultValue: "Conversation created successfully!",
        })
      );
      setShowNewDialog(false);
      await refreshConversations();
      if (createdId) {
        setSelectedConversationId(String(createdId));
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("messages.toasts.conversationError", {
              defaultValue: "Failed to create conversation",
            })
      );
      throw error;
    }
  };

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] xl:grid-cols-[320px_1fr_300px] h-[calc(100vh-8rem)] md:h-[calc(100vh-7rem)] rounded-xl overflow-hidden border border-border/50 bg-card/50 backdrop-blur-sm">
        {/* ============ LEFT: Conversations ============ */}
        <div className="flex flex-col overflow-hidden border-e border-border/50 bg-card">
          <div className="px-4 py-3 shrink-0">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-xl font-bold">{t("messages.chat.title", { defaultValue: "Chats" })}</h2>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 rounded-full hover:bg-accent"
                onClick={() => setShowNewDialog(true)}
                title={t("messages.header.newConversation", { defaultValue: "New Conversation" })}
                aria-label={t("messages.header.newConversation", { defaultValue: "New Conversation" })}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-2 pb-2">
            <ConversationList
              userId={userId}
              conversations={conversations}
              loading={conversationsLoading}
              onSelectConversation={(id) => setSelectedConversationId(id)}
              selectedConversationId={selectedConversationId}
            />
          </div>
        </div>

        {/* ============ CENTER: Thread ============ */}
        <div className="flex flex-col overflow-hidden">
          {selectedConversation ? (
            <>
              {/* Header */}
              <div className="px-4 py-2.5 border-b border-border/50 bg-card shrink-0">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2.5">
                      <div>
                        <Avatar className="h-9 w-9">
                          {otherParticipant?.avatar ? (
                            <AvatarImage
                              src={otherParticipant.avatar}
                              alt={otherParticipant.name}
                            />
                          ) : null}
                          <AvatarFallback
                            className={cn(
                              isGroupChat
                                ? "bg-purple-100 dark:bg-purple-900 text-purple-600 dark:text-purple-300"
                                : "bg-primary/10 text-primary",
                              "text-xs font-semibold"
                            )}
                          >
                            {isGroupChat ? (
                              <Users className="h-4 w-4" />
                            ) : (
                              getInitials(otherParticipant?.name || "?")
                            )}
                          </AvatarFallback>
                        </Avatar>
                      </div>
                      <div>
                        <h2 className="text-sm font-semibold leading-tight">
                          {isGroupChat
                            ? selectedConversation.participants
                                .filter((p) => p.id !== userId)
                                .map((p) => p.name)
                                .join(", ") || t("messages.interface.labels.groupConversation", { defaultValue: "Group Conversation" })
                            : otherParticipant?.name || t("messages.chat.user", { defaultValue: "User" })}
                        </h2>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 p-4 overflow-y-auto bg-muted/20">
                <MessageThread
                  messages={messages}
                  loading={messagesLoading}
                  userId={userId}
                  formatTimestamp={formatTimestamp}
                />
              </div>

              {/* Input */}
              <div className="px-4 py-3 border-t border-border/50 bg-card shrink-0">
                <MessageInput
                  conversationId={selectedConversation.id}
                  onMessageSent={(msg) => {
                    appendMessage(msg);
                    void refreshConversations();
                  }}
                />
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8 bg-muted/10">
              <div className="w-20 h-20 rounded-full bg-blue-100 dark:bg-blue-950/50 flex items-center justify-center mb-5">
                <MessageSquare className="h-9 w-9 text-blue-600 dark:text-blue-400" />
              </div>
              <h3 className="text-lg font-semibold mb-2">
                {t("messages.interface.empty.selectConversationTitle", { defaultValue: "Select a conversation" })}
              </h3>
              <p className="text-sm text-muted-foreground mb-5 max-w-xs">
                {t("messages.chat.pickHint", { defaultValue: "Choose a conversation from the list, or start a new one." })}
              </p>
              <Button
                className="bg-blue-600 hover:bg-blue-700 text-white rounded-full px-6"
                onClick={() => setShowNewDialog(true)}
              >
                <Plus className="h-4 w-4 me-2" />
                {t("messages.header.newConversation", { defaultValue: "New Conversation" })}
              </Button>
            </div>
          )}
        </div>

        {/* ============ RIGHT: Profile/Media ============ */}
        <div
          className={cn(
            "hidden xl:flex flex-col overflow-hidden border-s border-border/50 bg-card",
            !selectedConversationId && "xl:hidden"
          )}
        >
          {selectedConversation && rightPanelView === "profile" && (
            <>
              <div className="flex flex-col items-center pt-6 pb-4 px-4 shrink-0">
                <Avatar className="h-20 w-20 mb-3">
                  {!isGroupChat && otherParticipant?.avatar ? (
                    <AvatarImage
                      src={otherParticipant.avatar}
                      alt={otherParticipant.name}
                    />
                  ) : null}
                  <AvatarFallback
                    className={cn(
                      isGroupChat
                        ? "bg-purple-100 dark:bg-purple-900 text-purple-600 dark:text-purple-300"
                        : "bg-primary/10 text-primary",
                      "text-2xl font-bold"
                    )}
                  >
                    {isGroupChat ? (
                      <Users className="h-8 w-8" />
                    ) : (
                      getInitials(otherParticipant?.name || "?")
                    )}
                  </AvatarFallback>
                </Avatar>
                <h3 className="text-base font-semibold text-center">
                  {isGroupChat
                    ? t("messages.interface.labels.groupConversation", { defaultValue: "Group Conversation" })
                    : otherParticipant?.name || t("messages.chat.user", { defaultValue: "User" })}
                </h3>
              </div>

              {/* Only what works: presence, calls, mute, search and the chat
                  settings links were drawn but did nothing, and the panel
                  claimed end-to-end encryption, which messages stored in the
                  database do not have. */}
              <div className="flex-1 overflow-y-auto px-2">
                <MenuLink
                  icon={ImageIcon}
                  label={t("messages.chat.mediaFiles", { defaultValue: "Media & files" })}
                  onClick={() => setRightPanelView("media")}
                />
              </div>

              {isGroupChat && (
                <div className="px-4 py-3 border-t border-border/50 shrink-0">
                  <p className="text-xs text-muted-foreground">
                    {t("messages.chat.groupMembers", { defaultValue: "{count} people in this group", values: { count: selectedConversation.participants.length } })}
                  </p>
                  <div className="mt-2 space-y-2 max-h-40 overflow-y-auto">
                    {selectedConversation.participants.map((p) => (
                      <div key={p.id} className="flex items-center gap-2">
                        <Avatar className="h-6 w-6">
                          {p.avatar ? (
                            <AvatarImage src={p.avatar} alt={p.name} />
                          ) : null}
                          <AvatarFallback className="bg-primary/10 text-primary text-[10px] font-semibold">
                            {getInitials(p.name)}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-xs">
                          {p.id === userId ? t("messages.chat.you", { defaultValue: "You" }) : p.name}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {selectedConversation && rightPanelView === "media" && (
            <div className="flex flex-col h-full">
              <div className="flex items-center gap-3 px-3 py-3 border-b border-border/50 shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-full hover:bg-accent shrink-0"
                  onClick={() => setRightPanelView("profile")}
                  aria-label={t("common.back", { defaultValue: "Back" })}
                >
                  <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
                </Button>
                <h3 className="text-sm font-semibold">
                  {t("messages.chat.mediaTitle", { defaultValue: "Media, files and links" })}
                </h3>
              </div>

              <div className="flex border-b border-border/50 shrink-0">
                {(["media", "files", "links"] as MediaTab[]).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setMediaTab(tab)}
                    className={cn(
                      "flex-1 py-2.5 text-sm font-medium capitalize transition-colors relative",
                      mediaTab === tab
                        ? "text-blue-600 dark:text-blue-400"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {t(`messages.chat.tab.${tab}`, { defaultValue: tab })}
                    {mediaTab === tab && (
                      <div className="absolute bottom-0 start-0 end-0 h-0.5 bg-blue-600 dark:bg-blue-400" />
                    )}
                  </button>
                ))}
              </div>

              <div className="flex-1 overflow-y-auto">
                {mediaTab === "media" ? (
                  mediaItems.length === 0 ? (
                    <EmptyMediaState
                      icon={ImageIcon}
                      text={t("messages.chat.noMedia", { defaultValue: "No pictures or videos shared yet" })}
                    />
                  ) : (
                    <div className="p-2">
                      {Object.entries(groupByMonth(mediaItems)).map(
                        ([month, items]) => (
                          <div key={month} className="mb-4">
                            <p className="text-xs font-semibold text-muted-foreground px-1 mb-2">
                              {month}
                            </p>
                            <div className="grid grid-cols-3 gap-1">
                              {items.map(({ attachment }) => (
                                <a
                                  key={attachment.id}
                                  href={attachment.fileUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="aspect-square relative overflow-hidden rounded bg-muted group"
                                >
                                  {attachment.fileType === "image" ? (
                                    <img
                                      src={attachment.fileUrl}
                                      alt={attachment.fileName}
                                      className="w-full h-full object-cover transition-transform group-hover:scale-105"
                                    />
                                  ) : (
                                    <div className="w-full h-full flex items-center justify-center bg-muted">
                                      <Video className="h-6 w-6 text-muted-foreground" />
                                    </div>
                                  )}
                                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                                </a>
                              ))}
                            </div>
                          </div>
                        )
                      )}
                    </div>
                  )
                ) : mediaTab === "files" ? (
                  fileItems.length === 0 ? (
                    <EmptyMediaState
                      icon={FileIcon}
                      text={t("messages.chat.noFiles", { defaultValue: "No files shared yet" })}
                    />
                  ) : (
                    <div className="p-2">
                      {Object.entries(groupByMonth(fileItems)).map(
                        ([month, items]) => (
                          <div key={month} className="mb-4">
                            <p className="text-xs font-semibold text-muted-foreground px-1 mb-2">
                              {month}
                            </p>
                            <div className="space-y-1">
                              {items.map(({ attachment }) => (
                                <a
                                  key={attachment.id}
                                  href={attachment.fileUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-accent/50 transition-colors group"
                                >
                                  <div className="h-9 w-9 shrink-0 rounded-lg bg-blue-100 dark:bg-blue-950/50 flex items-center justify-center">
                                    {attachment.fileType === "pdf" ? (
                                      <FileText className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                                    ) : (
                                      <FileIcon className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                                    )}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs font-medium truncate">
                                      {attachment.fileName}
                                    </p>
                                    <p className="text-[10px] text-muted-foreground">
                                      {formatFileSize(attachment.fileSize)}
                                    </p>
                                  </div>
                                  <Download className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                                </a>
                              ))}
                            </div>
                          </div>
                        )
                      )}
                    </div>
                  )
                ) : linkItems.length === 0 ? (
                  <EmptyMediaState
                    icon={LinkIcon}
                    text={t("messages.chat.noLinks", { defaultValue: "No links shared yet" })}
                  />
                ) : (
                  <div className="p-2">
                    {linkItems.map(({ url, message }, idx) => (
                      <a
                        key={`${message.id}-${idx}`}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-accent/50 transition-colors group mb-1"
                      >
                        <div className="h-9 w-9 shrink-0 rounded-lg bg-purple-100 dark:bg-purple-950/50 flex items-center justify-center">
                          <LinkIcon className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate text-blue-600 dark:text-blue-400">
                            {url}
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            {formatDate(message.createdAt)}
                          </p>
                        </div>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <NewConversationDialog
        open={showNewDialog}
        onOpenChange={setShowNewDialog}
        onCreateConversation={handleCreateConversation}
      />
    </>
  );
}

function MenuLink({
  icon: Icon,
  label,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-accent/50 transition-colors group"
    >
      <div className="flex items-center gap-3">
        <Icon className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
        <span className="text-sm font-medium">{label}</span>
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground rtl:rotate-180" />
    </button>
  );
}

function EmptyMediaState({
  icon: Icon,
  text,
}: {
  icon: React.ElementType;
  text: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center px-4">
      <div className="h-12 w-12 rounded-full bg-muted/60 flex items-center justify-center mb-3">
        <Icon className="h-5 w-5 text-muted-foreground" />
      </div>
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}
