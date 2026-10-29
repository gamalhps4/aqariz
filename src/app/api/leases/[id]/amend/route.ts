/**
 * PropertyPro - Amend a contract whose installments are billed
 *
 * POST /api/leases/[id]/amend
 *
 * The contract's edit (PUT /api/leases/[id]) refuses to change the terms of
 * a contract whose installments are billed. This is the way round it the
 * client asked for: the same fields as the edit form, answered first with a
 * preview — which installments are kept, how many are cancelled, what is
 * billed in their place, and anything that stops the amendment — and then,
 * with `apply`, a reason and the preview's fingerprint, written
 * (lib/services/lease-amendment.service.ts).
 */

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/prisma";
import { leaseScope } from "@/lib/db/scopes";
import {
  AuthenticatedAccessUser,
  createErrorResponse,
  createSuccessResponse,
  handleApiError,
  isValidObjectId,
  parseRequestBody,
  withPermissionAndDB,
} from "@/lib/api-utils";
import { leaseUpdateSchema, validateSchema } from "@/lib/validations";
import {
  EDIT_INSTALLMENT_PERMISSIONS,
  contractRights,
} from "@/lib/contract-rights";
import {
  LeaseAmendmentError,
  amendLease,
} from "@/lib/services/lease-amendment.service";

const amendSchema = leaseUpdateSchema.extend({
  /** False (the default) previews; true writes. */
  apply: z.boolean().default(false),
  /** Why the terms change — kept with the contract's amendment history. */
  reason: z.string().trim().max(1000).optional(),
  /** The preview the operator confirmed. */
  fingerprint: z.string().max(64).optional(),
});

export const POST = withPermissionAndDB([...EDIT_INSTALLMENT_PERMISSIONS])(
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

      if (!contractRights(user).amendTerms) {
        return createErrorResponse(
          "Amending a contract's terms needs the right to edit invoices as well as contracts.",
          403
        );
      }

      const { success, data: body, error } = await parseRequestBody(request);
      if (!success) return createErrorResponse(error!, 400);

      // As the edit's own route reads it: the schema's defaults make its
      // input and output types differ, which validateSchema does not model.
      const validation = validateSchema(amendSchema as any, body);
      if (!validation.success) {
        return createErrorResponse(validation.errors.join(", "), 400);
      }
      const { apply, reason, fingerprint, ...edit } =
        validation.data as z.infer<typeof amendSchema>;
      // A status change is not an amendment: it has its own routes.
      delete (edit as Record<string, unknown>).status;

      if (apply && (!reason || reason.length < 3)) {
        return createErrorResponse(
          "Say why the contract's terms change.",
          400
        );
      }

      const lease = await db.lease.findFirst({
        where: { id, ...leaseScope(user) },
      });
      if (!lease) return createErrorResponse("Lease not found", 404);

      const result = await amendLease({
        user,
        lease,
        edit,
        apply,
        reason,
        fingerprint,
      });

      return createSuccessResponse(
        result,
        apply ? "Contract amended" : "Amendment preview"
      );
    } catch (error) {
      if (error instanceof LeaseAmendmentError) {
        return NextResponse.json(
          {
            success: false,
            error: error.message,
            code: error.code,
            data: error.preview ? { preview: error.preview } : undefined,
          },
          { status: error.status }
        );
      }
      return handleApiError(error);
    }
  }
);
