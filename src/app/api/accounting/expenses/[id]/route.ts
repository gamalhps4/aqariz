/**
 * PropertyPro - Single Expense API Routes
 * GET/PUT/DELETE /api/accounting/expenses/[id]
 *
 * An expense outside the caller's buildings is not found, whichever of the
 * three asks for it.
 */

import { NextRequest } from "next/server";
import {
  AuthenticatedAccessUser,
  withPermissionAndDB,
  createSuccessResponse,
  createErrorResponse,
  isValidObjectId,
} from "@/lib/api-utils";
import {
  ExpenseScopeError,
  expenseService,
} from "@/lib/services/expense.service";
import { expenseUpdateSchema, validateSchema } from "@/lib/validations";
import { expenseVatFields } from "@/lib/invoice/expense-vat";
import { checkExpenseVat } from "@/lib/invoice/expense-vat-check";
import { AuditAction, auditRecordChange, recordActivity } from "@/lib/audit-domain";
import {
  EXPENSE_CHANGE_KEYS,
  expenseName,
  expenseSnapshot,
} from "@/lib/audit/records/expense";
import { compact, statusMove } from "@/lib/audit/records/shared";

/** An edit may change the VAT inside the amount and the supplier too. */
const expenseEditSchema = expenseUpdateSchema.extend(expenseVatFields);
import {
  EXPENSE_DELETE_PERMISSIONS,
  EXPENSE_EDIT_PERMISSIONS,
  EXPENSE_READ_PERMISSIONS,
} from "@/lib/finance-permissions";

export const GET = withPermissionAndDB([...EXPENSE_READ_PERMISSIONS])(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    try {
      const { id } = await params;

      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid expense ID", 400);
      }

      const expense = await expenseService.getExpense(user, id);
      if (!expense) {
        return createErrorResponse("Expense not found", 404);
      }

      return createSuccessResponse(expense, "Expense retrieved successfully");
    } catch (error) {
      console.error("[Expense API] GET error:", error);
      return createErrorResponse("Failed to fetch expense", 500);
    }
  }
);

export const PUT = withPermissionAndDB([...EXPENSE_EDIT_PERMISSIONS])(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    try {
      const { id } = await params;

      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid expense ID", 400);
      }

      const body = await request.json();

      const validation = validateSchema(expenseEditSchema, body);
      if (!validation.success) {
        return createErrorResponse(validation.errors.join(", "), 400);
      }
      const existing = await expenseService.getExpense(user, id);
      if (!existing) {
        return createErrorResponse("Expense not found", 404);
      }
      const checked = await checkExpenseVat(validation.data, existing);
      if (!checked.ok) {
        return createErrorResponse(checked.message, checked.status);
      }

      const expense = await expenseService.updateExpense(
        user,
        id,
        checked.data
      );

      if (!expense) {
        return createErrorResponse("Expense not found", 404);
      }

      // Approving, paying and cancelling all arrive here as a status.
      const before = expenseSnapshot(existing);
      const after = expenseSnapshot(expense);
      const move = statusMove(before, after);
      auditRecordChange({
        action: move ? AuditAction.STATUS_CHANGED : AuditAction.UPDATE,
        recordType: "expense",
        recordId: id,
        recordName: expenseName(expense),
        before,
        after,
        keys: EXPENSE_CHANGE_KEYS,
        messageParams: move ?? undefined,
      });

      return createSuccessResponse(expense, "Expense updated successfully");
    } catch (error) {
      if (error instanceof ExpenseScopeError) {
        return createErrorResponse(error.message, error.statusCode);
      }
      console.error("[Expense API] PUT error:", error);
      return createErrorResponse("Failed to update expense", 500);
    }
  }
);

export const DELETE = withPermissionAndDB([...EXPENSE_DELETE_PERMISSIONS])(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    try {
      const { id } = await params;

      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid expense ID", 400);
      }

      const deleted = await expenseService.deleteExpense(user, id);
      if (!deleted) {
        return createErrorResponse("Expense not found", 404);
      }

      // The row now reads "cancelled", which is not what it was: no status.
      void recordActivity({
        action: AuditAction.DELETE,
        recordType: "expense",
        recordId: id,
        recordName: expenseName(deleted),
        before: compact(expenseSnapshot(deleted, { status: false })),
      });

      return createSuccessResponse(null, "Expense deleted successfully");
    } catch (error) {
      console.error("[Expense API] DELETE error:", error);
      return createErrorResponse("Failed to delete expense", 500);
    }
  }
);
