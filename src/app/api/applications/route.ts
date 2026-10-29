/**
 * PropertyPro - Applications API Routes
 * CRUD operations for tenant applications
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import {
  applyScope,
  applicationScope,
  propertyScope,
  withScope,
} from "@/lib/db/scopes";
import { Prisma } from "@/generated/prisma/client";
import { UserRole, ApplicationStatus } from "@/types";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  parsePaginationParams,
  createPaginationInfo,
  parseRequestBody,
  withAccessAndDB,
} from "@/lib/api-utils";
import {
  applicationSchema,
  validateSchema,
} from "@/lib/validations";

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

/**
 * Restore the old populated shape: propertyId/applicantId/reviewedBy objects.
 */
async function mapApplicationsForResponse(applications: any[]) {
  const reviewerIds = [
    ...new Set(
      applications
        .map((application) => application.reviewedById)
        .filter((id): id is string => Boolean(id))
    ),
  ];

  const reviewers = reviewerIds.length
    ? await db.user.findMany({
        where: { id: { in: reviewerIds } },
        select: { id: true, firstName: true, lastName: true },
      })
    : [];
  const reviewerMap = new Map(reviewers.map((r) => [r.id, r]));

  return applications.map((application) => {
    const { property, applicant, ...rest } = application;
    return {
      ...rest,
      propertyId: property
        ? { ...property, address: buildPropertyAddress(property) }
        : rest.propertyId,
      applicantId: applicant ?? rest.applicantId,
      reviewedBy: rest.reviewedById
        ? reviewerMap.get(rest.reviewedById) ?? rest.reviewedById
        : rest.reviewedById,
    };
  });
}

// ============================================================================
// GET /api/applications - Get all applications with pagination and filtering
// ============================================================================

export const GET = withAccessAndDB(APPLICATION_ACCESS)(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const { searchParams } = new URL(request.url);
      const paginationParams = parsePaginationParams(searchParams);

      const where: Prisma.ApplicationWhereInput = {};

      // See lib/db/scopes.ts — applications scope by applicant, not tenant.
      applyScope(where, applicationScope(user));

      const status = searchParams.get("status");
      if (
        status &&
        Object.values(ApplicationStatus).includes(status as ApplicationStatus)
      ) {
        where.status = status;
      }

      const propertyId = searchParams.get("propertyId");
      if (propertyId) {
        where.propertyId = propertyId;
      }

      const applicantId = searchParams.get("applicantId");
      if (applicantId && !user.isTenant) {
        where.applicantId = applicantId;
      }

      const startDate = searchParams.get("startDate");
      const endDate = searchParams.get("endDate");
      if (startDate || endDate) {
        where.submittedAt = {
          ...(startDate ? { gte: new Date(startDate) } : {}),
          ...(endDate ? { lte: new Date(endDate) } : {}),
        };
      }

      // Search across the applicant's personal info (stored as Json)
      const search = searchParams.get("search");
      if (search) {
        const pattern = `%${search}%`;
        const matches = await db.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM applications
          WHERE "deletedAt" IS NULL
            AND ("personalInfo"->>'firstName' ILIKE ${pattern}
              OR "personalInfo"->>'lastName' ILIKE ${pattern}
              OR "personalInfo"->>'email' ILIKE ${pattern})
        `;
        where.id = { in: matches.map((row) => row.id) };
      }

      const page = paginationParams.page ?? 1;
      const limit = paginationParams.limit ?? 10;
      const sortField =
        paginationParams.sortBy &&
        paginationParams.sortBy in Prisma.ApplicationScalarFieldEnum
          ? paginationParams.sortBy
          : "createdAt";
      const sortOrder = paginationParams.sortOrder === "asc" ? "asc" : "desc";

      const [applications, total] = await Promise.all([
        db.application.findMany({
          where,
          orderBy: { [sortField]: sortOrder },
          skip: (page - 1) * limit,
          take: limit,
          include: {
            property: { select: APPLICATION_PROPERTY_SELECT },
            applicant: {
              select: { id: true, firstName: true, lastName: true, email: true },
            },
          },
        }),
        db.application.count({ where }),
      ]);

      const populatedData = await mapApplicationsForResponse(applications);

      return createSuccessResponse(
        populatedData,
        "Applications retrieved successfully",
        createPaginationInfo(page, limit, total)
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);

// ============================================================================
// POST /api/applications - Create a new application
// ============================================================================

export const POST = withAccessAndDB(APPLICATION_ACCESS)(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const { success, data: body, error } = await parseRequestBody(request);
      if (!success) {
        return createErrorResponse(error!, 400);
      }

      const validation = validateSchema(applicationSchema, body);
      if (!validation.success) {
        return createErrorResponse(validation.errors.join(", "), 400);
      }

      const applicationData = validation.data as any;
      if (user.isTenant) {
        applicationData.applicantId = user.id;
      }

      // Scoped: the id arrives in the request body, so this is what stops
      // a narrowed caller attaching a record to a building they were
      // not given.
      const property = await db.property.findFirst({
        where: withScope(
          { id: applicationData.propertyId },
          propertyScope(user),
        ),
      });
      if (!property) {
        return createErrorResponse("Property not found", 404);
      }

      if (property.status !== "available") {
        return createErrorResponse(
          "Property is not available for applications",
          400
        );
      }

      const existingApplication = await db.application.findFirst({
        where: {
          propertyId: applicationData.propertyId,
          applicantId: applicationData.applicantId,
          status: {
            in: [
              ApplicationStatus.DRAFT,
              ApplicationStatus.SUBMITTED,
              ApplicationStatus.UNDER_REVIEW,
            ],
          },
        },
      });

      if (existingApplication) {
        return createErrorResponse(
          "You already have an active application for this property",
          400
        );
      }

      const applicant = await db.user.findFirst({
        where: { id: applicationData.applicantId },
      });
      if (!applicant) {
        return createErrorResponse("Applicant not found", 404);
      }

      const created = await db.application.create({
        data: {
          organizationId: user.organizationId!,
          propertyId: applicationData.propertyId,
          applicantId: applicationData.applicantId,
          status: applicationData.status ?? ApplicationStatus.DRAFT,
          applicationFee:
            (applicationData.applicationFee ?? {}) as Prisma.InputJsonValue,
          personalInfo:
            (applicationData.personalInfo ?? {}) as Prisma.InputJsonValue,
          employmentInfo: applicationData.employmentInfo as
            | Prisma.InputJsonValue
            | undefined,
          emergencyContacts:
            (applicationData.emergencyContacts ?? []) as Prisma.InputJsonValue,
          previousAddresses:
            (applicationData.previousAddresses ?? []) as Prisma.InputJsonValue,
          documents:
            (applicationData.documents ?? []) as Prisma.InputJsonValue,
          additionalInfo:
            (applicationData.additionalInfo ?? {}) as Prisma.InputJsonValue,
          submittedAt: applicationData.submittedAt,
          reviewedAt: applicationData.reviewedAt,
          reviewedById: applicationData.reviewedBy,
          reviewNotes: applicationData.reviewNotes,
        },
      });

      const populated = await db.application.findFirst({
        where: { id: created.id },
        include: {
          property: { select: APPLICATION_PROPERTY_SELECT },
          applicant: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
        },
      });

      const [application] = await mapApplicationsForResponse([
        populated ?? created,
      ]);

      return createSuccessResponse(
        { application },
        "Application created successfully"
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);
