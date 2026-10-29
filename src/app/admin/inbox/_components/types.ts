/** Shapes returned by /api/admin/inbox — kept in one place so the list and the
 * thread cannot drift apart. */

export const TOPICS = ["support", "sales", "billing", "security"] as const;
export type Topic = (typeof TOPICS)[number];

export const STATUSES = ["new", "open", "replied", "closed"] as const;
export type Status = (typeof STATUSES)[number];

export type View = "all" | "unread" | "starred" | "archived";

export interface InboxListItem {
  id: string;
  topic: Topic;
  name: string;
  email: string;
  company: string | null;
  subject: string;
  preview: string;
  status: Status;
  isRead: boolean;
  isStarred: boolean;
  isArchived: boolean;
  lastReplyAt: string | null;
  createdAt: string;
  replyCount: number;
}

export interface InboxReply {
  id: string;
  body: string;
  authorId: string;
  authorName: string;
  authorEmail: string;
  emailSent: boolean;
  emailError: string | null;
  createdAt: string;
}

export interface InboxThread {
  id: string;
  topic: Topic;
  name: string;
  email: string;
  company: string | null;
  subject: string;
  message: string;
  status: Status;
  isRead: boolean;
  isStarred: boolean;
  isArchived: boolean;
  lastReplyAt: string | null;
  submittedById: string | null;
  createdAt: string;
  replies: InboxReply[];
}

export const TOPIC_LABEL: Record<Topic, string> = {
  support: "Support",
  sales: "Sales",
  billing: "Billing",
  security: "Security",
};

export const STATUS_LABEL: Record<Status, string> = {
  new: "New",
  open: "Open",
  replied: "Replied",
  closed: "Closed",
};

/** One accent per topic so a full queue is scannable without reading it. */
export const TOPIC_CLASS: Record<Topic, string> = {
  support:
    "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300",
  sales:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
  billing:
    "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300",
  security:
    "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300",
};

export function initialsOf(name: string): string {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (parts.length === 0) return "?";
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("");
}
