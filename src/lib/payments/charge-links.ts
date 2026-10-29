/**
 * PropertyPro - Whether a charge's contract, tenant, building and installment
 * agree with each other
 *
 * "Add payment" wrote whatever ids it was sent. A contract belonging to
 * another tenant, an installment from another contract, and an empty contract
 * id ("Related record does not exist") all reached the database, and the
 * edit screen could move a payment onto a different contract afterwards. The
 * review asks that payment records "remain linked to the correct contract and
 * installment"; these are the rules that keep them so.
 *
 * Pure — the route loads the rows, this judges them — so it is tested without
 * a database.
 */

import { InvoiceStatus } from "@/types";

export interface ChargeLinks {
  tenantId: string;
  propertyId: string;
  leaseId?: string | null;
  invoiceId?: string | null;
}

export interface LeaseLinks {
  tenantId: string;
  propertyId: string;
}

export interface InvoiceLinks {
  // Null on an invoice to an owner or a customer: it never matches a
  // tenant's charge.
  tenantId: string | null;
  propertyId: string | null;
  leaseId: string | null;
  status: string;
}

export interface LinkProblem {
  message: string;
  status: 400 | 404;
}

/**
 * What is wrong with these links, or null when they agree.
 *
 * `lease` and `invoice` are the rows the ids resolved to under the caller's
 * scope — null when nothing did, which reads the same as an id that never
 * existed.
 */
export function chargeLinkProblem(
  charge: ChargeLinks,
  lease: LeaseLinks | null | undefined,
  invoice: InvoiceLinks | null | undefined,
): LinkProblem | null {
  if (charge.leaseId) {
    if (!lease) return { message: "Contract not found", status: 404 };
    if (lease.tenantId !== charge.tenantId) {
      return {
        message: "This contract belongs to a different tenant.",
        status: 400,
      };
    }
    if (lease.propertyId !== charge.propertyId) {
      return {
        message: "This contract is for a different building.",
        status: 400,
      };
    }
  }

  if (charge.invoiceId) {
    if (!invoice) return { message: "Installment not found", status: 404 };
    if (!charge.leaseId || invoice.leaseId !== charge.leaseId) {
      return {
        message: "This installment belongs to a different contract.",
        status: 400,
      };
    }
    if (
      invoice.tenantId !== charge.tenantId ||
      invoice.propertyId !== charge.propertyId
    ) {
      return {
        message: "This installment belongs to a different tenant or building.",
        status: 400,
      };
    }
    if (invoice.status === InvoiceStatus.CANCELLED) {
      return { message: "This installment is cancelled.", status: 400 };
    }
  }

  return null;
}

/**
 * Whether an edit asks to move a payment to another contract.
 *
 * Absent means "leave it", and an empty value from an untouched select means
 * the same. Anything else must be the contract it already has: a payment is
 * corrected by deleting it and adding it again on the right contract, which
 * takes any money it carries back off its installment on the way.
 */
export function movesToAnotherContract(
  current: string | null,
  requested: string | null | undefined,
): boolean {
  if (requested === undefined) return false;
  const wanted = requested?.trim() || null;
  if (wanted === null && current === null) return false;
  return wanted !== current;
}
