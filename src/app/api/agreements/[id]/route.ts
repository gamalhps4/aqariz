/**
 * PropertyPro - Single agreement API
 *
 * PATCH edits the terms; DELETE archives. Closing is an edit that sets
 * `status: "terminated"` or `"expired"`, and records the day it closed where
 * nothing on record says so yet (lib/agreement-closing.ts) — commission then
 * stops accruing from that date, and everything already earned stays on the
 * record. Archiving terminates it the same way.
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
  compoundScope,
  propertyAllows,
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
  parseRequestBody,
  isValidObjectId,
} from "@/lib/api-utils";
import { agreementUpdateSchema, validateSchema } from "@/lib/validations";
import { closingDate } from "@/lib/agreement-closing";
import { AuditAction, auditRecordChange } from "@/lib/audit-domain";
import {
  AGREEMENT_CHANGE_KEYS,
  agreementName,
  agreementSnapshot,
} from "@/lib/audit/records/agreement";
import { statusMove } from "@/lib/audit/records/shared";
import {
  feeLabel,
  propertiesUnderAgreement,
  type AgreementRow,
} from "@/lib/services/agreement.service";

const AGREEMENT_INCLUDE = {
  owner: { select: { id: true, firstName: true, lastName: true, email: true } },
  property: { select: { id: true, name: true } },
  compound: { select: { id: true, name: true } },
} as const;

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
  "financial_management",
  "property_management",
])(
  async (
    user: AuthenticatedAccessUser,
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    try {
      const { id } = await params;
      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid agreement ID", 400);
      }

      // Scoped like the list: an agreement this caller could not have been
      // shown there does not resolve here either, and the 404 below answers.
      const agreement = await db.agreement.findFirst({
        where: withScope({ id }, agreementScope(user)),
        include: AGREEMENT_INCLUDE,
      });
      if (!agreement) {
        return createErrorResponse("Agreement not found", 404);
      }

      // Which properties this agreement actually governs today — a blanket
      // agreement's reach is not obvious from its own row. Narrowed to the
      // ones this caller holds: a compound's or an owner's agreement reaches
      // buildings an employee assigned one of them was never given.
      const covers = (await propertiesUnderAgreement(id)).filter((property) =>
        propertyAllows(user, property),
      );

      return createSuccessResponse(
        { ...present(agreement), covers },
        "Agreement retrieved successfully",
      );
    } catch (error) {
      return handleApiError(error, "Failed to retrieve the agreement");
    }
  },
);

export const PATCH = withPermissionAndDB([
  "agreement_edit",
  "agreement_management",
])(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    try {
      const { id } = await params;
      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid agreement ID", 400);
      }

      // Scoped: the update below is keyed on the id from the URL. Read with
      // its owner, building and compound so the entry can name them.
      const existing = await db.agreement.findFirst({
        where: withScope({ id }, agreementScope(user)),
        include: AGREEMENT_INCLUDE,
      });
      if (!existing) {
        return createErrorResponse("Agreement not found", 404);
      }
      // Reading it is not the right to change it: a compound's or an owner's
      // blanket agreement also governs buildings this caller may not hold.
      if (!(await mayWriteAgreement(user, existing))) {
        return createErrorResponse(AGREEMENT_WRITE_DENIED, 403);
      }

      const { success, data: body } = await parseRequestBody(request);
      if (!success) {
        return createErrorResponse("Invalid request body", 400);
      }

      const validation = validateSchema(agreementUpdateSchema, body);
      if (!validation.success) {
        return createErrorResponse(validation.errors.join(", "), 400);
      }
      const input = validation.data;

      // Cross-field rules re-checked against the MERGED record, not just the
      // patch: sending only a compoundId onto an agreement that already names
      // a property would otherwise slip past.
      const propertyId =
        input.propertyId !== undefined ? input.propertyId : existing.propertyId;
      const compoundId =
        input.compoundId !== undefined ? input.compoundId : existing.compoundId;
      if (propertyId && compoundId) {
        return createErrorResponse(
          "An agreement covers a property or a compound, not both",
          400,
        );
      }

      // A building or compound the edit moves the agreement onto is a
      // requested id like the one in the URL, and is scoped the way POST
      // scopes it. They used to be written to the row unchecked. Only a
      // *change* is looked up: the form sends the ids back as they were, and
      // an agreement whose building has since been archived must stay
      // editable.
      const moved =
        propertyId !== existing.propertyId ||
        compoundId !== existing.compoundId;
      if (propertyId && propertyId !== existing.propertyId) {
        const property = await db.property.findFirst({
          where: withScope({ id: propertyId }, propertyScope(user)),
          select: { ownerId: true },
        });
        if (!property) {
          return createErrorResponse("Property not found", 400);
        }
        if (property.ownerId !== existing.ownerId) {
          return createErrorResponse(
            "That property belongs to a different owner",
            400,
          );
        }
      }
      if (compoundId && compoundId !== existing.compoundId) {
        const compound = await db.compound.findFirst({
          where: withScope({ id: compoundId }, compoundScope(user)),
          select: { id: true },
        });
        if (!compound) {
          return createErrorResponse("Compound not found", 400);
        }
      }
      // And what the agreement would cover after the move has to be the
      // caller's to write as well — clearing the building turns it into the
      // owner's blanket agreement.
      if (
        moved &&
        !(await mayWriteAgreement(user, {
          ownerId: existing.ownerId,
          propertyId,
          compoundId,
        }))
      ) {
        return createErrorResponse(AGREEMENT_WRITE_DENIED, 403);
      }

      const startDate = input.startDate ?? existing.startDate;
      const endDate =
        input.endDate !== undefined ? input.endDate : existing.endDate;
      if (endDate && endDate <= startDate) {
        return createErrorResponse(
          "End date must be after the start date",
          400,
        );
      }

      const feeType = input.feeType ?? existing.feeType;
      // The kind is fixed at creation, and an investment agreement's rent is
      // always a fixed amount.
      if (existing.kind === "investment" && feeType !== "fixed") {
        return createErrorResponse(
          "An investment agreement pays the owner a fixed amount, not a percentage",
          400,
        );
      }
      const feePercentage =
        input.feePercentage ?? Number(existing.feePercentage);
      const feeAmount = input.feeAmount ?? Number(existing.feeAmount);
      if (feeType === "percentage" && feePercentage <= 0) {
        return createErrorResponse(
          "A percentage fee needs a rate above zero",
          400,
        );
      }
      if (feeType === "fixed" && feeAmount <= 0) {
        return createErrorResponse(
          "A fixed fee needs an amount above zero",
          400,
        );
      }

      if (input.agreementNumber) {
        const clash = await db.agreement.findFirst({
          where: {
            agreementNumber: input.agreementNumber.trim(),
            deletedAt: null,
            id: { not: id },
          },
          select: { id: true },
        });
        if (clash) {
          return createErrorResponse(
            "Another agreement already uses this number",
            409,
          );
        }
      }

      const data: Prisma.AgreementUncheckedUpdateInput = {
        ...(input.agreementNumber !== undefined
          ? { agreementNumber: input.agreementNumber?.trim() || null }
          : {}),
        ...(input.propertyId !== undefined ? { propertyId } : {}),
        ...(input.compoundId !== undefined ? { compoundId } : {}),
        ...(input.feeType !== undefined ? { feeType } : {}),
        // Whichever fee does not apply is zeroed, so switching type can never
        // leave a stale figure that a later switch back would resurrect.
        ...(input.feeType !== undefined ||
        input.feePercentage !== undefined ||
        input.feeAmount !== undefined
          ? {
              feePercentage: feeType === "percentage" ? feePercentage : 0,
              feeAmount: feeType === "fixed" ? feeAmount : 0,
            }
          : {}),
        ...(input.feeFrequency !== undefined
          ? { feeFrequency: input.feeFrequency }
          : {}),
        ...(input.commissionBasis !== undefined
          ? { commissionBasis: input.commissionBasis }
          : {}),
        ...(input.currency !== undefined ? { currency: input.currency } : {}),
        ...(input.startDate !== undefined ? { startDate } : {}),
        ...(input.endDate !== undefined ? { endDate } : {}),
        ...(input.notes !== undefined ? { notes: input.notes || null } : {}),
        ...(input.documents !== undefined ? { documents: input.documents } : {}),
      };

      if (input.status !== undefined) {
        data.status = input.status;
        if (input.status === "active") {
          data.terminatedDate = null;
        }
      }

      // Closing stamps the day commission stops accruing from: an agreement
      // marked expired or terminated with no date on record earns nothing,
      // not even for the months it was in force. Asked when the status
      // changes, or the end date does — the form sends both on every save,
      // and an unrelated edit must not date an old row "today".
      const status = input.status ?? existing.status;
      const endChanged =
        (endDate?.getTime() ?? null) !== (existing.endDate?.getTime() ?? null);
      if (status !== existing.status || endChanged) {
        const closedOn = closingDate(
          {
            status,
            endDate,
            terminatedDate:
              status === "active" ? null : existing.terminatedDate,
          },
          new Date(),
        );
        if (closedOn) data.terminatedDate = closedOn;
      }

      const updated = await db.agreement.update({
        where: { id },
        data,
        include: AGREEMENT_INCLUDE,
      });

      // Closing — terminated or expired — is an edit of the status too.
      const before = agreementSnapshot(existing);
      const after = agreementSnapshot(updated);
      const move = statusMove(before, after);
      auditRecordChange({
        action: move ? AuditAction.STATUS_CHANGED : AuditAction.UPDATE,
        recordType: "agreement",
        recordId: id,
        recordName: agreementName(updated),
        before,
        after,
        keys: AGREEMENT_CHANGE_KEYS,
        messageParams: move ?? undefined,
      });

      return createSuccessResponse(
        present(updated),
        "Agreement updated successfully",
      );
    } catch (error) {
      return handleApiError(error, "Failed to update the agreement");
    }
  },
);

export const DELETE = withPermissionAndDB([
  "agreement_delete",
  "agreement_management",
])(
  async (
    user: AuthenticatedAccessUser,
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    try {
      const { id } = await params;
      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid agreement ID", 400);
      }

      // Scoped: the archive below is keyed on the id from the URL.
      const agreement = await db.agreement.findFirst({
        where: withScope({ id }, agreementScope(user)),
        select: {
          id: true,
          agreementNumber: true,
          ownerId: true,
          propertyId: true,
          compoundId: true,
          status: true,
          endDate: true,
          terminatedDate: true,
        },
      });
      if (!agreement) {
        return createErrorResponse("Agreement not found", 404);
      }
      // As in PATCH: reading it is not the right to end it.
      if (!(await mayWriteAgreement(user, agreement))) {
        return createErrorResponse(AGREEMENT_WRITE_DENIED, 403);
      }

      // Archived, not erased: what the office was owed under this agreement
      // is commercial history, and past statements must still reconcile.
      // Archiving terminates it, so it records the day it did — without one,
      // restored, it would earn nothing for any period.
      const now = new Date();
      const closedOn = closingDate(
        {
          status: "terminated",
          endDate: agreement.endDate,
          terminatedDate: agreement.terminatedDate,
        },
        now,
      );
      await db.agreement.update({
        where: { id },
        data: {
          deletedAt: now,
          status: "terminated",
          ...(closedOn ? { terminatedDate: closedOn } : {}),
        },
      });

      // Archiving ends the agreement: it reads as terminated from the day it closed.
      auditRecordChange({
        action: AuditAction.ARCHIVE,
        recordType: "agreement",
        recordId: id,
        recordName: agreement.agreementNumber,
        before: {
          status: agreement.status,
          terminatedDate: agreement.terminatedDate,
        },
        after: {
          status: "terminated",
          terminatedDate: closedOn ?? agreement.terminatedDate,
        },
        keys: ["status", "terminatedDate"],
      });

      return createSuccessResponse(
        { id },
        "Agreement archived — past commission remains on record",
      );
    } catch (error) {
      return handleApiError(error, "Failed to archive the agreement");
    }
  },
);
