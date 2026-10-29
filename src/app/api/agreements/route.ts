/**
 * PropertyPro - Agreements API
 * Management agreements between a property owner and the office.
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import {
  AGREEMENT_WRITE_DENIED,
  mayWriteAgreement,
} from "@/lib/db/agreement-write";
import {
  agreementScope,
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
import { agreementCreateSchema, validateSchema } from "@/lib/validations";
import { closingDate } from "@/lib/agreement-closing";
import { AuditAction, recordActivity } from "@/lib/audit-domain";
import {
  agreementName,
  agreementSnapshot,
} from "@/lib/audit/records/agreement";
import { compact } from "@/lib/audit/records/shared";
import { feeLabel, type AgreementRow } from "@/lib/services/agreement.service";
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
import { businessDay, businessToday } from "@/lib/dates/business-day";

const AGREEMENT_INCLUDE = {
  owner: { select: { id: true, firstName: true, lastName: true, email: true } },
  property: { select: { id: true, name: true } },
  compound: { select: { id: true, name: true } },
} as const;

/** Add the derived fee label so every list renders it the same way. */
function present(agreement: Record<string, any>) {
  return {
    ...agreement,
    feeLabel: feeLabel(agreement as AgreementRow),
    scopeType: agreement.propertyId
      ? "property"
      : agreement.compoundId
        ? "compound"
        : "portfolio",
  };
}

