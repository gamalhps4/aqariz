/**
 * PropertyPro - Client communication history
 *
 * `[id]` is the client's USER id, so one person has one timeline whether they
 * are a tenant, an owner, or both.
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import { Prisma } from "@/generated/prisma/client";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  withPermissionAndDB,
  parseRequestBody,
  isValidObjectId,
} from "@/lib/api-utils";
import { communicationCreateSchema, validateSchema } from "@/lib/validations";
import {
  getCommunicationHistory,
  isCommunicationChannel,
} from "@/lib/services/client-communication.service";

export const GET = withPermissionAndDB(["tenant_management", "user_view"])(
  async (
    _user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    try {
      const { id } = await params;
      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid client ID", 400);
      }

      // Scoped read: RLS keeps this inside the organization.
      const client = await db.user.findFirst({
        where: { id },
        select: { id: true },
      });
      if (!client) {
        return createErrorResponse("Client not found", 404);
      }

      const channelParam = request.nextUrl.searchParams.get("channel");
      const history = await getCommunicationHistory(id, {
        channel: isCommunicationChannel(channelParam)
          ? channelParam
          : undefined,
        limit: Number(request.nextUrl.searchParams.get("limit")) || undefined,
      });

      return createSuccessResponse(
        history,
        "Communication history retrieved successfully",
      );
    } catch (error) {
      return handleApiError(error, "Failed to read the communication history");
    }
  },
);

export const POST = withPermissionAndDB(["tenant_management", "user_management"])(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    try {
      const { id } = await params;
      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid client ID", 400);
      }

      const client = await db.user.findFirst({
        where: { id },
        select: { id: true },
      });
      if (!client) {
        return createErrorResponse("Client not found", 404);
      }

      const { success, data: body } = await parseRequestBody(request);
      if (!success) {
        return createErrorResponse("Invalid request body", 400);
      }

      const validation = validateSchema(communicationCreateSchema, body);
      if (!validation.success) {
        return createErrorResponse(validation.errors.join(", "), 400);
      }
      const input = validation.data;

      const created = await db.clientCommunication.create({
        data: {
          organizationId: user.organizationId!,
          clientId: id,
          channel: input.channel,
          direction: input.direction ?? "outbound",
          subject: input.subject,
          body: input.body ?? null,
          // Defaults to now, but an operator logging yesterday's call must be
          // able to date it yesterday.
          occurredAt: input.occurredAt ?? new Date(),
          propertyId: input.propertyId ?? null,
          leaseId: input.leaseId ?? null,
          followUpAt: input.followUpAt ?? null,
          recordedById: user.id,
        } as Prisma.ClientCommunicationUncheckedCreateInput,
      });

      return createSuccessResponse(
        { communication: created },
        "Communication logged successfully",
      );
    } catch (error) {
      return handleApiError(error, "Failed to log the communication");
    }
  },
);
