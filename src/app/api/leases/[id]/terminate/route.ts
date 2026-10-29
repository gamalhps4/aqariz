/**
 * PropertyPro - Lease Termination API Route
 * Handle lease termination process with proper notice and documentation
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/prisma";
import { leaseScope } from "@/lib/db/scopes";
import { InvoiceStatus, LeaseStatus, MaintenanceStatus } from "@/types";
import { validateSchema } from "@/lib/validations";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  withAccessAndDB,
  parseRequestBody,
  isValidObjectId,
} from "@/lib/api-utils";
import {
  LEASE_PATCH_ACCESS,
  canManageLeases,
  isLeaseTenantUser,
} from "@/lib/lease-access";
import { changeLeaseStatus } from "@/lib/services/lease-lifecycle.service";
import { postAfterCommit } from "@/lib/accounting/hooks";
import { getOutstandingForLease } from "@/lib/services/lease-installments.service";
import { cancellationRecord, isPastCalendarDay } from "@/lib/lease-lifecycle";

function buildPropertyAddress(property: any) {
  return {
    street: property?.addressStreet,
    city: property?.addressCity,
    state: property?.addressState,
    zipCode: property?.addressZipCode,
    country: property?.addressCountry,
  };
}

const terminateLeaseSchema = z.object({
  terminationDate: z.coerce.date({
    required_error: "Termination date is required",
    invalid_type_error: "Invalid termination date",
  }),
  // Trimmed before the length check: a reason of spaces is not a reason.
  reason: z.string().trim().min(1, "Termination reason is required").max(1000),
  notice: z.string().max(2000).optional(),
  moveOutInspection: z
    .object({
      schedule: z.boolean().optional(),
      date: z.string().max(100).optional(),
    })
    .optional(),
  /**
   * Set once the operator has seen the outstanding-rent warning. Without it a
   * contract carrying a balance is refused, so nobody ends a tenancy without
   * being told money is still owed.
   */
  acknowledgeOutstanding: z.boolean().optional(),
  /**
   * Keep what is already owed as a tenant payable instead of writing it off.
   * Defaults to true: the rent was earned, and a termination is not a reason
   * for it to vanish from the tenant's ledger.
   */
  retainOutstanding: z.boolean().default(true),
});

const TERMINATE_PROPERTY_SELECT = {
  id: true,
  name: true,
  type: true,
  addressStreet: true,
  addressCity: true,
  addressState: true,
  addressZipCode: true,
  addressCountry: true,
} as const;

// ============================================================================
// POST /api/leases/[id]/terminate - Terminate a lease
// ============================================================================

