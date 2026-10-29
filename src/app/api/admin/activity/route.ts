/**
 * PropertyPro SaaS - Platform activity (super-admin console)
 *
 * Two logs, one screen:
 *
 *   ?tab=customer  every organization's own activity (audit_logs) — what each
 *                  customer's staff, tenants and owners did, read across all
 *                  organizations through the console's RLS bypass;
 *   ?tab=console   the platform's own trail (platform_audit_logs) — operator
 *                  sign-ins, control actions, exports, "view as".
 *
 * It used to read only the console trail, with the date alone for a time,
 * the actor by email only, an end date that dropped its own day, and filter
 * menus rebuilt by grouping the whole table on every request. Filters now
 * come from fixed lists (lib/audit/vocabulary) plus an organization list
 * cached in memory: every query costs ~0.7 s against the remote database, so
 * a page is two statements (the rows and their count), and names come from
 * snapshots stored on the entries rather than joins.
 *
 *   ?facet=organizations | operators | employees&organizationId=…
 *   ?format=xlsx|pdf|csv  the filtered set, with organization and employee
 *                         names, in ?lang (and mirrored for ?rtl)
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import {
  type AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  withPlatformAdminAndDB,
} from "@/lib/api-utils";
import { UserRole } from "@/types";
import {
  EXPORT_ROW_LIMIT,
  buildReportResponse,
  isReportFormat,
  isRtlReportRequest,
  reportLanguage,
  type ReportFormat,
} from "@/lib/reports/export";
import { getPlatformLetterhead } from "@/lib/reports/letterhead";
import {
  activityExportSheet,
  activityPaging,
  auditLogSelect,
  auditLogWhere,
  platformLogSelect,
  platformLogWhere,
  toActivityRows,
  toPlatformActivityRows,
  withAuditColumns,
} from "@/lib/audit/read";
import { catalogTranslator } from "@/lib/audit/catalog";
import { businessToday } from "@/lib/dates/business-day";

/** The default window when no dates are given (the screen sends its own). */
const DEFAULT_DAYS = 30;
const LIST_CACHE_MS = 5 * 60 * 1000;

interface OrganizationOption {
  id: string;
  name: string;
  slug: string;
}

let organizationCache: { at: number; list: OrganizationOption[] } | null = null;

/** Every organization, cached: the filter menu and the name column read it. */
async function organizationList(): Promise<OrganizationOption[]> {
  if (organizationCache && Date.now() - organizationCache.at < LIST_CACHE_MS) {
    return organizationCache.list;
  }
  const rows = await db.organization.findMany({
    select: { id: true, name: true, slug: true },
    orderBy: { name: "asc" },
  });
  organizationCache = { at: Date.now(), list: rows };
  return rows;
}

const peopleCache = new Map<
  string,
  { at: number; list: Array<{ id: string; name: string; email: string | null; role: string }> }
>();

/** The people of one organization (or the operators), cached briefly. */
async function peopleOf(organizationId: string | null) {
  const key = organizationId ?? "platform";
  const cached = peopleCache.get(key);
  if (cached && Date.now() - cached.at < LIST_CACHE_MS) return cached.list;
  const rows = await db.user.findMany({
    where: organizationId
      ? { organizationId, deletedAt: undefined }
      : { organizationId: null, role: UserRole.SUPER_ADMIN, deletedAt: undefined },
    select: { id: true, firstName: true, lastName: true, email: true, role: true },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    take: 1000,
  });
  const list = rows.map((row) => ({
    id: row.id,
    name: [row.firstName, row.lastName].filter(Boolean).join(" "),
    email: row.email,
    role: row.role,
  }));
  peopleCache.set(key, { at: Date.now(), list });
  return list;
}

