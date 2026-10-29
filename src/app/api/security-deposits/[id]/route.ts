/**
 * PropertyPro - Security Deposit Detail API
 * Individual deposit operations: get, update, deductions, refund
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/prisma";
import { securityDepositAllows, securityDepositScope } from "@/lib/db/scopes";
import { Prisma } from "@/generated/prisma/client";
import { SecurityDepositStatus, DeductionCategory } from "@/types";
import { postAfterCommit } from "@/lib/accounting/hooks";
import { planDepositCollection } from "@/lib/accounting/deposit-installment";
import { depositInstallmentsByLease } from "@/lib/accounting/deposit-installment.service";
import { validateSchema } from "@/lib/validations";
import { AuditAction, auditRecordChange, recordActivity } from "@/lib/audit-domain";
import {
  depositEntry,
  depositSnapshot,
  depositTenantName,
} from "@/lib/audit/records/deposit";
import { compact } from "@/lib/audit/records/shared";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  withPermissionAndDB,
} from "@/lib/api-utils";

const collectSchema = z.object({
  paymentId: z.string().min(1).optional(),
  notes: z.string().max(2000, "Notes too long").optional(),
});

const addDeductionSchema = z.object({
  category: z.nativeEnum(DeductionCategory, {
    errorMap: () => ({ message: "Valid category is required" }),
  }),
  description: z.string().min(1, "Description is required").max(500),
  // coerce: UI may send string amounts; garbage like "12abc" must 400.
  amount: z.coerce
    .number({ invalid_type_error: "Valid amount is required" })
    .finite()
    .positive("Valid amount is required"),
  photos: z.array(z.string()).optional(),
});

const removeDeductionSchema = z.object({
  deductionId: z.string().min(1, "Deduction ID is required"),
});

const refundSchema = z.object({
  refundMethod: z.string().min(1, "Refund method is required"),
  refundNotes: z.string().max(2000, "Notes too long").optional(),
  refundPaymentId: z.string().min(1).optional(),
});

const updateNotesSchema = z.object({
  notes: z.string().max(2000, "Notes too long").optional(),
});

const PAYMENT_SELECT = {
  id: true,
  amount: true,
  paidDate: true,
  paymentMethod: true,
} as const;

function sumDeductions(deductions: unknown): number {
  return (((deductions as any[]) ?? []) as any[]).reduce(
    (sum: number, d: any) => sum + (d?.amount ?? 0),
    0
  );
}

// ============================================================================
// GET /api/security-deposits/[id] - Get deposit details
// ============================================================================
export const GET = withPermissionAndDB("financial_management")(async (
  user: AuthenticatedAccessUser,
  request: NextRequest,
  context: any
) => {
  try {
    const { id } = await context.params;

    const deposit = await db.securityDeposit.findFirst({
      where: { id, deletedAt: null, ...securityDepositScope(user) },
      include: {
        tenant: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
          },
        },
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
        lease: {
          select: {
            id: true,
            startDate: true,
            endDate: true,
            status: true,
            terms: true,
          },
        },
      },
    });

    if (!deposit) {
      return createErrorResponse("Security deposit not found", 404);
    }

    // See lib/db/scopes.ts.
    if (!securityDepositAllows(user, deposit)) {
      return createErrorResponse("Access denied", 403);
    }

    // Populate the linked payments (plain string columns, was Mongoose populate)
    const [collectedPayment, refundPayment] = await Promise.all([
      deposit.collectedPaymentId
        ? db.payment.findFirst({
            where: { id: deposit.collectedPaymentId },
            select: PAYMENT_SELECT,
          })
        : null,
      deposit.refundPaymentId
        ? db.payment.findFirst({
            where: { id: deposit.refundPaymentId },
            select: PAYMENT_SELECT,
          })
        : null,
    ]);

    const { tenant, property, lease, ...rest } = deposit as any;
    const responseDeposit = {
      ...rest,
      tenantId: tenant ?? rest.tenantId,
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
        : rest.propertyId,
      leaseId: lease ?? rest.leaseId,
      collectedPaymentId: collectedPayment ?? rest.collectedPaymentId,
      refundPaymentId: refundPayment ?? rest.refundPaymentId,
    };

    return createSuccessResponse(responseDeposit);
  } catch (error) {
    return handleApiError(error);
  }
});

// ============================================================================
// PUT /api/security-deposits/[id] - Update deposit (status, notes, deductions)
// ============================================================================
export const PUT = withPermissionAndDB("financial_management")(
  async (user: any, request: NextRequest, context: any) => {
    try {
      const { id } = await context.params;
      const body = await request.json();
      const { action } = body;

      const deposit = await db.securityDeposit.findFirst({
        where: { id, deletedAt: null, ...securityDepositScope(user) },
      });
      if (!deposit) {
        return createErrorResponse("Security deposit not found", 404);
      }

      switch (action) {
        case "collect": {
          if (deposit.status !== SecurityDepositStatus.PENDING) {
            return createErrorResponse(
              "Deposit can only be collected when pending",
              400
            );
          }
          const validation = validateSchema(collectSchema, body);
          if (!validation.success) {
            return createErrorResponse(validation.errors.join(", "), 400);
          }
          const { paymentId, notes } = validation.data;
          // Billed as an installment, the deposit is collected with the
          // payment that paid it, which already put it in the books; linking
          // it is what stops the record posting it a second time.
          const installments = (
            await depositInstallmentsByLease([deposit.leaseId])
          ).get(deposit.leaseId);
          const collection = planDepositCollection({
            paid: installments?.paid ?? [],
            openInstallment: installments?.open ?? false,
            requestedPaymentId: paymentId,
            now: new Date(),
          });
          if (collection.action === "refuse") {
            return createErrorResponse(
              collection.code === "DEPOSIT_INSTALLMENT_UNPAID"
                ? "This deposit is billed as an installment that is not paid yet. Record the payment on the installment first."
                : "That payment did not pay this contract's deposit.",
              collection.code === "DEPOSIT_INSTALLMENT_UNPAID" ? 409 : 400,
              undefined,
              collection.code,
            );
          }
          await db.securityDeposit.update({
            where: { id },
            data: {
              status: SecurityDepositStatus.COLLECTED,
              ...(collection.action === "link"
                ? {
                    collectedDate: collection.collectedDate,
                    collectedPaymentId: collection.paymentId,
                  }
                : { collectedDate: new Date() }),
              ...(notes ? { notes } : {}),
            },
          });
          break;
        }

        case "add-deduction": {
          if (deposit.status !== SecurityDepositStatus.COLLECTED) {
            return createErrorResponse(
              "Deductions can only be added to collected deposits",
              400
            );
          }
          const validation = validateSchema(addDeductionSchema, body);
          if (!validation.success) {
            return createErrorResponse(validation.errors.join(", "), 400);
          }
          const { category, description, amount, photos } = validation.data;
          // Enforce sum(deductions) <= deposit amount before appending
          const totalDeductions = sumDeductions(deposit.deductions) + amount;
          if (totalDeductions > deposit.amount) {
            return createErrorResponse(
              "Total deductions cannot exceed deposit amount",
              400
            );
          }
          await db.securityDeposit.update({
            where: { id },
            data: {
              deductions: [
                ...(((deposit.deductions as any[]) ?? []) as any[]),
                {
                  id: crypto.randomUUID(),
                  category,
                  description,
                  amount,
                  photos: photos || [],
                  createdAt: new Date(),
                },
              ] as Prisma.InputJsonValue,
            },
          });
          break;
        }

        case "remove-deduction": {
          const validation = validateSchema(removeDeductionSchema, body);
          if (!validation.success) {
            return createErrorResponse(validation.errors.join(", "), 400);
          }
          const { deductionId } = validation.data;
          await db.securityDeposit.update({
            where: { id },
            data: {
              deductions: (((deposit.deductions as any[]) ?? []) as any[]).filter(
                (d: any) => (d?.id ?? d?._id) !== deductionId
              ) as Prisma.InputJsonValue,
            },
          });
          break;
        }

        case "refund": {
          if (deposit.status !== SecurityDepositStatus.COLLECTED) {
            return createErrorResponse(
              "Only collected deposits can be refunded",
              400
            );
          }
          const validation = validateSchema(refundSchema, body);
          if (!validation.success) {
            return createErrorResponse(validation.errors.join(", "), 400);
          }
          const { refundMethod, refundNotes, refundPaymentId } = validation.data;

          const totalDed = sumDeductions(deposit.deductions);
          const refundAmount = deposit.amount - totalDed;

          let status: string;
          let finalRefundAmount: number;
          if (refundAmount <= 0) {
            status = SecurityDepositStatus.FORFEITED;
            finalRefundAmount = 0;
          } else if (totalDed > 0) {
            status = SecurityDepositStatus.PARTIALLY_REFUNDED;
            finalRefundAmount = refundAmount;
          } else {
            status = SecurityDepositStatus.FULLY_REFUNDED;
            finalRefundAmount = refundAmount;
          }

          await db.securityDeposit.update({
            where: { id },
            data: {
              status,
              refundAmount: finalRefundAmount,
              refundDate: new Date(),
              refundMethod,
              ...(refundNotes ? { refundNotes } : {}),
              ...(refundPaymentId ? { refundPaymentId } : {}),
            },
          });
          break;
        }

        case "update-notes": {
          const validation = validateSchema(updateNotesSchema, body);
          if (!validation.success) {
            return createErrorResponse(validation.errors.join(", "), 400);
          }
          if (validation.data.notes !== undefined) {
            await db.securityDeposit.update({
              where: { id },
              data: { notes: validation.data.notes },
            });
          }
          break;
        }

        default:
          return createErrorResponse(
            "Invalid action. Use: collect, add-deduction, remove-deduction, refund, update-notes",
            400
          );
      }

      // Collecting, refunding (in part or whole) and forfeiting each move
      // the deposit's money on the books.
      postAfterCommit("security_deposit", id, { userId: user.id });

      const updated = await db.securityDeposit.findFirst({
        where: { id, ...securityDepositScope(user) },
        include: {
          tenant: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
          property: { select: { id: true, name: true } },
        },
      });

      // Named by the tenant; collecting, deducting, refunding and the notes
      // each read as what they are (lib/audit/records/deposit.ts).
      if (updated) {
        const entry = depositEntry({
          requestAction: String(action),
          deposit: deposit as unknown as Record<string, unknown>,
          updated: updated as unknown as Record<string, unknown>,
          deductionId:
            typeof body.deductionId === "string" ? body.deductionId : null,
        });
        auditRecordChange({
          action: entry.action,
          recordType: "deposit",
          recordId: id,
          recordName: depositTenantName(updated),
          before: entry.before,
          after: entry.after,
          keys: entry.keys,
          messageKey: entry.messageKey,
          messageParams: entry.messageParams,
        });
      }

      const { tenant, property, ...rest } = (updated ?? {}) as any;
      const responseDeposit = updated
        ? {
            ...rest,
            tenantId: tenant ?? rest.tenantId,
            propertyId: property ?? rest.propertyId,
          }
        : updated;

      return createSuccessResponse(responseDeposit, `Deposit ${action} successful`);
    } catch (error) {
      return handleApiError(error);
    }
  }
);

// ============================================================================
// DELETE /api/security-deposits/[id] - Soft delete deposit
// ============================================================================
export const DELETE = withPermissionAndDB("financial_management")(
  async (user: any, _request: NextRequest, context: any) => {
    try {
      const { id } = await context.params;

      // Read with the tenant, so the entry can name the deposit by them.
      const deposit = await db.securityDeposit.findFirst({
        where: { id, deletedAt: null, ...securityDepositScope(user) },
        include: {
          tenant: { select: { firstName: true, lastName: true, email: true } },
        },
      });
      if (!deposit) {
        return createErrorResponse("Security deposit not found", 404);
      }

      await db.securityDeposit.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
      postAfterCommit("security_deposit", id, { userId: user.id });

      void recordActivity({
        action: AuditAction.DELETE,
        recordType: "deposit",
        recordId: id,
        recordName: depositTenantName(deposit),
        before: compact(
          depositSnapshot(deposit as unknown as Record<string, unknown>, {
            tenantName: depositTenantName(deposit),
          })
        ),
      });

      return createSuccessResponse(null, "Security deposit deleted");
    } catch (error) {
      return handleApiError(error);
    }
  }
);
