/**
 * PropertyPro - What the purchases routes accept
 *
 * The bodies of the supplier, bill and voucher routes, shared by the routes
 * and the forms. No database: the services resolve the supplier, the
 * accounts and the buildings. Days arrive as `YYYY-MM-DD`; amounts as numbers
 * with at most two decimals (a quantity takes three).
 */

import { z } from "zod";
import { VAT_CATEGORIES } from "@/lib/invoice/vat";
import { MAX_BILL_LINES } from "./bill-math";
import { VOUCHER_METHODS } from "./types";

const id = z.string().trim().min(1).max(64);
const text = (max: number) => z.string().trim().max(max);

/** A money amount: finite, with at most two decimals. */
const money = z.coerce
  .number({ invalid_type_error: "Enter an amount" })
  .finite("Enter an amount")
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, "An amount has at most two decimals");

const quantity = z.coerce
  .number({ invalid_type_error: "Enter a quantity" })
  .finite()
  .positive("The quantity must be more than zero")
  .max(1_000_000_000)
  .refine((value) => Math.abs(value * 1000 - Math.round(value * 1000)) < 1e-6, "A quantity has at most three decimals");

export const supplierBodySchema = z.object({
  name: z.string().trim().min(1, "The supplier's name is required").max(200),
  vatNumber: text(32).nullish(),
  phone: text(40).nullish(),
  contactName: text(200).nullish(),
  email: z.union([z.literal(""), z.string().trim().email("The email does not look right").max(200)]).nullish(),
  address: text(500).nullish(),
  city: text(100).nullish(),
  crNumber: text(50).nullish(),
  bankName: text(100).nullish(),
  iban: text(40).nullish(),
  // A blank field is no terms at all: left to the coercion it would read as 0 days.
  paymentTermsDays: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    z.coerce
      .number()
      .int("Payment terms are whole days")
      .min(0, "Payment terms cannot be negative")
      .max(365, "Payment terms are at most 365 days")
      .nullish(),
  ),
  notes: text(2000).nullish(),
});
export type SupplierBody = z.infer<typeof supplierBodySchema>;

export const supplierPatchSchema = supplierBodySchema.partial().extend({ isActive: z.boolean().optional() });
export type SupplierPatch = z.infer<typeof supplierPatchSchema>;

export const billLineSchema = z.object({
  description: z.string().trim().min(1, "Describe what was bought").max(200),
  accountId: id,
  quantity: quantity.default(1),
  unitPrice: money.refine((value) => value >= 0, "A price cannot be negative"),
  vatCategory: z.enum(VAT_CATEGORIES),
  vatRate: z.coerce.number().finite().min(0).max(100).optional(),
  propertyId: id.nullish(),
  unitId: id.nullish(),
});
export type BillLineBody = z.infer<typeof billLineSchema>;

export const billBodySchema = z.object({
  supplierId: id,
  supplierInvoiceNumber: text(100).nullish(),
  billDate: z.string().trim().min(1, "Choose the bill's date"),
  /** Left out: the bill's date plus the supplier's payment terms. */
  dueDate: z.string().trim().nullish(),
  discountAmount: money.refine((value) => value >= 0, "The discount cannot be negative").default(0),
  notes: text(2000).nullish(),
  lines: z
    .array(billLineSchema)
    .min(1, "Add at least one line")
    .max(MAX_BILL_LINES, `A bill holds at most ${MAX_BILL_LINES} lines`),
});
export type BillBody = z.infer<typeof billBodySchema>;

export const allocationSchema = z.object({
  billId: id,
  amount: money.refine((value) => value > 0, "A payment to a bill must be above zero"),
});

export const voucherBodySchema = z.object({
  supplierId: id,
  bankAccountId: id,
  voucherDate: z.string().trim().min(1, "Choose the voucher's date"),
  amount: money.refine((value) => value > 0, "The amount must be above zero"),
  method: z.enum(VOUCHER_METHODS).default("bank_transfer"),
  reference: text(100).nullish(),
  notes: text(2000).nullish(),
  allocations: z.array(allocationSchema).max(200).default([]),
});
export type VoucherBody = z.infer<typeof voucherBodySchema>;

export const allocateBodySchema = z.object({
  allocations: z.array(allocationSchema).min(1, "Choose a bill to pay").max(200),
});

export const reasonBodySchema = z.object({
  reason: text(500).nullish(),
});

/** Flatten a zod failure into one sentence. */
export function issuesText(error: z.ZodError): string {
  return [...new Set(error.issues.map((issue) => issue.message))].join(". ");
}
