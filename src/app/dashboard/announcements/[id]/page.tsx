"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "@/lib/auth-client";
import { toast } from "sonner";
import {
  Archive,
  ArrowLeft,
  Calendar,
  Clock,
  Eye,
  Heart,
  Info,
  Loader2,
  Megaphone,
  Pencil,
  Sparkles,
  Tag,
  ThumbsUp,
  Trash2,
  Users,
} from "lucide-react";

import { useAuthorization } from "@/hooks/useAuthorization";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { timeAgo } from "@/lib/utils/date-fns-locale";

// ---------- Types ----------

type ReactionType = "like" | "love" | "helpful" | "important";

interface AnnouncementDetail {
  id: string;
  title: string;
  content: string;
  priority: "low" | "normal" | "high" | "urgent";
  type: string;
  status: string;
  publishedAt?: string;
  scheduledFor?: string;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
  isSticky: boolean;
  allowComments: boolean;
  viewCount: number;
  reactionCounts: Record<string, number>;
  userReaction: ReactionType | null;
  userHasViewed: boolean;
  attachments?: Array<{
    fileName: string;
    fileUrl: string;
    fileSize: number;
    fileType: string;
  }>;
  actionButton?: { text: string; url: string } | null;
  createdBy?: {
    firstName?: string;
    lastName?: string;
    email?: string;
  };
  targetAudience?: {
    includeAll?: boolean;
    roles?: string[];
    propertyIds?: Array<{ _id: string; name?: string }>;
  };
}

// ---------- Helpers ----------

function getPriorityVariant(priority: string) {
  switch (priority) {
    case "urgent":
      return "destructive" as const;
    case "high":
      return "warning" as const;
    case "normal":
      return "info" as const;
    case "low":
      return "secondary" as const;
    default:
      return "default" as const;
  }
}

function getStatusVariant(status: string) {
  switch (status) {
    case "published":
      return "default" as const;
    case "draft":
      return "secondary" as const;
    case "scheduled":
      return "info" as const;
    case "expired":
      return "warning" as const;
    case "archived":
      return "outline" as const;
    default:
      return "default" as const;
  }
}

// ---------- Component ----------