export const POST = withAccessAndDB(LEASE_PATCH_ACCESS)(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    try {
      const { id } = await params;

      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid lease ID", 400);
      }

      const { success, data: body } = await parseRequestBody(request);
      if (!success) {
        return createErrorResponse("Invalid request body", 400);
      }

      const validation = validateSchema(terminateLeaseSchema, body);
      if (!validation.success) {
        return createErrorResponse(validation.errors.join(", "), 400);
      }
      const {
        terminationDate,
        reason,
        notice,
        moveOutInspection,
        acknowledgeOutstanding,
        retainOutstanding,
      } = validation.data;

      // Find the lease
      // Scoped: a lease outside this caller's buildings does not resolve.
      const lease = await db.lease.findFirst({
        where: { id, ...leaseScope(user) },
      });

      if (!lease) {
        return createErrorResponse("Lease not found", 404);
      }

      // Check permissions
      const canTerminate =
        canManageLeases(user) || isLeaseTenantUser(user, lease);

      if (!canTerminate) {
        return createErrorResponse("Access denied", 403);
      }

      // Check if lease can be terminated
      if (lease.status !== LeaseStatus.ACTIVE) {
        return createErrorResponse("Only active leases can be terminated", 400);
      }

      // Validate termination date. Day against day: compared as instants,
      // today's own date (midnight) was already "in the past", so the form
      // was refused on the date it opens with.
      const termDate = new Date(terminationDate);
      const today = new Date();

      if (isPastCalendarDay(termDate, today)) {
        return createErrorResponse(
          "Termination date cannot be in the past",
          400
        );
      }

      // Check notice period (typically 30 days)
      const noticeRequired = 30; // days
      const noticePeriod = Math.ceil(
        (termDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
      );

      if (noticePeriod < noticeRequired && user.isTenant) {
        return createErrorResponse(
          `Minimum ${noticeRequired} days notice required`,
          400
        );
      }

      // Validate required fields
      if (!reason) {
        return createErrorResponse("Termination reason is required", 400);
      }

      // Outstanding rent warning. Ending a tenancy is the last moment the
      // office can act on unpaid rent, so a contract carrying a balance is
      // refused until the caller has been shown the figure and confirmed.
      // The GET on this route returns the same figures, so the UI can show
      // the warning before the operator ever gets here.
      const outstanding = await getOutstandingForLease(id, termDate);
      if (outstanding.outstandingTotal > 0 && !acknowledgeOutstanding) {
        return createErrorResponse(
          `This contract has ${outstanding.outstandingTotal} ${outstanding.currency} outstanding across ${outstanding.openInstallments} installment(s), ${outstanding.overdueCount} of them overdue. Confirm to terminate anyway.`,
          409,
          undefined,
          "OUTSTANDING_BALANCE"
        );
      }

      // Terminate the lease atomically with its side effects: lease status,
      // unit back to available (unless another contract holds it), payment
      // cascade, and maintenance closure all commit or roll back together.
      // Previously these were four separate writes with swallowed errors — a
      // mid-flight failure left the lease TERMINATED, the unit occupied, and
      // payments open while the API reported success. The change itself goes
      // through the transition table like every other.
      //
      // `retainOutstanding` keeps rent that was already earned owed by the
      // tenant. The default cascade cancels every open payment, which is
      // right for charges covering time after the tenancy ends and wrong for
      // the ones the tenant genuinely owes.
      const cancelledInstallmentIds: string[] = [];
      const { lease: terminated } = await changeLeaseStatus({
        lease,
        to: LeaseStatus.TERMINATED,
        data: {
          // When, by whom and why — the same record every cancel path
          // writes; this route is the one that knows all three.
          ...cancellationRecord({
            previousStatus: lease.status,
            userId: user.id,
            date: termDate,
            reason,
          }),
          ...(notice ? { terminationNotice: notice } : {}),
        },
        cancelPaymentsFrom: retainOutstanding ? termDate : undefined,
        audit: {
          details: {
            retainOutstanding: Boolean(retainOutstanding),
            outstandingAtTermination: outstanding.outstandingTotal,
            currency: outstanding.currency,
          },
        },
        alsoInTransaction: async (tx) => {
          // Installments covering time after the termination date are never
          // owed — the tenancy will not exist for those periods.
          //
          // What happens to the rest is the caller's decision:
          // `retainOutstanding` (the default) leaves rent already earned open
          // as a tenant payable; clearing it writes the whole balance off.
          // Either way an installment that has taken money is left alone —
          // cancelling it would erase a real payment from the ledger.
          const cancelWhere = {
            leaseId: id,
            deletedAt: null,
            status: {
              in: [
                InvoiceStatus.SCHEDULED,
                InvoiceStatus.ISSUED,
                InvoiceStatus.OVERDUE,
              ],
            },
            amountPaid: 0,
            ...(retainOutstanding
              ? {
                  OR: [
                    { periodStart: { gte: termDate } },
                    { periodStart: null, dueDate: { gte: termDate } },
                  ],
                }
              : {}),
          };
          // Read first: a cancelled installment comes off the books once
          // this commits.
          const cancelling = await tx.invoice.findMany({
            where: cancelWhere,
            select: { id: true },
          });
          cancelledInstallmentIds.push(...cancelling.map((invoice) => invoice.id));
          await tx.invoice.updateMany({
            where: cancelWhere,
            data: { status: InvoiceStatus.CANCELLED, balanceRemaining: 0 },
          });

          // Close any open maintenance requests for this tenant on the property
          await tx.maintenanceRequest.updateMany({
            where: {
              propertyId: lease.propertyId,
              tenantId: lease.tenantId,
              status: {
                in: [
                  MaintenanceStatus.SUBMITTED,
                  MaintenanceStatus.ASSIGNED,
                  MaintenanceStatus.IN_PROGRESS,
                ],
              },
              deletedAt: null,
            },
            data: {
              status: MaintenanceStatus.CANCELLED,
              notes: "Lease terminated - maintenance request cancelled",
            },
          });
        },
      });

      postAfterCommit("invoice", cancelledInstallmentIds, { userId: user.id });

      // Schedule move-out inspection if requested
      if (moveOutInspection?.schedule) {
        // In a real implementation, this would create an inspection record
        // For now, we'll add it to the lease notes
        await db.lease.update({
          where: { id },
          data: {
            notes:
              (terminated.notes || "") +
              `\nMove-out inspection scheduled for ${moveOutInspection.date}`,
          },
        });
      }

      // Fetch the response payload with tenant/property information
      const populated = await db.lease.findFirst({
        where: { id },
        include: {
          tenant: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
          property: { select: TERMINATE_PROPERTY_SELECT },
        },
      });

      const { tenant, property, ...rest } = (populated ?? terminated) as any;
      const responseLease = {
        ...rest,
        tenantId: tenant ?? rest.tenantId,
        propertyId: property
          ? { ...property, address: buildPropertyAddress(property) }
          : rest.propertyId,
      };

      return createSuccessResponse(
        {
          lease: responseLease,
          terminationDetails: {
            terminatedBy: user.id,
            terminationDate: termDate,
            reason,
            notice,
            propertyStatusUpdated: true,
            maintenanceRequestsClosed: true,
            // Explicit so the caller can tell the tenant what is still owed
            // rather than assuming termination cleared the balance.
            outstandingRetained: retainOutstanding
              ? outstanding.outstandingTotal
              : 0,
            futureInstallmentsCancelled: outstanding.futureInstallments,
            currency: outstanding.currency,
          },
        },
        "Lease terminated successfully"
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);

// ============================================================================
// GET /api/leases/[id]/terminate - Get lease termination information
// ============================================================================

export const GET = withAccessAndDB(LEASE_PATCH_ACCESS)(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    try {
      const { id } = await params;

      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid lease ID", 400);
      }

      // Find the lease. Scoped like the POST above — reading a contract's
      // termination figures is reading the contract.
      const lease = await db.lease.findFirst({
        where: { id, ...leaseScope(user) },
        include: {
          tenant: true,
          property: { select: TERMINATE_PROPERTY_SELECT },
        },
      });

      if (!lease) {
        return createErrorResponse("Lease not found", 404);
      }

      // Check permissions
      const canView = canManageLeases(user) || isLeaseTenantUser(user, lease);

      if (!canView) {
        return createErrorResponse("Access denied", 403);
      }

      // Calculate termination information
      const today = new Date();
      const leaseEndDate = new Date(lease.endDate);
      const daysUntilExpiration = Math.ceil(
        (leaseEndDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
      );

      const terms = lease.terms as any;

      // Split at the requested termination date when the caller supplies one
      // (the dialog passes the date the operator picked), otherwise today.
      const requestedDate = request.nextUrl.searchParams.get("terminationDate");
      const cutoff = requestedDate ? new Date(requestedDate) : today;
      const outstanding = await getOutstandingForLease(
        lease.id,
        Number.isFinite(cutoff.getTime()) ? cutoff : today
      );

      const terminationInfo = {
        leaseId: lease.id,
        status: lease.status,
        contractNumber: lease.contractNumber,
        canTerminate: lease.status === LeaseStatus.ACTIVE,
        isExpired: daysUntilExpiration <= 0,
        daysUntilExpiration,
        // What the office must be shown before ending the tenancy: rent
        // already earned and still unpaid, plus the installments covering
        // time after the cut-off that will simply be cancelled.
        outstanding,
        requirements: {
          noticeRequired: 30, // days
          reasonRequired: true,
          moveOutInspection: true,
        },
        tenant: {
          name: `${lease.tenant?.firstName ?? ""} ${
            lease.tenant?.lastName ?? ""
          }`.trim(),
          email: lease.tenant?.email,
        },
        property: {
          name: lease.property?.name,
          address: buildPropertyAddress(lease.property),
        },
        terms: {
          startDate: lease.startDate,
          endDate: lease.endDate,
          monthlyRent: terms?.rentAmount,
          securityDeposit: terms?.securityDeposit,
        },
        terminationReasons: [
          "End of lease term",
          "Early termination by tenant",
          "Lease violation",
          "Property sale",
          "Renovation required",
          "Other",
        ],
      };

      return createSuccessResponse({ terminationInfo });
    } catch (error) {
      return handleApiError(error);
    }
  }
);
