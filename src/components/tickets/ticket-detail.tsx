"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  TicketStatusBadge,
  TicketPriorityBadge,
} from "@/components/tickets/ticket-status-badge";
import { TicketStatus, TicketPriority } from "@/types";
import {
  Clock,
  Building2,
  User,
  MessageSquare,
  Send,
  Loader2,
  Calendar,
  Hash,
  Shield,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { roleDisplayName } from "@/lib/role-display";
import { createAccessProfile } from "@/lib/permissions-manager";
import { useRolePermissions } from "@/hooks/useRolePermissions";

interface Comment {
  _id: string;
  userId: {
    _id: string;
    firstName: string;
    lastName: string;
    email: string;
    avatar?: string;
    role?: string;
  };
  message: string;
  attachments?: string[];
  isInternal?: boolean;
  createdAt: string;
}

interface TicketData {
  _id: string;
  ticketNumber: string;
  title: string;
  description: string;
  category: string;
  priority: TicketPriority;
  status: TicketStatus;
  attachments: string[];
  comments: Comment[];
  tenant: {
    _id: string;
    firstName: string;
    lastName: string;
    email: string;
    avatar?: string;
    phone?: string;
  };
  property?: {
    _id: string;
    name: string;
    address: any;
  } | null;
  assignedUser?: {
    _id: string;
    firstName: string;
    lastName: string;
    email: string;
    avatar?: string;
  } | null;
  createdBy?: {
    userId: {
      _id: string;
      firstName: string;
      lastName: string;
      email: string;
      avatar?: string;
    } | string;
    role: string;
  };
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
  closedAt?: string;
}

interface TicketDetailProps {
  ticket: TicketData;
  userRole: string;
  onStatusChange?: (status: TicketStatus) => Promise<void>;
  onCommentAdded?: () => void;
}

export function TicketDetail({
  ticket,
  userRole,
  onStatusChange,
  onCommentAdded,
}: TicketDetailProps) {
  const { t, currentLocale } = useLocalizationContext();
  const [newComment, setNewComment] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isInternal, setIsInternal] = useState(false);
  const [comments, setComments] = useState<Comment[]>(ticket.comments || []);

  const { permissions: rolePermissions, storedGroup } = useRolePermissions();
  const viewerAccess = createAccessProfile(userRole, rolePermissions, null, {
    storedGroup,
  });
  const isStaff = viewerAccess.isCompanyStaff;

  const handleAddComment = async () => {
    if (!newComment.trim()) {
      toast.error(t("tickets.detail.toasts.commentRequired"));
      return;
    }

    try {
      setIsSubmitting(true);
      const response = await fetch(`/api/tickets/${ticket._id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: newComment.trim(),
          isInternal: isStaff ? isInternal : false,
        }),
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || t("tickets.detail.toasts.commentAddError"));
      }

      setComments((prev) => [...prev, result.data]);
      setNewComment("");
      setIsInternal(false);
      toast.success(t("tickets.detail.toasts.commentAdded"));
      onCommentAdded?.();
    } catch (error) {
      const msg =
        error instanceof Error
          ? error.message
          : t("tickets.detail.toasts.commentAddError");
      toast.error(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStatusChange = async (newStatus: TicketStatus) => {
    if (onStatusChange) {
      await onStatusChange(newStatus);
    }
  };

  const formatDateTime = (date: string) => {
    return new Intl.DateTimeFormat(currentLocale, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(date));
  };

  const categoryKey = `tickets.category.${
    ticket.category === "noise_complaint" ? "noiseComplaint" : ticket.category
  }`;
  const categoryLabel = t(categoryKey, { defaultValue: ticket.category });
  const commentsTitle = t("tickets.detail.commentsTitle", {
    values: { count: comments.length },
  });
  const attachmentTitle = t("tickets.detail.attachmentsCount", {
    values: { count: ticket.attachments?.length || 0 },
  });
  const staffLabel = t("tickets.detail.staff");
  const internalNoteBadge = t("tickets.detail.internalNoteBadge");
  const unknownUser = t("tickets.detail.unknownUser");
  const statusOptions: Array<{ value: TicketStatus; label: string }> = [
    { value: TicketStatus.OPEN, label: t("tickets.status.open") },
    { value: TicketStatus.IN_PROGRESS, label: t("tickets.status.inProgress") },
    { value: TicketStatus.RESOLVED, label: t("tickets.status.resolved") },
    { value: TicketStatus.CLOSED, label: t("tickets.status.closed") },
  ];

  const getAttachmentAlt = (index: number) =>
    t("tickets.detail.attachmentAlt", {
      values: { number: index + 1 },
      defaultValue: `Attachment ${index + 1}`,
    });

  return (
    <div className="space-y-6">
      {/* Ticket Header */}
      <Card className="border-0 shadow-lg bg-white/70 dark:bg-gray-900/70 backdrop-blur-sm">
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Hash className="h-4 w-4" />
                {ticket.ticketNumber}
              </div>
              <CardTitle className="text-xl">{ticket.title}</CardTitle>
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <TicketStatusBadge status={ticket.status} />
                <TicketPriorityBadge priority={ticket.priority} />
                <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded-full">
                  {categoryLabel}
                </span>
              </div>
            </div>
            {/* Status update for staff */}
            {isStaff && (
              <div className="flex items-center gap-2">
                <Select
                  value={ticket.status}
                  onValueChange={(value) =>
                    handleStatusChange(value as TicketStatus)
                  }
                >
                  <SelectTrigger className="w-[160px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {statusOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Description */}
          <div>
            <h4 className="text-sm font-medium text-muted-foreground mb-2">
              {t("tickets.form.description")}
            </h4>
            <p className="text-sm whitespace-pre-wrap">{ticket.description}</p>
          </div>

          {/* Attachments */}
          {ticket.attachments && ticket.attachments.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-muted-foreground mb-2">
                {attachmentTitle}
              </h4>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {ticket.attachments.map((url, i) => (
                  <a
                    key={i}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block rounded-lg overflow-hidden border hover:border-primary transition-colors"
                  >
                    <img
                      src={url}
                      alt={getAttachmentAlt(i)}
                      className="w-full h-24 object-cover"
                    />
                  </a>
                ))}
              </div>
            </div>
          )}

          <Separator />

          {/* Ticket Info Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
            {/* Tenant */}
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-muted-foreground text-xs">
                  {t("tickets.detail.submittedBy")}
                </p>
                <p className="font-medium">
                  {ticket.tenant?.firstName} {ticket.tenant?.lastName}
                </p>
              </div>
            </div>

            {/* Property */}
            {ticket.property && (
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-muted-foreground text-xs">
                    {t("tickets.table.property")}
                  </p>
                  <p className="font-medium">{ticket.property.name}</p>
                </div>
              </div>
            )}

            {/* Created By */}
            {ticket.createdBy && (
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-muted-foreground text-xs">
                    {t("tickets.table.createdBy")}
                  </p>
                  <div className="flex items-center gap-2">
                    <p className="font-medium">
                      {typeof ticket.createdBy.userId === "object"
                        ? `${ticket.createdBy.userId.firstName} ${ticket.createdBy.userId.lastName}`
                        : unknownUser}
                    </p>
                    <Badge variant="secondary" className="capitalize text-xs">
                      {roleDisplayName(ticket.createdBy.role, {
                        language: currentLocale,
                        t,
                      })}
                    </Badge>
                  </div>
                </div>
              </div>
            )}

            {/* Created */}
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-muted-foreground text-xs">
                  {t("tickets.table.created")}
                </p>
                <p className="font-medium">
                  {formatDateTime(ticket.createdAt)}
                </p>
              </div>
            </div>

            {/* Assigned to */}
            {ticket.assignedUser && (
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-muted-foreground text-xs">
                    {t("tickets.detail.assignedTo")}
                  </p>
                  <p className="font-medium">
                    {ticket.assignedUser.firstName}{" "}
                    {ticket.assignedUser.lastName}
                  </p>
                </div>
              </div>
            )}

            {/* Resolved */}
            {ticket.resolvedAt && (
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-muted-foreground text-xs">
                    {t("tickets.detail.resolved")}
                  </p>
                  <p className="font-medium">{formatDateTime(ticket.resolvedAt)}</p>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Comments Section */}
      <Card className="border-0 shadow-lg bg-white/70 dark:bg-gray-900/70 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-blue-500" />
            {commentsTitle}
          </CardTitle>
          <CardDescription>
            {t("tickets.detail.commentsDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Comments List */}
          {comments.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <MessageSquare className="h-10 w-10 mx-auto mb-2 opacity-50" />
              <p>{t("tickets.detail.noComments")}</p>
            </div>
          ) : (
            <div className="space-y-4">
              {comments.map((comment) => (
                <div
                  key={comment._id}
                  className={`flex gap-3 p-3 rounded-lg ${
                    comment.isInternal
                      ? "bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800"
                      : "bg-muted/50"
                  }`}
                >
                  <Avatar className="h-8 w-8 flex-shrink-0">
                    <AvatarImage src={comment.userId?.avatar} />
                    <AvatarFallback className="text-xs">
                      {comment.userId?.firstName?.[0]}
                      {comment.userId?.lastName?.[0]}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">
                        {comment.userId?.firstName} {comment.userId?.lastName}
                      </span>
                      {comment.userId?.role &&
                        createAccessProfile(comment.userId.role).isCompanyStaff && (
                          <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                            {staffLabel}
                          </span>
                        )}
                      {comment.isInternal && (
                        <span className="text-xs bg-amber-200 text-amber-800 dark:bg-amber-800 dark:text-amber-200 px-1.5 py-0.5 rounded">
                          {internalNoteBadge}
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {formatDateTime(comment.createdAt)}
                      </span>
                    </div>
                    <p className="text-sm mt-1 whitespace-pre-wrap">
                      {comment.message}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          <Separator />

          {/* Add Comment Form */}
          <div className="space-y-3">
            <Textarea
              placeholder={t("tickets.detail.commentPlaceholder")}
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              rows={3}
            />
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {isStaff && (
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isInternal}
                      onChange={(e) => setIsInternal(e.target.checked)}
                      className="rounded border-gray-300"
                    />
                    <span className="text-amber-600 dark:text-amber-400">
                      {t("tickets.detail.internalNoteLabel")}
                    </span>
                  </label>
                )}
              </div>
              <Button
                onClick={handleAddComment}
                disabled={isSubmitting || !newComment.trim()}
                size="sm"
                className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700"
              >
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 me-2 animate-spin" />
                ) : (
                  <Send className="h-4 w-4 me-2" />
                )}
                {t("tickets.detail.send")}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