export default function AnnouncementDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, status: sessionStatus } = useSession();
  const { isCompanyStaff } = useAuthorization();
  const { t, formatDate } = useLocalizationContext();

  const [announcement, setAnnouncement] = useState<AnnouncementDetail | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [reacting, setReacting] = useState(false);
  const [isEditing, setIsEditing] = useState(
    searchParams.get("edit") === "true",
  );
  const [editForm, setEditForm] = useState({
    title: "",
    content: "",
    priority: "normal",
    type: "general",
  });
  const [isSaving, setIsSaving] = useState(false);

  const isAdmin = sessionStatus === "authenticated" && isCompanyStaff;

  const reactionOptions = useMemo(
    () => [
      {
        value: "like" as ReactionType,
        label: t("announcements.reactions.like"),
        icon: <ThumbsUp className="h-4 w-4" />,
      },
      {
        value: "love" as ReactionType,
        label: t("announcements.reactions.love"),
        icon: <Heart className="h-4 w-4" />,
      },
      {
        value: "helpful" as ReactionType,
        label: t("announcements.reactions.helpful"),
        icon: <Sparkles className="h-4 w-4" />,
      },
      {
        value: "important" as ReactionType,
        label: t("announcements.reactions.important"),
        icon: <Info className="h-4 w-4" />,
      },
    ],
    [t],
  );

  // ---------- Fetch ----------

  const fetchAnnouncement = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/announcements/${id}`);
      const payload = await res.json();

      if (!res.ok) {
        throw new Error(payload?.error || "Failed to load announcement");
      }

      const data = payload?.data?.announcement ?? payload?.announcement;
      if (!data) {
        throw new Error("Announcement not found");
      }

      const resolveId = (v: any) =>
        typeof v === "string" ? v : (v?.toString?.() ?? String(v ?? ""));

      const normalized: AnnouncementDetail = {
        id: resolveId(data._id ?? data.id),
        title: data.title ?? "",
        content: data.content ?? "",
        priority: data.priority ?? "normal",
        type: data.type ?? "general",
        status: data.status ?? "draft",
        publishedAt: data.publishedAt,
        scheduledFor: data.scheduledFor,
        expiresAt: data.expiresAt,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
        isSticky: data.isSticky ?? false,
        allowComments: data.allowComments ?? true,
        viewCount: Number(data.viewCount ?? data.views?.length ?? 0),
        reactionCounts: data.reactionCounts ?? {},
        userReaction: data.userReaction ?? null,
        userHasViewed: data.userHasViewed ?? false,
        attachments: data.attachments ?? [],
        actionButton: data.actionButton ?? null,
        createdBy: data.createdBy,
        targetAudience: data.targetAudience,
      };

      setAnnouncement(normalized);
      setEditForm({
        title: normalized.title,
        content: normalized.content,
        priority: normalized.priority,
        type: normalized.type,
      });
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : t("announcements.detail.loadError"),
      );
      router.push("/dashboard/announcements");
    } finally {
      setLoading(false);
    }
  }, [id, router, t]);

  useEffect(() => {
    if (id && sessionStatus === "authenticated") {
      fetchAnnouncement();
    }
  }, [id, sessionStatus, fetchAnnouncement]);

  // ---------- Actions ----------

  const handleReaction = async (reaction: ReactionType) => {
    if (!announcement) return;
    const isRemoving = announcement.userReaction === reaction;

    setReacting(true);
    try {
      let response: Response;
      if (isRemoving) {
        response = await fetch(`/api/announcements/${id}?action=reaction`, {
          method: "DELETE",
        });
      } else {
        response = await fetch(`/api/announcements/${id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "reaction", reactionType: reaction }),
        });
      }

      if (!response.ok) throw new Error("Failed to update reaction");

      const payload = await response.json();
      const data = payload?.data?.announcement ?? payload?.announcement;
      if (data) {
        setAnnouncement((prev) =>
          prev
            ? {
                ...prev,
                userReaction: isRemoving ? null : reaction,
                reactionCounts: data.reactionCounts ?? prev.reactionCounts,
              }
            : prev,
        );
      }
    } catch {
      toast.error(t("announcements.toasts.reactionError"));
    } finally {
      setReacting(false);
    }
  };

  const handleSave = async () => {
    if (!editForm.title.trim() || !editForm.content.trim()) {
      toast.error(t("announcements.toasts.fillRequired"));
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch(`/api/announcements/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update",
          title: editForm.title,
          content: editForm.content,
          priority: editForm.priority,
          type: editForm.type,
        }),
      });

      if (!response.ok) throw new Error("Failed to update");

      toast.success(t("announcements.toasts.updated"));
      setIsEditing(false);
      await fetchAnnouncement();
    } catch {
      toast.error(t("announcements.toasts.updateError"));
    } finally {
      setIsSaving(false);
    }
  };

  const handleArchive = async () => {
    try {
      const response = await fetch(`/api/announcements/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "archive" }),
      });

      if (!response.ok) throw new Error("Failed to archive");

      toast.success(t("announcements.toasts.archived"));
      await fetchAnnouncement();
    } catch {
      toast.error(t("announcements.toasts.archiveError"));
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const response = await fetch(`/api/announcements/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "softDelete" }),
      });

      if (!response.ok) throw new Error("Failed to delete");

      toast.success(t("announcements.toasts.deleted"));
      router.push("/dashboard/announcements");
    } catch {
      toast.error(t("announcements.toasts.deleteError"));
      setDeleting(false);
    }
  };

  // ---------- Loading ----------

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!announcement) return null;

  const authorName = announcement.createdBy
    ? `${announcement.createdBy.firstName ?? ""} ${announcement.createdBy.lastName ?? ""}`.trim() ||
      announcement.createdBy.email
    : null;

  // ---------- Render ----------

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("announcements.detail.title")}
          </h1>
          <p className="text-sm text-muted-foreground">
            ID: {announcement.id.slice(0, 8)}...
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="hover:bg-blue-50 hover:text-blue-600 border transition-colors"
            onClick={() => router.push("/dashboard/announcements")}
          >
            <ArrowLeft className="h-4 w-4 me-2 rtl:-scale-x-100" />
            {t("announcements.detail.back")}
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main content */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Megaphone className="h-6 w-6" />
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  {isEditing ? (
                    <Input
                      value={editForm.title}
                      onChange={(e) =>
                        setEditForm({ ...editForm, title: e.target.value })
                      }
                      className="text-xl font-semibold"
                      maxLength={200}
                    />
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-xl font-semibold text-foreground">
                        {announcement.title}
                      </h2>
                      {announcement.isSticky && (
                        <Badge variant="outline" className="text-xs">
                          {t("announcements.table.pinned")}
                        </Badge>
                      )}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Badge variant={getPriorityVariant(announcement.priority)}>
                      {t(`announcements.priority.${announcement.priority}`)}
                    </Badge>
                    <Badge variant="outline" className="capitalize">
                      {t(`announcements.type.${announcement.type}`)}
                    </Badge>
                    <Badge variant={getStatusVariant(announcement.status)}>
                      {t(`announcements.status.${announcement.status}`)}
                    </Badge>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Separator className="mb-4" />
              <div className="space-y-4">
                {/* Content */}
                <div>
                  <h3 className="text-sm font-medium text-muted-foreground mb-1">
                    {t("announcements.detail.content")}
                  </h3>
                  {isEditing ? (
                    <Textarea
                      value={editForm.content}
                      onChange={(e) =>
                        setEditForm({ ...editForm, content: e.target.value })
                      }
                      rows={6}
                      maxLength={5000}
                    />
                  ) : (
                    <p className="text-foreground leading-relaxed whitespace-pre-wrap rounded-md bg-muted/40 p-4">
                      {announcement.content}
                    </p>
                  )}
                </div>

                {/* Edit fields */}
                {isEditing && (
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>
                        {t("announcements.dialog.create.priorityLabel")}
                      </Label>
                      <Select
                        value={editForm.priority}
                        onValueChange={(v) =>
                          setEditForm({ ...editForm, priority: v })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="low">
                            {t("announcements.priority.low")}
                          </SelectItem>
                          <SelectItem value="normal">
                            {t("announcements.priority.normal")}
                          </SelectItem>
                          <SelectItem value="high">
                            {t("announcements.priority.high")}
                          </SelectItem>
                          <SelectItem value="urgent">
                            {t("announcements.priority.urgent")}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>
                        {t("announcements.dialog.create.typeLabel")}
                      </Label>
                      <Select
                        value={editForm.type}
                        onValueChange={(v) =>
                          setEditForm({ ...editForm, type: v })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="general">
                            {t("announcements.type.general")}
                          </SelectItem>
                          <SelectItem value="maintenance">
                            {t("announcements.type.maintenance")}
                          </SelectItem>
                          <SelectItem value="policy">
                            {t("announcements.type.policy")}
                          </SelectItem>
                          <SelectItem value="emergency">
                            {t("announcements.type.emergency")}
                          </SelectItem>
                          <SelectItem value="event">
                            {t("announcements.type.event")}
                          </SelectItem>
                          <SelectItem value="system">
                            {t("announcements.type.system")}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}

                {/* Edit buttons */}
                {isEditing && (
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      onClick={() => setIsEditing(false)}
                      disabled={isSaving}
                    >
                      {t("common.cancel")}
                    </Button>
                    <Button onClick={handleSave} disabled={isSaving}>
                      {isSaving && (
                        <Loader2 className="me-2 h-4 w-4 animate-spin" />
                      )}
                      {t("common.save")}
                    </Button>
                  </div>
                )}

                {/* Attachments */}
                {!isEditing &&
                  announcement.attachments &&
                  announcement.attachments.length > 0 && (
                    <>
                      <Separator />
                      <div className="space-y-2">
                        <h3 className="text-sm font-medium text-muted-foreground">
                          {t("announcements.detail.attachments")}
                        </h3>
                        <ul className="space-y-1">
                          {announcement.attachments.map((attachment) => (
                            <li
                              key={`${attachment.fileUrl}-${attachment.fileName}`}
                            >
                              <Button asChild variant="link" className="px-0">
                                <Link
                                  href={attachment.fileUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  {attachment.fileName}
                                </Link>
                              </Button>
                              <span className="ms-2 text-xs text-muted-foreground">
                                {attachment.fileSize
                                  ? `${(attachment.fileSize / 1024).toFixed(1)} KB`
                                  : ""}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </>
                  )}

                {/* Engagement & Reactions */}
                {!isEditing && (
                  <>
                    <Separator />
                    <div className="rounded-md border p-3 space-y-3">
                      <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Eye className="h-4 w-4" />
                          <span className="font-semibold text-foreground">
                            {announcement.viewCount}
                          </span>{" "}
                          {t("announcements.detail.views")}
                        </span>
                        <span>
                          <span className="font-semibold text-foreground">
                            {announcement.reactionCounts?.total ?? 0}
                          </span>{" "}
                          {t("announcements.detail.reactionsLabel")}
                        </span>
                        {announcement.userHasViewed && (
                          <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                            {t("announcements.detail.viewedByYou")}
                          </span>
                        )}
                      </div>

                      {/* Reaction breakdown */}
                      <div className="flex flex-wrap gap-2">
                        {reactionOptions.map((option) => {
                          const count =
                            announcement.reactionCounts?.[option.value] ?? 0;
                          const isActive =
                            announcement.userReaction === option.value;
                          return (
                            <Button
                              key={option.value}
                              variant={isActive ? "default" : "outline"}
                              size="sm"
                              className="gap-1"
                              disabled={reacting}
                              onClick={() => handleReaction(option.value)}
                            >
                              {option.icon}
                              <span>{option.label}</span>
                              {count > 0 && (
                                <Badge
                                  variant="secondary"
                                  className="ms-1 px-1.5 py-0 text-xs"
                                >
                                  {count}
                                </Badge>
                              )}
                            </Button>
                          );
                        })}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Actions */}
          {isAdmin && !isEditing && (
            <Card>
              <CardHeader>
                <h3 className="text-sm font-semibold text-foreground">
                  {t("announcements.table.actions")}
                </h3>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => setIsEditing(true)}
                >
                  <Pencil className="h-4 w-4 me-2" />
                  {t("announcements.actions.edit")}
                </Button>

                {announcement.status !== "archived" && (
                  <Button
                    variant="outline"
                    className="w-full justify-start"
                    onClick={handleArchive}
                  >
                    <Archive className="h-4 w-4 me-2" />
                    {t("announcements.actions.archive")}
                  </Button>
                )}

                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="outline"
                      className="w-full justify-start text-destructive hover:text-destructive hover:bg-destructive/10"
                      disabled={deleting}
                    >
                      {deleting ? (
                        <Loader2 className="h-4 w-4 me-2 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4 me-2" />
                      )}
                      {t("announcements.actions.delete")}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        {t("announcements.deleteDialog.singleTitle")}
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        {t("announcements.deleteDialog.detailDescription")}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>
                        {t("common.cancel")}
                      </AlertDialogCancel>
                      <AlertDialogAction
                        onClick={handleDelete}
                        className="bg-red-600 hover:bg-red-700 text-white"
                      >
                        {t("announcements.actions.delete")}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </CardContent>
            </Card>
          )}

          {/* Info */}
          <Card>
            <CardHeader>
              <h3 className="text-sm font-semibold text-foreground">
                {t("announcements.detail.information")}
              </h3>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
                  <Tag className="h-4 w-4 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">
                    {t("announcements.table.status")}
                  </p>
                  <Badge
                    variant={getStatusVariant(announcement.status)}
                    className="mt-0.5"
                  >
                    {t(`announcements.status.${announcement.status}`)}
                  </Badge>
                </div>
              </div>

              {authorName && (
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
                    <Users className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">
                      {t("announcements.detail.author")}
                    </p>
                    <p className="text-sm font-medium">{authorName}</p>
                  </div>
                </div>
              )}

              {announcement.publishedAt && (
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">
                      {t("announcements.detail.published")}
                    </p>
                    <p className="text-sm font-medium">
                      {formatDate(new Date(announcement.publishedAt), {
                        year: "numeric",
                        month: "short",
                        day: "2-digit",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">
                    {t("announcements.detail.created")}
                  </p>
                  <p className="text-sm font-medium">
                    {formatDate(new Date(announcement.createdAt), {
                      year: "numeric",
                      month: "short",
                      day: "2-digit",
                    })}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {timeAgo(new Date(announcement.createdAt))}
                  </p>
                </div>
              </div>

              {/* Target Audience */}
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
                  <Users className="h-4 w-4 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">
                    {t("announcements.detail.audience")}
                  </p>
                  <p className="text-sm font-medium">
                    {announcement.targetAudience?.includeAll
                      ? t("announcements.audience.everyone")
                      : announcement.targetAudience?.roles?.length
                        ? announcement.targetAudience.roles
                            .map((r) => r.charAt(0).toUpperCase() + r.slice(1))
                            .join(", ")
                        : t("announcements.audience.specific")}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
