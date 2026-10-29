/**
 * PropertyPro SaaS - Webhook event ledger (platform admin)
 *
 * `webhook_events` is the idempotency ledger every gateway handler claims into,
 * so it doubles as a record of what actually arrived. Nothing surfaced it — the
 * only way to answer "did Stripe deliver that?" was to open psql.
 *
 * The table is bypass-only under RLS, hence authDb + bypassOrgScope. It is
 * purged after 30 days by the cleanup cron, so this is a recent-history view,
 * not an archive.
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { authDb } from "@/lib/db/prisma";
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
import { bypassOrgScope } from "@/lib/tenancy/context";
import type { Prisma } from "@/generated/prisma/client";
import { businessToday } from "@/lib/dates/business-day";

const PAGE_SIZE_OPTIONS = [12, 20, 50, 100];
const DEFAULT_PAGE_SIZE = 20;

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
      const sortOrder =
        params.get("sort") === "processedAt-asc" ? "asc" : "desc";

      const gateway = params.get("gateway");
      const eventType = params.get("eventType");
      const search = params.get("search")?.trim();

      const where: Prisma.WebhookEventWhereInput = {
        ...(gateway && gateway !== "all" ? { gateway } : {}),
        ...(eventType && eventType !== "all" ? { eventType } : {}),
        ...(search ? { eventId: { contains: search, mode: "insensitive" } } : {}),
      };

      // Same `where`, same order — the file carries the filtered set, not the
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
          authDb.webhookEvent.findMany({
            where,
            orderBy: { processedAt: sortOrder },
            take: EXPORT_ROW_LIMIT,
          }),
        );

        const sheet: ReportSheet<(typeof all)[number]> = {
          title: "Webhook events",
          columns: [
            {
              header: "Processed",
              value: (event) => event.processedAt.toISOString(),
            },
            { header: "Gateway", value: (event) => event.gateway },
            { header: "Event type", value: (event) => event.eventType ?? "" },
            { header: "Event id", value: (event) => event.eventId },
          ],
          rows: all,
          summary: [["Events", all.length]],
        };

        return buildReportResponse(sheet, {
          format: rawFormat as ReportFormat,
          fileName: "Webhook events",
          dateStamp: businessToday(),
          letterhead: await getPlatformLetterhead(),
        });
      }

      return await bypassOrgScope(async () => {
        const [events, total, gateways, eventTypes] = await Promise.all([
          authDb.webhookEvent.findMany({
            where,
            orderBy: { processedAt: sortOrder },
            skip: (page - 1) * pageSize,
            take: pageSize,
          }),
          authDb.webhookEvent.count({ where }),
          authDb.webhookEvent.groupBy({
            by: ["gateway"],
            _count: { _all: true },
          }),
          authDb.webhookEvent.groupBy({
            by: ["eventType"],
            _count: { _all: true },
            orderBy: { _count: { eventType: "desc" } },
            take: 30,
          }),
        ]);

        return createSuccessResponse({
          events,
          pagination: {
            page,
            pageSize,
            total,
            totalPages: Math.max(1, Math.ceil(total / pageSize)),
          },
          facets: {
            gateways: gateways.map((row) => ({
              value: row.gateway,
              count: row._count._all,
            })),
            eventTypes: eventTypes
              .filter((row) => row.eventType)
              .map((row) => ({
                value: row.eventType as string,
                count: row._count._all,
              })),
          },
          retentionDays: 30,
        });
      });
    } catch (error) {
      return handleApiError(error, "Failed to load webhook events");
    }
  },
);
