/**
 * PropertyPro - What a viewer may do on a contract's page
 *
 * The contract page decided its buttons on its own: the installment table
 * offered "Record a payment", edit, remove and add to every member of staff,
 * and the server then refused whoever lacked the right — a 403 at the end of
 * a filled-in form. Where the page did check, it checked the role's
 * permissions as the browser knows them, which leave out the grants and
 * denials an administrator sets on one person, so the same button could be
 * missing for someone the server would let through.
 *
 * Each right below is the exact permission list the route behind the button
 * asks for, so the button and the route cannot disagree. The routes compute
 * these from the caller's resolved permissions — overrides included — and
 * send them with the contract; the page draws its buttons from that.
 */

import { hasAnyPermission } from "@/lib/permissions-manager";
import { INSTALLMENT_GENERATION_PERMISSIONS } from "@/lib/lease-lifecycle";

/** PATCH /api/invoices/[id] `add_payment` — what records money against an installment. */
export const RECORD_PAYMENT_PERMISSIONS = [
  "financial_management",
  "payment_processing",
  "payment_create",
] as const;

/** DELETE /api/payments/[id]. */
export const DELETE_PAYMENT_PERMISSIONS = [
  "payment_delete",
  "financial_management",
] as const;

/**
 * POST, PATCH and DELETE on /api/leases/[id]/installments — and PUT on the
 * contract itself, which asks for the same.
 */
export const EDIT_INSTALLMENT_PERMISSIONS = [
  "lease_edit",
  "lease_management",
] as const;

/**
 * POST /api/leases/[id]/amend — together with EDIT_INSTALLMENT_PERMISSIONS.
 * An amendment cancels issued installments and bills new ones, which moves
 * the books, so editing contracts alone is not enough for it.
 */
export const AMEND_TERMS_PERMISSIONS = [
  "financial_management",
  "invoice_edit",
] as const;

/**
 * GET /api/invoices — the invoice register. `invoice_view` is the register's
 * own View right, which comes with the per-action finance permissions.
 */
export const VIEW_INVOICES_PERMISSIONS = [
  "invoice_view",
  "financial_management",
] as const;

export interface ContractRights {
  /** Open the contract's edit form (PUT /api/leases/[id]). */
  editContract: boolean;
  /** Record a payment against an installment or charge. */
  recordPayments: boolean;
  /** Move a payment to the archive. */
  deletePayments: boolean;
  /** Add a charge, change or remove an installment. */
  editInstallments: boolean;
  /** Bill the installments not billed yet. */
  generateInstallments: boolean;
  /** Open the invoice register filtered to this contract. */
  viewInvoices: boolean;
  /** Amend the terms of a contract whose installments are billed. */
  amendTerms: boolean;
}

export interface ContractViewer {
  permissions: readonly string[];
  isTenant: boolean;
}

/**
 * The rights of one viewer. A tenant's view of their own contract is
 * read-only whatever else they hold.
 */
export function contractRights(viewer: ContractViewer): ContractRights {
  const may = (required: readonly string[]) =>
    !viewer.isTenant && hasAnyPermission(viewer.permissions, required);

  return {
    editContract: may(EDIT_INSTALLMENT_PERMISSIONS),
    recordPayments: may(RECORD_PAYMENT_PERMISSIONS),
    deletePayments: may(DELETE_PAYMENT_PERMISSIONS),
    editInstallments: may(EDIT_INSTALLMENT_PERMISSIONS),
    generateInstallments: may(INSTALLMENT_GENERATION_PERMISSIONS),
    viewInvoices: may(VIEW_INVOICES_PERMISSIONS),
    amendTerms:
      may(EDIT_INSTALLMENT_PERMISSIONS) && may(AMEND_TERMS_PERMISSIONS),
  };
}
