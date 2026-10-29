/**
 * PropertyPro - A contract's installments, for recording a payment
 *
 * GET /api/payments/installments?leaseId=…
 *
 * The Record payment dialog on the payments page asks for the contract, then
 * for the installment the money is for. The contract's own schedule endpoint
 * belongs to the lease screens and wants lease rights, so someone who records
 * payments without them — a cashier's permission group — could pick a
 * contract and then find nothing to pay. This is the same schedule, behind
 * the rights that record money, under the caller's scope.
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import { leaseScope, withScope } from "@/lib/db/scopes";
import {
  AuthenticatedAccessUser,
  createErrorResponse,
  createSuccessResponse,
  handleApiError,
  isValidObjectId,
  withPermissionAndDB,
} from "@/lib/api-utils";
import { getInstallmentSchedule } from "@/lib/services/lease-installments.service";

export const GET = withPermissionAndDB([
  "payment_create",
  "payment_processing",
  "financial_management",
])(async (user: AuthenticatedAccessUser, request: NextRequest) => {
  try {
    if (user.isTenant) {
      return createErrorResponse("Access denied", 403);
    }

    const leaseId = new URL(request.url).searchParams.get("leaseId");
    if (!leaseId || !isValidObjectId(leaseId)) {
      return createErrorResponse("Invalid lease ID", 400);
    }

    // A contract in a building this caller does not hold does not resolve,
    // and answers as one that never existed.
    const lease = await db.lease.findFirst({
      where: withScope({ id: leaseId }, leaseScope(user)),
      select: { id: true },
    });
    if (!lease) {
      return createErrorResponse("Lease not found", 404);
    }

    const schedule = await getInstallmentSchedule(lease.id);
    if (!schedule) {
      return createErrorResponse("Lease not found", 404);
    }

    return createSuccessResponse(schedule, "Installments retrieved successfully");
  } catch (error) {
    return handleApiError(error, "Failed to load the installments");
  }
});
