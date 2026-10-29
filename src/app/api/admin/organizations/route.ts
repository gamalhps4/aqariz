/**
 * PropertyPro SaaS - Platform admin: organizations
 *
 * Super-admin only. Lists organizations on the platform with basic counts.
 * Scoping is disabled for these handlers (see withPlatformAdminAndDB), so
 * reads intentionally span all organizations.
 *
 * Search, filtering, sorting and paging happen in the database rather than in
 * the console: the row counts used to be fetched with a query per organization
 * for the entire table, which only got slower as the platform grew.
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  withPlatformAdminAndDB,
} from "@/lib/api-utils";
import {
  buildReportResponse,
  isReportFormat,
  EXPORT_ROW_LIMIT,
  type ReportFormat,
  type ReportSheet,
} from "@/lib/reports/export";
import { getPlatformLetterhead } from "@/lib/reports/letterhead";
import type { Prisma } from "@/generated/prisma/client";
import { businessDay, businessToday } from "@/lib/dates/business-day";

const PAGE_SIZE_OPTIONS = [12, 20, 50, 100];
const DEFAULT_PAGE_SIZE = 12;
const STATUSES = new Set(["active", "trial", "suspended"]);

/** Sort keys the console offers, mapped onto Prisma order clauses. */
const SORTS: Record<string, Prisma.OrganizationOrderByWithRelationInput> = {
  "createdAt-desc": { createdAt: "desc" },
  "createdAt-asc": { createdAt: "asc" },
  "name-asc": { name: "asc" },
  "name-desc": { name: "desc" },
  "users-desc": { users: { _count: "desc" } },
  "properties-desc": { properties: { _count: "desc" } },
};

// GET /api/admin/organizations - list organizations with counts
export const GET = withPlatformAdminAndDB()(
  async (_user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const params = request.nextUrl.searchParams;

      const requestedPage = Number.parseInt(params.get("page") || "1", 10);
      const page =
        Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;

      const requestedSize = Number.parseInt(
        params.get("pageSize") || String(DEFAULT_PAGE_SIZE),
        10,
      );
      const pageSize = PAGE_SIZE_OPTIONS.includes(requestedSize)
        ? requestedSize
        : DEFAULT_PAGE_SIZE;

      const search = params.get("search")?.trim() || "";
      const status = params.get("status") || "all";
      const plan = params.get("plan") || "all";
      const sort = params.get("sort") || "createdAt-desc";

      const where: Prisma.OrganizationWhereInput = {
        ...(STATUSES.has(status) ? { status } : {}),
        ...(plan && plan !== "all" ? { plan } : {}),
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: "insensitive" } },
                { slug: { contains: search, mode: "insensitive" } },
                { plan: { contains: search, mode: "insensitive" } },
              ],
            }
          : {}),
      };

      // Same `where`, same order — the file carries the filtered set, not the
      // page of it on screen. The platform's own name heads it, never a
      // customer's; see lib/reports/letterhead.ts.
      const rawFormat = params.get("format");
      if (rawFormat) {
        if (!isReportFormat(rawFormat)) {
          return createErrorResponse(
            `Unsupported export format "${rawFormat}"`,
            400,
          );
        }

        const all = await db.organization.findMany({
          where,
          orderBy: SORTS[sort] ?? SORTS["createdAt-desc"],
          take: EXPORT_ROW_LIMIT,
          select: {
            name: true,
            slug: true,
            status: true,
            plan: true,
            createdAt: true,
            trialEndsAt: true,
            _count: {
              select: {
                users: true,
                properties: { where: { deletedAt: null } },
              },
            },
          },
        });

        const sheet: ReportSheet<(typeof all)[number]> = {
          title: "Organizations",
          columns: [
            { header: "Organization", value: (org) => org.name },
            { header: "Slug", value: (org) => org.slug },
            { header: "Status", value: (org) => org.status },
            { header: "Plan", value: (org) => org.plan },
            { header: "Users", value: (org) => org._count.users },
            { header: "Properties", value: (org) => org._count.properties },
            {
              header: "Trial ends",
              value: (org) =>
                org.trialEndsAt
                  ? businessDay(org.trialEndsAt)
                  : "",
            },
            {
              header: "Signed up",
              value: (org) => businessDay(org.createdAt),
            },
          ],
          rows: all,
          summary: [
            ["Organizations", all.length],
            ["Users", all.reduce((sum, org) => sum + org._count.users, 0)],
            [
              "Properties",
              all.reduce((sum, org) => sum + org._count.properties, 0),
            ],
          ],
        };

        return buildReportResponse(sheet, {
          format: rawFormat as ReportFormat,
          fileName: "Organizations",
          dateStamp: businessToday(),
          letterhead: await getPlatformLetterhead(),
        });
      }

      const [rows, total, statusGroups, planGroups, userTotal, propertyTotal] =
        await Promise.all([
          db.organization.findMany({
            where,
            orderBy: SORTS[sort] ?? SORTS["createdAt-desc"],
            skip: (page - 1) * pageSize,
            take: pageSize,
            select: {
              id: true,
              name: true,
              slug: true,
              status: true,
              plan: true,
              ownerId: true,
              createdAt: true,
              _count: {
                select: {
                  users: true,
                  properties: { where: { deletedAt: null } },
                },
              },
            },
          }),
          db.organization.count({ where }),
          // Platform-wide totals for the summary cards: they describe the
          // platform, so they stay put while the filters move the table.
          db.organization.groupBy({ by: ["status"], _count: { _all: true } }),
          db.organization.groupBy({ by: ["plan"], _count: { _all: true } }),
          db.user.count({ where: { organizationId: { not: null } } }),
          db.property.count({ where: { deletedAt: null } }),
        ]);

      const byStatus = (value: string) =>
        statusGroups.find((group) => group.status === value)?._count._all ?? 0;

      return createSuccessResponse(
        {
          organizations: rows.map((org) => ({
            id: org.id,
            name: org.name,
            slug: org.slug,
            status: org.status,
            plan: org.plan,
            ownerId: org.ownerId,
            userCount: org._count.users,
            propertyCount: org._count.properties,
            createdAt: org.createdAt,
          })),
          pagination: {
            page,
            pageSize,
            total,
            totalPages: Math.max(1, Math.ceil(total / pageSize)),
          },
          totals: {
            orgs: statusGroups.reduce(
              (sum, group) => sum + group._count._all,
              0,
            ),
            active: byStatus("active"),
            trial: byStatus("trial"),
            suspended: byStatus("suspended"),
            users: userTotal,
            properties: propertyTotal,
          },
          // The plan dropdown lists what organizations actually sit on rather
          // than every plan key the catalogue defines.
          facets: {
            plans: planGroups
              .filter((group) => Boolean(group.plan))
              .map((group) => ({
                value: group.plan,
                count: group._count._all,
              }))
              .sort((a, b) => a.value.localeCompare(b.value)),
          },
        },
        "Organizations retrieved",
      );
    } catch (error) {
      return handleApiError(error);
    }
  },
);
