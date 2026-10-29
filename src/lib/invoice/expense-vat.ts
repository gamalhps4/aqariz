/**
 * PropertyPro - The VAT on an expense, and who supplied it
 *
 * An expense's `amount` is what was paid, VAT included — the figure on the
 * supplier's invoice. Its VAT is recorded inside that amount (`vatAmount`),
 * with its category, so the office can reclaim it (the VAT summary's input
 * VAT) and the ledger can post it to input VAT. The supplier and the
 * supplier's own invoice number say where the VAT is claimed from.
 *
 * The fields' rules, shared by the expense routes and form. No database.
 */

import { z } from "zod";
import {
  isSaudiVatNumber,
  normalizeVatNumber,
  STANDARD_VAT_RATE,
  VAT_CATEGORIES,
  type VatCategory,
} from "@/lib/invoice/vat";

export const expenseVatFields = {
  vatAmount: z.coerce.number().finite().min(0, "VAT cannot be negative").optional(),
  vatCategory: z.enum(VAT_CATEGORIES).nullish(),
  supplierId: z.string().trim().max(64).nullish(),
  supplierInvoiceNumber: z.string().trim().max(100).nullish(),
};

export const supplierSchema = z.object({
  name: z.string().trim().min(1, "The supplier's name is required").max(200),
  vatNumber: z.string().trim().max(32).nullish(),
  phone: z.string().trim().max(40).nullish(),
});

/** Why these VAT fields cannot stand, or null. */
export function expenseVatProblem(fields: {
  amount?: number | null;
  vatAmount?: number | null;
  vatCategory?: VatCategory | null;
}): string | null {
  const vat = Number(fields.vatAmount ?? 0);
  if (vat > 0 && fields.vatCategory && fields.vatCategory !== "S") {
    return "Only a standard-rated expense carries VAT";
  }
  if (fields.amount !== undefined && fields.amount !== null && vat > Number(fields.amount)) {
    return "The VAT cannot be more than the amount it is part of";
  }
  return null;
}

/** A supplier's VAT number, normalized — or why it is not one. */
export function supplierVatNumber(
  value: string | null | undefined,
): { vatNumber: string | null } | { error: string } {
  const number = normalizeVatNumber(value);
  if (!number) return { vatNumber: null };
  return isSaudiVatNumber(number)
    ? { vatNumber: number }
    : { error: "A VAT number is 15 digits that begin and end with 3" };
}

/** The VAT inside an amount that includes it at `rate` percent. */
export function vatInsideAmount(amount: number, rate = STANDARD_VAT_RATE): number {
  const gross = Number(amount);
  if (!Number.isFinite(gross) || gross <= 0 || rate <= 0) return 0;
  return Math.round(((gross * rate) / (100 + rate)) * 100) / 100;
}
