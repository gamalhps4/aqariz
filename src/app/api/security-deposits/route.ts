/**
 * PropertyPro - Security Deposits API
 * CRUD endpoints for security deposit tracking
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/prisma";
import { applyScope, securityDepositScope, leaseScope } from "@/lib/db/scopes";
import { Prisma } from "@/generated/prisma/client";
import { SecurityDepositStatus } from "@/types";
import { validateSchema } from "@/lib/validations";
import { AuditAction, recordActivity } from "@/lib/audit-domain";
import { depositSnapshot, depositTenantName } from "@/lib/audit/records/deposit";
import { compact } from "@/lib/audit/records/shared";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  withPermissionAndDB,
} from "@/lib/api-utils";

const depositCreateSchema = z.object({
  leaseId: z.string().min(1, "Lease ID is required"),
  // coerce: UI may send string amounts; garbage like "12abc" must 400.
  amount: z.coerce
    .number({ invalid_type_error: "Valid amount is required" })
    .finite()
    .positive("Valid amount is required"),
  notes: z.string().max(2000, "Notes too long").optional(),
});

const DEPOSIT_INCLUDE = {
  tenant: {
    select: { id: true, firstName: true, lastName: true, email: true },
  },
  property: { select: { id: true, name: true } },
  lease: {
    select: { id: true, startDate: true, endDate: true, status: true },
  },
} as const;

/** Restore the old populated shape (tenantId/propertyId/leaseId objects). */
function mapDepositForResponse(deposit: any) {
  const { tenant, property, lease, ...rest } = deposit;
  return {
    ...rest,
    tenantId: tenant ?? rest.tenantId,
    propertyId: property ?? rest.propertyId,
    leaseId: lease ?? rest.leaseId,
  };
}

// ============================================================================
// GET /api/security-deposits - List security deposits
// ============================================================================
export const GET = withPermissionAndDB("financial_management")(async (
  user: AuthenticatedAccessUser,
  request: NextRequest
) => {
  try {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId");
    const propertyId = searchParams.get("propertyId");
    const leaseId = searchParams.get("leaseId");
    const status = searchParams.get("status");
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "20");

    const where: Prisma.SecurityDepositWhereInput = { deletedAt: null };

    // Filtering by tenant is a staff query; a tenant's own scope is applied
    // below and cannot be widened by it. See lib/db/scopes.ts.
    if (!user.isTenant && tenantId) {
      where.tenantId = tenantId;
    }
    applyScope(where, securityDepositScope(user));

    if (propertyId) where.propertyId = propertyId;
    if (leaseId) where.leaseId = leaseId;
    if (status) where.status = status;

    const skip = (page - 1) * limit;
    const [deposits, total, summaryGroups] = await Promise.all([
      db.securityDeposit.findMany({
        where,
        include: DEPOSIT_INCLUDE,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      db.securityDeposit.count({ where }),
      db.securityDeposit.groupBy({
        by: ["status"],
        where,
        _sum: { amount: true, refundAmount: true },
        _count: { _all: true },
      }),
    ]);

    // Summary stats (was a Mongo aggregation pipeline)
    const summary = summaryGroups.reduce(
      (acc, group) => {
        acc.totalDeposits += group._sum.amount ?? 0;
        acc.totalRefunded += group._sum.refundAmount ?? 0;
        if (group.status === SecurityDepositStatus.COLLECTED) {
          acc.totalHeld += group._sum.amount ?? 0;
          acc.heldCount += group._count._all;
        }
        if (group.status === SecurityDepositStatus.PENDING) {
          acc.pendingCount += group._count._all;
        }
        return acc;
      },
      {
        totalDeposits: 0,
        totalHeld: 0,
        totalRefunded: 0,
        pendingCount: 0,
        heldCount: 0,
      }
    );

    return createSuccessResponse(
      {
        deposits: deposits.map(mapDepositForResponse),
        summary,
      },
      undefined,
      {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      } as any
    );
  } catch (error) {
    return handleApiError(error);
  }
});

// ============================================================================
// POST /api/security-deposits - Create a security deposit record
// ============================================================================
export const POST = withPermissionAndDB("financial_management")(
  async (user: any, request: NextRequest) => {
    try {
      const body = await request.json();

      const validation = validateSchema(depositCreateSchema, body);
      if (!validation.success) {
        return createErrorResponse(validation.errors.join(", "), 400);
      }
      const { leaseId, amount, notes } = validation.data;

      // Get lease details
      // Scoped: the id arrives in the request body, so this is what stops
      // a narrowed caller attaching a record to a building they were
      // not given.
      const lease = await db.lease.findFirst({
        where: { id: leaseId, ...leaseScope(user) },
      });
      if (!lease) {
        return createErrorResponse("Lease not found", 404);
      }

      // Check for existing deposit on this lease
      const existing = await db.securityDeposit.findFirst({
        where: { leaseId: lease.id, deletedAt: null },
      });
      if (existing) {
        return createErrorResponse(
          "A security deposit already exists for this lease",
          409
        );
      }

      const deposit = await db.securityDeposit.create({
        data: {
          organizationId: lease.organizationId,
          leaseId: lease.id,
          tenantId: lease.tenantId,
          propertyId: lease.propertyId,
          unitId: lease.unitId,
          amount,
          status: SecurityDepositStatus.PENDING,
          notes,
        },
      });

      const populated = await db.securityDeposit.findFirst({
        where: { id: deposit.id },
        include: {
          tenant: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
          property: { select: { id: true, name: true } },
        },
      });

      // Named by the tenant who pays it; the contract's number and the
      // building ride in the entry's values.
      const tenantName = depositTenantName(populated);
      void recordActivity({
        action: AuditAction.CREATE,
        recordType: "deposit",
        recordId: deposit.id,
        recordName: tenantName,
        after: compact(
          depositSnapshot(deposit, {
            tenantName,
            propertyName: populated?.property?.name ?? null,
            contractNumber: lease.contractNumber ?? null,
          })
        ),
      });

      return createSuccessResponse(
        mapDepositForResponse(populated ?? deposit),
        "Security deposit created"
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);
