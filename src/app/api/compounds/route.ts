/**
 * PropertyPro - Compounds API Routes
 * CRUD for compounds / residential complexes — named groups of related
 * properties that each stay independently manageable.
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { db, runWithOrgTransaction } from "@/lib/db/prisma";
import {
  applyScope,
  compoundScope,
  propertyScope,
  withScope,
} from "@/lib/db/scopes";
import { Prisma } from "@/generated/prisma/client";
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
  compoundCreateSchema,
  compoundQuerySchema,
  validateSchema,
} from "@/lib/validations";
import {
  COMPOUND_OWNER_SELECT,
  getCompoundStatsBatch,
  presentCompound,
} from "@/lib/compounds";
import {
  buildReportResponse,
  isReportFormat,
  isRtlReportRequest,
  reportLanguage,
  EXPORT_ROW_LIMIT,
  type ReportFormat,
  type ReportSheet,
  canExport,
  EXPORT_DENIED_MESSAGE,
} from "@/lib/reports/export";
import { businessToday } from "@/lib/dates/business-day";

// ============================================================================
// GET /api/compounds
// ============================================================================

export const GET = withPermissionAndDB("property_view")(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const { searchParams } = new URL(request.url);
      const paginationParams = parsePaginationParams(searchParams);

      const validation = validateSchema(compoundQuerySchema, {
        ...paginationParams,
        city: searchParams.get("city") || undefined,
        ownerId: searchParams.get("ownerId") || undefined,
        managerId: searchParams.get("managerId") || undefined,
      });
      if (!validation.success) {
        return createErrorResponse(validation.errors.join(", "), 400);
      }

      const filters = validation.data;
      const page = filters.page ?? 1;
      const limit = filters.limit ?? 10;

      const conditions: Prisma.CompoundWhereInput[] = [];
      if (filters.city) {
        conditions.push({
          addressCity: { contains: filters.city, mode: "insensitive" },
        });
      }
      if (filters.ownerId) conditions.push({ ownerId: filters.ownerId });
      if (filters.managerId) conditions.push({ managerId: filters.managerId });
      if (filters.search) {
        conditions.push({
          OR: [
            { name: { contains: filters.search, mode: "insensitive" } },
            { code: { contains: filters.search, mode: "insensitive" } },
            { addressCity: { contains: filters.search, mode: "insensitive" } },
            { addressStreet: { contains: filters.search, mode: "insensitive" } },
          ],
        });
      }

      const where: Prisma.CompoundWhereInput =
        conditions.length > 0 ? { AND: conditions } : {};

      const sortField =
        filters.sortBy === "city" ? "addressCity" : filters.sortBy ?? "createdAt";

      // A compound is reachable when one of its buildings is; AND-ed on

      // after the caller's own filters.

      applyScope(where, compoundScope(user));


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

        const all = await db.compound.findMany({
          where,
          orderBy: { [sortField]: filters.sortOrder ?? "desc" },
          take: EXPORT_ROW_LIMIT,
          include: {
            owner: COMPOUND_OWNER_SELECT,
            manager: COMPOUND_OWNER_SELECT,
          },
        });
        const allStats = await getCompoundStatsBatch(
          all.map((compound) => compound.id),
          user,
        );

        const sheet: ReportSheet<(typeof all)[number]> = {
          title: "Compounds",
          columns: [
            { header: "Compound", value: (row) => row.name },
            { header: "Code", value: (row) => row.code ?? "" },
            { header: "District", value: (row) => row.addressDistrict ?? "" },
            { header: "City", value: (row) => row.addressCity },
            {
              header: "Owner",
              value: (row) =>
                row.owner
                  ? `${row.owner.firstName ?? ""} ${row.owner.lastName ?? ""}`.trim()
                  : "",
            },
            {
              header: "Buildings",
              value: (row) => allStats.get(row.id)?.propertyCount ?? 0,
            },
            {
              header: "Units",
              value: (row) => allStats.get(row.id)?.unitCount ?? 0,
            },
            {
              header: "Occupied",
              value: (row) => allStats.get(row.id)?.occupiedUnits ?? 0,
            },
            {
              header: "Occupancy %",
              value: (row) => allStats.get(row.id)?.occupancyRate ?? 0,
            },
            {
              header: "Monthly rent",
              value: (row) => allStats.get(row.id)?.monthlyRent ?? 0,
            },
          ],
          rows: all,
          summary: [["Compounds", all.length]],
        };

        return buildReportResponse(sheet, {
          format: rawFormat as ReportFormat,
          rtl: isRtlReportRequest(searchParams),
          lang: reportLanguage(searchParams),
          fileName: "Compounds",
          dateStamp: businessToday(),
        });
      }

      const [compounds, total] = await Promise.all([
        db.compound.findMany({
          where,
          orderBy: { [sortField]: filters.sortOrder ?? "desc" },
          skip: (page - 1) * limit,
          take: limit,
          include: {
            owner: COMPOUND_OWNER_SELECT,
            manager: COMPOUND_OWNER_SELECT,
          },
        }),
        db.compound.count({ where }),
      ]);

      // One batched rollup for the whole page rather than a query set per row.
      const stats = await getCompoundStatsBatch(
        compounds.map((compound) => compound.id),
        user,
      );

      return createSuccessResponse(
        compounds.map((compound) => ({
          ...presentCompound(compound),
          stats: stats.get(compound.id),
        })),
        "Compounds retrieved successfully",
        createPaginationInfo(page, limit, total),
      );
    } catch (error) {
      return handleApiError(error, "Failed to retrieve compounds");
    }
  },
);

// ============================================================================
// POST /api/compounds
// ============================================================================

export const POST = withPermissionAndDB("property_create")(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const { success, data: body } = await parseRequestBody(request);
      if (!success) {
        return createErrorResponse("Invalid request body", 400);
      }

      const validation = validateSchema(compoundCreateSchema, body);
      if (!validation.success) {
        return createErrorResponse(validation.errors.join(", "), 400);
      }

      const input = validation.data;
      const organizationId = user.organizationId!;
      const code = input.code?.trim() || null;

      if (code) {
        const clash = await db.compound.findFirst({
          where: { code, deletedAt: null },
          select: { id: true },
        });
        if (clash) {
          return createErrorResponse(
            "Another compound already uses this code",
            409,
          );
        }
      }

      const compoundId = await runWithOrgTransaction(async (tx) => {
        const created = await tx.compound.create({
          data: {
            organizationId,
            name: input.name,
            code,
            description: input.description ?? null,
            addressStreet: input.address.street,
            addressCity: input.address.city,
            addressDistrict: input.address.district,
            addressState: input.address.state,
            addressZipCode: input.address.zipCode,
            addressCountry: input.address.country,
            totalArea: input.totalArea ?? null,
            yearBuilt: input.yearBuilt ?? null,
            amenities: (input.amenities ??
              []) as unknown as Prisma.InputJsonValue,
            attachments: (input.attachments ??
              []) as unknown as Prisma.InputJsonValue,
            images: input.images ?? [],
            ownerId: input.ownerId ?? null,
            managerId: input.managerId ?? null,
            notes: input.notes ?? null,
          },
        });

        if (input.propertyIds?.length) {
          // updateMany, not a nested connect: attaching must never touch
          // anything else on the property rows.
          //
          // The organization filter alone used to be the whole guard, and the
          // comment here said so. It stopped being true once an employee
          // could be narrowed to particular buildings: `organizationId` says
          // the building belongs to this office, not that it belongs to this
          // caller. Both are needed — and AND-ed, not spread: the scope is
          // keyed on the building's id too, and spread over the requested
          // ids it moved every building the caller held into the compound.
          await tx.property.updateMany({
            where: withScope(
              { id: { in: input.propertyIds }, organizationId, deletedAt: null },
              propertyScope(user),
            ),
            data: { compoundId: created.id },
          });
        }

        return created.id;
      });

      const compound = await db.compound.findFirst({
        where: { id: compoundId },
        include: {
          owner: COMPOUND_OWNER_SELECT,
          manager: COMPOUND_OWNER_SELECT,
        },
      });

      return createSuccessResponse(
        compound ? presentCompound(compound) : compound,
        "Compound created successfully",
      );
    } catch (error) {
      return handleApiError(error, "Failed to create compound");
    }
  },
);
