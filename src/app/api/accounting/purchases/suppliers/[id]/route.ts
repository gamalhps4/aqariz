/**
 * PropertyPro - One supplier
 *
 * GET    — the supplier with what the office owes them, from the books.
 * PATCH  — change it: any of the fields of a new one, and `isActive` to
 *          deactivate or reactivate it.
 * DELETE — remove one nothing has been written against; a supplier with
 *          bills, payments or expenses is deactivated instead.
 */

import { createErrorResponse, createSuccessResponse } from "@/lib/api-utils";
import {
  PURCHASE_DELETE_ACCESS,
  PURCHASE_EDIT_ACCESS,
  PURCHASE_VIEW_ACCESS,
  ledgerRoute,
  readJson,
} from "@/lib/accounting/purchases/api";
import { deleteSupplier, getSupplier, updateSupplier } from "@/lib/accounting/purchases/suppliers.service";

export const dynamic = "force-dynamic";

export const GET = ledgerRoute(PURCHASE_VIEW_ACCESS, async (_user, _request, context) => {
  const { id } = await context.params;
  const supplier = await getSupplier(id);
  if (!supplier) return createErrorResponse("Supplier not found", 404, undefined, "PURCHASE_SUPPLIER_NOT_FOUND");
  return createSuccessResponse(supplier);
});

export const PATCH = ledgerRoute(PURCHASE_EDIT_ACCESS, async (_user, request, context) => {
  const { id } = await context.params;
  return createSuccessResponse(await updateSupplier(id, await readJson(request)), "Supplier updated");
});

export const DELETE = ledgerRoute(PURCHASE_DELETE_ACCESS, async (_user, _request, context) => {
  const { id } = await context.params;
  await deleteSupplier(id);
  return createSuccessResponse({ id }, "Supplier removed");
});
