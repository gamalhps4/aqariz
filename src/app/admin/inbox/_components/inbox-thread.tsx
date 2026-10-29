"use client";

/**
 * Right pane: the enquiry, everything the platform has said back, and the
 * composer. Replies are shown as the operator's own side of a conversation —
 * same reading order as the tenant messenger — because a contact thread really
 * is a conversation that happens to start outside the product.
 */

import { useState } from "react";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { format } from "date-fns";
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  Building2,
  Inbox,
  Mail,
  MailOpen,
  Send,
  Star,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { DeleteConfirmationDialog } from "@/components/ui/confirmation-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  initialsOf,
  STATUSES,
  STATUS_LABEL,
  TOPIC_CLASS,
  TOPIC_LABEL,
  type InboxThread as Thread,
  type Status,
} from "./types";

interface InboxThreadProps {
  thread: Thread | null;
  loading: boolean;
  busy: boolean;
  onPatch: (patch: Record<string, unknown>) => Promise<void>;
  onReply: (body: string, close: boolean) => Promise<boolean>;
  onDelete: () => Promise<void>;
}

export function InboxThread({
  thread,
  loading,
  busy,
  onPatch,
  onReply,
  onDelete,
}: InboxThreadProps) {
  const { t } = useLocalizationContext();
  const [draft, setDraft] = useState("");

  if (loading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  if (!thread) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-muted/60">
          <Inbox className="size-5 text-muted-foreground" />
        </div>
        <p className="text-sm font-medium">{t("platform.thread.pick", { defaultValue: "Pick a message" })}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("platform.thread.pickHint", { defaultValue: "Enquiries from the public contact page appear on the left." })}
        </p>
      </div>
    );
  }

  async function send(close: boolean) {
    const body = draft.trim();
    if (!body) return;
    const sent = await onReply(body, close);
    if (sent) setDraft("");
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header: who wrote in, and every triage control for the thread. */}
      <div className="shrink-0 border-b border-border/50 bg-card px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar className="size-10">
              <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                {initialsOf(thread.name)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="truncate text-sm font-semibold">{thread.name}</h2>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-medium",
                    TOPIC_CLASS[thread.topic],
                  )}
                >
                  {TOPIC_LABEL[thread.topic]}
                </span>
              </div>
              <a
                href={`mailto:${thread.email}`}
                className="text-xs text-muted-foreground hover:text-foreground hover:underline"
              >
                {thread.email}
              </a>
              {thread.company && (
                <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Building2 className="size-3" />
                  {thread.company}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1">
            <Select
              value={thread.status}
              onValueChange={(status) => onPatch({ status: status as Status })}
              disabled={busy}
            >
              <SelectTrigger className="h-8 w-[130px]" aria-label={t("platform.thread.statusLabel", { defaultValue: "Thread status" })}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {STATUS_LABEL[status]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              disabled={busy}
              title={thread.isStarred ? t("platform.thread.removeStar", { defaultValue: "Remove star" }) : t("platform.thread.addStar", { defaultValue: "Star this thread" })}
              onClick={() => onPatch({ isStarred: !thread.isStarred })}
            >
              <Star
                className={cn(
                  "size-4",
                  thread.isStarred && "fill-amber-400 text-amber-400",
                )}
              />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              disabled={busy}
              title={thread.isRead ? t("platform.thread.markUnread", { defaultValue: "Mark as unread" }) : t("platform.thread.markRead", { defaultValue: "Mark as read" })}
              onClick={() => onPatch({ isRead: !thread.isRead })}
            >
              {thread.isRead ? (
                <Mail className="size-4" />
              ) : (
                <MailOpen className="size-4" />
              )}
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              disabled={busy}
              title={thread.isArchived ? t("platform.thread.unarchive", { defaultValue: "Move back to inbox" }) : t("platform.thread.archive", { defaultValue: "Archive" })}
              onClick={() => onPatch({ isArchived: !thread.isArchived })}
            >
              {thread.isArchived ? (
                <ArchiveRestore className="size-4" />
              ) : (
                <Archive className="size-4" />
              )}
            </Button>

            <DeleteConfirmationDialog
              itemName={thread.subject}
              itemType="message"
              onConfirm={onDelete}
              loading={busy}
            >
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-destructive hover:text-destructive"
                disabled={busy}
                title={t("platform.thread.deletePermanently", { defaultValue: "Delete permanently" })}
              >
                <Trash2 className="size-4" />
              </Button>
            </DeleteConfirmationDialog>
          </div>
        </div>
      </div>

      {/* Conversation */}
      <div className="flex-1 space-y-4 overflow-y-auto bg-muted/20 p-4">
        <div className="rounded-xl border border-border/60 bg-card p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold">{thread.subject}</h3>
            <span className="text-[11px] text-muted-foreground">
              {format(new Date(thread.createdAt), "d MMM yyyy, HH:mm")}
            </span>
          </div>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
            {thread.message}
          </p>
        </div>

        {thread.replies.map((reply) => (
          <div key={reply.id} className="flex justify-end">
            <div className="max-w-[85%] rounded-xl bg-primary/10 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-xs font-semibold text-primary">
                  {reply.authorName}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {format(new Date(reply.createdAt), "d MMM yyyy, HH:mm")}
                </span>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">
                {reply.body}
              </p>
              {!reply.emailSent && (
                <p className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="mt-px size-3 shrink-0" />
                  <span>
                    Saved here, but the email did not send
                    {reply.emailError ? ` — ${reply.emailError}` : ""}.
                  </span>
                </p>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Composer */}
      <div className="shrink-0 border-t border-border/50 bg-card px-4 py-3">
        <Textarea
          rows={3}
          value={draft}
          disabled={busy}
          placeholder={`Reply to ${thread.name}…`}
          onChange={(event) => setDraft(event.target.value)}
          className="resize-none"
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-muted-foreground">
            Sent to {thread.email} from the platform&apos;s support address.
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={busy || !draft.trim()}
              onClick={() => send(true)}
            >
              {t("platform.thread.replyAndClose", { defaultValue: "Reply &amp; close" })}
            </Button>
            <Button
              size="sm"
              disabled={busy || !draft.trim()}
              onClick={() => send(false)}
            >
              <Send className="me-1.5 size-3.5" />
              {t("platform.thread.sendReply", { defaultValue: "Send reply" })}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
