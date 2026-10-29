/**
 * PropertyPro - Application Reject API Route
 * Reject an application
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import { applicationScope } from "@/lib/db/scopes";
import { ApplicationStatus } from "@/types";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  withPermissionAndDB,
  parseRequestBody,
  isValidObjectId,
} from "@/lib/api-utils";

// ============================================================================
// POST /api/applications/[id]/reject - Reject an application
// ============================================================================

export const POST = withPermissionAndDB([
  "application_processing",
  "screening_management",
])(
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

      const { success, data: body } = await parseRequestBody(request);
      const notes = success ? body?.notes : undefined;

      // Find the application
      // Scoped: an application for a building this caller does not hold
      // does not resolve, and the 404 below answers.
      const application = await db.application.findFirst({
        where: { id, ...applicationScope(user) },
        include: {
          property: {
            select: {
              id: true,
              name: true,
              addressStreet: true,
              addressCity: true,
              addressState: true,
              addressZipCode: true,
              addressCountry: true,
            },
          },
          applicant: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
        },
      });

      if (!application) {
        return createErrorResponse("Application not found", 404);
      }

      // Check if application can be rejected
      const validStatuses: string[] = [
        ApplicationStatus.SUBMITTED,
        ApplicationStatus.UNDER_REVIEW,
      ];

      if (!validStatuses.includes(application.status)) {
        return createErrorResponse(
          "Application cannot be rejected in its current status",
          400
        );
      }

      // Reject the application
      const updated = await db.application.update({
        where: { id },
        data: {
          status: ApplicationStatus.REJECTED,
          reviewedAt: new Date(),
          reviewedById: user.id,
          ...(notes ? { reviewNotes: notes } : {}),
        },
      });

      const { property, applicant, ...rest } = application as any;
      const responseApplication = {
        ...rest,
        ...updated,
        propertyId: property
          ? {
              ...property,
              address: {
                street: property.addressStreet,
                city: property.addressCity,
                state: property.addressState,
                zipCode: property.addressZipCode,
                country: property.addressCountry,
              },
            }
          : updated.propertyId,
        applicantId: applicant ?? updated.applicantId,
        reviewedBy: user.id,
      };

      return createSuccessResponse(
        { application: responseApplication },
        "Application rejected successfully"
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);