export const GET = withPlatformAdminAndDB()(
  async (_user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const params = request.nextUrl.searchParams;

      const facet = params.get("facet");
      if (facet === "organizations") {
        return createSuccessResponse({ organizations: await organizationList() });
      }
      if (facet === "employees" || facet === "operators") {
        const organizationId =
          facet === "operators" ? null : params.get("organizationId");
        if (facet === "employees" && !organizationId) {
          return createSuccessResponse({ employees: [] });
        }
        return createSuccessResponse({ employees: await peopleOf(organizationId) });
      }

      const rawFormat = params.get("format");
      if (rawFormat !== null && !isReportFormat(rawFormat)) {
        return createErrorResponse(`Unsupported export format "${rawFormat}"`, 400);
      }
      const format = rawFormat as ReportFormat | null;
      const tab = params.get("tab") === "console" ? "console" : "customer";
      const { page, pageSize } = activityPaging(params);
      const order = params.get("sort") === "asc" ? ("asc" as const) : ("desc" as const);
      const paging = format
        ? { take: EXPORT_ROW_LIMIT }
        : { skip: (page - 1) * pageSize, take: pageSize };

      const [organizations, result] = await Promise.all([
        organizationList(),
        withAuditColumns(async (withNewColumns) => {
          if (tab === "console") {
            const where = platformLogWhere(params, withNewColumns, {
              defaultDays: DEFAULT_DAYS,
            });
            const [logs, total] = await Promise.all([
              db.platformAuditLog.findMany({
                where,
                select: platformLogSelect(withNewColumns),
                orderBy: { createdAt: order },
                ...paging,
              }),
              db.platformAuditLog.count({ where }),
            ]);
            return { kind: "console" as const, logs, total };
          }
          const where = auditLogWhere(params, withNewColumns, {
            defaultDays: DEFAULT_DAYS,
          });
          const [logs, total] = await Promise.all([
            db.auditLog.findMany({
              where,
              select: auditLogSelect(withNewColumns),
              orderBy: { timestamp: order },
              ...paging,
            }),
            db.auditLog.count({ where }),
          ]);
          return { kind: "customer" as const, logs, total };
        }),
      ]);

      let organizationNames = new Map(
        organizations.map((organization) => [organization.id, organization.name]),
      );
      // An organization newer than the cached list: read it again, once.
      const unseen = (result.logs as Array<{ organizationId: string | null }>).some(
        (log) => log.organizationId && !organizationNames.has(log.organizationId),
      );
      if (unseen) {
        organizationCache = null;
        organizationNames = new Map(
          (await organizationList()).map((organization) => [
            organization.id,
            organization.name,
          ]),
        );
      }
      const rows =
        result.kind === "console"
          ? toPlatformActivityRows(result.logs, organizationNames)
          : await toActivityRows(result.logs, organizationNames);

      if (format) {
        const language = reportLanguage(params);
        const t = catalogTranslator(language);
        const startDate = params.get("startDate");
        const endDate = params.get("endDate");
        const sheet = activityExportSheet(rows, {
          language,
          title:
            tab === "console"
              ? t("platform.activity.tab.console", { defaultValue: "Console actions" })
              : t("platform.activity.tab.customer", { defaultValue: "Customer activity" }),
          includeOrganization: true,
          total: result.total,
          truncatedAt: EXPORT_ROW_LIMIT,
          period:
            startDate || endDate
              ? `${startDate ?? "…"} – ${endDate ?? "…"}`
              : null,
        });
        return buildReportResponse(sheet, {
          format,
          fileName: "Activity Log",
          dateStamp: businessToday(),
          rtl: isRtlReportRequest(params),
          lang: language,
          // The platform's own name, never a tenant's — see the letterhead
          // module for why.
          letterhead: await getPlatformLetterhead(),
        });
      }

      return createSuccessResponse({
        tab,
        events: rows,
        pagination: {
          page,
          pageSize,
          total: result.total,
          totalPages: Math.max(1, Math.ceil(result.total / pageSize)),
        },
      });
    } catch (error) {
      return handleApiError(error, "Failed to load platform activity");
    }
  },
);
