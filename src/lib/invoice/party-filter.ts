/**
 * PropertyPro - Which invoices a list asks for
 *
 * Without `party` it is a tenant's invoices, as every screen outside
 * Accounting expects — installments and charges: an invoice to an owner or a
 * customer has no tenant for those screens to show, and a credit note is not
 * a charge. `party=all` is everything the office has issued; `party=tenant|
 * owner|customer` one kind of customer; `documentType=invoice|credit_note`
 * one kind of document. Shared by the invoice list and its figures.
 */

import type { Prisma } from "@/generated/prisma/client";
import { CUSTOMER_TYPES } from "@/lib/invoice/custom-invoice-schema";

/** Matches nothing: what a filter on a column the database lacks yields. */
const NOTHING: Prisma.InvoiceWhereInput = { id: { in: [] } };

export function invoicePartyWhere(
  searchParams: URLSearchParams,
  /** Whether accounting phase 0's columns exist (phase0-columns.ts). */
  phase0: boolean,
): Prisma.InvoiceWhereInput | { error: string } {
  const party = searchParams.get("party");
  const documentType = searchParams.get("documentType");
  if (party && party !== "all" && !(CUSTOMER_TYPES as readonly string[]).includes(party)) {
    return { error: `Unknown party "${party}"` };
  }
  if (documentType && documentType !== "invoice" && documentType !== "credit_note") {
    return { error: `Unknown document type "${documentType}"` };
  }
  if (!party) {
    return phase0
      ? { tenantId: { not: null }, documentType: "invoice" }
      : { tenantId: { not: null } };
  }
  const where: Prisma.InvoiceWhereInput = {};
  if (party === "tenant") where.tenantId = { not: null };
  if (party === "owner" || party === "customer") {
    if (!phase0) return NOTHING;
    where.customerType = party;
  }
  if (documentType) {
    if (phase0) where.documentType = documentType;
    else if (documentType === "credit_note") return NOTHING;
  }
  return where;
}
