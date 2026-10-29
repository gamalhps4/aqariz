/**
 * PropertyPro - Individual Application API Routes
 * CRUD operations for individual applications
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import { applicationScope, propertyScope, withScope } from "@/lib/db/scopes";
import { Prisma } from "@/generated/prisma/client";
import { UserRole, ApplicationStatus } from "@/types";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  withAccessAndDB,
  parseRequestBody,
  isValidObjectId,
} from "@/lib/api-utils";
import { applicationUpdateSchema, validateSchema } from "@/lib/validations";

const APPLICATION_ACCESS = {
  roles: [UserRole.TENANT],
  permissions: ["application_processing", "screening_management"],
  match: "any" as const,
};

const APPLICATION_PROPERTY_SELECT = {
  id: true,
  name: true,
  type: true,
  addressStreet: true,
  addressCity: true,
  addressState: true,
  addressZipCode: true,
  addressCountry: true,
} as const;

function buildPropertyAddress(property: any) {
  return {
    street: property?.addressStreet,
    city: property?.addressCity,
    state: property?.addressState,
    zipCode: property?.addressZipCode,
    country: property?.addressCountry,
  };
}

async function mapApplicationForResponse(
  application: any,
  reviewerSelect: Record<string, boolean> = {
    id: true,
    firstName: true,
    lastName: true,
  }
) {
  const { property, applicant, ...rest } = application;

  const reviewer = rest.reviewedById
    ? await db.user.findFirst({
        where: { id: rest.reviewedById },
        // A plain shape, not `Prisma.UserSelect`: the extended client's own
        // select type is deep enough that comparing the two runs the compiler
        // out of depth.
        select: reviewerSelect as { id?: boolean; firstName?: boolean; lastName?: boolean; email?: boolean },
      })
    : null;

  return {
    ...rest,
    propertyId: property
      ? { ...property, address: buildPropertyAddress(property) }
      : rest.propertyId,
    applicantId: applicant ?? rest.applicantId,
    reviewedBy: rest.reviewedById ? reviewer ?? rest.reviewedById : rest.reviewedById,
  };
}

// ============================================================================
// GET /api/applications/[id] - Get a specific application
// ============================================================================

export const GET = withAccessAndDB(APPLICATION_ACCESS)(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    try {
      const { id } = await params;

      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid application ID", 400);
      }

      // Scoped: an application for a building this caller does not hold
      // does not resolve, and the 404 below answers.
      const application = await db.application.findFirst({
        where: { id, ...applicationScope(user) },
        include: {
          property: { select: APPLICATION_PROPERTY_SELECT },
          applicant: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
            },
          },
        },
      });

      if (!application) {
        return createErrorResponse("Application not found", 404);
      }

      const canAccess =
        user.isCompanyStaff || application.applicantId === user.id;

      if (!canAccess) {
        return createErrorResponse("Access denied", 403);
      }

      const responseApplication = await mapApplicationForResponse(application, {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
      });

      return createSuccessResponse({ application: responseApplication });
    } catch (error) {
      return handleApiError(error);
    }
  }
);

// ============================================================================
// PUT /api/applications/[id] - Update an application
// ============================================================================

export const PUT = withAccessAndDB(APPLICATION_ACCESS)(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    try {
      const { id } = await params;

      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid application ID", 400);
      }

      const { success, data: body, error } = await parseRequestBody(request);
      if (!success) {
        return createErrorResponse(error!, 400);
      }

      // Scoped: an application for a building this caller does not hold
      // does not resolve, and the 404 below answers.
      const application = await db.application.findFirst({
        where: { id, ...applicationScope(user) },
      });
      if (!application) {
        return createErrorResponse("Application not found", 404);
      }

      const canEdit =
        user.isCompanyStaff ||
        (application.applicantId === user.id &&
          [ApplicationStatus.DRAFT, ApplicationStatus.SUBMITTED].includes(
            application.status as ApplicationStatus
          ));

      if (!canEdit) {
        return createErrorResponse("Cannot edit this application", 403);
      }

      const validation = validateSchema(applicationUpdateSchema, body);
      if (!validation.success) {
        return createErrorResponse(validation.errors.join(", "), 400);
      }

      const updateData = validation.data as any;

      let effectiveUpdate: Record<string, unknown>;
      if (user.isTenant) {
        const allowedFields = [
          "personalInfo",
          "employmentInfo",
          "emergencyContacts",
          "previousAddresses",
          "documents",
          "additionalInfo",
        ] as const;

        effectiveUpdate = {};
        for (const field of allowedFields) {
          if (updateData[field] !== undefined) {
            effectiveUpdate[field] = updateData[field];
          }
        }
      } else {
        effectiveUpdate = { ...updateData };
      }

      // Map to Prisma columns (Json casts, reviewedBy -> reviewedById)
      const data: Prisma.ApplicationUncheckedUpdateInput = {};
      if (effectiveUpdate.propertyId !== undefined)
        data.propertyId = effectiveUpdate.propertyId as string;
      if (effectiveUpdate.applicantId !== undefined)
        data.applicantId = effectiveUpdate.applicantId as string;
      if (effectiveUpdate.status !== undefined)
        data.status = effectiveUpdate.status as string;
      if (effectiveUpdate.applicationFee !== undefined)
        data.applicationFee = effectiveUpdate.applicationFee as Prisma.InputJsonValue;
      if (effectiveUpdate.personalInfo !== undefined)
        data.personalInfo = effectiveUpdate.personalInfo as Prisma.InputJsonValue;
      if (effectiveUpdate.employmentInfo !== undefined)
        data.employmentInfo = effectiveUpdate.employmentInfo as Prisma.InputJsonValue;
      if (effectiveUpdate.emergencyContacts !== undefined)
        data.emergencyContacts =
          effectiveUpdate.emergencyContacts as Prisma.InputJsonValue;
      if (effectiveUpdate.previousAddresses !== undefined)
        data.previousAddresses =
          effectiveUpdate.previousAddresses as Prisma.InputJsonValue;
      if (effectiveUpdate.documents !== undefined)
        data.documents = effectiveUpdate.documents as Prisma.InputJsonValue;
      if (effectiveUpdate.additionalInfo !== undefined)
        data.additionalInfo =
          effectiveUpdate.additionalInfo as Prisma.InputJsonValue;
      if (effectiveUpdate.submittedAt !== undefined)
        data.submittedAt = effectiveUpdate.submittedAt as Date;
      if (effectiveUpdate.reviewedAt !== undefined)
        data.reviewedAt = effectiveUpdate.reviewedAt as Date;
      if (effectiveUpdate.reviewedBy !== undefined)
        data.reviewedById = effectiveUpdate.reviewedBy as string;
      if (effectiveUpdate.reviewNotes !== undefined)
        data.reviewNotes = effectiveUpdate.reviewNotes as string;

      // A building the edit moves the application to is a requested id like
      // the one in the URL. Only a change is looked up.
      if (data.propertyId && data.propertyId !== application.propertyId) {
        const property = await db.property.findFirst({
          where: withScope(
            { id: data.propertyId as string },
            propertyScope(user),
          ),
          select: { id: true },
        });
        if (!property) {
          return createErrorResponse("Property not found", 404);
        }
      }

      if (Object.keys(data).length > 0) {
        await db.application.update({ where: { id }, data });
      }

      const populated = await db.application.findFirst({
        where: { id },
        include: {
          property: { select: APPLICATION_PROPERTY_SELECT },
          applicant: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
        },
      });

      const responseApplication = await mapApplicationForResponse(
        populated ?? application
      );

      return createSuccessResponse(
        { application: responseApplication },
        "Application updated successfully"
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);

// ============================================================================
// DELETE /api/applications/[id] - Delete an application (soft delete)
// ============================================================================

export const DELETE = withAccessAndDB(APPLICATION_ACCESS)(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    try {
      const { id } = await params;

      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid application ID", 400);
      }

      // Scoped: an application for a building this caller does not hold
      // does not resolve, and the 404 below answers.
      const application = await db.application.findFirst({
        where: { id, ...applicationScope(user) },
      });
      if (!application) {
        return createErrorResponse("Application not found", 404);
      }

      const canDelete =
        user.isCompanyStaff ||
        (application.applicantId === user.id &&
          [ApplicationStatus.DRAFT, ApplicationStatus.SUBMITTED].includes(
            application.status as ApplicationStatus
          ));

      if (!canDelete) {
        return createErrorResponse("Cannot delete this application", 403);
      }

      await db.application.update({
        where: { id },
        data: { deletedAt: new Date() },
      });

      return createSuccessResponse(null, "Application deleted successfully");
    } catch (error) {
      return handleApiError(error);
    }
  }
);
