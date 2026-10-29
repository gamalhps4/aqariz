export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import { applyScope, propertyScope } from "@/lib/db/scopes";
import { Prisma } from "@/generated/prisma/client";
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
import { categoryNamer } from "@/lib/reports/filter-names";
import { translatorFor, unitStatusText } from "@/lib/reports/list-labels";
import { businessToday } from "@/lib/dates/business-day";
import {
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  withPermissionAndDB,
  parsePaginationParams,
  type AuthenticatedAccessUser,
} from "@/lib/api-utils";
import { PropertyStatus, PropertyType } from "@/types";

export const GET = withPermissionAndDB("property_view")(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const { searchParams } = new URL(request.url);
      const paginationParams = parsePaginationParams(searchParams);
      const page = paginationParams.page ?? 1;
      const limit = paginationParams.limit ?? 12;
      const { sortBy, sortOrder, search } = paginationParams;

      const status = searchParams.get("status") || undefined;
      const unitType = searchParams.get("unitType") || undefined;
      const bedrooms = searchParams.get("bedrooms")
        ? parseInt(searchParams.get("bedrooms") as string)
        : undefined;
      const bathrooms = searchParams.get("bathrooms")
        ? parseInt(searchParams.get("bathrooms") as string)
        : undefined;
      const minRent = searchParams.get("minRent")
        ? parseFloat(searchParams.get("minRent") as string)
        : undefined;
      const maxRent = searchParams.get("maxRent")
        ? parseFloat(searchParams.get("maxRent") as string)
        : undefined;
      const type = searchParams.get("type") || undefined;
      const state = searchParams.get("state") || undefined;
      const city = searchParams.get("city") || undefined;

      // Property-level filters (the old pipeline matched the parent document)
      const propertyFilter: Prisma.PropertyWhereInput = { deletedAt: null };
      if (type && Object.values(PropertyType).includes(type as any)) {
        propertyFilter.type = type;
      }
      if (state) {
        propertyFilter.addressState = { contains: state, mode: "insensitive" };
      }
      if (city) {
        propertyFilter.addressCity = { contains: city, mode: "insensitive" };
      }

      // Unit-level filters (the old pipeline matched the unwound units)
      const where: Prisma.UnitWhereInput = {
        deletedAt: null,
        property: propertyFilter,
      };
      if (status && Object.values(PropertyStatus).includes(status as any)) {
        where.status = status;
      }
      if (unitType) where.unitType = unitType;
      if (bedrooms !== undefined) where.bedrooms = bedrooms;
      if (bathrooms !== undefined) where.bathrooms = bathrooms;
      if (minRent !== undefined || maxRent !== undefined) {
        where.rentAmount = {
          ...(minRent !== undefined ? { gte: minRent } : {}),
          ...(maxRent !== undefined ? { lte: maxRent } : {}),
        };
      }
      if (search) {
        where.OR = [
          { property: { name: { contains: search, mode: "insensitive" } } },
          { unitNumber: { contains: search, mode: "insensitive" } },
        ];
      }

      const direction: Prisma.SortOrder = sortOrder === "asc" ? "asc" : "desc";
      const orderBy: Prisma.UnitOrderByWithRelationInput[] =
        sortBy === "rentAmount"
          ? [{ rentAmount: direction }]
          : sortBy === "squareFootage"
          ? [{ squareFootage: direction }]
          : sortBy === "unitNumber"
          ? [{ unitNumber: direction }]
          : sortBy === "status"
          ? [{ status: direction }]
          : sortBy === "name"
          ? [{ property: { name: direction } }, { unitNumber: "asc" }]
          : [{ property: { createdAt: direction } }, { unitNumber: "asc" }];

      // A unit belongs to a building, so the building rule is the unit rule.
      // AND-ed on after the caller's own filters.
      applyScope(where, { property: propertyScope(user) });

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
        const fetched = await db.unit.findMany({
          where,
          orderBy: [...orderBy, { id: "asc" }],
          take: EXPORT_FETCH_LIMIT,
          include: {
            property: {
              select: {
                name: true,
                addressDistrict: true,
                addressCity: true,
                compound: { select: { name: true } },
              },
            },
          },
        });
        const { rows: all, truncated } = capExportRows(fetched);

        const sheet: ReportSheet<(typeof all)[number]> = {
          title: "Units",
          columns: [
            {
              header: "Compound",
              value: (row) => row.property.compound?.name ?? "",
            },
            { header: "Building", value: (row) => row.property.name },
            { header: "Unit", value: (row) => row.unitNumber },
            { header: "Type", value: (row) => unitTypeName(row.unitType) },
            { header: "Floor", value: (row) => row.floor ?? "" },
            { header: "Bedrooms", value: (row) => row.bedrooms ?? "" },
            { header: "Bathrooms", value: (row) => row.bathrooms ?? "" },
            { header: "Area", value: (row) => row.squareFootage ?? "" },
            {
              header: "Status",
              value: (row) => unitStatusText(row.status, tr),
            },
            { header: "Rent", value: (row) => Number(row.rentAmount ?? 0) },
            {
              header: "Deposit",
              value: (row) => Number(row.securityDeposit ?? 0),
            },
            {
              header: "District",
              value: (row) => row.property.addressDistrict ?? "",
            },
            { header: "City", value: (row) => row.property.addressCity },
          ],
          rows: all,
          summary: [
            [
              "Total rent",
              all.reduce((sum, row) => sum + Number(row.rentAmount ?? 0), 0),
            ],
          ],
          // A list of units has no period; it is read as at a day.
          filtersSummary: {
            asAt: businessToday(),
            filters: [
              ["Search", search],
              ["Building type", type ? propertyTypeName(type) : undefined],
              ["Unit type", unitType ? unitTypeName(unitType) : undefined],
              ["Status", status ? unitStatusText(status, tr) : undefined],
              ["Bedrooms", bedrooms],
              ["Bathrooms", bathrooms],
              ["City", city],
            ],
            limit: EXPORT_ROW_LIMIT,
            truncated,
          },
        };

        return buildReportResponse(sheet, {
          format: rawFormat as ReportFormat,
          rtl: isRtlReportRequest(searchParams),
          lang,
          fileName: "Units",
          dateStamp: businessToday(),
        });
      }

      const [total, distinctProperties, statusGroups, units] =
        await Promise.all([
          db.unit.count({ where }),
          db.unit.findMany({
            where,
            select: { propertyId: true },
            distinct: ["propertyId"],
          }),
          db.unit.groupBy({
            by: ["status"],
            where,
            _count: { _all: true },
          }),
          db.unit.findMany({
            where,
            orderBy,
            skip: Math.max((page - 1) * limit, 0),
            take: limit,
            include: {
              property: {
                select: {
                  id: true,
                  name: true,
                  description: true,
                  type: true,
                  status: true,
                  addressStreet: true,
                  addressCity: true,
                  addressState: true,
                  addressZipCode: true,
                  addressCountry: true,
                  images: true,
                  createdAt: true,
                  updatedAt: true,
                },
              },
            },
          }),
        ]);

      const totalProperties = distinctProperties.length;

      const statusCounts = {
        available: 0,
        occupied: 0,
        maintenance: 0,
        unavailable: 0,
      };
      statusGroups.forEach((group) => {
        if (group.status && group.status in statusCounts) {
          statusCounts[group.status as keyof typeof statusCounts] =
            group._count._all;
        }
      });

      // Keep the legacy unwound-document shape: property fields at the root
      // (row id = property id) with the unit fields projected alongside.
      const data = units.map((unit) => ({
        id: unit.property.id,
        _id: unit.property.id,
        name: unit.property.name,
        description: unit.property.description,
        type: unit.property.type,
        status: unit.property.status,
        address: {
          street: unit.property.addressStreet,
          city: unit.property.addressCity,
          state: unit.property.addressState,
          zipCode: unit.property.addressZipCode,
          country: unit.property.addressCountry,
        },
        images: unit.property.images,
        unitId: unit.id,
        unitNumber: unit.unitNumber,
        unitType: unit.unitType,
        floor: unit.floor,
        bedrooms: unit.bedrooms,
        bathrooms: unit.bathrooms,
        squareFootage: unit.squareFootage,
        rentAmount: unit.rentAmount,
        securityDeposit: unit.securityDeposit,
        unitStatus: unit.status,
        unitImages: unit.images,
        createdAt: unit.property.createdAt,
        updatedAt: unit.property.updatedAt,
      }));

      const totalPages = Math.ceil(total / limit) || 1;

      const pagination = {
        page,
        limit,
        total,
        totalProperties,
        totalPages,
        pages: totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
        statusCounts,
      };

      return createSuccessResponse(data, "Units retrieved", pagination);
    } catch (error) {
      return handleApiError(error);
    }
  }
);
