"use client";

/**
 * PropertyPro - Platform feedback console
 *
 * Every customer organization's feedback in one list, with the triage the
 * organizations themselves cannot perform: status, priority, and the reply the
 * author sees on their own Feedback screen.
 *
 * This screen is the half that was missing. Feedback has been submittable from
 * the dashboard all along, but it went into a per-process Map with no
 * organizationId and no reader — so nothing a customer wrote ever arrived
 * anywhere. What used to sit on the org side instead (status changes, bulk
 * updates, any org admin) has moved here, because whether a request becomes
 * next quarter's work is a roadmap decision.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { ReportExportButton } from "@/components/reports/export-button";
import {
  AlertCircle,
  Loader2,
  MessageSquareHeart,
  RefreshCw,
  Send,
  Star,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { type DataTableColumn } from "@/components/ui/data-table";
import { DataTableCard } from "@/components/ui/data-table-card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ResponsiveLayout } from "@/components/layout/responsive-layout";

interface FeedbackEntry {
  id: string;
  organizationId: string;
  organizationName?: string;
  userId: string;
  authorName: string | null;
  userRole: string;
  category: string;
  rating: number;
  title: string;
  description: string;
  feature: string | null;
  priority: string;
  status: string;
  tags: string[];
  adminResponse: string | null;
  respondedAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

interface FeedbackSummary {
  total: number;
  averageRating: number;
  openCount: number;
  answeredCount: number;
  byCategory: Record<string, number>;
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
  ratingTrend: "improving" | "declining" | "stable" | "insufficient_data";
}

const STATUSES = ["new", "reviewing", "in_progress", "resolved", "closed"];
const PRIORITIES = ["low", "medium", "high", "critical"];
const CATEGORIES = [
  "usability",
  "performance",
  "feature_request",
  "bug_report",
  "general",
];

const PRIORITY_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  critical: "destructive",
  high: "destructive",
  medium: "default",
  low: "outline",
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  new: "default",
  reviewing: "secondary",
  in_progress: "secondary",
  resolved: "outline",
  closed: "outline",
};

const humanize = (value: string) => value.replaceAll("_", " ");


export default function PlatformFeedbackPage() {
  const { t } = useLocalizationContext();

  // Labels are translated, so the map is built here rather than at
  // module scope where `t` does not exist.
  const trendLabel = useMemo<Record<FeedbackSummary["ratingTrend"], string>>(
    () => ({
      improving: t("platform.feedback.trend.improving", { defaultValue: "Improving" }),
      declining: t("platform.feedback.trend.declining", { defaultValue: "Declining" }),
      stable: t("platform.feedback.trend.stable", { defaultValue: "Stable" }),
      // Said plainly rather than dressed as a trend. The old in-memory version
      // reported "Improving" off five hardcoded rows.
      insufficient_data: t("platform.feedback.trend.notEnough", { defaultValue: "Not enough yet" }),
    }),
    [t],
  );
  const [entries, setEntries] = useState<FeedbackEntry[]>([]);
  const [summary, setSummary] = useState<FeedbackSummary | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [status, setStatus] = useState("all");
  const [priority, setPriority] = useState("all");
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const [active, setActive] = useState<FeedbackEntry | null>(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (status !== "all") params.set("status", status);
    if (priority !== "all") params.set("priority", priority);
    if (category !== "all") params.set("category", category);
    if (search.trim()) params.set("search", search.trim());
    params.set("limit", String(pageSize));
    params.set("offset", String((page - 1) * pageSize));
    return params.toString();
  }, [status, priority, category, search, page]);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/admin/feedback?${query}`);
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload?.message ?? t("platform.common.requestFailed", { defaultValue: "Request failed" }));
      }
      setEntries(payload.data.feedback ?? []);
      setSummary(payload.data.summary ?? null);
      setTotal(payload.data.total ?? 0);
      setError(null);
    } catch {
      setError(t("platform.feedback.loadError", { defaultValue: "Could not load feedback." }));
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void load();
  }, [load]);

  // The spinner is raised here rather than inside `load`, because `load` also
  // runs from the effect above and setting state on an effect's synchronous
  // path re-renders before the fetch has even left.
  const refresh = () => {
    setLoading(true);
    void load();
  };

  const patch = async (id: string, body: Record<string, unknown>) => {
    setSaving(true);
    try {
      const response = await fetch(`/api/admin/feedback/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload?.message ?? "Request failed");
      }
      // Patch the row in place rather than refetching: the list is filtered,
      // and a status change would make the row jump or vanish mid-edit.
      setEntries((rows) =>
        rows.map((row) => (row.id === id ? { ...row, ...payload.data } : row)),
      );
      setActive((current) =>
        current && current.id === id ? { ...current, ...payload.data } : current,
      );
      setError(null);
    } catch {
      setError(t("platform.feedback.saveError", { defaultValue: "Could not save that change." }));
    } finally {
      setSaving(false);
    }
  };

  const columns: DataTableColumn<FeedbackEntry>[] = [
    {
      id: "feedback",
      header: t("platform.feedback.col.feedback", { defaultValue: "Feedback" }),
      cell: (row) => (
        <button
          type="button"
          onClick={() => {
            setActive(row);
            setReplyDraft(row.adminResponse ?? "");
          }}
          className="flex flex-col items-start text-start"
        >
          <span className="text-sm font-medium hover:underline">{row.title}</span>
          <span className="line-clamp-1 text-xs text-muted-foreground">
            {row.description}
          </span>
        </button>
      ),
      width: "min-w-[280px]",
    },
    {
      id: "organization",
      header: t("platform.feedback.col.organization", { defaultValue: "Organization" }),
      cell: (row) => (
        <div className="flex flex-col">
          <span className="text-sm">{row.organizationName || "—"}</span>
          <span className="text-xs text-muted-foreground">
            {row.authorName ?? t("platform.common.unknown", { defaultValue: "Unknown" })} · {humanize(row.userRole)}
          </span>
        </div>
      ),
      width: "min-w-[180px]",
    },
    {
      id: "rating",
      header: t("platform.feedback.col.rating", { defaultValue: "Rating" }),
      cell: (row) => (
        <span className="inline-flex items-center gap-1 text-sm">
          <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
          {row.rating}
        </span>
      ),
      align: "center",
      width: "min-w-[80px]",
    },
    {
      id: "category",
      header: t("platform.feedback.col.category", { defaultValue: "Category" }),
      cell: (row) => (
        <Badge variant="outline" className="text-xs font-normal capitalize">
          {humanize(row.category)}
        </Badge>
      ),
      width: "min-w-[130px]",
    },
    {
      id: "priority",
      header: t("platform.feedback.col.priority", { defaultValue: "Priority" }),
      cell: (row) => (
        <Select
          value={row.priority}
          onValueChange={(value) => void patch(row.id, { priority: value })}
        >
          <SelectTrigger className="h-8 w-[120px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PRIORITIES.map((value) => (
              <SelectItem key={value} value={value} className="capitalize">
                {value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ),
      width: "min-w-[130px]",
    },
    {
      id: "status",
      header: t("platform.feedback.col.status", { defaultValue: "Status" }),
      cell: (row) => (
        <Select
          value={row.status}
          onValueChange={(value) => void patch(row.id, { status: value })}
        >
          <SelectTrigger className="h-8 w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUSES.map((value) => (
              <SelectItem key={value} value={value} className="capitalize">
                {humanize(value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ),
      width: "min-w-[150px]",
    },
    {
      id: "reply",
      header: t("platform.feedback.col.reply", { defaultValue: "Reply" }),
      cell: (row) =>
        row.adminResponse ? (
          <Badge variant="outline" className="text-xs font-normal">
            {t("platform.feedback.answered", { defaultValue: "Answered" })}
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
      align: "center",
      width: "min-w-[90px]",
    },
    {
      id: "received",
      header: t("platform.feedback.col.received", { defaultValue: "Received" }),
      cell: (row) => (
        <span className="text-xs text-muted-foreground">
          {new Date(row.createdAt).toLocaleDateString()}
        </span>
      ),
      width: "min-w-[110px]",
    },
  ];

  const filtersActive =
    status !== "all" || priority !== "all" || category !== "all" || Boolean(search);

  return (
    <ResponsiveLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">{t("platform.feedback.col.feedback", { defaultValue: "Feedback" })}</h1>
            <p className="text-sm text-muted-foreground">
              {t("platform.feedback.subtitle", { defaultValue: "What customers are telling us, across every organization." })}
            </p>
          </div>
          {/* Exports the filtered set, not the page on screen. */}
          <ReportExportButton
            endpoint="/api/admin/feedback"
            params={new URLSearchParams(query)}
            disabled={loading}
          />
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: t("platform.feedback.stats.total", { defaultValue: "Total" }), value: String(summary?.total ?? 0) },
            {
              label: t("platform.feedback.stats.averageRating", { defaultValue: "Average rating" }),
              value: summary?.total
                ? `${summary.averageRating.toFixed(1)}/5`
                : "—",
            },
            { label: t("platform.feedback.stats.open", { defaultValue: "Open" }), value: String(summary?.openCount ?? 0) },
            {
              label: t("platform.feedback.stats.ratingTrend", { defaultValue: "Rating trend" }),
              value: summary ? trendLabel[summary.ratingTrend] : "—",
            },
          ].map((card) => (
            <Card key={card.label}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {card.label}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold">{card.value}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        <DataTableCard
          icon={MessageSquareHeart}
          title={t("platform.feedback.card.title", { defaultValue: "All feedback" })}
          description={t("platform.feedback.card.description", { defaultValue: "Click a title to read it in full and reply." })}
          columns={columns}
          data={entries}
          loading={loading}
          getRowKey={(row) => row.id}
          headerActions={
            <Button variant="outline" size="sm" onClick={refresh}>
              <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            </Button>
          }
          search={{
            value: search,
            onSearch: (value) => {
              setSearch(value);
              setPage(1);
            },
            placeholder: t("platform.feedback.searchPlaceholder", { defaultValue: "Search titles and descriptions…" }),
          }}
          filters={[
            {
              id: "status",
              value: status,
              onChange: (value) => {
                setStatus(value);
                setPage(1);
              },
              options: [
                { value: "all", label: t("platform.feedback.filter.allStatuses", { defaultValue: "All statuses" }) },
                ...STATUSES.map((value) => ({
                  value,
                  label: humanize(value),
                })),
              ],
            },
            {
              id: "priority",
              value: priority,
              onChange: (value) => {
                setPriority(value);
                setPage(1);
              },
              options: [
                { value: "all", label: t("platform.feedback.filter.allPriorities", { defaultValue: "All priorities" }) },
                ...PRIORITIES.map((value) => ({ value, label: value })),
              ],
            },
            {
              id: "category",
              value: category,
              onChange: (value) => {
                setCategory(value);
                setPage(1);
              },
              options: [
                { value: "all", label: t("platform.feedback.filter.allCategories", { defaultValue: "All categories" }) },
                ...CATEGORIES.map((value) => ({
                  value,
                  label: humanize(value),
                })),
              ],
              width: "w-[170px]",
            },
          ]}
          filtersActive={filtersActive}
          onResetFilters={() => {
            setStatus("all");
            setPriority("all");
            setCategory("all");
            setSearch("");
            setPage(1);
          }}
          pagination={{
            currentPage: page,
            pageSize,
            totalItems: total,
            onPageChange: setPage,
          }}
          emptyState={{
            icon: <MessageSquareHeart className="h-10 w-10 text-muted-foreground" />,
            title: filtersActive
              ? t("platform.feedback.empty.filtered", { defaultValue: "No feedback matches these filters" })
              : t("platform.feedback.empty.none", { defaultValue: "No feedback has been submitted yet" }),
          }}
        />
      </div>

      <Dialog
        open={Boolean(active)}
        onOpenChange={(open) => {
          if (!open) setActive(null);
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{active?.title}</DialogTitle>
            <DialogDescription>
              {active?.organizationName} · {active?.authorName ?? "Unknown"} ·{" "}
              {active ? new Date(active.createdAt).toLocaleDateString() : ""}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className="capitalize">
                {active ? humanize(active.category) : ""}
              </Badge>
              <Badge
                variant={active ? PRIORITY_VARIANT[active.priority] : "outline"}
                className="capitalize"
              >
                {active?.priority}
              </Badge>
              <Badge
                variant={active ? STATUS_VARIANT[active.status] : "outline"}
                className="capitalize"
              >
                {active ? humanize(active.status) : ""}
              </Badge>
              {active?.feature && (
                <Badge variant="outline" className="capitalize">
                  {humanize(active.feature)}
                </Badge>
              )}
            </div>

            <p className="whitespace-pre-wrap text-sm">{active?.description}</p>

            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="feedback-reply">
                {t("platform.feedback.replyLabel", { defaultValue: "Reply to the author" })}
              </label>
              <Textarea
                id="feedback-reply"
                rows={4}
                value={replyDraft}
                onChange={(event) => setReplyDraft(event.target.value)}
                placeholder={t("platform.feedback.replyPlaceholder", { defaultValue: "This appears on their Feedback screen." })}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setActive(null)}>
              {t("platform.common.close", { defaultValue: "Close" })}
            </Button>
            <Button
              disabled={saving || !active}
              onClick={() => {
                if (active) void patch(active.id, { adminResponse: replyDraft });
              }}
            >
              {saving ? (
                <Loader2 className="me-2 h-4 w-4 animate-spin" />
              ) : (
                <Send className="me-2 h-4 w-4" />
              )}
              Send reply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ResponsiveLayout>
  );
}
