/**
 * PropertyPro - Message log (Settings → Messaging → Log)
 *
 * GET ?page&limit&channel&status&event&search → the office's SMS and WhatsApp
 * messages, newest first, with this month's quota usage.
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import {
  AuthenticatedAccessUser,
  createPaginationInfo,
  createSuccessResponse,
  handleApiError,
  withPermissionAndDB,
} from "@/lib/api-utils";
import { listMessageLogs } from "@/lib/messaging/log";
import {
  isMessagingChannel,
  isMessagingEvent,
  MESSAGE_STATUSES,
  type MessageStatus,
} from "@/lib/messaging/registry";

export const GET = withPermissionAndDB("system_settings")(
  async (_user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const params = request.nextUrl.searchParams;
      const page = Math.max(Number.parseInt(params.get("page") || "1", 10) || 1, 1);
      const limit = Math.min(
        Math.max(Number.parseInt(params.get("limit") || "20", 10) || 20, 1),
        100,
      );
      const channel = params.get("channel");
      const status = params.get("status");
      const event = params.get("event");
      const search = params.get("search")?.trim().slice(0, 100) || undefined;

      const result = await listMessageLogs({
        page,
        limit,
        channel: isMessagingChannel(channel) ? channel : undefined,
        status: MESSAGE_STATUSES.includes(status as MessageStatus)
          ? (status as MessageStatus)
          : undefined,
        event: isMessagingEvent(event) ? event : undefined,
        search,
      });

      return createSuccessResponse(
        { rows: result.rows, available: result.available },
        undefined,
        createPaginationInfo(page, limit, result.total),
      );
    } catch (error) {
      return handleApiError(error, "Failed to load the message log");
    }
  },
);
