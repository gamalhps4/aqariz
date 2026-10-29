/**
 * PropertyPro - Suppliers
 * GET  /api/accounting/suppliers?search=  — the office's suppliers
 * POST /api/accounting/suppliers          — add one
 *
 * The minimum an expense needs to name who it was bought from and claim the
 * VAT on it: a name, a VAT number and a phone. A purchases module extends it
 * later. Reading them is part of reading expenses; adding one, of recording
 * an expense.
 */

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import {
  AuthenticatedAccessUser,
  createErrorResponse,
  createSuccessResponse,
  handleApiError,
  withPermissionAndDB,
} from "@/lib/api-utils";
import {
  EXPENSE_CREATE_PERMISSIONS,
  EXPENSE_READ_PERMISSIONS,
} from "@/lib/finance-permissions";
import { requireOrgId } from "@/lib/tenancy/context";
import { AuditAction, recordActivity } from "@/lib/audit-service";
import { supplierSchema, supplierVatNumber } from "@/lib/invoice/expense-vat";
import {
  accountingPhase0Available,
  PHASE0_MISSING_MESSAGE,
} from "@/lib/invoice/phase0-columns";

const supplierSelect = {
  id: true,
  name: true,
  vatNumber: true,
  phone: true,
  isActive: true,
} as const;

export const GET = withPermissionAndDB([...EXPENSE_READ_PERMISSIONS])(
  async (_user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      // Before the migration there are no suppliers to list.
      if (!(await accountingPhase0Available())) {
        return createSuccessResponse({ suppliers: [] }, "Suppliers retrieved");
      }
      const search = (request.nextUrl.searchParams.get("search") ?? "").trim();
      const suppliers = await db.supplier.findMany({
        where: search
          ? {
              OR: [
                { name: { contains: search, mode: "insensitive" } },
                { vatNumber: { contains: search } },
                { phone: { contains: search } },
              ],
            }
          : {},
        select: supplierSelect,
        orderBy: { name: "asc" },
        take: 200,
      });
      return createSuccessResponse({ suppliers }, "Suppliers retrieved");
    } catch (error) {
      return handleApiError(error);
    }
  },
);

export const POST = withPermissionAndDB([...EXPENSE_CREATE_PERMISSIONS])(
  async (_user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      if (!(await accountingPhase0Available())) {
        return createErrorResponse(PHASE0_MISSING_MESSAGE, 503);
      }
      const parsed = supplierSchema.safeParse(await request.json());
      if (!parsed.success) {
        return createErrorResponse(
          parsed.error.errors.map((issue) => issue.message).join(", "),
          400,
        );
      }
      const vat = supplierVatNumber(parsed.data.vatNumber);
      if ("error" in vat) return createErrorResponse(vat.error, 400);

      const supplier = await db.supplier.create({
        data: {
          organizationId: requireOrgId(),
          name: parsed.data.name,
          vatNumber: vat.vatNumber,
          phone: parsed.data.phone?.trim() || null,
        },
        select: supplierSelect,
      });

      void recordActivity({
        action: AuditAction.CREATE,
        recordType: "supplier",
        recordId: supplier.id,
        recordName: supplier.name,
        after: { name: supplier.name, vatNumber: supplier.vatNumber, phone: supplier.phone },
      });

      return createSuccessResponse(supplier, "Supplier created");
    } catch (error) {
      return handleApiError(error);
    }
  },
);
