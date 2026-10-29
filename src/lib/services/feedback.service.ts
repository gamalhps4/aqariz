import "server-only";

import { db } from "@/lib/db/prisma";
import { Prisma } from "@/generated/prisma/client";

/**
 * PropertyPro - Product feedback
 *
 * Replaces an in-memory store that seeded itself with five hardcoded sample
 * entries in its constructor. Every deployment therefore showed the same
 * invented feedback, a restart erased anything real, and — since nothing
 * carried an organizationId and no platform screen read it — what a customer
 * wrote never reached the operator it was addressed to.
 *
 * Ownership is split. An organization owns its submissions; the platform owns
 * the triage. That is why `updateTriage` below is the only writer of status,
 * priority and adminResponse, and why the organization-facing route has no
 * path to it: whether "bulk payments" is next quarter's work is a roadmap
 * decision, not a customer's to set.
 */

export const FEEDBACK_CATEGORIES = [
  "usability",
  "performance",
  "feature_request",
  "bug_report",
  "general",
] as const;

export const FEEDBACK_PRIORITIES = ["low", "medium", "high", "critical"] as const;

export const FEEDBACK_STATUSES = [
  "new",
  "reviewing",
  "in_progress",
  "resolved",
  "closed",
] as const;

export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];
export type FeedbackPriority = (typeof FEEDBACK_PRIORITIES)[number];
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

/** Statuses that mean the platform is done with it. */
const CLOSED_STATUSES: readonly FeedbackStatus[] = ["resolved", "closed"];

export function isFeedbackCategory(value: unknown): value is FeedbackCategory {
  return FEEDBACK_CATEGORIES.includes(value as FeedbackCategory);
}

export function isFeedbackPriority(value: unknown): value is FeedbackPriority {
  return FEEDBACK_PRIORITIES.includes(value as FeedbackPriority);
}

export function isFeedbackStatus(value: unknown): value is FeedbackStatus {
  return FEEDBACK_STATUSES.includes(value as FeedbackStatus);
}

export interface FeedbackEntry {
  id: string;
  organizationId: string;
  /** Present only in the platform console, which reads across organizations. */
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
  updatedAt: string;
}

export interface FeedbackSummary {
  total: number;
  /** Rounded to one decimal; 0 when nothing has been submitted. */
  averageRating: number;
  /** Not yet resolved or closed. */
  openCount: number;
  answeredCount: number;
  byCategory: Record<string, number>;
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
  /**
   * Whether the average rating of the most recent third of submissions beats
   * the oldest third. "stable" until there are enough to compare, rather than
   * a confident trend drawn from two data points.
   */
  ratingTrend: "improving" | "declining" | "stable" | "insufficient_data";
}

export interface FeedbackListOptions {
  category?: string;
  status?: string;
  priority?: string;
  /** Restrict to one author. Set for callers who may only see their own. */
  userId?: string;
  /** Platform console only: narrow to a single customer organization. */
  organizationId?: string;
  search?: string;
  /**
   * A row scope from lib/db/scopes.ts, AND-ed onto the filters below so a
   * query parameter can never widen it — the same contract applyScope keeps
   * for the routes that build their own `where`.
   */
  scope?: Prisma.FeedbackWhereInput;
  limit?: number;
  offset?: number;
}

function personName(user?: {
  firstName?: string | null;
  lastName?: string | null;
} | null): string | null {
  const name = `${user?.firstName ?? ""} ${user?.lastName ?? ""}`.trim();
  return name || null;
}

type FeedbackRow = Prisma.FeedbackGetPayload<{
  include: {
    user: { select: { firstName: true; lastName: true } };
    organization: { select: { name: true } };
  };
}>;