export const GET = withPermissionAndDB([
  "agreement_view",
  "agreement_management",
  // Reading stays open to the finance and property umbrellas it always was.
  "financial_management",
  "property_management",
])(async (user: AuthenticatedAccessUser, request: NextRequest) => {
  try {
    const { searchParams } = request.nextUrl;
    const pagination = parsePaginationParams(searchParams);
    const page = pagination.page ?? 1;
    const limit = pagination.limit ?? 12;

    const conditions: Prisma.AgreementWhereInput[] = [];
    const status = searchParams.get("status");
    const ownerId = searchParams.get("ownerId");
    const propertyId = searchParams.get("propertyId");
    const kind = searchParams.get("kind");

    if (status && status !== "all") conditions.push({ status });
    if (ownerId) conditions.push({ ownerId });
    if (kind) conditions.push({ kind });
    if (propertyId) {
      // A property is covered by its own agreement, by its compound's, or by
      // the owner's blanket one — so "agreements for this property" cannot be
      // a bare propertyId match.
      // Scoped: the building comes from the query string. One this caller
      // was not given does not resolve and falls through to the bare match
      // below, which the list's own scope then narrows to nothing.
      const property = await db.property.findFirst({
        where: withScope({ id: propertyId }, propertyScope(user)),
        select: { ownerId: true, compoundId: true },
      });
      if (property) {
        conditions.push({
          ownerId: property.ownerId,
          OR: [
            { propertyId },
            ...(property.compoundId
              ? [{ compoundId: property.compoundId, propertyId: null }]
              : []),
            { propertyId: null, compoundId: null },
          ],
        });
      } else {
        conditions.push({ propertyId });
      }
    }
    if (pagination.search) {
      conditions.push({
        OR: [
          {
            agreementNumber: {
              contains: pagination.search,
              mode: "insensitive",
            },
          },
          { notes: { contains: pagination.search, mode: "insensitive" } },
        ],
      });
    }

    const where: Prisma.AgreementWhereInput =
      conditions.length > 0 ? { AND: conditions } : {};

    // Which agreements this caller may read at all — see lib/db/scopes.ts.
    // AND-ed on after the filters, so that `ownerId` and `propertyId` from
    // the query string narrow it and cannot replace it. This list used to be
    // built from those parameters alone.
    applyScope(where, agreementScope(user));

    // Same `where`, same order — the file carries what the screen filtered
    // to, not the one page of it that happened to be visible.
    const rawFormat = searchParams.get("format");
    // Export is its own permission, not a by-product of being able to
    // read the list — see canExport.
    if (rawFormat && !canExport(user, "agreement_export", "agreement_management")) {
      return createErrorResponse(EXPORT_DENIED_MESSAGE, 403);
    }
    if (rawFormat) {
      if (!isReportFormat(rawFormat)) {
        return createErrorResponse(
          `Unsupported export format "${rawFormat}"`,
          400,
        );
      }

      const all = await db.agreement.findMany({
        where,
        include: AGREEMENT_INCLUDE,
        orderBy: { startDate: "desc" },
        take: EXPORT_ROW_LIMIT,
      });
      // `present` takes a loose record, so its return type loses the columns
      // the query actually selected; name them back for the sheet.
      type AgreementExportRow = (typeof all)[number] & {
        feeLabel: string;
        scopeType: string;
      };
      const rows = all.map(present) as AgreementExportRow[];

      const sheet: ReportSheet<AgreementExportRow> = {
        title: "Agreements",
        columns: [
          { header: "Number", value: (row) => row.agreementNumber ?? "" },
          { header: "Kind", value: (row) => row.kind },
          {
            header: "Owner",
            value: (row) =>
              `${row.owner?.firstName ?? ""} ${row.owner?.lastName ?? ""}`.trim(),
          },
          // What the agreement covers, named rather than left as an id.
          {
            header: "Scope",
            value: (row) =>
              row.property?.name ?? row.compound?.name ?? "Whole portfolio",
          },
          { header: "Scope type", value: (row) => row.scopeType },
          { header: "Fee", value: (row) => row.feeLabel },
          { header: "Charged on", value: (row) => row.commissionBasis },
          { header: "Status", value: (row) => row.status },
          {
            header: "Start",
            value: (row) => businessDay(row.startDate),
          },
          {
            header: "End",
            value: (row) =>
              row.endDate
                ? businessDay(row.endDate)
                : "",
          },
        ],
        rows,
        summary: [["Agreements", rows.length]],
      };

      return buildReportResponse(sheet, {
        format: rawFormat as ReportFormat,
        rtl: isRtlReportRequest(searchParams),
        lang: reportLanguage(searchParams),
        fileName: "Agreements",
        dateStamp: businessToday(),
      });
    }

    const [agreements, total] = await Promise.all([
      db.agreement.findMany({
        where,
        include: AGREEMENT_INCLUDE,
        orderBy: { startDate: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.agreement.count({ where }),
    ]);

    return createSuccessResponse(
      agreements.map(present),
      "Agreements retrieved successfully",
      createPaginationInfo(page, limit, total),
    );
  } catch (error) {
    return handleApiError(error, "Failed to retrieve agreements");
  }
});

// Adding, editing and deleting an agreement are separate rights (the review's
// View / Add / Edit / Delete / Export); the umbrella still covers all three.
export const POST = withPermissionAndDB([
  "agreement_create",
  "agreement_management",
])(async (user: AuthenticatedAccessUser, request: NextRequest) => {
  try {
    const { success, data: body } = await parseRequestBody(request);
    if (!success) {
      return createErrorResponse("Invalid request body", 400);
    }

    const validation = validateSchema(agreementCreateSchema, body);
    if (!validation.success) {
      return createErrorResponse(validation.errors.join(", "), 400);
    }

    const input = validation.data;
    const agreementNumber = input.agreementNumber?.trim() || null;

    // Scoped reads: RLS keeps these inside the organization, so an agreement
    // cannot be attached to another tenant's owner or property.
    const owner = await db.user.findFirst({
      where: { id: input.ownerId },
      select: { id: true },
    });
    if (!owner) {
      return createErrorResponse("Owner not found in this organization", 400);
    }

    if (input.propertyId) {
      // Scoped like the read above: the building id comes from the body.
      const property = await db.property.findFirst({
        where: withScope({ id: input.propertyId }, propertyScope(user)),
        select: { id: true, ownerId: true },
      });
      if (!property) {
        return createErrorResponse("Property not found", 400);
      }
      // An agreement that names a property the owner does not own would never
      // resolve, and would sit in the list looking effective.
      if (property.ownerId !== input.ownerId) {
        return createErrorResponse(
          "That property belongs to a different owner",
          400,
        );
      }
    }

    if (input.compoundId) {
      // Scoped like the building: a compound this caller cannot reach does
      // not resolve.
      const compound = await db.compound.findFirst({
        where: withScope({ id: input.compoundId }, compoundScope(user)),
        select: { id: true },
      });
      if (!compound) {
        return createErrorResponse("Compound not found", 400);
      }
    }

    // The ids are not the whole of it. A compound's agreement, or a blanket
    // one naming neither, governs every building the owner has there, and
    // someone narrowed to a few of them may not write the terms for the rest.
    if (!(await mayWriteAgreement(user, input))) {
      return createErrorResponse(AGREEMENT_WRITE_DENIED, 403);
    }

    if (agreementNumber) {
      const clash = await db.agreement.findFirst({
        where: { agreementNumber, deletedAt: null },
        select: { id: true },
      });
      if (clash) {
        return createErrorResponse(
          "Another agreement already uses this number",
          409,
        );
      }
    }

    // An agreement entered already closed records the day it closed, as
    // closing one does (lib/agreement-closing.ts) — with no date on record it
    // would earn nothing, even for the months it was in force.
    const status = input.status ?? "active";
    const terminatedDate = closingDate(
      { status, endDate: input.endDate ?? null, terminatedDate: null },
      new Date(),
    );

    const created = await db.agreement.create({
      data: {
        organizationId: user.organizationId!,
        kind: input.kind ?? "management",
        agreementNumber,
        ownerId: input.ownerId,
        propertyId: input.propertyId ?? null,
        compoundId: input.compoundId ?? null,
        feeType: input.feeType,
        // Only the fee that applies is stored; the other stays zero so a
        // later switch of fee type cannot silently reuse a stale figure.
        feePercentage:
          input.feeType === "percentage" ? (input.feePercentage ?? 0) : 0,
        feeAmount: input.feeType === "fixed" ? (input.feeAmount ?? 0) : 0,
        feeFrequency: input.feeFrequency ?? "monthly",
        commissionBasis: input.commissionBasis ?? "collected",
        currency: input.currency ?? "SAR",
        startDate: input.startDate,
        endDate: input.endDate ?? null,
        status,
        terminatedDate,
        notes: input.notes ?? null,
        documents: input.documents ?? [],
        createdById: user.id,
      },
      include: AGREEMENT_INCLUDE,
    });

    void recordActivity({
      action: AuditAction.CREATE,
      recordType: "agreement",
      recordId: created.id,
      recordName: agreementName(created),
      after: compact(agreementSnapshot(created)),
    });

    return createSuccessResponse(
      present(created),
      "Agreement created successfully",
    );
  } catch (error) {
    return handleApiError(error, "Failed to create the agreement");
  }
});
