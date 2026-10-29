/**
 * PropertyPro - Active Leases API Route
 * Get all active leases with pagination and filtering
 */

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import { applyScope, leaseScope } from "@/lib/db/scopes";
import { Prisma } from "@/generated/prisma/client";
import { LeaseStatus } from "@/types";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  withAccessAndDB,
  parsePaginationParams,
  createPaginationInfo,
} from "@/lib/api-utils";
import { paginationSchema, validateSchema } from "@/lib/validations";
import { LEASE_READ_ACCESS } from "@/lib/lease-access";

// ============================================================================
// GET /api/leases/active - Get all active leases with pagination and filtering
// ============================================================================

export const GET = withAccessAndDB(LEASE_READ_ACCESS)(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const { searchParams } = new URL(request.url);
      const paginationParams = parsePaginationParams(searchParams);

      // Parse filter parameters
      const filterParams = {
        ...paginationParams,
        propertyId: searchParams.get("propertyId") || undefined,
        tenantId: searchParams.get("tenantId") || undefined,
        search: searchParams.get("search") || undefined,
      };

      // Validate filter parameters
      const validation = validateSchema(paginationSchema, filterParams);
      if (!validation.success) {
        return createErrorResponse(validation.errors.join(", "), 400);
      }

      const filters = validation.data as typeof validation.data & {
        propertyId?: string;
        tenantId?: string;
      };

      // Build query based on user role and filters
      const where: Prisma.LeaseWhereInput = {
        status: LeaseStatus.ACTIVE, // Only active leases
      };

      // See lib/db/scopes.ts. An AND rather than an assignment, because the
      // `filters.tenantId` line below would otherwise overwrite it outright.
      // That never leaked: paginationSchema declares no tenantId, so Zod strips
      // it and `filters.tenantId` is always undefined — the cast on `filters`
      // above says otherwise and is simply wrong. Safety by accident of an
      // unrelated schema is not safety; the AND makes it structural. (The same
      // strip also means the propertyId filter on this route has never worked.)
      applyScope(where, leaseScope(user));

      // Apply filters
      if (filters.propertyId) where.propertyId = filters.propertyId;
      if (filters.tenantId) where.tenantId = filters.tenantId;

      // Handle search - filtered after fetching since tenant/property are relations
      let searchRegex: RegExp | null = null;
      if (
        filters.search &&
        typeof filters.search === "string" &&
        filters.search.trim()
      ) {
        const searchTerm = filters.search.trim();
        // Escape special regex characters for safety
        const escapedSearchTerm = searchTerm.replace(
          /[.*+?^${}()|[\]\\]/g,
          "\\$&"
        );
        searchRegex = new RegExp(escapedSearchTerm, "i");
      }

      const page = filters.page ?? 1;
      const limit = filters.limit ?? 10;
      const sortField =
        filters.sortBy && filters.sortBy in Prisma.LeaseScalarFieldEnum
          ? filters.sortBy
          : "createdAt";
      const sortOrder = filters.sortOrder === "asc" ? "asc" : "desc";

      const [leases, total] = await Promise.all([
        db.lease.findMany({
          where,
          orderBy: { [sortField]: sortOrder },
          skip: (page - 1) * limit,
          take: limit,
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
                type: true,
                isMultiUnit: true,
                totalUnits: true,
                units: true,
                owner: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    email: true,
                  },
                },
              },
            },
            tenant: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                phone: true,
                avatar: true,
                dateOfBirth: true,
                emergencyContacts: true,
                backgroundCheckStatus: true,
                tenantProfile: {
                  select: { employmentInfo: true, creditScore: true },
                },
                moveInDate: true,
                moveOutDate: true,
                applicationDate: true,
                tenantStatus: true,
                deletedAt: true,
              },
            },
            unit: true,
          },
        }),
        db.lease.count({ where }),
      ]);

      // Filter out leases with missing tenants (orphaned leases), apply search,
      // and add unit information
      const validLeases = leases
        .filter((lease) => lease.tenant !== null && !lease.tenant?.deletedAt)
        .filter((lease) => {
          // Apply search filter across related fields if search term exists
          if (!searchRegex) return true;

          const tenant: any = lease.tenant ?? {};
          const property: any = lease.property ?? {};

          const tenantFirstName = tenant.firstName || "";
          const tenantLastName = tenant.lastName || "";
          const tenantFullName = `${tenantFirstName} ${tenantLastName}`.trim();
          const tenantEmail = tenant.email || "";
          const tenantPhone = tenant.phone || "";

          const propertyName = property.name || "";
          const propertyStreet = property.addressStreet || "";
          const propertyCity = property.addressCity || "";
          const propertyState = property.addressState || "";
          const fullAddress =
            `${propertyStreet} ${propertyCity} ${propertyState}`.trim();

          const unitNumber = lease.unit?.unitNumber || "";

          return (
            searchRegex.test(tenantFullName) ||
            searchRegex.test(tenantFirstName) ||
            searchRegex.test(tenantLastName) ||
            searchRegex.test(tenantEmail) ||
            searchRegex.test(tenantPhone) ||
            searchRegex.test(propertyName) ||
            searchRegex.test(fullAddress) ||
            searchRegex.test(propertyStreet) ||
            searchRegex.test(propertyCity) ||
            searchRegex.test(unitNumber)
          );
        })
        .map((lease) => {
          const { property, tenant, unit, ...rest } = lease as any;

          return {
            ...rest,
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
                  ownerId: property.owner ?? undefined,
                  owner: undefined,
                }
              : rest.propertyId,
            tenantId: tenant
              ? {
                  ...tenant,
                  employmentInfo: tenant.tenantProfile?.employmentInfo ?? null,
                  creditScore: tenant.tenantProfile?.creditScore ?? null,
                  tenantProfile: undefined,
                  deletedAt: undefined,
                }
              : rest.tenantId,
            unitId: unit ?? rest.unitId,
            unit: unit ?? undefined,
          };
        });

      // Update pagination count if we filtered out any leases due to search
      const filteredPagination = {
        ...createPaginationInfo(page, limit, total),
        total: validLeases.length,
        totalPages: Math.ceil(validLeases.length / (limit || 10)),
      };

      return createSuccessResponse(
        {
          data: validLeases,
          pagination: filteredPagination,
        },
        "Active leases retrieved successfully"
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);
