export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";
import {
  type AuthenticatedAccessUser,
  createErrorResponse,
  createSuccessResponse,
  handleApiError,
  isValidObjectId,
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
import { bypassOrgScope } from "@/lib/tenancy/context";
import { roleDisplayName } from "@/lib/role-display";
import { businessDay, businessToday } from "@/lib/dates/business-day";

const PAGE_SIZE_OPTIONS = [12, 20, 50, 100];
const DEFAULT_PAGE_SIZE = 20;

/** Sort keys the console offers, mapped onto Prisma order clauses. */
const SORTS: Record<string, Prisma.UserOrderByWithRelationInput> = {
  "createdAt-desc": { createdAt: "desc" },
  "createdAt-asc": { createdAt: "asc" },
  "lastLogin-desc": { lastLogin: { sort: "desc", nulls: "last" } },
  "name-asc": { firstName: "asc" },
  "name-desc": { firstName: "desc" },
};

export const GET = withPlatformAdminAndDB()(
  async (_user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const params = request.nextUrl.searchParams;
      const requestedPage = Number.parseInt(params.get("page") || "1", 10);
      const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;
      const requestedSize = Number.parseInt(
        params.get("pageSize") || String(DEFAULT_PAGE_SIZE),
        10,
      );
      const pageSize = PAGE_SIZE_OPTIONS.includes(requestedSize)
        ? requestedSize
        : DEFAULT_PAGE_SIZE;
      const query = params.get("query")?.trim() || "";
      const role = params.get("role") || "all";
      const status = params.get("status") || "all";
      const sort = params.get("sort") || "createdAt-desc";
      const organizationId = params.get("organizationId") || "";

      if (organizationId && !isValidObjectId(organizationId)) {
        return createErrorResponse("Invalid organization id", 400);
      }

      /**
       * Each user's group by its names, looked up in their own organization:
       * a group's stored name is a key ("group_2") that says nothing, and
       * two organizations' keys can be the same. Null for a built-in role.
       */
      const groupNamesFor = async (
        users: Array<{ role: string; organizationId: string | null }>,
      ) => {
        const pairs = users
          .filter((user) => user.organizationId)
          .map((user) => ({
            organizationId: user.organizationId as string,
            name: user.role,
          }));
        const groups = pairs.length
          ? await bypassOrgScope(() =>
              db.role.findMany({
                where: { isSystem: false, OR: pairs },
                select: {
                  organizationId: true,
                  name: true,
                  label: true,
                  labelAr: true,
                  deletedAt: true,
                },
                orderBy: [{ deletedAt: { sort: "desc", nulls: "first" } }],
              }),
            )
          : [];
        const byKey = new Map<string, { label: string; labelAr: string | null }>();
        for (const group of groups) {
          const key = `${group.organizationId}:${group.name}`;
          if (!byKey.has(key)) {
            byKey.set(key, { label: group.label, labelAr: group.labelAr });
          }
        }
        return (user: { role: string; organizationId: string | null }) =>
          byKey.get(`${user.organizationId}:${user.role}`) ?? null;
      };

      const filter: Prisma.UserWhereInput = {
        organizationId: organizationId ? organizationId : { not: null },
        deletedAt: null,
        role: role === "all" ? { not: "super_admin" } : role,
      };
      if (status === "active") filter.isActive = true;
      if (status === "inactive") filter.isActive = false;
      if (query) {
        filter.OR = [
          { firstName: { contains: query, mode: "insensitive" } },
          { lastName: { contains: query, mode: "insensitive" } },
          { email: { contains: query, mode: "insensitive" } },
        ];
      }

      // Same filter, same order — the file carries the filtered set, not the
      // page of it on screen.
      const rawFormat = params.get("format");
      if (rawFormat) {
        if (!isReportFormat(rawFormat)) {
          return createErrorResponse(
            `Unsupported export format "${rawFormat}"`,
            400,
          );
        }

        const all = await bypassOrgScope(() =>
          db.user.findMany({
            where: filter,
            orderBy: SORTS[sort] ?? SORTS["createdAt-desc"],
            take: EXPORT_ROW_LIMIT,
            select: {
              firstName: true,
              lastName: true,
              email: true,
              role: true,
              organizationId: true,
              isActive: true,
              emailVerified: true,
              lastLogin: true,
              createdAt: true,
              organization: { select: { name: true, slug: true } },
            },
          }),
        );
        const groupOf = await groupNamesFor(all);

        const day = (value: Date | null) =>
          value ? businessDay(value) : "";

        const sheet: ReportSheet<(typeof all)[number]> = {
          title: "Platform users",
          columns: [
            {
              header: "Name",
              value: (user) =>
                `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim(),
            },
            { header: "Email", value: (user) => user.email ?? "" },
            {
              header: "Organization",
              value: (user) => user.organization?.name ?? "",
            },
            {
              header: "Role",
              value: (user) =>
                roleDisplayName(user.role, { group: groupOf(user) }),
            },
            {
              header: "Active",
              value: (user) => (user.isActive ? "yes" : "no"),
            },
            {
              header: "Email verified",
              value: (user) => (user.emailVerified ? "yes" : "no"),
            },
            { header: "Last login", value: (user) => day(user.lastLogin) },
            { header: "Signed up", value: (user) => day(user.createdAt) },
          ],
          rows: all,
          summary: [
            ["Users", all.length],
            ["Active", all.filter((user) => user.isActive).length],
          ],
        };

        return buildReportResponse(sheet, {
          format: rawFormat as ReportFormat,
          fileName: "Platform users",
          dateStamp: businessToday(),
          letterhead: await getPlatformLetterhead(),
        });
      }

      const [rows, total] = await Promise.all([
        bypassOrgScope(() =>
          db.user.findMany({
            where: filter,
            orderBy: SORTS[sort] ?? SORTS["createdAt-desc"],
            skip: (page - 1) * pageSize,
            take: pageSize,
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              role: true,
              organizationId: true,
              isActive: true,
              emailVerified: true,
              lastLogin: true,
              createdAt: true,
              organization: {
                select: { id: true, name: true, slug: true },
              },
            },
          }),
        ),
        bypassOrgScope(() => db.user.count({ where: filter })),
      ]);
      const groupOf = await groupNamesFor(rows);

      return createSuccessResponse({
        users: rows.map((row) => ({
          id: row.id,
          name: `${row.firstName} ${row.lastName}`.trim(),
          email: row.email,
          role: row.role,
          roleLabel: groupOf(row)?.label ?? null,
          roleLabelAr: groupOf(row)?.labelAr ?? null,
          isActive: row.isActive,
          emailVerified: Boolean(row.emailVerified),
          lastLogin: row.lastLogin ?? null,
          createdAt: row.createdAt,
          organization: row.organization
            ? {
                id: row.organization.id,
                name: row.organization.name,
                slug: row.organization.slug,
              }
            : null,
        })),
        pagination: {
          page,
          pageSize,
          total,
          totalPages: Math.max(1, Math.ceil(total / pageSize)),
        },
      });
    } catch (error) {
      return handleApiError(error, "Failed to load platform users");
    }
  },
);
