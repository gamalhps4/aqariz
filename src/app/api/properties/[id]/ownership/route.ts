/**
 * PropertyPro - Property (building) ownership assignment
 *
 * Ownership is deliberately absent from `propertyUpdateSchema` — anyone who
 * can edit a building must not be able to reassign who owns it. This endpoint
 * is the one way to change it, and it is admin-only.
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import { propertyScope, withScope } from "@/lib/db/scopes";
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
import {
  propertyOwnershipUpdateSchema,
  validateSchema,
} from "@/lib/validations";
import {
  auditService,
  AuditAction,
  AuditCategory,
  AuditSeverity,
} from "@/lib/audit-service";

const PARTY_SELECT = {
  select: { id: true, firstName: true, lastName: true, email: true, role: true },
} as const;

export const PATCH = withPermissionAndDB("property_management")(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    try {
      const { id } = await params;
      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid property ID", 400);
      }

      if (!user.isAdmin) {
        return createErrorResponse(
          "Only an administrator can reassign a building's owner",
          403,
        );
      }

      const { success, data: body } = await parseRequestBody(request);
      if (!success) {
        return createErrorResponse("Invalid request body", 400);
      }

      const validation = validateSchema(propertyOwnershipUpdateSchema, body);
      if (!validation.success) {
        return createErrorResponse(validation.errors.join(", "), 400);
      }

      // Scoped: a building this caller does not hold does not resolve, and
      // the 404 below answers.
      const property = await db.property.findFirst({
        where: withScope({ id }, propertyScope(user)),
        select: { id: true, name: true, ownerId: true, managerId: true },
      });
      if (!property) {
        return createErrorResponse("Property not found", 404);
      }

      const { ownerId, managerId } = validation.data;
      const data: Prisma.PropertyUpdateInput = {};

      if (ownerId !== undefined) {
        // Scoped read: RLS keeps this inside the organization, so a caller
        // cannot hand their building to a user in another tenant.
        const owner = await db.user.findFirst({
          where: { id: ownerId, isActive: true },
          select: { id: true },
        });
        if (!owner) {
          return createErrorResponse(
            "Owner not found in this organization",
            400,
          );
        }
        data.owner = { connect: { id: owner.id } };
      }

      if (managerId !== undefined) {
        if (managerId) {
          const manager = await db.user.findFirst({
            where: { id: managerId, isActive: true },
            select: { id: true },
          });
          if (!manager) {
            return createErrorResponse(
              "Manager not found in this organization",
              400,
            );
          }
          data.manager = { connect: { id: manager.id } };
        } else {
          data.manager = { disconnect: true };
        }
      }

      const updated = await db.property.update({
        where: { id },
        data,
        include: { owner: PARTY_SELECT, manager: PARTY_SELECT },
      });

      // Who owns a building drives agreements, statements and payouts, so the
      // reassignment is an audited event rather than a silent field edit.
      await auditService.logEvent(
        {
          category: AuditCategory.PROPERTY_MANAGEMENT,
          action: AuditAction.UPDATE,
          severity: AuditSeverity.MEDIUM,
          description: `Reassigned ownership of property: ${property.name}`,
          resourceType: "property",
          resourceId: id,
          resourceName: property.name,
          oldValues: {
            ownerId: property.ownerId,
            managerId: property.managerId,
          },
          newValues: {
            ownerId: updated.ownerId,
            managerId: updated.managerId,
          },
          tags: ["property", "ownership"],
        },
        auditService.extractContextFromRequest(request, user),
      );

      return createSuccessResponse(
        {
          id: updated.id,
          owner: updated.owner,
          manager: updated.manager,
        },
        "Property ownership updated successfully",
      );
    } catch (error) {
      return handleApiError(error, "Failed to update property ownership");
    }
  },
);