function present(row: FeedbackRow, includeOrganization: boolean): FeedbackEntry {
  return {
    id: row.id,
    organizationId: row.organizationId,
    ...(includeOrganization
      ? { organizationName: row.organization?.name ?? "" }
      : {}),
    userId: row.userId,
    authorName: personName(row.user),
    userRole: row.userRole,
    category: row.category,
    rating: row.rating,
    title: row.title,
    description: row.description,
    feature: row.feature,
    priority: row.priority,
    status: row.status,
    tags: row.tags,
    adminResponse: row.adminResponse,
    respondedAt: row.respondedAt ? row.respondedAt.toISOString() : null,
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function buildWhere(options: FeedbackListOptions): Prisma.FeedbackWhereInput {
  const where: Prisma.FeedbackWhereInput = {};
  if (options.category) where.category = options.category;
  if (options.status) where.status = options.status;
  if (options.priority) where.priority = options.priority;
  if (options.userId) where.userId = options.userId;
  if (options.organizationId) where.organizationId = options.organizationId;
  if (options.search) {
    where.OR = [
      { title: { contains: options.search, mode: "insensitive" } },
      { description: { contains: options.search, mode: "insensitive" } },
    ];
  }
  if (options.scope && Object.keys(options.scope).length > 0) {
    where.AND = [options.scope];
  }
  return where;
}

export interface FeedbackPage {
  entries: FeedbackEntry[];
  total: number;
}

/**
 * List feedback, newest first.
 *
 * Organization scoping is RLS's job, not this function's: called through `db`
 * inside an organization context it returns that organization's rows, and
 * inside a platform context it returns everyone's. `includeOrganization` only
 * decides whether the customer's name travels with each row.
 */
export async function listFeedback(
  options: FeedbackListOptions = {},
  includeOrganization = false,
): Promise<FeedbackPage> {
  const where = buildWhere(options);
  const take = Math.min(options.limit ?? 50, 200);

  const [rows, total] = await Promise.all([
    db.feedback.findMany({
      where,
      include: {
        user: { select: { firstName: true, lastName: true } },
        organization: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: options.offset ?? 0,
      take,
    }),
    db.feedback.count({ where }),
  ]);

  return {
    entries: rows.map((row) => present(row, includeOrganization)),
    total,
  };
}

/** Counts and averages over the same rows `listFeedback` would return. */
export async function summarizeFeedback(
  options: FeedbackListOptions = {},
): Promise<FeedbackSummary> {
  const where = buildWhere(options);

  const [rows, byCategory, byStatus, byPriority] = await Promise.all([
    db.feedback.findMany({
      where,
      select: { rating: true, status: true, adminResponse: true },
      orderBy: { createdAt: "desc" },
    }),
    db.feedback.groupBy({ by: ["category"], where, _count: { _all: true } }),
    db.feedback.groupBy({ by: ["status"], where, _count: { _all: true } }),
    db.feedback.groupBy({ by: ["priority"], where, _count: { _all: true } }),
  ]);

  const total = rows.length;
  const averageRating =
    total === 0
      ? 0
      : Math.round(
          (rows.reduce((sum, row) => sum + row.rating, 0) / total) * 10,
        ) / 10;

  const tally = (
    groups: Array<{ _count: { _all: number } } & Record<string, unknown>>,
    key: string,
  ): Record<string, number> =>
    Object.fromEntries(
      groups.map((group) => [String(group[key]), group._count._all]),
    );

  return {
    total,
    averageRating,
    openCount: rows.filter(
      (row) => !CLOSED_STATUSES.includes(row.status as FeedbackStatus),
    ).length,
    answeredCount: rows.filter((row) => row.adminResponse !== null).length,
    byCategory: tally(byCategory, "category"),
    byStatus: tally(byStatus, "status"),
    byPriority: tally(byPriority, "priority"),
    ratingTrend: ratingTrend(rows.map((row) => row.rating)),
  };
}

/**
 * Compare the newest third of ratings against the oldest third.
 *
 * `ratings` arrives newest-first. Below nine submissions the thirds are too
 * small to mean anything, so this says so rather than calling a trend from a
 * couple of rows — which is what the old in-memory version did, and why an
 * untouched demo always read "Improving".
 */
function ratingTrend(ratings: number[]): FeedbackSummary["ratingTrend"] {
  if (ratings.length < 9) return "insufficient_data";
  const third = Math.floor(ratings.length / 3);
  const mean = (values: number[]) =>
    values.reduce((sum, value) => sum + value, 0) / values.length;
  const recent = mean(ratings.slice(0, third));
  const oldest = mean(ratings.slice(-third));
  const delta = recent - oldest;
  if (delta > 0.25) return "improving";
  if (delta < -0.25) return "declining";
  return "stable";
}

export interface SubmitFeedbackInput {
  organizationId: string;
  userId: string;
  userRole: string;
  category: FeedbackCategory;
  rating: number;
  title: string;
  description: string;
  feature?: string | null;
  tags?: string[];
}

/**
 * Record one submission.
 *
 * The opening priority is derived, not accepted from the client: a one-star
 * report or a bug is high, a three-star or a performance complaint is medium,
 * everything else is low. The platform can change it afterwards; the submitter
 * never sets it, or every submission would arrive critical.
 */
export async function submitFeedback(
  input: SubmitFeedbackInput,
): Promise<FeedbackEntry> {
  const priority: FeedbackPriority =
    input.rating <= 2 || input.category === "bug_report"
      ? "high"
      : input.rating === 3 || input.category === "performance"
        ? "medium"
        : "low";

  const row = await db.feedback.create({
    data: {
      organizationId: input.organizationId,
      userId: input.userId,
      userRole: input.userRole,
      category: input.category,
      rating: input.rating,
      title: input.title,
      description: input.description,
      feature: input.feature ?? null,
      tags: input.tags ?? [],
      priority,
      status: "new",
    },
    include: {
      user: { select: { firstName: true, lastName: true } },
      organization: { select: { name: true } },
    },
  });

  return present(row, false);
}

export interface TriageInput {
  status?: FeedbackStatus;
  priority?: FeedbackPriority;
  adminResponse?: string;
}

/**
 * Platform-side triage: status, priority, and the reply the author sees.
 *
 * Only reachable through the platform console. Callers must already be running
 * in a platform context — this deliberately does not bypass scoping itself, so
 * an organization route that imported it by mistake would fail to find the row
 * rather than quietly edit it.
 */
export async function updateTriage(
  feedbackId: string,
  input: TriageInput,
): Promise<FeedbackEntry | null> {
  const existing = await db.feedback.findFirst({
    where: { id: feedbackId },
    select: { id: true, resolvedAt: true },
  });
  if (!existing) return null;

  const data: Prisma.FeedbackUpdateInput = {};
  if (input.priority) data.priority = input.priority;
  if (input.adminResponse !== undefined) {
    // The CHECK constraint keeps a reply and its timestamp together, so an
    // empty reply must clear both rather than leave a dangling date.
    const reply = input.adminResponse.trim();
    data.adminResponse = reply || null;
    data.respondedAt = reply ? new Date() : null;
  }
  if (input.status) {
    data.status = input.status;
    const closing = CLOSED_STATUSES.includes(input.status);
    // Stamp the first close and keep it; reopening clears it.
    data.resolvedAt = closing ? (existing.resolvedAt ?? new Date()) : null;
  }

  const row = await db.feedback.update({
    where: { id: feedbackId },
    data,
    include: {
      user: { select: { firstName: true, lastName: true } },
      organization: { select: { name: true } },
    },
  });

  return present(row, true);
}
