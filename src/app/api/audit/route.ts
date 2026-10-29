/**
 * PropertyPro - Activity log API (the organization's own)
 *
 * GET only. The POST that sat here let anyone holding `audit_logs` write any
 * entry they liked — an audit trail its readers can append to is not one.
 * Entries are written by the actions themselves (lib/audit-service), and the
 * API wrapper records a basic entry for any write that recorded none.
 *
 *   ?page, pageSize            server-side pages for the table
 *   ?search                    names, emails, record names and numbers
 *   ?userId                    one employee (or tenant, or owner)
 *   ?action, ?category, ?resourceType, ?resourceId, ?severity
 *   ?startDate, ?endDate       whole Riyadh days, the last one included
 *   ?facet=employees           the people to offer in the employee filter
 *   ?format=xlsx|pdf|csv       the filtered set as a file, in ?lang
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import {
  AuthenticatedAccessUser,
  createErrorResponse,
  createSuccessResponse,
  handleApiError,
  withPermissionAndDB,
} from "@/lib/api-utils";
import {
  EXPORT_ROW_LIMIT,
  buildReportResponse,
  isReportFormat,
  isRtlReportRequest,
  reportLanguage,
  type ReportFormat,
} from "@/lib/reports/export";
import {
  activityExportSheet,
  activityPaging,
  auditLogSelect,
  auditLogWhere,
  toActivityRows,
  withAuditColumns,
} from "@/lib/audit/read";
import { catalogTranslator } from "@/lib/audit/catalog";
import { businessToday } from "@/lib/dates/business-day";

export const GET = withPermissionAndDB("audit_logs")(
  async (_user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const params = request.nextUrl.searchParams;

      // Everyone who can appear in this organization's log: staff, tenants
      // and owners. Deactivated people stay listed — they still acted.
      if (params.get("facet") === "employees") {
        const people = await db.user.findMany({
          where: { deletedAt: undefined },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            role: true,
          },
          orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
          take: 1000,
        });
        return createSuccessResponse({
          employees: people.map((person) => ({
            id: person.id,
            name: [person.firstName, person.lastName].filter(Boolean).join(" "),
            email: person.email,
            role: person.role,
          })),
        });
      }

      const rawFormat = params.get("format");
      if (rawFormat && !isReportFormat(rawFormat)) {
        return createErrorResponse(`Unsupported export format "${rawFormat}"`, 400);
      }
      const format = rawFormat as ReportFormat | null;
      const { page, pageSize } = activityPaging(params);

      const { logs, total } = await withAuditColumns(async (withNewColumns) => {
        const where = auditLogWhere(params, withNewColumns);
        const [logs, total] = await Promise.all([
          db.auditLog.findMany({
            where,
            select: auditLogSelect(withNewColumns),
            orderBy: { timestamp: params.get("sort") === "asc" ? "asc" : "desc" },
            ...(format
              ? { take: EXPORT_ROW_LIMIT }
              : { skip: (page - 1) * pageSize, take: pageSize }),
          }),
          db.auditLog.count({ where }),
        ]);
        return { logs, total };
      });

      const rows = await toActivityRows(logs);

      if (format) {
        const language = reportLanguage(params);
        const t = catalogTranslator(language);
        const startDate = params.get("startDate");
        const endDate = params.get("endDate");
        const sheet = activityExportSheet(rows, {
          language,
          title: t("admin.audit.title", { defaultValue: "Activity log" }),
          includeOrganization: false,
          total,
          truncatedAt: EXPORT_ROW_LIMIT,
          period:
            startDate || endDate
              ? `${startDate?.slice(0, 10) ?? "…"} – ${endDate?.slice(0, 10) ?? "…"}`
              : null,
        });
        return buildReportResponse(sheet, {
          format,
          fileName: "Activity Log",
          dateStamp: businessToday(),
          rtl: isRtlReportRequest(params),
          lang: language,
        });
      }

      return createSuccessResponse({
        logs: rows.map((row) => ({
          ...row,
          // The shape the user page's activity card reads.
          userId: row.actor.id
            ? {
                id: row.actor.id,
                firstName: row.actor.name?.split(" ")[0] ?? "",
                lastName: row.actor.name?.split(" ").slice(1).join(" ") ?? "",
                email: row.actor.email,
              }
            : null,
          userEmail: row.actor.email,
          oldValues: row.before,
          newValues: row.after,
        })),
        pagination: {
          page,
          limit: pageSize,
          pageSize,
          total,
          pages: Math.max(1, Math.ceil(total / pageSize)),
        },
      });
    } catch (error) {
      return handleApiError(error, "Failed to fetch audit logs");
    }
  }
);

// Retention is enforced by the scheduled cleanup cron (/api/cron/cleanup),
// the one deleter the append-only trigger lets through.
