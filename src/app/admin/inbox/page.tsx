"use client";

/**
 * Platform inbox — the operator side of the public contact form.
 *
 * Built as the same two-pane surface as the tenant dashboard's messenger
 * (list on the left, thread on the right) rather than a table: an enquiry is
 * answered in place, and switching between them must not cost a page load.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { toast } from "sonner";
import { RefreshCw, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { GlobalPagination } from "@/components/ui/global-pagination";
import { ResponsiveLayout } from "@/components/layout/responsive-layout";
import { InboxList } from "./_components/inbox-list";
import { InboxThread } from "./_components/inbox-thread";
import {
  TOPICS,
  TOPIC_LABEL,
  type InboxListItem,
  type InboxThread as Thread,
  type View,
} from "./_components/types";



const PAGE_SIZE = 20;

export default function PlatformInboxPage() {
  const { t } = useLocalizationContext();

  // Both carry translated labels, so they are built here rather than
  // at module scope where `t` does not exist.
  const views = useMemo<{ key: View; label: string }[]>(
    () => [
      { key: "all", label: t("platform.inbox.tab.all", { defaultValue: "All" }) },
      { key: "unread", label: t("platform.inbox.tab.unread", { defaultValue: "Unread" }) },
      { key: "starred", label: t("platform.inbox.tab.starred", { defaultValue: "Starred" }) },
      { key: "archived", label: t("platform.inbox.tab.archived", { defaultValue: "Archived" }) },
    ],
    [t],
  );

  const emptyLabel = useMemo<Record<View, string>>(
    () => ({
      all: t("platform.inbox.empty.all", { defaultValue: "No messages yet" }),
      unread: t("platform.inbox.empty.unread", { defaultValue: "Nothing unread" }),
      starred: t("platform.inbox.empty.starred", { defaultValue: "No starred messages" }),
      archived: t("platform.inbox.empty.archived", { defaultValue: "Nothing archived" }),
    }),
    [t],
  );
  const [messages, setMessages] = useState<InboxListItem[]>([]);
  const [thread, setThread] = useState<Thread | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [counts, setCounts] = useState({ unread: 0, archived: 0 });
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [view, setView] = useState<View>("all");
  const [topic, setTopic] = useState("all");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [listLoading, setListLoading] = useState(true);
  const [threadLoading, setThreadLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);

  // Debounced so typing a company name does not fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      setListLoading(true);
      setQuery(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const listQuery = useMemo(
    () =>
      new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
        view,
        topic,
        query,
      }).toString(),
    [page, view, topic, query],
  );

  // The spinner is switched on by whatever changed the query (a tab, a filter,
  // a page, the debounced search) rather than by this effect, which would
  // cost a cascading render on every load.
  useEffect(() => {
    let active = true;
    fetch(`/api/admin/inbox/messages?${listQuery}`)
      .then((response) =>
        response.json().then((payload) => ({ response, payload })),
      )
      .then(({ response, payload }) => {
        if (!active) return;
        if (!response.ok || !payload.success) {
          throw new Error(payload.error || "Unable to load the inbox");
        }
        setMessages(payload.data.messages);
        setCounts(payload.data.counts);
        setTotal(payload.data.pagination.total);
      })
      .catch((loadError) => {
        if (!active) return;
        toast.error(
          loadError instanceof Error
            ? loadError.message
            : t("platform.inbox.loadError", { defaultValue: "Unable to load the inbox" }),
        );
      })
      .finally(() => {
        if (active) setListLoading(false);
      });
    return () => {
      active = false;
    };
  }, [listQuery, reload]);

  const openThread = useCallback(async (id: string) => {
    setSelectedId(id);
    setThreadLoading(true);
    try {
      const response = await fetch(`/api/admin/inbox/messages/${id}`);
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Unable to load the message");
      }
      const loaded: Thread = payload.data;
      setThread(loaded);

      // Opening a message is what marks it read — no separate button to forget.
      if (!loaded.isRead) {
        await fetch(`/api/admin/inbox/messages/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isRead: true }),
        });
        setThread((current) =>
          current && current.id === id ? { ...current, isRead: true } : current,
        );
        setMessages((current) =>
          current.map((item) =>
            item.id === id ? { ...item, isRead: true } : item,
          ),
        );
        setCounts((current) => ({
          ...current,
          unread: Math.max(0, current.unread - 1),
        }));
      }
    } catch (loadError) {
      toast.error(
        loadError instanceof Error
          ? loadError.message
          : t("platform.inbox.loadOneError", { defaultValue: "Unable to load the message" }),
      );
    } finally {
      setThreadLoading(false);
    }
  }, []);

  const refresh = useCallback(() => {
    setListLoading(true);
    setReload((count) => count + 1);
  }, []);

  const goToPage = useCallback((next: number) => {
    setListLoading(true);
    setPage(next);
  }, []);

  async function patchThread(patch: Record<string, unknown>) {
    if (!thread) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/inbox/messages/${thread.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Could not update the message");
      }
      setThread(payload.data);
      refresh();
    } catch (patchError) {
      toast.error(
        patchError instanceof Error
          ? patchError.message
          : t("platform.inbox.updateError", { defaultValue: "Could not update the message" }),
      );
    } finally {
      setBusy(false);
    }
  }

  async function reply(body: string, close: boolean): Promise<boolean> {
    if (!thread) return false;
    setBusy(true);
    try {
      const response = await fetch(
        `/api/admin/inbox/messages/${thread.id}/replies`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body, close }),
        },
      );
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Could not send the reply");
      }
      // A stored-but-unsent reply is a warning, not a success: the operator has
      // to know the customer never got it.
      if (payload.data.reply.emailSent) {
        toast.success(payload.message || "Reply sent");
      } else {
        toast.warning(payload.message || "Reply saved, but the email failed");
      }
      setThread((current) =>
        current
          ? {
              ...current,
              replies: [...current.replies, payload.data.reply],
              status: payload.data.message.status,
              lastReplyAt: payload.data.message.lastReplyAt,
              isRead: true,
            }
          : current,
      );
      refresh();
      return true;
    } catch (replyError) {
      toast.error(
        replyError instanceof Error
          ? replyError.message
          : t("platform.inbox.replyError", { defaultValue: "Could not send the reply" }),
      );
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function removeThread() {
    if (!thread) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/inbox/messages/${thread.id}`, {
        method: "DELETE",
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Could not delete the message");
      }
      toast.success(payload.message || "Message deleted");
      setThread(null);
      setSelectedId(null);
      refresh();
    } catch (deleteError) {
      toast.error(
        deleteError instanceof Error
          ? deleteError.message
          : t("platform.inbox.deleteError", { defaultValue: "Could not delete the message" }),
      );
    } finally {
      setBusy(false);
    }
  }

  function switchView(next: View) {
    setListLoading(true);
    setView(next);
    setPage(1);
  }

  return (
    <ResponsiveLayout className="space-y-6" padding="none">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("platform.inbox.title", { defaultValue: "Inbox" })}</h1>
          <p className="text-muted-foreground">
            Messages sent through the public contact page.{" "}
            {counts.unread > 0
              ? `${counts.unread} waiting for a reply.`
              : t("platform.inbox.allRead", { defaultValue: "Everything here has been read." })}
          </p>
        </div>
        <Button
          variant="outline"
          className="shrink-0"
          onClick={refresh}
          disabled={listLoading}
        >
          <RefreshCw
            className={cn("me-2 size-4", listLoading && "animate-spin")}
          />
          {t("platform.common.refresh", { defaultValue: "Refresh" })}
        </Button>
      </div>

      <div className="grid h-[calc(100vh-14rem)] grid-cols-1 overflow-hidden rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm lg:grid-cols-[340px_1fr]">
        {/* Left: queue */}
        <div className="flex flex-col overflow-hidden border-b border-border/50 bg-card lg:border-b-0 lg:border-e">
          <div className="shrink-0 space-y-2 px-4 pb-2 pt-3">
            <div className="relative">
              <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("platform.inbox.searchPlaceholder", { defaultValue: "Search name, email or subject" })}
                aria-label={t("platform.inbox.searchLabel", { defaultValue: "Search contact messages" })}
                className="h-9 rounded-full border-none bg-muted/50 ps-9 text-sm"
              />
            </div>

            <div className="flex items-center gap-1.5">
              {views.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => switchView(tab.key)}
                  className={cn(
                    "whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium transition-colors",
                    view === tab.key
                      ? "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300"
                      : "text-muted-foreground hover:bg-muted/60",
                  )}
                >
                  {tab.label}
                  {tab.key === "unread" && counts.unread > 0 && (
                    <span className="ms-1 font-semibold">{counts.unread}</span>
                  )}
                </button>
              ))}
            </div>

            <Select
              value={topic}
              onValueChange={(next) => {
                setListLoading(true);
                setTopic(next);
                setPage(1);
              }}
            >
              <SelectTrigger className="h-8" aria-label={t("platform.inbox.filter.topic", { defaultValue: "Filter by topic" })}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("platform.inbox.filter.allTopics", { defaultValue: "All topics" })}</SelectItem>
                {TOPICS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {TOPIC_LABEL[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto pb-2">
            <InboxList
              messages={messages}
              loading={listLoading}
              selectedId={selectedId}
              onSelect={openThread}
              emptyLabel={emptyLabel[view]}
            />
          </div>

          {total > PAGE_SIZE && (
            <div className="shrink-0 border-t border-border/50 px-3 py-2">
              <GlobalPagination
                currentPage={page}
                pageSize={PAGE_SIZE}
                totalItems={total}
                totalPages={Math.max(1, Math.ceil(total / PAGE_SIZE))}
                onPageChange={goToPage}
                disabled={listLoading}
              />
            </div>
          )}
        </div>

        {/* Right: thread */}
        <InboxThread
          thread={thread}
          loading={threadLoading}
          busy={busy}
          onPatch={patchThread}
          onReply={reply}
          onDelete={removeThread}
        />
      </div>
    </ResponsiveLayout>
  );
}
