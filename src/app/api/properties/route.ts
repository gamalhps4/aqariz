/**
 * PropertyPro - Properties API Routes
 * CRUD operations for property management
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { db, runWithOrgTransaction } from "@/lib/db/prisma";
import { compoundScope, propertyScope, withScope } from "@/lib/db/scopes";
import {
  buildReportResponse,
  capExportRows,
  isReportFormat,
  isRtlReportRequest,
  reportLanguage,
  EXPORT_FETCH_LIMIT,
  EXPORT_ROW_LIMIT,
  type ReportFormat,
  type ReportSheet,
  canExport,
  EXPORT_DENIED_MESSAGE,
} from "@/lib/reports/export";
import { describeAppliedFilters } from "@/lib/report-filters/describe";
import { categoryNamer } from "@/lib/reports/filter-names";
import { propertyStatusText, translatorFor } from "@/lib/reports/list-labels";
import { businessToday } from "@/lib/dates/business-day";
import { Prisma } from "@/generated/prisma/client";
import { PropertyStatus } from "@/types";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  withPermissionAndDB,
  parsePaginationParams,
  createPaginationInfo,
  parseRequestBody,
} from "@/lib/api-utils";
import {
  propertyCreateSchema,
  propertyQuerySchema,
  validateSchema,
} from "@/lib/validations";
import {
  buildUnitFeatures,
  buildUnitScalarData,
  presentProperty,
} from "@/lib/property-units";
import { calculatePropertyStatusFromUnits } from "@/utils/property-status-calculator";
import { enforcePlanLimit } from "@/lib/billing/entitlements";
import {
  assertCategorySlug,
  assertUnitTypeSlugs,
  UnknownCategoryError,
} from "@/lib/property-categories";
import { AuditAction, recordActivity } from "@/lib/audit-domain";

const OWNER_MANAGER_SELECT = {
  select: { id: true, firstName: true, lastName: true, email: true },
} as const;

// ============================================================================
// GET /api/properties - Get all properties with pagination and filtering
// ============================================================================

export const GET = withPermissionAndDB("property_view")(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const { searchParams } = new URL(request.url);
      const paginationParams = parsePaginationParams(searchParams);

      // Parse filter parameters
      const filterParams = {
        ...paginationParams,
        type: searchParams.get("type") || undefined,
        status: searchParams.get("status") || undefined,
        minRent: searchParams.get("minRent")
          ? parseFloat(searchParams.get("minRent")!)
          : undefined,
        maxRent: searchParams.get("maxRent")
          ? parseFloat(searchParams.get("maxRent")!)
          : undefined,
        bedrooms: searchParams.get("bedrooms")
          ? parseInt(searchParams.get("bedrooms")!)
          : undefined,
        bathrooms: searchParams.get("bathrooms")
          ? parseInt(searchParams.get("bathrooms")!)
          : undefined,
        city: searchParams.get("city") || undefined,
        state: searchParams.get("state") || undefined,
        unitType: searchParams.get("unitType") || undefined,
        compoundId: searchParams.get("compoundId") || undefined,
        ownerId: searchParams.get("ownerId") || undefined,
        isMultiUnit:
          searchParams.get("isMultiUnit") === "true"
            ? true
            : searchParams.get("isMultiUnit") === "false"
            ? false
            : undefined,
        features: searchParams.get("features") || undefined,
        amenities: searchParams.get("amenities") || undefined,
        hasAvailableUnits: searchParams.get("hasAvailableUnits") === "true",
      };

      // Validate filter parameters
      const validation = validateSchema(propertyQuerySchema, filterParams);
      if (!validation.success) {
        return createErrorResponse(validation.errors.join(", "), 400);
      }

      const filters = validation.data;
      const { sortBy, sortOrder, search } = filters;
      const page = filters.page ?? 1;
      const limit = filters.limit ?? 10;

      // Build query based on user role and filters
      const conditions: Prisma.PropertyWhereInput[] = [];

      // Include soft-deleted properties only when an admin explicitly asks.
      // (The top-level `deletedAt` key opts out of the automatic filter.)
      const includeDeleted =
        user.isAdmin && searchParams.get("includeDeleted") === "true";

      // Apply filters
      if (filters.type) conditions.push({ type: filters.type });
      if (filters.status) conditions.push({ status: filters.status });
      if (filters.ownerId) conditions.push({ ownerId: filters.ownerId });
      // "none" lists the properties that sit outside every compound — the set
      // an operator picks from when building one.
      if (filters.compoundId) {
        conditions.push(
          filters.compoundId === "none"
            ? { compoundId: null }
            : { compoundId: filters.compoundId },
        );
      }

      // Unit-level fields (bedrooms, bathrooms, rentAmount live on units now)
      const unitFilter: Prisma.UnitWhereInput = {};
      if (filters.minRent || filters.maxRent) {
        unitFilter.rentAmount = {
          ...(filters.minRent ? { gte: filters.minRent } : {}),
          ...(filters.maxRent ? { lte: filters.maxRent } : {}),
        };
      }
      if (filters.bedrooms) unitFilter.bedrooms = filters.bedrooms;
      if (filters.bathrooms) unitFilter.bathrooms = filters.bathrooms;
      if (filters.unitType) unitFilter.unitType = filters.unitType;
      if (filterParams.hasAvailableUnits) {
        unitFilter.status = PropertyStatus.AVAILABLE;
      }
      if (Object.keys(unitFilter).length > 0) {
        conditions.push({
          units: { some: { ...unitFilter, deletedAt: null } },
        });
      }

      if (filters.city) {
        conditions.push({
          addressCity: { contains: filters.city, mode: "insensitive" },
        });
      }
      if (filters.state) {
        conditions.push({
          addressState: { contains: filters.state, mode: "insensitive" },
        });
      }
      if (filterParams.isMultiUnit !== undefined) {
        conditions.push({ isMultiUnit: filterParams.isMultiUnit });
      }
      // Property-level features were removed; amenities is a Json array of
      // { name, ... } objects — match any of the requested names.
      if (filterParams.amenities) {
        const amenityArray = filterParams.amenities
          .split(",")
          .map((a) => a.trim())
          .filter(Boolean);
        if (amenityArray.length > 0) {
          conditions.push({
            OR: amenityArray.map((name) => ({
              amenities: { array_contains: [{ name }] },
            })),
          });
        }
      }

      if (search) {
        conditions.push({
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { description: { contains: search, mode: "insensitive" } },
          ],
        });
      }

      // An owner sees only their own buildings, a tenant only the ones they
      // hold a live lease in — see lib/db/scopes.ts. Pushed in as a condition
      // so the `?ownerId=` filter above cannot widen it.
      conditions.push(propertyScope(user));

      const where: Prisma.PropertyWhereInput = {
        AND: conditions,
        deletedAt: includeDeleted ? undefined : null,
      };

      // Build sort (rentAmount/squareFootage are unit-level → fall back to
      // creation date, matching the old no-op sort on those keys)
      const direction: Prisma.SortOrder = sortOrder === "asc" ? "asc" : "desc";
      const orderBy: Prisma.PropertyOrderByWithRelationInput =
        sortBy === "name"
          ? { name: direction }
          : { createdAt: direction };

      const skip = (page - 1) * limit;

      // Same `where`, same order — the file carries what the screen filtered
      // to, not the one page of it that happened to be visible.
      const rawFormat = searchParams.get("format");
      // Export is its own permission, not a by-product of being able to
      // read the list — see canExport.
      if (rawFormat && !canExport(user, "property_export", "property_management")) {
        return createErrorResponse(EXPORT_DENIED_MESSAGE, 403);
      }
      if (rawFormat) {
        if (!isReportFormat(rawFormat)) {
          return createErrorResponse(
            `Unsupported export format "${rawFormat}"`,
            400,
          );
        }

        const lang = reportLanguage(searchParams);
        const tr = translatorFor(lang);
        const [propertyTypeName, unitTypeName] = await Promise.all([
          categoryNamer("property", lang),
          categoryNamer("unit", lang),
        ]);
        const fetched = await db.property.findMany({
          where,
          orderBy: [orderBy, { id: "asc" }],
          take: EXPORT_FETCH_LIMIT,
          include: {
            owner: OWNER_MANAGER_SELECT,
            compound: { select: { name: true } },
            units: {
              where: { deletedAt: null },
              select: { id: true, status: true, rentAmount: true },
            },
          },
        });
        const { rows: all, truncated } = capExportRows(fetched);

        const occupied = (units: Array<{ status: string }>) =>
          units.filter(
            (unit) => String(unit.status).toUpperCase() === "OCCUPIED",
          ).length;

        // The status the list shows: worked out from the building's units
        // when it has any, as the list does — not the column it was last
        // saved with, which can disagree with them.
        const shownStatus = (row: (typeof all)[number]) => {
          const unitStatuses = row.units
            .map((unit) => unit.status)
            .filter((status): status is PropertyStatus =>
              (Object.values(PropertyStatus) as string[]).includes(status),
            );
          return unitStatuses.length > 0
            ? calculatePropertyStatusFromUnits(unitStatuses)
            : row.status;
        };

        const sheet: ReportSheet<(typeof all)[number]> = {
          title: "Buildings",
          columns: [
            { header: "Compound", value: (row) => row.compound?.name ?? "" },
            { header: "Building", value: (row) => row.name },
            { header: "Type", value: (row) => propertyTypeName(row.type) },
            {
              header: "Status",
              value: (row) => propertyStatusText(shownStatus(row), tr),
            },
            {
              header: "Owner",
              value: (row) =>
                row.owner
                  ? `${row.owner.firstName ?? ""} ${row.owner.lastName ?? ""}`.trim()
                  : "",
            },
            { header: "Street", value: (row) => row.addressStreet },
            { header: "District", value: (row) => row.addressDistrict ?? "" },
            { header: "City", value: (row) => row.addressCity },
            { header: "Units", value: (row) => row.units.length },
            { header: "Occupied", value: (row) => occupied(row.units) },
            {
              header: "Vacant",
              value: (row) => row.units.length - occupied(row.units),
            },
            {
              header: "Contracted rent",
              value: (row) =>
                row.units.reduce(
                  (sum, unit) => sum + Number(unit.rentAmount ?? 0),
                  0,
                ),
            },
          ],
          rows: all,
          summary: [
            ["Units", all.reduce((sum, row) => sum + row.units.length, 0)],
            [
              "Occupied",
              all.reduce((sum, row) => sum + occupied(row.units), 0),
            ],
          ],
          // A list of buildings has no period; it is read as at a day.
          filtersSummary: {
            asAt: businessToday(),
            filters: [
              ["Search", search],
              ["Type", filters.type ? propertyTypeName(filters.type) : undefined],
              [
                "Status",
                filters.status ? propertyStatusText(filters.status, tr) : undefined,
              ],
              [
                "Unit type",
                filters.unitType ? unitTypeName(filters.unitType) : undefined,
              ],
              ...(await describeAppliedFilters(user, {
                ownerId: filters.ownerId,
                compoundId:
                  filters.compoundId === "none" ? undefined : filters.compoundId,
              })),
              ["City", filters.city],
              ["Bedrooms", filters.bedrooms],
              ["Bathrooms", filters.bathrooms],
            ],
            limit: EXPORT_ROW_LIMIT,
            truncated,
          },
        };

        return buildReportResponse(sheet, {
          format: rawFormat as ReportFormat,
          rtl: isRtlReportRequest(searchParams),
          lang,
          fileName: "Buildings",
          dateStamp: businessToday(),
        });
      }

      const [rows, total] = await Promise.all([
        db.property.findMany({
          where,
          orderBy,
          skip,
          take: limit,
          include: {
            owner: OWNER_MANAGER_SELECT,
            manager: OWNER_MANAGER_SELECT,
            units: {
              where: { deletedAt: null },
              orderBy: [{ createdAt: "asc" }, { unitNumber: "asc" }],
            },
          },
        }),
        db.property.count({ where }),
      ]);

      const propertiesWithUnits = rows.map((property) =>
        presentProperty(property, { deriveStatus: true }),
      );

      const totalPages = Math.ceil(total / limit);
      const pagination = {
        ...createPaginationInfo(page, limit, total),
        pages: totalPages,
      };

      return createSuccessResponse(
        propertiesWithUnits,
        "Properties retrieved successfully",
        pagination
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);

// ============================================================================
// POST /api/properties - Create a new property
// ============================================================================

export const POST = withPermissionAndDB("property_create")(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const { success, data: body, error } = await parseRequestBody(request);
      if (!success) {
        return createErrorResponse(error!, 400);
      }

      // Validate request body
      const validation = validateSchema(propertyCreateSchema, body);
      if (!validation.success) {
        return createErrorResponse(validation.errors.join(", "), 400);
      }

      const propertyData = validation.data;

      // Categories are organization-configurable rows now, so zod only
      // checked the slug's shape — confirm it is one this organization
      // actually offers before it reaches Property.type.
      try {
        await assertCategorySlug(
          user.organizationId!,
          "property",
          propertyData.type,
        );
        await assertUnitTypeSlugs(
          user.organizationId!,
          (propertyData.units ?? []).map((unit) => unit.unitType),
        );
      } catch (categoryError) {
        if (categoryError instanceof UnknownCategoryError) {
          return createErrorResponse(categoryError.message, 400);
        }
        throw categoryError;
      }

      await enforcePlanLimit(
        user.organizationId!,
        "properties",
        await db.property.count({ where: { deletedAt: null } }),
      );

      // A property carries its units in the same request, so the unit budget
      // is checked for the whole batch rather than one at a time.
      const requestedUnitCount = Array.isArray(propertyData.units)
        ? propertyData.units.length
        : 0;
      if (requestedUnitCount > 0) {
        await enforcePlanLimit(
          user.organizationId!,
          "units",
          await db.unit.count({ where: { deletedAt: null } }),
          requestedUnitCount,
        );
      }

      // The owner must exist here and be active; RLS keeps the lookup inside
      // the organization, so a building cannot be handed to someone in
      // another tenant. A 400 beats the foreign-key 500 this used to give.
      const owner = await db.user.findFirst({
        where: { id: propertyData.ownerId, isActive: true },
        select: { id: true },
      });
      if (!owner) {
        return createErrorResponse("Owner not found in this organization", 400);
      }

      let managerId: string | undefined;
      if (user.isManager && propertyData.managerId) {
        managerId = propertyData.managerId;
      } else if (user.isManager) {
        managerId = user.id;
      }
      if (user.isAdmin && propertyData.managerId) {
        managerId = propertyData.managerId;
      }

      const units = propertyData.units ?? [];
      const organizationId = user.organizationId!;

      // Only accept a compound this organization owns; RLS would reject a
      // foreign id anyway, but a 400 here beats a foreign-key 500. And only
      // one this caller can reach: a building placed in a compound makes
      // that compound reachable.
      let compoundId: string | null = null;
      if (propertyData.compoundId) {
        const compound = await db.compound.findFirst({
          where: withScope(
            { id: propertyData.compoundId },
            compoundScope(user),
          ),
          select: { id: true },
        });
        if (!compound) {
          return createErrorResponse("Compound not found", 400);
        }
        compoundId = compound.id;
      }

      // Note: bedrooms, bathrooms, squareFootage, rentAmount, securityDeposit
      // are stored only at the unit level — no property root level fields.
      const propertyId = await runWithOrgTransaction(async (tx) => {
        const created = await tx.property.create({
          data: {
            organizationId,
            name: propertyData.name,
            description: propertyData.description,
            type: propertyData.type,
            status: propertyData.status ?? PropertyStatus.AVAILABLE,
            addressStreet: propertyData.address.street,
            addressCity: propertyData.address.city,
            addressDistrict: propertyData.address.district,
            addressState: propertyData.address.state,
            addressZipCode: propertyData.address.zipCode,
            addressCountry: propertyData.address.country,
            yearBuilt: propertyData.yearBuilt,
            amenities: (propertyData.amenities ??
              []) as unknown as Prisma.InputJsonValue,
            attachments: (propertyData.attachments ??
              []) as unknown as Prisma.InputJsonValue,
            images: propertyData.images ?? [],
            ownerId: owner.id,
            managerId,
            compoundId: compoundId ?? null,
            totalUnits: units.length || 1,
            isMultiUnit: units.length > 1,
          },
        });

        if (units.length > 0) {
          await tx.unit.createMany({
            data: units.map((unit) => ({
              ...buildUnitScalarData(unit),
              unitNumber: unit.unitNumber,
              organizationId,
              propertyId: created.id,
              features: buildUnitFeatures(unit) as Prisma.InputJsonValue,
            })),
          });

          // Derive property status from the created units
          await tx.property.update({
            where: { id: created.id },
            data: {
              status: calculatePropertyStatusFromUnits(
                units.map((unit) => unit.status ?? PropertyStatus.AVAILABLE),
              ),
              totalUnits: units.length,
              isMultiUnit: units.length > 1,
            },
          });
        }

        return created.id;
      });

      // Return the complete property with its units. Not scoped: the id is
      // the row this request just created, not one the caller supplied, and
      // a narrowed employee's list of buildings was resolved before it
      // existed. Scoping the read could only answer with nothing — or, as it
      // once did, with a different building of theirs.
      const property = await db.property.findFirst({
        where: { id: propertyId },
        include: {
          owner: OWNER_MANAGER_SELECT,
          manager: OWNER_MANAGER_SELECT,
          units: {
            where: { deletedAt: null },
            orderBy: [{ createdAt: "asc" }, { unitNumber: "asc" }],
          },
        },
      });

      const unitsCount = units.length;

      return createSuccessResponse(
        property ? presentProperty(property) : property,
        `Property created successfully${
          unitsCount > 0
            ? ` with ${unitsCount} unit${unitsCount > 1 ? "s" : ""}`
            : ""
        }`,
        undefined
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);

// ============================================================================
// PUT /api/properties - Bulk update properties (admin only)
// ============================================================================

export const PUT = withPermissionAndDB(
  ["property_edit", "bulk_operations"],
  {
    requireAllPermissions: true,
  }
)(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      if (!user.isAdmin) {
        return createErrorResponse("Insufficient permissions", 403);
      }

      const { success, data: body, error } = await parseRequestBody(request);
      if (!success) {
        return createErrorResponse(error!, 400);
      }

      const { propertyIds, updates } = body;

      if (!Array.isArray(propertyIds) || propertyIds.length === 0) {
        return createErrorResponse("Property IDs array is required", 400);
      }

      if (!updates || typeof updates !== "object") {
        return createErrorResponse("Updates object is required", 400);
      }

      // Only allow property columns that may be bulk updated (ownership,
      // timestamps and unit-level fields are excluded).
      const allowedKeys = [
        "name",
        "description",
        "type",
        "status",
        "yearBuilt",
        "isMultiUnit",
        "totalUnits",
        "amenities",
        "images",
        "attachments",
        "managerId",
      ] as const;

      const data: Record<string, unknown> = {};
      for (const key of allowedKeys) {
        if (updates[key] !== undefined) data[key] = updates[key];
      }
      if (updates.address && typeof updates.address === "object") {
        const address = updates.address as Record<string, unknown>;
        if (address.street !== undefined) data.addressStreet = address.street;
        if (address.city !== undefined) data.addressCity = address.city;
        if (address.district !== undefined)
          data.addressDistrict = address.district;
        if (address.state !== undefined) data.addressState = address.state;
        if (address.zipCode !== undefined)
          data.addressZipCode = address.zipCode;
        if (address.country !== undefined)
          data.addressCountry = address.country;
      }

      let modifiedCount = 0;
      if (Object.keys(data).length > 0) {
        const result = await db.property.updateMany({
          // Intersected, not assigned: the ids come from the request, so
          // without this a caller narrowed to some buildings could act on
          // rows in any of the others. Rows outside the scope are simply
          // not touched, and `count` then reports what really happened.
          where: withScope({ id: { in: propertyIds } }, propertyScope(user)),
          data,
        });
        modifiedCount = result.count;
      }

      return createSuccessResponse(
        {
          matchedCount: modifiedCount,
          modifiedCount,
        },
        `${modifiedCount} properties updated successfully`
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);

// ============================================================================
// DELETE /api/properties - Bulk delete properties (admin and manager)
// ============================================================================

export const DELETE = withPermissionAndDB(
  ["property_delete", "bulk_operations"],
  {
    requireAllPermissions: true,
  }
)(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      if (!user.isAdmin) {
        return createErrorResponse("Insufficient permissions", 403);
      }

      const { searchParams } = new URL(request.url);
      const propertyIds = searchParams.get("ids")?.split(",") || [];

      if (propertyIds.length === 0) {
        return createErrorResponse("Property IDs are required", 400);
      }

      // Check which properties exist and are not already deleted
      const existingProperties = await db.property.findMany({
        // Intersected, not assigned: the ids come from the request, so
        // without this a caller narrowed to some buildings could act on
        // rows in any of the others. Rows outside the scope are simply
        // not touched, and `count` then reports what really happened.
        where: withScope(
          { id: { in: propertyIds }, deletedAt: null },
          propertyScope(user),
        ),
        select: { id: true },
      });

      if (existingProperties.length === 0) {
        return createErrorResponse(
          "No properties found to delete or all selected properties are already deleted",
          400
        );
      }

      const existingIds = existingProperties.map((p) => p.id);

      // The single delete's rule, which the bulk one skipped: a building
      // with a contract in force stays where it is. Those are left out and
      // counted, rather than failing the whole selection.
      const busy = await db.lease.findMany({
        where: {
          propertyId: { in: existingIds },
          status: { in: ["active", "pending"] },
        },
        select: { propertyId: true },
        distinct: ["propertyId"],
      });
      const withContracts = new Set(busy.map((lease) => lease.propertyId));
      const archivable = existingIds.filter((id) => !withContracts.has(id));
      if (archivable.length === 0) {
        return createErrorResponse(
          "Cannot delete properties with active leases. Please terminate all leases first.",
          409
        );
      }

      // Perform soft delete only on non-deleted properties
      const result = await db.property.updateMany({
        // Intersected, not assigned: the ids come from the request, so
        // without this a caller narrowed to some buildings could act on
        // rows in any of the others. Rows outside the scope are simply
        // not touched, and `count` then reports what really happened.
        where: withScope({ id: { in: archivable } }, propertyScope(user)),
        data: { deletedAt: new Date(), status: PropertyStatus.UNAVAILABLE },
      });

      void recordActivity({
        action: AuditAction.BULK_DELETE,
        recordType: "property",
        recordId: archivable.length === 1 ? archivable[0] : null,
        messageKey: "admin.audit.msg.bulk_archive",
        messageParams: { count: result.count },
        details: {
          propertyIds: archivable,
          archived: result.count,
          skippedWithContracts: withContracts.size,
        },
      });

      return createSuccessResponse(
        {
          matchedCount: result.count,
          modifiedCount: result.count,
          skippedWithContracts: withContracts.size,
        },
        `${result.count} properties moved to the archive`
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);
