/**
 * PropertyPro - Application Submit API Route
 * Submit an application for review
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import { applicationScope } from "@/lib/db/scopes";
import { UserRole, ApplicationStatus } from "@/types";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  withAccessAndDB,
  isValidObjectId,
} from "@/lib/api-utils";

// ============================================================================
// POST /api/applications/[id]/submit - Submit an application
// ============================================================================

export const POST = withAccessAndDB({
  roles: [UserRole.TENANT],
  permissions: ["application_processing", "screening_management"],
  match: "any",
})(
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

      // Check permissions - only the applicant or authorized staff can submit
      // Single company architecture - Managers can submit all applications
      const canSubmit =
        user.isCompanyStaff || application.applicantId === user.id;

      if (!canSubmit) {
        return createErrorResponse("Access denied", 403);
      }

      // Check if application can be submitted
      if (application.status !== ApplicationStatus.DRAFT) {
        return createErrorResponse(
          "Application has already been submitted",
          400
        );
      }

      // Validate required fields for submission
      const requiredFields = [
        "personalInfo.firstName",
        "personalInfo.lastName",
        "personalInfo.email",
        "personalInfo.phone",
        "personalInfo.dateOfBirth",
      ];

      for (const field of requiredFields) {
        const fieldValue = field
          .split(".")
          .reduce((obj: any, key) => obj?.[key], application as any);
        if (!fieldValue) {
          return createErrorResponse(`Missing required field: ${field}`, 400);
        }
      }

      // Check if application fee is paid (if required)
      const applicationFee = (application.applicationFee as any) ?? {};
      if (
        applicationFee.amount > 0 &&
        applicationFee.status !== "paid"
      ) {
        return createErrorResponse(
          "Application fee must be paid before submission",
          400
        );
      }

      // Submit the application
      const updated = await db.application.update({
        where: { id },
        data: {
          status: ApplicationStatus.SUBMITTED,
          submittedAt: new Date(),
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
      };

      return createSuccessResponse(
        { application: responseApplication },
        "Application submitted successfully"
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);
