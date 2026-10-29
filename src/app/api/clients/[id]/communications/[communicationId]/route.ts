/**
 * PropertyPro - Edit or remove one logged communication
 *
 * Only records entered by staff are editable. In-app messages appear in the
 * timeline but belong to the messaging module and are never rewritten here.
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  withPermissionAndDB,
  parseRequestBody,
  isValidObjectId,
} from "@/lib/api-utils";
import { communicationUpdateSchema, validateSchema } from "@/lib/validations";

type RouteParams = {
  params: Promise<{ id: string; communicationId: string }>;
};

export const PATCH = withPermissionAndDB([
  "tenant_management",
  "user_management",
])(async (_user: AuthenticatedAccessUser, request: NextRequest, { params }: RouteParams) => {
  try {
    const { id, communicationId } = await params;
    if (!isValidObjectId(id) || !isValidObjectId(communicationId)) {
      return createErrorResponse("Invalid identifier", 400);
    }

    // Scoped to the client, so an id from another client's timeline 404s
    // rather than being edited through this one's endpoint.
    const existing = await db.clientCommunication.findFirst({
      where: { id: communicationId, clientId: id },
      select: { id: true },
    });
    if (!existing) {
      return createErrorResponse("Communication not found", 404);
    }

    const { success, data: body } = await parseRequestBody(request);
    if (!success) {
      return createErrorResponse("Invalid request body", 400);
    }

    const validation = validateSchema(communicationUpdateSchema, body);
    if (!validation.success) {
      return createErrorResponse(validation.errors.join(", "), 400);
    }
    const input = validation.data;

    const updated = await db.clientCommunication.update({
      where: { id: communicationId },
      data: {
        ...(input.channel !== undefined ? { channel: input.channel } : {}),
        ...(input.direction !== undefined ? { direction: input.direction } : {}),
        ...(input.subject !== undefined ? { subject: input.subject } : {}),
        ...(input.body !== undefined ? { body: input.body || null } : {}),
        ...(input.occurredAt !== undefined
          ? { occurredAt: input.occurredAt }
          : {}),
        ...(input.propertyId !== undefined
          ? { propertyId: input.propertyId || null }
          : {}),
        ...(input.leaseId !== undefined
          ? { leaseId: input.leaseId || null }
          : {}),
        ...(input.followUpAt !== undefined
          ? { followUpAt: input.followUpAt }
          : {}),
        ...(input.followUpDone !== undefined
          ? { followUpDone: input.followUpDone }
          : {}),
      },
    });

    return createSuccessResponse(
      { communication: updated },
      "Communication updated successfully",
    );
  } catch (error) {
    return handleApiError(error, "Failed to update the communication");
  }
});

export const DELETE = withPermissionAndDB([
  "tenant_management",
  "user_management",
])(async (_user: AuthenticatedAccessUser, _request: NextRequest, { params }: RouteParams) => {
  try {
    const { id, communicationId } = await params;
    if (!isValidObjectId(id) || !isValidObjectId(communicationId)) {
      return createErrorResponse("Invalid identifier", 400);
    }

    const existing = await db.clientCommunication.findFirst({
      where: { id: communicationId, clientId: id },
      select: { id: true },
    });
    if (!existing) {
      return createErrorResponse("Communication not found", 404);
    }

    // Archived like everything else — a record of what was said to a client
    // is exactly the kind of thing that gets asked about later.
    await db.clientCommunication.update({
      where: { id: communicationId },
      data: { deletedAt: new Date() },
    });

    return createSuccessResponse(
      { id: communicationId },
      "Communication removed",
    );
  } catch (error) {
    return handleApiError(error, "Failed to remove the communication");
  }
});
